/**
 * Anomaly-detection geometry (`chart-anomaly`, research/widget-registry.md §2):
 * a centered moving-average "expected" line, a symmetric expected-range band
 * from the residual spread, and z-score anomaly flags. Pure + DOM-free and
 * fully deterministic (04 §7.1); `sensitivity` is the z-threshold.
 */

export interface AnomalyModel {
  /** Expected (smoothed) value per index. */
  mid: number[];
  /** Lower / upper expected-range edges (`mid ∓ sensitivity·σ`). */
  lo: number[];
  hi: number[];
  /** Indices whose value lies outside the expected range. */
  anomalies: number[];
}

/** Centered moving average with a clamped window at the series ends. */
function centeredMovingAverage(values: readonly number[], window: number): number[] {
  const n = values.length;
  const half = Math.floor(window / 2);
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j += 1) {
      sum += values[j] ?? 0;
      count += 1;
    }
    out.push(count === 0 ? 0 : sum / count);
  }
  return out;
}

/**
 * `mid` = centered moving average (window `window`, default 7). σ = standard
 * deviation of the residuals `value − mid`. A point is anomalous when its
 * absolute residual exceeds `sensitivity·σ`.
 */
export function anomalyModel(
  values: readonly number[],
  sensitivity = 2,
  window = 7,
): AnomalyModel {
  const n = values.length;
  if (n === 0) return { mid: [], lo: [], hi: [], anomalies: [] };

  const mid = centeredMovingAverage(values, window);
  let sse = 0;
  for (let i = 0; i < n; i += 1) {
    const residual = (values[i] ?? 0) - (mid[i] ?? 0);
    sse += residual * residual;
  }
  const sigma = Math.sqrt(sse / n);
  const spread = sensitivity * sigma;

  const lo: number[] = [];
  const hi: number[] = [];
  const anomalies: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const m = mid[i] ?? 0;
    lo.push(m - spread);
    hi.push(m + spread);
    if (sigma > 0 && Math.abs((values[i] ?? 0) - m) > spread) anomalies.push(i);
  }
  return { mid, lo, hi, anomalies };
}
