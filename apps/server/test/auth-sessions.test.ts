// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Own-account session and credential management (08-server-api.md §2.1):
 * `GET /auth/sessions`, `DELETE /auth/sessions/:id`,
 * `POST /auth/password/change` — plus the three `auth.*` settings they and
 * their neighbours now enforce (07-meta-store.md §7.1).
 *
 * The point of the last group is that the settings are NOT inert: a workspace
 * that shortens `auth.sessionTtlHours` gets shorter sessions on the very next
 * mint, one that raises `auth.passwordMinLength` rejects the short password at
 * every door, and one that turns `auth.require2fa` on flags accounts without
 * TOTP instead of locking them out.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { auditRepo, sessionsRepo, settingsRepo, usersRepo, type User } from '@adminium/meta';

import { createChallenge, createSession } from '../src/auth/sessions.js';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  adminPasswordHash,
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

interface SessionRow {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  current: boolean;
}

async function listSessions(t: AuthTestApp, cookie: string): Promise<SessionRow[]> {
  const res = await t.app.inject({ method: 'GET', url: '/api/v1/auth/sessions', headers: { cookie } });
  expect(res.statusCode).toBe(200);
  return (res.json() as { data: { sessions: SessionRow[] } }).data.sessions;
}

async function changePassword(
  t: AuthTestApp,
  cookie: string,
  currentPassword: string,
  newPassword: string,
) {
  return t.app.inject({
    method: 'POST',
    url: '/api/v1/auth/password/change',
    headers: { cookie },
    payload: { currentPassword, newPassword },
  });
}

/** A second account, so "someone else's session" is a real row to aim at. */
async function makeOtherUser(t: AuthTestApp): Promise<User> {
  return usersRepo(t.meta).create({
    email: 'noah@example.com',
    name: 'Noah Ellis',
    passwordHash: await adminPasswordHash(),
    status: 'active',
  });
}

function errorCode(res: { json: () => unknown }): string {
  return (res.json() as { error: { code: string } }).error.code;
}

describe('GET /auth/sessions', () => {
  it('lists only the caller’s live sessions and flags the current one', async () => {
    fixture = await buildAuthApp();
    const first = await login(fixture.app);
    const second = await login(fixture.app);
    expect(first.cookie).not.toBeNull();

    // A session belonging to somebody else must never appear in this list.
    const other = await makeOtherUser(fixture);
    await createSession(fixture.meta, other.id);

    const sessions = await listSessions(fixture, first.cookie ?? '');
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((s) => s.current)).toHaveLength(1);

    const rows = await sessionsRepo(fixture.meta).listForUser(fixture.admin.id);
    expect(new Set(sessions.map((s) => s.id))).toEqual(new Set(rows.map((r) => r.id)));

    // The second login's row is present but is not the caller's own session.
    const secondSessions = await listSessions(fixture, second.cookie ?? '');
    const currentIds = [sessions, secondSessions].map(
      (list) => list.find((s) => s.current)?.id ?? '',
    );
    expect(currentIds[0]).not.toBe(currentIds[1]);
  });

  it('hides the 2FA challenge rows that share adminium_sessions', async () => {
    fixture = await buildAuthApp();
    const { cookie } = await login(fixture.app);

    // Enrolling TOTP is a full flow; the challenge row itself is what matters
    // here, and createChallenge is what /auth/login writes for a 2FA account.
    await createChallenge(fixture.meta, fixture.admin.id);

    const sessions = await listSessions(fixture, cookie ?? '');
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.current).toBe(true);
  });

  it('requires a session of its own', async () => {
    fixture = await buildAuthApp();
    const res = await fixture.app.inject({ method: 'GET', url: '/api/v1/auth/sessions' });
    expect(res.statusCode).toBe(401);
    expect(errorCode(res)).toBe('UNAUTHENTICATED');
  });
});

describe('DELETE /auth/sessions/:id', () => {
  it('revokes another of the caller’s own sessions', async () => {
    fixture = await buildAuthApp();
    const keep = await login(fixture.app);
    const drop = await login(fixture.app);

    const target = (await listSessions(fixture, keep.cookie ?? '')).find((s) => !s.current);
    expect(target).toBeDefined();

    const res = await fixture.app.inject({
      method: 'DELETE',
      url: `/api/v1/auth/sessions/${target?.id ?? ''}`,
      headers: { cookie: keep.cookie ?? '' },
    });
    expect(res.statusCode).toBe(200);

    // The dropped cookie stops working; the caller's own keeps working.
    const dropped = await fixture.app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie: drop.cookie ?? '' },
    });
    expect(dropped.statusCode).toBe(401);
    expect(await listSessions(fixture, keep.cookie ?? '')).toHaveLength(1);

    const actions = (await auditRepo(fixture.meta).list({ category: 'auth' })).map((e) => e.action);
    expect(actions).toContain('session_revoked');
  });

  it('answers 404 — never 403 — for a session belonging to someone else', async () => {
    fixture = await buildAuthApp();
    const { cookie } = await login(fixture.app);
    const other = await makeOtherUser(fixture);
    const { session } = await createSession(fixture.meta, other.id);

    const res = await fixture.app.inject({
      method: 'DELETE',
      url: `/api/v1/auth/sessions/${session.id}`,
      headers: { cookie: cookie ?? '' },
    });
    expect(res.statusCode).toBe(404);
    expect(errorCode(res)).toBe('NOT_FOUND');

    // And the same 404 an unknown id gets — the two are indistinguishable.
    const unknown = await fixture.app.inject({
      method: 'DELETE',
      url: '/api/v1/auth/sessions/sess_does_not_exist',
      headers: { cookie: cookie ?? '' },
    });
    expect(unknown.statusCode).toBe(404);
    expect(errorCode(unknown)).toBe('NOT_FOUND');

    // Untouched: the other user's session is still live.
    const still = await sessionsRepo(fixture.meta).findById(session.id);
    expect(still?.revokedAt).toBeNull();
  });

  it('clears the cookie when the revoked session is the current one', async () => {
    fixture = await buildAuthApp();
    const { cookie } = await login(fixture.app);
    const current = (await listSessions(fixture, cookie ?? '')).find((s) => s.current);

    const res = await fixture.app.inject({
      method: 'DELETE',
      url: `/api/v1/auth/sessions/${current?.id ?? ''}`,
      headers: { cookie: cookie ?? '' },
    });
    expect(res.statusCode).toBe(200);
    const cleared = sessionCookie(res.headers['set-cookie']);
    expect(cleared).toBe('adminium_session=');

    const after = await fixture.app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie: cookie ?? '' },
    });
    expect(after.statusCode).toBe(401);
  });
});

describe('POST /auth/password/change', () => {
  it('rejects a wrong current password with 401 and changes nothing', async () => {
    fixture = await buildAuthApp();
    const { cookie } = await login(fixture.app);

    const res = await changePassword(fixture, cookie ?? '', 'not-the-password', 'a-brand-new-one-42');
    expect(res.statusCode).toBe(401);
    expect(errorCode(res)).toBe('INVALID_CREDENTIALS');

    const still = await login(fixture.app, ADMIN_EMAIL, ADMIN_PASSWORD);
    expect(still.res.statusCode).toBe(200);
  });

  it('revokes the other sessions but keeps the caller signed in', async () => {
    fixture = await buildAuthApp();
    const typing = await login(fixture.app);
    const elsewhere = await login(fixture.app);

    const newPassword = 'a-longer-brand-new-passphrase';
    const res = await changePassword(fixture, typing.cookie ?? '', ADMIN_PASSWORD, newPassword);
    expect(res.statusCode).toBe(200);

    // The tab that typed it gets a fresh cookie and stays in.
    const reissued = sessionCookie(res.headers['set-cookie']);
    expect(reissued).not.toBe(typing.cookie);
    const me = await fixture.app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie: reissued },
    });
    expect(me.statusCode).toBe(200);

    // Every other session — and the pre-change cookie of this one — is dead.
    for (const cookie of [elsewhere.cookie ?? '', typing.cookie ?? '']) {
      const after = await fixture.app.inject({
        method: 'GET',
        url: '/api/v1/auth/session',
        headers: { cookie },
      });
      expect(after.statusCode).toBe(401);
    }

    expect((await login(fixture.app, ADMIN_EMAIL, ADMIN_PASSWORD)).res.statusCode).toBe(401);
    expect((await login(fixture.app, ADMIN_EMAIL, newPassword)).res.statusCode).toBe(200);

    const actions = (await auditRepo(fixture.meta).list({ category: 'auth' })).map((e) => e.action);
    expect(actions).toContain('password_changed');
  });

  it('enforces auth.passwordMinLength, not the schema floor', async () => {
    fixture = await buildAuthApp();
    await settingsRepo(fixture.meta).set('auth.passwordMinLength', 16);
    const { cookie } = await login(fixture.app);

    // 12 characters: over the schema's floor of 8, under the workspace policy.
    const res = await changePassword(fixture, cookie ?? '', ADMIN_PASSWORD, 'twelvechars1');
    expect(res.statusCode).toBe(422);
    expect(errorCode(res)).toBe('VALIDATION_FAILED');
    expect((res.json() as { error: { message: string } }).error.message).toContain('16');

    // The password did not change.
    expect((await login(fixture.app, ADMIN_EMAIL, ADMIN_PASSWORD)).res.statusCode).toBe(200);
  });
});

describe('auth.* settings are enforced, not stored', () => {
  it('auth.passwordMinLength also gates the reset door', async () => {
    const deliveries: { token: string }[] = [];
    fixture = await buildAuthApp({ onPasswordResetToken: (d) => deliveries.push(d) });
    await settingsRepo(fixture.meta).set('auth.passwordMinLength', 16);

    await fixture.app.inject({
      method: 'POST',
      url: '/api/v1/auth/password/forgot',
      payload: { email: ADMIN_EMAIL },
    });
    const token = deliveries[0]?.token ?? '';

    const short = await fixture.app.inject({
      method: 'POST',
      url: '/api/v1/auth/password/reset',
      payload: { token, newPassword: 'twelvechars1' },
    });
    expect(short.statusCode).toBe(422);
    expect(errorCode(short)).toBe('VALIDATION_FAILED');

    // The rejected attempt did not burn the single-use token.
    const ok = await fixture.app.inject({
      method: 'POST',
      url: '/api/v1/auth/password/reset',
      payload: { token, newPassword: 'sixteen-characters-and-more' },
    });
    expect(ok.statusCode).toBe(200);
  });

  it('auth.sessionTtlHours sets the absolute expiry of the next session minted', async () => {
    fixture = await buildAuthApp();

    const before = await login(fixture.app);
    const defaultRow = (await listSessions(fixture, before.cookie ?? ''))[0];
    // Registry default: 720 h.
    expect(defaultRow?.expiresAt).toBeGreaterThan(defaultRow!.createdAt + 719 * 3_600_000);

    await settingsRepo(fixture.meta).set('auth.sessionTtlHours', 2);
    const after = await login(fixture.app);
    const fresh = (await listSessions(fixture, after.cookie ?? '')).find((s) => s.current);
    expect(fresh?.expiresAt).toBe((fresh?.createdAt ?? 0) + 2 * 3_600_000);
  });

  it('auth.require2fa flags an account without TOTP instead of locking it out', async () => {
    fixture = await buildAuthApp();
    await settingsRepo(fixture.meta).set('auth.require2fa', true);

    const { res, cookie } = await login(fixture.app);
    // Signed in — the enroll flow is behind requireAuth, so a denial here
    // would leave the account with no way to satisfy the policy at all.
    expect(res.statusCode).toBe(200);
    expect(res.json().data.twoFactorSetupRequired).toBe(true);

    const session = await fixture.app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie: cookie ?? '' },
    });
    expect(session.json().data.twoFactorSetupRequired).toBe(true);

    // And the enrollment route it points at is actually reachable.
    const enroll = await fixture.app.inject({
      method: 'POST',
      url: '/api/v1/auth/2fa/enroll',
      headers: { cookie: cookie ?? '' },
    });
    expect(enroll.statusCode).toBe(200);

    // The other half: nobody may opt back out while the policy is on.
    const disable = await fixture.app.inject({
      method: 'POST',
      url: '/api/v1/auth/2fa/disable',
      headers: { cookie: cookie ?? '' },
      payload: { password: ADMIN_PASSWORD },
    });
    expect(disable.statusCode).toBe(403);
    expect(errorCode(disable)).toBe('FORBIDDEN');
  });

  it('leaves the flag off when the workspace does not require 2FA', async () => {
    fixture = await buildAuthApp();
    const { res, cookie } = await login(fixture.app);
    expect(res.json().data.twoFactorSetupRequired).toBeUndefined();

    const session = await fixture.app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie: cookie ?? '' },
    });
    expect(session.json().data.twoFactorSetupRequired).toBe(false);
  });
});
