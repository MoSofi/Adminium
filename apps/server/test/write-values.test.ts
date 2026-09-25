// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Write-side naive-timestamp normalization (crud/write-values.ts): the
 * sibling of the widgets DATE −1-day fix. The pg driver reads a naive
 * `timestamp` wall clock at server-local time, the JSON wire carries it as
 * a UTC instant, and postgres drops the zone suffix on write — so an
 * untouched edit save drifted the stored wall clock by the server's UTC
 * offset (live repro 2026-08-24 on Europe/Berlin: 22:00 → 20:00 → 18:00).
 */
import { describe, expect, it } from 'vitest';

import { bindWriteValue, booleanOf, normalizeWriteValue, sameValue, zonedWriteValue } from '../src/crud/write-values.js';
import type { ResolvedColumn } from '../src/crud/identifiers.js';

function column(logicalType: ResolvedColumn['logicalType']): ResolvedColumn {
  return {
    name: 'happened_at',
    logicalType,
    nullable: true,
    isPrimaryKey: false,
    masked: false,
    secret: false,
    textish: false,
  };
}

const naive = column('timestamp');

/** Run `body` under a TZ, restoring the original afterwards. */
function withTz(tz: string, body: () => void): void {
  const before = process.env.TZ;
  process.env.TZ = tz;
  try {
    body();
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
}

describe('normalizeWriteValue — naive timestamp wall-clock round-trip', () => {
  it('read → echo → write is the identity in ANY server zone', () => {
    // The property the live repro violated: the driver parses the stored
    // wall clock at server-local time (new Date over the space form is the
    // same local parse pg's type parser does), the wire carries the UTC
    // instant, and normalization must land back on the original wall clock.
    for (const tz of ['Europe/Berlin', 'America/New_York', 'UTC']) {
      withTz(tz, () => {
        const wall = '2026-05-28 22:00:00';
        const wire = new Date(wall).toISOString();
        expect(normalizeWriteValue(naive, wire)).toBe(wall);
      });
    }
  });

  it('re-encodes the audit-repro wire instant to the Berlin wall clock', () => {
    withTz('Europe/Berlin', () => {
      // CEST (+2): the untouched save that stored 20:00 must store 22:00.
      expect(normalizeWriteValue(naive, '2026-05-28T20:00:00.000Z')).toBe('2026-05-28 22:00:00');
      // Explicit-offset spelling normalizes the same way.
      expect(normalizeWriteValue(naive, '2026-05-28T21:00:00+01:00')).toBe('2026-05-28 22:00:00');
      // Milliseconds survive.
      expect(normalizeWriteValue(naive, '2026-05-28T20:00:00.123Z')).toBe('2026-05-28 22:00:00.123');
    });
  });

  it('naive literals pass through byte-identical (exact-literal callers, µs included)', () => {
    withTz('Europe/Berlin', () => {
      expect(normalizeWriteValue(naive, '2026-05-28 22:00:00')).toBe('2026-05-28 22:00:00');
      expect(normalizeWriteValue(naive, '2026-05-28T22:00:00')).toBe('2026-05-28T22:00:00');
      expect(normalizeWriteValue(naive, '2026-05-28 22:00:00.123456')).toBe('2026-05-28 22:00:00.123456');
    });
  });

  it('only naive timestamps are touched — timestamptz/date/text pass through', () => {
    withTz('Europe/Berlin', () => {
      const instant = '2026-05-28T20:00:00.000Z';
      expect(normalizeWriteValue(column('timestamptz'), instant)).toBe(instant);
      expect(normalizeWriteValue(column('date'), instant)).toBe(instant);
      expect(normalizeWriteValue(column('varchar'), instant)).toBe(instant);
    });
  });

  it('non-strings, null, and garbage pass through untouched', () => {
    expect(normalizeWriteValue(naive, null)).toBeNull();
    expect(normalizeWriteValue(naive, 1234567890)).toBe(1234567890);
    expect(normalizeWriteValue(naive, 'not-a-timestamp')).toBe('not-a-timestamp');
  });
});

describe('bindWriteValue — an instant as the statement binds it', () => {
  const zoned = column('timestamptz');

  it("spells an instant for MySQL's TIMESTAMP as UTC wall time, in any server zone", () => {
    // MySQL refuses the T and the Z, and Adminium's sessions there run in UTC.
    for (const tz of ['Europe/Berlin', 'America/New_York', 'UTC']) {
      withTz(tz, () => {
        expect(bindWriteValue(zoned, '2026-07-27T23:00:00.000Z', 'mysql')).toBe('2026-07-27 23:00:00.000');
        expect(bindWriteValue(zoned, '2026-07-28T01:00:00+02:00', 'mysql')).toBe('2026-07-27 23:00:00');
        expect(bindWriteValue(zoned, '2026-07-27 19:00:00-0400', 'mysql')).toBe('2026-07-27 23:00:00');
        // A Date read back (an undo) — the driver would spell it in this process's zone.
        expect(bindWriteValue(zoned, new Date('2026-07-27T23:00:00.123Z'), 'mysql')).toBe('2026-07-27 23:00:00.123');
      });
    }
  });

  it('keeps a microsecond a caller sent', () => {
    expect(bindWriteValue(zoned, '2026-07-27T23:00:00.123456Z', 'mysql')).toBe('2026-07-27 23:00:00.123456');
  });

  it('leaves a zone-less literal, null, garbage and an invalid Date alone', () => {
    expect(bindWriteValue(zoned, '2026-07-27 23:00:00', 'mysql')).toBe('2026-07-27 23:00:00');
    expect(bindWriteValue(zoned, null, 'mysql')).toBeNull();
    expect(bindWriteValue(zoned, 'soon', 'mysql')).toBe('soon');
    const invalid = new Date('nope');
    expect(bindWriteValue(zoned, invalid, 'mysql')).toBe(invalid);
  });

  it('hands Postgres and SQLite the instant as it is', () => {
    const at = new Date('2026-07-27T23:00:00.000Z');
    for (const dialect of ['postgres', 'sqlite'] as const) {
      expect(bindWriteValue(zoned, '2026-07-27T23:00:00.000Z', dialect)).toBe('2026-07-27T23:00:00.000Z');
      expect(bindWriteValue(zoned, at, dialect)).toBe(at);
    }
  });

  it('spells a zone-less timestamp as normalizeWriteValue does, on every engine', () => {
    withTz('Europe/Berlin', () => {
      for (const dialect of ['mysql', 'postgres', 'sqlite'] as const) {
        expect(bindWriteValue(naive, '2026-05-28T20:00:00.000Z', dialect)).toBe('2026-05-28 22:00:00');
      }
      expect(bindWriteValue(column('varchar'), '2026-05-28T20:00:00.000Z', 'mysql')).toBe('2026-05-28T20:00:00.000Z');
    });
  });
});

describe('zonedWriteValue — a zone-less time sent for a column that keeps a zone', () => {
  const zoned = column('timestamptz');

  it("is the instant it names on this server's clock, whatever zone the database's session is in", () => {
    withTz('Europe/London', () => {
      expect(zonedWriteValue(zoned, '2026-09-25 11:45:00')).toBe('2026-09-25T10:45:00Z');
      expect(zonedWriteValue(zoned, '2026-09-25T11:45')).toBe('2026-09-25T10:45:00Z');
      // A microsecond is kept, not cut to a millisecond.
      expect(zonedWriteValue(zoned, '2026-01-25 11:45:00.123456')).toBe('2026-01-25T11:45:00.123456Z');
    });
    withTz('America/New_York', () => {
      expect(zonedWriteValue(zoned, '2026-09-25 11:45:00')).toBe('2026-09-25T15:45:00Z');
    });
  });

  it('leaves a zoned instant, a day the calendar lacks, another column type and anything else alone', () => {
    expect(zonedWriteValue(zoned, '2026-09-25T10:45:00Z')).toBe('2026-09-25T10:45:00Z');
    expect(zonedWriteValue(zoned, '2026-02-30 10:00:00')).toBe('2026-02-30 10:00:00');
    expect(zonedWriteValue(zoned, '2026-09-25 24:00:00')).toBe('2026-09-25 24:00:00');
    expect(zonedWriteValue(zoned, 'soon')).toBe('soon');
    expect(zonedWriteValue(naive, '2026-09-25 11:45:00')).toBe('2026-09-25 11:45:00');
  });
});

describe('booleanOf — a yes or a no, however it is spelled', () => {
  it('reads the words Postgres reads, whatever the case and the spaces', () => {
    for (const yes of [true, 1, 1n, 'true', ' TRUE ', 't', 'yes', 'y', 'on', '1']) expect(booleanOf(yes), String(yes)).toBe(true);
    for (const no of [false, 0, 0n, 'false', 'f', 'no', 'N', 'off', '0']) expect(booleanOf(no), String(no)).toBe(false);
    for (const neither of ['maybe', '', 2, null, undefined, {}]) expect(booleanOf(neither), String(neither)).toBeNull();
    // And a rule's `true` is met by each of them.
    expect(sameValue('on', true)).toBe(true);
    expect(sameValue(' true', true)).toBe(true);
    expect(sameValue('y', true)).toBe(true);
  });
});

describe('wallTimesAsInstants', () => {
  it('spells a SQLite wall time as the instant it denotes, on the server’s clock; leaves the rest', async () => {
    const { wallTimesAsInstants } = await import('../src/crud/instants.js');
    const columns = new Map([
      ['starts_at', { logicalType: 'timestamp' as const }],
      ['name', { logicalType: 'text' as const }],
    ]);
    const wall = '2026-09-25 01:00:00';
    const local = new Date(2026, 8, 25, 1, 0, 0).toISOString();
    expect(wallTimesAsInstants({ starts_at: wall, name: '2026-09-25 01:00:00' }, columns, 'sqlite')).toEqual({ starts_at: local, name: wall });
    expect(wallTimesAsInstants({ starts_at: wall }, columns, 'postgres')).toEqual({ starts_at: wall });
    expect(wallTimesAsInstants({ starts_at: '2026-09-24T23:00:00.000Z' }, columns, 'sqlite')).toEqual({ starts_at: '2026-09-24T23:00:00.000Z' });
  });
});

describe('the same answer, however it is spelled', () => {
  it('compares a JSON value by what it holds, as an object or as SQLite keeps it', () => {
    expect(sameValue({ po: 'A-1', n: 1 }, { n: 1, po: 'A-1' })).toBe(true);
    expect(sameValue('{"n":1,"po":"A-1"}', { po: 'A-1', n: 1 })).toBe(true);
    expect(sameValue({ po: 'A-1' }, { po: 'CHANGED' })).toBe(false);
    expect(sameValue([1, 2], [2, 1])).toBe(false);
  });

  it('compares a date or a moment as that day or that instant', () => {
    // A `date` column as Postgres and MySQL hand it back: the server's local midnight.
    const day = new Date(2026, 8, 1);
    expect(sameValue(day, '2026-09-01')).toBe(true);
    expect(sameValue('2026-09-01', day)).toBe(true);
    expect(sameValue(day, '2026-09-02')).toBe(false);
    expect(sameValue(day, day.toISOString())).toBe(true);
    expect(sameValue(day, new Date(day.getTime()))).toBe(true);
    expect(sameValue(new Date('2030-06-15T01:00:00Z'), '2030-06-15T03:00:00+02:00')).toBe(true);
    expect(sameValue(new Date('2030-06-15T01:00:00Z'), new Date('2030-06-15T01:00:01Z'))).toBe(false);
  });
});
