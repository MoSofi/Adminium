/**
 * SQLite table-statistics collector — 06-llm-assist.md §4.2.
 *
 * SQLite is a local file with no server round trip, so an exact `COUNT(*)` is
 * cheap enough to be the row-count of record (`rowCountExact: true`).
 * Per-column null-fraction and distinct-count come from a single bounded
 * full-scan of aggregates (`SUM(col IS NULL)`, `COUNT(DISTINCT col)`) —
 * aggregates only, never a cell value — with tables above `maxScanRows`
 * degrading to `null` rather than a wrong number. Concrete values appear ONLY
 * under the sampling opt-in, and NEVER for PII-suspected or secret columns.
 *
 * Executor-agnostic (like introspect.ts): takes a `sql → rows` runner so the
 * logic is unit-testable without the better-sqlite3 binding.
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
  STATS_MAX_SCAN_ROWS,
  STATS_SAMPLE_VALUE_MAX_CHARS,
} from '@adminium/engine/adapter';

import { quoteIdentifier } from './serialization.js';

/** Any `sql → rows` runner (the better-sqlite3 handle in production). */
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
    return `sum(CASE WHEN ${q} IS NULL THEN 1 ELSE 0 END) AS nf_${k}, count(DISTINCT ${q}) AS dc_${k}`;
  });
  const cols = parts.length > 0 ? `, ${parts.join(', ')}` : '';
  return `SELECT count(*) AS row_total${cols} FROM ${qualified}`;
}

export async function collectSqliteStats(
  exec: StatsExecutor,
  table: TableRef,
  opts: CollectStatsOptions = {},
): Promise<StatsResult> {
  const name = table.name;
  // SQLite has no schema layer in v1 (main database); qualify only if given.
  const qualified =
    table.schema !== null && table.schema !== 'main' && table.schema !== 'public'
      ? `${quoteIdentifier(table.schema)}.${quoteIdentifier(name)}`
      : quoteIdentifier(name);
  const columns = opts.columns ?? [];
  const sampling = opts.sampling ?? null;
  const maxScanRows = opts.maxScanRows ?? STATS_MAX_SCAN_ROWS;
  const warnings: string[] = [];

  // 1. Exact row count — cheap on a local file (05 §4.3, 06 §4.2).
  const countRows = await exec(`SELECT count(*) AS n FROM ${qualified}`);
  const rowCountEstimate = num(countRows[0]?.['n']);
  const rowCountExact = rowCountEstimate !== null;

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
