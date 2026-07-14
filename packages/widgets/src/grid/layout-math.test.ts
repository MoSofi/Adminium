/**
 * Static grid math units (04 §6.1–§6.2): stacking order and the
 * deterministic top-gravity compaction (no overlaps, no negative coords,
 * idempotent) used to normalize layouts before the read-only render.
 */
import { describe, expect, it } from 'vitest';

import { compactVertical, sortByPosition } from './layout-math.js';
import type { LayoutItem } from '../page-config/index.js';

function item(i: string, x: number, y: number, w: number, h: number): LayoutItem {
  return { i, widget: 'kpi-stat-card', x, y, w, h, config: {} };
}

function overlaps(a: LayoutItem, b: LayoutItem): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

describe('sortByPosition', () => {
  it('orders by (y, x) for breakpoint stacking', () => {
    const sorted = sortByPosition([item('c', 8, 3, 4, 6), item('a', 3, 0, 3, 3), item('b', 0, 0, 3, 3)]);
    expect(sorted.map((entry) => entry.i)).toEqual(['b', 'a', 'c']);
  });
});

describe('compactVertical', () => {
  it('floats items up over gaps without creating overlaps', () => {
    const compacted = compactVertical([
      item('a', 0, 0, 6, 3),
      item('b', 0, 9, 6, 3), // 6 empty half-rows above → floats to y=3
      item('c', 6, 5, 6, 3), // nothing above in its columns → floats to y=0
    ]);
    const byId = Object.fromEntries(compacted.map((entry) => [entry.i, entry]));
    expect(byId.a!.y).toBe(0);
    expect(byId.b!.y).toBe(3);
    expect(byId.c!.y).toBe(0);
    for (const first of compacted) {
      for (const second of compacted) {
        if (first.i !== second.i) expect(overlaps(first, second)).toBe(false);
      }
    }
  });

  it('is idempotent and clamps negative coordinates', () => {
    const once = compactVertical([item('a', 0, -2, 3, 2), item('b', 0, 4, 3, 2)]);
    expect(compactVertical(once)).toEqual(once);
    expect(once.every((entry) => entry.y >= 0)).toBe(true);
  });
});
