// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pure helpers behind the team directory (no DOM, no fetch): the query-string
 * builder, the activation-link join, and the instant formatters that `audit/`
 * and `account/` also read.
 */
import { describe, expect, it } from 'vitest';

import {
  EMPTY_USER_FILTERS,
  activationLink,
  buildUsersPath,
  formatSince,
  formatStamp,
  userDeletePath,
  userStatusTone,
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
