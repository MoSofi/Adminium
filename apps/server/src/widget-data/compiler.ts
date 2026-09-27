// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Query-descriptor compiler (subset).
 *
 * Turns a validated `QueryDescriptor` (the pure-Zod leaf shared through
 * `@adminium/engine/config`) into dynamic Kysely over the data connection.
 * Invariants, identical to the CRUD layer:
 *
 * - every table/column string that reaches SQL is the schema snapshot's own
 *   (`SnapshotView` resolution → 422 `UNKNOWN_IDENTIFIER` otherwise);
 * - PII-masked columns may not be selected, filtered, grouped, bucketed,
 *   aggregated, or sorted by callers without the unmask grant → 403
 * `COLUMN_FORBIDDEN`;
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
 * Dialect divergence: time bucketing, rolling-window bounds and quantiles are
 * the three clauses whose SQL differs per engine. Rather than a kysely-typed
 * adapter hook (the `@adminium/engine/adapter` `QueryEngine` contract must
 * stay free of a `kysely` dependency — it types the dialect opaquely), the
 * compiler branches on the connection's engine here, where kysely and the rest
 * of the SQL compilation already live: `bucketExpr()` emits `date_trunc` /
 * `strftime` / `DATE_FORMAT` per dialect; window boundaries bind as a `Date`
 * on Postgres but as a UTC `'YYYY-MM-DD HH:MM:SS'` string on MySQL/SQLite
 * (better-sqlite3 refuses to bind a `Date`); and `percentileExpr()` emits
 * `percentile_cont` where the engine has it and otherwise arms the in-process
 * scan described at {@link PERCENTILE_SCAN_MAX}.
 */

import { sql, type DynamicModule, type Expression, type ExpressionBuilder, type Kysely, type RawBuilder, type SelectQueryBuilder, type SqlBool } from 'kysely';
import { COMPILABLE_DATA_SHAPES } from '@adminium/engine/config';
import type { Aggregation, BucketUnit, QueryDescriptor } from '@adminium/engine/config';
import type { Dialect } from '@adminium/engine';

import { ValidationFailedError } from '../errors.js';
import type { SourceDatabase } from '../connections/manager.js';
import { compileFilter, MAX_FILTER_CONDITIONS, MAX_FILTER_GROUP_DEPTH, type CompileFilterContext, type FilterCondition, type RecordFilter } from '../crud/filters.js';
import type { ResolvedColumn, ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import { lookupSelections, type ResolvedLookup } from '../crud/lookups.js';
import { venueClock, wallTimeToInstant } from '../crud/venue-time.js';
import { offsetSpans, stepsOf, wallText, type OffsetSpan } from './zone-offsets.js';
import { choiceWordsOf } from './choice-words.js';
import { calendarBoundValue, instantBoundValue, windowBoundValue } from './bound-values.js';
import { venueDayConditions } from './link-filters.js';

/** Hard row cap on any compiled query (guardrails). */
export const WIDGET_LIMIT_MAX = 1000;
/** Default page size for `record-list` descriptors without a `limit`. */
export const RECORD_LIST_LIMIT_DEFAULT = 50;
/** Group-by cardinality cap — excess folds into `__other`. */
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
 * The five quantiles a `distribution` envelope carries (`{min, q1, med, q3,
 * max}`). `percentile_cont(0)` / `(1)` are exactly `min` / `max`, so the whole
 * envelope is one uniform quantile request — the same list drives the native
 * SQL path and the in-process scan.
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
 * disagree about which shapes exist. (`stream` is the live-feed snapshot of:
 * compiled exactly like `record-list` — recent rows, DESC — then shaped into a
 * `StreamShape` with the resolved WS channel.)
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

/** A unit a window counts in: every bucket unit but the folded `hour-of-day`. */
export type PeriodUnit = Exclude<BucketUnit, 'hour-of-day'>;

/**
 * A column one link away (`fkColumn.column`), resolved by the caller with the
 * reader's read checks (`widget-data/paths.ts`): a filter or a window on it
 * compiles to `fkColumn IN (SELECT key FROM parent WHERE …)`.
 */
export interface ResolvedPath {
  /** The key column on the source table. */
  fkColumn: ResolvedColumn;
  parent: ResolvedTable;
  /** The parent's column the key points at. */
  parentKey: string;
  /** The parent's column filtered on. */
  column: ResolvedColumn;
  /** Whether the reader sees the parent's personal columns. */
  unmasked: boolean;
}

/**
 * Where a foreign-key group's label is read (`groupLabel`), when the reader
 * may read it: ties in a ranking fall to the label.
 */
export interface GroupLabelSource {
  table: ResolvedTable;
  /** The column of `table` the grouped key points at. */
  key: string;
  /** The label column. */
  column: string;
}

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
  /**
   * The venue's time zone (the connection's). A calendar `window` counts its
   * days from the venue's midnight, and hour and day buckets are the venue's
   * hours and days. Absent: UTC, as before.
   */
  timezone?: string | undefined;
  /**
   * The descriptor's `lookups`, already resolved by the caller — resolution
   * needs the per-table read check, which is a request-scoped question the
   * compiler does not ask. Refused ones compile to nothing and are nulled by
   * the shaper, exactly as on the CRUD read.
   */
  lookups?: readonly ResolvedLookup[] | undefined;
  /**
   * Filter and window columns one link away, already resolved and read-checked
   * by the caller, keyed by their `fkColumn.column` spelling. A path the
   * caller did not resolve is refused.
   */
  paths?: ReadonlyMap<string, ResolvedPath> | undefined;
  /** The group label's source when the reader may read it (ranking ties). */
  groupLabel?: GroupLabelSource | undefined;
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
  /** The columns grouped by, in order (the group, then the column key). */
  groupColumns: string[];
  /** Resolved columns of a row-bearing SELECT (masking metadata). */
  selectedColumns: ResolvedColumn[];
  /** Lookups projected onto each row; the shaper nulls the refused ones. */
  lookups: readonly ResolvedLookup[];
  /** Exact-count twin for `record-list` (fills `RecordList.total`). */
  count: Qb | null;
  /** Set when quantiles are computed in process rather than in SQL. */
  percentileScan: PercentileScan | null;
  /** Set when candles are folded in process rather than aggregated in SQL. */
  ohlcScan: OhlcScan | null;
  /** Effective LIMIT after the hard cap. */
  limit: number;
  /**
   * Set when buckets are the venue's wall clock (`YYYY-MM-DD HH:MM:SS` text):
   * the shaper reads each one as the instant it names in this zone.
   */
  bucketZone: string | null;
  /** Set when buckets are the venue's hours of the day (`00`–`23` text), not instants. */
  hourOfDay: boolean;
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
 * preceding window of the same span. Calendar units go through UTC
 * calendar arithmetic so month/quarter/year windows stay exact.
 */
export function windowBounds(
  last: number,
  unit: PeriodUnit,
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

/** A naive `YYYY-MM-DD HH:MM` wall clock, as a Date whose UTC fields hold it. */
const naive = (day: string, minute: number) => new Date(Date.parse(`${day}T00:00:00Z`) + minute * 60_000);
const spellNaive = (date: Date) => `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 16)}`;

/** Move a naive wall clock by whole periods. */
function shiftPeriods(date: Date, unit: PeriodUnit, steps: number): Date {
  const d = new Date(date.getTime());
  switch (unit) {
    case 'hour':
      d.setUTCHours(d.getUTCHours() + steps);
      break;
    case 'day':
      d.setUTCDate(d.getUTCDate() + steps);
      break;
    case 'week':
      d.setUTCDate(d.getUTCDate() + steps * 7);
      break;
    case 'month':
      d.setUTCMonth(d.getUTCMonth() + steps);
      break;
    case 'quarter':
      d.setUTCMonth(d.getUTCMonth() + steps * 3);
      break;
    case 'year':
      d.setUTCFullYear(d.getUTCFullYear() + steps);
      break;
  }
  return d;
}

/**
 * Whole periods on the venue's clock: the current one and the `last − 1`
 * before it, moved back `offset` periods — today, yesterday, this week (from
 * Monday), this month. Each boundary is the venue's own midnight (or hour),
 * turned into the instant it names there, so a day that changes the clocks
 * is 23 or 25 hours long, as the venue lived it.
 */
export function calendarBounds(
  last: number,
  unit: PeriodUnit,
  offset: number,
  now: Date,
  timezone: string,
): { start: Date; end: Date; priorStart: Date; priorEnd: Date } {
  const clock = venueClock(now, timezone);
  const today = naive(clock.day, 0);
  let current: Date;
  switch (unit) {
    case 'hour':
      current = naive(clock.day, Math.floor(clock.minute / 60) * 60);
      break;
    case 'day':
      current = today;
      break;
    case 'week':
      // Monday, as `date_trunc('week', …)` and the other two engines count.
      current = shiftPeriods(today, 'day', -((today.getUTCDay() + 6) % 7));
      break;
    case 'month':
      current = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
      break;
    case 'quarter':
      current = new Date(Date.UTC(today.getUTCFullYear(), Math.floor(today.getUTCMonth() / 3) * 3, 1));
      break;
    case 'year':
      current = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
      break;
  }
  const at = (wall: Date) => wallTimeToInstant(spellNaive(wall), timezone) ?? wall;
  const endWall = shiftPeriods(current, unit, 1 - offset);
  const startWall = shiftPeriods(current, unit, -(offset + last - 1));
  return {
    start: at(startWall),
    end: at(endWall),
    priorStart: at(shiftPeriods(startWall, unit, -last)),
    priorEnd: at(startWall),
  };
}

/**
 * The calendar window a page's day control names: `today`, `yesterday`,
 * `week` (from Monday), or a `YYYY-MM-DD` day on the venue's calendar, never
 * one still to come.
 */
export function dayWindow(value: unknown, now: Date, timezone: string): { last: number; unit: PeriodUnit; offset: number } {
  if (value === 'today') return { last: 1, unit: 'day', offset: 0 };
  if (value === 'yesterday') return { last: 1, unit: 'day', offset: 1 };
  if (value === 'week') return { last: 1, unit: 'week', offset: 0 };
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const back = Math.round((Date.parse(`${venueClock(now, timezone).day}T00:00:00Z`) - Date.parse(`${value}T00:00:00Z`)) / 86_400_000);
    if (Number.isFinite(back) && back >= 0 && back <= 400) return { last: 1, unit: 'day', offset: back };
  }
  return reject('The day asked for is not one this page can show.', { day: value });
}

/** A window's instants; `end` is null for one that reaches forward with no end. */
interface WindowBounds {
  start: Date;
  end: Date | null;
  priorStart: Date;
  priorEnd: Date;
}

/**
 * A window that reaches forward: from the start of the current period on the
 * venue's clock (today's midnight, this Monday, the 1st of this month) with no
 * end. It has no prior span — `compareToPrior` is refused on it.
 */
export function aheadBounds(unit: PeriodUnit, now: Date, timezone: string): WindowBounds {
  const { start } = calendarBounds(1, unit, 0, now, timezone);
  return { start, end: null, priorStart: start, priorEnd: start };
}

/**
 * `ahead` has one reading only. Every knob that would make it a second one is
 * refused by name instead of ignored: `last` other than 1 (a reader would take
 * it as "the next n periods" and miss every row past them), `offset`, a prior
 * span, the day control (which names a past day) and `calendar: false`.
 */
function assertAheadWindow(window: NonNullable<QueryDescriptor['window']>): void {
  const clash =
    window.last !== 1
      ? 'last'
      : window.offset !== undefined && window.offset !== 0
        ? 'offset'
        : window.compareToPrior
          ? 'compareToPrior'
          : window.param !== undefined
            ? 'param'
            : window.calendar === false
              ? 'calendar'
              : null;
  if (clash !== null) {
    reject(
      `A window that reaches ahead runs from the start of this ${window.unit} with no end, so it takes no \`${clash}\`${clash === 'last' ? ' other than 1' : ''}.`,
      { window: { ahead: true, [clash]: window[clash] } },
    );
  }
}

/** This process's own zone: what a zone-less timestamp column holds (`crud/write-values.ts`). */
const serverZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

type Ref = ReturnType<DynamicModule<SourceDatabase>['ref']>;

/**
 * An hour or day bucket on the venue's clock, as `YYYY-MM-DD HH:MM:SS` text,
 * per dialect — or, for `hour-of-day`, the venue's hour alone (`00`–`23`), so
 * every day folds into the same 24. Postgres converts every row exactly (`AT
 * TIME ZONE`, clock changes included). MySQL and SQLite, which may not know
 * zone names, add minutes chosen per row by where the row falls against the
 * instants the venue's (and, for a value kept on the server's wall clock, the
 * server's) clock moves between `range.from` and `range.to` — so a week
 * across a clock change is exact on every engine; a row outside the range
 * takes the minutes of its nearer end. SQLite keeps text, so a value written
 * with a zone and one without are moved apart.
 */
function venueBucketExpr(
  dialect: Dialect,
  ref: Ref,
  column: ResolvedColumn,
  unit: 'hour' | 'day' | 'hour-of-day',
  timezone: string,
  range: { from: Date; to: Date },
): RawBuilder<unknown> {
  const pgFormat = unit === 'hour-of-day' ? 'HH24' : unit === 'hour' ? 'YYYY-MM-DD HH24:00:00' : 'YYYY-MM-DD 00:00:00';
  const format = unit === 'hour-of-day' ? '%H' : unit === 'hour' ? '%Y-%m-%d %H:00:00' : '%Y-%m-%d 00:00:00';
  const spans = dialect === 'mysql' || dialect === 'sqlite' ? offsetSpans(timezone, serverZone(), range.from, range.to) : [];
  /** The minutes a row is moved by, chosen by `compared` (the row as `YYYY-MM-DD HH:MM:SS` on the clock `boundary` spells). */
  const perRow = (compared: RawBuilder<unknown> | Ref, minutes: (span: OffsetSpan) => number, boundary: (at: number, span: OffsetSpan) => string, spell: (n: number) => RawBuilder<unknown>) => {
    const steps = stepsOf(spans, minutes);
    if (steps.length === 1) return spell(steps[0]!.value);
    // Newest first: most rows a widget reads are recent.
    const whens = steps
      .slice(1)
      .reverse()
      .map((step) => sql`when ${compared} >= ${sql.lit(boundary(step.at!, step.span))} then ${spell(step.value)}`);
    return sql`case ${sql.join(whens, sql` `)} else ${spell(steps[0]!.value)} end`;
  };
  const text = (n: number) => sql.lit(`${String(n)} minutes`);
  switch (dialect) {
    case 'mysql': {
      // A DATETIME keeps the server's wall clock: compared as such.
      const minutes = perRow(ref, (span) => span.venue - span.server, (at, span) => wallText(at, span.server), (n) => sql.lit(n));
      return sql`date_format(date_add(${ref}, interval ${minutes} minute), ${sql.lit(format)})`;
    }
    case 'sqlite': {
      const read = sql`strftime('%Y-%m-%d %H:%M:%S', ${ref})`;
      const zoned = perRow(read, (span) => span.venue, (at) => wallText(at, 0), text);
      const wall = perRow(read, (span) => span.venue - span.server, (at, span) => wallText(at, span.server), text);
      return sql`strftime(${sql.lit(format)}, ${ref}, case when ${ref} like '%Z' or ${ref} like '%+__:__' then ${zoned} else ${wall} end)`;
    }
    default: {
      const wall =
        column.logicalType === 'timestamp'
          ? sql`((${ref} at time zone ${sql.lit(serverZone())}) at time zone ${sql.lit(timezone)})`
          : sql`(${ref} at time zone ${sql.lit(timezone)})`;
      return unit === 'hour-of-day'
        ? sql`to_char(${wall}, ${sql.lit(pgFormat)})`
        : sql`to_char(date_trunc(${sql.lit(unit)}, ${wall}), ${sql.lit(pgFormat)})`;
    }
  }
}

/** Ten years back and two ahead: the clock changes a bucket with no window reads rows across. */
const OPEN_RANGE_BACK_MS = 10 * 366 * 86_400_000;
const OPEN_RANGE_AHEAD_MS = 2 * 366 * 86_400_000;

/** The instants a venue bucket's rows can fall between: the window's, a day wider; else years around now. */
function bucketRange(bounds: { start: Date; end: Date | null } | null, now: Date): { from: Date; to: Date } {
  const day = 86_400_000;
  return {
    from: new Date((bounds?.start.getTime() ?? now.getTime() - OPEN_RANGE_BACK_MS) - day),
    to: new Date((bounds?.end?.getTime() ?? now.getTime() + OPEN_RANGE_AHEAD_MS) + day),
  };
}

/**
 * Time-bucket expression, compiled per dialect. Every bucket evaluates to the
 * ISO-lexicographic start of its period, so `GROUP BY` / `ORDER BY` over the
 * raw expression sort chronologically and the shaper's `toIso` parses the
 * result the same way for all three engines. The unit is a closed Zod enum
 * and every format token is a source constant — no caller string is inlined;
 * the only interpolation is the snapshot's own column ref.
 */
function bucketExpr(dialect: Dialect, ref: Ref, unit: PeriodUnit): RawBuilder<unknown> {
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
function mysqlBucketExpr(ref: Ref, unit: PeriodUnit): RawBuilder<unknown> {
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
function sqliteBucketExpr(ref: Ref, unit: PeriodUnit): RawBuilder<unknown> {
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
 * Late-bound `param` resolution: a filter carrying `param` reads its value
 * from the page-control params; an unset param drops the filter (the
 * control is not active). Filters with neither value nor param pass
 * through — `is_null`/`not_null` need no value.
 *
 * A group keeps what is left of it: an `and` without its inactive filters
 * (none left: no filter), and an `or` holding an inactive one is no filter at
 * all — "any of these, or anything" keeps every row, where dropping just that
 * branch would narrow the card to the others.
 */
export function resolveFilterParams(
  filters: NonNullable<QueryDescriptor['filters']>,
  params: Record<string, unknown>,
): ResolvedFilterNode[] {
  const out: ResolvedFilterNode[] = [];
  for (const filter of filters) {
    const resolved = resolveNode(filter, params);
    if (resolved !== null) out.push(resolved);
  }
  return out;
}

/** A descriptor filter with its params read: a condition (on a venue day, when it names one), or a group of them. */
export type ResolvedFilterNode = (FilterCondition & { day?: string }) | { and: ResolvedFilterNode[] } | { or: ResolvedFilterNode[] };

type FilterNode = NonNullable<QueryDescriptor['filters']>[number];

/** One filter with its params read; null when it filters nothing (an unset param). */
function resolveNode(node: FilterNode, params: Record<string, unknown>): ResolvedFilterNode | null {
  if ('and' in node || 'or' in node) {
    const children = ('and' in node ? node.and : node.or) as FilterNode[];
    const resolved = children.map((child) => resolveNode(child, params));
    if ('or' in node) return resolved.some((child) => child === null) ? null : { or: resolved as ResolvedFilterNode[] };
    const kept = resolved.filter((child): child is ResolvedFilterNode => child !== null);
    return kept.length === 0 ? null : { and: kept };
  }
  if (node.day !== undefined) {
    if (node.value !== undefined || node.param !== undefined) {
      reject('A filter compares with a `day` or with a `value` (or a `param`), not both.', { column: node.column });
    }
    return { column: node.column, op: node.op, day: node.day };
  }
  if (node.param !== undefined) {
    const value = params[node.param];
    if (value === undefined) return null; // control unset — filter inactive
    return { column: node.column, op: node.op, value };
  }
  return node.value === undefined ? { column: node.column, op: node.op } : { column: node.column, op: node.op, value: node.value };
}

/** Every condition of a descriptor's filters, groups opened. */
export function filterConditionsOf(filters: QueryDescriptor['filters']): { column: string }[] {
  const out: { column: string }[] = [];
  const walk = (node: FilterNode): void => {
    if ('and' in node || 'or' in node) {
      for (const child of ('and' in node ? node.and : node.or) as FilterNode[]) walk(child);
      return;
    }
    out.push(node);
  };
  for (const node of filters ?? []) walk(node);
  return out;
}

/**
 * The list grammar's limits, on a descriptor's filters: sixteen conditions in
 * all, groups two deep. The schema holds the depth already; this holds the
 * count, which a schema of nested lists cannot.
 */
function assertDescriptorFilterLimits(filters: QueryDescriptor['filters']): void {
  let conditions = 0;
  const walk = (node: FilterNode, depth: number): void => {
    if ('and' in node || 'or' in node) {
      if (depth >= MAX_FILTER_GROUP_DEPTH) reject('Filter groups may nest at most 2 levels deep.', { maxDepth: MAX_FILTER_GROUP_DEPTH });
      for (const child of ('and' in node ? node.and : node.or) as FilterNode[]) walk(child, depth + 1);
      return;
    }
    conditions += 1;
  };
  for (const node of filters ?? []) walk(node, 0);
  if (conditions > MAX_FILTER_CONDITIONS) reject('Filters are limited to 16 conditions.', { maxConditions: MAX_FILTER_CONDITIONS });
}

/** Shape ⇄ descriptor structural rules (semantics). */
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
    // field map — column ORDER names the roles instead (`{date, title,
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
  const lookups = opts.lookups ?? [];
  const params = opts.params ?? {};
  const now = opts.now ?? (() => new Date());

  if (descriptor.kind === 'capacity-counts') {
    reject('A `capacity-counts` binding is answered from the table\'s limit, not compiled into a query.', { kind: descriptor.kind });
  }
  if (descriptor.capacity !== undefined) {
    reject('`capacity` belongs to a `capacity-counts` binding.', { kind: descriptor.kind });
  }
  if (descriptor.counts !== undefined && descriptor.shape !== 'record-list') {
    reject('`counts` sits beside the rows of a "record-list".', { shape: descriptor.shape });
  }
  assertShapeRules(descriptor);
  // A lookup is a row key, so only a shape that returns rows as rows can carry
  // one. Every other shape would drop it silently — refused instead, so a page
  // author learns the descriptor is wrong rather than seeing a blank title.
  if ((descriptor.lookups?.length ?? 0) > 0 && descriptor.shape !== 'record-list') {
    reject('`lookups` is supported on "record-list" descriptors only.', { shape: descriptor.shape });
  }
  const table = resolveSource(view, descriptor);
  const dynamic = db.dynamic;
  const filterCtx: CompileFilterContext = { view, table, canReadPii, dynamic, dialect };

  /*
   * A column one link away (`order_id.status`): resolved by the caller, who
   * asked whether this reader may read the table and the column it reaches.
   * A column of the source whose own name has a dot stays the source's.
   */
  const isPath = (name: string) => name.includes('.') && !table.columns.has(name);
  const pathOf = (name: string): ResolvedPath => {
    const path = opts.paths?.get(name);
    if (path === undefined) {
      reject(`"${name}" reaches another table, which this read does not follow here.`, { column: name });
    }
    return path;
  };
  // The key column in `IN (SELECT key FROM parent WHERE …)`: a row whose key is empty matches nothing.
  const throughPath = (qb: Qb, path: ResolvedPath, where: (inner: Qb) => Qb): Qb =>
    qb.where((eb) => eb(dynamic.ref(path.fkColumn.name), 'in', where(db.selectFrom(path.parent.id).select(dynamic.ref(path.parentKey)) as unknown as Qb) as never));

  // --- WHERE: descriptor filters (CRUD DSL compiler) + rolling window -------
  assertDescriptorFilterLimits(descriptor.filters);
  const conditions =
    descriptor.filters === undefined ? [] : resolveFilterParams(descriptor.filters, params);
  /*
   * One filter as SQL: a column of the source through the CRUD filter
   * compiler (which resolves it with `readableColumn`), a column one link
   * away as `fkColumn IN (SELECT key FROM parent WHERE …)`, and a group as
   * the `and` / `or` of its members.
   */
  const compileNode = (eb: ExpressionBuilder<SourceDatabase, string>, node: ResolvedFilterNode): Expression<SqlBool> => {
    if ('and' in node) return eb.and(node.and.map((child) => compileNode(eb, child)));
    if ('or' in node) return eb.or(node.or.map((child) => compileNode(eb, child)));
    if (!isPath(node.column)) return compileFilter(eb as never, filterCtx, onDay(node, view.readableColumn(table, node.column, canReadPii)));
    const path = pathOf(node.column);
    // The parent's column, compiled by the same filter compiler against the parent.
    const parentCtx: CompileFilterContext = { view, table: path.parent, canReadPii: path.unmasked, dynamic, dialect };
    const keys = db
      .selectFrom(path.parent.id)
      .select(dynamic.ref(path.parentKey))
      .where((inner) => compileFilter(inner as never, parentCtx, onDay({ ...node, column: path.column.name }, path.column)));
    return eb(dynamic.ref(path.fkColumn.name), 'in', keys as never);
  };
  /** A condition on a venue day, as the plain conditions it stands for (a time column's day is its span). */
  const onDay = (node: FilterCondition & { day?: string }, column: ResolvedColumn): RecordFilter => {
    if (node.day === undefined) return { column: node.column, op: node.op, ...(node.value === undefined ? {} : { value: node.value }) };
    const conditions = venueDayConditions(column, node.op, node.day, { now: now(), dialect, timezone: opts.timezone ?? 'UTC' });
    if (conditions === null) {
      reject(`"${node.column}" cannot be compared with the day "${node.day}" by "${node.op}": a day is compared with a date or a time, by eq, neq, gt, gte, lt or lte.`, { column: node.column, op: node.op, day: node.day });
    }
    const named = conditions.map((condition) => ({ ...condition, column: node.column }));
    return named.length === 1 ? named[0]! : { and: named };
  };

  if (descriptor.window?.unit === 'hour-of-day') {
    reject('A window counts whole periods: `hour-of-day` is a bucket, not a window unit.', { window: { unit: descriptor.window.unit } });
  }
  const windowPath = descriptor.window !== undefined && isPath(descriptor.window.column) ? pathOf(descriptor.window.column) : null;
  const windowColumn =
    descriptor.window === undefined
      ? null
      : windowPath !== null
        ? windowPath.column
        : view.readableColumn(table, descriptor.window.column, canReadPii);
  const zone = opts.timezone ?? 'UTC';
  // A window that follows the page's day control takes the day it names.
  const followed = descriptor.window?.param === undefined ? undefined : params[descriptor.window.param];
  const ownWindow = descriptor.window === undefined ? undefined : { ...descriptor.window, unit: descriptor.window.unit as PeriodUnit };
  const span =
    ownWindow === undefined || followed === undefined
      ? ownWindow
      : { ...ownWindow, ...dayWindow(followed, now(), zone), calendar: true };
  const ahead = descriptor.window?.ahead === true;
  if (ahead && descriptor.window !== undefined) assertAheadWindow(descriptor.window);
  const calendar = span?.calendar === true || ahead;
  const bounds: WindowBounds | null =
    span === undefined
      ? null
      : ahead
        ? aheadBounds(span.unit, now(), zone)
        : calendar
          ? calendarBounds(span.last, span.unit, span.offset ?? 0, now(), zone)
          : windowBounds(span.last, span.unit, now());
  /*
   * A window's bounds are spelled as the column keeps them: a zone-less
   * timestamp takes this server's wall clock — what every write to it stores
   * (`crud/write-values.ts`) — and a calendar window on a date column the
   * venue's days.
   */
  const boundOf = (instant: Date): unknown =>
    windowColumn === null
      ? windowBoundValue(instant, dialect)
      : calendar
        ? calendarBoundValue(windowColumn, instant, dialect, zone)
        : instantBoundValue(windowColumn, instant, dialect);

  const applyWhere = (qb: Qb, window: { start: Date; end: Date | null } | null): Qb => {
    let out = qb;
    if (conditions.length > 0) {
      out = out.where((eb) => eb.and(conditions.map((node) => compileNode(eb as never, node))));
    }
    if (window !== null && windowColumn !== null) {
      const ref = dynamic.ref(windowColumn.name);
      const end = window.end;
      // A window that reaches forward has no end: every row from its start on.
      const bounded = (inner: Qb): Qb => {
        const from = inner.where((eb) => eb(ref, '>=', boundOf(window.start)));
        return end === null ? from : from.where((eb) => eb(ref, '<', boundOf(end)));
      };
      out = windowPath === null ? bounded(out) : throughPath(out, windowPath, bounded);
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

  /*
   * What a ranking (`categorical`) may be put in order by, other than its
   * value: one of its aggregates (the second of a pair), the column it groups
   * by, or a column of the row its group points at — its label
   * (`event_id.name`) or another (`event_id.doors_at`: the shows in date
   * order) — read-checked as a filter one link away is. A path through another column is refused: it has no
   * one value per group.
   */
  const aggregateAliases = new Set(aggregations.map((aggregation) => aggregation.alias));
  const rankingKey = (name: string): boolean =>
    aggregateAliases.has(name) || name === groupColumns[0] || isPath(name);
  const rankingOrder = (groupColumn: ResolvedColumn): { expr: RawBuilder<unknown>; dir: 'asc' | 'desc'; nullable: boolean; isNull?: RawBuilder<unknown> }[] =>
    (descriptor.orderBy ?? [])
      .filter((key) => rankingKey(key.column))
      .map((key) => {
        // An aggregate over nothing but empty values is null: last, on every engine. Inside an
        // expression an ORDER BY cannot name the output alias (Postgres reads a column), so the aggregate is repeated.
        if (aggregateAliases.has(key.column)) {
          const compiled = compiledAggs.find((aggregation) => aggregation.alias === key.column);
          return { expr: sql`${sql.ref(key.column)}`, dir: key.dir, nullable: compiled !== undefined, ...(compiled === undefined ? {} : { isNull: compiled.expr }) };
        }
        if (key.column === groupColumn.name) return { expr: sql`${dynamic.ref(groupColumn.name)}`, dir: key.dir, nullable: true };
        const path = pathOf(key.column);
        if (path.fkColumn.name !== groupColumn.name) {
          reject(`A ranking grouped by "${groupColumn.name}" is put in order through that column only.`, { orderBy: key.column });
        }
        const alias = path.parent.name === '__order' ? '__order_' : '__order';
        const outer = dynamic.ref(`${table.name}.${groupColumn.name}`);
        const value = sql`${db
          .selectFrom(`${path.parent.id} as ${alias}`)
          .select(dynamic.ref(`${alias}.${path.column.name}`))
          .whereRef(dynamic.ref(`${alias}.${path.parentKey}`), '=', outer)
          .limit(1)}`;
        return { expr: sql`(${value})`, dir: key.dir, nullable: true };
      });
  let bucketZone: string | null = null;
  const hourOfDay = descriptor.bucket?.unit === 'hour-of-day';
  const build = (window: { start: Date; end: Date | null } | null): Qb => {
    let qb = applyWhere(db.selectFrom(table.id) as unknown as Qb, window);

    if (rowShape) {
      selectedColumns =
        descriptor.select !== undefined && descriptor.select.length > 0
          ? descriptor.select.map((name) => view.readableColumn(table, name, canReadPii))
          : view.selectableColumns(table);
      qb = qb.select(selectedColumns.map((column) => dynamic.ref(column.name)));
      if (lookups.length > 0) {
        qb = qb.select((eb) => lookupSelections(eb as never, db, table, lookups)) as Qb;
      }
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
      if (hourOfDay && (bucketColumn.logicalType === 'date' || ohlcColumn !== null)) {
        reject(
          ohlcColumn !== null
            ? 'Candles follow time, so an "ohlc" cannot fold into the hours of the day.'
            : `"${bucketColumn.name}" keeps days, not times: it has no hour of the day to fold into.`,
          { bucket: descriptor.bucket },
        );
      }
      // A week asked for by the day control is drawn in days, not 168 hours.
      const unit = descriptor.bucket.unit === 'hour' && span?.unit === 'week' && followed !== undefined ? 'day' : descriptor.bucket.unit;
      // The venue's hours and days, where the venue is not on UTC.
      bucketZone =
        opts.timezone !== undefined && opts.timezone !== 'UTC' && (unit === 'hour' || unit === 'day') && bucketColumn.logicalType !== 'date'
          ? opts.timezone
          : null;
      /*
       * The hours of the day are always the venue's (UTC where it names no
       * zone): each row's own hour on that clock, whatever day it fell on.
       */
      const bucket = hourOfDay
        ? venueBucketExpr(dialect, dynamic.ref(bucketColumn.name), bucketColumn, 'hour-of-day', zone, bucketRange(window, now()))
        : bucketZone === null
          ? bucketExpr(dialect, dynamic.ref(bucketColumn.name), unit as PeriodUnit)
          : venueBucketExpr(dialect, dynamic.ref(bucketColumn.name), bucketColumn, unit as 'hour' | 'day', bucketZone, bucketRange(window, now()));
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
        const groupColumn = view.readableColumn(table, groupColumns[0] as string, canReadPii);
        const label = groupLabelExpr(db, table, groupColumn, opts.groupLabel, dialect);
        const ranking = rankingOrder(groupColumn);
        if (ranking.length === 0) {
          // Deterministic fold order: biggest buckets first, by the first alias; a group with no value last on every engine.
          qb = qb.orderBy(sql`case when ${first.expr} is null then 1 else 0 end`, 'asc').orderBy(sql.ref(first.alias), 'desc');
        } else {
          // The order asked for: an aggregate, the group, or a column of the row it points at (no value last).
          for (const { expr, dir, nullable, isNull } of ranking) {
            if (nullable) qb = qb.orderBy(sql`case when ${isNull ?? expr} is null then 1 else 0 end`, 'asc');
            qb = qb.orderBy(expr, dir);
          }
        }
        /*
         * Ties fall to the group's label, then its key, so the last row a
         * `limit` keeps is the same on every engine and every run. The label
         * is the one the reader is shown: the row the key points at, or the
         * choice column's word for it.
         */
        // A group with no label comes after every labelled one, on every engine (Postgres alone puts nulls last by itself).
        if (label !== null) qb = qb.orderBy(sql`case when ${label} is null then 1 else 0 end`, 'asc').orderBy(label, 'asc');
        qb = qb.orderBy(dynamic.ref(groupColumn.name), 'asc');
      } else if (shape !== 'categorical') {
        // Stable header order so `matrix` rows/columns and the series list of
        // `multi-timeseries` are the same on every request.
        groupColumns.forEach((_, index) => {
          qb = qb.orderBy(sql.ref(groupAliases[index] as string), 'asc');
        });
      }
    }

    for (const key of descriptor.orderBy ?? []) {
      // A ranking's own order is placed above, before its ties.
      if (shape === 'categorical' && rankingKey(key.column)) continue;
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
    groupColumns: rowShape ? [] : [...groupColumns],
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
    lookups,
    limit,
    bucketZone,
    hourOfDay: hourOfDay && (shape === 'timeseries' || shape === 'multi-timeseries'),
  };
}

/**
 * The label a categorical group is shown by, as SQL, to break ties in its
 * ranking: the foreign-key row's label column (a correlated subquery, only
 * when the reader may read it), or a choice column's words for its values.
 * Null when the key is its own label.
 */
function groupLabelExpr(
  db: Kysely<SourceDatabase>,
  table: ResolvedTable,
  column: ResolvedColumn,
  source: GroupLabelSource | undefined,
  dialect: Dialect,
): RawBuilder<unknown> | null {
  const dynamic = db.dynamic;
  const outer = dynamic.ref(`${table.name}.${column.name}`);
  if (source !== undefined) {
    const alias = source.table.name === '__label' ? '__label_' : '__label';
    return sql`${db
      .selectFrom(`${source.table.id} as ${alias}`)
      .select(dynamic.ref(`${alias}.${source.column}`))
      .whereRef(dynamic.ref(`${alias}.${source.key}`), '=', outer)
      .limit(1)}`;
  }
  const words = choiceWordsOf(table.table?.columns.find((candidate) => candidate.name === column.name)).labels;
  if (words === undefined || Object.keys(words).length === 0) return null;
  const text = dialect === 'mysql' ? sql`cast(${outer} as char)` : sql`cast(${outer} as text)`;
  const cases = Object.entries(words).map(([value, word]) => sql`when ${text} = ${value} then ${word}`);
  return sql`(case ${sql.join(cases, sql` `)} else ${text} end)`;
}
