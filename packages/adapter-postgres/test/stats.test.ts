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

describe('collectPostgresStats — option defaults', () => {
  it('defaults schema to public and profiles no columns when none are asked for', async () => {
    const exec = pgMock({ reltuples: 0, count: 3 });
    const stats = await collectPostgresStats(exec, { schema: null, name: 'people' });

    expect(stats.columns).toEqual([]);
    expect(stats.sampled).toBe(false);
    expect(stats.rowCountEstimate).toBe(3);
    // A null schema must resolve to public, not to an unqualified "".
    expect(exec.calls[0]).toContain("n.nspname = 'public'");
    expect(exec.calls.some((c) => c.includes('"public"."people"'))).toBe(true);
    // schema is echoed back verbatim (null), not the resolved default.
    expect(stats.table).toEqual({ schema: null, name: 'people' });
  });

  it('escapes a quote in the table name rather than breaking out of the literal', async () => {
    const exec = pgMock({ reltuples: 0, count: 0 });
    await collectPostgresStats(exec, { schema: 'pub"lic', name: "o'brien" });

    expect(exec.calls[0]).toContain("'o''brien'");
    expect(exec.calls.some((c) => c.includes('"pub""lic"."o\'brien"'))).toBe(true);
  });

  it('applies the default scan cap when maxScanRows is omitted', async () => {
    // Just over STATS_MAX_SCAN_ROWS (1e6): the scan must be refused.
    const exec = pgMock({ reltuples: 1_000_001 });
    const stats = await collectPostgresStats(exec, table, { columns });

    expect(exec.calls.some((c) => c.includes('row_total'))).toBe(false);
    expect(stats.warnings?.[0]).toContain('maxScanRows');
  });
});

describe('collectPostgresStats — defensive row coercion', () => {
  it('treats a non-numeric reltuples as unknown and counts exactly instead', async () => {
    const exec = pgMock({ reltuples: Number.NaN, count: 7 });
    const stats = await collectPostgresStats(exec, table, { columns: [] });
    expect(stats.rowCountEstimate).toBe(7);
    expect(stats.rowCountExact).toBe(true);
  });

  it('reports rowCountExact=false when even the exact COUNT comes back empty', async () => {
    const exec = pgMock({ reltuples: null, count: null });
    const stats = await collectPostgresStats(exec, table, { columns: [] });
    expect(stats.rowCountEstimate).toBeNull();
    expect(stats.rowCountExact).toBe(false);
  });

  it('ignores a pg_stats row with no usable attname', async () => {
    const exec = pgMock({
      reltuples: 200_000,
      stats: [
        { attname: null as unknown as string, null_frac: 0.5, n_distinct: 9 },
        { attname: '', null_frac: 0.5, n_distinct: 9 },
        { attname: 'city', null_frac: 0.25, n_distinct: 4 },
      ],
    });
    const stats = await collectPostgresStats(exec, table, { columns });
    expect(stats.columns.find((c) => c.column === 'city')?.distinctCount).toBe(4);
    // The unusable rows did not land on some other column.
    expect(stats.columns.find((c) => c.column === 'email')?.nullFraction).toBeNull();
  });

  it('clamps an out-of-range null_frac into [0, 1]', async () => {
    // pg_stats is an estimate; a corrupt or mid-ANALYZE row can read outside
    // the range, and a nullFraction of 1.4 would render as "140% null".
    const exec = pgMock({
      reltuples: 200_000,
      stats: [
        { attname: 'email', null_frac: -0.2, n_distinct: 1 },
        { attname: 'city', null_frac: 1.4, n_distinct: 1 },
        { attname: 'age', null_frac: 0.5, n_distinct: 1 },
      ],
    });
    const stats = await collectPostgresStats(exec, table, { columns });
    expect(stats.columns.find((c) => c.column === 'email')?.nullFraction).toBe(0);
    expect(stats.columns.find((c) => c.column === 'city')?.nullFraction).toBe(1);
    expect(stats.columns.find((c) => c.column === 'age')?.nullFraction).toBe(0.5);
  });

  it('leaves an absent null_frac as unknown rather than 0', async () => {
    const exec = pgMock({
      reltuples: 200_000,
      stats: [{ attname: 'city', null_frac: null as unknown as number, n_distinct: 3 }],
    });
    const stats = await collectPostgresStats(exec, table, { columns });
    expect(stats.columns.find((c) => c.column === 'city')?.nullFraction).toBeNull();
  });

  it('reports 0 null-fraction for an empty table rather than dividing by zero', async () => {
    const exec = pgMock({
      reltuples: 0,
      count: 0,
      scan: { row_total: 0, nf_0: 0, dc_0: 0, nf_1: 0, dc_1: 0, nf_2: 0, dc_2: 0 },
    });
    const stats = await collectPostgresStats(exec, table, { columns });
    for (const c of stats.columns) {
      expect(c.nullFraction).toBe(0); // not NaN
      expect(c.distinctCount).toBe(0);
    }
  });

  it('leaves null-fraction unknown when the scan returns an EMPTY result set', async () => {
    // Not the same as a row of nulls: `scanRows[0]` is undefined here, so the
    // `?? {}` fallback is what keeps this from throwing on a missing row.
    const base = pgMock({ reltuples: 0, count: 5 });
    const exec = Object.assign(
      async (sql: string): Promise<Record<string, unknown>[]> =>
        sql.includes('row_total') ? [] : base(sql),
      { calls: base.calls },
    );
    const stats = await collectPostgresStats(exec, table, { columns });
    for (const c of stats.columns) {
      expect(c.nullFraction).toBeNull();
      expect(c.distinctCount).toBeNull();
    }
  });

  it('leaves null-fraction unknown when the scan row carries no counters', async () => {
    const exec = pgMock({ reltuples: 0, count: 5, scan: {} });
    const stats = await collectPostgresStats(exec, table, { columns });
    for (const c of stats.columns) {
      expect(c.nullFraction).toBeNull();
      expect(c.distinctCount).toBeNull();
    }
  });

  it('leaves one column unknown when only its null count is missing', async () => {
    const exec = pgMock({
      reltuples: 0,
      count: 10,
      scan: { row_total: 10, dc_0: 4, nf_1: 5, dc_1: 2, nf_2: 0, dc_2: 3 },
    });
    const stats = await collectPostgresStats(exec, table, { columns });
    expect(stats.columns.find((c) => c.column === 'email')?.nullFraction).toBeNull();
    expect(stats.columns.find((c) => c.column === 'email')?.distinctCount).toBe(4);
    expect(stats.columns.find((c) => c.column === 'city')?.nullFraction).toBe(0.5);
  });
});

describe('collectPostgresStats — sample value coercion', () => {
  const sampled: StatsColumnInput[] = [{ name: 'v', logicalType: 'text' }];
  const ordered: StatsColumnInput[] = [{ name: 'n', logicalType: 'bigint' }];

  it('keeps JSON-native scalars as themselves', async () => {
    const exec = pgMock({
      reltuples: 0,
      count: 3,
      scan: { row_total: 3, nf_0: 0, dc_0: 3 },
      mcv: { v: ['text', 42, true, null] },
    });
    const stats = await collectPostgresStats(exec, table, {
      columns: sampled,
      sampling: { maxValuesPerColumn: 10 },
    });
    expect(stats.columns[0]!.sampleValues).toEqual(['text', 42, true, null]);
  });

  it('stringifies a bigint so the value survives JSON transport', async () => {
    const exec = pgMock({
      reltuples: 0,
      count: 1,
      scan: { row_total: 1, nf_0: 0, dc_0: 1 },
      minmax: { n: { lo: 1n, hi: 9223372036854775807n } },
      mcv: { n: [] },
    });
    const stats = await collectPostgresStats(exec, table, {
      columns: ordered,
      sampling: { maxValuesPerColumn: 10 },
    });
    expect(stats.columns[0]!.min).toBe('1');
    expect(stats.columns[0]!.max).toBe('9223372036854775807');
  });

  it('renders a Date as ISO-8601 and never leaks a raw buffer', async () => {
    const exec = pgMock({
      reltuples: 0,
      count: 2,
      scan: { row_total: 2, nf_0: 0, dc_0: 2 },
      mcv: { v: [new Date(Date.UTC(2024, 2, 5)), new Uint8Array([1, 2, 3])] },
    });
    const stats = await collectPostgresStats(exec, table, {
      columns: sampled,
      sampling: { maxValuesPerColumn: 10 },
    });
    // A bytea sample would be both useless and a data-leak risk.
    expect(stats.columns[0]!.sampleValues).toEqual(['2024-03-05T00:00:00.000Z', '[binary]']);
  });

  it('coerces an unexpected object to a string rather than emitting it raw', async () => {
    const exec = pgMock({
      reltuples: 0,
      count: 1,
      scan: { row_total: 1, nf_0: 0, dc_0: 1 },
      mcv: { v: [{ toString: () => 'point(1,2)' }] },
    });
    const stats = await collectPostgresStats(exec, table, {
      columns: sampled,
      sampling: { maxValuesPerColumn: 10 },
    });
    expect(stats.columns[0]!.sampleValues).toEqual(['point(1,2)']);
  });

  it('truncates a long sample value at the cap and leaves a short one alone', async () => {
    const long = 'x'.repeat(400);
    const exec = pgMock({
      reltuples: 0,
      count: 2,
      scan: { row_total: 2, nf_0: 0, dc_0: 2 },
      mcv: { v: [long, 'short'] },
    });
    const stats = await collectPostgresStats(exec, table, {
      columns: sampled,
      sampling: { maxValuesPerColumn: 10 },
    });
    expect(stats.columns[0]!.sampleValues?.[0]).toHaveLength(256);
    expect(stats.columns[0]!.sampleValues?.[1]).toBe('short');
  });

  it.each([
    ['zero', 0],
    ['negative', -5],
  ] as const)('falls back to the default LIMIT when maxValuesPerColumn is %s', async (_l, max) => {
    const exec = pgMock({
      reltuples: 0,
      count: 1,
      scan: { row_total: 1, nf_0: 0, dc_0: 1 },
      mcv: { v: [] },
    });
    await collectPostgresStats(exec, table, {
      columns: sampled,
      sampling: { maxValuesPerColumn: max },
    });
    expect(exec.calls.some((c) => c.includes('LIMIT 20'))).toBe(true);
  });

  it('floors a fractional maxValuesPerColumn into a valid LIMIT', async () => {
    const exec = pgMock({
      reltuples: 0,
      count: 1,
      scan: { row_total: 1, nf_0: 0, dc_0: 1 },
      mcv: { v: [] },
    });
    await collectPostgresStats(exec, table, {
      columns: sampled,
      sampling: { maxValuesPerColumn: 7.9 },
    });
    // `LIMIT 7.9` is a syntax error in Postgres.
    expect(exec.calls.some((c) => c.includes('LIMIT 7'))).toBe(true);
  });

  it('never samples a secret column, the same as a PII one', async () => {
    const exec = pgMock({
      reltuples: 0,
      count: 1,
      scan: { row_total: 1, nf_0: 0, dc_0: 1, nf_1: 0, dc_1: 1 },
      mcv: { token: ['hunter2'], plain: ['ok'] },
    });
    const stats = await collectPostgresStats(exec, table, {
      columns: [
        { name: 'token', logicalType: 'text', secret: true },
        { name: 'plain', logicalType: 'text' },
      ],
      sampling: { maxValuesPerColumn: 10 },
    });
    expect(stats.columns.find((c) => c.column === 'token')?.sampleValues).toBeUndefined();
    expect(stats.columns.find((c) => c.column === 'plain')?.sampleValues).toEqual(['ok']);
    expect(exec.calls.some((c) => c.includes('"token"') && c.includes('GROUP BY'))).toBe(false);
  });
});
