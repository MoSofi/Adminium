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

import { normalizeWriteValue } from '../src/crud/write-values.js';
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
