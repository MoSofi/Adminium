// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Static layout math for the dashboard grid (04-widget-registry.md §6.1).
 * M4 renders layouts read-only — the dnd-kit editing pipeline (applyMove,
 * drag compaction, findFirstFit) is 04-T12/M7. What the static renderer
 * needs: geometry constants, stacking order, and the deterministic
 * top-gravity compaction used to normalize stored layouts before render.
 */

import type { LayoutItem } from '../page-config/index.js';

/** 12 fluid columns (04 §6.1). */
export const GRID_COLUMNS = 12;
/** Heights persist in half-row units of 40 px (annex row unit ≈ 80 px). */
export const ROW_UNIT_PX = 40;
/** Grid gap (04 §6.1). 14px is the comp's gutter on every dashboard grid.
 *  Load-bearing beyond looks: it feeds the pointer-drag cell-step measurement in
 *  DashboardGrid, so it must stay in lockstep with the `gap-*` utility there. */
export const GRID_GAP_PX = 14;

/**
 * Reading order for breakpoint stacking: below `lg` the grid reflows to a
 * single column ordered by `(y, x)` (04 §6.1) — the renderer sorts the DOM
 * so source order matches.
 */
export function sortByPosition(items: readonly LayoutItem[]): LayoutItem[] {
  return [...items].sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));
}

function overlaps(a: LayoutItem, b: LayoutItem): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Deterministic top-gravity compaction (04 §6.2): every item floats up
 * until it hits another placed item or row 0. Idempotent; never produces
 * overlaps or negative coordinates. Stored layouts normalize through this
 * before render so gaps left by removed/failed widgets close up.
 */
export function compactVertical(items: readonly LayoutItem[]): LayoutItem[] {
  const placed: LayoutItem[] = [];
  for (const item of sortByPosition(items)) {
    let candidate: LayoutItem = { ...item, y: Math.max(0, item.y) };
    while (candidate.y > 0) {
      const above: LayoutItem = { ...candidate, y: candidate.y - 1 };
      if (placed.some((other) => overlaps(above, other))) break;
      candidate = above;
    }
    placed.push(candidate);
  }
  return placed;
}
