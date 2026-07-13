/**
 * Deterministic demo-data generators (workplan/04-widget-registry.md §7.7).
 * Same seed → identical payload, across processes and reloads: the time base
 * is a fixed epoch, never `Date.now()`. Plausible ranges + weekday
 * seasonality for timeseries.
 */
import { mulberry32 } from './mulberry32.js';

/** Fixed anchor so demo timeseries are reproducible (last point lands here). */
export const DEMO_EPOCH_MS = Date.UTC(2026, 5, 30); // 2026-06-30T00:00:00Z

const DAY_MS = 86_400_000;
/** Sun..Sat traffic multipliers — weekend dip, midweek peak. */
const WEEKDAY_FACTOR = [0.62, 1.0, 1.06, 1.1, 1.08, 1.02, 0.7] as const;

export interface DemoTimeseriesOptions {
  /** Number of points (default 30 — one month of dailies). */
  points?: number;
  /** Baseline magnitude (default 1200). */
  base?: number;
  /** Additive drift per step as a fraction of base (default +0.6%). */
  drift?: number;
  /** Random-walk volatility as a fraction of base (default 12%). */
  volatility?: number;
  /** Timestamp of the LAST point (default DEMO_EPOCH_MS). */
  endMs?: number;
  /** Milliseconds between points (default one day). */
  stepMs?: number;
}

export interface DemoPoint {
  x: Date;
  y: number;
}

/** Random-walk daily series with weekday seasonality. */
export function demoTimeseries(seed: number, options: DemoTimeseriesOptions = {}): DemoPoint[] {
  const {
    points = 30,
    base = 1200,
    drift = 0.006,
    volatility = 0.12,
    endMs = DEMO_EPOCH_MS,
    stepMs = DAY_MS,
  } = options;
  const random = mulberry32(seed);
  const out: DemoPoint[] = [];
  let level = base;
  for (let i = 0; i < points; i += 1) {
    const date = new Date(endMs - (points - 1 - i) * stepMs);
    level = Math.max(base * 0.15, level + (random() - 0.5) * 2 * volatility * base + drift * base);
    const factor = stepMs === DAY_MS ? (WEEKDAY_FACTOR[date.getUTCDay()] ?? 1) : 1;
    out.push({ x: date, y: Math.round(level * factor) });
  }
  return out;
}

/** Prior-period comparison for a series: same shape, dampened and offset. */
export function demoComparisonSeries(series: readonly DemoPoint[], seed: number): DemoPoint[] {
  const random = mulberry32(seed ^ 0x9e3779b9);
  const scale = 0.72 + random() * 0.18;
  return series.map((p) => ({ x: p.x, y: Math.round(p.y * scale * (0.9 + random() * 0.2)) }));
}

export interface DemoCategory {
  label: string;
  value: number;
}

const DEFAULT_CATEGORIES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'] as const;

/** Categorical values in a plausible 40–140 band. */
export function demoCategorical(seed: number, categories: readonly string[] = DEFAULT_CATEGORIES): DemoCategory[] {
  const random = mulberry32(seed);
  return categories.map((label) => ({ label, value: Math.round(40 + random() * 100) }));
}

export interface DemoGroupedBars {
  categories: string[];
  series: { name: string; values: number[] }[];
}

/** Two-series grouped bars (this period vs prior, prior slightly lower). */
export function demoGroupedBars(seed: number, categories: readonly string[] = DEFAULT_CATEGORIES): DemoGroupedBars {
  const random = mulberry32(seed);
  const current = categories.map(() => Math.round(60 + random() * 90));
  const previous = current.map((v) => Math.round(v * (0.62 + random() * 0.3)));
  return {
    categories: [...categories],
    series: [
      { name: 'Current', values: current },
      { name: 'Previous', values: previous },
    ],
  };
}

const DEMO_PLANS = ['Free', 'Pro', 'Business', 'Enterprise'] as const;

/** Part-to-whole slices with descending plausible weights. */
export function demoDonut(seed: number, labels: readonly string[] = DEMO_PLANS): DemoCategory[] {
  const random = mulberry32(seed);
  let weight = 400 + random() * 300;
  return labels.map((label) => {
    const value = Math.round(weight);
    weight *= 0.45 + random() * 0.25;
    return { label, value };
  });
}

/** 6–12 point micro-series for sparklines. */
export function demoSparkline(seed: number, points = 8): number[] {
  const random = mulberry32(seed);
  let level = 40 + random() * 30;
  return Array.from({ length: points }, () => {
    level = Math.min(100, Math.max(8, level + (random() - 0.45) * 22));
    return Math.round(level);
  });
}
