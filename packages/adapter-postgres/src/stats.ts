// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Postgres table-statistics collector — 06-llm-assist.md §4.2.
 *
 * Cheap-first strategy (sample-free by default): row-count from
 * `pg_class.reltuples` with an exact `COUNT(*)` fallback for small/stale
 * tables; per-column null-fraction and distinct-count from `pg_stats` when the
 * table has been analyzed, else a single bounded full-scan of aggregates
 * (`SUM(col IS NULL)`, `COUNT(DISTINCT col)`) — aggregates only, never a cell
 * value. `pg_stats.most_common_vals` is row data and is deliberately never
 * read: concrete values appear ONLY under the sampling opt-in, and NEVER for
 * PII-suspected or secret columns.
 *
 * Executor-agnostic (like introspect.ts): takes a `sql → rows` runner so the
 * logic is unit-testable without the `pg` driver.
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

/** Any `sql → rows` runner (the pg data pool in production). */
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

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function clampFraction(value: number | null): number | null {
  if (value === null) return null;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Normalize `pg_stats.n_distinct`: `>0` is an absolute estimate, `<0` is the
 * negative fraction of the row count, `0`/absent means unknown.
 */
export function normalizePgDistinct(nDistinct: number | null, rowCount: number | null): number | null {
  if (nDistinct === null || nDistinct === 0) return null;
  if (nDistinct > 0) return Math.round(nDistinct);
  if (rowCount === null) return null;
  return Math.round(Math.abs(nDistinct) * rowCount);
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
    return `sum(CASE WHEN ${q} IS NULL THEN 1 ELSE 0 END)::int8 AS nf_${k}, count(DISTINCT ${q})::int8 AS dc_${k}`;
  });
  const cols = parts.length > 0 ? `, ${parts.join(', ')}` : '';
  return `SELECT count(*)::int8 AS row_total${cols} FROM ${qualified}`;
}

export async function collectPostgresStats(
  exec: StatsExecutor,
  table: TableRef,
  opts: CollectStatsOptions = {},
): Promise<StatsResult> {
  const schema = table.schema ?? 'public';
  const name = table.name;
  const qualified = `${quoteIdentifier(schema)}.${quoteIdentifier(name)}`;
  const columns = opts.columns ?? [];
  const sampling = opts.sampling ?? null;
  const maxScanRows = opts.maxScanRows ?? STATS_MAX_SCAN_ROWS;
  const warnings: string[] = [];

  // 1. Row-count estimate from the catalog, exact COUNT for small/stale tables.
  const relRows = await exec(
    `SELECT c.reltuples::float8 AS reltuples
     FROM pg_catalog.pg_class c
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = ${literal(schema)} AND c.relname = ${literal(name)}
     LIMIT 1`,
  );
  const reltuples = num(relRows[0]?.['reltuples']);
  let rowCountEstimate: number | null;
  let rowCountExact: boolean;
  if (reltuples !== null && reltuples >= STATS_EXACT_COUNT_THRESHOLD) {
    rowCountEstimate = Math.round(reltuples);
    rowCountExact = false;
  } else {
    // reltuples null / negative (never analyzed) / below threshold → exact count.
    const countRows = await exec(`SELECT count(*)::int8 AS n FROM ${qualified}`);
    rowCountEstimate = num(countRows[0]?.['n']);
    rowCountExact = rowCountEstimate !== null;
  }

  // 2. Cheap per-column stats from pg_stats (never most_common_vals — row data).
  const statByCol = new Map<string, { nullFrac: number | null; nDistinct: number | null }>();
  if (columns.length > 0) {
    const statRows = await exec(
      `SELECT attname, null_frac::float8 AS null_frac, n_distinct::float8 AS n_distinct
       FROM pg_catalog.pg_stats
       WHERE schemaname = ${literal(schema)} AND tablename = ${literal(name)}`,
    );
    for (const row of statRows) {
      const attname = str(row['attname']);
      if (attname === null) continue;
      statByCol.set(attname, {
        nullFrac: num(row['null_frac']),
        nDistinct: num(row['n_distinct']),
      });
    }
  }

  const colStats: ColumnStats[] = columns.map((c) => ({
    column: c.name,
    nullFraction: null,
    distinctCount: null,
  }));
  const uncovered: number[] = [];
  columns.forEach((c, i) => {
    const covered = statByCol.get(c.name);
    if (covered !== undefined) {
      colStats[i]!.nullFraction = clampFraction(covered.nullFrac);
      colStats[i]!.distinctCount = normalizePgDistinct(covered.nDistinct, rowCountEstimate);
    } else {
      uncovered.push(i);
    }
  });

  // 3. Full-scan fallback for un-analyzed columns on tables under the cap.
  if (uncovered.length > 0) {
    const scannable = rowCountEstimate !== null && rowCountEstimate <= maxScanRows;
    if (scannable) {
      const scanRows = await exec(
        buildNullDistinctScan(
          qualified,
          uncovered.map((i) => columns[i]!.name),
        ),
      );
      const row = scanRows[0] ?? {};
      const total = num(row['row_total']);
      uncovered.forEach((ci, k) => {
        const nulls = num(row[`nf_${k}`]);
        colStats[ci]!.nullFraction =
          total === null || total === 0 ? (total === 0 ? 0 : null) : nulls === null ? null : nulls / total;
        colStats[ci]!.distinctCount = num(row[`dc_${k}`]);
      });
    } else {
      warnings.push(
        `null-fraction/distinct-count skipped for ${uncovered.length} column(s): table exceeds maxScanRows and lacks analyzed statistics`,
      );
    }
  }

  // 4. Sampling opt-in — most-common values + ordered min/max; never PII/secret.
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
        // No ::text cast — ordered types are numeric/temporal; the driver
        // returns numbers/dates that toScalar keeps JSON-native (bigint/decimal
        // arrive as strings for lossless transport).
        const mm = await exec(`SELECT min(${q}) AS lo, max(${q}) AS hi FROM ${qualified}`);
        colStats[i]!.min = toScalar(mm[0]?.['lo']);
        colStats[i]!.max = toScalar(mm[0]?.['hi']);
        sampled = true;
      }
      const mcv = await exec(
        `SELECT ${q}::text AS v, count(*)::int8 AS c
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
