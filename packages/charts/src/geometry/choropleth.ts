// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pure tilegram / grid-choropleth geometry (research/widget-registry.md §2
 * `chart-choropleth-grid`): region tiles tinted by value, label text flipping
 * to the on-accent color on dark tiles, low→high legend. DOM-free and
 * deterministic (04 §7.1).
 *
 * RTL policy (04 §7.4): the US tilegram is a geographic LTR island (its tiles
 * never mirror, like `map-bubble`); the compact `grid` layout is a categorical
 * flow and mirrors its columns under `rtl`. Legends/tooltips mirror at the
 * widget layer via logical CSS.
 */
import { heatLevel, heatTextLight, rampColorVar } from './heat.js';

/**
 * Canonical 50-state + DC US tile grid (row, col) on an 8×11 board — a plausible
 * geographic arrangement for the tilegram layout. Codes are USPS two-letter.
 */
export const US_TILEGRAM: Readonly<Record<string, readonly [number, number]>> = {
  AK: [0, 0], ME: [0, 10],
  VT: [1, 9], NH: [1, 10],
  WA: [2, 0], ID: [2, 1], MT: [2, 2], ND: [2, 3], MN: [2, 4], IL: [2, 5], WI: [2, 6], MI: [2, 7], NY: [2, 9], MA: [2, 10],
  OR: [3, 0], NV: [3, 1], WY: [3, 2], SD: [3, 3], IA: [3, 4], IN: [3, 5], OH: [3, 6], PA: [3, 7], NJ: [3, 8], CT: [3, 9], RI: [3, 10],
  CA: [4, 0], UT: [4, 1], CO: [4, 2], NE: [4, 3], MO: [4, 4], KY: [4, 5], WV: [4, 6], VA: [4, 7], MD: [4, 8], DE: [4, 9],
  AZ: [5, 1], NM: [5, 2], KS: [5, 3], AR: [5, 4], TN: [5, 5], NC: [5, 6], SC: [5, 7], DC: [5, 8],
  OK: [6, 3], LA: [6, 4], MS: [6, 5], AL: [6, 6], GA: [6, 7],
  HI: [7, 0], TX: [7, 3], FL: [7, 8],
};

const US_TILEGRAM_COLS = 11;
const US_TILEGRAM_ROWS = 8;

export interface RegionPoint {
  code?: string | undefined;
  name?: string | undefined;
  values: Record<string, number>;
}

export interface ChoroplethTile {
  code: string;
  name: string;
  row: number;
  col: number;
  x: number;
  y: number;
  size: number;
  value: number;
  level: number;
  colorVar: string;
  textLight: boolean;
}

export interface ChoroplethLayout {
  tiles: ChoroplethTile[];
  levels: number;
  maxValue: number;
  width: number;
  height: number;
}

export type ChoroplethLayoutKind = 'us-tilegram' | 'grid';

export interface ChoroplethOptions {
  layout?: ChoroplethLayoutKind;
  /** Value key read from each point's `values` map. */
  metric: string;
  cellSize?: number;
  gap?: number;
  /** Columns for the compact `grid` layout (default 6). */
  columns?: number;
  /** Intensity levels incl. 0 (default 5). */
  levels?: number;
  rtl?: boolean;
}

/** Tint region tiles by the selected metric. */
export function choroplethLayout(
  points: readonly RegionPoint[],
  options: ChoroplethOptions,
): ChoroplethLayout {
  const {
    layout = 'us-tilegram',
    metric,
    cellSize = 34,
    gap = 4,
    columns = 6,
    levels = 5,
    rtl = false,
  } = options;
  const step = cellSize + gap;

  const valueOf = (p: RegionPoint): number => {
    const v = p.values[metric];
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
  };
  const maxValue = points.reduce((max, p) => Math.max(max, valueOf(p)), 0);

  let placed: { point: RegionPoint; row: number; col: number }[];
  let cols: number;
  let rows: number;

  if (layout === 'us-tilegram') {
    cols = US_TILEGRAM_COLS;
    rows = US_TILEGRAM_ROWS;
    placed = [];
    for (const point of points) {
      const code = (point.code ?? '').toUpperCase();
      const cell = US_TILEGRAM[code];
      if (cell === undefined) continue; // unknown code — geographic island only plots known tiles
      placed.push({ point, row: cell[0], col: cell[1] });
    }
  } else {
    cols = Math.max(1, columns);
    rows = Math.max(1, Math.ceil(points.length / cols));
    placed = points.map((point, i) => ({ point, row: Math.floor(i / cols), col: i % cols }));
  }

  // Geographic tilegram never mirrors; the categorical grid mirrors columns.
  const mirror = rtl && layout === 'grid';
  const colX = (col: number): number => (mirror ? cols - 1 - col : col) * step;

  const tiles: ChoroplethTile[] = placed.map(({ point, row, col }) => {
    const value = valueOf(point);
    const level = heatLevel(value, maxValue, levels);
    const code = (point.code ?? '').toUpperCase();
    return {
      code,
      name: point.name ?? code,
      row,
      col,
      x: colX(col),
      y: row * step,
      size: cellSize,
      value,
      level,
      colorVar: rampColorVar(level, levels),
      textLight: heatTextLight(level, levels),
    };
  });

  return {
    tiles,
    levels,
    maxValue,
    width: cols > 0 ? cols * step - gap : 0,
    height: rows > 0 ? rows * step - gap : 0,
  };
}

/**
 * Whether any point carries a region code the US tilegram can actually place.
 *
 * The `us-tilegram` layout is a geographic island: it plots only the 50 states +
 * DC it knows and silently drops every other code (the placement loop above). So
 * a payload of non-US codes — or of coordinate-only points that carry no `code`
 * at all — produces ZERO tiles there, leaving just the low→high legend: a legend
 * for a map that is not on the page. Callers use this to fall back to the
 * code-agnostic `grid` layout (which lays every point out in reading order,
 * regardless of code) rather than render an empty board.
 */
export function hasUsTilegramTiles(points: readonly RegionPoint[]): boolean {
  return points.some((point) => US_TILEGRAM[(point.code ?? '').toUpperCase()] !== undefined);
}
