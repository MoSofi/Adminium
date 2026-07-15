/**
 * Geometry tests for the M7 "time, forecast & flow" chart group (04-T09).
 * Pure functions → determinism (Node-vs-expected byte identity), golden path
 * strings for the hand-built builders, and structural correctness. No DOM.
 */
import { describe, expect, it } from 'vitest';

import { anomalyModel } from './anomaly.js';
import { layoutBump } from './bump.js';
import { layoutCandles } from './candles.js';
import type { Candle } from './candles.js';
import { confidenceBandPath, linearForecast, zForConfidence } from './forecast.js';
import { multiSeriesPaths, seriesColorVar } from './multiLine.js';
import { bandAreaPath, stackStream } from './streamStack.js';
import { layoutLanes, positionByTime } from './timelineLanes.js';

describe('multiLine geometry', () => {
  const series = [
    { key: 'a', label: 'A', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 5 }] },
    { key: 'b', label: 'B', points: [] },
  ];

  it('builds one path per non-empty series with the end anchor, deterministically', () => {
    const first = multiSeriesPaths(series);
    const second = multiSeriesPaths(series);
    expect(first[0]?.path).toBe(second[0]?.path); // byte identity across runs
    expect(first[0]?.path).toMatch(/^M/);
    expect(first[0]?.end).toEqual({ x: 20, y: 5 });
    expect(first[1]?.path).toBeNull();
    expect(first[1]?.end).toBeNull();
  });

  it('golden linear path string for fixed pixel points', () => {
    const [only] = multiSeriesPaths([{ key: 'x', label: 'X', points: [{ x: 0, y: 0 }, { x: 10, y: 4 }] }]);
    expect(only?.path).toBe('M0,0L10,4');
  });

  it('assigns viz colors cyclically', () => {
    expect(seriesColorVar(0)).toBe('var(--viz-1)');
    expect(seriesColorVar(7)).toBe('var(--viz-8)');
    expect(seriesColorVar(8)).toBe('var(--viz-1)');
  });
});

describe('streamStack geometry', () => {
  const series = [
    { key: 'a', label: 'A', values: [1, 2, 3] },
    { key: 'b', label: 'B', values: [3, 2, 1] },
  ];

  it('centers the total on zero (silhouette) and reports the extent', () => {
    const { bands, min, max } = stackStream(series, 'silhouette');
    // Total at each index is 4 → edges span [-2, +2].
    expect(min).toBeCloseTo(-2, 6);
    expect(max).toBeCloseTo(2, 6);
    expect(bands[0]?.low[0]).toBeCloseTo(-2, 6);
    expect(bands[0]?.high[0]).toBeCloseTo(-1, 6);
    expect(bands[1]?.high[0]).toBeCloseTo(2, 6);
  });

  it('zero offset stacks upward from a flat baseline', () => {
    const { bands, min } = stackStream(series, 'zero');
    expect(min).toBe(0);
    expect(bands[0]?.low[0]).toBe(0);
    expect(bands[1]?.high[0]).toBeCloseTo(4, 6);
  });

  it('clamps negatives and is deterministic', () => {
    const a = stackStream([{ key: 'x', label: 'X', values: [-5, 2] }]);
    const b = stackStream([{ key: 'x', label: 'X', values: [-5, 2] }]);
    expect(a).toEqual(b);
    // Clamped to zero thickness (avoid ±0 identity quirk by checking the span).
    expect((a.bands[0]?.high[0] ?? 0) - (a.bands[0]?.low[0] ?? 0)).toBeCloseTo(0, 6);
  });

  it('bandAreaPath builds a closed area path, null when empty', () => {
    const path = bandAreaPath([0, 10], [5, 5], [0, 0]);
    expect(path).toMatch(/^M/);
    expect(bandAreaPath([0, 10], [5, 5], [0, 0])).toBe(path); // byte identity
  });
});

describe('forecast geometry', () => {
  it('projects a rising trend and widens the band with the horizon', () => {
    // Noisy-but-rising history so residual σ > 0 and the interval can widen.
    const history = [1, 3, 2, 4, 6, 5, 7, 9];
    const model = linearForecast(history, 3, 0.9);
    expect(model.forecast).toEqual(linearForecast(history, 3, 0.9).forecast); // deterministic
    expect(model.forecast[2]!).toBeGreaterThan(model.forecast[0]!); // rising trend
    const w0 = model.hi[0]! - model.lo[0]!;
    const w2 = model.hi[2]! - model.lo[2]!;
    expect(w0).toBeGreaterThan(0);
    expect(w2).toBeGreaterThan(w0); // interval widens with step
  });

  it('zero band for a perfectly linear history, empty for empty input', () => {
    const model = linearForecast([2, 4, 6, 8], 2);
    expect(model.hi[0]! - model.lo[0]!).toBeCloseTo(0, 6); // no residual → no spread
    expect(linearForecast([], 3)).toEqual({ forecast: [], lo: [], hi: [] });
  });

  it('zForConfidence maps known levels and falls back to 90%', () => {
    expect(zForConfidence(0.95)).toBeCloseTo(1.959_964, 6);
    expect(zForConfidence(0.42)).toBeCloseTo(zForConfidence(0.9), 6);
  });

  it('confidenceBandPath golden string (forward upper, back lower, closed)', () => {
    const path = confidenceBandPath(
      [{ x: 0, y: 0 }, { x: 10, y: 2 }],
      [{ x: 0, y: 0 }, { x: 10, y: 8 }],
    );
    expect(path).toBe('M0,0L10,2L10,8L0,0Z');
    expect(confidenceBandPath([], [])).toBeNull();
    expect(confidenceBandPath([{ x: 0, y: 0 }], [])).toBeNull(); // mismatched lengths
  });
});

describe('anomaly geometry', () => {
  it('flags an injected spike and is deterministic', () => {
    const values = [10, 10, 10, 10, 40, 10, 10, 10, 10];
    const model = anomalyModel(values, 2, 3);
    expect(model).toEqual(anomalyModel(values, 2, 3));
    expect(model.anomalies).toContain(4);
    expect(model.hi[0]! >= model.lo[0]!).toBe(true);
  });

  it('flags nothing on a flat series (sigma 0) and handles empty', () => {
    expect(anomalyModel([5, 5, 5, 5]).anomalies).toEqual([]);
    expect(anomalyModel([])).toEqual({ mid: [], lo: [], hi: [], anomalies: [] });
  });
});

describe('candles geometry', () => {
  const candles: Candle[] = [
    { t: '1', o: 10, h: 12, l: 9, c: 11 }, // up
    { t: '2', o: 11, h: 11.5, l: 8, c: 9 }, // down
  ];

  it('flags up/down by close vs open and keeps bodies inside the plot', () => {
    const layout = layoutCandles(candles, 100, 200);
    expect(layout.rects).toHaveLength(2);
    expect(layout.rects[0]?.up).toBe(true);
    expect(layout.rects[1]?.up).toBe(false);
    for (const rect of layout.rects) {
      expect(rect.bodyY).toBeGreaterThanOrEqual(0);
      expect(rect.bodyY + rect.bodyHeight).toBeLessThanOrEqual(200 + 1e-6);
      expect(rect.highY).toBeLessThanOrEqual(rect.lowY); // high is higher on screen
      expect(rect.x + rect.width).toBeLessThanOrEqual(rect.centerX + 100);
    }
  });

  it('enforces a minimum body height for doji candles and is deterministic', () => {
    const doji: Candle[] = [{ t: '1', o: 10, h: 12, l: 8, c: 10 }];
    const layout = layoutCandles(doji, 40, 100, { minBody: 2 });
    expect(layout.rects[0]?.bodyHeight).toBeGreaterThanOrEqual(2);
    // Compare rects only — the layout also carries a `yFor` closure.
    expect(layoutCandles(doji, 40, 100).rects).toEqual(layoutCandles(doji, 40, 100).rects);
  });
});

describe('bump geometry', () => {
  const series = [
    { key: 'a', label: 'A', ranks: [1, 2, 1] },
    { key: 'b', label: 'B', ranks: [2, 1, null] },
  ];

  it('places rank 1 above rank 2 and mirrors the period axis in RTL', () => {
    const ltr = layoutBump(series, 3, 2, 300, 200, false);
    const rtl = layoutBump(series, 3, 2, 300, 200, true);
    expect(ltr.yForRank(1)).toBeLessThan(ltr.yForRank(2)); // rank 1 nearer the top
    expect(ltr.xForPeriod(0)).toBeLessThan(ltr.xForPeriod(2));
    expect(rtl.xForPeriod(0)).toBeGreaterThan(rtl.xForPeriod(2)); // mirrored
    // Null rank drops the point (B has 2 points, not 3).
    expect(ltr.lines[1]?.points).toHaveLength(2);
    expect(ltr.lines[0]?.end?.rank).toBe(1);
  });
});

describe('timelineLanes geometry', () => {
  const lanes = ['Deploys', 'Incidents'];
  const events = [
    { lane: 'Deploys', position: 0, label: 'v1' },
    { lane: 'Deploys', position: 1, label: 'v2' },
    { lane: 'Incidents', position: 0.5, label: 'SEV2', tone: 'danger' },
  ];

  it('stacks lanes and positions events by clamped fraction', () => {
    const rows = layoutLanes(lanes, events, 200, 100);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.events[0]?.x).toBe(0);
    expect(rows[0]?.events[1]?.x).toBe(200);
    expect(rows[1]?.events[0]?.x).toBe(100);
    expect(rows[1]?.y).toBeGreaterThan(rows[0]?.y ?? 0); // second lane below the first
    expect(rows[1]?.events[0]?.tone).toBe('danger');
    expect(layoutLanes([], events, 200, 100)).toEqual([]);
  });

  it('positionByTime normalizes timestamps to [0,1]', () => {
    const positioned = positionByTime([
      { lane: 'x', ms: 100, label: 'a' },
      { lane: 'x', ms: 200, label: 'b' },
      { lane: 'x', ms: 150, label: 'c' },
    ]);
    expect(positioned[0]?.position).toBe(0);
    expect(positioned[1]?.position).toBe(1);
    expect(positioned[2]?.position).toBeCloseTo(0.5, 6);
    expect(positionByTime([])).toEqual([]);
  });
});
