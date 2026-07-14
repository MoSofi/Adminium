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
 * M4 scope notes: shapes compiled here are `single-metric`, `metric+delta`,
 * `timeseries`, `categorical`, and `record-list` (the M4 widget set).
 * `percentile` aggregations and the remaining shapes reject with 422 until
 * 04-T09/T10.
 *
 * Dialect divergence (04 §5.2 step 4): time bucketing and rolling-window
 * bounds are the two clauses whose SQL differs per engine. Rather than a
 * kysely-typed adapter hook (the `@adminium/engine/adapter` `QueryEngine`
 * contract must stay free of a `kysely` dependency — it types the dialect
 * opaquely), the compiler branches on the connection's engine here, where
 * kysely and the rest of the SQL compilation already live: `bucketExpr()`
 * emits `date_trunc` / `strftime` / `DATE_FORMAT` per dialect, and window
 * boundaries bind as a `Date` on Postgres but as a UTC `'YYYY-MM-DD
 * HH:MM:SS'` string on MySQL/SQLite (better-sqlite3 refuses to bind a
 * `Date`).
 */

import { sql, type DynamicModule, type Kysely, type RawBuilder, type SelectQueryBuilder } from 'kysely';
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

/** Reserved output aliases the shaper relies on. */
export const BUCKET_ALIAS = '__bucket';
export const GROUP_ALIAS = '__group';

const ALIAS_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/;

const SUPPORTED_SHAPES = new Set([
  'single-metric',
  'metric+delta',
  'timeseries',
  'categorical',
  'record-list',
]);

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

export interface CompiledWidgetQuery {
  table: ResolvedTable;
  shape: QueryDescriptor['shape'];
  /** The main query, ready to `.execute()`. */
  query: Qb;
  /** Prior-window twin (`window.compareToPrior`) — same shape, shifted back. */
  prior: Qb | null;
  /** Output aliases of the requested aggregations, in order. */
  aggregationAliases: string[];
  /** Set when the query buckets by time (`timeseries`). */
  bucketAlias: string | null;
  /** Set when the query groups by a column (`categorical`). */
  groupAlias: string | null;
  /** Resolved columns of a `record-list` SELECT (masking metadata). */
  selectedColumns: ResolvedColumn[];
  /** Exact-count twin for `record-list` (fills `RecordList.total`). */
  count: Qb | null;
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
    reject('`percentile` aggregations are not supported yet (04-T09).', {});
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
    if (hasGroup) reject('Grouped timeseries is `multi-timeseries` (not supported yet).', {});
  }
  if (shape === 'categorical') {
    if (!hasAgg) reject('Shape "categorical" requires an aggregation.', {});
    if ((descriptor.groupBy?.length ?? 0) !== 1) {
      reject('Shape "categorical" requires exactly one groupBy column.', {});
    }
    if (hasBucket) reject('Shape "categorical" cannot time-bucket; use "timeseries".', {});
  }
  if (shape === 'record-list' && (hasAgg || hasGroup || hasBucket)) {
    reject('Shape "record-list" selects rows — aggregations/grouping are not allowed.', {});
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

  // --- SELECT ----------------------------------------------------------------
  const aggregations = descriptor.aggregations ?? [];
  const seenAliases = new Set<string>();
  const compiledAggs = aggregations.map((aggregation) => {
    if (seenAliases.has(aggregation.alias)) {
      reject('Duplicate aggregation alias.', { alias: aggregation.alias });
    }
    seenAliases.add(aggregation.alias);
    return compileAggregation(db, view, table, canReadPii, aggregation);
  });

  const shape = descriptor.shape;
  let selectedColumns: ResolvedColumn[] = [];
  const requestedLimit = descriptor.limit ?? (shape === 'record-list' ? RECORD_LIST_LIMIT_DEFAULT : WIDGET_LIMIT_MAX);
  const limit = Math.min(Math.max(requestedLimit, 1), WIDGET_LIMIT_MAX);

  const build = (window: { start: Date; end: Date } | null): Qb => {
    let qb = applyWhere(db.selectFrom(table.id) as unknown as Qb, window);

    if (shape === 'record-list') {
      selectedColumns =
        descriptor.select !== undefined && descriptor.select.length > 0
          ? descriptor.select.map((name) => view.readableColumn(table, name, canReadPii))
          : view.selectableColumns(table);
      qb = qb.select(selectedColumns.map((column) => dynamic.ref(column.name)));
    } else {
      qb = qb.select(compiledAggs.map(({ expr, alias }) => expr.as(alias)));
    }

    if (shape === 'timeseries' && descriptor.bucket !== undefined) {
      const bucketColumn = view.readableColumn(table, descriptor.bucket.column, canReadPii);
      const bucket = bucketExpr(dialect, dynamic.ref(bucketColumn.name), descriptor.bucket.unit);
      qb = qb.select(bucket.as(BUCKET_ALIAS)).groupBy(bucket).orderBy(bucket, 'asc');
    }
    if (shape === 'categorical') {
      const groupColumn = view.readableColumn(table, (descriptor.groupBy as string[])[0] as string, canReadPii);
      const ref = dynamic.ref(groupColumn.name);
      qb = qb.select(sql`${ref}`.as(GROUP_ALIAS)).groupBy(ref);
      // Deterministic fold order: biggest buckets first, by the first alias.
      const first = compiledAggs[0];
      if (first !== undefined) qb = qb.orderBy(sql.ref(first.alias), 'desc');
    }

    for (const key of descriptor.orderBy ?? []) {
      const column = view.readableColumn(table, key.column, canReadPii);
      qb = qb.orderBy(dynamic.ref(column.name), key.dir);
    }

    // Aggregate-only shapes need no LIMIT; grouped/row shapes get the cap.
    if (shape === 'record-list' || shape === 'categorical' || shape === 'timeseries') {
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

  return {
    table,
    shape,
    query,
    prior,
    count,
    aggregationAliases: compiledAggs.map(({ alias }) => alias),
    bucketAlias: shape === 'timeseries' ? BUCKET_ALIAS : null,
    groupAlias: shape === 'categorical' ? GROUP_ALIAS : null,
    selectedColumns,
    limit,
  };
}
