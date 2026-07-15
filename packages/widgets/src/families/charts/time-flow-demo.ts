/**
 * Deterministic seeded demo payloads for the M7 "time, forecast & flow" charts
 * (04 §7.7, acceptance #11 — byte-identical across runs/platforms). Time base
 * is the fixed `DEMO_EPOCH_MS`, randomness is the repo PRNG (`mulberry32`);
 * never `Date.now()`/`Math.random()`. Each generator emits the exact §3
 * envelope its widget's `dataContract` declares.
 */
import { DEMO_EPOCH_MS, mulberry32 } from '@adminium/charts';

const DAY = 86_400_000;
const WEEK = DAY * 7;

export interface DemoTsPoint {
  t: string;
  v: number;
}
export interface DemoMultiTimeseries {
  series: { key: string; label: string; points: DemoTsPoint[] }[];
}
export interface DemoForecast {
  points: DemoTsPoint[];
  forecast: DemoTsPoint[];
  band: { t: string; lo: number; hi: number }[];
}
export interface DemoTimeseries {
  points: DemoTsPoint[];
}
export interface DemoOhlc {
  candles: { t: string; o: number; h: number; l: number; c: number }[];
}
export interface DemoCalendarEvents {
  events: { date: string; title: string; category: string; tone?: string }[];
}

function isoAt(endMs: number, stepMs: number, count: number, index: number): string {
  return new Date(endMs - (count - 1 - index) * stepMs).toISOString();
}

/** Rising random-walk values, clamped positive. */
function walk(random: () => number, base: number, drift: number, volatility: number, count: number): number[] {
  const out: number[] = [];
  let level = base;
  for (let i = 0; i < count; i += 1) {
    level = Math.max(base * 0.1, level + drift + (random() - 0.5) * 2 * volatility);
    out.push(Math.round(level));
  }
  return out;
}

// --- chart-multiline: multi-timeseries ---------------------------------------
const MULTILINE_LABELS = ['Cohort Jan', 'Cohort Feb', 'Cohort Mar'] as const;

export function chartMultilineDemoData(seed: number): DemoMultiTimeseries {
  const count = 12;
  const series = MULTILINE_LABELS.map((label, s) => {
    const random = mulberry32(seed + s * 101);
    const values = walk(random, 40 + s * 12, 6 - s, 9, count);
    return {
      key: label.toLowerCase().replace(/\s+/g, '-'),
      label,
      points: values.map((v, i) => ({ t: isoAt(DEMO_EPOCH_MS, WEEK * 4, count, i), v })),
    };
  });
  return { series };
}

// --- chart-stream: multi-timeseries (composition) ----------------------------
const STREAM_LABELS = ['Direct', 'Search', 'Social', 'Referral'] as const;

export function chartStreamDemoData(seed: number): DemoMultiTimeseries {
  const count = 16;
  const series = STREAM_LABELS.map((label, s) => {
    const random = mulberry32(seed + s * 211);
    const values = walk(random, 120 - s * 22, 0.5, 16, count);
    return {
      key: label.toLowerCase(),
      label,
      points: values.map((v, i) => ({ t: isoAt(DEMO_EPOCH_MS, WEEK, count, i), v: Math.max(4, v) })),
    };
  });
  return { series };
}

// --- chart-forecast: timeseries + forecast + band ----------------------------
export function chartForecastDemoData(seed: number): DemoForecast {
  const random = mulberry32(seed);
  const historyCount = 24;
  const history = walk(random, 800, 14, 60, historyCount);
  const points = history.map((v, i) => ({ t: isoAt(DEMO_EPOCH_MS, WEEK, historyCount, i), v }));

  const horizon = 8;
  const lastValue = history.at(-1) ?? 800;
  const trend = (lastValue - (history[0] ?? lastValue)) / Math.max(1, historyCount - 1);
  const baseVol = 55;
  const forecast: DemoTsPoint[] = [];
  const band: DemoForecast['band'] = [];
  let projected = lastValue;
  for (let step = 1; step <= horizon; step += 1) {
    projected += trend + (random() - 0.5) * baseVol * 0.4;
    const t = new Date(DEMO_EPOCH_MS + step * WEEK).toISOString();
    const spread = baseVol * Math.sqrt(step) * 1.64;
    forecast.push({ t, v: Math.round(projected) });
    band.push({ t, lo: Math.round(projected - spread), hi: Math.round(projected + spread) });
  }
  return { points, forecast, band };
}

// --- chart-anomaly: timeseries (spikes injected) -----------------------------
export function chartAnomalyDemoData(seed: number): DemoTimeseries {
  const random = mulberry32(seed);
  const count = 40;
  const base = walk(random, 220, 0, 14, count);
  // Inject a couple of deterministic spikes.
  const spikeA = 8 + Math.floor(random() * 6);
  const spikeB = 24 + Math.floor(random() * 8);
  const points = base.map((v, i) => {
    let value = v;
    if (i === spikeA) value = Math.round(v * 2.4);
    if (i === spikeB) value = Math.round(v * 0.35);
    return { t: isoAt(DEMO_EPOCH_MS, DAY, count, i), v: value };
  });
  return { points };
}

// --- chart-candlestick: ohlc -------------------------------------------------
export function chartCandlestickDemoData(seed: number): DemoOhlc {
  const random = mulberry32(seed);
  const count = 48;
  const candles: DemoOhlc['candles'] = [];
  let prevClose = 100 + random() * 40;
  for (let i = 0; i < count; i += 1) {
    const open = prevClose;
    const change = (random() - 0.48) * 6;
    const close = Math.max(5, open + change);
    const high = Math.max(open, close) + random() * 3;
    const low = Math.min(open, close) - random() * 3;
    candles.push({
      t: isoAt(DEMO_EPOCH_MS, DAY, count, i),
      o: round2(open),
      h: round2(high),
      l: round2(Math.max(1, low)),
      c: round2(close),
    });
    prevClose = close;
  }
  return { candles };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// --- chart-bump: multi-timeseries (v = rank) ---------------------------------
const BUMP_LABELS = ['Organic', 'Paid', 'Email', 'Social', 'Direct'] as const;

export function chartBumpDemoData(seed: number): DemoMultiTimeseries {
  const periods = 6;
  const n = BUMP_LABELS.length;
  // A deterministic rank permutation per period (seeded Fisher–Yates).
  const perPeriodRanks: number[][] = [];
  for (let p = 0; p < periods; p += 1) {
    const random = mulberry32(seed + p * 733);
    const order = Array.from({ length: n }, (_, i) => i); // entity index → rank slot
    for (let i = n - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      const tmp = order[i]!;
      order[i] = order[j]!;
      order[j] = tmp;
    }
    // order[slot] = entity index at rank slot+1 → invert to entity → rank.
    const ranks = new Array<number>(n).fill(1);
    order.forEach((entity, slot) => {
      ranks[entity] = slot + 1;
    });
    perPeriodRanks.push(ranks);
  }

  const series = BUMP_LABELS.map((label, e) => ({
    key: label.toLowerCase(),
    label,
    points: Array.from({ length: periods }, (_, p) => ({
      t: isoAt(DEMO_EPOCH_MS, WEEK * 4, periods, p),
      v: perPeriodRanks[p]?.[e] ?? 1,
    })),
  }));
  return { series };
}

// --- chart-timeline-lanes: calendar-events -----------------------------------
const LANE_DEFS = [
  { lane: 'Deploys', tone: 'info', titles: ['v2.1', 'v2.2', 'v2.3', 'v2.4'] },
  { lane: 'Incidents', tone: 'danger', titles: ['SEV2', 'SEV3'] },
  { lane: 'Releases', tone: 'pos', titles: ['Beta', 'GA'] },
] as const;

export function chartTimelineLanesDemoData(seed: number): DemoCalendarEvents {
  const random = mulberry32(seed);
  const spanDays = 84;
  const startMs = DEMO_EPOCH_MS - spanDays * DAY;
  const events: DemoCalendarEvents['events'] = [];
  for (const def of LANE_DEFS) {
    for (const title of def.titles) {
      const dayOffset = Math.floor(random() * spanDays);
      events.push({
        date: new Date(startMs + dayOffset * DAY).toISOString(),
        title,
        category: def.lane,
        tone: def.tone,
      });
    }
  }
  // Stable order: by date ascending, then lane.
  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.category.localeCompare(b.category)));
  return { events };
}
