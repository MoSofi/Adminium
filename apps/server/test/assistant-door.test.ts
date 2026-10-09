// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The assistant's door, by itself: a ticket is for one request, one route and
 * one person, and an address is built only from what cannot change it.
 *
 * The whole-server tests show what goes through the door. These show what a
 * LIVE ticket cannot do, which only a request made while one exists can show:
 * the target route here replays its own ticket as somebody else and at another
 * route, and reports what came back.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { assistantDoorPlugin, DOOR_HEADER, DOOR_ROUTES, doorPath, DoorRefusedError, isSafeSegment, type DoorRouteKey } from '../src/assistant/door.js';

let app: FastifyInstance;
/** What the target route saw and tried, by the record id it was asked for. */
const seen: Record<string, { via: unknown; ticket: string; asOther: number; elsewhere: number; samePersonAgain: number; asDelete: number }> = {};

beforeAll(async () => {
  app = Fastify();
  app.setErrorHandler((error: { status?: number; statusCode?: number; message: string }, _request, reply) => {
    void reply.status(error.status ?? error.statusCode ?? 500).send({ error: { message: error.message } });
  });
  // Who is asking: the cookie says so here. Before the door, as the real sign-in is.
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (request) => {
    const who = /(?:^|;\s*)u=([a-z]+)/.exec(request.headers.cookie ?? '')?.[1];
    (request as unknown as { user: unknown }).user = who === undefined ? null : { id: who, name: who };
  });
  await app.register(assistantDoorPlugin);

  app.get('/api/v1/data/:connectionId/:table/:recordId', async (request) => {
    const { recordId } = request.params as { recordId: string };
    const ticket = String(request.headers[DOOR_HEADER] ?? '');
    if (ticket !== '' && seen[recordId] === undefined) {
      seen[recordId] = { via: request.assistantVia, ticket, asOther: 0, elsewhere: 0, samePersonAgain: 0, asDelete: 0 };
      // While the ticket is alive: the same address as somebody else, another route as the same person, and the same again.
      seen[recordId].asOther = (await app.inject({ method: 'GET', url: request.url, headers: { cookie: 'u=mallory', [DOOR_HEADER]: ticket } })).statusCode;
      seen[recordId].elsewhere = (await app.inject({ method: 'GET', url: '/api/v1/roles/abc', headers: { cookie: request.headers.cookie ?? '', [DOOR_HEADER]: ticket } })).statusCode;
      seen[recordId].samePersonAgain = (await app.inject({ method: 'GET', url: request.url, headers: { cookie: request.headers.cookie ?? '', [DOOR_HEADER]: ticket } })).statusCode;
      // The same address with another method: a read's ticket never deletes.
      seen[recordId].asDelete = (await app.inject({ method: 'DELETE', url: request.url, headers: { cookie: request.headers.cookie ?? '', [DOOR_HEADER]: ticket } })).statusCode;
    }
    return { data: { id: recordId }, via: request.assistantVia };
  });
  app.delete('/api/v1/data/:connectionId/:table/:recordId', async () => ({ deleted: true }));
  app.get('/api/v1/roles/:id', async () => ({ role: 'everything' }));
  app.get('/go/:id', async (request) => {
    const { id } = request.params as { id: string };
    return app.assistantDoor.replay(request, { route: 'row.read', params: { connectionId: 'c1', table: 'main.t', recordId: id }, sessionId: 'ast_1', turnId: 'atn_1' });
  });
  await app.ready();
});
afterAll(async () => app.close());

describe('a ticket', () => {
  it('marks the one request it was made for, as the person it was made for', async () => {
    const res = await app.inject({ method: 'GET', url: '/go/7', headers: { cookie: 'u=ana' } });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ status: 200, body: { data: { id: '7' }, via: { sessionId: 'ast_1', turnId: 'atn_1' } } });
    expect(seen['7']?.via).toEqual({ sessionId: 'ast_1', turnId: 'atn_1' });
  });

  it('is refused while it lives when another person carries it, and at any route but its own', async () => {
    await app.inject({ method: 'GET', url: '/go/8', headers: { cookie: 'u=ana' } });
    expect(seen['8']).toMatchObject({ asOther: 403, elsewhere: 403 });
    // The same person at the same route is the request it was made for: that is what it allows.
    expect(seen['8']?.samePersonAgain).toBe(200);
  });

  it('is gone when its request returns, and its method is part of what it names', async () => {
    await app.inject({ method: 'GET', url: '/go/9', headers: { cookie: 'u=ana' } });
    const ticket = seen['9']!.ticket;
    expect(ticket).not.toBe('');
    const late = await app.inject({ method: 'GET', url: '/api/v1/data/c1/main.t/9', headers: { cookie: 'u=ana', [DOOR_HEADER]: ticket } });
    expect(late.statusCode).toBe(403);
    // And while it lived, it was a ticket to READ: the same address as a delete was refused.
    expect(seen['9']?.asDelete).toBe(403);
    // Without the header the same delete is the person's own request, as ever.
    expect((await app.inject({ method: 'DELETE', url: '/api/v1/data/c1/main.t/9', headers: { cookie: 'u=ana' } })).statusCode).toBe(200);
  });

  it('is never made for a caller with no session cookie, and never carries an authorization header', async () => {
    const bare = await app.inject({ method: 'GET', url: '/go/11' });
    expect(bare.statusCode).toBe(500);
    expect(bare.body).toContain('signed-in person');
    expect(seen['11']).toBeUndefined();
    // The header from outside, with anything in it, is refused before any route runs.
    for (const value of ['made-up', '', 'x'.repeat(64)]) {
      const res = await app.inject({ method: 'GET', url: '/api/v1/data/c1/main.t/12', headers: { cookie: 'u=ana', [DOOR_HEADER]: value } });
      expect(res.statusCode).toBe(403);
    }
  });
});

describe('an address', () => {
  const HOSTILE = ['..', '.', '', 'a/b', '../roles', '..%2f..%2froles', 'x?confirm=true', 'x#y', 'x\\y', 'a\nb', 'a\u0000b', '%2e%2e', 'roles/../../auth'];
  /** The path a built address really names, as the server's router will read it. */
  const landed = (path: string): string => new URL(path, 'http://x').pathname;
  const shape = (pattern: string): RegExp => new RegExp(`^${pattern.replace(/:[A-Za-z]+/g, '[^/]+')}$`);

  it('lands on its own route for every listed route and every hostile value, or is refused before it is sent', () => {
    for (const key of Object.keys(DOOR_ROUTES) as DoorRouteKey[]) {
      const names = [...DOOR_ROUTES[key].url.matchAll(/:([A-Za-z]+)/g)].map((match) => match[1] as string);
      for (const name of names) {
        for (const value of HOSTILE) {
          const params = Object.fromEntries(names.map((other) => [other, other === name ? value : 'ok']));
          let path: string;
          try {
            path = doorPath(key, params);
          } catch (error) {
            expect(error, `${key} ${name}=${JSON.stringify(value)}`).toBeInstanceOf(DoorRefusedError);
            continue;
          }
          expect(landed(path), `${key} ${name}=${JSON.stringify(value)} → ${path}`).toMatch(shape(DOOR_ROUTES[key].url));
        }
      }
    }
  });

  it('keeps an ordinary key whole, whatever it holds that is not a path', () => {
    for (const value of ['7', 'ALFKI', 'a b', 'ü', 'a+b', 'a&b=c', 'a;b', "o'neil", '2026-10-09T10:00:00Z', 'a,b']) {
      expect(isSafeSegment(value), value).toBe(true);
      const path = doorPath('row.read', { connectionId: 'c1', table: 'main.t', recordId: value });
      expect(decodeURIComponent(landed(path).split('/').at(-1) ?? ''), value).toBe(value);
    }
  });
});
