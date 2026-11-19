// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE HASH A FIELD'S NOTE IS DRAWN BY, the same on every engine: a value as
 * the record page reads it, by its column's kind, whatever the driver handed
 * back. Postgres and MySQL give a decimal as `"12.50"` where SQLite gives
 * `12.5`; a day as a `Date` at the server's midnight, or as text; an instant
 * as a `Date`, or as text with its zone, or as the server's wall clock. Text is trimmed and
 * otherwise kept as written.
 */
import { describe, expect, it } from 'vitest';

import { shownKindOf, shownText, valueHash } from '../src/leads/write.js';

describe('a note\'s value hash', () => {
  it('reads a column by its kind', () => {
    expect(['integer', 'bigint', 'decimal', 'float'].map(shownKindOf)).toEqual(['number', 'number', 'number', 'number']);
    expect(shownKindOf('date')).toBe('date');
    expect([shownKindOf('timestamp'), shownKindOf('timestamptz')]).toEqual(['instant', 'instant']);
    expect([shownKindOf('text'), shownKindOf('varchar'), shownKindOf(undefined)]).toEqual(['text', 'text', 'text']);
  });

  it('text: trimmed, and otherwise as written (a number in a text column stays its own spelling)', () => {
    expect(valueHash('  Kestrel Yard Architects \n')).toBe(valueHash('Kestrel Yard Architects'));
    expect(valueHash('12.50')).not.toBe(valueHash('12.5'));
    expect(shownText(null)).toBeNull();
  });

  it('a number: one spelling on every engine', () => {
    expect(valueHash('12.50', 'number')).toBe(valueHash(12.5, 'number'));
    expect(valueHash('012.500', 'number')).toBe(valueHash('12.5', 'number'));
    expect(valueHash('13.00', 'number')).toBe(valueHash(13, 'number'));
    expect(valueHash(9007199254740993n, 'number')).toBe(valueHash('9007199254740993', 'number'));
    expect(shownText('-0.00', 'number')).toBe('0');
    expect(valueHash('12.5', 'number')).not.toBe(valueHash('12.51', 'number'));
  });

  it('a day: as written, or the server\'s day of a driver\'s midnight', () => {
    const midnight = new Date(2016, 2, 1);
    expect(valueHash(midnight, 'date')).toBe(valueHash('2016-03-01', 'date'));
    // The same midnight, as JSON carries it to the record page.
    expect(valueHash(midnight.toISOString(), 'date')).toBe(valueHash('2016-03-01', 'date'));
    expect(valueHash('2016-03-02', 'date')).not.toBe(valueHash('2016-03-01', 'date'));
  });

  it('an instant: one moment, however it is spelled', () => {
    const at = Date.UTC(2026, 6, 28, 9, 30);
    expect(valueHash(new Date(at), 'instant')).toBe(valueHash('2026-07-28T09:30:00.000Z', 'instant'));
    expect(valueHash('2026-07-28T11:30:00+02:00', 'instant')).toBe(valueHash('2026-07-28T09:30:00.000Z', 'instant'));
    // A wall time with no zone is the server's own clock, as SQLite keeps it.
    expect(valueHash('2026-07-28 09:30:00', 'instant')).toBe(valueHash(new Date(2026, 6, 28, 9, 30), 'instant'));
    expect(valueHash('2026-07-28 09:30:00.250', 'instant')).toBe(valueHash(new Date(2026, 6, 28, 9, 30, 0, 250), 'instant'));
    expect(valueHash('2026-07-28T09:31:00.000Z', 'instant')).not.toBe(valueHash(new Date(at), 'instant'));
  });
});
