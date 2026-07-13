import { afterEach, describe, expect, it } from 'vitest';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { makeEnv } from './helpers.js';

let app: AdminiumServer | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** Builds the app plus a signed-cookie set/read fixture pair. */
async function buildWithCookieRoutes(): Promise<AdminiumServer> {
  app = await buildServer({ env: makeEnv(), logger: false });
  app.get('/cookie/set', async (_request, reply) => {
    void reply.setCookie('adminium_test', 'hello', { signed: true, path: '/', httpOnly: true });
    return { ok: true };
  });
  app.get('/cookie/read', async (request) => {
    const raw = request.cookies['adminium_test'];
    if (raw === undefined) return { valid: false, value: null };
    const unsigned = request.unsignCookie(raw);
    return { valid: unsigned.valid, value: unsigned.value };
  });
  return app;
}

/** Extracts the `name=value` pair from a set-cookie header. */
function cookiePair(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  expect(header).toBeDefined();
  return (header ?? '').split(';')[0] ?? '';
}

describe('@fastify/cookie (core plugin, secret from ADMINIUM_SECRET)', () => {
  it('signs cookies on the way out', async () => {
    const server = await buildWithCookieRoutes();
    const res = await server.inject({ method: 'GET', url: '/cookie/set' });
    expect(res.statusCode).toBe(200);
    const pair = cookiePair(res.headers['set-cookie']);
    expect(pair).toContain('adminium_test=');
    // signed value = payload + '.' + signature
    expect(pair.split('=').slice(1).join('=')).toContain('.');
  });

  it('reads back and verifies a signed cookie', async () => {
    const server = await buildWithCookieRoutes();
    const set = await server.inject({ method: 'GET', url: '/cookie/set' });
    const pair = cookiePair(set.headers['set-cookie']);
    const read = await server.inject({
      method: 'GET',
      url: '/cookie/read',
      headers: { cookie: pair },
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual({ valid: true, value: 'hello' });
  });

  it('rejects a tampered cookie signature', async () => {
    const server = await buildWithCookieRoutes();
    const set = await server.inject({ method: 'GET', url: '/cookie/set' });
    const pair = cookiePair(set.headers['set-cookie']).replace('hello', 'hacked');
    const read = await server.inject({
      method: 'GET',
      url: '/cookie/read',
      headers: { cookie: pair },
    });
    expect(read.statusCode).toBe(200);
    expect(read.json<{ valid: boolean }>().valid).toBe(false);
  });
});
