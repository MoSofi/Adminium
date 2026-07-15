/**
 * Pure editing math for the dashboard grid edit mode (04-widget-registry.md
 * §6.2). The static renderer's geometry + top-gravity compaction live in
 * `./layout-math.ts` and are REUSED here (never rebuilt); this module adds the
 * mutation primitives the dnd-kit drag/resize + keyboard paths funnel through:
 *
 *   applyMove   place an item at a target cell, pushing colliding items DOWN
 *   applyResize resize an item (clamped to its registry `minW × minH` and the
 *               grid), pushing colliding items down
 *   commitDraft apply a combined position+size draft (the keyboard commit path)
 *   findFirstFit first free cell for inserting a new widget (builder palette)
 *
 * Move/resize deliberately leave the layout UN-compacted; callers finish with
 * `compactVertical` (04 §6.2: "drop → applyMove(...) then compactVertical(...)").
 * Pushing collisions DOWN before that top-gravity settle is what makes a drop
 * onto an occupied cell reorder deterministically rather than overlap: the
 * anchor keeps the smaller `y`, so `compactVertical` (which floats items up in
 * `(y, x)` order) settles it above the displaced items. All functions are pure
 * and total — an unknown id returns the layout unchanged.
 */

import { GRID_COLUMNS, compactVertical, sortByPosition } from './layout-math.js';
import { DEFAULT_MIN_SIZE, MAX_H, type MinSize } from './layout-schema.js';
import type { LayoutItem, PageLayout } from './layout-schema.js';

/** A position+size draft (the keyboard edit session and resize preview). */
export interface LayoutDraft {
  x: number;
  y: number;
  w: number;
  h: number;
}

function rectsOverlap(a: LayoutItem, b: LayoutItem): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

const clampInt = (value: number, lo: number, hi: number): number =>
  Math.min(Math.max(Math.round(value), lo), hi);

/**
 * Force a single item fully inside the 12-col grid with a non-negative row and
 * a width/height within the schema bounds. `min` clamps width/height to the
 * widget's registry floor (never below `minW × minH`, 04 §6.1); the SE resize
 * handle grows to the inline-end, so width is capped at `GRID_COLUMNS - x` with
 * `x` held fixed.
 */
export function clampItem(item: LayoutItem, min: MinSize = DEFAULT_MIN_SIZE): LayoutItem {
  const minW = Math.max(1, Math.min(min.minW, GRID_COLUMNS));
  const minH = Math.max(1, min.minH);
  // Cap `x` so the min width still fits before the grid edge: an item at column
  // 11 with `minW: 2` shifts one column inline-start rather than shrink below
  // its floor (04 §6.1 — never below `minW × minH`).
  const x = clampInt(item.x, 0, GRID_COLUMNS - minW);
  const w = clampInt(item.w, minW, GRID_COLUMNS - x);
  const h = clampInt(item.h, minH, MAX_H);
  const y = Math.max(0, Math.round(item.y));
  return { ...item, x, y, w, h };
}

/**
 * Resolve overlaps by pushing every non-anchor item straight down below the
 * anchor (and below any already-settled item it then meets). The anchor is
 * pinned; others are processed in `(y, x)` order so the result is deterministic.
 * Terminates: a pushed item's `y` only ever increases, bounded by the stack of
 * settled heights.
 */
function pushDownCollisions(items: readonly LayoutItem[], anchorId: string): LayoutItem[] {
  const anchor = items.find((entry) => entry.i === anchorId);
  if (anchor === undefined) return [...items];
  const settled: LayoutItem[] = [anchor];
  for (const item of sortByPosition(items.filter((entry) => entry.i !== anchorId))) {
    let candidate: LayoutItem = { ...item };
    let moved = true;
    while (moved) {
      moved = false;
      for (const other of settled) {
        if (rectsOverlap(candidate, other)) {
          candidate = { ...candidate, y: other.y + other.h };
          moved = true;
        }
      }
    }
    settled.push(candidate);
  }
  return settled;
}

/** Apply a partial position/size patch to one item, clamp it, and push down
 *  everything it now collides with. Returns the UN-compacted layout. */
function placeAndResolve(
  layout: PageLayout,
  id: string,
  patch: Partial<LayoutDraft>,
  min: MinSize,
): PageLayout {
  const target = layout.items.find((entry) => entry.i === id);
  if (target === undefined) return layout;
  const moved = clampItem({ ...target, ...patch }, min);
  const next = layout.items.map((entry) => (entry.i === id ? moved : entry));
  return { ...layout, items: pushDownCollisions(next, id) };
}

/**
 * Move `id` to target cell `(x, y)` (keeping its size), pushing colliding items
 * down. UN-compacted — pair with `compactVertical` (see file header, 04 §6.2).
 */
export function applyMove(layout: PageLayout, id: string, x: number, y: number): PageLayout {
  return placeAndResolve(layout, id, { x, y }, DEFAULT_MIN_SIZE);
}

/**
 * Resize `id` to `w × h` (keeping its position), never below `min.minW × minH`
 * and never past the grid edge, pushing colliding items down. UN-compacted.
 */
export function applyResize(
  layout: PageLayout,
  id: string,
  w: number,
  h: number,
  min: MinSize = DEFAULT_MIN_SIZE,
): PageLayout {
  return placeAndResolve(layout, id, { w, h }, min);
}

/** Convenience: move then top-gravity settle (the pointer-drop / keyboard-move
 *  commit path). */
export function moveAndCompact(layout: PageLayout, id: string, x: number, y: number): PageLayout {
  return { ...layout, items: compactVertical(applyMove(layout, id, x, y).items) };
}

/** Convenience: resize then top-gravity settle. */
export function resizeAndCompact(
  layout: PageLayout,
  id: string,
  w: number,
  h: number,
  min: MinSize = DEFAULT_MIN_SIZE,
): PageLayout {
  return { ...layout, items: compactVertical(applyResize(layout, id, w, h, min).items) };
}

/**
 * Commit a combined position+size draft (the keyboard edit session's `Enter`),
 * clamped to `min` and the grid, collisions pushed down, then settled. One call
 * so a session that both moved and resized lands atomically.
 */
export function commitDraft(
  layout: PageLayout,
  id: string,
  draft: LayoutDraft,
  min: MinSize = DEFAULT_MIN_SIZE,
): PageLayout {
  const resolved = placeAndResolve(layout, id, draft, min);
  return { ...layout, items: compactVertical(resolved.items) };
}

/**
 * First free cell for a `w × h` widget, scanning rows top-to-bottom then columns
 * inline-start-to-end (04 §6.2, builder palette insertion). Always succeeds —
 * the row below every placed item is guaranteed empty.
 */
export function findFirstFit(layout: PageLayout, w: number, h: number): { x: number; y: number } {
  const width = clampInt(w, 1, GRID_COLUMNS);
  const height = Math.max(1, Math.round(h));
  const bottom = layout.items.reduce((max, item) => Math.max(max, item.y + item.h), 0);
  for (let y = 0; y <= bottom; y += 1) {
    for (let x = 0; x <= GRID_COLUMNS - width; x += 1) {
      const probe: LayoutItem = { i: '', widget: '', x, y, w: width, h: height, config: {} };
      if (!layout.items.some((item) => rectsOverlap(probe, item))) return { x, y };
    }
  }
  return { x: 0, y: bottom };
}

/**
 * Pixel step of one grid cell, measured from the live grid surface. `colStep`
 * is one column plus one gap; `rowStep` is one 40 px half-row plus one gap. Fed
 * to the drag/resize pixel→cell conversions below.
 */
export interface CellStep {
  colStep: number;
  rowStep: number;
}

/** Snap a pixel offset to a whole number of cells (nearest). Guards a zero/NaN
 *  step (unmeasured surface) to 0 so drags never divide by zero. */
export function snapPxToCells(px: number, step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  return Math.round(px / step);
}

/**
 * Convert a dnd-kit pointer `delta` (px moved since drag start) to a signed
 * `(dx, dy)` in grid cells. RTL mirroring is NOT applied here — pointer geometry
 * is already visual; the caller mirrors the *result* only for the keyboard path.
 */
export function pointerDeltaToCells(
  delta: { x: number; y: number },
  cell: CellStep,
): { dx: number; dy: number } {
  return { dx: snapPxToCells(delta.x, cell.colStep), dy: snapPxToCells(delta.y, cell.rowStep) };
}

/**
 * Resolve a pointer-drop `delta` (px since drag start) to the item's target
 * cell, matching the keyboard-move semantics (04 §6.2):
 *
 *  - the horizontal delta is mirrored LOGICALLY under `dir="rtl"` (the pointer
 *    geometry is visual; a rightward visual drag must LOWER the logical column
 *    in RTL — the same mirror the keyboard path and pointer-resize apply);
 *  - `x` is CAPPED at `GRID_COLUMNS - w` so the item keeps its width when
 *    dragged toward the inline-end edge (applyMove's documented "keeping its
 *    size" contract) rather than being silently narrowed by `clampItem`.
 */
export function pointerMoveTarget(
  item: { x: number; y: number; w: number },
  delta: { x: number; y: number },
  cell: CellStep,
  dir: 'ltr' | 'rtl',
): { x: number; y: number } {
  const { dx: rawDx, dy } = pointerDeltaToCells(delta, cell);
  const dx = (dir === 'rtl' ? -1 : 1) * rawDx;
  const x = Math.min(Math.max(item.x + dx, 0), Math.max(0, GRID_COLUMNS - item.w));
  const y = Math.max(0, item.y + dy);
  return { x, y };
}
