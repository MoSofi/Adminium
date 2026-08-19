// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pure helpers behind the session list. `deviceLabel` is the one that matters:
 * a session list is read in order to decide what to revoke, and a confidently
 * wrong device name is how someone kills their own session and leaves an
 * attacker's alone.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse } from '../test/fixtures.js';
import {
  SESSIONS_QUERY_KEY,
  activate2fa,
  changePassword,
  deviceLabel,
  disable2fa,
  enroll2fa,
  revokeSession,
  sessionsQuery,
  sortSessions,
  type SessionDto,
} from './securityApi.js';

function session(overrides: Partial<SessionDto>): SessionDto {
  return {
    id: 'sess-1',
    createdAt: 0,
    lastSeenAt: 0,
    expiresAt: 0,
    ip: null,
    userAgent: null,
    current: false,
    ...overrides,
  };
}

describe('sortSessions', () => {
  it('puts this browser first, then the most recently seen', () => {
    const rows = sortSessions([
      session({ id: 'a', lastSeenAt: 100 }),
      session({ id: 'b', lastSeenAt: 300 }),
      session({ id: 'me', lastSeenAt: 1, current: true }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(['me', 'b', 'a']);
  });

  it('does not mutate its input', () => {
    const input = [session({ id: 'a', lastSeenAt: 1 }), session({ id: 'b', lastSeenAt: 2 })];
    sortSessions(input);
    expect(input.map((row) => row.id)).toEqual(['a', 'b']);
  });
});

describe('deviceLabel', () => {
  it('picks the real browser out of a Chromium user agent', () => {
    // Every Chromium UA also claims Safari, and Edge claims both — order in
    // the pattern list is the whole correctness argument here.
    expect(
      deviceLabel(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
      ),
    ).toBe('Chrome · macOS');
    expect(
      deviceLabel(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0',
      ),
    ).toBe('Edge · Windows');
  });

  it('handles a real Safari and a mobile UA', () => {
    expect(
      deviceLabel(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
      ),
    ).toBe('Safari · macOS');
    expect(
      deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1'),
    ).toBe('Safari · iOS');
  });

  it('returns null rather than guessing at something it does not recognise', () => {
    expect(deviceLabel(null)).toBeNull();
    expect(deviceLabel('   ')).toBeNull();
    expect(deviceLabel('curl/8.7.1')).toBeNull();
  });

  it('names the half it does know when only one side matches', () => {
    expect(deviceLabel('Mozilla/5.0 (X11; Linux x86_64)')).toBe('Linux');
    expect(deviceLabel('Firefox/130.0')).toBe('Firefox');
  });
});

describe('the requests — and the two one-time secrets', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(body: unknown) {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, body));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  function callOf(fetchMock: ReturnType<typeof vi.fn>) {
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    return {
      url: String(url),
      method: init?.method ?? 'GET',
      body: init?.body === undefined ? undefined : (JSON.parse(String(init.body)) as unknown),
    };
  }

  it('unwraps the session list from the `/auth` envelope, which is one level deeper', async () => {
    // Everything under `/auth` wraps in `{ data: … }`, unlike `/api-keys` and
    // `/audit`. Unwrapping at the wrong depth here yields `undefined.sessions`.
    const fetchMock = stubFetch({ data: { sessions: [session({ id: 'a' })] } });
    await expect(sessionsQuery().queryFn?.({} as never)).resolves.toEqual([session({ id: 'a' })]);
    expect(callOf(fetchMock)).toMatchObject({ url: '/api/v1/auth/sessions', method: 'GET' });
    expect(sessionsQuery().queryKey).toEqual(SESSIONS_QUERY_KEY);
  });

  it('revokes one session by id', async () => {
    const fetchMock = stubFetch({ data: { ok: true } });
    await revokeSession('sess-2');
    expect(callOf(fetchMock)).toMatchObject({ url: '/api/v1/auth/sessions/sess-2', method: 'DELETE' });
  });

  it('sends both passwords on a change, never just the new one', async () => {
    const fetchMock = stubFetch({ data: { ok: true } });
    await changePassword({ currentPassword: 'old-one', newPassword: 'a-newer-one' });
    expect(callOf(fetchMock)).toEqual({
      url: '/api/v1/auth/password/change',
      method: 'POST',
      body: { currentPassword: 'old-one', newPassword: 'a-newer-one' },
    });
  });

  it('returns the TOTP secret — shown once, then unrecoverable', async () => {
    // Encrypted at rest and never re-read, so a reader that dropped it would
    // leave the user with an enrolment they can never complete.
    const fetchMock = stubFetch({ data: { secret: 'JBSWY3DP', otpauthUrl: 'otpauth://totp/x' } });
    expect(await enroll2fa()).toEqual({ secret: 'JBSWY3DP', otpauthUrl: 'otpauth://totp/x' });
    expect(callOf(fetchMock)).toMatchObject({ url: '/api/v1/auth/2fa/enroll', method: 'POST' });
  });

  it('returns the recovery codes — also exactly once, stored hashed', async () => {
    const fetchMock = stubFetch({ data: { recoveryCodes: ['aaa-111', 'bbb-222'] } });
    expect(await activate2fa('123456')).toEqual(['aaa-111', 'bbb-222']);
    expect(callOf(fetchMock)).toEqual({
      url: '/api/v1/auth/2fa/activate',
      method: 'POST',
      body: { code: '123456' },
    });
  });

  it('disables 2FA with the password, and optionally a code', async () => {
    const withCode = stubFetch({ data: { ok: true } });
    await disable2fa({ password: 'hunter2', code: '123456' });
    expect(callOf(withCode)).toEqual({
      url: '/api/v1/auth/2fa/disable',
      method: 'POST',
      body: { password: 'hunter2', code: '123456' },
    });

    const withoutCode = stubFetch({ data: { ok: true } });
    await disable2fa({ password: 'hunter2' });
    expect(callOf(withoutCode).body).toEqual({ password: 'hunter2' });
  });
});
