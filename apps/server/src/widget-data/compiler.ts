// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Query-descriptor compiler (04-widget-registry.md §5.2, M4-T04 subset).
 *
 * Turns a validated `QueryDescriptor` (the pure-Zod leaf shared through
 * `@adminium/engine/config`) into dynamic Kysely over the data connection.
 * Invariants, identical to the CRUD layer (08-server-api.md §7 item 1):
 *
 * - every table/column string that reaches SQL is the schema snapshot's own
 *   (`SnapshotView` resolution → 422 `UNKNOWN_IDENTIFIER` otherwise);
 * - PII-masked columns may not be selected, filtered, grouped, bucketed,
 *   aggregated, or sorted by callers without the unmask grant → 403
 *   `COLUMN_FORBIDDEN` (04 §5.2 step 3);
 * - all values bind as parameters; the only inlined token is the bucket
 *   unit, drawn from a closed Zod enum.
 *
 * Scope: the compilable shapes are exactly `COMPILABLE_DATA_SHAPES` — now
 * sixteen of the eighteen. `static` and `form-state` are the only two left out,
 * and they are not compiler gaps and never will be: the first is config-only,
 * the second is fed by the CRUD form path.
 *
 * Four shapes have TWO descriptor forms, because an introspected database
 * expresses them either way and picking one would strand half the tables:
 *
 * - `hierarchy/tree` — an adjacency projection (`select: [id, label, parent,
 *   …meta]`) for a self-referencing table, or a two-key `groupBy` rollup whose
 *   aggregate is the leaf value (what `chart-sunburst` wants);
 * - `geo-points` — a coordinate/region projection, or a one-key `groupBy`
 *   rollup keyed on a region code (what `chart-choropleth-grid` wants);
 * - `ohlc` — a `bucket` over a tick/price column, folded into candles in
 *   process, or a table that already stores `[t, o, h, l, c]` columns;
 * - `flows` and `boolean-map` have one form each (a two-key rollup and a
 *   `[key, flag]` projection).
 *
 * Which form a descriptor is in decides whether it projects ROWS, so it also
 * decides whether the shaper must mask — see {@link isRowShape}.
 *
 * Dialect divergence (04 §5.2 step 4): time bucketing, rolling-window bounds
 * and quantiles are the three clauses whose SQL differs per engine. Rather
 * than a kysely-typed adapter hook (the `@adminium/engine/adapter`
 * `QueryEngine` contract must stay free of a `kysely` dependency — it types
 * the dialect opaquely), the compiler branches on the connection's engine
 * here, where kysely and the rest of the SQL compilation already live:
 * `bucketExpr()` emits `date_trunc` / `strftime` / `DATE_FORMAT` per dialect;
 * window boundaries bind as a `Date` on Postgres but as a UTC `'YYYY-MM-DD
 * HH:MM:SS'` string on MySQL/SQLite (better-sqlite3 refuses to bind a
 * `Date`); and `percentileExpr()` emits `percentile_cont` where the engine has
 * it and otherwise arms the in-process scan described at
 * {@link PERCENTILE_SCAN_MAX}.
 */

import { sql, type DynamicModule, type Kysely, type RawBuilder, type SelectQueryBuilder } from 'kysely';
import { COMPILABLE_DATA_SHAPES } from '@adminium/engine/config';
import type { Aggregation, BucketUnit, QueryDescriptor } from '@adminium/engine/config';
import type { Dialect } from '@adminium/engine';

import { ValidationFailedError } from '../errors.js';
import type { SourceDatabase } from '../connections/manager.js';
import { compileFilter, type CompileFilterContext, type FilterCondition } from '../crud/filters.js';
import type { ResolvedColumn, ResolvedTable, SnapshotView } from '../crud/identifiers.js';

/** Hard row cap on any compiled query (04 §5.2 guardrails). */
export const WIDGET_LIMIT_MAX = 1000;
/** Default page size for `record-list` descriptors without a `limit`. */
export const RECORD_LIST_LIMIT_DEFAULT = 50;
/** Group-by cardinality cap — excess folds into `__other` (04 §5.2). */
export const GROUP_BUCKET_CAP = 500;

/**
 * Row cap on the in-process quantile scan — the ONE deliberate exception to
 * {@link WIDGET_LIMIT_MAX}. SQLite has no percentile function at all and
 * MySQL 8 has no `percentile_cont`, so on those engines a quantile request
 * compiles to a plain projection of the value column which the shaper sorts
 * and interpolates. Bounded so a wide table cannot pull an unbounded scan into
 * the node heap; past the cap the quantiles are of the scanned prefix, which
 * the shaper reports through `truncated`.
 */
export const PERCENTILE_SCAN_MAX = 50_000;

/**
 * Row cap on the in-process candle fold, the second deliberate exception to
 * {@link WIDGET_LIMIT_MAX} and for the same reason. A bucketed `ohlc`
 * descriptor cannot be answered by `GROUP BY` alone: `high`/`low` are `max`/
 * `min`, but `open`/`close` are the FIRST and LAST value in each bucket by
 * time, which no dialect expresses portably (window functions on Postgres and
 * MySQL 8, nothing on SQLite). So the compiler projects `(bucket, value)`
 * ordered by the raw time column and the shaper folds candles in one pass.
 */
export const OHLC_SCAN_MAX = 50_000;

/** Reserved output aliases the shaper relies on. */
export const BUCKET_ALIAS = '__bucket';
export const GROUP_ALIAS = '__group';
/** Second group-by key — `matrix` column headers. */
export const COL_ALIAS = '__col';
/** Raw value projection backing an in-process quantile scan. */
export const VALUE_ALIAS = '__value';

/**
 * The five quantiles a `distribution` envelope carries (04 §3
 * `{min, q1, med, q3, max}`). `percentile_cont(0)` / `(1)` are exactly `min` /
 * `max`, so the whole envelope is one uniform quantile request — the same list
 * drives the native SQL path and the in-process scan.
 */
export const DISTRIBUTION_QUANTILES: readonly { alias: string; p: number; key: DistributionKey }[] = [
  { alias: '__d_min', p: 0, key: 'min' },
  { alias: '__d_q1', p: 0.25, key: 'q1' },
  { alias: '__d_med', p: 0.5, key: 'med' },
  { alias: '__d_q3', p: 0.75, key: 'q3' },
  { alias: '__d_max', p: 1, key: 'max' },
];

export type DistributionKey = 'min' | 'q1' | 'med' | 'q3' | 'max';

const ALIAS_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/;

/**
 * Derived from the shared `COMPILABLE_DATA_SHAPES` constant rather than listed
 * here, so this compiler and the enrichment prompt's widget allow-list cannot
 * disagree about which shapes exist. (`stream` is the live-feed snapshot of
 * 04 §5.3: compiled exactly like `record-list` — recent rows, DESC — then shaped
 * into a `StreamShape` with the resolved WS channel.)
 */
const SUPPORTED_SHAPES: ReadonlySet<string> = new Set<string>(COMPILABLE_DATA_SHAPES);

/**
 * Shapes that ALWAYS project table rows rather than aggregates. See
 * {@link isRowShape} for the ones that project rows only in one of their two
 * descriptor forms.
 */
const ALWAYS_ROW_SHAPES: ReadonlySet<string> = new Set<string>([
  'record-list',
  'record',
  'stream',
  'calendar-events',
  'boolean-map',
]);

/**
 * Does this descriptor project table rows rather than aggregates?
 *
 * Row-bearing descriptors share one compilation path and — critically — one
 * PII rule: every one of them routes its rows through `maskRows` in the shaper,
 * because a masked column reaches the payload whenever the descriptor omits
 * `select` and the compiler falls back to `selectableColumns` (which keeps
 * masked columns; only secrets are dropped). A new row-bearing form that this
 * predicate does not report leaks masked columns to callers without the unmask
 * grant, so `CompiledWidgetQuery.rowShape` carries the answer to the shaper
 * rather than letting it re-derive one.
 *
 * The dual-form shapes pick by descriptor: `hierarchy/tree` and `geo-points`
 * roll up when they carry `groupBy` (and project rows otherwise), `ohlc` folds
 * candles when it carries a `bucket` (and projects stored candle rows
 * otherwise).
 */
export function isRowShape(descriptor: QueryDescriptor): boolean {
  const { shape } = descriptor;
  if (ALWAYS_ROW_SHAPES.has(shape)) return true;
  if (shape === 'hierarchy/tree' || shape === 'geo-points') {
    return (descriptor.groupBy?.length ?? 0) === 0;
  }
  if (shape === 'ohlc') return descriptor.bucket === undefined;
  return false;
}

type Qb = SelectQueryBuilder<SourceDatabase, string, Record<string, unknown>>;

export interface CompileWidgetQueryOptions {
  db: Kysely<SourceDatabase>;
  view: SnapshotView;
  descriptor: QueryDescriptor;
  /** Page-control params for late-bound filters (`filters[].param`). */
  params?: Record<string, unknown> | undefined;
  canReadPii: boolean;
  /** Source dialect — threads into the shared filter compiler (`ilike` per dialect). */
  dialect: Dialect;
  /** Injectable clock for `window` bounds (tests). */
  now?: (() => Date) | undefined;
}

/**
 * Quantiles the shaper must compute itself because the source engine has no
 * percentile function. The compiled `query` then projects raw rows —
 * `valueAlias` plus `keyAlias` when the shape groups — instead of aggregates,
 * and the shaper folds them into exactly the aliases listed here, so every
 * downstream envelope reads the same row layout on all four dialects.
 */
export interface PercentileScan {
  /** Alias of the raw value column projected for sorting. */
  valueAlias: string;
  /** Alias rows group under (`__group` / `__bucket`), or null when ungrouped. */
  keyAlias: string | null;
  /** Output alias → requested quantile, in descriptor order. */
  quantiles: { alias: string; p: number }[];
  /** Fold order: time keys ascend, category keys sort by descending value. */
  order: 'key-asc' | 'value-desc';
}

/**
 * A bucketed `ohlc` request, folded into candles in process (see
 * {@link OHLC_SCAN_MAX}). The compiled `query` projects `(bucketAlias,
 * valueAlias)` ordered by the RAW time column ascending, so the shaper's
 * one-pass fold reads open/close straight off the first and last row of each
 * bucket run.
 */
export interface OhlcScan {
  bucketAlias: string;
  valueAlias: string;
}

export interface CompiledWidgetQuery {
  table: ResolvedTable;
  shape: QueryDescriptor['shape'];
  /**
   * Whether the SELECT projects table rows — the shaper's authority on when to
   * call `maskRows` ({@link isRowShape}).
   */
  rowShape: boolean;
  /** The main query, ready to `.execute()`. */
  query: Qb;
  /** Prior-window twin (`window.compareToPrior`) — same shape, shifted back. */
  prior: Qb | null;
  /** Output aliases of the requested aggregations, in order. */
  aggregationAliases: string[];
  /** Set when the query buckets by time (`timeseries`, `multi-timeseries`). */
  bucketAlias: string | null;
  /** Set when the query groups by a column (`categorical` and friends). */
  groupAlias: string | null;
  /** Second group-by key — `matrix` column headers only. */
  colAlias: string | null;
  /** Resolved columns of a row-bearing SELECT (masking metadata). */
  selectedColumns: ResolvedColumn[];
  /** Exact-count twin for `record-list` (fills `RecordList.total`). */
  count: Qb | null;
  /** Set when quantiles are computed in process rather than in SQL. */
  percentileScan: PercentileScan | null;
  /** Set when candles are folded in process rather than aggregated in SQL. */
  ohlcScan: OhlcScan | null;
  /** Effective LIMIT after the hard cap. */
  limit: number;
}

/** Resolve the descriptor's source against the snapshot (422 on unknown). */
export function resolveSource(view: SnapshotView, descriptor: QueryDescriptor): ResolvedTable {
  const { schema, name } = descriptor.source;
  return view.table(schema === undefined ? name : `${schema}.${name}`);
}

function reject(message: string, details?: unknown): never {
  throw new ValidationFailedError(message, details);
}

/**
 * UTC window boundaries for `window: { last, unit }` plus the immediately
 * preceding window of the same span (04 §5.2 step 5). Calendar units go
 * through UTC calendar arithmetic so month/quarter/year windows stay exact.
 */
export function windowBounds(
  last: number,
  unit: BucketUnit,
  now: Date,
): { start: Date; end: Date; priorStart: Date; priorEnd: Date } {
  const shift = (from: Date, steps: number): Date => {
    const d = new Date(from.getTime());
    switch (unit) {
      case 'hour':
        d.setTime(d.getTime() - steps * 3_600_000);
        return d;
      case 'day':
        d.setTime(d.getTime() - steps * 86_400_000);
        return d;
      case 'week':
        d.setTime(d.getTime() - steps * 7 * 86_400_000);
        return d;
      case 'month':
        d.setUTCMonth(d.getUTCMonth() - steps);
        return d;
      case 'quarter':
        d.setUTCMonth(d.getUTCMonth() - steps * 3);
        return d;
      case 'year':
        d.setUTCFullYear(d.getUTCFullYear() - steps);
        return d;
    }
  };
  const end = now;
  const start = shift(end, last);
  return { start, end, priorStart: shift(start, last), priorEnd: start };
}

type Ref = ReturnType<DynamicModule<SourceDatabase>['ref']>;

/**
 * Time-bucket expression, compiled per dialect (04 §5.2 step 4). Every bucket
 * evaluates to the ISO-lexicographic start of its period, so `GROUP BY` /
 * `ORDER BY` over the raw expression sort chronologically and the shaper's
 * `toIso` parses the result the same way for all three engines. The unit is a
 * closed Zod enum and every format token is a source constant — no caller
 * string is inlined; the only interpolation is the snapshot's own column ref.
 */
function bucketExpr(dialect: Dialect, ref: Ref, unit: BucketUnit): RawBuilder<unknown> {
  switch (dialect) {
    case 'mysql':
      return mysqlBucketExpr(ref, unit);
    case 'sqlite':
      return sqliteBucketExpr(ref, unit);
    // 'postgres' and the schema-only 'generic' fall through to date_trunc,
    // which covers every unit natively.
    default:
      return sql`date_trunc(${sql.lit(unit)}, ${ref})`;
  }
}

/** MySQL bucket start (`DATE_FORMAT` / calendar arithmetic). */
function mysqlBucketExpr(ref: Ref, unit: BucketUnit): RawBuilder<unknown> {
  switch (unit) {
    case 'hour':
      return sql`date_format(${ref}, '%Y-%m-%d %H:00:00')`;
    case 'day':
      return sql`date_format(${ref}, '%Y-%m-%d')`;
    case 'week':
      // WEEKDAY() is 0=Monday…6=Sunday, so subtracting it lands on the ISO
      // Monday — matching Postgres `date_trunc('week', …)`.
      return sql`date_sub(date(${ref}), interval weekday(${ref}) day)`;
    case 'month':
      return sql`date_format(${ref}, '%Y-%m-01')`;
    case 'quarter':
      return sql`date(makedate(year(${ref}), 1) + interval (quarter(${ref}) - 1) quarter)`;
    case 'year':
      return sql`date_format(${ref}, '%Y-01-01')`;
  }
}

/** SQLite bucket start (`strftime` over ISO-text/epoch storage). */
function sqliteBucketExpr(ref: Ref, unit: BucketUnit): RawBuilder<unknown> {
  switch (unit) {
    case 'hour':
      return sql`strftime('%Y-%m-%d %H:00:00', ${ref})`;
    case 'day':
      return sql`strftime('%Y-%m-%d', ${ref})`;
    case 'week':
      // (%w + 6) % 7 remaps SQLite's 0=Sunday…6=Saturday to 0=Monday, so the
      // offset subtracted lands on the ISO Monday (as Postgres/MySQL do).
      return sql`date(${ref}, '-' || ((strftime('%w', ${ref}) + 6) % 7) || ' days')`;
    case 'month':
      return sql`strftime('%Y-%m-01', ${ref})`;
    case 'quarter':
      return sql`strftime('%Y', ${ref}) || '-' || printf('%02d', ((cast(strftime('%m', ${ref}) as integer) - 1) / 3) * 3 + 1) || '-01'`;
    case 'year':
      return sql`strftime('%Y-01-01', ${ref})`;
  }
}

/**
 * A rolling-window boundary as the source driver expects it: Postgres binds
 * the `Date` directly (timestamptz), but MySQL and SQLite take a UTC
 * `'YYYY-MM-DD HH:MM:SS'` string — `windowBounds` computes in UTC, and
 * better-sqlite3 refuses to bind a `Date` at all (it accepts only numbers,
 * strings, bigints, buffers and null).
 */
function windowBoundValue(date: Date, dialect: Dialect): Date | string {
  if (dialect === 'mysql' || dialect === 'sqlite') {
    return date.toISOString().slice(0, 19).replace('T', ' ');
  }
  return date;
}

/**
 * Does this engine have an ordered-set quantile aggregate? Postgres (and the
 * schema-only `generic`) do; MySQL 8 has no `percentile_cont` and SQLite has
 * no percentile function at all, so both take the in-process scan.
 */
function hasNativePercentile(dialect: Dialect): boolean {
  return dialect !== 'mysql' && dialect !== 'sqlite';
}

/**
 * Quantile expression, compiled per dialect — the same `bucketExpr` shape of
 * decision. Only reached when {@link hasNativePercentile} holds; `p` is a
 * closed `[0, 1]` number from the descriptor schema, so `sql.lit` inlines a
 * numeric literal and never caller text.
 */
function percentileExpr(ref: Ref, p: number): RawBuilder<unknown> {
  return sql`percentile_cont(${sql.lit(p)}) within group (order by ${ref})`;
}

/**
 * Validate the aggregations of a scan-mode descriptor into one quantile list.
 * The scan projects a SINGLE value column, so a descriptor may neither mix
 * `percentile` with other aggregate functions nor spread its percentiles over
 * several columns — both reject with an explicit 422 rather than quietly
 * quantiling the wrong column or silently dropping the other aggregates.
 */
function quantileAggregations(
  aggregations: readonly Aggregation[],
  dialect: Dialect,
): { column: string; quantiles: { alias: string; p: number }[] } {
  const columns = new Set<string>();
  const quantiles: { alias: string; p: number }[] = [];
  for (const aggregation of aggregations) {
    if (aggregation.fn !== 'percentile') {
      reject(
        `Quantiles are computed in process on ${dialect}, so "percentile" cannot share a descriptor with "${aggregation.fn}". Split it into two widgets.`,
        { dialect, fn: aggregation.fn },
      );
    }
    if (!ALIAS_PATTERN.test(aggregation.alias) || aggregation.alias.startsWith('__')) {
      reject('Aggregation aliases must be simple identifiers.', { alias: aggregation.alias });
    }
    if (aggregation.column === undefined) {
      reject('Aggregation "percentile" requires a column.', { alias: aggregation.alias });
    }
    if (aggregation.p === undefined) {
      reject('Aggregation "percentile" requires `p` (0–1).', { alias: aggregation.alias });
    }
    columns.add(aggregation.column);
    quantiles.push({ alias: aggregation.alias, p: aggregation.p });
  }
  const column = [...columns][0];
  if (columns.size !== 1 || column === undefined) {
    reject(`Quantiles are computed in process on ${dialect} and scan one column at a time.`, {
      dialect,
      columns: columns.size,
    });
  }
  return { column, quantiles };
}

/** Validate + resolve one aggregation; returns its select expression factory. */
function compileAggregation(
  db: Kysely<SourceDatabase>,
  view: SnapshotView,
  table: ResolvedTable,
  canReadPii: boolean,
  aggregation: Aggregation,
): { alias: string; expr: RawBuilder<unknown> } {
  if (!ALIAS_PATTERN.test(aggregation.alias) || aggregation.alias.startsWith('__')) {
    reject('Aggregation aliases must be simple identifiers.', { alias: aggregation.alias });
  }
  if (aggregation.fn === 'percentile') {
    if (aggregation.column === undefined) {
      reject('Aggregation "percentile" requires a column.', { alias: aggregation.alias });
    }
    if (aggregation.p === undefined) {
      reject('Aggregation "percentile" requires `p` (0–1).', { alias: aggregation.alias });
    }
    const column = view.readableColumn(table, aggregation.column, canReadPii);
    return { alias: aggregation.alias, expr: percentileExpr(db.dynamic.ref(column.name), aggregation.p) };
  }
  if (aggregation.column === undefined) {
    if (aggregation.fn !== 'count') {
      reject(`Aggregation "${aggregation.fn}" requires a column.`, { alias: aggregation.alias });
    }
    return { alias: aggregation.alias, expr: sql`count(*)` };
  }
  // 403 COLUMN_FORBIDDEN when masked and the caller lacks the unmask grant.
  const column = view.readableColumn(table, aggregation.column, canReadPii);
  const ref = db.dynamic.ref(column.name);
  switch (aggregation.fn) {
    case 'count':
      return { alias: aggregation.alias, expr: sql`count(${ref})` };
    case 'count_distinct':
      return { alias: aggregation.alias, expr: sql`count(distinct ${ref})` };
    case 'sum':
      return { alias: aggregation.alias, expr: sql`sum(${ref})` };
    case 'avg':
      return { alias: aggregation.alias, expr: sql`avg(${ref})` };
    case 'min':
      return { alias: aggregation.alias, expr: sql`min(${ref})` };
    case 'max':
      return { alias: aggregation.alias, expr: sql`max(${ref})` };
  }
}

/**
 * Late-bound `param` resolution (04 §5.1): a filter carrying `param` reads
 * its value from the page-control params; an unset param drops the filter
 * (the control is not active). Filters with neither value nor param pass
 * through — `is_null`/`not_null` need no value.
 */
export function resolveFilterParams(
  filters: NonNullable<QueryDescriptor['filters']>,
  params: Record<string, unknown>,
): FilterCondition[] {
  const out: FilterCondition[] = [];
  for (const filter of filters) {
    if (filter.param !== undefined) {
      const value = params[filter.param];
      if (value === undefined) continue; // control unset — filter inactive
      out.push({ column: filter.column, op: filter.op, value });
      continue;
    }
    out.push(
      filter.value === undefined
        ? { column: filter.column, op: filter.op }
        : { column: filter.column, op: filter.op, value: filter.value },
    );
  }
  return out;
}

/** Shape ⇄ descriptor structural rules (04 §5.2 step 1 semantics). */
function assertShapeRules(descriptor: QueryDescriptor): void {
  const { shape } = descriptor;
  if (!SUPPORTED_SHAPES.has(shape)) {
    reject(`Shape "${shape}" is not supported by the widget-data compiler yet.`, { shape });
  }
  const hasAgg = (descriptor.aggregations?.length ?? 0) > 0;
  const hasGroup = (descriptor.groupBy?.length ?? 0) > 0;
  const hasBucket = descriptor.bucket !== undefined;

  if (shape === 'single-metric' || shape === 'metric+delta') {
    if (!hasAgg) reject(`Shape "${shape}" requires at least one aggregation.`, { shape });
    if (hasGroup || hasBucket) reject(`Shape "${shape}" cannot group or bucket.`, { shape });
  }
  if (shape === 'timeseries') {
    if (!hasAgg || !hasBucket) reject('Shape "timeseries" requires a `bucket` and an aggregation.', {});
    if (hasGroup) reject('Grouped timeseries is `multi-timeseries`.', {});
  }
  if (shape === 'multi-timeseries') {
    if (!hasAgg || !hasBucket) {
      reject('Shape "multi-timeseries" requires a `bucket` and an aggregation.', {});
    }
    if ((descriptor.groupBy?.length ?? 0) !== 1) {
      reject('Shape "multi-timeseries" requires exactly one groupBy column (the series key).', {});
    }
  }
  if (shape === 'categorical') {
    if (!hasAgg) reject('Shape "categorical" requires an aggregation.', {});
    if ((descriptor.groupBy?.length ?? 0) !== 1) {
      reject('Shape "categorical" requires exactly one groupBy column.', {});
    }
    if (hasBucket) reject('Shape "categorical" cannot time-bucket; use "timeseries".', {});
  }
  if (shape === 'matrix') {
    if (!hasAgg) reject('Shape "matrix" requires an aggregation (the cell value).', {});
    if ((descriptor.groupBy?.length ?? 0) !== 2) {
      reject('Shape "matrix" requires exactly two groupBy columns (row key, column key).', {});
    }
    if (hasBucket) reject('Shape "matrix" cannot time-bucket.', {});
  }
  if (shape === 'distribution') {
    if (hasAgg) reject('Shape "distribution" derives its own quantiles — drop `aggregations`.', {});
    if (hasBucket) reject('Shape "distribution" cannot time-bucket.', {});
    if ((descriptor.select?.length ?? 0) !== 1) {
      reject('Shape "distribution" requires `select: [valueColumn]`.', {});
    }
    if ((descriptor.groupBy?.length ?? 0) > 1) {
      reject('Shape "distribution" groups by at most one column.', {});
    }
  }
  const groupCount = descriptor.groupBy?.length ?? 0;
  const selectCount = descriptor.select?.length ?? 0;

  if (shape === 'hierarchy/tree') {
    if (hasBucket) reject('Shape "hierarchy/tree" cannot time-bucket.', {});
    if (hasGroup) {
      // Rollup form: parent key × child key, the aggregate is the leaf value.
      if (!hasAgg) reject('A rolled-up "hierarchy/tree" needs an aggregation (the leaf value).', {});
      if (groupCount !== 2) {
        reject('A rolled-up "hierarchy/tree" groups by exactly two columns (parent key, child key).', {
          groupBy: groupCount,
        });
      }
    } else if (selectCount < 3) {
      // Adjacency form: positional, like `calendar-events` — the descriptor is
      // a closed leaf shared with the client, so column ORDER names the roles.
      reject(
        'Shape "hierarchy/tree" requires `select: [idColumn, labelColumn, parentColumn, ...metaColumns]`, or a two-key `groupBy` rollup.',
        { selected: selectCount },
      );
    }
  }
  if (shape === 'geo-points') {
    if (hasBucket) reject('Shape "geo-points" cannot time-bucket.', {});
    if (hasGroup) {
      if (!hasAgg) reject('A rolled-up "geo-points" needs an aggregation (the region value).', {});
      if (groupCount !== 1) {
        reject('A rolled-up "geo-points" groups by exactly one column (the region code).', {
          groupBy: groupCount,
        });
      }
    } else if (selectCount < 2) {
      reject(
        'Shape "geo-points" requires `select: [nameColumn, latColumn, lngColumn, ...metricColumns]` or `[nameColumn, codeColumn, ...metricColumns]`.',
        { selected: selectCount },
      );
    }
  }
  if (shape === 'flows') {
    if (!hasAgg) reject('Shape "flows" requires an aggregation (the link weight).', {});
    if (groupCount !== 2) {
      reject('Shape "flows" requires exactly two groupBy columns (source key, target key).', {
        groupBy: groupCount,
      });
    }
    if (hasBucket) reject('Shape "flows" cannot time-bucket.', {});
  }
  if (shape === 'ohlc') {
    if (hasGroup) reject('Shape "ohlc" has one candle per time bucket — it cannot group.', {});
    if (hasBucket) {
      if (hasAgg) {
        reject('A bucketed "ohlc" derives open/high/low/close itself — drop `aggregations`.', {});
      }
      if (selectCount !== 1) {
        reject('A bucketed "ohlc" requires `select: [valueColumn]` (the price/tick column).', {
          selected: selectCount,
        });
      }
    } else if (selectCount !== 5) {
      reject(
        'Shape "ohlc" requires `bucket` + `select: [valueColumn]`, or `select: [timeColumn, openColumn, highColumn, lowColumn, closeColumn]` for a table that already stores candles.',
        { selected: selectCount },
      );
    }
  }
  if (shape === 'boolean-map' && selectCount !== 2) {
    reject('Shape "boolean-map" requires `select: [keyColumn, flagColumn]`.', { selected: selectCount });
  }

  if (isRowShape(descriptor) && (hasAgg || hasGroup || hasBucket)) {
    reject(`Shape "${shape}" selects rows — aggregations/grouping are not allowed.`, {});
  }
  if (shape === 'calendar-events') {
    // Positional `select` is the whole event mapping: the descriptor schema is
    // a closed leaf shared with the client, so an event carries no bespoke
    // field map — column ORDER names the roles instead (04 §3 `{date, title,
    // category?, end?}`).
    const selected = descriptor.select?.length ?? 0;
    if (selected < 2 || selected > 4) {
      reject(
        'Shape "calendar-events" requires `select: [dateColumn, titleColumn, categoryColumn?, endColumn?]`.',
        { selected },
      );
    }
  }
}

/**
 * Compile one descriptor to dynamic Kysely. Identifier resolution and PII
 * checks happen here; RBAC on the resolved table is the route's job (it
 * needs the request principal).
 */
export function compileWidgetQuery(opts: CompileWidgetQueryOptions): CompiledWidgetQuery {
  const { db, view, descriptor, canReadPii, dialect } = opts;
  const params = opts.params ?? {};
  const now = opts.now ?? (() => new Date());

  assertShapeRules(descriptor);
  const table = resolveSource(view, descriptor);
  const dynamic = db.dynamic;
  const filterCtx: CompileFilterContext = { view, table, canReadPii, dynamic, dialect };

  // --- WHERE: descriptor filters (CRUD DSL compiler) + rolling window -------
  const conditions =
    descriptor.filters === undefined ? [] : resolveFilterParams(descriptor.filters, params);
  // Column resolution happens inside compileFilter via readableColumn.

  const windowColumn =
    descriptor.window === undefined
      ? null
      : view.readableColumn(table, descriptor.window.column, canReadPii);
  const bounds =
    descriptor.window === undefined
      ? null
      : windowBounds(descriptor.window.last, descriptor.window.unit, now());

  const applyWhere = (qb: Qb, window: { start: Date; end: Date } | null): Qb => {
    let out = qb;
    if (conditions.length > 0) {
      out = out.where((eb) => compileFilter(eb as never, filterCtx, { and: conditions }));
    }
    if (window !== null && windowColumn !== null) {
      const ref = dynamic.ref(windowColumn.name);
      out = out
        .where((eb) => eb(ref, '>=', windowBoundValue(window.start, dialect)))
        .where((eb) => eb(ref, '<', windowBoundValue(window.end, dialect)));
    }
    return out;
  };

  // --- quantiles: native SQL where the engine has it, else the scan ----------
  const shape = descriptor.shape;
  const rowShape = isRowShape(descriptor);
  const aggregations = descriptor.aggregations ?? [];
  const groupColumns = descriptor.groupBy ?? [];
  // `distribution` is a fixed five-quantile request over its single `select`
  // column; a `percentile` aggregation is a caller-spelled one. Both take the
  // same two roads.
  const distributionColumn =
    shape === 'distribution'
      ? view.readableColumn(table, (descriptor.select as string[])[0] as string, canReadPii)
      : null;
  const scan =
    !hasNativePercentile(dialect) &&
    (distributionColumn !== null || aggregations.some((a) => a.fn === 'percentile'));
  let scanColumn: ResolvedColumn | null = distributionColumn;
  let quantiles: { alias: string; p: number }[] = [];
  if (scan) {
    // The scan folds around ONE key, so two-key shapes have no in-process road.
    if (shape === 'matrix' || shape === 'multi-timeseries') {
      reject(`Quantiles are computed in process on ${dialect}, around one key — "${shape}" needs two.`, {
        shape,
        dialect,
      });
    }
    if (distributionColumn !== null) {
      quantiles = DISTRIBUTION_QUANTILES.map(({ alias, p }) => ({ alias, p }));
    } else {
      const resolved = quantileAggregations(aggregations, dialect);
      scanColumn = view.readableColumn(table, resolved.column, canReadPii);
      quantiles = resolved.quantiles;
    }
  }

  // --- candles: always an in-process fold (see OHLC_SCAN_MAX) ----------------
  const ohlcColumn =
    shape === 'ohlc' && descriptor.bucket !== undefined
      ? view.readableColumn(table, (descriptor.select as string[])[0] as string, canReadPii)
      : null;

  // --- SELECT ----------------------------------------------------------------
  const seenAliases = new Set<string>();
  const compiledAggs = scan
    ? []
    : aggregations.map((aggregation) => {
        if (seenAliases.has(aggregation.alias)) {
          reject('Duplicate aggregation alias.', { alias: aggregation.alias });
        }
        seenAliases.add(aggregation.alias);
        return compileAggregation(db, view, table, canReadPii, aggregation);
      });

  let selectedColumns: ResolvedColumn[] = [];
  const requestedLimit =
    descriptor.limit ??
    (shape === 'record-list' || shape === 'stream' ? RECORD_LIST_LIMIT_DEFAULT : WIDGET_LIMIT_MAX);
  // `record` is the single-row envelope — one row, whatever the caller asked.
  const limit = shape === 'record' ? 1 : Math.min(Math.max(requestedLimit, 1), WIDGET_LIMIT_MAX);
  // `__group` then `__col`, positionally — the descriptor caps `groupBy` at 2.
  const groupAliases = [GROUP_ALIAS, COL_ALIAS];

  const build = (window: { start: Date; end: Date } | null): Qb => {
    let qb = applyWhere(db.selectFrom(table.id) as unknown as Qb, window);

    if (rowShape) {
      selectedColumns =
        descriptor.select !== undefined && descriptor.select.length > 0
          ? descriptor.select.map((name) => view.readableColumn(table, name, canReadPii))
          : view.selectableColumns(table);
      qb = qb.select(selectedColumns.map((column) => dynamic.ref(column.name)));
    } else if (ohlcColumn !== null) {
      // Raw projection: the shaper folds candles bucket by bucket (OHLC_SCAN_MAX).
      qb = qb.select(sql`${dynamic.ref(ohlcColumn.name)}`.as(VALUE_ALIAS));
    } else if (scan) {
      // Raw projection: the shaper sorts and interpolates (PERCENTILE_SCAN_MAX).
      qb = qb.select(sql`${dynamic.ref((scanColumn as ResolvedColumn).name)}`.as(VALUE_ALIAS));
    } else if (distributionColumn !== null) {
      const ref = dynamic.ref(distributionColumn.name);
      qb = qb.select(DISTRIBUTION_QUANTILES.map(({ alias, p }) => percentileExpr(ref, p).as(alias)));
    } else {
      qb = qb.select(compiledAggs.map(({ expr, alias }) => expr.as(alias)));
    }

    if (
      descriptor.bucket !== undefined &&
      (shape === 'timeseries' || shape === 'multi-timeseries' || ohlcColumn !== null)
    ) {
      const bucketColumn = view.readableColumn(table, descriptor.bucket.column, canReadPii);
      const bucket = bucketExpr(dialect, dynamic.ref(bucketColumn.name), descriptor.bucket.unit);
      qb = qb.select(bucket.as(BUCKET_ALIAS));
      if (ohlcColumn !== null) {
        // Candles are folded in process, so the ONE thing SQL must guarantee is
        // time order — open/close are the first/last row of each bucket run.
        qb = qb.orderBy(dynamic.ref(bucketColumn.name), 'asc');
      } else if (!scan) {
        // A scan projects raw rows — grouping and ordering happen in the shaper.
        qb = qb.groupBy(bucket).orderBy(bucket, 'asc');
      }
    }
    if (!rowShape) {
      groupColumns.forEach((name, index) => {
        const column = view.readableColumn(table, name, canReadPii);
        const ref = dynamic.ref(column.name);
        qb = qb.select(sql`${ref}`.as(groupAliases[index] as string));
        if (!scan) qb = qb.groupBy(ref);
      });
    }
    if (!scan && groupColumns.length > 0) {
      const first = compiledAggs[0];
      if (shape === 'categorical' && first !== undefined) {
        // Deterministic fold order: biggest buckets first, by the first alias.
        qb = qb.orderBy(sql.ref(first.alias), 'desc');
      } else if (shape !== 'categorical') {
        // Stable header order so `matrix` rows/columns and the series list of
        // `multi-timeseries` are the same on every request.
        groupColumns.forEach((_, index) => {
          qb = qb.orderBy(sql.ref(groupAliases[index] as string), 'asc');
        });
      }
    }

    for (const key of descriptor.orderBy ?? []) {
      const column = view.readableColumn(table, key.column, canReadPii);
      qb = qb.orderBy(dynamic.ref(column.name), key.dir);
    }
    // A stored-candle `ohlc` table is only a chart in time order, and the
    // widget keeps the LAST n candles — so an unsorted descriptor would show an
    // arbitrary slice. The caller's own `orderBy` wins when it gave one.
    if (shape === 'ohlc' && rowShape && (descriptor.orderBy?.length ?? 0) === 0) {
      const time = selectedColumns[0];
      if (time !== undefined) qb = qb.orderBy(dynamic.ref(time.name), 'asc');
    }

    // Aggregate-only shapes need no LIMIT; grouped/row shapes get the cap, and
    // the two in-process folds their own, much larger, bounds.
    if (scan) {
      qb = qb.limit(PERCENTILE_SCAN_MAX);
    } else if (ohlcColumn !== null) {
      qb = qb.limit(OHLC_SCAN_MAX);
    } else if (rowShape || shape === 'timeseries' || groupColumns.length > 0) {
      qb = qb.limit(limit);
    }
    return qb;
  };

  const query = build(bounds);
  const wantsPrior =
    shape === 'metric+delta' || shape === 'timeseries'
      ? descriptor.window?.compareToPrior === true
      : false;
  const prior =
    wantsPrior && bounds !== null ? build({ start: bounds.priorStart, end: bounds.priorEnd }) : null;
  const count =
    shape === 'record-list'
      ? applyWhere(db.selectFrom(table.id) as unknown as Qb, bounds).select((eb) =>
          eb.fn.countAll().as('total'),
        )
      : null;

  const keyed = groupColumns.length > 0;
  return {
    table,
    shape,
    rowShape,
    query,
    prior,
    count,
    aggregationAliases: scan
      ? aggregations.map(({ alias }) => alias)
      : compiledAggs.map(({ alias }) => alias),
    bucketAlias:
      shape === 'timeseries' || shape === 'multi-timeseries' || ohlcColumn !== null
        ? BUCKET_ALIAS
        : null,
    groupAlias: !rowShape && keyed ? GROUP_ALIAS : null,
    // Every two-key rollup reads its second key here: `matrix` cells, `flows`
    // targets and the leaves of a rolled-up `hierarchy/tree`.
    colAlias: !rowShape && groupColumns.length === 2 ? COL_ALIAS : null,
    ohlcScan: ohlcColumn === null ? null : { bucketAlias: BUCKET_ALIAS, valueAlias: VALUE_ALIAS },
    percentileScan: scan
      ? {
          valueAlias: VALUE_ALIAS,
          keyAlias: shape === 'timeseries' ? BUCKET_ALIAS : keyed ? GROUP_ALIAS : null,
          quantiles,
          order: shape === 'categorical' ? 'value-desc' : 'key-asc',
        }
      : null,
    selectedColumns,
    limit,
  };
}
