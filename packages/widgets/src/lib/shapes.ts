// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Lenient payload narrowing for the §3 canonical envelopes (04 §3). Widget
 * components receive `data: unknown` from WidgetHost (already known to be
 * non-empty per the definition's `isEmpty` predicate) and narrow it here —
 * a malformed payload returns null and the component renders its own
 * fallback instead of throwing into the error boundary.
 */

type Rec = Record<string, unknown>;

function rec(value: unknown): Rec | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Rec) : null;
}

function num(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export interface TsPointData {
  /** ISO 8601. */
  t: string;
  v: number;
}

export interface TimeseriesData {
  points: TsPointData[];
  compare?: TsPointData[] | undefined;
}

export interface MetricDeltaData {
  value: number;
  prior?: number | undefined;
  deltaPct?: number | undefined;
  spark?: number[] | undefined;
}

export interface SingleMetricData {
  value: number;
  unit?: string | undefined;
}

export interface CategoricalItemData {
  key: string;
  label: string;
  value: number;
  tone?: string | undefined;
}

export interface CategoricalData {
  items: CategoricalItemData[];
  total?: number | undefined;
}

function pointsOf(value: unknown): TsPointData[] | null {
  if (!Array.isArray(value)) return null;
  const out: TsPointData[] = [];
  for (const entry of value) {
    const r = rec(entry);
    const v = num(r?.v);
    if (r === null || typeof r.t !== 'string' || v === undefined) return null;
    out.push({ t: r.t, v });
  }
  return out;
}

export function asTimeseries(data: unknown): TimeseriesData | null {
  const r = rec(data);
  if (r === null) return null;
  const points = pointsOf(r.points);
  if (points === null) return null;
  const compare = r.compare === undefined ? undefined : (pointsOf(r.compare) ?? undefined);
  return compare === undefined ? { points } : { points, compare };
}

/** Accepts `metric+delta` and plain `single-metric` payloads (kpi cards take both). */
export function asMetricDelta(data: unknown): MetricDeltaData | null {
  const r = rec(data);
  const value = num(r?.value);
  if (r === null || value === undefined) return null;
  const spark = Array.isArray(r.spark)
    ? r.spark.map(num).filter((v): v is number => v !== undefined)
    : undefined;
  return {
    value,
    prior: num(r.prior),
    deltaPct: num(r.deltaPct),
    spark: spark !== undefined && spark.length > 0 ? spark : undefined,
  };
}

export function asSingleMetric(data: unknown): SingleMetricData | null {
  const r = rec(data);
  const value = num(r?.value);
  if (r === null || value === undefined) return null;
  return { value, unit: typeof r.unit === 'string' ? r.unit : undefined };
}

export function asCategorical(data: unknown): CategoricalData | null {
  const r = rec(data);
  if (r === null || !Array.isArray(r.items)) return null;
  const items: CategoricalItemData[] = [];
  for (const entry of r.items) {
    const item = rec(entry);
    const value = num(item?.value);
    if (item === null || value === undefined) return null;
    const label = typeof item.label === 'string' ? item.label : String(item.key ?? '');
    items.push({
      key: typeof item.key === 'string' ? item.key : label,
      label,
      value,
      tone: typeof item.tone === 'string' ? item.tone : undefined,
    });
  }
  return { items, total: num(r.total) };
}

/** Timeseries y-values for sparkline embedding. */
export function timeseriesValues(data: TimeseriesData): number[] {
  return data.points.map((point) => point.v);
}
