// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Property + unit tests for the edit-mode layout math (04-widget-registry.md
 * §6.2): applyMove/applyResize compose with the reused `compactVertical` to a
 * layout that never overlaps, never goes negative, is idempotent, respects the
 * registry `minW × minH` floor, and inserts new widgets at the first free cell.
 */
import { describe, expect, it } from 'vitest';

import {
  applyMove,
  applyResize,
  clampItem,
  commitDraft,
  findFirstFit,
  moveAndCompact,
  pointerDeltaToCells,
  pointerMoveTarget,
  resizeAndCompact,
  snapPxToCells,
} from './layout-edit.js';
import { GRID_COLUMNS, compactVertical } from './layout-math.js';
import type { LayoutItem, PageLayout } from './layout-schema.js';

function item(i: string, x: number, y: number, w: number, h: number): LayoutItem {
  return { i, widget: 'kpi-stat-card', x, y, w, h, config: {} };
}

function layout(items: LayoutItem[]): PageLayout {
  return { version: 1, items };
}

function overlaps(a: LayoutItem, b: LayoutItem): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function assertNoOverlap(items: readonly LayoutItem[]): void {
  for (const a of items) {
    for (const b of items) {
      if (a.i !== b.i) expect(overlaps(a, b)).toBe(false);
    }
  }
}

function positionsById(items: readonly LayoutItem[]): Record<string, { x: number; y: number; w: number; h: number }> {
  return Object.fromEntries(items.map((it) => [it.i, { x: it.x, y: it.y, w: it.w, h: it.h }]));
}

function assertInBounds(items: readonly LayoutItem[]): void {
  for (const it of items) {
    expect(it.x).toBeGreaterThanOrEqual(0);
    expect(it.y).toBeGreaterThanOrEqual(0);
    expect(it.w).toBeGreaterThanOrEqual(1);
    expect(it.x + it.w).toBeLessThanOrEqual(GRID_COLUMNS);
  }
}

/** Deterministic PRNG (04 §7.7 convention) — no Math.random in tests. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random but well-formed (compacted, non-overlapping) layout. */
function randomLayout(rng: () => number, count: number): PageLayout {
  const raw: LayoutItem[] = [];
  for (let k = 0; k < count; k += 1) {
    const w = 1 + Math.floor(rng() * GRID_COLUMNS);
    const x = Math.floor(rng() * (GRID_COLUMNS - w + 1));
    const y = Math.floor(rng() * 20);
    const h = 1 + Math.floor(rng() * 6);
    raw.push(item(`w${k}`, x, y, w, h));
  }
  return layout(compactVertical(raw));
}

describe('clampItem', () => {
  it('keeps an item inside the 12-col grid with a non-negative row', () => {
    const clamped = clampItem(item('a', 20, -3, 20, 99));
    expect(clamped.x).toBeLessThanOrEqual(GRID_COLUMNS - 1);
    expect(clamped.y).toBe(0);
    expect(clamped.x + clamped.w).toBeLessThanOrEqual(GRID_COLUMNS);
    expect(clamped.h).toBeLessThanOrEqual(24);
  });

  it('never shrinks below the registry min size', () => {
    const clamped = clampItem(item('a', 0, 0, 1, 1), { minW: 4, minH: 3 });
    expect(clamped.w).toBe(4);
    expect(clamped.h).toBe(3);
  });
});

describe('applyMove + compactVertical (property)', () => {
  it('never overlaps, never goes negative, and is idempotent under recompaction', () => {
    const rng = mulberry32(12345);
    for (let trial = 0; trial < 200; trial += 1) {
      const start = randomLayout(rng, 1 + Math.floor(rng() * 8));
      const target = start.items[Math.floor(rng() * start.items.length)]!;
      const x = Math.floor(rng() * GRID_COLUMNS);
      const y = Math.floor(rng() * 24);
      const next = moveAndCompact(start, target.i, x, y);

      assertNoOverlap(next.items);
      assertInBounds(next.items);
      expect(next.items).toHaveLength(start.items.length);
      // Recompaction is a fixed point (position-idempotent: the array order may
      // differ, but every item keeps its settled coordinates).
      const before = positionsById(next.items);
      const after = positionsById(compactVertical(next.items));
      expect(after).toEqual(before);
    }
  });

  it('unknown id leaves the layout untouched', () => {
    const start = layout([item('a', 0, 0, 3, 2)]);
    expect(applyMove(start, 'nope', 5, 5)).toEqual(start);
  });

  it('reorders deterministically when dropped onto an occupied cell', () => {
    // A on top (rows 0-1), B below (rows 2-3), same columns. Drop B on top of A.
    const start = layout([item('a', 0, 0, 4, 2), item('b', 0, 2, 4, 2)]);
    const next = moveAndCompact(start, 'b', 0, 0);
    const byId = Object.fromEntries(next.items.map((it) => [it.i, it]));
    // B took the top; A settled directly beneath it — a clean swap, no overlap.
    expect(byId.b!.y).toBe(0);
    expect(byId.a!.y).toBe(2);
    assertNoOverlap(next.items);
  });
});

describe('applyResize respects the min floor and the grid edge', () => {
  it('never resizes below minW × minH', () => {
    const start = layout([item('a', 0, 0, 6, 4)]);
    const next = applyResize(start, 'a', 1, 1, { minW: 3, minH: 2 });
    const a = next.items.find((it) => it.i === 'a')!;
    expect(a.w).toBe(3);
    expect(a.h).toBe(2);
  });

  it('caps width at the grid edge (SE handle grows inline-end, x fixed)', () => {
    const start = layout([item('a', 8, 0, 2, 2)]);
    const next = applyResize(start, 'a', 12, 3, { minW: 1, minH: 1 });
    const a = next.items.find((it) => it.i === 'a')!;
    expect(a.x).toBe(8);
    expect(a.x + a.w).toBeLessThanOrEqual(GRID_COLUMNS);
  });

  it('pushes a neighbour below when the resize grows over it, then compacts cleanly', () => {
    const start = layout([item('a', 0, 0, 4, 2), item('b', 0, 2, 4, 2)]);
    const next = resizeAndCompact(start, 'a', 4, 5, { minW: 1, minH: 1 });
    assertNoOverlap(next.items);
    const byId = Object.fromEntries(next.items.map((it) => [it.i, it]));
    expect(byId.a!.h).toBe(5);
    expect(byId.b!.y).toBeGreaterThanOrEqual(5);
  });

  it('resize property invariants over random layouts', () => {
    const rng = mulberry32(999);
    for (let trial = 0; trial < 150; trial += 1) {
      const start = randomLayout(rng, 1 + Math.floor(rng() * 6));
      const target = start.items[Math.floor(rng() * start.items.length)]!;
      const min = { minW: 1 + Math.floor(rng() * 3), minH: 1 + Math.floor(rng() * 3) };
      const next = resizeAndCompact(start, target.i, 1 + Math.floor(rng() * 12), 1 + Math.floor(rng() * 10), min);
      assertNoOverlap(next.items);
      assertInBounds(next.items);
      const resized = next.items.find((it) => it.i === target.i)!;
      expect(resized.w).toBeGreaterThanOrEqual(min.minW);
      expect(resized.h).toBeGreaterThanOrEqual(min.minH);
    }
  });
});

describe('commitDraft applies position + size atomically', () => {
  it('lands a combined move+resize with no overlap', () => {
    const start = layout([item('a', 0, 0, 3, 2), item('b', 6, 0, 3, 2)]);
    const next = commitDraft(start, 'a', { x: 6, y: 0, w: 4, h: 3 }, { minW: 1, minH: 1 });
    assertNoOverlap(next.items);
    assertInBounds(next.items);
    const a = next.items.find((it) => it.i === 'a')!;
    expect(a.w).toBe(4);
    expect(a.h).toBe(3);
  });
});

describe('findFirstFit', () => {
  it('returns the first free cell in row-major (top-to-bottom, inline-start) order', () => {
    // Row 0 fully occupied by a 12-wide item; the fit must drop to row 2.
    const start = layout([item('a', 0, 0, 12, 2)]);
    expect(findFirstFit(start, 3, 2)).toEqual({ x: 0, y: 2 });
  });

  it('fills a gap left in a partially-occupied first row', () => {
    const start = layout([item('a', 0, 0, 6, 3)]);
    // Columns 6..11 are free at row 0 for a 6-wide item.
    expect(findFirstFit(start, 6, 3)).toEqual({ x: 6, y: 0 });
  });

  it('returns a non-overlapping position for random layouts and widths', () => {
    const rng = mulberry32(7);
    for (let trial = 0; trial < 100; trial += 1) {
      const start = randomLayout(rng, Math.floor(rng() * 8));
      const w = 1 + Math.floor(rng() * GRID_COLUMNS);
      const h = 1 + Math.floor(rng() * 5);
      const fit = findFirstFit(start, w, h);
      expect(fit.x).toBeGreaterThanOrEqual(0);
      expect(fit.x + w).toBeLessThanOrEqual(GRID_COLUMNS);
      const probe = item('probe', fit.x, fit.y, w, h);
      for (const placed of start.items) expect(overlaps(probe, placed)).toBe(false);
    }
  });

  it('empty layout fits at the origin', () => {
    expect(findFirstFit(layout([]), 4, 2)).toEqual({ x: 0, y: 0 });
  });
});

describe('pixel → cell conversion', () => {
  it('snaps to the nearest whole cell and guards a zero/NaN step', () => {
    expect(snapPxToCells(0, 56)).toBe(0);
    expect(snapPxToCells(84, 56)).toBe(2); // 84/56 = 1.5 → rounds to 2
    expect(snapPxToCells(27, 56)).toBe(0); // < half a cell
    expect(snapPxToCells(100, 0)).toBe(0); // unmeasured surface
  });

  it('converts a pointer delta to signed cell deltas', () => {
    const cell = { colStep: 100, rowStep: 56 };
    expect(pointerDeltaToCells({ x: 210, y: -120 }, cell)).toEqual({ dx: 2, dy: -2 });
  });
});

describe('pointerMoveTarget (pointer-drop → target cell)', () => {
  const cell = { colStep: 100, rowStep: 56 };

  it('keeps the widget width by capping x at GRID_COLUMNS - w near the inline-end', () => {
    // 4-wide widget at x=6 (x+w=10). Drag +3 columns toward the end edge.
    const target = pointerMoveTarget({ x: 6, y: 0, w: 4 }, { x: 300, y: 0 }, cell, 'ltr');
    // x is capped at 12 - 4 = 8 rather than 9 (which would shrink the widget).
    expect(target).toEqual({ x: 8, y: 0 });
    const moved = applyMove(layout([item('a', 6, 0, 4, 3)]), 'a', target.x, target.y);
    expect(moved.items.find((it) => it.i === 'a')!.w).toBe(4);
  });

  it('mirrors the horizontal delta under RTL (a visual-right drag lowers x)', () => {
    // dir=rtl: a positive physical delta must DECREASE the logical column.
    const target = pointerMoveTarget({ x: 5, y: 0, w: 3 }, { x: 300, y: 0 }, cell, 'rtl');
    expect(target).toEqual({ x: 2, y: 0 });
  });

  it('is the exact mirror of the LTR case for the same physical delta', () => {
    const ltr = pointerMoveTarget({ x: 5, y: 0, w: 3 }, { x: 200, y: 0 }, cell, 'ltr');
    const rtl = pointerMoveTarget({ x: 5, y: 0, w: 3 }, { x: 200, y: 0 }, cell, 'rtl');
    expect(ltr.x).toBe(7);
    expect(rtl.x).toBe(3);
  });

  it('floors x at 0 and y at 0', () => {
    expect(pointerMoveTarget({ x: 1, y: 1, w: 3 }, { x: -300, y: -300 }, cell, 'ltr')).toEqual({ x: 0, y: 0 });
  });
});
