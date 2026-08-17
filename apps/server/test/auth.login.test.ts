// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Login/session/logout happy path + uniform credential failures + audit rows
 * (08-server-api.md §2.1) and the 503 META_NOT_CONFIGURED boot-without-meta
 * behavior.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { auditRepo } from '@adminium/meta';

import { buildServer } from '../src/app.js';
import { makeEnv } from './helpers.js';
import {
  ADMIN_EMAIL,
  ADMIN_NAME,
  buildAuthApp,
  login,
  type AuthTestApp,
} from './auth-helpers.js';

let fixture: AuthTestApp | undefined;

afterEach(async () => {
  await fixture?.destroy();
  fixture = undefined;
});

describe('POST /auth/login → GET /auth/session → POST /auth/logout', () => {
  it('logs in, sets a signed httpOnly Lax cookie, and serves the session', async () => {
    fixture = await buildAuthApp();
    const { res, cookie } = await login(fixture.app);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      data: { user: { email: ADMIN_EMAIL, name: ADMIN_NAME, status: 'active', totpEnabled: false } },
    });
    // No secret material in the reply (§7 item 6).
    expect(res.body).not.toContain('passwordHash');

    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toContain('adminium_session=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).not.toContain('Secure'); // inject is plain http

    const session = await fixture.app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie: cookie ?? '' },
    });
    expect(session.statusCode).toBe(200);
    expect(session.json()).toMatchObject({
      data: { user: { email: ADMIN_EMAIL }, roles: ['super-admin'] },
    });

    const entries = await auditRepo(fixture.meta).list({ category: 'auth' });
    expect(entries.map((entry) => entry.action)).toContain('login');
  });

  it('stores only a token hash — the cookie value never appears in the DB', async () => {
    fixture = await buildAuthApp();
    const { cookie } = await login(fixture.app);
    const token = (cookie ?? '').split('=').slice(1).join('=');
    const rows = await fixture.meta.db.selectFrom('adminium_sessions').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(token).not.toContain(rows[0]?.tokenHash ?? 'nope');
  });

  it('fails with the same generic 401 for wrong password and unknown email, and audits it', async () => {
    fixture = await buildAuthApp();

    const wrongPassword = await login(fixture.app, ADMIN_EMAIL, 'not-the-password');
    expect(wrongPassword.res.statusCode).toBe(401);
    const wrongBody = wrongPassword.res.json() as { error: { code: string; message: string } };
    expect(wrongBody.error.code).toBe('INVALID_CREDENTIALS');

    const unknownEmail = await login(fixture.app, 'nobody@example.com', 'whatever-password');
    expect(unknownEmail.res.statusCode).toBe(401);
    const unknownBody = unknownEmail.res.json() as { error: { code: string; message: string } };
    // Identical code and message — no user enumeration.
    expect(unknownBody.error.code).toBe(wrongBody.error.code);
    expect(unknownBody.error.message).toBe(wrongBody.error.message);

    const entries = await auditRepo(fixture.meta).list({ category: 'auth' });
    const failed = entries.filter((entry) => entry.action === 'login_failed');
    expect(failed).toHaveLength(2);
    expect(failed.some((entry) => entry.actorId === fixture?.admin.id)).toBe(true);
  });

  it('spends comparable argon2 work for an unknown email (no timing enumeration)', async () => {
    // Security review 2026-07-23: before the decoy-hash path, a non-existent
    // account skipped verifyPassword and returned in ~1 ms while a real account
    // paid the full argon2 cost — a latency oracle for enumerating valid
    // emails. Both paths now run argon2, so their timings are comparable. A
    // ratio (not an absolute floor) keeps this robust across machine speeds.
    fixture = await buildAuthApp();
    // Warm the module-level decoy hash so neither measurement includes it.
    await login(fixture.app, 'warm@example.com', 'x');

    const t0 = performance.now();
    await login(fixture.app, ADMIN_EMAIL, 'not-the-password'); // real account, argon2 runs
    const realMs = performance.now() - t0;

    const t1 = performance.now();
    await login(fixture.app, 'nobody@example.com', 'whatever-password'); // unknown, decoy argon2
    const unknownMs = performance.now() - t1;

    // The unknown path must not be an order of magnitude faster (it was ~2% of
    // the real path before the fix); comparable now that both hash.
    expect(unknownMs).toBeGreaterThan(realMs * 0.25);
  });

  it('logout revokes the session, clears the cookie, and audits', async () => {
    fixture = await buildAuthApp();
    const { cookie } = await login(fixture.app);

    const logout = await fixture.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: cookie ?? '' },
    });
    expect(logout.statusCode).toBe(200);
    expect(String(logout.headers['set-cookie'])).toContain('adminium_session=;');

    // The revoked token no longer authenticates → UNAUTHENTICATED, not expired.
    const after = await fixture.app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie: cookie ?? '' },
    });
    expect(after.statusCode).toBe(401);
    expect((after.json() as { error: { code: string } }).error.code).toBe('UNAUTHENTICATED');

    const rows = await fixture.meta.db.selectFrom('adminium_sessions').selectAll().execute();
    expect(rows.every((row) => row.revokedAt !== null)).toBe(true);

    const entries = await auditRepo(fixture.meta).list({ category: 'auth' });
    expect(entries.map((entry) => entry.action)).toContain('logout');
  });

  it('requires auth for GET /auth/session', async () => {
    fixture = await buildAuthApp();
    const res = await fixture.app.inject({ method: 'GET', url: '/api/v1/auth/session' });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe('UNAUTHENTICATED');
  });

  it('answers 503 META_NOT_CONFIGURED when no meta store is wired', async () => {
    const app = await buildServer({ env: makeEnv(), logger: false });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: ADMIN_EMAIL, password: 'x' },
      });
      expect(res.statusCode).toBe(503);
      expect((res.json() as { error: { code: string } }).error.code).toBe('META_NOT_CONFIGURED');
    } finally {
      await app.close();
    }
  });
});
