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
      // 11-electron.md §8.2 flags. `smtpConfigured` is false because a server
      // with no meta store has no `email.smtp` setting to read — email genuinely
      // cannot send, so this is the answer, not a fallback.
      runtime: 'self-host',
      smtpConfigured: false,
      networkFeaturesAllowed: true,
      // §8.1's LAN chip. False here for the same reason `runtime` is
      // 'self-host': the flag is env-derived, and only the Electron shell binds
      // `0.0.0.0` (§8.3 applies the toggle by re-forking the child). This stays
      // an exact-equality assertion on purpose — it is what caught this field
      // arriving unannounced, and an unannounced field on an unauthenticated
      // route is exactly what should have to be spelled out here.
      lanShare: false,
      // §6 step 2 card 4: can this build seed the demo database? False for a
      // third time for the same reason — it is env-derived, and both halves of
      // the condition (desktop runtime AND a seed script) fail on self-host.
      // Spelled out because this assertion caught it too, which is the point.
      desktopDemo: false,
    });
  });

  it('reports desktopDemo:true only when the shell also named a seed script', async () => {
    // BOTH halves, because the wizard gates its fourth source card on this and
    // `compose.ts` gates the ROUTE on the same predicate (`desktop/demo-seed.ts`).
    // A flag that said `true` on a desktop build with no script would offer a
    // card whose button 404s — §8.2's "never hide, always explain" inverted.
    const withoutScript = await build({ ADMINIUM_RUNTIME: 'desktop' });
    const off = await withoutScript.inject({ method: 'GET', url: '/api/v1/system/info' });
    expect(off.json<{ desktopDemo: boolean }>().desktopDemo).toBe(false);

    const withScript = await build({
      ADMINIUM_RUNTIME: 'desktop',
      ADMINIUM_DEMO_SEED_SCRIPT: '/app/resources/demo/demo-seed.mjs',
    });
    const on = await withScript.inject({ method: 'GET', url: '/api/v1/system/info' });
    expect(on.json<{ desktopDemo: boolean }>().desktopDemo).toBe(true);
  });

  it('never reports desktopDemo:true off the desktop runtime', async () => {
    // A self-host operator who happens to set the variable does not get a demo
    // route (`compose.ts` requires the runtime too), so the flag must not claim
    // one exists.
    const server = await build({ ADMINIUM_DEMO_SEED_SCRIPT: '/app/resources/demo/demo-seed.mjs' });
    const res = await server.inject({ method: 'GET', url: '/api/v1/system/info' });
    expect(res.json<{ desktopDemo: boolean }>().desktopDemo).toBe(false);
  });

  it('reports the desktop runtime the Electron shell booted it with (§4)', async () => {
    const server = await build({ ADMINIUM_RUNTIME: 'desktop' });
    const res = await server.inject({ method: 'GET', url: '/api/v1/system/info' });
    expect(res.json<{ runtime: string }>().runtime).toBe('desktop');
  });

  it('reports networkFeaturesAllowed:false when the operator air-gapped the install', async () => {
    const server = await build({ ADMINIUM_NETWORK_FEATURES: 'off' });
    const res = await server.inject({ method: 'GET', url: '/api/v1/system/info' });
    expect(res.json<{ networkFeaturesAllowed: boolean }>().networkFeaturesAllowed).toBe(false);
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
