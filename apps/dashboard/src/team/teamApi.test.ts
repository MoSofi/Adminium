// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The team directory's data layer. The first half is the pure helpers (no DOM,
 * no fetch): the query-string builder, the activation-link join, and the
 * instant formatters that `audit/` and `account/` also read.
 *
 * The second half is the requests themselves, because the directory is a
 * KEYSET list: the query key has to carry its filters (a page fetched under
 * different filters describes a different result set, and appending it would
 * interleave two lists), and the cursor has to come from the last reply and
 * stop at `null`. Neither is visible from the screen until the list is wrong.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse } from '../test/fixtures.js';
import {
  EMPTY_USER_FILTERS,
  activationLink,
  buildUsersPath,
  createUser,
  deleteUser,
  formatSince,
  formatStamp,
  patchUser,
  resendInvite,
  setUserRoles,
  userDeletePath,
  userStatusTone,
  usersQuery,
  type UserFilters,
} from './teamApi.js';

describe('buildUsersPath', () => {
  it('omits every empty filter rather than sending it blank', () => {
    expect(buildUsersPath(EMPTY_USER_FILTERS, null)).toBe('/api/v1/users');
  });

  it('sends the filters that are set', () => {
    const path = buildUsersPath({ q: 'dana', status: 'invited', roleId: 'role-1' }, 'cur-2');
    expect(path).toBe('/api/v1/users?q=dana&status=invited&roleId=role-1&cursor=cur-2');
  });

  it('trims the search term and drops it when only whitespace', () => {
    expect(buildUsersPath({ ...EMPTY_USER_FILTERS, q: '  ' }, null)).toBe('/api/v1/users');
    expect(buildUsersPath({ ...EMPTY_USER_FILTERS, q: '  dana ' }, null)).toBe('/api/v1/users?q=dana');
  });

  it('escapes values that would otherwise break the query string', () => {
    expect(buildUsersPath({ ...EMPTY_USER_FILTERS, q: 'a&b=c' }, null)).toBe(
      '/api/v1/users?q=a%26b%3Dc',
    );
  });
});

describe('activationLink', () => {
  it('joins an origin to the path the server minted', () => {
    expect(activationLink('https://admin.example', '/activate?token=abc')).toBe(
      'https://admin.example/activate?token=abc',
    );
  });

  it('tolerates a trailing slash on the origin and a bare path', () => {
    expect(activationLink('https://admin.example/', 'activate?token=abc')).toBe(
      'https://admin.example/activate?token=abc',
    );
  });
});

describe('userStatusTone', () => {
  it('maps every status to a distinct tone', () => {
    expect(userStatusTone('active')).toBe('pos');
    expect(userStatusTone('invited')).toBe('warn');
    expect(userStatusTone('suspended')).toBe('danger');
  });
});

describe('userDeletePath', () => {
  it('omits the flag for the default, which SUSPENDS rather than deletes', () => {
    expect(userDeletePath('user-1', false)).toBe('/api/v1/users/user-1');
  });

  it('spends the flag explicitly for the lossy path', () => {
    // Prefs, sessions and reset tokens CASCADE and `settings.updated_by` goes
    // NULL, so this must never be reachable without the caller asking for it.
    expect(userDeletePath('user-1', true)).toBe('/api/v1/users/user-1?permanent=true');
  });
});

describe('instant formatting', () => {
  const NOON = Date.UTC(2026, 7, 17, 12, 0, 0);

  it('returns null for a missing instant so the caller can render its own dash', () => {
    expect(formatStamp(null, 'en-US')).toBeNull();
    expect(formatSince(null, 'en-US', NOON)).toBeNull();
  });

  it('rejects a non-finite instant instead of formatting Invalid Date', () => {
    expect(formatStamp(Number.NaN, 'en-US')).toBeNull();
  });

  it('formats a past instant as elapsed and a future one as remaining', () => {
    expect(formatSince(NOON - 3 * 3600_000, 'en-US', NOON)).toBe('3 hours ago');
    expect(formatSince(NOON + 2 * 24 * 3600_000, 'en-US', NOON)).toBe('in 2 days');
  });

  it('falls through to seconds under a minute', () => {
    expect(formatSince(NOON - 5_000, 'en-US', NOON)).toBe('5 seconds ago');
  });

  it('produces a localized absolute stamp', () => {
    // Only the shape is asserted — the exact wording is the platform's.
    expect(formatStamp(NOON, 'en-US')).toContain('2026');
  });
});

describe('the request each call issues', () => {
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

  const FILTERS: UserFilters = { q: '', status: '', roleId: '' };

  it('keys the directory on its filters, so a filter change is a new list', () => {
    // Not an append onto the old one: a keyset page fetched under different
    // filters describes a different result set entirely.
    const wide = usersQuery(FILTERS);
    const narrow = usersQuery({ ...FILTERS, status: 'invited' });
    expect(wide.queryKey).not.toEqual(narrow.queryKey);
    expect(wide.initialPageParam).toBeNull();
  });

  it('walks the keyset with the cursor the last page returned', () => {
    const options = usersQuery(FILTERS);
    expect(options.getNextPageParam({ users: [], nextCursor: 'cur_2' } as never, [], null, [])).toBe('cur_2');
    // A null cursor is the end of the list — the caller must stop, not loop.
    expect(options.getNextPageParam({ users: [], nextCursor: null } as never, [], null, [])).toBeNull();
  });

  it('fetches a page through buildUsersPath', async () => {
    const fetchMock = stubFetch({ users: [], nextCursor: null });
    await usersQuery({ q: 'ava', status: 'active', roleId: 'role_1' }).queryFn?.({
      pageParam: 'cur_1',
    } as never);
    const url = new URL(callOf(fetchMock).url, 'http://x');
    expect(url.pathname).toBe('/api/v1/users');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: 'ava',
      status: 'active',
      roleId: 'role_1',
      cursor: 'cur_1',
    });
  });

  it('invites through POST /users and resends under the user id', async () => {
    const invite = stubFetch({
      user: { id: 'usr_1' },
      invite: { token: 'tok', expiresAt: 2, activationPath: '/reset/tok' },
      emailSent: false,
    });
    const created = await createUser({ email: 'ivo@x.io', name: 'Ivo', roleIds: [] } as never);
    expect(callOf(invite)).toEqual({
      url: '/api/v1/users',
      method: 'POST',
      body: { email: 'ivo@x.io', name: 'Ivo', roleIds: [] },
    });
    // The one-time link comes back on the reply and is never cached anywhere.
    expect(created.invite.activationPath).toBe('/reset/tok');
    // …and this install has no SMTP, so the copy banner is the only channel.
    expect(created.emailSent).toBe(false);

    const resend = stubFetch({
      user: { id: 'usr_1' },
      invite: { token: 'tok2', expiresAt: 3, activationPath: '/reset/tok2' },
      emailSent: true,
    });
    await resendInvite('usr_1');
    expect(callOf(resend)).toMatchObject({
      url: '/api/v1/users/usr_1/invite/resend',
      method: 'POST',
    });
  });

  it('patches, deletes and re-roles one user', async () => {
    const patch = stubFetch({ id: 'usr_1', status: 'suspended' });
    await patchUser('usr_1', { status: 'suspended' });
    expect(callOf(patch)).toEqual({
      url: '/api/v1/users/usr_1',
      method: 'PATCH',
      body: { status: 'suspended' },
    });

    const soft = stubFetch({ deleted: true });
    await deleteUser('usr_1', false);
    expect(callOf(soft)).toMatchObject({ url: '/api/v1/users/usr_1', method: 'DELETE' });

    const hard = stubFetch({ deleted: true });
    await deleteUser('usr_1', true);
    expect(callOf(hard).url).toBe('/api/v1/users/usr_1?permanent=true');

    // A readonly list has to reach the wire as a plain JSON array.
    const roles = stubFetch({ id: 'usr_1' });
    await setUserRoles('usr_1', Object.freeze(['role_1', 'role_2']));
    expect(callOf(roles)).toEqual({
      url: '/api/v1/users/usr_1/roles',
      method: 'PUT',
      body: { roleIds: ['role_1', 'role_2'] },
    });
  });
});
