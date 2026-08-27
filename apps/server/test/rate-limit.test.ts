// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The §6 rate limiter + §7-item-5 security headers (08-server-api.md), both
 * registered by `plugins/core.ts`:
 *
 *  - bucket enforcement per route marker (`config.rateLimitBucket`): the 6th
 *    login in a minute and the 4th forgot in an hour 429 with the §1.4
 *    envelope (`RATE_LIMITED`, `details: { bucket, limit, resetAt }`) and a
 *    `Retry-After` header;
 *  - buckets are shared ACROSS routes (login + 2fa/verify draw down one
 *    budget) and keyed per ip (a flooding LAN peer cannot lock loopback out);
 *  - helmet headers ride on API, static-asset, and SPA-fallback replies, with
 *    the CSP inline-script allowance hashed from the served index.html;
 *  - the composition root registers all of it (the m10-regressions idiom:
 *    drive the real `composeServer`, not a harness that wires its own).
 */
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { createFirstSuperAdmin, createSqliteMetaDb, firstRun, type MetaDb } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { hashPassword } from '../src/auth/passwords.js';
import { composeServer, type ComposedServer } from '../src/compose.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { RATE_BUCKETS } from '../src/plugins/core.js';
import { RATE_LIMIT_BUCKETS } from '../src/routes/auth/index.js';
import { ADMIN_EMAIL, buildAuthApp, type AuthTestApp } from './auth-helpers.js';
import { makeEnv, REQUEST_ID_PATTERN, TEST_SECRET } from './helpers.js';

interface RateLimitedEnvelope {
  error: {
    code: string;
    message: string;
    requestId: string;
    details: { bucket: string; limit: number; resetAt: string };
  };
}

let fixture: AuthTestApp | undefined;

afterEach(async () => {
  await fixture?.destroy();
  fixture = undefined;
});

function badLogin(app: AuthTestApp['app'], remoteAddress?: string) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: ADMIN_EMAIL, password: 'not-the-password' },
    ...(remoteAddress === undefined ? {} : { remoteAddress }),
  });
}

describe('rate limiting — bucket enforcement (08 §6)', () => {
  it('429s the 6th login/min with the RATE_LIMITED envelope and Retry-After', async () => {
    fixture = await buildAuthApp();

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const res = await badLogin(fixture.app);
      expect(res.statusCode, `attempt ${String(attempt)} is under the limit`).toBe(401);
    }

    const limited = await badLogin(fixture.app);
    expect(limited.statusCode).toBe(429);

    const body = limited.json<RateLimitedEnvelope>();
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(body.error.requestId).toMatch(REQUEST_ID_PATTERN);
    expect(body.error.details.bucket).toBe(RATE_LIMIT_BUCKETS.login);
    expect(body.error.details.limit).toBe(5);
    // resetAt is a real instant inside the open window, not a placeholder.
    const resetAt = Date.parse(body.error.details.resetAt);
    expect(resetAt).toBeGreaterThan(Date.now());
    expect(resetAt).toBeLessThanOrEqual(Date.now() + 60_000);

    // The plugin's own headers survive the error-handler round trip.
    const retryAfter = Number(limited.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
    expect(limited.headers['x-ratelimit-limit']).toBeDefined();
  });

  it('shares one bucket across login and 2fa/verify — no per-door budget', async () => {
    fixture = await buildAuthApp();
    for (let attempt = 0; attempt < 5; attempt += 1) await badLogin(fixture.app);

    // Same ip, same `auth-login` bucket ⇒ already exhausted, different route.
    const verify = await fixture.app.inject({
      method: 'POST',
      url: '/api/v1/auth/2fa/verify',
      payload: { challengeToken: 'chal_nope', code: '000000' },
    });
    expect(verify.statusCode).toBe(429);
    expect(verify.json<RateLimitedEnvelope>().error.details.bucket).toBe(
      RATE_LIMIT_BUCKETS.login,
    );
  });

  it('keys per ip — another address still gets its own five tries', async () => {
    fixture = await buildAuthApp();
    for (let attempt = 0; attempt < 6; attempt += 1) await badLogin(fixture.app);
    expect((await badLogin(fixture.app)).statusCode).toBe(429);

    const other = await badLogin(fixture.app, '198.51.100.7');
    expect(other.statusCode).toBe(401);
  });

  it('rotating X-Forwarded-For cannot mint fresh buckets behind the proxy', async () => {
    // THE BYPASS THIS PINS. `trustProxy: true` (a bare boolean) trusts every
    // hop, so request.ip became the LEFT-most, fully client-supplied XFF
    // entry — rotating the header handed an attacker a fresh login bucket per
    // request, voiding §6/§7-item-7 brute-force protection in exactly the
    // documented production mode. With hop count 1, request.ip is the
    // RIGHT-most entry — the one the proxy itself appends — which the client
    // cannot move.
    fixture = await buildAuthApp({ env: makeEnv({ ADMINIUM_TRUST_PROXY: 'on' }) });

    const spoofed = (i: number) =>
      fixture!.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: ADMIN_EMAIL, password: 'not-the-password' },
        // What actually arrives behind Caddy: the attacker's junk on the
        // left, the genuine peer address appended by the proxy on the right.
        headers: { 'x-forwarded-for': `10.0.0.${String(i)}, 198.51.100.7` },
      });

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      expect((await spoofed(attempt)).statusCode, `attempt ${String(attempt)}`).toBe(401);
    }
    const limited = await spoofed(6);
    expect(limited.statusCode).toBe(429);
    expect(limited.json<RateLimitedEnvelope>().error.code).toBe('RATE_LIMITED');
  });

  it('429s the 4th forgot/hour, without touching the login bucket', async () => {
    fixture = await buildAuthApp();

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const res = await fixture.app.inject({
        method: 'POST',
        url: '/api/v1/auth/password/forgot',
        payload: { email: ADMIN_EMAIL },
      });
      expect(res.statusCode, `forgot ${String(attempt)} is under the limit`).toBe(200);
    }

    const limited = await fixture.app.inject({
      method: 'POST',
      url: '/api/v1/auth/password/forgot',
      payload: { email: ADMIN_EMAIL },
    });
    expect(limited.statusCode).toBe(429);
    const body = limited.json<RateLimitedEnvelope>();
    expect(body.error.details.bucket).toBe(RATE_LIMIT_BUCKETS.forgot);
    expect(body.error.details.limit).toBe(3);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(60);

    // Buckets are isolated: exhausting forgot spends nothing from login.
    expect((await badLogin(fixture.app)).statusCode).toBe(401);
  });

  it('429s the 6th reset-token CONSUME/min (§7 item 7 guess-rate cap)', async () => {
    fixture = await buildAuthApp();

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const res = await fixture.app.inject({
        method: 'POST',
        url: '/api/v1/auth/password/reset',
        payload: { token: 'rst_not_a_real_token', newPassword: 'brand-new-password' },
      });
      expect(res.statusCode, `consume ${String(attempt)} is under the limit`).toBe(401);
    }

    const limited = await fixture.app.inject({
      method: 'POST',
      url: '/api/v1/auth/password/reset',
      payload: { token: 'rst_not_a_real_token', newPassword: 'brand-new-password' },
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json<RateLimitedEnvelope>().error.details.bucket).toBe(
      RATE_LIMIT_BUCKETS.reset,
    );
  });

  it('every declared marker resolves against RATE_BUCKETS (boot-time contract)', () => {
    // The onRoute hook throws at registration for unknown buckets; this pins
    // the other direction — the markers routes actually use are all defined.
    for (const bucket of Object.values(RATE_LIMIT_BUCKETS)) {
      expect(RATE_BUCKETS[bucket], `bucket "${bucket}" must be in RATE_BUCKETS`).toBeDefined();
    }
  });
});

describe('security headers (08 §7 item 5)', () => {
  it('serves helmet headers on API replies, without HSTS off-proxy', async () => {
    fixture = await buildAuthApp();
    const res = await fixture.app.inject({ method: 'GET', url: '/api/v1/healthz' });
    expect(res.statusCode).toBe(200);

    const csp = String(res.headers['content-security-policy']);
    expect(csp).toContain("default-src 'self'");
    /*
     * 'self', not 'none' (29-T09). The dashboard frames its own hosted staff
     * surfaces to blend them into the shell; cross-origin framing — the whole
     * clickjacking threat — is still refused. Pinned in both spellings below
     * because a browser honouring `X-Frame-Options: DENY` ignores this
     * directive outright, so the two must never drift apart.
     */
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("object-src 'none'");
    // Basemap tiles (packages/widgets geo-lib CARTO_TILES) must be loadable.
    expect(csp).toContain("img-src 'self' data: blob: https://*.basemaps.cartocdn.com");
    // WebSocket allowance is pinned to the SERVING host, not bare schemes — a
    // scheme source would let an XSS foothold open a socket to any origin.
    expect(csp).toContain("connect-src 'self' ws://localhost:80 wss://localhost:80");
    expect(csp).not.toMatch(/connect-src[^;]*(?:^|\s)wss?:(?:\s|;|$)/);
    // http:// loopback and §8.3 LAN origins must keep working.
    expect(csp).not.toContain('upgrade-insecure-requests');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });

  it('adds HSTS behind a trusted proxy (TLS terminates upstream)', async () => {
    fixture = await buildAuthApp({ env: makeEnv({ ADMINIUM_TRUST_PROXY: 'on' }) });
    const res = await fixture.app.inject({ method: 'GET', url: '/api/v1/healthz' });
    expect(res.headers['strict-transport-security']).toContain('max-age=');
  });

  it('covers static + SPA-fallback replies and hashes the inline script into the CSP', async () => {
    const inline = '(function(){document.documentElement.dataset.theme="dark"})();';
    const dist = await mkdtemp(join(tmpdir(), 'adminium-helmet-'));
    try {
      await writeFile(
        join(dist, 'index.html'),
        `<!doctype html><html><head><script>${inline}</script></head><body>Adminium</body></html>`,
        'utf8',
      );
      fixture = await buildAuthApp({ staticRoot: dist });

      const expectedHash = `'sha256-${createHash('sha256').update(inline, 'utf8').digest('base64')}'`;

      const index = await fixture.app.inject({ method: 'GET', url: '/' });
      expect(index.statusCode).toBe(200);
      const csp = String(index.headers['content-security-policy']);
      expect(csp).toContain("default-src 'self'");
      // The pre-hydration flash guard keeps running under the CSP.
      expect(csp).toContain(`script-src 'self' ${expectedHash}`);
      expect(index.headers['x-content-type-options']).toBe('nosniff');

      // The SPA fallback rides the not-found handler — same headers there.
      const fallback = await fixture.app.inject({ method: 'GET', url: '/settings/profile' });
      expect(fallback.statusCode).toBe(200);
      expect(String(fallback.headers['content-security-policy'])).toContain(expectedHash);
    } finally {
      await rm(dist, { recursive: true, force: true });
    }
  });
});

// ─── Desktop: the boot-token exchange under the limiter (11-electron.md §5) ───

const BOOT_TOKEN = 'a'.repeat(64);

async function composeApp(
  meta: MetaDb,
  envOverrides: Record<string, string> = {},
): Promise<ComposedServer> {
  const storeHandle: MetaStoreHandle = {
    meta,
    url: 'sqlite::memory:',
    engine: 'sqlite',
    source: 'embedded',
    close: async () => Promise.resolve(),
  };
  const manager = new ConnectionManager({
    meta,
    crypto: dsnCryptoFromSecret(TEST_SECRET),
    metaDsn: null,
  });
  const runService = createRunService({ meta });
  const composed = await composeServer({
    env: makeEnv(envOverrides),
    metaStore: storeHandle,
    manager,
    runService,
    applyService: createApplyService({ meta, runService }),
    allowed: null,
    logger: false,
    telemetry: false,
  });
  await composed.app.ready();
  return composed;
}

describe('desktop-session under the limiter', () => {
  it('a LAN flood 429s in the login bucket while loopback stays unaffected', async () => {
    const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    await createFirstSuperAdmin(meta, {
      email: 'ava@adminium.test',
      name: 'Ava',
      passwordHash: await hashPassword('correct-horse-battery'),
    });
    const { app } = await composeApp(meta, {
      ADMINIUM_RUNTIME: 'desktop',
      ADMINIUM_BOOT_TOKEN: BOOT_TOKEN,
      ADMINIUM_DESKTOP_SINGLE_USER: 'on',
    });
    try {
      const exchange = (remoteAddress: string) =>
        app.inject({
          method: 'POST',
          url: '/api/v1/auth/desktop-session',
          payload: { bootToken: 'f'.repeat(64) },
          remoteAddress,
        });

      // Five LAN probes burn the LAN peer's own budget (gate 2 rejects each)…
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        expect((await exchange('192.168.1.20')).statusCode, `probe ${String(attempt)}`).toBe(403);
      }
      const flooded = await exchange('192.168.1.20');
      expect(flooded.statusCode).toBe(429);
      expect(flooded.json<RateLimitedEnvelope>().error.details.bucket).toBe(
        RATE_LIMIT_BUCKETS.login,
      );

      // …and the loopback exchange the shell actually makes still works: the
      // key is per-ip, so the flood spent nothing from 127.0.0.1.
      const loopback = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/desktop-session',
        payload: { bootToken: BOOT_TOKEN },
      });
      expect(loopback.statusCode).toBe(200);
    } finally {
      await app.close();
      await meta.db.destroy();
    }
  });
});

describe('composition root registers the limiter + helmet (m10-regressions idiom)', () => {
  it('composeServer enforces buckets and serves the headers', async () => {
    const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    const { app } = await composeApp(meta);
    try {
      // The plugin is REGISTERED (decoration present)…
      expect(app.hasDecorator('rateLimit')).toBe(true);

      // …and live: the composed server, not a harness, 429s the 6th login.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { email: 'nobody@example.com', password: 'wrong-password' },
        });
        expect(res.statusCode).toBe(401);
      }
      const limited = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'nobody@example.com', password: 'wrong-password' },
      });
      expect(limited.statusCode).toBe(429);
      expect(limited.json<RateLimitedEnvelope>().error.code).toBe('RATE_LIMITED');

      // Helmet rides every composed reply too.
      const health = await app.inject({ method: 'GET', url: '/api/v1/healthz' });
      expect(String(health.headers['content-security-policy'])).toContain("default-src 'self'");
    } finally {
      await app.close();
      await meta.db.destroy();
    }
  });
});
