// SPDX-License-Identifier: AGPL-3.0-only
/**
 * 2FA lifecycle (08-server-api.md §2.1): enroll → activate → login step-up →
 * verify (TOTP and recovery code, single-use), plus disable with password.
 */
import * as OTPAuth from 'otpauth';
import { afterEach, describe, expect, it } from 'vitest';
import { auditRepo } from '@adminium/meta';

import {
  ADMIN_PASSWORD,
  buildAuthApp,
  login,
  sessionCookie,
  type AuthTestApp,
} from './auth-helpers.js';

let fixture: AuthTestApp | undefined;

afterEach(async () => {
  await fixture?.destroy();
  fixture = undefined;
});

function totpCode(secretBase32: string): string {
  return new OTPAuth.TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  }).generate();
}

/** enroll + activate for the signed-in admin; returns secret + recovery codes. */
async function enable2fa(app: AuthTestApp['app'], cookie: string) {
  const enroll = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/2fa/enroll',
    headers: { cookie },
  });
  expect(enroll.statusCode).toBe(200);
  const { secret, otpauthUrl } = (enroll.json() as { data: { secret: string; otpauthUrl: string } })
    .data;
  expect(otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
  expect(otpauthUrl).toContain('Adminium');

  const activate = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/2fa/activate',
    headers: { cookie },
    payload: { code: totpCode(secret) },
  });
  expect(activate.statusCode).toBe(200);
  const { recoveryCodes } = (activate.json() as { data: { recoveryCodes: string[] } }).data;
  expect(recoveryCodes).toHaveLength(10);
  return { secret, recoveryCodes };
}

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
