// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pure, DOM-free layout for the distribution charts (research/widget-registry.md
 * §2): `chart-boxplot`, `chart-violin`, `chart-ridgeline`. Server-safe so
 * scheduled-report workers reuse the exact path strings the browser renders
 * (04 §7.1). Categorical group axes mirror in RTL via the shared band scale;
 * the value axis stays pixel-down. d3-scale/d3-shape math only.
 */
import { categoricalBandScale } from './scales.js';
import { linePath } from './lineArea.js';
import { extent, niceTicks } from '../utils/stats.js';

/** Shared value → pixel mapping (pixel-down) over a nice-tick domain. */
export interface ValueAxis {
  yTicks: number[];
  yFor: (value: number) => number;
  domain: [number, number];
}

/** Linear, pixel-down value axis padded to round ticks. */
export function valueAxis(values: readonly number[], height: number, tickCount = 4): ValueAxis {
  const [lo, hi] = extent(values) ?? [0, 1];
  const ticks = lo === hi ? [lo, lo + 1] : niceTicks(lo, hi, tickCount);
  const domainLo = ticks[0] ?? lo;
  const domainHi = ticks.at(-1) ?? hi + 1;
  const span = domainHi - domainLo || 1;
  return {
    yTicks: ticks,
    domain: [domainLo, domainHi],
    yFor: (value: number) => height - ((value - domainLo) / span) * height,
  };
}

// --- chart-boxplot -----------------------------------------------------------

export interface BoxplotGroupInput {
  label: string;
  min: number;
  q1: number;
  med: number;
  q3: number;
  max: number;
}

export interface BoxplotBox {
  label: string;
  centerX: number;
  boxX: number;
  boxWidth: number;
  yMin: number;
  yQ1: number;
  yMed: number;
  yQ3: number;
  yMax: number;
}

export interface BoxplotLayout {
  boxes: BoxplotBox[];
  yTicks: number[];
  yFor: (value: number) => number;
  bandwidth: number;
}

export interface BoxplotLayoutOptions {
  width: number;
  height: number;
  rtl: boolean;
  /** Box width as a fraction of the band (default 0.55). */
  boxFraction?: number;
  tickCount?: number;
}

/** Whisker/box/median geometry per category; value axis from all five stats. */
export function boxplotLayout(
  groups: readonly BoxplotGroupInput[],
  options: BoxplotLayoutOptions,
): BoxplotLayout {
  const { width, height, rtl, boxFraction = 0.55, tickCount = 4 } = options;
  const axis = valueAxis(
    groups.flatMap((g) => [g.min, g.max]),
    height,
    tickCount,
  );
  const band = categoricalBandScale(
    groups.map((g) => g.label),
    width,
    rtl,
    { paddingInner: 0.4, paddingOuter: 0.25 },
  );
  const bandwidth = band.bandwidth();
  const boxWidth = Math.max(1, bandwidth * boxFraction);

  const boxes: BoxplotBox[] = [];
  for (const group of groups) {
    const bandStart = band(group.label);
    if (bandStart === undefined) continue;
    const centerX = bandStart + bandwidth / 2;
    boxes.push({
      label: group.label,
      centerX,
      boxX: centerX - boxWidth / 2,
      boxWidth,
      yMin: axis.yFor(group.min),
      yQ1: axis.yFor(group.q1),
      yMed: axis.yFor(group.med),
      yQ3: axis.yFor(group.q3),
      yMax: axis.yFor(group.max),
    });
  }

  return { boxes, yTicks: axis.yTicks, yFor: axis.yFor, bandwidth };
}

// --- chart-violin ------------------------------------------------------------

export interface ViolinGroupInput {
  label: string;
  min: number;
  max: number;
  med: number;
  density: readonly number[];
}

export interface ViolinShape {
  label: string;
  centerX: number;
  /** Closed outline path (right side top→bottom, left side bottom→top, Z). */
  path: string;
  medY: number;
}

export interface ViolinLayout {
  violins: ViolinShape[];
  yTicks: number[];
  yFor: (value: number) => number;
  bandwidth: number;
}

export interface ViolinLayoutOptions {
  width: number;
  height: number;
  rtl: boolean;
  /** Max half-width as a fraction of the band (default 0.42). */
  halfWidthFraction?: number;
  tickCount?: number;
}

/**
 * Mirrored density profile per group. Each density array is normalised by its
 * own peak so every violin fills the band half-width; the sample index maps
 * linearly across the group's [min, max] onto the shared value axis.
 */
export function violinLayout(
  groups: readonly ViolinGroupInput[],
  options: ViolinLayoutOptions,
): ViolinLayout {
  const { width, height, rtl, halfWidthFraction = 0.42, tickCount = 4 } = options;
  const axis = valueAxis(
    groups.flatMap((g) => [g.min, g.max]),
    height,
    tickCount,
  );
  const band = categoricalBandScale(
    groups.map((g) => g.label),
    width,
    rtl,
    { paddingInner: 0.35, paddingOuter: 0.2 },
  );
  const bandwidth = band.bandwidth();
  const halfWidth = Math.max(1, (bandwidth / 2) * halfWidthFraction);

  const violins: ViolinShape[] = [];
  for (const group of groups) {
    const bandStart = band(group.label);
    if (bandStart === undefined) continue;
    const centerX = bandStart + bandwidth / 2;
    const n = group.density.length;
    const peak = Math.max(...group.density, 1e-9);
    const valueAt = (i: number): number =>
      n <= 1 ? group.min : group.min + (i / (n - 1)) * (group.max - group.min);

    // Right side top→bottom, then left side bottom→top → closed polygon.
    const right = group.density.map((d, i) => ({
      x: centerX + (d / peak) * halfWidth,
      y: axis.yFor(valueAt(i)),
    }));
    const left = [...group.density]
      .map((d, i) => ({ x: centerX - (d / peak) * halfWidth, y: axis.yFor(valueAt(i)) }))
      .reverse();
    const outline = [...right, ...left];
    const path = outline.length > 0 ? `${linePath(outline) ?? ''}Z` : '';

    violins.push({ label: group.label, centerX, path, medY: axis.yFor(group.med) });
  }

  return { violins, yTicks: axis.yTicks, yFor: axis.yFor, bandwidth };
}

// --- chart-ridgeline ---------------------------------------------------------

export interface RidgeGroupInput {
  label: string;
  density: readonly number[];
}

export interface RidgeRow {
  label: string;
  areaPath: string;
  linePath: string;
  baselineY: number;
  labelY: number;
  /** Decreasing entrance/fill alpha from front (1) to back rows. */
  alpha: number;
}

export interface RidgelineLayout {
  rows: RidgeRow[];
  /** Inline-start x where the density profile begins (gutter for labels). */
  plotStart: number;
  plotEnd: number;
}

export interface RidgelineLayoutOptions {
  width: number;
  height: number;
  rtl: boolean;
  /** Peak height as a multiple of the row step (overlap into rows above). */
  overlap?: number;
  /** Inline-start gutter reserved for group labels (default 52). */
  labelGutter?: number;
  /** Minimum ridge alpha for the back row (default 0.35). */
  minAlpha?: number;
}

/**
 * Overlapping filled density ridges, front row first. Densities share one
 * global peak so ridges are comparable; the value axis runs across the plot
 * width and mirrors in RTL. Rows stack top→bottom with the front (first) row
 * at the bottom, so later ridges overlap upward with decreasing alpha.
 */
export function ridgelineLayout(
  groups: readonly RidgeGroupInput[],
  options: RidgelineLayoutOptions,
): RidgelineLayout {
  const { width, height, rtl, overlap = 1.5, labelGutter = 52, minAlpha = 0.35 } = options;
  const count = groups.length;
  const plotStart = rtl ? 0 : labelGutter;
  const plotEnd = rtl ? width - labelGutter : width;
  const plotWidth = Math.max(1, plotEnd - plotStart);

  const globalPeak = Math.max(...groups.flatMap((g) => [...g.density]), 1e-9);
  const rowStep = count > 0 ? height / count : height;
  const peakHeight = rowStep * overlap;

  const xAt = (i: number, n: number): number => {
    const t = n <= 1 ? 0 : i / (n - 1);
    return rtl ? plotEnd - t * plotWidth : plotStart + t * plotWidth;
  };

  const rows: RidgeRow[] = groups.map((group, g) => {
    // Front row (g=0) sits lowest; rows stack upward.
    const baselineY = height - g * rowStep;
    const n = group.density.length;
    const top = group.density.map((d, i) => ({
      x: xAt(i, n),
      y: baselineY - (d / globalPeak) * peakHeight,
    }));
    const line = linePath(top) ?? '';
    // Area: top outline then back along the baseline, closed.
    const first = top[0];
    const last = top.at(-1);
    const area =
      line === '' || first === undefined || last === undefined
        ? ''
        : `${line}L${last.x},${baselineY}L${first.x},${baselineY}Z`;
    const alpha = count <= 1 ? 1 : 1 - (g / (count - 1)) * (1 - minAlpha);
    return {
      label: group.label,
      areaPath: area,
      linePath: line,
      baselineY,
      labelY: baselineY - 4,
      alpha,
    };
  });

  return { rows, plotStart, plotEnd };
}
