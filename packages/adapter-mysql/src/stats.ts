// SPDX-License-Identifier: AGPL-3.0-only
/**
 * MySQL table-statistics collector — 06-llm-assist.md §4.2.
 *
 * Cheap-first strategy (sample-free by default): row-count from
 * `information_schema.TABLES.TABLE_ROWS` (the InnoDB estimate) with an exact
 * `COUNT(*)` fallback for small/stale tables. MySQL exposes no cheap
 * per-column statistics catalog, so null-fraction and distinct-count come from
 * a single bounded full-scan of aggregates (`SUM(col IS NULL)`,
 * `COUNT(DISTINCT col)`) — aggregates only, never a cell value — and tables
 * above `maxScanRows` degrade to `null` rather than a wrong number. Concrete
 * values appear ONLY under the sampling opt-in, and NEVER for PII-suspected or
 * secret columns.
 *
 * Executor-agnostic (like introspect.ts): takes a `sql → rows` runner so the
 * logic is unit-testable without the `mysql2` driver.
 */
import type {
  CollectStatsOptions,
  ColumnStats,
  LogicalType,
  StatsResult,
  StatsScalar,
  TableRef,
} from '@adminium/engine/adapter';
import {
  STATS_DEFAULT_SAMPLE_VALUES,
  STATS_EXACT_COUNT_THRESHOLD,
  STATS_MAX_SCAN_ROWS,
  STATS_SAMPLE_VALUE_MAX_CHARS,
} from '@adminium/engine/adapter';

import { quoteIdentifier } from './serialization.js';

/** Any `sql → rows` runner (the mysql2 data pool in production). */
export type StatsExecutor = (sql: string) => Promise<Record<string, unknown>[]>;

/** Ordered logical types eligible for min/max under sampling opt-in. */
const ORDERED_TYPES: ReadonlySet<LogicalType> = new Set<LogicalType>([
  'integer',
  'bigint',
  'decimal',
  'float',
  'date',
  'time',
  'timestamp',
  'timestamptz',
]);

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function toScalar(value: unknown): StatsScalar {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return '[binary]';
  return String(value);
}

function truncate(value: StatsScalar): StatsScalar {
  if (typeof value === 'string' && value.length > STATS_SAMPLE_VALUE_MAX_CHARS) {
    return value.slice(0, STATS_SAMPLE_VALUE_MAX_CHARS);
  }
  return value;
}

/** One batched full-scan: `COUNT(*)` + per-column null count + distinct count. */
function buildNullDistinctScan(qualified: string, columns: readonly string[]): string {
  const parts = columns.map((name, k) => {
    const q = quoteIdentifier(name);
    return `sum(${q} IS NULL) AS nf_${k}, count(DISTINCT ${q}) AS dc_${k}`;
  });
  const cols = parts.length > 0 ? `, ${parts.join(', ')}` : '';
  return `SELECT count(*) AS row_total${cols} FROM ${qualified}`;
}

export async function collectMysqlStats(
  exec: StatsExecutor,
  table: TableRef,
  opts: CollectStatsOptions = {},
): Promise<StatsResult> {
  const name = table.name;
  // MySQL has no schema layer — the pool is bound to one database. Qualify with
  // the explicit schema when present, else the current database.
  const qualified =
    table.schema !== null
      ? `${quoteIdentifier(table.schema)}.${quoteIdentifier(name)}`
      : quoteIdentifier(name);
  const schemaExpr = table.schema !== null ? literal(table.schema) : 'DATABASE()';
  const columns = opts.columns ?? [];
  const sampling = opts.sampling ?? null;
  const maxScanRows = opts.maxScanRows ?? STATS_MAX_SCAN_ROWS;
  const warnings: string[] = [];

  // 1. Row-count estimate from information_schema, exact COUNT for small tables.
  const infoRows = await exec(
    `SELECT TABLE_ROWS AS table_rows
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ${schemaExpr} AND TABLE_NAME = ${literal(name)}
     LIMIT 1`,
  );
  const tableRows = num(infoRows[0]?.['table_rows']);
  let rowCountEstimate: number | null;
  let rowCountExact: boolean;
  if (tableRows !== null && tableRows >= STATS_EXACT_COUNT_THRESHOLD) {
    rowCountEstimate = Math.round(tableRows);
    rowCountExact = false;
  } else {
    const countRows = await exec(`SELECT count(*) AS n FROM ${qualified}`);
    rowCountEstimate = num(countRows[0]?.['n']);
    rowCountExact = rowCountEstimate !== null;
  }

  // 2. Per-column null-fraction + distinct-count via one bounded full-scan.
  const colStats: ColumnStats[] = columns.map((c) => ({
    column: c.name,
    nullFraction: null,
    distinctCount: null,
  }));
  if (columns.length > 0) {
    const scannable = rowCountEstimate !== null && rowCountEstimate <= maxScanRows;
    if (scannable) {
      const scanRows = await exec(
        buildNullDistinctScan(
          qualified,
          columns.map((c) => c.name),
        ),
      );
      const row = scanRows[0] ?? {};
      const total = num(row['row_total']);
      columns.forEach((_c, k) => {
        const nulls = num(row[`nf_${k}`]);
        colStats[k]!.nullFraction =
          total === null || total === 0 ? (total === 0 ? 0 : null) : nulls === null ? null : nulls / total;
        colStats[k]!.distinctCount = num(row[`dc_${k}`]);
      });
    } else {
      warnings.push(
        `null-fraction/distinct-count skipped for ${columns.length} column(s): table exceeds maxScanRows`,
      );
    }
  }

  // 3. Sampling opt-in — most-common values + ordered min/max; never PII/secret.
  let sampled = false;
  if (sampling !== null) {
    const maxValues =
      sampling.maxValuesPerColumn > 0
        ? Math.floor(sampling.maxValuesPerColumn)
        : STATS_DEFAULT_SAMPLE_VALUES;
    for (let i = 0; i < columns.length; i += 1) {
      const c = columns[i]!;
      if (c.piiSuspected === true || c.secret === true) continue; // NEVER sample PII/secret.
      const q = quoteIdentifier(c.name);
      if (ORDERED_TYPES.has(c.logicalType)) {
        const mm = await exec(`SELECT min(${q}) AS lo, max(${q}) AS hi FROM ${qualified}`);
        colStats[i]!.min = toScalar(mm[0]?.['lo']);
        colStats[i]!.max = toScalar(mm[0]?.['hi']);
        sampled = true;
      }
      const mcv = await exec(
        `SELECT ${q} AS v, count(*) AS c
         FROM ${qualified}
         WHERE ${q} IS NOT NULL
         GROUP BY ${q}
         ORDER BY count(*) DESC, ${q}
         LIMIT ${maxValues}`,
      );
      colStats[i]!.sampleValues = mcv.map((r) => truncate(toScalar(r['v'])));
      sampled = true;
    }
  }

  const result: StatsResult = {
    table: { schema: table.schema, name },
    rowCountEstimate,
    rowCountExact,
    columns: colStats,
    sampled,
  };
  if (warnings.length > 0) result.warnings = warnings;
  return result;
}
