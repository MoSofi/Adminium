// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A wall time on the venue's clock, read as the instant it names there —
 * across the clock changes, and spelled the way each column stores a zoned
 * value.
 */
import { describe, expect, it } from 'vitest';

import type { ResolvedColumn } from '../src/crud/identifiers.js';
import { venueLocalValue, wallTimeToInstant } from '../src/crud/venue-time.js';

describe('a wall time on the venue clock', () => {
  it('is the instant it names there, whatever the server’s own zone', () => {
    expect(wallTimeToInstant('2026-09-25 19:00', 'Europe/London')?.toISOString()).toBe('2026-09-25T18:00:00.000Z');
    expect(wallTimeToInstant('2026-01-15T19:00:00', 'Europe/London')?.toISOString()).toBe('2026-01-15T19:00:00.000Z');
    expect(wallTimeToInstant('2026-09-25 00:00', 'Asia/Tokyo')?.toISOString()).toBe('2026-09-24T15:00:00.000Z');
  });

  it('reads a skipped spring hour as the hour after, and a doubled autumn hour as the first', () => {
    expect(wallTimeToInstant('2026-03-29 02:30', 'Europe/Berlin')?.toISOString()).toBe('2026-03-29T01:30:00.000Z');
    expect(wallTimeToInstant('2026-10-25 02:30', 'Europe/Berlin')?.toISOString()).toBe('2026-10-25T00:30:00.000Z');
  });

  it('leaves a value that already carries a zone, or is no time at all', () => {
    expect(wallTimeToInstant('2026-09-25T19:00:00Z', 'Europe/London')).toBeNull();
    expect(wallTimeToInstant('2026-09-25T19:00:00+02:00', 'Europe/London')).toBeNull();
    expect(wallTimeToInstant('tomorrow', 'Europe/London')).toBeNull();
  });

  it('is spelled as the column stores a zoned value', () => {
    const zoned = { logicalType: 'timestamptz' } as ResolvedColumn;
    expect(venueLocalValue(zoned, '2026-09-25 19:00', 'Europe/London')).toBe('2026-09-25T18:00:00.000Z');
    // A naive column keeps this server's wall clock, as every write to it does.
    const naive = { logicalType: 'timestamp' } as ResolvedColumn;
    const stored = venueLocalValue(naive, '2026-09-25 19:00', 'Europe/London') as string;
    expect(new Date(stored.replace(' ', 'T')).toISOString()).toBe('2026-09-25T18:00:00.000Z');
    expect(venueLocalValue(zoned, '2026-09-25T19:00:00Z', 'Europe/London')).toBe('2026-09-25T19:00:00Z');
  });
});
