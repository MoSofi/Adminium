// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Password forgot/reset: the forgot endpoint always answers 200 (no user
 * enumeration), tokens are single-use and expire, and a successful reset
 * revokes every existing session.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { auditRepo, usersRepo } from '@adminium/meta';

import type { PasswordResetDelivery } from '../src/plugins/auth.js';
import { hashPassword } from '../src/auth/passwords.js';
import { RESET_TOKEN_TTL_MS } from '../src/auth/sessions.js';
import { mintInvite, type MintedInvite } from '../src/routes/users/invite.js';
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

    // Every pre-reset session is revoked — cookies stop working.
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

describe('an invitation link and the account it was for', () => {
  const EMAIL = 'noa@example.com';
  const invited = async (meta: AuthTestApp['meta']) =>
    usersRepo(meta).create({ email: EMAIL, name: 'Noa', passwordHash: null, status: 'invited' });
  const tokenOf = (invite: MintedInvite) => invite.token;

  it('refuses an invite link once the account is active, and leaves its password alone', async () => {
    fixture = await buildAuthApp();
    const user = await invited(fixture.meta);
    const stale = tokenOf(await mintInvite(fixture.meta, user.id));
    await usersRepo(fixture.meta).updatePassword(user.id, await hashPassword('the-real-password-1'));
    await usersRepo(fixture.meta).updateStatus(user.id, 'active');

    const res = await reset(fixture.app, stale, 'taken-over-password-2');

    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe('INVALID_CREDENTIALS');
    expect((await login(fixture.app, EMAIL, 'the-real-password-1')).res.statusCode).toBe(200);
    expect((await login(fixture.app, EMAIL, 'taken-over-password-2')).res.statusCode).toBe(401);
  });

  it('a resent invitation kills the first link', async () => {
    fixture = await buildAuthApp();
    const user = await invited(fixture.meta);
    const first = tokenOf(await mintInvite(fixture.meta, user.id));
    const second = tokenOf(await mintInvite(fixture.meta, user.id));

    expect((await reset(fixture.app, first, 'from-the-lost-link-1')).statusCode).toBe(401);
    expect((await reset(fixture.app, second, 'from-the-new-link-2')).statusCode).toBe(200);
    expect((await login(fixture.app, EMAIL, 'from-the-new-link-2')).res.statusCode).toBe(200);
  });

  it('using one link kills the person\'s other links', async () => {
    const deliveries: PasswordResetDelivery[] = [];
    fixture = await buildAuthApp({ onPasswordResetToken: (d) => deliveries.push(d) });
    const user = await invited(fixture.meta);
    const invite = tokenOf(await mintInvite(fixture.meta, user.id));
    await forgot(fixture.app, EMAIL);
    const mailed = deliveries[0]?.token ?? '';

    expect((await reset(fixture.app, invite, 'set-from-invite-1')).statusCode).toBe(200);
    expect((await reset(fixture.app, mailed, 'set-from-mailed-2')).statusCode).toBe(401);
    expect((await login(fixture.app, EMAIL, 'set-from-invite-1')).res.statusCode).toBe(200);
  });

  it('a stranger on the forgot form cannot kill somebody\'s invitation', async () => {
    fixture = await buildAuthApp();
    const user = await invited(fixture.meta);
    const invite = tokenOf(await mintInvite(fixture.meta, user.id));

    await forgot(fixture.app, EMAIL);

    expect((await reset(fixture.app, invite, 'still-my-invite-1')).statusCode).toBe(200);
    expect((await usersRepo(fixture.meta).findById(user.id))?.status).toBe('active');
  });

  it('a refused stale invite does not cost the person their live reset link', async () => {
    const deliveries: PasswordResetDelivery[] = [];
    fixture = await buildAuthApp({ onPasswordResetToken: (d) => deliveries.push(d) });
    const user = await invited(fixture.meta);
    const stale = tokenOf(await mintInvite(fixture.meta, user.id));
    await usersRepo(fixture.meta).updatePassword(user.id, await hashPassword('the-real-password-1'));
    await usersRepo(fixture.meta).updateStatus(user.id, 'active');
    await forgot(fixture.app, EMAIL);

    expect((await reset(fixture.app, stale, 'taken-over-password-2')).statusCode).toBe(401);
    expect((await reset(fixture.app, deliveries[0]?.token ?? '', 'my-own-reset-3')).statusCode).toBe(200);
    expect((await login(fixture.app, EMAIL, 'my-own-reset-3')).res.statusCode).toBe(200);
  });
});
