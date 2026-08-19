// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Offline unit tests for the SQLite statistics collector (06 §4.2). No
 * better-sqlite3 binding: a mock executor routes count/scan/sampling SQL by
 * shape so the estimate logic (exact count, scan fallback, capping) and the
 * privacy rules (sample-free default, PII never sampled) are asserted
 * deterministically.
 */
import { describe, expect, it } from 'vitest';

import {
  STATS_DEFAULT_SAMPLE_VALUES,
  STATS_SAMPLE_VALUE_MAX_CHARS,
  type StatsColumnInput,
} from '@adminium/engine/adapter';

import { collectSqliteStats } from '../src/stats.js';

interface MockConfig {
  count?: number | null;
  scan?: Record<string, unknown>;
  minmax?: Record<string, { lo: unknown; hi: unknown }>;
  mcv?: Record<string, unknown[]>;
}

/** First double-quoted identifier in a statement (the profiled column). */
function firstQuoted(sql: string): string {
  return /"([^"]+)"/.exec(sql)?.[1] ?? '';
}

function sqliteMock(cfg: MockConfig): ((sql: string) => Promise<Record<string, unknown>[]>) & {
  calls: string[];
} {
  const calls: string[] = [];
  const exec = async (sql: string): Promise<Record<string, unknown>[]> => {
    calls.push(sql);
    if (sql.includes('row_total')) return [cfg.scan ?? { row_total: null }];
    if (sql.includes('count(*) AS n')) return [{ n: cfg.count ?? null }];
    if (/min\(/.test(sql)) {
      const mm = cfg.minmax?.[firstQuoted(sql)] ?? { lo: null, hi: null };
      return [{ lo: mm.lo, hi: mm.hi }];
    }
    if (sql.includes('GROUP BY')) {
      return (cfg.mcv?.[firstQuoted(sql)] ?? []).map((v) => ({ v, c: 1 }));
    }
    return [];
  };
  return Object.assign(exec, { calls });
}

const table = { schema: null, name: 'people' };
const columns: StatsColumnInput[] = [
  { name: 'email', logicalType: 'text', piiSuspected: true },
  { name: 'city', logicalType: 'text' },
  { name: 'age', logicalType: 'integer' },
];

describe('collectSqliteStats — row count', () => {
  it('always reports an exact COUNT(*)', async () => {
    const exec = sqliteMock({ count: 5, scan: { row_total: 5 } });
    const stats = await collectSqliteStats(exec, table, { columns: [] });
    expect(stats.rowCountEstimate).toBe(5);
    expect(stats.rowCountExact).toBe(true);
  });
});

describe('collectSqliteStats — per-column estimates', () => {
  it('scans for null-fraction + distinct on a small table', async () => {
    const exec = sqliteMock({
      count: 5,
      scan: { row_total: 5, nf_0: 1, dc_0: 4, nf_1: 1, dc_1: 2, nf_2: 1, dc_2: 3 },
    });
    const stats = await collectSqliteStats(exec, table, { columns });
    expect(stats.columns.find((c) => c.column === 'city')?.nullFraction).toBeCloseTo(0.2);
    expect(stats.columns.find((c) => c.column === 'city')?.distinctCount).toBe(2);
    expect(stats.warnings).toBeUndefined();
  });

  it('caps per-column stats to null (with a warning) above maxScanRows', async () => {
    const exec = sqliteMock({ count: 2_000_000 });
    const stats = await collectSqliteStats(exec, table, { columns, maxScanRows: 1_000_000 });
    for (const c of stats.columns) {
      expect(c.nullFraction).toBeNull();
      expect(c.distinctCount).toBeNull();
    }
    expect(stats.warnings?.length).toBeGreaterThan(0);
    expect(exec.calls.some((c) => c.includes('row_total'))).toBe(false);
  });
});

describe('collectSqliteStats — privacy', () => {
  it('is sample-free by default: no min/max, no sampleValues, sampled=false', async () => {
    const exec = sqliteMock({ count: 5, scan: { row_total: 5 } });
    const stats = await collectSqliteStats(exec, table, { columns });
    expect(stats.sampled).toBe(false);
    for (const c of stats.columns) {
      expect(c.min).toBeUndefined();
      expect(c.max).toBeUndefined();
      expect(c.sampleValues).toBeUndefined();
    }
    expect(exec.calls.some((c) => c.includes('GROUP BY') || /min\(/.test(c))).toBe(false);
  });

  it('under sampling opt-in, never samples PII columns and never queries them', async () => {
    const exec = sqliteMock({
      count: 5,
      scan: { row_total: 5, nf_0: 1, dc_0: 4, nf_1: 1, dc_1: 2, nf_2: 1, dc_2: 3 },
      minmax: { age: { lo: 25, hi: 50 } },
      mcv: { city: ['Paris', 'Berlin'], age: [30, 40] },
    });
    const stats = await collectSqliteStats(exec, table, {
      columns,
      sampling: { maxValuesPerColumn: 10 },
    });
    expect(stats.sampled).toBe(true);

    const email = stats.columns.find((c) => c.column === 'email');
    expect(email?.sampleValues).toBeUndefined();
    expect(email?.min).toBeUndefined();

    expect(stats.columns.find((c) => c.column === 'city')?.sampleValues).toEqual(['Paris', 'Berlin']);
    const age = stats.columns.find((c) => c.column === 'age');
    expect(age?.min).toBe(25);
    expect(age?.max).toBe(50);

    const sampledEmail = exec.calls.some(
      (c) => (c.includes('GROUP BY') || /min\(/.test(c)) && c.includes('"email"'),
    );
    expect(sampledEmail).toBe(false);
  });
});

describe('collectSqliteStats — degrading instead of guessing', () => {
  it('an EMPTY table reports nullFraction 0, never NaN', async () => {
    // 0 nulls / 0 rows is a division by zero: the contract is a real 0, and a
    // NaN would not even survive JSON serialization.
    const exec = sqliteMock({
      count: 0,
      scan: { row_total: 0, nf_0: 0, dc_0: 0, nf_1: 0, dc_1: 0, nf_2: 0, dc_2: 0 },
    });
    const stats = await collectSqliteStats(exec, table, { columns });
    expect(stats.rowCountEstimate).toBe(0);
    for (const c of stats.columns) {
      expect(c.nullFraction).toBe(0);
      expect(c.distinctCount).toBe(0);
    }
    expect(JSON.stringify(stats)).not.toContain('null,"distinctCount":null');
  });

  it('a count that is not a number is null, and no scan is attempted', async () => {
    // "an unavailable estimate returns null, never a wrong number" (06 §4.2).
    const exec = sqliteMock({ count: Number.NaN });
    const stats = await collectSqliteStats(exec, table, { columns });
    expect(stats.rowCountEstimate).toBeNull();
    expect(stats.rowCountExact).toBe(false);
    expect(exec.calls.some((c) => c.includes('row_total'))).toBe(false);
    expect(stats.warnings?.length).toBeGreaterThan(0);
  });

  it('a scan that returns no row leaves every column null rather than throwing', async () => {
    const exec = async (sql: string): Promise<Record<string, unknown>[]> =>
      sql.includes('row_total') ? [] : [{ n: 3 }];
    const stats = await collectSqliteStats(exec, table, { columns });
    expect(stats.rowCountEstimate).toBe(3);
    for (const c of stats.columns) {
      expect(c.nullFraction).toBeNull();
      expect(c.distinctCount).toBeNull();
    }
  });

  it('with no options at all it issues exactly one statement — the count', async () => {
    const exec = sqliteMock({ count: 5 });
    const stats = await collectSqliteStats(exec, table);
    expect(stats).toMatchObject({ rowCountEstimate: 5, rowCountExact: true, columns: [] });
    expect(exec.calls).toHaveLength(1);
    expect(exec.calls[0]).toBe('SELECT count(*) AS n FROM "people"');
  });
});

describe('collectSqliteStats — qualification and sampling limits', () => {
  it('qualifies a non-main schema, and leaves main/public bare', async () => {
    // SQLite has no schema layer in v1, but an ATTACHed database is addressed
    // by name — and both halves have to be quoted.
    const attached = sqliteMock({ count: 1 });
    await collectSqliteStats(attached, { schema: 'analytics', name: 'events' });
    expect(attached.calls[0]).toBe('SELECT count(*) AS n FROM "analytics"."events"');

    for (const schema of ['main', 'public', null]) {
      const exec = sqliteMock({ count: 1 });
      await collectSqliteStats(exec, { schema, name: 'people' });
      expect(exec.calls[0]).toBe('SELECT count(*) AS n FROM "people"');
    }
  });

  it('a non-positive maxValuesPerColumn falls back to the default LIMIT', async () => {
    const exec = sqliteMock({ count: 1, scan: { row_total: 1, nf_0: 0, dc_0: 1 } });
    await collectSqliteStats(exec, table, {
      columns: [{ name: 'city', logicalType: 'text' }],
      sampling: { maxValuesPerColumn: 0 },
    });
    const mcv = exec.calls.find((c) => c.includes('GROUP BY')) ?? '';
    expect(mcv).toContain(`LIMIT ${STATS_DEFAULT_SAMPLE_VALUES}`);
    expect(mcv).not.toContain('LIMIT 0');
  });

  it('coerces every driver value shape into a JSON-safe scalar', async () => {
    // better-sqlite3 hands back bigints (safe-integer mode), Buffers for BLOBs
    // and, through other layers, Dates — none of which may reach the LLM
    // payload as-is. A BLOB is redacted outright.
    const exec = sqliteMock({
      count: 1,
      scan: { row_total: 1, nf_0: 0, dc_0: 5 },
      mcv: {
        note: [
          9007199254740993n,
          Uint8Array.from([1, 2, 3]),
          new Date(Date.UTC(2026, 0, 2, 3, 4, 5)),
          { toString: () => 'custom' },
          'x'.repeat(STATS_SAMPLE_VALUE_MAX_CHARS + 50),
          null,
        ],
      },
    });
    const stats = await collectSqliteStats(exec, table, {
      columns: [{ name: 'note', logicalType: 'text' }],
      sampling: { maxValuesPerColumn: 10 },
    });
    const values = stats.columns[0]?.sampleValues ?? [];
    expect(values.slice(0, 4)).toEqual([
      '9007199254740993',
      '[binary]',
      '2026-01-02T03:04:05.000Z',
      'custom',
    ]);
    expect(values[4]).toHaveLength(STATS_SAMPLE_VALUE_MAX_CHARS);
    expect(values[5]).toBeNull();
  });
});
