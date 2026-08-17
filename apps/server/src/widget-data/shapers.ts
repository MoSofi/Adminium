// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Row → data-contract envelope shapers (04-widget-registry.md §5.2 step 5).
 *
 * The server returns payloads in exactly the §3 canonical envelopes, with a
 * `shape` discriminant so client narrowing is a tagged union: single-metric
 * `{ value }`, metric+delta `{ value, prior?, deltaPct? }`, timeseries
 * `{ points: [{ t, v }], compare? }`, multi-timeseries `{ series }`,
 * categorical `{ items, total }`, matrix `{ rowKeys, colKeys, cells }`,
 * distribution `{ groups }`, calendar-events `{ events }`, record
 * `{ row, columns }` and record-list `{ rows, columns, total }`.
 *
 * PII lives HERE, not in SQL: the compiler refuses a masked column the caller
 * named explicitly, but a row-bearing descriptor without `select` falls back
 * to every selectable column — masked ones included. Every row-bearing shape
 * (`record`, `record-list`, `stream`, `calendar-events`) therefore routes its
 * rows through `maskRows` before they reach an envelope. A new row shape that
 * skips that call leaks masked columns to callers without the unmask grant.
 */

import { maskRows, type Row } from '../crud/mask.js';
import { widgetDataChannel } from '../realtime/hub.js';
import {
  DISTRIBUTION_QUANTILES,
  GROUP_BUCKET_CAP,
  type CompiledWidgetQuery,
  type PercentileScan,
} from './compiler.js';

export interface TsPoint {
  /** ISO 8601 bucket start. */
  t: string;
  v: number;
}

export interface ShapedSingleMetric {
  shape: 'single-metric';
  value: number;
}

export interface ShapedMetricDelta {
  shape: 'metric+delta';
  value: number;
  prior?: number;
  deltaPct?: number;
}

export interface ShapedTimeseries {
  shape: 'timeseries';
  points: TsPoint[];
  compare?: TsPoint[];
}

export interface ShapedMultiTimeseries {
  shape: 'multi-timeseries';
  series: { key: string; label: string; points: TsPoint[] }[];
}

export interface ShapedCategorical {
  shape: 'categorical';
  items: { key: string; label: string; value: number }[];
  total: number;
}

export interface ShapedMatrix {
  shape: 'matrix';
  rowKeys: string[];
  colKeys: string[];
  /** `cells[row][col]`; `null` where the group-by produced no pair. */
  cells: (number | null)[][];
}

export interface DistributionGroup {
  key: string;
  label: string;
  min: number;
  q1: number;
  med: number;
  q3: number;
  max: number;
}

export interface ShapedDistribution {
  shape: 'distribution';
  groups: DistributionGroup[];
}

/** One `calendar-events` entry (04 §3 `{date, title, category?, time?, end?}`). */
export interface CalendarEvent {
  id?: string | number;
  /** `YYYY-MM-DD`, or the full ISO instant when the column carries a time. */
  date: string;
  title: string;
  category?: string;
  /** 24-hour `HH:MM` start, present only when the date column has a time. */
  time?: string;
  end?: string;
}

export interface ShapedCalendarEvents {
  shape: 'calendar-events';
  events: CalendarEvent[];
}

export interface ColumnMeta {
  name: string;
  logicalType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
}

export interface ShapedRecordList {
  shape: 'record-list';
  rows: Row[];
  columns: ColumnMeta[];
  total: number;
}

export interface ShapedRecord {
  shape: 'record';
  /** The single (PII-masked) row, or `null` when the filters matched nothing. */
  row: Row | null;
  columns: ColumnMeta[];
}

export interface ShapedStream {
  shape: 'stream';
  /** Authoritative WS channel the client subscribes to (04 §5.3). */
  channel: string;
  /** Initial (PII-masked) rows, newest-first. */
  snapshot: Row[];
  columns: ColumnMeta[];
}

export type ShapedPayload =
  | ShapedSingleMetric
  | ShapedMetricDelta
  | ShapedTimeseries
  | ShapedMultiTimeseries
  | ShapedCategorical
  | ShapedMatrix
  | ShapedDistribution
  | ShapedCalendarEvents
  | ShapedRecord
  | ShapedRecordList
  | ShapedStream;

/**
 * Per-axis key cap for `matrix`. The compiled query is already bounded by the
 * row LIMIT, but 1000 rows of unique pairs would inflate into a million-cell
 * dense grid; no matrix chart is readable past ~100 keys an axis, so the tail
 * of the (deterministically ordered) keys is dropped rather than materialised.
 */
export const MATRIX_AXIS_CAP = 100;

/** PG returns numerics/bigints as strings — coerce every metric to number. */
export function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (typeof value === 'bigint') return Number(value);
  return 0;
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    return value;
  }
  return String(value);
}

function firstAlias(compiled: CompiledWidgetQuery): string {
  const alias = compiled.aggregationAliases[0];
  if (alias === undefined) throw new Error('shaper: no aggregation alias (compiler bug)');
  return alias;
}

function metricOf(rows: Row[], alias: string): number {
  return toNumber(rows[0]?.[alias]);
}

function pointsOf(rows: Row[], bucketAlias: string, valueAlias: string): TsPoint[] {
  return rows.map((row) => ({ t: toIso(row[bucketAlias]), v: toNumber(row[valueAlias]) }));
}

/** Group-key normalization shared by every keyed envelope (`null` ⇒ `__null`). */
function keyOf(value: unknown): { key: string; label: string } {
  return value === null || value === undefined
    ? { key: '__null', label: '—' }
    : { key: String(value), label: String(value) };
}

/**
 * Linear-interpolation quantile over a SORTED array — the same definition
 * Postgres `percentile_cont` uses, so the in-process fallback and the native
 * SQL path agree to floating-point rounding.
 */
export function quantile(sorted: readonly number[], p: number): number {
  const first = sorted[0];
  if (first === undefined) return 0;
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const low = sorted[lo] ?? first;
  if (lo === hi) return low;
  return low + ((sorted[hi] ?? low) - low) * (pos - lo);
}

/**
 * Fold a raw quantile scan into aggregate-shaped rows (see `PercentileScan`):
 * one row per key, carrying exactly the aliases the native SQL path would have
 * selected. Every downstream case therefore reads the same row layout whether
 * the engine had `percentile_cont` or not. NULL values are skipped, as SQL
 * aggregates skip them.
 */
function foldPercentileScan(scan: PercentileScan, rows: Row[]): Row[] {
  const { keyAlias, valueAlias } = scan;
  const groups = new Map<string, { key: unknown; values: number[] }>();
  for (const row of rows) {
    const rawKey = keyAlias === null ? null : row[keyAlias];
    const id = keyAlias === null ? '' : keyOf(rawKey).key;
    let group = groups.get(id);
    if (group === undefined) {
      group = { key: rawKey, values: [] };
      groups.set(id, group);
    }
    const value = row[valueAlias];
    if (value === null || value === undefined) continue;
    group.values.push(toNumber(value));
  }
  const folded = [...groups.values()].map((group) => {
    group.values.sort((a, b) => a - b);
    const out: Row = {};
    if (keyAlias !== null) out[keyAlias] = group.key;
    for (const { alias, p } of scan.quantiles) out[alias] = quantile(group.values, p);
    return out;
  });
  if (keyAlias === null) return folded;
  if (scan.order === 'key-asc') {
    folded.sort((a, b) => keyOf(a[keyAlias]).key.localeCompare(keyOf(b[keyAlias]).key, 'en'));
  } else {
    const first = scan.quantiles[0]?.alias;
    if (first !== undefined) folded.sort((a, b) => toNumber(b[first]) - toNumber(a[first]));
  }
  return folded;
}

/**
 * Split a date/timestamp cell into the calendar day and, when the column
 * carries a time of day, its `HH:MM`. A DATE column lands on midnight and gets
 * no `time`, which is exactly what the calendar widgets want (they place on
 * the day and prefix the chip only when there is a clock time).
 */
function dayAndTime(value: unknown): { date: string; time?: string } {
  const iso = toIso(value);
  const parts = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(iso);
  if (parts === null) return { date: iso };
  const [, day, time] = parts as unknown as [string, string, string];
  return time === '00:00' ? { date: day } : { date: day, time };
}

export interface ShapeInput {
  compiled: CompiledWidgetQuery;
  rows: Row[];
  priorRows?: Row[] | undefined;
  /** `record-list` exact count (from the compiled `count` twin). */
  total?: number | undefined;
  canReadPii: boolean;
  /** Connection id — needed to build the `stream` channel name. */
  connectionId?: string | undefined;
}

function columnMetaOf(compiled: CompiledWidgetQuery): ColumnMeta[] {
  return compiled.selectedColumns.map((column) => ({
    name: column.name,
    logicalType: column.logicalType,
    nullable: column.nullable,
    isPrimaryKey: column.isPrimaryKey,
  }));
}

export function shapeRows(input: ShapeInput): ShapedPayload {
  const { compiled, canReadPii } = input;
  // Engines without a percentile function return the raw value column instead
  // of aggregates; folding here means every case below is dialect-blind.
  const scan = compiled.percentileScan ?? null;
  const rows = scan === null ? input.rows : foldPercentileScan(scan, input.rows);
  const priorRows =
    input.priorRows === undefined || scan === null
      ? input.priorRows
      : foldPercentileScan(scan, input.priorRows);

  switch (compiled.shape) {
    case 'single-metric':
      return { shape: 'single-metric', value: metricOf(rows, firstAlias(compiled)) };

    case 'metric+delta': {
      const alias = firstAlias(compiled);
      const value = metricOf(rows, alias);
      if (priorRows === undefined) return { shape: 'metric+delta', value };
      const prior = metricOf(priorRows, alias);
      return prior === 0
        ? { shape: 'metric+delta', value, prior }
        : { shape: 'metric+delta', value, prior, deltaPct: (value - prior) / Math.abs(prior) };
    }

    case 'timeseries': {
      const alias = firstAlias(compiled);
      const bucketAlias = compiled.bucketAlias ?? '__bucket';
      const points = pointsOf(rows, bucketAlias, alias);
      return priorRows === undefined
        ? { shape: 'timeseries', points }
        : { shape: 'timeseries', points, compare: pointsOf(priorRows, bucketAlias, alias) };
    }

    case 'multi-timeseries': {
      const alias = firstAlias(compiled);
      const bucketAlias = compiled.bucketAlias ?? '__bucket';
      const groupAlias = compiled.groupAlias ?? '__group';
      // Rows arrive bucket-major (compiler ORDER BY), so appending in row order
      // keeps each series chronological without a second sort.
      const series = new Map<string, ShapedMultiTimeseries['series'][number]>();
      for (const row of rows) {
        const { key, label } = keyOf(row[groupAlias]);
        let entry = series.get(key);
        if (entry === undefined) {
          entry = { key, label, points: [] };
          series.set(key, entry);
        }
        entry.points.push({ t: toIso(row[bucketAlias]), v: toNumber(row[alias]) });
      }
      return { shape: 'multi-timeseries', series: [...series.values()] };
    }

    case 'matrix': {
      const alias = firstAlias(compiled);
      const groupAlias = compiled.groupAlias ?? '__group';
      const colAlias = compiled.colAlias ?? '__col';
      const rowKeys: string[] = [];
      const colKeys: string[] = [];
      const values = new Map<string, number>();
      for (const row of rows) {
        const r = keyOf(row[groupAlias]).key;
        const c = keyOf(row[colAlias]).key;
        if (!rowKeys.includes(r)) {
          if (rowKeys.length >= MATRIX_AXIS_CAP) continue;
          rowKeys.push(r);
        }
        if (!colKeys.includes(c)) {
          if (colKeys.length >= MATRIX_AXIS_CAP) continue;
          colKeys.push(c);
        }
        values.set(`${r}\u0000${c}`, toNumber(row[alias]));
      }
      // NUL joins the pair key: it cannot appear in a value that arrived as
      // text, so `a|b × c` can never collide with `a × b|c`.
      const cells = rowKeys.map((r) => colKeys.map((c) => values.get(`${r}\u0000${c}`) ?? null));
      return { shape: 'matrix', rowKeys, colKeys, cells };
    }

    case 'distribution': {
      const groupAlias = compiled.groupAlias;
      const groups = rows.map((row) => {
        const { key, label } = groupAlias === null ? { key: 'all', label: 'All' } : keyOf(row[groupAlias]);
        const quantiles = Object.fromEntries(
          DISTRIBUTION_QUANTILES.map(({ alias, key: name }) => [name, toNumber(row[alias])]),
        ) as Record<'min' | 'q1' | 'med' | 'q3' | 'max', number>;
        return { key, label, ...quantiles };
      });
      return { shape: 'distribution', groups };
    }

    case 'calendar-events': {
      // Positional `select` = the event field map (compiler `assertShapeRules`
      // guarantees 2–4 columns): date, title, category?, end?.
      const [dateColumn, titleColumn, categoryColumn, endColumn] = compiled.selectedColumns;
      if (dateColumn === undefined || titleColumn === undefined) {
        throw new Error('shaper: calendar-events needs [date, title] columns (compiler bug)');
      }
      const [pk] = compiled.table.primaryKey;
      const events = maskRows(rows, compiled.table, canReadPii).map((row) => {
        const { date, time } = dayAndTime(row[dateColumn.name]);
        const event: CalendarEvent = { date, title: String(row[titleColumn.name] ?? '') };
        const id = pk === undefined ? undefined : row[pk];
        if (typeof id === 'string' || typeof id === 'number') event.id = id;
        if (time !== undefined) event.time = time;
        const category = categoryColumn === undefined ? null : row[categoryColumn.name];
        if (category !== null && category !== undefined) event.category = String(category);
        const end = endColumn === undefined ? undefined : dayAndTime(row[endColumn.name]).time;
        if (end !== undefined) event.end = end;
        return event;
      });
      return { shape: 'calendar-events', events };
    }

    case 'categorical': {
      const alias = firstAlias(compiled);
      const groupAlias = compiled.groupAlias ?? '__group';
      const items = rows.map((row) => ({ ...keyOf(row[groupAlias]), value: toNumber(row[alias]) }));
      // Cardinality cap: rows arrive ordered by value desc (compiler); fold
      // the tail into `__other` (04 §5.2 guardrails — fold is over fetched
      // rows, themselves bounded by the hard LIMIT).
      let capped = items;
      if (items.length > GROUP_BUCKET_CAP) {
        const head = items.slice(0, GROUP_BUCKET_CAP);
        const otherValue = items.slice(GROUP_BUCKET_CAP).reduce((sum, item) => sum + item.value, 0);
        capped = [...head, { key: '__other', label: 'Other', value: otherValue }];
      }
      const total = capped.reduce((sum, item) => sum + item.value, 0);
      return { shape: 'categorical', items: capped, total };
    }

    case 'record': {
      // Compiled with LIMIT 1; no match is `row: null`, which is exactly what
      // `isEmptyByShape.record` reads as the empty state.
      return {
        shape: 'record',
        row: maskRows(rows, compiled.table, canReadPii)[0] ?? null,
        columns: columnMetaOf(compiled),
      };
    }

    case 'record-list': {
      return {
        shape: 'record-list',
        rows: maskRows(rows, compiled.table, canReadPii),
        columns: columnMetaOf(compiled),
        total: input.total ?? rows.length,
      };
    }

    case 'stream': {
      // Server-authoritative channel from the RESOLVED table id — the client
      // subscribes to exactly what the CRUD/job publisher fans out on (04 §5.3).
      if (input.connectionId === undefined) {
        throw new Error('shaper: stream shape requires connectionId (route bug)');
      }
      return {
        shape: 'stream',
        channel: widgetDataChannel(input.connectionId, compiled.table.id),
        snapshot: maskRows(rows, compiled.table, canReadPii),
        columns: columnMetaOf(compiled),
      };
    }

    default:
      throw new Error(`shaper: unsupported shape ${String(compiled.shape)} (compiler bug)`);
  }
}
