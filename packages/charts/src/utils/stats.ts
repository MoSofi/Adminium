/**
 * In-package stats helpers (~60 LOC) so @adminium/charts never pulls d3-array
 * (workplan/04-widget-registry.md §7 — only d3-scale and d3-shape are allowed
 * as math dependencies).
 */

/** Min/max of a numeric iterable, ignoring NaN. Returns null when empty. */
export function extent(values: Iterable<number>): [number, number] | null {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (Number.isNaN(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return min <= max ? [min, max] : null;
}

/** d3-style tick step: powers of 10 refined by 1/2/5. Always > 0. */
export function tickStep(start: number, stop: number, count: number): number {
  const span = Math.abs(stop - start);
  if (span === 0 || count <= 0) return 1;
  const rawStep = span / count;
  const power = Math.floor(Math.log10(rawStep));
  const error = rawStep / 10 ** power;
  const factor = error >= Math.sqrt(50) ? 10 : error >= Math.sqrt(10) ? 5 : error >= Math.SQRT2 ? 2 : 1;
  return factor * 10 ** power;
}

/** Round, human-friendly tick values covering [min, max] (endpoints included). */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) return [min];
  const step = tickStep(min, max, count);
  const start = Math.floor(min / step) * step;
  const stop = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  // Guard float drift with a half-step epsilon.
  for (let v = start; v <= stop + step / 2; v += step) {
    ticks.push(Math.abs(v) < step * 1e-10 ? 0 : Number(v.toPrecision(12)));
  }
  return ticks;
}

/** Linear-interpolated quantile over an ASCENDING-sorted array; p in [0, 1]. */
export function quantileSorted(sorted: readonly number[], p: number): number | null {
  const n = sorted.length;
  if (n === 0) return null;
  if (p <= 0 || n === 1) return sorted[0] ?? null;
  if (p >= 1) return sorted[n - 1] ?? null;
  const i = (n - 1) * p;
  const lo = Math.floor(i);
  const a = sorted[lo] ?? 0;
  const b = sorted[lo + 1] ?? a;
  return a + (b - a) * (i - lo);
}

export interface Bin {
  /** Inclusive lower edge. */
  x0: number;
  /** Exclusive upper edge (inclusive for the last bin). */
  x1: number;
  count: number;
}

/** Equal-width histogram bins over the data extent. */
export function bins(values: readonly number[], binCount = 10): Bin[] {
  const domain = extent(values);
  if (domain === null || binCount <= 0) return [];
  const [min, max] = domain;
  const width = (max - min) / binCount || 1;
  const out: Bin[] = Array.from({ length: binCount }, (_, i) => ({
    x0: min + i * width,
    x1: min + (i + 1) * width,
    count: 0,
  }));
  for (const v of values) {
    if (Number.isNaN(v)) continue;
    const i = Math.min(binCount - 1, Math.max(0, Math.floor((v - min) / width)));
    const bin = out[i];
    if (bin) bin.count += 1;
  }
  return out;
}
