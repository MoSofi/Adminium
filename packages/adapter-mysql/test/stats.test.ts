// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Offline unit tests for the MySQL statistics collector (06 §4.2). No `mysql2`
 * driver: a mock executor routes information_schema/scan/sampling SQL by shape
 * so the estimate logic (TABLE_ROWS-vs-exact, scan fallback, capping) and the
 * privacy rules (sample-free default, PII never sampled) are asserted
 * deterministically.
 */
import { describe, expect, it } from 'vitest';

import type { StatsColumnInput } from '@adminium/engine/adapter';

import { collectMysqlStats } from '../src/stats.js';

interface MockConfig {
  tableRows?: number | null;
  count?: number | null;
  scan?: Record<string, unknown>;
  minmax?: Record<string, { lo: unknown; hi: unknown }>;
  mcv?: Record<string, unknown[]>;
}

/** First backtick-quoted identifier in a statement (the profiled column). */
function firstQuoted(sql: string): string {
  return /`([^`]+)`/.exec(sql)?.[1] ?? '';
}

function mysqlMock(cfg: MockConfig): ((sql: string) => Promise<Record<string, unknown>[]>) & {
  calls: string[];
} {
  const calls: string[] = [];
  const exec = async (sql: string): Promise<Record<string, unknown>[]> => {
    calls.push(sql);
    if (sql.includes('information_schema.TABLES')) return [{ table_rows: cfg.tableRows ?? null }];
    if (sql.includes('count(*) AS n')) return [{ n: cfg.count ?? null }];
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

const table = { schema: null, name: 'people' };
const columns: StatsColumnInput[] = [
  { name: 'email', logicalType: 'varchar', piiSuspected: true },
  { name: 'city', logicalType: 'varchar' },
  { name: 'age', logicalType: 'integer' },
];

describe('collectMysqlStats — row count', () => {
  it('uses the TABLE_ROWS estimate for large tables (no COUNT(*))', async () => {
    const exec = mysqlMock({ tableRows: 90_000, scan: { row_total: 90_000 } });
    const stats = await collectMysqlStats(exec, table, { columns: [] });
    expect(stats.rowCountEstimate).toBe(90_000);
    expect(stats.rowCountExact).toBe(false);
    expect(exec.calls.some((c) => c.includes('count(*) AS n'))).toBe(false);
  });

  it('falls back to an exact COUNT(*) for small tables', async () => {
    const exec = mysqlMock({ tableRows: 12, count: 5, scan: { row_total: 5 } });
    const stats = await collectMysqlStats(exec, table, { columns: [] });
    expect(stats.rowCountEstimate).toBe(5);
    expect(stats.rowCountExact).toBe(true);
  });

  it('targets the current database when the table has no schema', async () => {
    const exec = mysqlMock({ tableRows: 3, count: 3, scan: { row_total: 3 } });
    await collectMysqlStats(exec, table, { columns: [] });
    expect(exec.calls[0]).toContain('DATABASE()');
  });
});

describe('collectMysqlStats — per-column estimates', () => {
  it('scans for null-fraction + distinct on a small table', async () => {
    const exec = mysqlMock({
      tableRows: 5,
      count: 5,
      scan: { row_total: 5, nf_0: 1, dc_0: 4, nf_1: 1, dc_1: 2, nf_2: 1, dc_2: 3 },
    });
    const stats = await collectMysqlStats(exec, table, { columns });
    expect(stats.columns.find((c) => c.column === 'city')?.nullFraction).toBeCloseTo(0.2);
    expect(stats.columns.find((c) => c.column === 'city')?.distinctCount).toBe(2);
    expect(stats.warnings).toBeUndefined();
  });

  it('caps per-column stats to null (with a warning) above maxScanRows', async () => {
    const exec = mysqlMock({ tableRows: 2_000_000 });
    const stats = await collectMysqlStats(exec, table, { columns, maxScanRows: 1_000_000 });
    for (const c of stats.columns) {
      expect(c.nullFraction).toBeNull();
      expect(c.distinctCount).toBeNull();
    }
    expect(stats.warnings?.length).toBeGreaterThan(0);
    expect(exec.calls.some((c) => c.includes('row_total'))).toBe(false);
  });
});

describe('collectMysqlStats — privacy', () => {
  it('is sample-free by default: no min/max, no sampleValues, sampled=false', async () => {
    const exec = mysqlMock({ tableRows: 5, count: 5, scan: { row_total: 5 } });
    const stats = await collectMysqlStats(exec, table, { columns });
    expect(stats.sampled).toBe(false);
    for (const c of stats.columns) {
      expect(c.min).toBeUndefined();
      expect(c.max).toBeUndefined();
      expect(c.sampleValues).toBeUndefined();
    }
    expect(exec.calls.some((c) => c.includes('GROUP BY') || /min\(/.test(c))).toBe(false);
  });

  it('under sampling opt-in, never samples PII columns and never queries them', async () => {
    const exec = mysqlMock({
      tableRows: 5,
      count: 5,
      scan: { row_total: 5, nf_0: 1, dc_0: 4, nf_1: 1, dc_1: 2, nf_2: 1, dc_2: 3 },
      minmax: { age: { lo: 25, hi: 50 } },
      mcv: { city: ['Paris', 'Berlin'], age: [30, 40] },
    });
    const stats = await collectMysqlStats(exec, table, {
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
      (c) => (c.includes('GROUP BY') || /min\(/.test(c)) && c.includes('`email`'),
    );
    expect(sampledEmail).toBe(false);
  });
});

describe('collectMysqlStats — table qualification', () => {
  it('qualifies with an explicit schema when one is given', async () => {
    const exec = mysqlMock({ tableRows: 0, count: 3 });
    const stats = await collectMysqlStats(exec, { schema: 'shop', name: 'people' }, {});

    expect(exec.calls[0]).toContain("TABLE_SCHEMA = 'shop'");
    expect(exec.calls.some((c) => c.includes('`shop`.`people`'))).toBe(true);
    expect(stats.table).toEqual({ schema: 'shop', name: 'people' });
  });

  it('falls back to DATABASE() when the pool is bound to one database', async () => {
    // MySQL has no schema layer; a null schema means "whatever the DSN named".
    const exec = mysqlMock({ tableRows: 0, count: 3 });
    await collectMysqlStats(exec, { schema: null, name: 'people' }, {});

    expect(exec.calls[0]).toContain('TABLE_SCHEMA = DATABASE()');
    expect(exec.calls[0]).not.toContain('DATABASE()`');
    expect(exec.calls.some((c) => c.includes('FROM `people`'))).toBe(true);
  });

  it('escapes quotes and backticks rather than breaking out of the statement', async () => {
    const exec = mysqlMock({ tableRows: 0, count: 0 });
    await collectMysqlStats(exec, { schema: "o'brien", name: 'we`ird' }, {});

    expect(exec.calls[0]).toContain("'o''brien'");
    expect(exec.calls.some((c) => c.includes('`we``ird`'))).toBe(true);
  });

  it('profiles no columns when none are asked for', async () => {
    const exec = mysqlMock({ tableRows: 0, count: 3 });
    const stats = await collectMysqlStats(exec, table);

    expect(stats.columns).toEqual([]);
    expect(stats.sampled).toBe(false);
    // No scan is issued for zero columns.
    expect(exec.calls.some((c) => c.includes('row_total'))).toBe(false);
  });

  it('applies the default scan cap when maxScanRows is omitted', async () => {
    const exec = mysqlMock({ tableRows: 1_000_001 });
    const stats = await collectMysqlStats(exec, table, { columns });

    expect(exec.calls.some((c) => c.includes('row_total'))).toBe(false);
    expect(stats.warnings?.[0]).toContain('maxScanRows');
  });
});

describe('collectMysqlStats — defensive row coercion', () => {
  it('treats a non-numeric TABLE_ROWS as unknown and counts exactly instead', async () => {
    const exec = mysqlMock({ tableRows: Number.NaN, count: 7 });
    const stats = await collectMysqlStats(exec, table, { columns: [] });
    expect(stats.rowCountEstimate).toBe(7);
    expect(stats.rowCountExact).toBe(true);
  });

  it('reports rowCountExact=false when even the exact COUNT comes back empty', async () => {
    const exec = mysqlMock({ tableRows: null, count: null });
    const stats = await collectMysqlStats(exec, table, { columns: [] });
    expect(stats.rowCountEstimate).toBeNull();
    expect(stats.rowCountExact).toBe(false);
  });

  it('reports 0 null-fraction for an empty table rather than dividing by zero', async () => {
    const exec = mysqlMock({
      tableRows: 0,
      count: 0,
      scan: { row_total: 0, nf_0: 0, dc_0: 0, nf_1: 0, dc_1: 0, nf_2: 0, dc_2: 0 },
    });
    const stats = await collectMysqlStats(exec, table, { columns });
    for (const c of stats.columns) {
      expect(c.nullFraction).toBe(0); // not NaN
      expect(c.distinctCount).toBe(0);
    }
  });

  it('leaves stats unknown when the scan returns an EMPTY result set', async () => {
    const base = mysqlMock({ tableRows: 0, count: 5 });
    const exec = Object.assign(
      async (sql: string): Promise<Record<string, unknown>[]> =>
        sql.includes('row_total') ? [] : base(sql),
      { calls: base.calls },
    );
    const stats = await collectMysqlStats(exec, table, { columns });
    for (const c of stats.columns) {
      expect(c.nullFraction).toBeNull();
      expect(c.distinctCount).toBeNull();
    }
  });

  it('leaves one column unknown when only its null count is missing', async () => {
    const exec = mysqlMock({
      tableRows: 0,
      count: 10,
      scan: { row_total: 10, dc_0: 4, nf_1: 5, dc_1: 2, nf_2: 0, dc_2: 3 },
    });
    const stats = await collectMysqlStats(exec, table, { columns });
    expect(stats.columns.find((c) => c.column === 'email')?.nullFraction).toBeNull();
    expect(stats.columns.find((c) => c.column === 'email')?.distinctCount).toBe(4);
    expect(stats.columns.find((c) => c.column === 'city')?.nullFraction).toBe(0.5);
  });
});

describe('collectMysqlStats — sample value coercion', () => {
  const sampled: StatsColumnInput[] = [{ name: 'v', logicalType: 'varchar' }];
  const ordered: StatsColumnInput[] = [{ name: 'n', logicalType: 'bigint' }];

  it('keeps JSON-native scalars as themselves', async () => {
    const exec = mysqlMock({
      tableRows: 0,
      count: 3,
      scan: { row_total: 3, nf_0: 0, dc_0: 3 },
      mcv: { v: ['text', 42, true, null] },
    });
    const stats = await collectMysqlStats(exec, table, {
      columns: sampled,
      sampling: { maxValuesPerColumn: 10 },
    });
    expect(stats.columns[0]!.sampleValues).toEqual(['text', 42, true, null]);
  });

  it('stringifies a bigint so an UNSIGNED BIGINT bound survives transport', async () => {
    const exec = mysqlMock({
      tableRows: 0,
      count: 1,
      scan: { row_total: 1, nf_0: 0, dc_0: 1 },
      minmax: { n: { lo: 0n, hi: 18446744073709551615n } },
      mcv: { n: [] },
    });
    const stats = await collectMysqlStats(exec, table, {
      columns: ordered,
      sampling: { maxValuesPerColumn: 10 },
    });
    expect(stats.columns[0]!.min).toBe('0');
    expect(stats.columns[0]!.max).toBe('18446744073709551615');
  });

  it('renders a Date as ISO-8601 and never leaks a raw buffer', async () => {
    const exec = mysqlMock({
      tableRows: 0,
      count: 2,
      scan: { row_total: 2, nf_0: 0, dc_0: 2 },
      mcv: { v: [new Date(Date.UTC(2024, 2, 5)), new Uint8Array([1, 2, 3])] },
    });
    const stats = await collectMysqlStats(exec, table, {
      columns: sampled,
      sampling: { maxValuesPerColumn: 10 },
    });
    // A BLOB sample would be both useless and a data-leak risk.
    expect(stats.columns[0]!.sampleValues).toEqual(['2024-03-05T00:00:00.000Z', '[binary]']);
  });

  it('coerces an unexpected object to a string rather than emitting it raw', async () => {
    const exec = mysqlMock({
      tableRows: 0,
      count: 1,
      scan: { row_total: 1, nf_0: 0, dc_0: 1 },
      mcv: { v: [{ toString: () => 'POINT(1 2)' }] },
    });
    const stats = await collectMysqlStats(exec, table, {
      columns: sampled,
      sampling: { maxValuesPerColumn: 10 },
    });
    expect(stats.columns[0]!.sampleValues).toEqual(['POINT(1 2)']);
  });

  it('truncates a long sample value at the cap and leaves a short one alone', async () => {
    const long = 'x'.repeat(400);
    const exec = mysqlMock({
      tableRows: 0,
      count: 2,
      scan: { row_total: 2, nf_0: 0, dc_0: 2 },
      mcv: { v: [long, 'short'] },
    });
    const stats = await collectMysqlStats(exec, table, {
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
    const exec = mysqlMock({
      tableRows: 0,
      count: 1,
      scan: { row_total: 1, nf_0: 0, dc_0: 1 },
      mcv: { v: [] },
    });
    await collectMysqlStats(exec, table, {
      columns: sampled,
      sampling: { maxValuesPerColumn: max },
    });
    expect(exec.calls.some((c) => c.includes('LIMIT 20'))).toBe(true);
  });

  it('floors a fractional maxValuesPerColumn into a valid LIMIT', async () => {
    const exec = mysqlMock({
      tableRows: 0,
      count: 1,
      scan: { row_total: 1, nf_0: 0, dc_0: 1 },
      mcv: { v: [] },
    });
    await collectMysqlStats(exec, table, {
      columns: sampled,
      sampling: { maxValuesPerColumn: 7.9 },
    });
    // `LIMIT 7.9` is a syntax error in MySQL.
    expect(exec.calls.some((c) => c.includes('LIMIT 7'))).toBe(true);
  });

  it('never samples a secret column, the same as a PII one', async () => {
    const exec = mysqlMock({
      tableRows: 0,
      count: 1,
      scan: { row_total: 1, nf_0: 0, dc_0: 1, nf_1: 0, dc_1: 1 },
      mcv: { token: ['hunter2'], plain: ['ok'] },
    });
    const stats = await collectMysqlStats(exec, table, {
      columns: [
        { name: 'token', logicalType: 'varchar', secret: true },
        { name: 'plain', logicalType: 'varchar' },
      ],
      sampling: { maxValuesPerColumn: 10 },
    });
    expect(stats.columns.find((c) => c.column === 'token')?.sampleValues).toBeUndefined();
    expect(stats.columns.find((c) => c.column === 'plain')?.sampleValues).toEqual(['ok']);
    expect(exec.calls.some((c) => c.includes('`token`') && c.includes('GROUP BY'))).toBe(false);
  });
});
