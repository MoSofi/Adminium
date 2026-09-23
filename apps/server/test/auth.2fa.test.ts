// SPDX-License-Identifier: AGPL-3.0-only
/**
 * 2FA lifecycle: enroll → activate → login step-up → verify (TOTP and
 * recovery code, single-use), plus disable with password.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { auditRepo } from '@adminium/meta';

import {
  ADMIN_PASSWORD,
  buildAuthApp,
  enable2fa,
  login,
  sessionCookie,
  totpCode,
  type AuthTestApp,
} from './auth-helpers.js';

let fixture: AuthTestApp | undefined;

afterEach(async () => {
  await fixture?.destroy();
  fixture = undefined;
});

describe('2FA enroll → activate → step-up login → verify', () => {
  it('requires a code after enabling 2FA and promotes the challenge to a session', async () => {
    fixture = await buildAuthApp();
    const first = await login(fixture.app);
    const { secret } = await enable2fa(fixture.app, first.cookie ?? '');

    // Secret is encrypted at rest, never stored raw.
    const row = await fixture.meta.db.selectFrom('adminium_users').selectAll().executeTakeFirst();
    expect(row?.totpSecretEncrypted).toMatch(/^enc:v1:/);
    expect(row?.totpSecretEncrypted).not.toContain(secret);

    // Login now returns the 202 challenge instead of a session.
    const stepUp = await login(fixture.app);
    expect(stepUp.res.statusCode).toBe(202);
    const challenge = (
      stepUp.res.json() as { data: { twoFactorRequired: true; challengeToken: string } }
    ).data;
    expect(challenge.twoFactorRequired).toBe(true);
    expect(challenge.challengeToken).toMatch(/^admc_/);
    expect(stepUp.res.headers['set-cookie']).toBeUndefined();

    // A challenge token is not a session token.
    const sneaky = await fixture.app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie: `adminium_session=${challenge.challengeToken}` },
    });
    expect(sneaky.statusCode).toBe(401);

    const verify = await fixture.app.inject({
      method: 'POST',
      url: '/api/v1/auth/2fa/verify',
      payload: { challengeToken: challenge.challengeToken, code: totpCode(secret) },
    });
    expect(verify.statusCode).toBe(200);
    const cookie = sessionCookie(verify.headers['set-cookie']);

    const session = await fixture.app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie },
    });
    expect(session.statusCode).toBe(200);

    const actions = (await auditRepo(fixture.meta).list({ category: 'auth' })).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['2fa_enrolled', '2fa_challenge', 'login']));
  });

  it('rejects a bad code and consumes the challenge token (single-use)', async () => {
    fixture = await buildAuthApp();
    const first = await login(fixture.app);
    const { secret } = await enable2fa(fixture.app, first.cookie ?? '');

    const stepUp = await login(fixture.app);
    const { challengeToken } = (
      stepUp.res.json() as { data: { challengeToken: string } }
    ).data;

    const bad = await fixture.app.inject({
      method: 'POST',
      url: '/api/v1/auth/2fa/verify',
      payload: { challengeToken, code: '000000' },
    });
    expect(bad.statusCode).toBe(401);

    // The challenge was consumed by the first attempt — even a good code fails now.
    const replay = await fixture.app.inject({
      method: 'POST',
      url: '/api/v1/auth/2fa/verify',
      payload: { challengeToken, code: totpCode(secret) },
    });
    expect(replay.statusCode).toBe(401);
  });

  it('accepts a recovery code exactly once', async () => {
    fixture = await buildAuthApp();
    const first = await login(fixture.app);
    const { recoveryCodes } = await enable2fa(fixture.app, first.cookie ?? '');
    const recovery = recoveryCodes[0] ?? '';

    const stepUp1 = await login(fixture.app);
    const token1 = (stepUp1.res.json() as { data: { challengeToken: string } }).data.challengeToken;
    const use = await fixture.app.inject({
      method: 'POST',
      url: '/api/v1/auth/2fa/verify',
      payload: { challengeToken: token1, code: recovery },
    });
    expect(use.statusCode).toBe(200);

    // Same code again on a fresh challenge → rejected (removed from the list).
    const stepUp2 = await login(fixture.app);
    const token2 = (stepUp2.res.json() as { data: { challengeToken: string } }).data.challengeToken;
    const reuse = await fixture.app.inject({
      method: 'POST',
      url: '/api/v1/auth/2fa/verify',
      payload: { challengeToken: token2, code: recovery },
    });
    expect(reuse.statusCode).toBe(401);

    const row = await fixture.meta.db.selectFrom('adminium_users').selectAll().executeTakeFirst();
    const remaining = JSON.parse(String(row?.recoveryCodes)) as string[];
    expect(remaining).toHaveLength(9);
  });

  it('disable requires the password and clears TOTP state', async () => {
    fixture = await buildAuthApp();
    const first = await login(fixture.app);
    const { secret } = await enable2fa(fixture.app, first.cookie ?? '');
    void secret;

    const wrong = await fixture.app.inject({
      method: 'POST',
      url: '/api/v1/auth/2fa/disable',
      headers: { cookie: first.cookie ?? '' },
      payload: { password: 'wrong-password' },
    });
    expect(wrong.statusCode).toBe(401);

    const ok = await fixture.app.inject({
      method: 'POST',
      url: '/api/v1/auth/2fa/disable',
      headers: { cookie: first.cookie ?? '' },
      payload: { password: ADMIN_PASSWORD },
    });
    expect(ok.statusCode).toBe(200);

    const row = await fixture.meta.db.selectFrom('adminium_users').selectAll().executeTakeFirst();
    expect(row?.totpSecretEncrypted).toBeNull();
    expect(row?.recoveryCodes).toBeNull();

    // Plain password login works again.
    const back = await login(fixture.app);
    expect(back.res.statusCode).toBe(200);

    const actions = (await auditRepo(fixture.meta).list({ category: 'auth' })).map((e) => e.action);
    expect(actions).toContain('2fa_disabled');
  });
});
