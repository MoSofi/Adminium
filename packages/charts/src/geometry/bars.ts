/** Pure bar/column layout — no DOM, reusable by server-side report rendering. */
import { categoricalBandScale } from './scales.js';
import { extent, niceTicks } from '../utils/stats.js';

export interface BarRect {
  x: number;
  y: number;
  width: number;
  height: number;
  categoryIndex: number;
  seriesIndex: number;
  value: number;
}

export interface CategoryCenter {
  label: string;
  x: number;
}

export interface BarLayout {
  bars: BarRect[];
  categoryCenters: CategoryCenter[];
  /** Nice y tick values (ascending). */
  yTicks: number[];
  /** Pixel y for a value (for gridlines/labels). */
  yFor: (value: number) => number;
  /** Pixel y of the zero baseline. */
  baselineY: number;
}

export interface BarLayoutOptions {
  categories: readonly string[];
  /** One series = plain columns; two = grouped mode. */
  series: readonly (readonly number[])[];
  width: number;
  height: number;
  rtl: boolean;
  paddingInner?: number;
  paddingOuter?: number;
  /** Gap between grouped bars within a category, px (default 3). */
  groupGap?: number;
  tickCount?: number;
}

/**
 * Categorical column layout. In RTL the category order mirrors (first
 * category at inline-start) via the band-scale range flip; grouped series
 * order also mirrors inside each band so series[0] stays at inline-start.
 */
export function layoutBars(options: BarLayoutOptions): BarLayout {
  const {
    categories,
    series,
    width,
    height,
    rtl,
    paddingInner = 0.3,
    paddingOuter = 0.15,
    groupGap = 3,
    tickCount = 3,
  } = options;

  const all = series.flatMap((s) => [...s]);
  const [minValue, maxValue] = extent(all) ?? [0, 1];
  const lo = Math.min(0, minValue);
  const hi = Math.max(0, maxValue);
  const yTicks = lo === hi ? [lo, lo + 1] : niceTicks(lo, hi, tickCount);
  const domainLo = yTicks[0] ?? lo;
  const domainHi = yTicks.at(-1) ?? hi;
  const span = domainHi - domainLo || 1;
  const yFor = (value: number) => height - ((value - domainLo) / span) * height;
  const baselineY = yFor(0);

  const band = categoricalBandScale(categories, width, rtl, { paddingInner, paddingOuter });
  const bandwidth = band.bandwidth();
  const seriesCount = Math.max(1, series.length);
  const slotWidth = seriesCount === 1 ? bandwidth : (bandwidth - groupGap * (seriesCount - 1)) / seriesCount;

  const bars: BarRect[] = [];
  categories.forEach((category, categoryIndex) => {
    const bandStart = band(category);
    if (bandStart === undefined) return;
    series.forEach((values, seriesIndex) => {
      const value = values[categoryIndex];
      if (value === undefined) return;
      // Mirror series order inside the group in RTL so series[0] stays at inline-start.
      const slot = rtl ? seriesCount - 1 - seriesIndex : seriesIndex;
      const x = bandStart + slot * (slotWidth + groupGap);
      const yValue = yFor(value);
      bars.push({
        x,
        y: Math.min(yValue, baselineY),
        width: Math.max(0, slotWidth),
        height: Math.abs(yValue - baselineY),
        categoryIndex,
        seriesIndex,
        value,
      });
    });
  });

  const categoryCenters = categories.map((label) => ({
    label,
    x: (band(label) ?? 0) + bandwidth / 2,
  }));

  return { bars, categoryCenters, yTicks, yFor, baselineY };
}

export type HighlightMode = 'max' | 'current' | 'none';

/** Index of the highlighted category: max value, last bucket, or none (-1). */
export function highlightIndex(values: readonly number[], mode: HighlightMode): number {
  if (mode === 'none' || values.length === 0) return -1;
  if (mode === 'current') return values.length - 1;
  let best = 0;
  values.forEach((v, i) => {
    if (v > (values[best] ?? -Infinity)) best = i;
  });
  return best;
}
