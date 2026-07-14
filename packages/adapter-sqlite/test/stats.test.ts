/**
 * Offline unit tests for the SQLite statistics collector (06 §4.2). No
 * better-sqlite3 binding: a mock executor routes count/scan/sampling SQL by
 * shape so the estimate logic (exact count, scan fallback, capping) and the
 * privacy rules (sample-free default, PII never sampled) are asserted
 * deterministically.
 */
import { describe, expect, it } from 'vitest';

import type { StatsColumnInput } from '@adminium/engine/adapter';

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
