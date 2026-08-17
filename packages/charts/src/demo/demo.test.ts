// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import {
  DEMO_EPOCH_MS,
  demoCategorical,
  demoComparisonSeries,
  demoDonut,
  demoGroupedBars,
  demoSparkline,
  demoTimeseries,
} from './generators.js';
import { fnv1a, mulberry32 } from './mulberry32.js';

describe('mulberry32', () => {
  it('is deterministic per seed and in [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).toEqual(seqB);
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('diverges across seeds', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});

describe('fnv1a', () => {
  it('hashes stably to uint32', () => {
    expect(fnv1a('widget-1')).toBe(fnv1a('widget-1'));
    expect(fnv1a('widget-1')).not.toBe(fnv1a('widget-2'));
    expect(fnv1a('')).toBe(0x811c9dc5);
  });
});

describe('demo generators', () => {
  it('demoTimeseries is byte-stable for a seed (fixed epoch, no Date.now)', () => {
    const a = demoTimeseries(7);
    const b = demoTimeseries(7);
    expect(a).toEqual(b);
    expect(a).toHaveLength(30);
    expect(a.at(-1)?.x.getTime()).toBe(DEMO_EPOCH_MS);
    for (const p of a) expect(p.y).toBeGreaterThan(0);
  });

  it('demoTimeseries applies a weekend dip (weekday seasonality)', () => {
    const series = demoTimeseries(7, { points: 28, volatility: 0, drift: 0 });
    const byDay = new Map<number, number[]>();
    for (const p of series) {
      const day = p.x.getUTCDay();
      byDay.set(day, [...(byDay.get(day) ?? []), p.y]);
    }
    const avg = (xs: number[] | undefined) => (xs && xs.length > 0 ? xs.reduce((s, v) => s + v, 0) / xs.length : 0);
    expect(avg(byDay.get(0))).toBeLessThan(avg(byDay.get(3))); // Sunday < Wednesday
  });

  it('demoComparisonSeries keeps x, dampens y, deterministic', () => {
    const base = demoTimeseries(9);
    const cmp = demoComparisonSeries(base, 9);
    expect(cmp).toEqual(demoComparisonSeries(base, 9));
    expect(cmp.map((p) => p.x)).toEqual(base.map((p) => p.x));
    const sum = (xs: { y: number }[]) => xs.reduce((s, p) => s + p.y, 0);
    expect(sum(cmp)).toBeLessThan(sum(base));
  });

  it('demoCategorical / demoGroupedBars / demoDonut / demoSparkline are deterministic and shaped', () => {
    expect(demoCategorical(3)).toEqual(demoCategorical(3));
    expect(demoCategorical(3)).toHaveLength(6);

    const grouped = demoGroupedBars(3);
    expect(grouped).toEqual(demoGroupedBars(3));
    expect(grouped.series).toHaveLength(2);
    expect(grouped.series[0]?.values).toHaveLength(grouped.categories.length);

    const donut = demoDonut(3);
    expect(donut).toEqual(demoDonut(3));
    expect(donut.map((s) => s.label)).toEqual(['Free', 'Pro', 'Business', 'Enterprise']);
    expect(donut[0]?.value).toBeGreaterThan(donut.at(-1)?.value ?? -Infinity);

    const spark = demoSparkline(3);
    expect(spark).toEqual(demoSparkline(3));
    expect(spark).toHaveLength(8);
    for (const v of spark) {
      expect(v).toBeGreaterThanOrEqual(8);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
});
