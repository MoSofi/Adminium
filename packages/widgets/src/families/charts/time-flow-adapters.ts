/**
 * Pure §3-envelope → chart-primitive-input adapters for the M7 "time, forecast
 * & flow" charts group. Structural output types (compatible with the
 * @adminium/charts primitive props by shape) keep this module free of the
 * primitive components, so the conversion logic is unit-testable independently
 * of the green-loop-assembled barrel. A malformed payload returns null and the
 * widget renders its own fallback (never throws into the error boundary).
 */
import { formatShortDate } from '@adminium/charts';

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
function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
function toDate(value: unknown): Date | undefined {
  const s = str(value);
  if (s === undefined) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

// --- multi-timeseries (chart-multiline / chart-stream) -----------------------
export interface XySeries {
  key: string;
  label: string;
  points: { x: Date; y: number }[];
}

/** Narrow a `multi-timeseries` envelope to time-x series; null when unusable. */
export function toTimeSeriesGroup(data: unknown): XySeries[] | null {
  const r = rec(data);
  if (r === null || !Array.isArray(r.series)) return null;
  const out: XySeries[] = [];
  r.series.forEach((entry, index) => {
    const s = rec(entry);
    if (s === null || !Array.isArray(s.points)) return;
    const points: { x: Date; y: number }[] = [];
    for (const p of s.points) {
      const pr = rec(p);
      const x = toDate(pr?.t);
      const y = num(pr?.v);
      if (x === undefined || y === undefined) continue;
      points.push({ x, y });
    }
    if (points.length === 0) return;
    out.push({ key: str(s.key) ?? `s${index}`, label: str(s.label) ?? str(s.key) ?? `Series ${index + 1}`, points });
  });
  return out.length > 0 ? out : null;
}

// --- forecast (chart-forecast) -----------------------------------------------
export interface ForecastInputs {
  history: { x: Date; y: number }[];
  forecast: { x: Date; y: number }[];
  band: { lo: number; hi: number }[];
}

function pointsOf(value: unknown): { x: Date; y: number }[] {
  if (!Array.isArray(value)) return [];
  const out: { x: Date; y: number }[] = [];
  for (const p of value) {
    const pr = rec(p);
    const x = toDate(pr?.t);
    const y = num(pr?.v);
    if (x !== undefined && y !== undefined) out.push({ x, y });
  }
  return out;
}

/** Narrow the extended `timeseries` forecast envelope; null when no history. */
export function toForecastInputs(data: unknown): ForecastInputs | null {
  const r = rec(data);
  if (r === null) return null;
  const history = pointsOf(r.points);
  if (history.length === 0) return null;
  const forecast = pointsOf(r.forecast);
  const band: { lo: number; hi: number }[] = [];
  if (Array.isArray(r.band)) {
    for (const b of r.band) {
      const br = rec(b);
      const lo = num(br?.lo);
      const hi = num(br?.hi);
      band.push({ lo: lo ?? 0, hi: hi ?? 0 });
    }
  }
  return { history, forecast, band };
}

// --- anomaly (chart-anomaly) -------------------------------------------------
/** Narrow a `timeseries` envelope to time-x points; null when empty. */
export function toAnomalyPoints(data: unknown): { x: Date; y: number }[] | null {
  const r = rec(data);
  if (r === null) return null;
  const points = pointsOf(r.points);
  return points.length > 0 ? points : null;
}

// --- candlestick (chart-candlestick) -----------------------------------------
export interface OhlcCandle {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
}

/** Narrow an `ohlc` envelope; keep the last `count` candles. Null when empty. */
export function toCandles(data: unknown, count?: number): OhlcCandle[] | null {
  const r = rec(data);
  if (r === null || !Array.isArray(r.candles)) return null;
  const out: OhlcCandle[] = [];
  for (const entry of r.candles) {
    const c = rec(entry);
    const o = num(c?.o);
    const h = num(c?.h);
    const l = num(c?.l);
    const close = num(c?.c);
    if (o === undefined || h === undefined || l === undefined || close === undefined) continue;
    out.push({ t: str(c?.t) ?? '', o, h, l, c: close });
  }
  if (out.length === 0) return null;
  return count !== undefined && count > 0 && out.length > count ? out.slice(out.length - count) : out;
}

// --- bump (chart-bump) -------------------------------------------------------
export interface BumpInputs {
  series: { key: string; label: string; ranks: (number | null)[] }[];
  periods: number;
  maxRank: number;
  periodLabels: string[];
}

/**
 * Narrow a `multi-timeseries` envelope whose `v` encodes rank into bump inputs.
 * Periods are the distinct sorted timestamps; each series' ranks align by
 * period index. `maxRank` defaults to the observed worst rank (≥ series count).
 */
export function toBumpInputs(data: unknown, cfgPeriods?: number, cfgMaxRank?: number): BumpInputs | null {
  const group = toTimeSeriesGroup(data);
  if (group === null) return null;

  const times = new Set<number>();
  for (const s of group) for (const p of s.points) times.add(p.x.getTime());
  const sortedTimes = [...times].sort((a, b) => a - b);
  const periods = cfgPeriods ?? sortedTimes.length;
  const indexByTime = new Map(sortedTimes.map((t, i) => [t, i]));

  let observedMax = 0;
  const series = group.map((s) => {
    const ranks: (number | null)[] = Array.from({ length: periods }, () => null);
    for (const p of s.points) {
      const i = indexByTime.get(p.x.getTime());
      if (i === undefined || i >= periods) continue;
      ranks[i] = p.y;
      if (p.y > observedMax) observedMax = p.y;
    }
    return { key: s.key, label: s.label, ranks };
  });

  const maxRank = cfgMaxRank ?? Math.max(observedMax, group.length);
  const periodLabels = sortedTimes.slice(0, periods).map((t) => formatShortDate(new Date(t)));
  return { series, periods, maxRank, periodLabels };
}

// --- timeline-lanes (chart-timeline-lanes) -----------------------------------
export interface LaneInputs {
  lanes: string[];
  events: { lane: string; position: number; label: string; tone?: string }[];
  axisLabels: string[];
}

/**
 * Narrow a `calendar-events` envelope: `category` → lane, `date` → normalized
 * position over the event span, `tone` preserved. Lanes come from config or the
 * distinct categories in first-seen order. Null when there are no dated events.
 */
export function toLaneInputs(data: unknown, cfgLanes?: readonly string[], axisBuckets = 4): LaneInputs | null {
  const r = rec(data);
  if (r === null || !Array.isArray(r.events)) return null;

  const parsed: { lane: string; ms: number; label: string; tone: string | undefined }[] = [];
  for (const entry of r.events) {
    const e = rec(entry);
    const date = toDate(e?.date);
    if (date === undefined) continue;
    parsed.push({
      lane: str(e?.category) ?? 'Events',
      ms: date.getTime(),
      label: str(e?.title) ?? '',
      tone: str(e?.tone),
    });
  }
  if (parsed.length === 0) return null;

  const times = parsed.map((p) => p.ms);
  const min = Math.min(...times);
  const max = Math.max(...times);
  const span = max - min || 1;

  const lanes =
    cfgLanes !== undefined && cfgLanes.length > 0
      ? [...cfgLanes]
      : parsed.reduce<string[]>((acc, p) => (acc.includes(p.lane) ? acc : [...acc, p.lane]), []);

  const events = parsed.map((p) => ({
    lane: p.lane,
    position: (p.ms - min) / span,
    label: p.label,
    ...(p.tone !== undefined ? { tone: p.tone } : {}),
  }));

  const buckets = Math.max(0, axisBuckets);
  const axisLabels =
    buckets === 0
      ? []
      : Array.from({ length: buckets }, (_, i) =>
          formatShortDate(new Date(min + (span * i) / Math.max(1, buckets - 1))),
        );

  return { lanes, events, axisLabels };
}
