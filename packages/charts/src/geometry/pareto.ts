/**
 * Pure Pareto layout (`chart-pareto`, research/widget-registry.md §2): sorted
 * bars + a cumulative-% line, with an optional cutline (default 80%). DOM-free.
 * Categorical x mirrors in RTL (band-scale range flip); the cumulative line is
 * built in the same visual order so it tracks the mirrored bars. Y for bars is
 * value-scaled (left axis); the line uses the 0..1 cumulative axis (right).
 */
import { categoricalBandScale } from './scales.js';
import { linePath } from './lineArea.js';
import type { XYPoint } from './lineArea.js';
import { niceTicks } from '../utils/stats.js';

export interface ParetoInput {
  label: string;
  value: number;
}

export interface ParetoBar {
  index: number;
  label: string;
  value: number;
  /** Cumulative share up to and including this bar, 0..1. */
  cumulative: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Center x (used for the cumulative-line vertex + tick anchor). */
  centerX: number;
  /** Cumulative-line vertex y (right axis). */
  lineY: number;
}

export interface ParetoLayout {
  bars: ParetoBar[];
  /** Cumulative polyline path (right axis). Null when < 1 bar. */
  linePath: string | null;
  linePoints: XYPoint[];
  /** Nice value ticks for the left axis (ascending). */
  yTicks: number[];
  yFor: (value: number) => number;
  /** Cutline y (right axis) or null when disabled. */
  cutlineY: number | null;
  cutline: number;
  total: number;
}

export interface ParetoLayoutOptions {
  width: number;
  height: number;
  rtl: boolean;
  /** Cumulative cutline fraction, 0..1 (default 0.8); null disables it. */
  cutline?: number | null;
  smooth?: boolean;
  tickCount?: number;
}

export function layoutPareto(items: readonly ParetoInput[], options: ParetoLayoutOptions): ParetoLayout {
  const { width, height, rtl, cutline = 0.8, smooth = false, tickCount = 3 } = options;
  const empty: ParetoLayout = {
    bars: [],
    linePath: null,
    linePoints: [],
    yTicks: [],
    yFor: () => 0,
    cutlineY: null,
    cutline: cutline ?? 0.8,
    total: 0,
  };
  if (items.length === 0 || width <= 0 || height <= 0) return empty;

  const total = items.reduce((sum, item) => sum + Math.max(0, item.value), 0);
  const peak = items.reduce((m, item) => Math.max(m, item.value), 0);
  const yTicks = peak <= 0 ? [0, 1] : niceTicks(0, peak, tickCount);
  const domainHi = yTicks.at(-1) ?? Math.max(peak, 1);
  const yFor = (value: number): number => height - (Math.max(0, value) / (domainHi || 1)) * height;
  /** Right (cumulative) axis maps 0..1 → bottom..top. */
  const cumulativeY = (frac: number): number => height - Math.max(0, Math.min(1, frac)) * height;

  const band = categoricalBandScale(
    items.map((item) => item.label),
    width,
    rtl,
    { paddingInner: 0.28, paddingOuter: 0.16 },
  );
  const bandwidth = band.bandwidth();

  let running = 0;
  const bars: ParetoBar[] = items.map((item, index) => {
    running += Math.max(0, item.value);
    const cumulative = total > 0 ? running / total : 0;
    const x = band(item.label) ?? 0;
    const barTop = yFor(item.value);
    return {
      index,
      label: item.label,
      value: item.value,
      cumulative,
      x,
      y: barTop,
      width: bandwidth,
      height: height - barTop,
      centerX: x + bandwidth / 2,
      lineY: cumulativeY(cumulative),
    };
  });

  const linePoints: XYPoint[] = bars.map((bar) => ({ x: bar.centerX, y: bar.lineY }));
  return {
    bars,
    linePath: linePath(linePoints, smooth),
    linePoints,
    yTicks,
    yFor,
    cutlineY: cutline === null ? null : cumulativeY(cutline),
    cutline: cutline ?? 0.8,
    total,
  };
}
