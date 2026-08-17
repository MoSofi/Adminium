// SPDX-License-Identifier: AGPL-3.0-only
/**
 * CSRF — the active legs (08-server-api.md §7 item 4, `security/csrf.ts` +
 * the `preValidation` hook in `plugins/core.ts`).
 *
 * What this pins, in the order the module reasons about it:
 *
 *  - the ATTACK is real without the check: Fastify's default `text/plain`
 *    parser means a cross-site `<form enctype="text/plain">` POST reaches
 *    routes with no body schema. `POST /auth/logout` is that shape;
 *  - the Origin leg, including `Sec-Fetch-Site: same-site` — the
 *    sibling-subdomain case `SameSite=Lax` waves through, which is exactly
 *    the shape a `*.adminium.app` tenant deployment is exposed to;
 *  - the token leg: issued by `/bootstrap`, bound to THAT session, refused
 *    when absent, wrong, or minted for a different session;
 *  - every exemption, because getting one wrong breaks the product rather
 *    than the security: bearer API keys, no-session (pre-login) requests,
 *    safe methods, `config.csrf: 'exempt'`, and the documented
 *    no-browser-provenance carve-out the desktop and CLI callers ride on.
 */
import type { AddressInfo } from 'node:net';

import fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { corePlugin } from '../src/plugins/core.js';
import { registerWsRoute } from '../src/realtime/ws.js';
import {
  allowedOriginHosts,
  classifyOrigin,
  csrfSigningKey,
  issueCsrfToken,
  CSRF_HEADER,
} from '../src/security/csrf.js';
import { buildAuthApp, login, type AuthTestApp } from './auth-helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';
import { buildBareApp, makeJobsContext, makeStubAuth, type BareApp } from './jobs-helpers.js';

// Same self-skip as realtime-ws.test.ts: the ws packages are optional deps of
// the realtime wave, and the suite auto-activates once they are installed.
const websocketPlugin = await import('@fastify/websocket').then(
  (m) => m.default,
  () => null,
);
const wsLib = await import('ws').then(
  (m) => m,
  () => null,
);

let fixture: AuthTestApp | undefined;

afterEach(async () => {
  await fixture?.destroy();
  fixture = undefined;
});

/** Signs in on an existing fixture and reads the token `/bootstrap` issues. */
async function tokenFor(app: AuthTestApp['app']): Promise<{ cookie: string; token: string }> {
  const { cookie } = await login(app);
  expect(cookie).not.toBeNull();
  const boot = await app.inject({
    method: 'GET',
    url: '/api/v1/bootstrap',
    headers: { cookie: cookie ?? '' },
  });
  expect(boot.statusCode).toBe(200);
  return {
    cookie: cookie ?? '',
    token: boot.json<{ data: { csrfToken: string } }>().data.csrfToken,
  };
}

/** A signed-in browser session plus the token `/bootstrap` handed it. */
async function browserSession(): Promise<{ cookie: string; token: string }> {
  fixture = await buildAuthApp();
  return tokenFor(fixture.app);
}

/** The dashboard's own origin under `app.inject` (Host defaults to localhost:80). */
const SAME_ORIGIN = 'http://localhost';

describe('CSRF — the Origin leg (08 §7 item 4)', () => {
  it('refuses the text/plain form POST that SameSite=Lax is the only guard against', async () => {
    const { cookie } = await browserSession();

    // Exactly what an attacker's page can emit with no preflight: a form
    // post, a garbage body Fastify's default parser still accepts, and a
    // route (`/auth/logout`) with no body schema to reject it.
    const forged = await fixture!.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: {
        cookie,
        origin: 'https://evil.example',
        'sec-fetch-site': 'cross-site',
        'content-type': 'text/plain',
      },
      payload: 'not-json-and-it-does-not-matter',
    });

    expect(forged.statusCode).toBe(403);
    expect(forged.json().error.code).toBe('CSRF_FAILED');

    // …and the session it tried to destroy is still alive.
    const session = await fixture!.app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie },
    });
    expect(session.statusCode).toBe(200);
  });

  it('refuses sec-fetch-site: same-site — the sibling subdomain Lax waves through', async () => {
    const { cookie, token } = await browserSession();

    // `evil.adminium.app` → `acme.adminium.app`: the cookie IS attached by
    // the browser, so this leg is the only thing that stops it. A valid token
    // does not help — the attacker cannot read one, but pinning it here keeps
    // the legs independent.
    const res = await fixture!.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: {
        cookie,
        origin: 'https://evil.adminium.app',
        'sec-fetch-site': 'same-site',
        [CSRF_HEADER]: token,
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('CSRF_FAILED');
  });

  it('never leaks WHICH leg failed — the message is the same for origin and token', async () => {
    const { cookie, token } = await browserSession();

    const foreign = await fixture!.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie, origin: 'https://evil.example', [CSRF_HEADER]: token },
    });
    const badToken = await fixture!.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie, origin: SAME_ORIGIN, [CSRF_HEADER]: 'not-the-token' },
    });

    expect(foreign.statusCode).toBe(403);
    expect(badToken.statusCode).toBe(403);
    expect(foreign.json().error.message).toBe(badToken.json().error.message);
  });

  it('trusts an ADMINIUM_CORS_ORIGINS origin — the split deployment still works', async () => {
    fixture = await buildAuthApp({
      env: makeEnv({ ADMINIUM_CORS_ORIGINS: 'https://admin.acme.io' }),
    });
    const { cookie, token } = await tokenFor(fixture.app);

    const res = await fixture.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: {
        cookie,
        origin: 'https://admin.acme.io',
        // A legitimately cross-origin dashboard reports cross-site; the
        // allowlist has to win over the fetch-metadata veto or CORS and CSRF
        // would contradict each other.
        'sec-fetch-site': 'cross-site',
        [CSRF_HEADER]: token,
      },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('CSRF — the token leg', () => {
  it('issues a session-bound token on /bootstrap and accepts it back', async () => {
    const { cookie, token } = await browserSession();
    expect(token).toMatch(/^[\w-]{43}$/);
    // It is the HMAC of THIS session's id — nothing is stored, so there is no
    // second expiry to reason about and no row to leak.
    const row = await fixture!.meta.db
      .selectFrom('adminium_sessions')
      .select('id')
      .where('revokedAt', 'is', null)
      .executeTakeFirstOrThrow();
    expect(token).toBe(issueCsrfToken(csrfSigningKey(TEST_SECRET), row.id));

    const res = await fixture!.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie, origin: SAME_ORIGIN, 'sec-fetch-site': 'same-origin', [CSRF_HEADER]: token },
    });
    expect(res.statusCode).toBe(200);
  });

  it('refuses a same-origin browser mutation with no token at all', async () => {
    const { cookie } = await browserSession();
    const res = await fixture!.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie, origin: SAME_ORIGIN, 'sec-fetch-site': 'same-origin' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('CSRF_FAILED');
  });

  it("refuses another session's token — the binding is not decorative", async () => {
    const { cookie } = await browserSession();
    // A second sign-in mints a second session; its token must not travel.
    const { token: otherToken } = await tokenFor(fixture!.app);

    const res = await fixture!.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie, origin: SAME_ORIGIN, [CSRF_HEADER]: otherToken },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('CSRF_FAILED');
  });

  it('leaves GET alone — a safe method is never checked', async () => {
    const { cookie } = await browserSession();
    const res = await fixture!.app.inject({
      method: 'GET',
      url: '/api/v1/auth/sessions',
      headers: { cookie, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
    });
    // Foreign origin, no token, still 200: GETs change nothing, and CORS is
    // what stops the attacker READING this reply.
    expect(res.statusCode).toBe(200);
  });
});

describe('CSRF — the exemptions (breaking these breaks the product)', () => {
  it('never asks a bearer API key for a token', async () => {
    const { cookie } = await browserSession();
    // A browser never attaches `Authorization` ambiently, so a key-bearing
    // request cannot be ridden. The header is the test — `apiKeyPrincipal`
    // does not exist on buildServer's routes.
    const res = await fixture!.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: {
        cookie,
        origin: 'https://evil.example',
        authorization: `Bearer adm_sk_${'x'.repeat(40)}`,
      },
    });
    // Not 403: the CSRF hook stood aside. (The key itself is bogus, so the
    // route's own auth is what answers.)
    expect(res.statusCode).not.toBe(403);
  });

  it('never asks a pre-login request for a token — there is no session to bind to', async () => {
    fixture = await buildAuthApp();
    const res = await fixture.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
      payload: { email: 'nobody@example.com', password: 'wrong-password' },
    });
    // 401, not 403: `/auth/login` and `/setup/*` cannot carry a session-bound
    // token because there is no session yet, and there is nothing to forge.
    expect(res.statusCode).toBe(401);
  });

  it('lets a caller with NO browser provenance through (the documented carve-out)', async () => {
    const { cookie } = await browserSession();
    // The Electron main process, curl, a fleet script: cookie, no Origin, no
    // Referer, no Sec-Fetch-*. No browser can produce this shape on a POST,
    // so it is outside the threat model — see security/csrf.ts.
    const res = await fixture!.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
  });

  it("honours config.csrf: 'exempt' on a route", async () => {
    // A probe registered with the marker is skipped even when the token is
    // deliberately wrong; the identically-shaped unmarked probe is not. This
    // is the mechanism `POST /desktop/backup` relies on. Routes go on before
    // the first inject — Fastify refuses them once the instance is listening.
    fixture = await buildAuthApp();
    const app = fixture.app;
    app.post('/probe/exempt', { config: { csrf: 'exempt' } }, async () => ({ ok: true }));
    app.post('/probe/guarded', async () => ({ ok: true }));
    const { cookie } = await tokenFor(app);

    const headers = { cookie, origin: SAME_ORIGIN, [CSRF_HEADER]: 'wrong' };
    expect((await app.inject({ method: 'POST', url: '/probe/exempt', headers })).statusCode).toBe(
      200,
    );
    expect((await app.inject({ method: 'POST', url: '/probe/guarded', headers })).statusCode).toBe(
      403,
    );
  });
});

describe('classifyOrigin (unit)', () => {
  const allowed = allowedOriginHosts(['https://admin.acme.io']);
  const probe = (headers: Record<string, string>) => classifyOrigin({ headers }, allowed);

  it('reads the expected origin off the request Host, as the CSP already does', () => {
    expect(probe({ host: 'panel.example', origin: 'https://panel.example' })).toBe('trusted');
    expect(probe({ host: 'panel.example', origin: 'https://other.example' })).toBe('foreign');
    // Port is part of the host — a LAN share on :7788 is not :7789.
    expect(probe({ host: 'localhost:7788', origin: 'http://localhost:7788' })).toBe('trusted');
    expect(probe({ host: 'localhost:7788', origin: 'http://localhost:7789' })).toBe('foreign');
  });

  it('treats an opaque origin as foreign', () => {
    // Sandboxed iframes and `data:` documents send this; nothing legitimate does.
    expect(probe({ host: 'panel.example', origin: 'null' })).toBe('foreign');
    expect(probe({ host: 'panel.example', origin: 'not a url' })).toBe('foreign');
  });

  it('lets fetch metadata veto a matching host (scheme/port confusion)', () => {
    expect(
      probe({ host: 'panel.example', origin: 'https://panel.example', 'sec-fetch-site': 'same-site' }),
    ).toBe('foreign');
    expect(probe({ host: 'panel.example', 'sec-fetch-site': 'same-origin' })).toBe('trusted');
    // `none` = the user typed the URL / a bookmark — not a cross-site request.
    expect(probe({ host: 'panel.example', 'sec-fetch-site': 'none' })).toBe('trusted');
  });

  it('falls back to Referer, then reports absence', () => {
    expect(probe({ host: 'panel.example', referer: 'https://panel.example/p/orders' })).toBe(
      'trusted',
    );
    expect(probe({ host: 'panel.example', referer: 'https://evil.example/x' })).toBe('foreign');
    expect(probe({ host: 'panel.example' })).toBe('absent');
  });
});

// ─── The WebSocket upgrade (realtime/ws.ts) ──────────────────────────────────

/**
 * The leg that matters most. `/ws` hangs off the ROOT app, not `/api/v1`, and
 * an upgrade is a GET — so the prefix-scoped, mutation-only hook in
 * `plugins/core.ts` never sees it, `SameSite=Lax` allows it by design, and
 * CORS does not apply to WebSockets at all. Without this check any page could
 * open an authenticated socket in a visitor's browser and subscribe to every
 * channel their session can read.
 */
describe.skipIf(websocketPlugin === null || wsLib === null)('the /ws upgrade origin check', () => {
  if (websocketPlugin === null || wsLib === null) return;
  const WebSocketClient = wsLib.WebSocket;

  let gateways: BareApp[] = [];
  let sockets: InstanceType<typeof WebSocketClient>[] = [];

  afterEach(async () => {
    for (const socket of sockets) socket.terminate();
    sockets = [];
    await Promise.all(gateways.map(async (app) => app.close()));
    gateways = [];
  });

  async function makeGateway(): Promise<{ port: number; headers: Record<string, string> }> {
    const ctx = await makeJobsContext();
    const auth = makeStubAuth();
    const app = buildBareApp();
    await app.register(websocketPlugin!);
    registerWsRoute(app, {
      hub: ctx.hub,
      resolveUser: auth.resolveUser,
      can: auth.can,
      getJobOwner: async () => null,
      heartbeatIntervalMs: 60_000,
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    gateways.push(app);
    return { port: (app.server.address() as AddressInfo).port, headers: auth.as('user_owner') };
  }

  /** Resolves with the handshake status, or 0 when the socket opened. */
  async function handshake(port: number, headers: Record<string, string>): Promise<number> {
    const socket = new WebSocketClient(`ws://127.0.0.1:${port}/ws`, { headers });
    socket.on('error', () => {}); // rejection always emits 'error' afterwards
    sockets.push(socket);
    return await new Promise<number>((resolve) => {
      socket.once('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      socket.once('open', () => resolve(0));
    });
  }

  it('refuses a foreign-origin upgrade with CSRF_FAILED, before resolving the session', async () => {
    const { port, headers } = await makeGateway();
    const status = await handshake(port, {
      ...headers,
      origin: 'https://evil.example',
    });
    expect(status).toBe(403);
  });

  it('refuses a same-SITE upgrade — the sibling-subdomain hole again', async () => {
    const { port, headers } = await makeGateway();
    const status = await handshake(port, {
      ...headers,
      // The tenant case: the browser attaches the cookie, so only Origin says no.
      origin: `http://evil.adminium.app`,
    });
    expect(status).toBe(403);
  });

  it('accepts the dashboard’s own origin, and a non-browser client with none', async () => {
    const { port, headers } = await makeGateway();
    expect(await handshake(port, { ...headers, origin: `http://127.0.0.1:${String(port)}` })).toBe(
      0,
    );
    // No Origin at all: the CLI/test/service shape. RFC 6455 requires browsers
    // to send one, so an absent Origin is not a browser.
    expect(await handshake(port, headers)).toBe(0);
  });

  it('rejects the foreign origin BEFORE authentication (no session oracle)', async () => {
    const { port } = await makeGateway();
    // No stub-user header ⇒ this would be a 401 on the auth leg. It is 403,
    // which means a foreign page cannot use the status code to learn whether
    // the visitor is signed in.
    expect(await handshake(port, { origin: 'https://evil.example' })).toBe(403);
  });
});

describe('the csrfOrigins decoration', () => {
  it('is corePlugin’s CORS allowlist, so the socket and the HTTP hook agree', async () => {
    // A split deployment must not get a dashboard that loads over CORS and a
    // realtime channel that silently never connects.
    const app = fastify({ logger: false });
    try {
      await app.register(corePlugin, {
        env: makeEnv({ ADMINIUM_CORS_ORIGINS: 'https://admin.acme.io' }),
      });
      await app.ready();
      expect([...app.csrfOrigins]).toEqual(['admin.acme.io']);
    } finally {
      await app.close();
    }
  });
});
