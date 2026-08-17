// SPDX-License-Identifier: AGPL-3.0-only
/** Pure micro-chart layout for sparklines (bar and line variants). */
import { extent } from '../utils/stats.js';

export interface SparkBar {
  x: number;
  y: number;
  width: number;
  height: number;
  isLast: boolean;
}

/** Bar layout with fixed gaps; baseline at the bottom edge. */
export function sparkBars(values: readonly number[], width: number, height: number, gap = 2): SparkBar[] {
  const n = values.length;
  if (n === 0 || width <= 0 || height <= 0) return [];
  const [minValue, maxValue] = extent([...values]) ?? [0, 1];
  const lo = Math.min(0, minValue);
  const hi = Math.max(maxValue, lo + 1);
  const span = hi - lo || 1;
  const barWidth = Math.max(1, (width - gap * (n - 1)) / n);
  return values.map((v, i) => {
    const h = Math.max(1, ((v - lo) / span) * height);
    return {
      x: i * (barWidth + gap),
      y: height - h,
      width: barWidth,
      height: h,
      isLast: i === n - 1,
    };
  });
}

export interface SparkLineLayout {
  /** `points` attribute for an SVG polyline. */
  points: string;
  last: { x: number; y: number } | null;
}

/** Polyline layout with a small vertical inset so the stroke never clips. */
export function sparkLine(values: readonly number[], width: number, height: number, inset = 2): SparkLineLayout {
  const n = values.length;
  if (n === 0 || width <= 0 || height <= 0) return { points: '', last: null };
  const [minValue, maxValue] = extent([...values]) ?? [0, 1];
  const span = maxValue - minValue || 1;
  const innerHeight = Math.max(1, height - inset * 2);
  const step = n > 1 ? width / (n - 1) : 0;
  const coords = values.map((v, i) => ({
    x: n > 1 ? i * step : width / 2,
    y: inset + innerHeight - ((v - minValue) / span) * innerHeight,
  }));
  const points = coords.map((c) => `${round2(c.x)},${round2(c.y)}`).join(' ');
  return { points, last: coords.at(-1) ?? null };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
