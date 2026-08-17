// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { highlightIndex, layoutBars } from './bars.js';
import { bucketSlices, donutArcs } from './donut.js';
import { areaPath, linePath, nearestIndexByX } from './lineArea.js';
import { categoricalBandScale, categoricalPointScale, linearYScale, timeScale } from './scales.js';
import { sparkBars, sparkLine } from './sparkline.js';

describe('scales — RTL policy', () => {
  it('categorical band scale mirrors in RTL (first category moves to the right)', () => {
    const domain = ['A', 'B', 'C'];
    const ltr = categoricalBandScale(domain, 300, false);
    const rtl = categoricalBandScale(domain, 300, true);
    expect((ltr('A') ?? 0) < (ltr('C') ?? 0)).toBe(true);
    expect((rtl('A') ?? 0) > (rtl('C') ?? 0)).toBe(true);
    expect(rtl.bandwidth()).toBeCloseTo(ltr.bandwidth(), 6);
  });

  it('categorical point scale mirrors in RTL', () => {
    const domain = ['A', 'B', 'C'];
    const rtl = categoricalPointScale(domain, 300, true);
    expect((rtl('A') ?? 0) > (rtl('C') ?? 0)).toBe(true);
  });

  it('time scale NEVER mirrors — oldest stays left', () => {
    const domain: [Date, Date] = [new Date('2026-01-01'), new Date('2026-02-01')];
    const scale = timeScale(domain, 300);
    expect(scale(domain[0])).toBe(0);
    expect(scale(domain[1])).toBe(300);
  });

  it('linear y scale is pixel-down', () => {
    const y = linearYScale([0, 100], 200);
    expect(y(0)).toBe(200);
    expect(y(100)).toBe(0);
  });
});

describe('lineArea geometry', () => {
  const points = [
    { x: 0, y: 10 },
    { x: 50, y: 40 },
    { x: 100, y: 20 },
  ];

  it('builds line and area paths', () => {
    const line = linePath(points);
    const area = areaPath(points, 100);
    expect(line).toMatch(/^M/);
    expect(area).toMatch(/^M/);
    expect(area).toMatch(/Z$/i);
    expect(linePath([])).toBeNull();
  });

  it('smooth flag changes the path (curveMonotoneX)', () => {
    expect(linePath(points, true)).not.toBe(linePath(points, false));
  });

  it('nearestIndexByX works for ascending and descending sequences', () => {
    expect(nearestIndexByX([0, 50, 100], 60)).toBe(1);
    expect(nearestIndexByX([100, 50, 0], 60)).toBe(1);
    expect(nearestIndexByX([100, 50, 0], 95)).toBe(0);
    expect(nearestIndexByX([], 10)).toBe(-1);
  });
});

describe('bars geometry', () => {
  const categories = ['Jan', 'Feb', 'Mar', 'Apr'];
  const values = [10, 40, 25, 30];

  it('lays out one bar per category, heights proportional to values', () => {
    const layout = layoutBars({ categories, series: [values], width: 400, height: 200, rtl: false });
    expect(layout.bars).toHaveLength(4);
    const heights = layout.bars.map((b) => b.height);
    expect(heights[1]).toBeGreaterThan(heights[0] ?? Infinity);
    for (const bar of layout.bars) {
      expect(bar.y + bar.height).toBeCloseTo(layout.baselineY, 6);
    }
  });

  it('mirrors category order in RTL', () => {
    const ltr = layoutBars({ categories, series: [values], width: 400, height: 200, rtl: false });
    const rtl = layoutBars({ categories, series: [values], width: 400, height: 200, rtl: true });
    const first = (bars: typeof ltr.bars) => bars.find((b) => b.categoryIndex === 0)?.x ?? 0;
    const last = (bars: typeof ltr.bars) => bars.find((b) => b.categoryIndex === 3)?.x ?? 0;
    expect(first(ltr.bars)).toBeLessThan(last(ltr.bars));
    expect(first(rtl.bars)).toBeGreaterThan(last(rtl.bars));
  });

  it('grouped mode lays out series side by side and mirrors series order in RTL', () => {
    const series = [values, values.map((v) => v * 0.7)];
    const ltr = layoutBars({ categories, series, width: 400, height: 200, rtl: false });
    const rtl = layoutBars({ categories, series, width: 400, height: 200, rtl: true });
    expect(ltr.bars).toHaveLength(8);
    const at = (bars: typeof ltr.bars, s: number) => bars.find((b) => b.categoryIndex === 0 && b.seriesIndex === s)?.x ?? 0;
    expect(at(ltr.bars, 0)).toBeLessThan(at(ltr.bars, 1));
    expect(at(rtl.bars, 0)).toBeGreaterThan(at(rtl.bars, 1));
  });

  it('handles negative values against a zero baseline', () => {
    const layout = layoutBars({ categories: ['a', 'b'], series: [[-10, 20]], width: 100, height: 100, rtl: false });
    const negative = layout.bars[0];
    expect(negative?.y).toBeCloseTo(layout.baselineY, 6);
    expect(negative?.height).toBeGreaterThan(0);
  });

  it('highlightIndex modes', () => {
    expect(highlightIndex(values, 'max')).toBe(1);
    expect(highlightIndex(values, 'current')).toBe(3);
    expect(highlightIndex(values, 'none')).toBe(-1);
    expect(highlightIndex([], 'max')).toBe(-1);
  });
});

describe('donut geometry', () => {
  const slices = [
    { label: 'Free', value: 50 },
    { label: 'Pro', value: 30 },
    { label: 'Business', value: 15 },
    { label: 'Enterprise', value: 5 },
  ];

  it('produces one arc path per slice, shares summing to 1', () => {
    const arcs = donutArcs(slices, { outerRadius: 80, thickness: 20 });
    expect(arcs).toHaveLength(4);
    for (const a of arcs) expect(a.path).toMatch(/^M/);
    expect(arcs.reduce((sum, a) => sum + a.share, 0)).toBeCloseTo(1, 6);
    expect(arcs[0]?.colorVar).toBe('var(--viz-1)');
    expect(arcs[1]?.colorVar).toBe('var(--viz-2)');
  });

  it('buckets overflow slices into "other" with a neutral color', () => {
    const { slices: bucketed, otherIndex } = bucketSlices(slices, 2);
    expect(bucketed).toHaveLength(3);
    expect(otherIndex).toBe(2);
    expect(bucketed[2]).toEqual({ label: 'Other', value: 20 });

    const arcs = donutArcs(slices, { outerRadius: 80, thickness: 20, maxSlices: 2, otherLabel: 'Rest' });
    expect(arcs).toHaveLength(3);
    expect(arcs[2]?.label).toBe('Rest');
    expect(arcs[2]?.isOther).toBe(true);
    expect(arcs[2]?.colorVar).toBe('var(--fg-subtle)');
  });

  it('keeps input order (no value sort) and returns [] for zero totals', () => {
    const arcs = donutArcs([{ label: 'b', value: 1 }, { label: 'a', value: 9 }], { outerRadius: 80, thickness: 20 });
    expect(arcs.map((a) => a.label)).toEqual(['b', 'a']);
    expect(donutArcs([{ label: 'x', value: 0 }], { outerRadius: 80, thickness: 20 })).toEqual([]);
  });
});

describe('sparkline geometry', () => {
  it('bar layout: one rect per value, last flagged, fits the box', () => {
    const bars = sparkBars([2, 4, 8], 60, 20);
    expect(bars).toHaveLength(3);
    expect(bars.at(-1)?.isLast).toBe(true);
    for (const bar of bars) {
      expect(bar.x).toBeGreaterThanOrEqual(0);
      expect(bar.x + bar.width).toBeLessThanOrEqual(60 + 1e-6);
      expect(bar.y).toBeGreaterThanOrEqual(0);
      expect(bar.y + bar.height).toBeCloseTo(20, 6);
    }
  });

  it('line layout: polyline points + last coordinate', () => {
    const layout = sparkLine([1, 5, 3], 60, 20);
    expect(layout.points.split(' ')).toHaveLength(3);
    expect(layout.last?.x).toBe(60);
    expect(sparkLine([], 60, 20)).toEqual({ points: '', last: null });
  });
});
