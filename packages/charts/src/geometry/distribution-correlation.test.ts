/**
 * Pure-geometry tests for the distribution & correlation charts (04-T09):
 * deterministic path strings (Node-vs-golden, no DOM), RTL mirroring of the
 * horizontal axis/grid/order, and structural invariants. The golden strings
 * are byte-identical across Node and browser because the geometry is DOM-free
 * (04 §7.1 raster-export contract).
 */
import { describe, expect, it } from 'vitest';

import {
  boxplotLayout,
  ridgelineLayout,
  valueAxis,
  violinLayout,
} from './distribution.js';
import {
  hexbinLayout,
  matrixGridLayout,
  parallelLayout,
  scatterLayout,
} from './correlation.js';

describe('valueAxis', () => {
  it('is pixel-down over a nice-tick domain', () => {
    const axis = valueAxis([0, 100], 200, 4);
    expect(axis.yTicks).toEqual([0, 20, 40, 60, 80, 100]);
    expect(axis.yFor(0)).toBe(200);
    expect(axis.yFor(100)).toBe(0);
    expect(axis.yFor(50)).toBe(100);
  });
});

describe('boxplotLayout', () => {
  const groups = [{ label: 'A', min: 0, q1: 25, med: 50, q3: 75, max: 100 }];

  it('maps the five stats to a centered box (golden)', () => {
    const box = boxplotLayout(groups, { width: 100, height: 100, rtl: false }).boxes[0];
    expect(box).toEqual({
      label: 'A',
      centerX: 50,
      boxX: 35,
      boxWidth: 30,
      yMin: 100,
      yQ1: 75,
      yMed: 50,
      yQ3: 25,
      yMax: 0,
    });
  });

  it('is deterministic and mirrors category order in RTL', () => {
    const multi = [
      { label: 'A', min: 0, q1: 1, med: 2, q3: 3, max: 4 },
      { label: 'B', min: 0, q1: 1, med: 2, q3: 3, max: 4 },
    ];
    const ltr = boxplotLayout(multi, { width: 200, height: 100, rtl: false });
    const ltr2 = boxplotLayout(multi, { width: 200, height: 100, rtl: false });
    const rtl = boxplotLayout(multi, { width: 200, height: 100, rtl: true });
    // Compare the serialisable geometry (layout carries `yFor` closures).
    expect(ltr.boxes).toEqual(ltr2.boxes);
    const centerOf = (l: typeof ltr, label: string) => l.boxes.find((b) => b.label === label)?.centerX ?? 0;
    expect(centerOf(ltr, 'A')).toBeLessThan(centerOf(ltr, 'B'));
    expect(centerOf(rtl, 'A')).toBeGreaterThan(centerOf(rtl, 'B'));
  });
});

describe('violinLayout', () => {
  const groups = [{ label: 'A', min: 0, max: 100, med: 50, density: [1, 3, 2] }];

  it('builds a closed mirrored outline (golden)', () => {
    const layout = violinLayout(groups, { width: 100, height: 100, rtl: false });
    const violin = layout.violins[0];
    expect(violin?.path).toBe('M54.333,100L63,50L58.667,0L41.333,0L37,50L45.667,100Z');
    expect(violin?.centerX).toBe(50);
    expect(violin?.medY).toBe(50);
  });

  it('is deterministic across runs', () => {
    const a = violinLayout(groups, { width: 100, height: 100, rtl: false });
    const b = violinLayout(groups, { width: 100, height: 100, rtl: false });
    expect(a.violins).toEqual(b.violins);
  });
});

describe('ridgelineLayout', () => {
  const groups = [
    { label: 'Mon', density: [0, 2, 1] },
    { label: 'Tue', density: [1, 3, 0] },
  ];

  it('produces front-row area/line paths and decreasing alpha (golden)', () => {
    const layout = ridgelineLayout(groups, { width: 120, height: 100, rtl: false, labelGutter: 20 });
    expect(layout.rows[0]?.areaPath).toBe('M20,100L70,50L120,75L120,100L20,100Z');
    expect(layout.rows[0]?.linePath).toBe('M20,100L70,50L120,75');
    expect(layout.rows.map((r) => r.alpha)).toEqual([1, 0.35]);
  });

  it('mirrors the value axis in RTL (density origin moves to the right)', () => {
    const ltr = ridgelineLayout(groups, { width: 120, height: 100, rtl: false, labelGutter: 20 });
    const rtl = ridgelineLayout(groups, { width: 120, height: 100, rtl: true, labelGutter: 20 });
    // First density sample sits at plotStart (left) in LTR, plotEnd (right) in RTL.
    expect(ltr.rows[0]?.linePath.startsWith('M20,')).toBe(true);
    expect(rtl.rows[0]?.linePath.startsWith('M100,')).toBe(true);
  });
});

describe('scatterLayout', () => {
  const points = [
    { x: 0, y: 0 },
    { x: 10, y: 10 },
    { x: 20, y: 20 },
  ];

  it('fits a least-squares trend across the domain (golden)', () => {
    const layout = scatterLayout(points, { width: 200, height: 100, rtl: false });
    expect(layout.xTicks).toEqual([0, 5, 10, 15, 20]);
    expect(layout.trend).toEqual({ x1: 0, y1: 100, x2: 200, y2: 0 });
    expect(layout.marks).toHaveLength(3);
  });

  it('collects distinct segments in first-seen order and sizes bubbles by r', () => {
    const layout = scatterLayout(
      [
        { x: 1, y: 1, r: 2, segment: 'us' },
        { x: 2, y: 2, r: 8, segment: 'eu' },
        { x: 3, y: 3, r: 5, segment: 'us' },
      ],
      { width: 200, height: 100, rtl: false },
    );
    expect(layout.segments).toEqual(['us', 'eu']);
    // Larger r → larger rendered radius.
    expect(layout.marks[1]!.r).toBeGreaterThan(layout.marks[0]!.r);
  });

  it('mirrors the x value axis in RTL', () => {
    const ltr = scatterLayout(points, { width: 200, height: 100, rtl: false });
    const rtl = scatterLayout(points, { width: 200, height: 100, rtl: true });
    expect(ltr.xFor(0)).toBeLessThan(ltr.xFor(20));
    expect(rtl.xFor(0)).toBeGreaterThan(rtl.xFor(20));
  });
});

describe('hexbinLayout', () => {
  it('fits pointy-top hexes and emits deterministic polygon points (golden)', () => {
    const layout = hexbinLayout({ rows: 1, cols: 1, width: 100, height: 100, rtl: false });
    expect(layout.radius).toBeCloseTo(38.49, 2);
    expect(layout.hexPoints(layout.cells[0]!.cx, layout.cells[0]!.cy)).toBe(
      '33.333,0.000 66.667,19.245 66.667,57.735 33.333,76.980 -0.000,57.735 0.000,19.245',
    );
  });

  it('mirrors columns in RTL', () => {
    const ltr = hexbinLayout({ rows: 1, cols: 3, width: 300, height: 100, rtl: false });
    const rtl = hexbinLayout({ rows: 1, cols: 3, width: 300, height: 100, rtl: true });
    const cxOf = (l: typeof ltr, col: number) => l.cells.find((c) => c.col === col)?.cx ?? 0;
    expect(cxOf(ltr, 0)).toBeLessThan(cxOf(ltr, 2));
    expect(cxOf(rtl, 0)).toBeGreaterThan(cxOf(rtl, 2));
  });
});

describe('matrixGridLayout', () => {
  it('lays out a uniform gapped grid (golden)', () => {
    const grid = matrixGridLayout({ rows: 2, cols: 2, width: 100, height: 100, rtl: false, gap: 2 });
    expect(grid.cellW).toBe(49);
    expect(grid.cells[0]).toEqual({ row: 0, col: 0, x: 0, y: 0, w: 49, h: 49 });
    expect(grid.colX(1)).toBe(51);
  });

  it('mirrors column order in RTL, rows unchanged', () => {
    const grid = matrixGridLayout({ rows: 2, cols: 2, width: 100, height: 100, rtl: true, gap: 2 });
    expect(grid.colX(0)).toBe(51);
    expect(grid.colX(1)).toBe(0);
    expect(grid.rowY(1)).toBe(51);
  });
});

describe('parallelLayout', () => {
  const axes = [
    { key: 'a', label: 'A', min: 0, max: 10 },
    { key: 'b', label: 'B', min: 0, max: 10 },
  ];

  it('normalises per axis and connects axes into a polyline (golden)', () => {
    const layout = parallelLayout(axes, [{ values: [0, 10] }], { width: 100, height: 100 });
    expect(layout.axisX).toEqual([0, 100]);
    expect(layout.paths[0]?.path).toBe('M0,92L100,8');
  });

  it('mirrors axis order in RTL and collects segments', () => {
    const rtl = parallelLayout(
      axes,
      [
        { values: [1, 2], segment: 'x' },
        { values: [3, 4], segment: 'y' },
      ],
      { width: 100, height: 100, rtl: true },
    );
    expect(rtl.axisX).toEqual([100, 0]);
    expect(rtl.segments).toEqual(['x', 'y']);
  });
});
