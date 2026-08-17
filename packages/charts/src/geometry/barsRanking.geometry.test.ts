// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pure-geometry contract for the "bars & ranking" chart group (04-T09): every
 * layout is deterministic (same input → deep-equal output, so server-side
 * report rendering matches the browser), RTL mirrors the horizontal/categorical
 * axis, and the path-emitting layouts (pareto, slope) produce identical SVG
 * path strings in Node — checked against a golden below (04 §7.1/§7.6).
 */
import { describe, expect, it } from 'vitest';

import { layoutRanking } from './ranking.js';
import { layoutBullet } from './bullet.js';
import { layoutPareto } from './pareto.js';
import { layoutWaterfall } from './waterfall.js';
import { layoutMarimekko } from './marimekko.js';
import { layoutStacked100 } from './stacked100.js';
import { layoutSlope } from './slope.js';

describe('ranking geometry', () => {
  const items = [
    { label: 'A', value: 100 },
    { label: 'B', value: 60 },
    { label: 'C', value: 20 },
  ];

  it('is deterministic and marks the max as leader; bar length ∝ value', () => {
    const a = layoutRanking(items, { width: 300, height: 150, rtl: false });
    const b = layoutRanking(items, { width: 300, height: 150, rtl: false });
    expect(a).toEqual(b);
    expect(a.bars).toHaveLength(3);
    expect(a.bars[0]?.isLeader).toBe(true);
    expect(a.bars[1]?.isLeader).toBe(false);
    expect(a.bars[0]?.width).toBeCloseTo(300, 6);
    expect(a.bars[1]?.width).toBeCloseTo(180, 6);
  });

  it('mirrors the value axis in RTL (bars anchor at the right edge)', () => {
    const ltr = layoutRanking(items, { width: 300, height: 150, rtl: false });
    const rtl = layoutRanking(items, { width: 300, height: 150, rtl: true });
    expect(ltr.bars[0]?.x).toBe(0);
    expect(rtl.bars[0]?.x).toBeCloseTo(0, 6); // leader fills full width → same start
    expect(rtl.bars[2]?.x).toBeGreaterThan(ltr.bars[2]?.x ?? -1);
  });

  it('applies the top-N cap', () => {
    expect(layoutRanking(items, { width: 300, height: 150, rtl: false, max: 2 }).bars).toHaveLength(2);
  });
});

describe('bullet geometry', () => {
  const rows = [{ label: 'Rev', measure: 60, target: 80, max: 100, bandCutoffs: [40, 75] }];

  it('is deterministic; bands are contiguous and cover the full track', () => {
    const a = layoutBullet(rows, { width: 200, height: 60, rtl: false });
    expect(a).toEqual(layoutBullet(rows, { width: 200, height: 60, rtl: false }));
    const bands = a.rows[0]?.bands ?? [];
    expect(bands).toHaveLength(3);
    const totalWidth = bands.reduce((sum, band) => sum + band.width, 0);
    expect(totalWidth).toBeCloseTo(200, 6);
    expect(a.rows[0]?.measureWidth).toBeCloseTo(120, 6); // 60/100 * 200
    expect(a.rows[0]?.targetX).toBeCloseTo(160, 6); // 80/100 * 200
  });

  it('mirrors measure + target in RTL', () => {
    const rtl = layoutBullet(rows, { width: 200, height: 60, rtl: true });
    expect(rtl.rows[0]?.measureX).toBeCloseTo(80, 6); // 200 - 120
    expect(rtl.rows[0]?.targetX).toBeCloseTo(40, 6); // 200 - 160
  });
});

describe('pareto geometry', () => {
  const items = [
    { label: 'X', value: 50 },
    { label: 'Y', value: 30 },
    { label: 'Z', value: 20 },
  ];

  it('is deterministic; cumulative reaches 1 on the last bar', () => {
    const a = layoutPareto(items, { width: 300, height: 200, rtl: false });
    const b = layoutPareto(items, { width: 300, height: 200, rtl: false });
    // yFor is a fresh closure each call; compare the serializable geometry.
    expect(a.bars).toEqual(b.bars);
    expect(a.linePath).toBe(b.linePath);
    expect(a.yTicks).toEqual(b.yTicks);
    expect(a.bars.at(-1)?.cumulative).toBeCloseTo(1, 6);
    expect(a.bars[0]?.cumulative).toBeCloseTo(0.5, 6);
    expect(a.cutlineY).not.toBeNull();
  });

  it('mirrors category order in RTL', () => {
    const ltr = layoutPareto(items, { width: 300, height: 200, rtl: false });
    const rtl = layoutPareto(items, { width: 300, height: 200, rtl: true });
    expect((ltr.bars[0]?.centerX ?? 0) < (ltr.bars[2]?.centerX ?? 0)).toBe(true);
    expect((rtl.bars[0]?.centerX ?? 0) > (rtl.bars[2]?.centerX ?? 0)).toBe(true);
  });
});

describe('waterfall geometry', () => {
  const steps = [
    { label: 'Start', value: 100, type: 'total' as const },
    { label: 'Up', value: 40, type: 'up' as const },
    { label: 'Down', value: 30, type: 'down' as const },
    { label: 'Net', value: 110, type: 'total' as const },
  ];

  it('is deterministic; running level tracks the steps', () => {
    const a = layoutWaterfall(steps, { width: 320, height: 200, rtl: false });
    const b = layoutWaterfall(steps, { width: 320, height: 200, rtl: false });
    expect(a.bars).toEqual(b.bars);
    expect(a.connectors).toEqual(b.connectors);
    expect(a.bars.map((bar) => bar.exitLevel)).toEqual([100, 140, 110, 110]);
    expect(a.connectors).toHaveLength(3);
  });

  it('connector logical side flips in RTL', () => {
    const ltr = layoutWaterfall(steps, { width: 320, height: 200, rtl: false });
    const rtl = layoutWaterfall(steps, { width: 320, height: 200, rtl: true });
    const first = ltr.bars[0];
    const firstRtl = rtl.bars[0];
    expect(ltr.connectors[0]?.x1).toBeCloseTo((first?.x ?? 0) + (first?.width ?? 0), 6);
    expect(rtl.connectors[0]?.x1).toBeCloseTo(firstRtl?.x ?? -1, 6);
  });
});

describe('marimekko geometry', () => {
  const rowKeys = ['P', 'Q'];
  const colKeys = ['R1', 'R2'];
  const cells = [
    [30, 10],
    [10, 50],
  ];

  it('is deterministic; column widths ∝ column totals, segments fill height', () => {
    const a = layoutMarimekko(rowKeys, colKeys, cells, { width: 202, height: 100, rtl: false, gap: 2 });
    expect(a).toEqual(layoutMarimekko(rowKeys, colKeys, cells, { width: 202, height: 100, rtl: false, gap: 2 }));
    // totals: R1 = 40, R2 = 60, grand = 100; usable = 200 → widths 80 / 120.
    expect(a.columns[0]?.width).toBeCloseTo(80, 6);
    expect(a.columns[1]?.width).toBeCloseTo(120, 6);
    const segHeights = a.columns[0]?.segments.reduce((sum, seg) => sum + seg.height, 0) ?? 0;
    expect(segHeights).toBeCloseTo(100, 6);
  });

  it('mirrors column order in RTL', () => {
    const ltr = layoutMarimekko(rowKeys, colKeys, cells, { width: 202, height: 100, rtl: false });
    const rtl = layoutMarimekko(rowKeys, colKeys, cells, { width: 202, height: 100, rtl: true });
    expect((ltr.columns[0]?.x ?? 0) < (ltr.columns[1]?.x ?? 0)).toBe(true);
    expect((rtl.columns[0]?.x ?? 0) > (rtl.columns[1]?.x ?? 0)).toBe(true);
  });
});

describe('stacked-100 geometry', () => {
  const items = [
    { key: 'a', label: 'A', value: 25 },
    { key: 'b', label: 'B', value: 75 },
  ];

  it('is deterministic; shares sum to 1; widths fill the track minus gaps', () => {
    const a = layoutStacked100(items, { width: 102, rtl: false, gap: 2 });
    expect(a).toEqual(layoutStacked100(items, { width: 102, rtl: false, gap: 2 }));
    expect(a.segments.reduce((sum, seg) => sum + seg.share, 0)).toBeCloseTo(1, 6);
    expect(a.segments[0]?.width).toBeCloseTo(25, 6); // 25% of usable 100
    expect(a.segments[1]?.width).toBeCloseTo(75, 6);
  });

  it('mirrors segment order in RTL', () => {
    const ltr = layoutStacked100(items, { width: 102, rtl: false, gap: 2 });
    const rtl = layoutStacked100(items, { width: 102, rtl: true, gap: 2 });
    expect((ltr.segments[0]?.x ?? 0) < (ltr.segments[1]?.x ?? 0)).toBe(true);
    expect((rtl.segments[0]?.x ?? 0) > (rtl.segments[1]?.x ?? 0)).toBe(true);
  });
});

describe('slope geometry', () => {
  const records = [
    { label: 'Free', a: 40, b: 20 },
    { label: 'Pro', a: 20, b: 45 },
  ];

  it('is deterministic; direction and period-axis flip in RTL', () => {
    const a = layoutSlope(records, { width: 200, height: 120, rtl: false });
    const b = layoutSlope(records, { width: 200, height: 120, rtl: false });
    expect(a.lines).toEqual(b.lines);
    expect(a.lines[0]?.rising).toBe(false);
    expect(a.lines[1]?.rising).toBe(true);
    expect(a.xA).toBe(0);
    expect(a.xB).toBe(200);
    const rtl = layoutSlope(records, { width: 200, height: 120, rtl: true });
    expect(rtl.xA).toBe(200);
    expect(rtl.xB).toBe(0);
  });
});

describe('golden path strings (Node ≡ browser, deterministic geometry)', () => {
  it('pareto cumulative line + slope connector match the checked-in golden', () => {
    const pareto = layoutPareto(
      [
        { label: 'X', value: 50 },
        { label: 'Y', value: 30 },
        { label: 'Z', value: 20 },
      ],
      { width: 300, height: 200, rtl: false },
    );
    const slope = layoutSlope([{ label: 'Free', a: 40, b: 20 }], { width: 200, height: 120, rtl: false });
    expect({ pareto: pareto.linePath, slope: slope.lines[0]?.path }).toMatchInlineSnapshot(`
      {
        "pareto": "M51.316,100L150,40L248.684,0",
        "slope": "M0,8.276L200,111.724",
      }
    `);
  });
});
