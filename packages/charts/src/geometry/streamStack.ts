/**
 * Streamgraph stacking geometry (`chart-stream`, research/widget-registry.md
 * §2): centered ("silhouette") stacked bands over time. Pure + DOM-free; the
 * component supplies the pixel x/y scales, this returns value-space band edges
 * and a golden-testable pixel area-path builder.
 */
import { area, curveBasis, curveLinear } from 'd3-shape';

export interface StreamInputSeries {
  key: string;
  label: string;
  values: readonly number[];
}

export interface StreamBand {
  key: string;
  label: string;
  /** Per-index lower edge in value space. */
  low: number[];
  /** Per-index upper edge in value space. */
  high: number[];
}

export interface StreamStack {
  bands: StreamBand[];
  /** Value-space extent across every band edge (for the y scale). */
  min: number;
  max: number;
}

/**
 * Stack series into bands. `silhouette` centers the total thickness on zero at
 * each x (the classic streamgraph); `zero` stacks upward from a flat baseline.
 * Negative inputs are clamped to zero (thicknesses are non-negative).
 */
export function stackStream(
  series: readonly StreamInputSeries[],
  offset: 'silhouette' | 'zero' = 'silhouette',
): StreamStack {
  const n = series.reduce((max, s) => Math.max(max, s.values.length), 0);
  const bands: StreamBand[] = series.map((s) => ({
    key: s.key,
    label: s.label,
    low: Array.from({ length: n }, () => 0),
    high: Array.from({ length: n }, () => 0),
  }));
  let min = 0;
  let max = 0;

  for (let i = 0; i < n; i += 1) {
    const total = series.reduce((sum, s) => sum + Math.max(0, s.values[i] ?? 0), 0);
    let running = offset === 'silhouette' ? -total / 2 : 0;
    for (let s = 0; s < series.length; s += 1) {
      const value = Math.max(0, series[s]?.values[i] ?? 0);
      const band = bands[s];
      if (band === undefined) continue;
      const low = running;
      running += value;
      band.low[i] = low;
      band.high[i] = running;
      if (running > max) max = running;
      if (low < min) min = low;
    }
  }

  return { bands, min, max };
}

/**
 * Closed area path between per-index lower/upper PIXEL edges. `xs`, `low`,
 * `high` are parallel pixel arrays; `smooth` uses a basis spline for the
 * organic stream look.
 */
export function bandAreaPath(
  xs: readonly number[],
  low: readonly number[],
  high: readonly number[],
  smooth = true,
): string | null {
  const generator = area<number>()
    .x((_, i) => xs[i] ?? 0)
    .y0((_, i) => low[i] ?? 0)
    .y1((_, i) => high[i] ?? 0)
    .curve(smooth ? curveBasis : curveLinear);
  return generator(high.map(() => 0));
}
