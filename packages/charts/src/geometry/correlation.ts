// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pure, DOM-free layout for the correlation charts (research/widget-registry.md
 * §2): `chart-scatter-bubble`, `chart-hexbin`, `chart-correlation-matrix`,
 * `chart-parallel-coordinates`. Server-safe (04 §7.1). Horizontal value /
 * grid / axis order mirrors in RTL; the vertical value axis stays pixel-down.
 */
import { linePath } from './lineArea.js';
import { extent, niceTicks } from '../utils/stats.js';
import { valueAxis } from './distribution.js';

// --- chart-scatter-bubble ----------------------------------------------------

export interface ScatterPointInput {
  x: number;
  y: number;
  /** Optional bubble size dimension. */
  r?: number | undefined;
  /** Optional category for color legend. */
  segment?: string | undefined;
}

export interface ScatterMark {
  index: number;
  cx: number;
  cy: number;
  r: number;
  segment: string | undefined;
}

export interface ScatterTrend {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface ScatterLayout {
  marks: ScatterMark[];
  xTicks: number[];
  yTicks: number[];
  xFor: (value: number) => number;
  yFor: (value: number) => number;
  trend: ScatterTrend | null;
  /** Distinct segments in first-seen order (legend/color assignment). */
  segments: string[];
}

export interface ScatterLayoutOptions {
  width: number;
  height: number;
  rtl: boolean;
  /** [min, max] radius when sizing bubbles by `r` (default [3, 15]). */
  radiusRange?: [number, number];
  /** Fixed radius when no point carries `r` (default 4). */
  fixedRadius?: number;
  trendLine?: boolean;
  tickCount?: number;
}

/** Least-squares fit over data-space points; null when < 2 points or flat x. */
function leastSquares(points: readonly ScatterPointInput[]): { slope: number; intercept: number } | null {
  const n = points.length;
  if (n < 2) return null;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
    sxx += p.x * p.x;
    sxy += p.x * p.y;
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  return { slope, intercept };
}

/**
 * Scatter with an optional bubble-radius dimension, gridlines, distinct-segment
 * legend, and a dashed least-squares trend line. The x value axis mirrors in
 * RTL (range flip); y stays pixel-down. Bubble radius scales from the `r`
 * extent so tests can assert a stable ordering.
 */
export function scatterLayout(
  points: readonly ScatterPointInput[],
  options: ScatterLayoutOptions,
): ScatterLayout {
  const { width, height, rtl, radiusRange = [3, 15], fixedRadius = 4, trendLine = true, tickCount = 4 } = options;

  const xDomain = niceTicks(...(extent(points.map((p) => p.x)) ?? [0, 1]), tickCount);
  const xLo = xDomain[0] ?? 0;
  const xHi = xDomain.at(-1) ?? 1;
  const xSpan = xHi - xLo || 1;
  const xFor = (value: number): number => {
    const t = (value - xLo) / xSpan;
    return rtl ? width - t * width : t * width;
  };
  const yAxis = valueAxis(
    points.map((p) => p.y),
    height,
    tickCount,
  );

  const sized = points.some((p) => typeof p.r === 'number');
  const [rMin, rMax] = radiusRange;
  const rExtent = extent(points.map((p) => p.r ?? 0));
  const rLo = rExtent?.[0] ?? 0;
  const rHi = rExtent?.[1] ?? 1;
  const rSpan = rHi - rLo || 1;
  const radiusFor = (r: number | undefined): number => {
    if (!sized || r === undefined) return fixedRadius;
    return rMin + ((r - rLo) / rSpan) * (rMax - rMin);
  };

  const segments: string[] = [];
  const marks: ScatterMark[] = points.map((p, index) => {
    if (p.segment !== undefined && !segments.includes(p.segment)) segments.push(p.segment);
    return { index, cx: xFor(p.x), cy: yAxis.yFor(p.y), r: radiusFor(p.r), segment: p.segment };
  });

  let trend: ScatterTrend | null = null;
  if (trendLine) {
    const fit = leastSquares(points);
    if (fit !== null) {
      trend = {
        x1: xFor(xLo),
        y1: yAxis.yFor(fit.slope * xLo + fit.intercept),
        x2: xFor(xHi),
        y2: yAxis.yFor(fit.slope * xHi + fit.intercept),
      };
    }
  }

  return { marks, xTicks: xDomain, yTicks: yAxis.yTicks, xFor, yFor: yAxis.yFor, trend, segments };
}

// --- chart-hexbin ------------------------------------------------------------

export interface HexCell {
  row: number;
  col: number;
  cx: number;
  cy: number;
}

export interface HexbinLayout {
  cells: HexCell[];
  radius: number;
  /** Pointy-top hexagon polygon points (SVG `points` attr) at a center. */
  hexPoints: (cx: number, cy: number) => string;
}

export interface HexbinLayoutOptions {
  rows: number;
  cols: number;
  width: number;
  height: number;
  rtl: boolean;
}

const SQRT3 = Math.sqrt(3);

/**
 * Pointy-top hex-grid centers fitted to the box. Odd rows offset by half a
 * column so the tessellation interlocks; columns mirror in RTL. Callers map a
 * per-cell count to fill alpha and omit sparse (null/0) cells (annex §2).
 */
export function hexbinLayout(options: HexbinLayoutOptions): HexbinLayout {
  const { rows, cols, width, height, rtl } = options;
  const safeCols = Math.max(1, cols);
  const safeRows = Math.max(1, rows);
  // Pointy-top: horizontal pitch = √3·r, vertical pitch = 1.5·r, odd-row shift = √3/2·r.
  const rByWidth = width / (SQRT3 * (safeCols + 0.5));
  const rByHeight = height / (1.5 * safeRows + 0.5);
  const radius = Math.max(1, Math.min(rByWidth, rByHeight));
  const hpitch = SQRT3 * radius;
  const vpitch = 1.5 * radius;

  const cells: HexCell[] = [];
  for (let row = 0; row < safeRows; row += 1) {
    for (let col = 0; col < safeCols; col += 1) {
      const offset = row % 2 === 1 ? hpitch / 2 : 0;
      const rawX = radius * (SQRT3 / 2) + offset + col * hpitch;
      const cx = rtl ? width - rawX : rawX;
      const cy = radius + row * vpitch;
      cells.push({ row, col, cx, cy });
    }
  }

  const hexPoints = (cx: number, cy: number): string =>
    Array.from({ length: 6 }, (_, k) => {
      const angle = (Math.PI / 180) * (60 * k - 90);
      return `${(cx + radius * Math.cos(angle)).toFixed(3)},${(cy + radius * Math.sin(angle)).toFixed(3)}`;
    }).join(' ');

  return { cells, radius, hexPoints };
}

// --- chart-correlation-matrix (generic square grid) --------------------------

export interface MatrixCellRect {
  row: number;
  col: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MatrixGridLayout {
  cells: MatrixCellRect[];
  cellW: number;
  cellH: number;
  colX: (col: number) => number;
  rowY: (row: number) => number;
}

export interface MatrixGridOptions {
  rows: number;
  cols: number;
  width: number;
  height: number;
  rtl: boolean;
  gap?: number;
}

/** Uniform cell grid; column order mirrors in RTL, rows stay top→bottom. */
export function matrixGridLayout(options: MatrixGridOptions): MatrixGridLayout {
  const { rows, cols, width, height, rtl, gap = 2 } = options;
  const safeCols = Math.max(1, cols);
  const safeRows = Math.max(1, rows);
  const cellW = (width - gap * (safeCols - 1)) / safeCols;
  const cellH = (height - gap * (safeRows - 1)) / safeRows;
  const colX = (col: number): number => (rtl ? safeCols - 1 - col : col) * (cellW + gap);
  const rowY = (row: number): number => row * (cellH + gap);

  const cells: MatrixCellRect[] = [];
  for (let row = 0; row < safeRows; row += 1) {
    for (let col = 0; col < safeCols; col += 1) {
      cells.push({ row, col, x: colX(col), y: rowY(row), w: Math.max(0, cellW), h: Math.max(0, cellH) });
    }
  }
  return { cells, cellW, cellH, colX, rowY };
}

// --- chart-parallel-coordinates ----------------------------------------------

export interface ParallelAxisInput {
  key: string;
  label: string;
  min: number;
  max: number;
}

export interface ParallelRecordInput {
  /** Values aligned positionally to the axes array. */
  values: readonly number[];
  segment?: string | undefined;
}

export interface ParallelPath {
  index: number;
  path: string;
  segment: string | undefined;
}

export interface ParallelLayout {
  axisX: number[];
  yTop: number;
  yBottom: number;
  paths: ParallelPath[];
  segments: string[];
  yForAxis: (axisIndex: number, value: number) => number;
}

export interface ParallelLayoutOptions {
  width: number;
  height: number;
  /** Inline-direction mirroring; defaults to LTR (false). */
  rtl?: boolean;
  /** Vertical inset for axis top/bottom (default 8). */
  padY?: number;
}

/**
 * Evenly spaced vertical axes with one polyline per record. Axis order mirrors
 * in RTL (first axis at inline-start). Each value is normalised within its
 * axis's [min, max] onto the shared vertical extent (pixel-down).
 */
export function parallelLayout(
  axes: readonly ParallelAxisInput[],
  records: readonly ParallelRecordInput[],
  options: ParallelLayoutOptions,
): ParallelLayout {
  const { width, height, rtl = false, padY = 8 } = options;
  const count = axes.length;
  const yTop = padY;
  const yBottom = height - padY;
  const span = yBottom - yTop || 1;

  const axisX = axes.map((_, i) => {
    const t = count <= 1 ? 0.5 : i / (count - 1);
    return rtl ? width - t * width : t * width;
  });

  const yForAxis = (axisIndex: number, value: number): number => {
    const axis = axes[axisIndex];
    if (axis === undefined) return yBottom;
    const range = axis.max - axis.min || 1;
    const t = (value - axis.min) / range;
    return yBottom - t * span;
  };

  const segments: string[] = [];
  const paths: ParallelPath[] = records.map((record, index) => {
    if (record.segment !== undefined && !segments.includes(record.segment)) segments.push(record.segment);
    const points = axes.map((_, i) => ({ x: axisX[i] ?? 0, y: yForAxis(i, record.values[i] ?? 0) }));
    return { index, path: linePath(points) ?? '', segment: record.segment };
  });

  return { axisX, yTop, yBottom, paths, segments, yForAxis };
}
