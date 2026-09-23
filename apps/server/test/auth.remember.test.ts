// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Keep me signed in" (`remember` on POST /auth/login) decides the session
 * cookie: ticked or absent ⇒ `Max-Age` (the long-lived cookie every client
 * got before the field existed), unticked ⇒ a browser-session cookie with
 * neither `Max-Age` nor `Expires`. The answer is given once, at /auth/login,
 * so it has to survive the two later writers of the cookie that never see
 * the checkbox: the 2FA verify and the password-change re-mint.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { SESSION_ABSOLUTE_TTL_MS } from '../src/auth/sessions.js';
import {
  ADMIN_EMAIL,
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

const MAX_AGE = `Max-Age=${Math.floor(SESSION_ABSOLUTE_TTL_MS / 1000)}`;

/** The one `adminium_session=` set-cookie header, attributes and all. */
function sessionSetCookie(setCookie: string | string[] | undefined): string {
  const headers = setCookie === undefined ? [] : Array.isArray(setCookie) ? setCookie : [setCookie];
  const header = headers.find((h) => h.startsWith('adminium_session='));
  expect(header, 'expected an adminium_session set-cookie').toBeDefined();
  return header ?? '';
}

function expectPersistent(header: string): void {
  expect(header).toContain(MAX_AGE);
  expect(header).toContain('HttpOnly');
}

function expectBrowserSession(header: string): void {
  expect(header).not.toMatch(/Max-Age=/i);
  expect(header).not.toMatch(/Expires=/i);
  // Only the lifetime changes — the rest of the cookie contract holds.
  expect(header).toContain('HttpOnly');
  expect(header).toContain('SameSite=Lax');
  expect(header).toContain('Path=/');
}

async function sessionOk(t: AuthTestApp, cookie: string): Promise<boolean> {
  const res = await t.app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { cookie } });
  return res.statusCode === 200;
}

describe('POST /auth/login { remember }', () => {
  it('keeps the long-lived cookie for a client that does not send the field', async () => {
    fixture = await buildAuthApp();
    const { res } = await login(fixture.app);
    expect(res.statusCode).toBe(200);
    expectPersistent(sessionSetCookie(res.headers['set-cookie']));
  });

  it('gives the long-lived cookie when the box is ticked', async () => {
    fixture = await buildAuthApp();
    const { res } = await login(fixture.app, ADMIN_EMAIL, ADMIN_PASSWORD, { remember: true });
    expect(res.statusCode).toBe(200);
    expectPersistent(sessionSetCookie(res.headers['set-cookie']));
  });

  it('gives a browser-session cookie when the box is unticked, and it signs in all the same', async () => {
    fixture = await buildAuthApp();
    const { res, cookie } = await login(fixture.app, ADMIN_EMAIL, ADMIN_PASSWORD, { remember: false });
    expect(res.statusCode).toBe(200);
    expectBrowserSession(sessionSetCookie(res.headers['set-cookie']));
    expect(await sessionOk(fixture, cookie ?? '')).toBe(true);

    // The row still expires on the workspace's schedule: the checkbox is about
    // the cookie, never a longer or shorter session on the server.
    const row = await fixture.meta.db.selectFrom('adminium_sessions').selectAll().executeTakeFirst();
    expect(row?.expiresAt).toBe((row?.createdAt ?? 0) + SESSION_ABSOLUTE_TTL_MS);
  });

  it('rejects a non-boolean remember with 422', async () => {
    fixture = await buildAuthApp();
    const { res } = await login(fixture.app, ADMIN_EMAIL, ADMIN_PASSWORD, { remember: 'no' });
    expect(res.statusCode).toBe(422);
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});

describe('the answer survives a 2FA challenge', () => {
  async function stepUp(t: AuthTestApp, extra: Record<string, unknown>) {
    const first = await login(t.app);
    const { secret } = await enable2fa(t.app, first.cookie ?? '');
    const challenge = await login(t.app, ADMIN_EMAIL, ADMIN_PASSWORD, extra);
    expect(challenge.res.statusCode).toBe(202);
    // The challenge sets no cookie — the choice waits on the challenge row.
    expect(challenge.res.headers['set-cookie']).toBeUndefined();
    const { challengeToken } = (challenge.res.json() as { data: { challengeToken: string } }).data;
    const verify = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/2fa/verify',
      payload: { challengeToken, code: totpCode(secret) },
    });
    expect(verify.statusCode).toBe(200);
    return sessionSetCookie(verify.headers['set-cookie']);
  }

  it('unticked at /auth/login ⇒ a browser-session cookie at /auth/2fa/verify', async () => {
    fixture = await buildAuthApp();
    expectBrowserSession(await stepUp(fixture, { remember: false }));
  });

  it('ticked at /auth/login ⇒ the long-lived cookie at /auth/2fa/verify', async () => {
    fixture = await buildAuthApp();
    expectPersistent(await stepUp(fixture, { remember: true }));
  });

  it('not sent at all ⇒ the long-lived cookie, as before', async () => {
    fixture = await buildAuthApp();
    expectPersistent(await stepUp(fixture, {}));
  });
});

describe('the answer survives a password change', () => {
  async function changePassword(t: AuthTestApp, cookie: string) {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/password/change',
      headers: { cookie },
      payload: { currentPassword: ADMIN_PASSWORD, newPassword: 'a-longer-brand-new-passphrase' },
    });
    expect(res.statusCode).toBe(200);
    return res;
  }

  it('a browser-session sign-in is not upgraded to a long-lived cookie', async () => {
    fixture = await buildAuthApp();
    const { cookie } = await login(fixture.app, ADMIN_EMAIL, ADMIN_PASSWORD, { remember: false });
    const res = await changePassword(fixture, cookie ?? '');
    expectBrowserSession(sessionSetCookie(res.headers['set-cookie']));
    expect(await sessionOk(fixture, sessionCookie(res.headers['set-cookie']))).toBe(true);
  });

  it('a long-lived sign-in stays long-lived', async () => {
    fixture = await buildAuthApp();
    const { cookie } = await login(fixture.app, ADMIN_EMAIL, ADMIN_PASSWORD, { remember: true });
    const res = await changePassword(fixture, cookie ?? '');
    expectPersistent(sessionSetCookie(res.headers['set-cookie']));
  });
});
