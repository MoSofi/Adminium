// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Bump-chart geometry (`chart-bump`, research/widget-registry.md §2): rank
 * over ordered periods, rank 1 pinned to the top. Ranks are a discrete
 * categorical/ordinal axis, so the period axis MIRRORS in RTL (04 §7.4 —
 * "rankings mirror"). Pure + DOM-free.
 */
import type { XYPoint } from './lineArea.js';

export interface BumpSeries {
  key: string;
  label: string;
  /** Rank per period (1 = best). `null` = the entity is absent that period. */
  ranks: readonly (number | null)[];
}

export interface BumpLine {
  key: string;
  label: string;
  /** Plotted points (null ranks skipped). */
  points: XYPoint[];
  /** First / last present points — anchors for start/end labels + dots. */
  start: (XYPoint & { rank: number }) | null;
  end: (XYPoint & { rank: number }) | null;
}

export interface BumpLayout {
  lines: BumpLine[];
  /** Period index → pixel x (mirrored in RTL). */
  xForPeriod: (index: number) => number;
  /** Rank → pixel y (rank 1 at top). */
  yForRank: (rank: number) => number;
  periods: number;
  maxRank: number;
}

/**
 * Lay out one polyline per entity. `periods` and `maxRank` fix the axes so
 * every series shares a grid even when some are absent in a period. In RTL the
 * period axis reverses (period 0 at inline-start / the right edge).
 */
export function layoutBump(
  series: readonly BumpSeries[],
  periods: number,
  maxRank: number,
  width: number,
  height: number,
  rtl: boolean,
): BumpLayout {
  const step = periods > 1 ? width / (periods - 1) : 0;
  const xForPeriod = (index: number) => (rtl ? width - index * step : index * step);
  // Rank 1 → top row center; rank maxRank → bottom row center (band per rank).
  const rowHeight = maxRank > 0 ? height / maxRank : height;
  const yForRank = (rank: number) => (rank - 0.5) * rowHeight;

  const lines: BumpLine[] = series.map((entity) => {
    const points: (XYPoint & { rank: number })[] = [];
    entity.ranks.forEach((rank, index) => {
      if (rank === null || index >= periods) return;
      points.push({ x: xForPeriod(index), y: yForRank(rank), rank });
    });
    return {
      key: entity.key,
      label: entity.label,
      points: points.map(({ x, y }) => ({ x, y })),
      start: points[0] ?? null,
      end: points.at(-1) ?? null,
    };
  });

  return { lines, xForPeriod, yForRank, periods, maxRank };
}
