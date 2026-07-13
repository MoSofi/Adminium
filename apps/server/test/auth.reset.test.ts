/**
 * Password forgot/reset (08-server-api.md §2.1): the forgot endpoint always
 * answers 200 (no user enumeration), tokens are single-use and expire, and a
 * successful reset revokes every existing session.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { auditRepo } from '@adminium/meta';

import type { PasswordResetDelivery } from '../src/plugins/auth.js';
import { RESET_TOKEN_TTL_MS } from '../src/auth/sessions.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD, buildAuthApp, login, type AuthTestApp } from './auth-helpers.js';

let fixture: AuthTestApp | undefined;

afterEach(async () => {
  vi.useRealTimers();
  await fixture?.destroy();
  fixture = undefined;
});

async function forgot(app: AuthTestApp['app'], email: string) {
  return app.inject({ method: 'POST', url: '/api/v1/auth/password/forgot', payload: { email } });
}

async function reset(app: AuthTestApp['app'], token: string, newPassword: string) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/password/reset',
    payload: { token, newPassword },
  });
}

describe('POST /auth/password/forgot + /auth/password/reset', () => {
  it('answers 200 for unknown emails without creating a reset or delivering anything', async () => {
    const deliveries: PasswordResetDelivery[] = [];
    fixture = await buildAuthApp({ onPasswordResetToken: (d) => deliveries.push(d) });

    const res = await forgot(fixture.app, 'nobody@example.com');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: { ok: true } });
    expect(deliveries).toHaveLength(0);

    const rows = await fixture.meta.db.selectFrom('adminium_password_resets').selectAll().execute();
    expect(rows).toHaveLength(0);
  });

  it('creates a hashed single-use token for a known email and hands the plaintext to the hook', async () => {
    const deliveries: PasswordResetDelivery[] = [];
    fixture = await buildAuthApp({ onPasswordResetToken: (d) => deliveries.push(d) });

    const res = await forgot(fixture.app, ADMIN_EMAIL);
    expect(res.statusCode).toBe(200);
    expect(deliveries).toHaveLength(1);
    const delivery = deliveries[0];
    expect(delivery?.email).toBe(ADMIN_EMAIL);
    expect(delivery?.token).toMatch(/^admr_/);

    // Only the SHA-256 hash lands at rest — never the plaintext token.
    const rows = await fixture.meta.db.selectFrom('adminium_password_resets').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(delivery?.token).not.toContain(rows[0]?.tokenHash ?? 'nope');

    const actions = (await auditRepo(fixture.meta).list({ category: 'auth' })).map((e) => e.action);
    expect(actions).toContain('password_reset_requested');
  });

  it('resets the password, revokes every session, and burns the token', async () => {
    const deliveries: PasswordResetDelivery[] = [];
    fixture = await buildAuthApp({ onPasswordResetToken: (d) => deliveries.push(d) });

    // Two live sessions before the reset.
    const one = await login(fixture.app);
    const two = await login(fixture.app);
    expect(one.res.statusCode).toBe(200);
    expect(two.res.statusCode).toBe(200);

    await forgot(fixture.app, ADMIN_EMAIL);
    const token = deliveries[0]?.token ?? '';

    const newPassword = 'brand-new-passphrase-42';
    const ok = await reset(fixture.app, token, newPassword);
    expect(ok.statusCode).toBe(200);

    // Every pre-reset session is revoked (§7 item 7) — cookies stop working.
    for (const cookie of [one.cookie, two.cookie]) {
      const after = await fixture.app.inject({
        method: 'GET',
        url: '/api/v1/auth/session',
        headers: { cookie: cookie ?? '' },
      });
      expect(after.statusCode).toBe(401);
      expect((after.json() as { error: { code: string } }).error.code).toBe('UNAUTHENTICATED');
    }

    // Old password out, new password in.
    const oldLogin = await login(fixture.app, ADMIN_EMAIL, ADMIN_PASSWORD);
    expect(oldLogin.res.statusCode).toBe(401);
    const newLogin = await login(fixture.app, ADMIN_EMAIL, newPassword);
    expect(newLogin.res.statusCode).toBe(200);

    // Single-use: replaying the same token fails.
    const replay = await reset(fixture.app, token, 'another-password-99');
    expect(replay.statusCode).toBe(401);
    expect((replay.json() as { error: { code: string } }).error.code).toBe('INVALID_CREDENTIALS');

    const actions = (await auditRepo(fixture.meta).list({ category: 'auth' })).map((e) => e.action);
    expect(actions).toContain('password_reset');
  });

  it('rejects expired tokens (30-minute TTL)', async () => {
    const deliveries: PasswordResetDelivery[] = [];
    fixture = await buildAuthApp({ onPasswordResetToken: (d) => deliveries.push(d) });

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-12T12:00:00Z'));

    await forgot(fixture.app, ADMIN_EMAIL);
    const token = deliveries[0]?.token ?? '';

    vi.setSystemTime(new Date(Date.now() + RESET_TOKEN_TTL_MS + 1_000));
    const late = await reset(fixture.app, token, 'too-late-password-1');
    expect(late.statusCode).toBe(401);
    expect((late.json() as { error: { code: string } }).error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects garbage tokens with the same generic 401', async () => {
    fixture = await buildAuthApp();
    const res = await reset(fixture.app, 'admr_definitely-not-a-real-token', 'whatever-password');
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe('INVALID_CREDENTIALS');
  });
});
