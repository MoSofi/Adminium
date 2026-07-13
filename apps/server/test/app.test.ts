import { afterEach, describe, expect, it } from 'vitest';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { APP_VERSION } from '../src/version.js';
import { makeEnv, REQUEST_ID_PATTERN } from './helpers.js';

let app: AdminiumServer | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function build(overrides: Record<string, string> = {}): Promise<AdminiumServer> {
  app = await buildServer({ env: makeEnv(overrides), logger: false });
  return app;
}

describe('buildServer — boot', () => {
  it('resolves without any database configured (wave-1 decoupling)', async () => {
    const server = await build(); // no DATABASE_URL, no ADMINIUM_META_URL
    await server.ready();
    expect(server.spaRoot).toBeNull();
  });
});

describe('GET /api/v1/healthz', () => {
  it('returns 200 with { ok, version, uptime }', async () => {
    const server = await build();
    const res = await server.inject({ method: 'GET', url: '/api/v1/healthz' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ ok: boolean; version: string; uptime: number }>();
    expect(body.ok).toBe(true);
    expect(body.version).toBe(APP_VERSION);
    expect(typeof body.uptime).toBe('number');
    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });
});

describe('GET /api/v1/system/info', () => {
  it('returns version, node, and a null dialect (meta wired in wave 2)', async () => {
    const server = await build();
    const res = await server.inject({ method: 'GET', url: '/api/v1/system/info' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      version: APP_VERSION,
      node: process.version,
      dialect: null,
    });
  });
});

describe('request id', () => {
  it('sets a generated req_-prefixed x-request-id on success responses', async () => {
    const server = await build();
    const res = await server.inject({ method: 'GET', url: '/api/v1/healthz' });
    expect(res.headers['x-request-id']).toMatch(REQUEST_ID_PATTERN);
  });

  it('sets the same-format id on error responses and embeds it in the envelope', async () => {
    const server = await build();
    const res = await server.inject({ method: 'GET', url: '/api/v1/definitely-missing' });
    const requestId = res.headers['x-request-id'];
    expect(requestId).toMatch(REQUEST_ID_PATTERN);
    expect(res.json<{ error: { requestId: string } }>().error.requestId).toBe(requestId);
  });

  it('ignores an inbound x-request-id when not behind a trusted proxy (default)', async () => {
    const server = await build();
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/healthz',
      headers: { 'x-request-id': 'req_deadbeef' },
    });
    expect(res.headers['x-request-id']).toMatch(REQUEST_ID_PATTERN);
    expect(res.headers['x-request-id']).not.toBe('req_deadbeef');
  });

  it('honors an inbound x-request-id when ADMINIUM_TRUST_PROXY is on', async () => {
    const server = await build({ ADMINIUM_TRUST_PROXY: 'on' });
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/healthz',
      headers: { 'x-request-id': 'req_deadbeef' },
    });
    expect(res.headers['x-request-id']).toBe('req_deadbeef');
  });
});

describe('unknown routes', () => {
  it('returns the §1.4 NOT_FOUND envelope for unknown API routes', async () => {
    const server = await build();
    const res = await server.inject({ method: 'GET', url: '/api/v1/nope' });
    expect(res.statusCode).toBe(404);
    const body = res.json<{ error: { code: string; message: string; requestId: string } }>();
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toContain('/api/v1/nope');
    expect(body.error.requestId).toMatch(REQUEST_ID_PATTERN);
  });

  it('returns the envelope for non-API paths too when no dashboard build is served', async () => {
    const server = await build();
    const res = await server.inject({ method: 'GET', url: '/settings/profile' });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('NOT_FOUND');
  });
});

describe('route schema enforcement (08-server-api.md §1.1)', () => {
  it('refuses an /api route registered without a schema', async () => {
    const server = await build();
    let error: unknown;
    try {
      server.get('/api/v1/no-schema', async () => ({ ok: true }));
      await server.ready();
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeDefined();
    expect(String(error)).toMatch(/without a schema/);
  });

  it('allows schema-less routes outside /api (static, test fixtures)', async () => {
    const server = await build();
    server.get('/internal-probe', async () => ({ ok: true }));
    const res = await server.inject({ method: 'GET', url: '/internal-probe' });
    expect(res.statusCode).toBe(200);
  });
});
