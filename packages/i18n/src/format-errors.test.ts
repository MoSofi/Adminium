// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it } from 'vitest';

import { clearFormatFailures, formatFailures, recordFormatFailure } from './format-errors.js';

/** Mirrors the module-private constant; the ring is not parameterised. */
const MAX_ENTRIES = 50;

const fail = (over: Partial<Parameters<typeof recordFormatFailure>[0]> = {}) =>
  recordFormatFailure({ key: 'app:greeting', lng: 'en-US', message: 'boom', at: 1, ...over });

const keysOf = () => formatFailures().map((f) => f.key);
const find = (key: string) => formatFailures().find((f) => f.key === key);

beforeEach(() => {
  clearFormatFailures();
});

describe('recordFormatFailure', () => {
  it('records a first failure with count 1', () => {
    fail();
    expect(formatFailures()).toHaveLength(1);
    expect(find('app:greeting')?.count).toBe(1);
  });

  it('increments a repeat rather than adding an entry, and advances `at`', () => {
    fail({ at: 10 });
    fail({ at: 20 });
    fail({ at: 30 });
    expect(formatFailures()).toHaveLength(1);
    expect(find('app:greeting')?.count).toBe(3);
    expect(find('app:greeting')?.at).toBe(30);
  });

  it('treats key, lng and message as independent fields', () => {
    fail();
    fail({ key: 'app:farewell' });
    fail({ lng: 'fr-FR' });
    fail({ message: 'different' });
    expect(formatFailures()).toHaveLength(4);
  });

  it('does not let field boundaries collide', () => {
    // The separator is a NUL, which renders as a SPACE in most viewers — so a
    // well-meaning edit can silently turn it into one. Under a space separator
    // both of these collapse to "app:greeting en-US boom" and the second
    // failure would be swallowed as a repeat of the first.
    fail({ key: 'app:greeting', lng: 'en-US', message: 'boom' });
    fail({ key: 'app:greeting en-US', lng: 'boom', message: '' });
    expect(formatFailures()).toHaveLength(2);
  });
});

describe('eviction', () => {
  it('caps the ring at MAX_ENTRIES', () => {
    for (let i = 0; i < MAX_ENTRIES + 25; i += 1) fail({ key: `k${i}`, at: i });
    expect(formatFailures()).toHaveLength(MAX_ENTRIES);
  });

  it('evicts the least recently SEEN, not the first inserted', () => {
    fail({ key: 'first', at: 1 });
    for (let i = 0; i < MAX_ENTRIES - 1; i += 1) fail({ key: `k${i}`, at: 10 + i });

    // `first` was inserted first but is now the most recently seen.
    fail({ key: 'first', at: 500 });
    fail({ key: 'overflow', at: 600 });

    expect(keysOf()).toContain('first');
    expect(keysOf()).not.toContain('k0'); // the true least-recently-seen
    expect(find('first')?.count).toBe(2);
  });

  it('keeps a still-failing message alive while one-offs churn past the cap', () => {
    // The runaway render loop from the module header: one bad message failing
    // continuously must not be pushed out by unrelated one-off failures.
    for (let i = 0; i < MAX_ENTRIES + 10; i += 1) {
      fail({ key: `one-off${i}`, at: i * 2 });
      fail({ key: 'runaway', at: i * 2 + 1 });
    }
    expect(find('runaway')?.count).toBe(MAX_ENTRIES + 10);
  });
});

describe('formatFailures', () => {
  it('returns most recent first', () => {
    fail({ key: 'middle', at: 20 });
    fail({ key: 'newest', at: 30 });
    fail({ key: 'oldest', at: 10 });
    expect(keysOf()).toEqual(['newest', 'middle', 'oldest']);
  });

  it('returns a snapshot that does not change under later failures', () => {
    fail({ at: 10 });
    const snapshot = formatFailures();

    fail({ at: 20 });

    expect(snapshot.map((f) => f.count)).toEqual([1]);
    expect(snapshot.map((f) => f.at)).toEqual([10]);
    expect(find('app:greeting')?.count).toBe(2);
  });

  it('does not expose the ring to caller mutation', () => {
    fail();
    // `readonly` is compile-time only. Reach past it to prove the runtime
    // guarantee comes from the copy, not just the annotation.
    const [escaped] = formatFailures() as unknown as ({ count: number } | undefined)[];
    expect(escaped).toBeDefined();
    if (escaped !== undefined) escaped.count = -999;
    expect(find('app:greeting')?.count).toBe(1);
  });
});

describe('clearFormatFailures', () => {
  it('empties the ring', () => {
    fail({ key: 'a' });
    fail({ key: 'b' });
    clearFormatFailures();
    expect(formatFailures()).toEqual([]);
  });
});
