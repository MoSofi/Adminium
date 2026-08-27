// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Auth flow requests (§2.1 step-up). Two things are load-bearing here and
 * neither is visible from a screen test.
 *
 * `login` has to tell a 200 SESSION from a 202 CHALLENGE, and it reads BOTH
 * `twoFactorRequired` and `challengeToken` before it believes the second one —
 * a reply that claims the challenge without carrying the token would otherwise
 * send the browser to `/otp` with nothing to verify against, and no way back.
 *
 * The `sessionStorage` helpers are the other half of that flow: the 202 token
 * survives an `/otp` reload through them, and every one of them has to degrade
 * to "no challenge" rather than throw, because private mode makes
 * `sessionStorage` writes fail and a crashing auth screen has no recovery path.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse } from '../test/fixtures.js';
import {
  clearChallenge,
  forgotPassword,
  login,
  logout,
  readChallenge,
  resetPassword,
  storeChallenge,
  verify2fa,
} from './authApi.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

/** Stub `fetch` with one reply and hand back the recorded calls. */
function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse(status, body));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function requestOf(fetchMock: ReturnType<typeof vi.fn>, index = 0) {
  const [url, init] = fetchMock.mock.calls[index] as [string, RequestInit | undefined];
  return {
    url: String(url),
    method: init?.method,
    body: init?.body === undefined ? undefined : (JSON.parse(String(init.body)) as unknown),
  };
}

const USER = {
  id: 'usr_1',
  email: 'ava@adminium.io',
  name: 'Ava Reyes',
  status: 'active',
  totpEnabled: true,
  lastLoginAt: null,
  createdAt: 1,
  updatedAt: 1,
};

describe('login', () => {
  it('posts the credentials and returns the session on a 200', async () => {
    const fetchMock = stubFetch(200, { data: { user: USER } });
    const result = await login('ava@adminium.io', 'hunter2');
    expect(requestOf(fetchMock)).toEqual({
      url: '/api/v1/auth/login',
      method: 'POST',
      body: { email: 'ava@adminium.io', password: 'hunter2' },
    });
    expect(result).toEqual({ kind: 'session', user: USER });
  });

  it('returns the challenge when the server asks for a second factor', async () => {
    stubFetch(202, { data: { twoFactorRequired: true, challengeToken: 'chal_1' } });
    expect(await login('ava@adminium.io', 'hunter2')).toEqual({
      kind: 'challenge',
      challengeToken: 'chal_1',
    });
  });

  it('does not treat a tokenless challenge as a challenge', async () => {
    // Sending the browser to /otp with nothing to verify against is a dead end.
    stubFetch(202, { data: { twoFactorRequired: true } });
    expect((await login('a@b.c', 'x')).kind).toBe('session');
  });

  it('surfaces a rejected credential as an ApiError with the server code', async () => {
    stubFetch(401, { error: { code: 'INVALID_CREDENTIALS', message: 'Wrong password', requestId: 'req_1' } });
    await expect(login('a@b.c', 'nope')).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
      code: 'INVALID_CREDENTIALS',
      requestId: 'req_1',
    });
  });
});

describe('the rest of the auth calls', () => {
  it('verify2fa posts the challenge token with the code and unwraps the user', async () => {
    const fetchMock = stubFetch(200, { data: { user: USER } });
    expect(await verify2fa('chal_1', '123456')).toEqual(USER);
    expect(requestOf(fetchMock)).toEqual({
      url: '/api/v1/auth/2fa/verify',
      method: 'POST',
      body: { challengeToken: 'chal_1', code: '123456' },
    });
  });

  it('logout posts with no body at all', async () => {
    const fetchMock = stubFetch(204, null);
    await logout();
    expect(requestOf(fetchMock)).toEqual({
      url: '/api/v1/auth/logout',
      method: 'POST',
      body: undefined,
    });
  });

  it('forgotPassword and resetPassword hit the two password routes', async () => {
    const forgot = stubFetch(202, null);
    await forgotPassword('ava@adminium.io');
    expect(requestOf(forgot)).toEqual({
      url: '/api/v1/auth/password/forgot',
      method: 'POST',
      body: { email: 'ava@adminium.io' },
    });

    const reset = stubFetch(204, null);
    await resetPassword('tok_1', 'newer-password');
    expect(requestOf(reset)).toEqual({
      url: '/api/v1/auth/password/reset',
      method: 'POST',
      body: { token: 'tok_1', newPassword: 'newer-password' },
    });
  });
});

describe('the 2FA challenge in sessionStorage', () => {
  it('round-trips the token and the return path across a reload', () => {
    storeChallenge('chal_1', '/orders');
    expect(readChallenge()).toEqual({ challengeToken: 'chal_1', returnTo: '/orders', next: null });
  });

  it('stores an absent return path as null rather than dropping the key', () => {
    storeChallenge('chal_1', undefined);
    expect(readChallenge()).toEqual({ challengeToken: 'chal_1', returnTo: null, next: null });
  });

  it('round-trips the surface gate’s next target, path-only (29 D4)', () => {
    storeChallenge('chal_1', undefined, '/schedule');
    expect(readChallenge()).toEqual({ challengeToken: 'chal_1', returnTo: null, next: '/schedule' });
    // A stored non-path is dropped on READ — sessionStorage is same-origin
    // writable, and the document navigation must never leave this origin.
    sessionStorage.setItem(
      'adminium-2fa-challenge',
      JSON.stringify({ challengeToken: 'chal_1', next: '//evil.example/x' }),
    );
    expect(readChallenge()?.next).toBeNull();
    sessionStorage.setItem(
      'adminium-2fa-challenge',
      JSON.stringify({ challengeToken: 'chal_1', next: 'https://evil.example/x' }),
    );
    expect(readChallenge()?.next).toBeNull();
  });

  it('is empty before any challenge, and after it is cleared', () => {
    expect(readChallenge()).toBeNull();
    storeChallenge('chal_1', '/orders');
    clearChallenge();
    expect(readChallenge()).toBeNull();
  });

  it('reads a corrupt or half-written entry as "no challenge"', () => {
    sessionStorage.setItem('adminium-2fa-challenge', 'not json');
    expect(readChallenge()).toBeNull();
    sessionStorage.setItem('adminium-2fa-challenge', JSON.stringify({ returnTo: '/orders' }));
    expect(readChallenge()).toBeNull();
  });

  it('ignores a non-string returnTo instead of forwarding it to the router', () => {
    sessionStorage.setItem(
      'adminium-2fa-challenge',
      JSON.stringify({ challengeToken: 'chal_1', returnTo: { href: 'https://evil.example' } }),
    );
    expect(readChallenge()).toEqual({ challengeToken: 'chal_1', returnTo: null, next: null });
  });

  it('survives a storage that throws — private mode must not crash /login', () => {
    const boom = (): never => {
      throw new DOMException('QuotaExceededError');
    };
    vi.stubGlobal('sessionStorage', { setItem: boom, getItem: boom, removeItem: boom });

    expect(() => {
      storeChallenge('chal_1', '/orders');
    }).not.toThrow();
    expect(readChallenge()).toBeNull();
    expect(() => {
      clearChallenge();
    }).not.toThrow();
  });
});
