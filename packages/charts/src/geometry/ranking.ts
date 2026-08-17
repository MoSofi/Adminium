// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pure ranking-bar layout (`chart-ranking-bars`, research/widget-registry.md
 * §2): label + proportional horizontal bar (leader solid, rest dimmed) + mono
 * value. DOM-free so scheduled-report workers reuse it. Horizontal value axis
 * mirrors in RTL (annex §7.4: categorical/ranking scales flip; bars anchor at
 * inline-start, which is the right edge under `rtl`).
 */

export interface RankingInput {
  label: string;
  value: number;
}

export interface RankingBar {
  index: number;
  label: string;
  value: number;
  /** Row top y. */
  rowY: number;
  /** Bar top y (centered in the row). */
  y: number;
  /** Bar inline-start x (left in LTR, right-anchored in RTL). */
  x: number;
  /** Bar length in px. */
  width: number;
  barHeight: number;
  /** True for the single largest value (the leader). */
  isLeader: boolean;
}

export interface RankingLayout {
  bars: RankingBar[];
  rowHeight: number;
}

export interface RankingLayoutOptions {
  width: number;
  height: number;
  rtl: boolean;
  /** Fraction of the row occupied by the bar (default 0.5). */
  barRatio?: number;
  /** Cap the number of rows (top-N). */
  max?: number;
}

/**
 * Lay out top-N horizontal bars. Input is assumed pre-sorted descending (the
 * server returns sorted `categorical`); the leader is whichever row holds the
 * maximum value. Bar length is proportional to the maximum value so the leader
 * fills the track.
 */
export function layoutRanking(items: readonly RankingInput[], options: RankingLayoutOptions): RankingLayout {
  const { width, height, rtl, barRatio = 0.5, max } = options;
  const rows = max !== undefined ? items.slice(0, max) : [...items];
  const n = rows.length;
  if (n === 0 || width <= 0 || height <= 0) return { bars: [], rowHeight: 0 };

  const rowHeight = height / n;
  const barHeight = rowHeight * barRatio;
  const peak = rows.reduce((m, r) => Math.max(m, r.value), 0);
  const leaderIndex = rows.reduce((best, r, i) => (r.value > (rows[best]?.value ?? -Infinity) ? i : best), 0);

  const bars: RankingBar[] = rows.map((row, index) => {
    const frac = peak > 0 ? Math.max(0, row.value) / peak : 0;
    const barWidth = frac * width;
    const rowY = index * rowHeight;
    return {
      index,
      label: row.label,
      value: row.value,
      rowY,
      y: rowY + (rowHeight - barHeight) / 2,
      x: rtl ? width - barWidth : 0,
      width: barWidth,
      barHeight,
      isLeader: index === leaderIndex,
    };
  });

  return { bars, rowHeight };
}
