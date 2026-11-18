// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The chat door's own routes, over a catalog and a door a test hands in:
 *  - while the outside cannot reach this server (each state the forms door's
 *    rule knows), every route answers "not available" and asks the door for
 *    nothing, so nothing is written;
 *  - the `/x/` headers: the window's page drawn for a frame is framed by the
 *    listed websites only, its API by nobody, a preview by this host alone;
 *  - a preview is drawn only for a signed-in person who may read the chat's
 *    conversations, and every other route refuses a preview before anything;
 *  - every route is public, in the chat's own buckets (`chat-poll`,
 *    `chat-write`), and the registry takes both.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import Fastify, { type FastifyInstance, type RouteOptions } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createSqliteMetaDb, firstRun, settingsRepo, type MetaDb } from '@adminium/meta';

import type { ChatCatalog, LiveChat } from '../src/chat/catalog.js';
import type { ChatDoor, DoorReply } from '../src/chat/door.js';
import { RATE_BUCKETS } from '../src/plugins/core.js';
import { chatDoorRoutes } from '../src/routes/chat-door/index.js';
import { xContentPolicy } from '../src/routes/x-door/headers.js';
import { TEST_SECRET } from './helpers.js';

const HTML = '<!doctype html><html><head><title>Chat</title></head><body><noscript><p>Needs JavaScript.</p></noscript><div id="x-root"></div></body></html>';
const HOST = 'chat.meridian.example';

/** Just enough of a chat for the routes: the door does the rest. */
const CHAT = { addOn: 'live-chat', connectionId: 'conn_1', conversations: { table: { id: 'public.live_chat_conversations' }, pk: 'id' } } as unknown as LiveChat;

/** Every route of the door, as a visitor's window calls it. */
const ROUTES: { method: 'GET' | 'POST'; url: string }[] = [
  { method: 'GET', url: '/x/chat/live-chat' },
  { method: 'GET', url: '/x/chat/api/live-chat/config' },
  { method: 'POST', url: '/x/chat/api/live-chat/challenge' },
  { method: 'POST', url: '/x/chat/api/live-chat/start' },
  { method: 'POST', url: '/x/chat/api/live-chat/messages' },
  { method: 'GET', url: '/x/chat/api/live-chat/messages?after=0' },
  { method: 'POST', url: '/x/chat/api/live-chat/details' },
  { method: 'POST', url: '/x/chat/api/live-chat/question' },
  { method: 'POST', url: '/x/chat/api/live-chat/close' },
];

describe('the chat door routes', () => {
  let meta: MetaDb;
  let app: FastifyInstance | undefined;
  let spa: string;
  let websites: string[];
  /** What the routes asked of the catalog and the door. */
  let asked: string[];
  let routes: RouteOptions[];

  const ok = (name: string) => async (): Promise<DoorReply> => {
    asked.push(name);
    return { status: 200, body: { state: name } };
  };
  const door = {
    config: async (_chat: LiveChat, opts: { preview?: boolean }) => {
      asked.push(opts.preview === true ? 'config-preview' : 'config');
      return { status: 200, body: { state: 'live', ...(opts.preview === true ? { preview: true } : {}) } };
    },
    unavailable: async () => ({ status: 404, body: { state: 'unavailable' } }),
    start: ok('start'),
    post: ok('post'),
    poll: ok('poll'),
    details: ok('details'),
    question: ok('question'),
    close: ok('close'),
    settled: async () => undefined,
  } as unknown as ChatDoor;
  const catalog: ChatCatalog = {
    find: async (addOn) => {
      asked.push(`find:${addOn}`);
      return addOn === 'live-chat' ? { state: 'live', chat: CHAT } : { state: 'unavailable' };
    },
    forStaff: async (addOn) => {
      asked.push(`staff:${addOn}`);
      return addOn === 'live-chat' ? CHAT : null;
    },
    forget: () => true,
  };

  async function start(opts: { networkFeatures?: boolean; desktop?: boolean; trustProxy?: boolean } = {}): Promise<void> {
    mkdirSync(join(spa, 'x', 'assets'), { recursive: true });
    writeFileSync(join(spa, 'x', 'index.html'), HTML);
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('spaRoot', spa);
    app.addHook('onRoute', (route) => {
      routes.push(route);
    });
    // A signed-in person, as the session plugin makes one: `x-test-reader` may read the conversations, `x-test-staff` may not.
    app.decorateRequest('user', null);
    app.decorateRequest('session', null);
    app.decorateRequest('can', null);
    app.addHook('onRequest', async (request, reply) => {
      void reply.header('x-frame-options', 'SAMEORIGIN');
      const reader = request.headers['x-test-reader'] !== undefined;
      if (reader || request.headers['x-test-staff'] !== undefined) {
        (request as unknown as { user: unknown }).user = { id: 'usr_1' };
        (request as unknown as { session: unknown }).session = { id: 'ses_1' };
      }
      (request as unknown as { can: (permission: string) => Promise<boolean> }).can = async (permission) => reader && permission === 'table:conn_1:public.live_chat_conversations:read';
    });
    await app.register(
      chatDoorRoutes({
        meta,
        catalog,
        door,
        secret: TEST_SECRET,
        websites: async () => websites,
        networkFeatures: opts.networkFeatures ?? true,
        desktop: opts.desktop ?? false,
        trustProxy: opts.trustProxy ?? false,
      }),
    );
    await app.ready();
  }

  const call = (method: 'GET' | 'POST', url: string, headers: Record<string, string> = {}) =>
    app!.inject({ method, url, headers: { host: HOST, origin: `https://${HOST}`, ...headers }, ...(method === 'POST' ? { payload: { token: 'x', body: 'Hello' } } : {}) });

  beforeEach(async () => {
    app = undefined;
    asked = [];
    routes = [];
    websites = [];
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    await settingsRepo(meta).set('system.publicOrigin', `https://${HOST}`, { updatedBy: null });
    spa = mkdtempSync(join(tmpdir(), 'chat-door-'));
  });

  afterEach(async () => {
    await app?.close();
    await meta.db.destroy();
    rmSync(spa, { recursive: true, force: true });
  });

  it('serves every route while the outside can reach the server', async () => {
    await start();
    for (const route of ROUTES) {
      const answer = await call(route.method, route.url);
      expect(answer.statusCode, `${route.method} ${route.url}: ${answer.body}`).toBe(200);
    }
    expect(asked.filter((name) => !name.startsWith('find:'))).toEqual(['config', 'start', 'post', 'poll', 'details', 'question', 'close']);
  });

  const UNREACHABLE: { state: string; origin: string | null; opts?: { networkFeatures?: boolean; desktop?: boolean }; headers?: Record<string, string> }[] = [
    { state: 'network-off', origin: `https://${HOST}`, opts: { networkFeatures: false } },
    { state: 'desktop', origin: `https://${HOST}`, opts: { desktop: true } },
    { state: 'not-set', origin: null },
    { state: 'this-computer', origin: 'https://localhost' },
    { state: 'private-network', origin: 'https://10.0.0.7' },
    { state: 'dot-local', origin: 'https://office.local' },
    { state: 'not-https', origin: `http://${HOST}` },
    { state: 'proxy-hidden', origin: `https://${HOST}`, headers: { 'x-forwarded-for': '203.0.113.9' } },
  ];

  it.each(UNREACHABLE)('$state: every route is "not available", and the door is asked nothing', async ({ origin, opts, headers }) => {
    if (origin === null) await settingsRepo(meta).unset('system.publicOrigin');
    else await settingsRepo(meta).set('system.publicOrigin', origin, { updatedBy: null });
    await start(opts);
    for (const route of ROUTES) {
      const answer = await call(route.method, route.url, headers);
      expect(answer.statusCode, `${route.method} ${route.url}`).toBe(404);
    }
    expect(asked).toEqual([]);
  });

  it('a chat the catalog does not serve is "not available" on every route', async () => {
    await start();
    for (const route of ROUTES) {
      const answer = await call(route.method, route.url.replace('live-chat', 'no-such-chat'));
      expect(answer.statusCode, route.url).toBe(404);
    }
    expect(asked.every((name) => name.startsWith('find:'))).toBe(true);
  });

  it('frames the window for the listed websites only with ?frame=1; the API by nobody', async () => {
    websites = ['https://www.meridian.example'];
    await start();
    expect((await call('GET', '/x/chat/live-chat?frame=1')).headers['content-security-policy']).toBe(xContentPolicy(`http://${HOST}`, websites));
    for (const url of ['/x/chat/live-chat', '/x/chat/api/live-chat/config?frame=1', '/x/chat/api/live-chat/messages?frame=1']) {
      const answer = await call('GET', url);
      expect(answer.headers['content-security-policy'], url).toBe(xContentPolicy(`http://${HOST}`));
      expect(answer.headers['x-frame-options'], url).toBeUndefined();
      expect(answer.headers['cache-control'], url).toBe('no-store');
      expect(answer.headers['referrer-policy'], url).toBe('no-referrer');
    }
  });

  it('a preview is drawn only for a signed-in reader of the conversations, framed by this host alone, whatever the reach', async () => {
    await settingsRepo(meta).unset('system.publicOrigin');
    await start();
    const preview = await call('GET', '/x/chat/api/live-chat/config?preview=1', { 'x-test-reader': '1' });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({ state: 'live', preview: true });
    expect(preview.headers['content-security-policy']).toBe(xContentPolicy(`http://${HOST}`, ["'self'"]));
    expect((await call('GET', '/x/chat/live-chat?preview=1', { 'x-test-reader': '1' })).statusCode).toBe(200);
    // Signed in without the read, or not signed in: as a stranger.
    expect((await call('GET', '/x/chat/api/live-chat/config?preview=1', { 'x-test-staff': '1' })).statusCode).toBe(404);
    expect((await call('GET', '/x/chat/api/live-chat/config?preview=1')).statusCode).toBe(404);
    expect(asked.filter((name) => name.startsWith('config'))).toEqual(['config-preview']);
  });

  it('a preview writes nothing: every other route refuses it before the chat is even looked up', async () => {
    await start();
    asked = [];
    for (const route of ROUTES.filter((one) => one.url !== '/x/chat/live-chat' && !one.url.endsWith('/config'))) {
      const url = `${route.url}${route.url.includes('?') ? '&' : '?'}preview=1`;
      const answer = await call(route.method, url, { 'x-test-reader': '1' });
      expect(answer.statusCode, url).toBe(404);
    }
    expect(asked).toEqual([]);
  });

  it('every route is public, in the chat buckets, and the registry takes both', async () => {
    await start();
    const mine = routes.filter((route) => String(route.url).startsWith('/x/chat') && route.method !== 'HEAD');
    expect(mine).toHaveLength(ROUTES.length);
    for (const route of mine) {
      const config = route.config as { rateLimitBucket?: string; audience?: string } | undefined;
      const method = Array.isArray(route.method) ? route.method[0] : route.method;
      expect(config?.rateLimitBucket, `${String(method)} ${route.url}`).toBe(method === 'GET' ? 'chat-poll' : 'chat-write');
    }
    expect(RATE_BUCKETS['chat-poll']).toEqual({ max: 600, timeWindowMs: 60_000, keyBy: 'ip' });
    expect(RATE_BUCKETS['chat-write']).toEqual({ max: 660, timeWindowMs: 60_000, keyBy: 'ip' });
  });

  it('a tripped cap says its wait in Retry-After too', async () => {
    (door as unknown as { post: () => Promise<DoorReply> }).post = async () => ({ status: 429, body: { state: 'too-many', cap: 'minute', retryAfter: 42 } });
    await start();
    const answer = await call('POST', '/x/chat/api/live-chat/messages');
    expect(answer.statusCode).toBe(429);
    expect(answer.headers['retry-after']).toBe('42');
    expect(answer.json()).toEqual({ state: 'too-many', cap: 'minute', retryAfter: 42 });
    (door as unknown as { post: () => Promise<DoorReply> }).post = ok('post');
  });
});
