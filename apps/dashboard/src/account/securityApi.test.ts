/**
 * Pure helpers behind the session list. `deviceLabel` is the one that matters:
 * a session list is read in order to decide what to revoke, and a confidently
 * wrong device name is how someone kills their own session and leaves an
 * attacker's alone.
 */
import { describe, expect, it } from 'vitest';

import { deviceLabel, sortSessions, type SessionDto } from './securityApi.js';

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
