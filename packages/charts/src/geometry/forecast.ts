// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Forecast geometry (`chart-forecast`, research/widget-registry.md §2): a pure
 * linear-projection model plus a closed confidence-polygon path builder. Both
 * are DOM-free and deterministic (04 §7.1). z-multipliers cover the common
 * confidence levels; anything else falls back to the 90% multiplier.
 */
import type { XYPoint } from './lineArea.js';

/** Two-sided normal z-multipliers for the confidence levels the UI exposes. */
const Z_BY_CONFIDENCE: Record<string, number> = {
  '0.8': 1.281_552,
  '0.9': 1.644_854,
  '0.95': 1.959_964,
  '0.99': 2.575_829,
};

export function zForConfidence(confidence: number): number {
  return Z_BY_CONFIDENCE[String(confidence)] ?? Z_BY_CONFIDENCE['0.9']!;
}

export interface ForecastModel {
  /** Projected point values, one per horizon step. */
  forecast: number[];
  /** Lower confidence edge per horizon step. */
  lo: number[];
  /** Upper confidence edge per horizon step. */
  hi: number[];
}

/**
 * Ordinary-least-squares trend over the history indices, projected `horizon`
 * steps forward. The band widens with the square root of the step distance
 * (classic prediction-interval growth), scaled by the in-sample residual
 * standard deviation and the confidence z-multiplier.
 */
export function linearForecast(
  history: readonly number[],
  horizon: number,
  confidence = 0.9,
): ForecastModel {
  const n = history.length;
  if (n === 0 || horizon <= 0) return { forecast: [], lo: [], hi: [] };

  const meanX = (n - 1) / 2;
  const meanY = history.reduce((sum, v) => sum + v, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = i - meanX;
    sxx += dx * dx;
    sxy += dx * ((history[i] ?? 0) - meanY);
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = meanY - slope * meanX;

  let sse = 0;
  for (let i = 0; i < n; i += 1) {
    const fitted = intercept + slope * i;
    const residual = (history[i] ?? 0) - fitted;
    sse += residual * residual;
  }
  const residualStd = Math.sqrt(sse / Math.max(1, n - 2));
  const z = zForConfidence(confidence);

  const forecast: number[] = [];
  const lo: number[] = [];
  const hi: number[] = [];
  for (let step = 1; step <= horizon; step += 1) {
    const value = intercept + slope * (n - 1 + step);
    const spread = z * residualStd * Math.sqrt(step);
    forecast.push(value);
    lo.push(value - spread);
    hi.push(value + spread);
  }
  return { forecast, lo, hi };
}

/**
 * Closed polygon path for a confidence band: forward along the upper pixel
 * edge, back along the lower. `upper` and `lower` are parallel same-length
 * pixel-point arrays (lower typically the reverse-domain of upper's x).
 */
export function confidenceBandPath(upper: readonly XYPoint[], lower: readonly XYPoint[]): string | null {
  if (upper.length === 0 || lower.length !== upper.length) return null;
  const parts: string[] = [];
  upper.forEach((p, i) => {
    parts.push(`${i === 0 ? 'M' : 'L'}${fmt(p.x)},${fmt(p.y)}`);
  });
  for (let i = lower.length - 1; i >= 0; i -= 1) {
    const p = lower[i]!;
    parts.push(`L${fmt(p.x)},${fmt(p.y)}`);
  }
  parts.push('Z');
  return parts.join('');
}

/** Trim float noise so Node and browser emit byte-identical path strings. */
function fmt(value: number): string {
  return Number(value.toFixed(3)).toString();
}
