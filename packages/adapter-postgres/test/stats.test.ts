// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Offline unit tests for the Postgres statistics collector (06 §4.2). No `pg`
 * driver: a mock executor routes catalog/scan/sampling SQL by shape so the
 * estimate logic (reltuples-vs-exact, pg_stats distinct normalization, scan
 * fallback, capping) and the privacy rules (sample-free default, PII never
 * sampled) are asserted deterministically.
 */
import { describe, expect, it } from 'vitest';

import type { StatsColumnInput } from '@adminium/engine/adapter';

import { collectPostgresStats, normalizePgDistinct } from '../src/stats.js';

interface MockConfig {
  reltuples?: number | null;
  stats?: { attname: string; null_frac: number; n_distinct: number }[];
  count?: number | null;
  scan?: Record<string, unknown>;
  minmax?: Record<string, { lo: unknown; hi: unknown }>;
  mcv?: Record<string, unknown[]>;
}

/** First double-quoted identifier in a statement (the profiled column). */
function firstQuoted(sql: string): string {
  return /"([^"]+)"/.exec(sql)?.[1] ?? '';
}

function pgMock(cfg: MockConfig): ((sql: string) => Promise<Record<string, unknown>[]>) & {
  calls: string[];
} {
  const calls: string[] = [];
  const exec = async (sql: string): Promise<Record<string, unknown>[]> => {
    calls.push(sql);
    if (sql.includes('pg_catalog.pg_class')) return [{ reltuples: cfg.reltuples ?? null }];
    if (sql.includes('pg_catalog.pg_stats')) return cfg.stats ?? [];
    if (sql.includes('count(*)::int8 AS n')) return [{ n: cfg.count ?? null }];
    if (sql.includes('row_total')) return [cfg.scan ?? { row_total: null }];
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

const table = { schema: 'public', name: 'people' };
const columns: StatsColumnInput[] = [
  { name: 'email', logicalType: 'text', piiSuspected: true },
  { name: 'city', logicalType: 'text' },
  { name: 'age', logicalType: 'integer' },
];

describe('normalizePgDistinct', () => {
  it('returns positive estimates verbatim (rounded)', () => {
    expect(normalizePgDistinct(5, 1000)).toBe(5);
    expect(normalizePgDistinct(4.6, 1000)).toBe(5);
  });

  it('scales the negative fraction encoding by the row count', () => {
    expect(normalizePgDistinct(-0.5, 1000)).toBe(500);
    expect(normalizePgDistinct(-1, 42)).toBe(42);
  });

  it('treats 0/null/unknown-rowcount as unknown (null)', () => {
    expect(normalizePgDistinct(0, 1000)).toBeNull();
    expect(normalizePgDistinct(null, 1000)).toBeNull();
    expect(normalizePgDistinct(-0.5, null)).toBeNull();
  });
});

describe('collectPostgresStats — row count', () => {
  it('uses the reltuples estimate for large tables (no COUNT(*))', async () => {
    const exec = pgMock({
      reltuples: 120_000,
      stats: [{ attname: 'city', null_frac: 0.1, n_distinct: 20 }],
    });
    const stats = await collectPostgresStats(exec, table, { columns });
    expect(stats.rowCountEstimate).toBe(120_000);
    expect(stats.rowCountExact).toBe(false);
    expect(exec.calls.some((c) => c.includes('count(*)::int8 AS n'))).toBe(false);
  });

  it('falls back to an exact COUNT(*) for small/stale tables', async () => {
    const exec = pgMock({ reltuples: -1, count: 5, scan: { row_total: 5 } });
    const stats = await collectPostgresStats(exec, table, { columns: [] });
    expect(stats.rowCountEstimate).toBe(5);
    expect(stats.rowCountExact).toBe(true);
    expect(exec.calls.some((c) => c.includes('count(*)::int8 AS n'))).toBe(true);
  });
});

describe('collectPostgresStats — per-column estimates', () => {
  it('reads null-fraction + distinct from pg_stats when analyzed (no scan)', async () => {
    const exec = pgMock({
      reltuples: 200_000,
      stats: [
        { attname: 'email', null_frac: 0.02, n_distinct: -1 },
        { attname: 'city', null_frac: 0.25, n_distinct: -0.5 },
        { attname: 'age', null_frac: 0, n_distinct: 88 },
      ],
    });
    const stats = await collectPostgresStats(exec, table, { columns });
    const city = stats.columns.find((c) => c.column === 'city');
    expect(city?.nullFraction).toBe(0.25);
    expect(city?.distinctCount).toBe(100_000); // 0.5 * 200_000
    const age = stats.columns.find((c) => c.column === 'age');
    expect(age?.distinctCount).toBe(88);
    const email = stats.columns.find((c) => c.column === 'email');
    expect(email?.distinctCount).toBe(200_000); // -1 → whole row count
    // Every column was covered by pg_stats → no full-scan, no warning.
    expect(exec.calls.some((c) => c.includes('row_total'))).toBe(false);
    expect(stats.warnings).toBeUndefined();
  });

  it('scans only the un-analyzed columns and caps them when above maxScanRows', async () => {
    const exec = pgMock({
      reltuples: 5_000_000,
      stats: [{ attname: 'city', null_frac: 0.25, n_distinct: 3 }],
    });
    const stats = await collectPostgresStats(exec, table, { columns, maxScanRows: 1_000_000 });
    // city came from pg_stats; email/age exceed the scan cap → null + warning.
    expect(stats.columns.find((c) => c.column === 'city')?.distinctCount).toBe(3);
    expect(stats.columns.find((c) => c.column === 'email')?.distinctCount).toBeNull();
    expect(stats.columns.find((c) => c.column === 'age')?.nullFraction).toBeNull();
    expect(stats.warnings?.length).toBeGreaterThan(0);
    expect(exec.calls.some((c) => c.includes('row_total'))).toBe(false);
  });

  it('scans for null-fraction + distinct when pg_stats is empty (small table)', async () => {
    const exec = pgMock({
      reltuples: 0,
      count: 5,
      scan: { row_total: 5, nf_0: 1, dc_0: 4, nf_1: 1, dc_1: 2, nf_2: 1, dc_2: 3 },
    });
    const stats = await collectPostgresStats(exec, table, { columns });
    const city = stats.columns.find((c) => c.column === 'city');
    expect(city?.nullFraction).toBeCloseTo(0.2);
    expect(city?.distinctCount).toBe(2);
    expect(stats.warnings).toBeUndefined();
  });

  it('caps per-column stats to null (with a warning) above maxScanRows', async () => {
    const exec = pgMock({ reltuples: 5_000_000 });
    const stats = await collectPostgresStats(exec, table, { columns, maxScanRows: 1_000_000 });
    expect(stats.rowCountEstimate).toBe(5_000_000);
    for (const c of stats.columns) {
      expect(c.nullFraction).toBeNull();
      expect(c.distinctCount).toBeNull();
    }
    expect(stats.warnings?.length).toBeGreaterThan(0);
    expect(exec.calls.some((c) => c.includes('row_total'))).toBe(false);
  });
});

describe('collectPostgresStats — privacy', () => {
  it('is sample-free by default: no min/max, no sampleValues, sampled=false', async () => {
    const exec = pgMock({ reltuples: 0, count: 5, scan: { row_total: 5 } });
    const stats = await collectPostgresStats(exec, table, { columns });
    expect(stats.sampled).toBe(false);
    for (const c of stats.columns) {
      expect(c.min).toBeUndefined();
      expect(c.max).toBeUndefined();
      expect(c.sampleValues).toBeUndefined();
    }
    // No GROUP BY / min-max query was ever issued.
    expect(exec.calls.some((c) => c.includes('GROUP BY') || /min\(/.test(c))).toBe(false);
  });

  it('under sampling opt-in, never samples PII columns and never queries them', async () => {
    const exec = pgMock({
      reltuples: 0,
      count: 5,
      scan: { row_total: 5, nf_0: 1, dc_0: 4, nf_1: 1, dc_1: 2, nf_2: 1, dc_2: 3 },
      minmax: { age: { lo: 25, hi: 50 } },
      mcv: { city: ['Paris', 'Berlin'], age: [30, 40] },
    });
    const stats = await collectPostgresStats(exec, table, {
      columns,
      sampling: { maxValuesPerColumn: 10 },
    });
    expect(stats.sampled).toBe(true);

    const email = stats.columns.find((c) => c.column === 'email');
    expect(email?.sampleValues).toBeUndefined();
    expect(email?.min).toBeUndefined();
    expect(email?.max).toBeUndefined();

    const city = stats.columns.find((c) => c.column === 'city');
    expect(city?.sampleValues).toEqual(['Paris', 'Berlin']);
    expect(city?.min).toBeUndefined(); // text is not an ordered type

    const age = stats.columns.find((c) => c.column === 'age');
    expect(age?.min).toBe(25);
    expect(age?.max).toBe(50);
    expect(age?.sampleValues).toEqual([30, 40]);

    // The PII column is never referenced by a sampling query.
    const sampledEmail = exec.calls.some(
      (c) => (c.includes('GROUP BY') || /min\(/.test(c)) && c.includes('"email"'),
    );
    expect(sampledEmail).toBe(false);
  });
});
