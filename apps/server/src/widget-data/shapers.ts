/**
 * Row → data-contract envelope shapers (04-widget-registry.md §5.2 step 5).
 *
 * The server returns payloads in exactly the §3 canonical envelopes, with a
 * `shape` discriminant so client narrowing is a tagged union: single-metric
 * `{ value }`, metric+delta `{ value, prior?, deltaPct? }`, timeseries
 * `{ points: [{ t, v }], compare? }`, categorical `{ items, total }`, and
 * record-list `{ rows, columns, total }` (PII-masked).
 */

import { maskRows, type Row } from '../crud/mask.js';
import { GROUP_BUCKET_CAP, type CompiledWidgetQuery } from './compiler.js';

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

export interface ShapedCategorical {
  shape: 'categorical';
  items: { key: string; label: string; value: number }[];
  total: number;
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

export type ShapedPayload =
  | ShapedSingleMetric
  | ShapedMetricDelta
  | ShapedTimeseries
  | ShapedCategorical
  | ShapedRecordList;

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

export interface ShapeInput {
  compiled: CompiledWidgetQuery;
  rows: Row[];
  priorRows?: Row[] | undefined;
  /** `record-list` exact count (from the compiled `count` twin). */
  total?: number | undefined;
  canReadPii: boolean;
}

export function shapeRows(input: ShapeInput): ShapedPayload {
  const { compiled, rows, priorRows, canReadPii } = input;

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

    case 'categorical': {
      const alias = firstAlias(compiled);
      const groupAlias = compiled.groupAlias ?? '__group';
      const items = rows.map((row) => {
        const key = row[groupAlias] === null ? '__null' : String(row[groupAlias]);
        return {
          key,
          label: row[groupAlias] === null ? '—' : String(row[groupAlias]),
          value: toNumber(row[alias]),
        };
      });
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

    case 'record-list': {
      const columns: ColumnMeta[] = compiled.selectedColumns.map((column) => ({
        name: column.name,
        logicalType: column.logicalType,
        nullable: column.nullable,
        isPrimaryKey: column.isPrimaryKey,
      }));
      return {
        shape: 'record-list',
        rows: maskRows(rows, compiled.table, canReadPii),
        columns,
        total: input.total ?? rows.length,
      };
    }

    default:
      throw new Error(`shaper: unsupported shape ${String(compiled.shape)} (compiler bug)`);
  }
}
