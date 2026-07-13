import { describe, expect, it } from 'vitest';

import { bins, extent, niceTicks, quantileSorted, tickStep } from './stats.js';

describe('extent', () => {
  it('returns min/max ignoring NaN', () => {
    expect(extent([3, NaN, -2, 7, 0])).toEqual([-2, 7]);
  });

  it('returns null for empty or all-NaN input', () => {
    expect(extent([])).toBeNull();
    expect(extent([NaN, NaN])).toBeNull();
  });

  it('handles single values', () => {
    expect(extent([5])).toEqual([5, 5]);
  });
});

describe('tickStep', () => {
  it('picks 1/2/5 × power-of-ten steps', () => {
    expect(tickStep(0, 100, 4)).toBe(20);
    expect(tickStep(0, 10, 5)).toBe(2);
    expect(tickStep(0, 1, 4)).toBe(0.2);
  });

  it('never returns zero', () => {
    expect(tickStep(5, 5, 4)).toBeGreaterThan(0);
  });
});

describe('niceTicks', () => {
  it('covers the domain with round values', () => {
    const ticks = niceTicks(0, 87, 3);
    expect(ticks[0]).toBeLessThanOrEqual(0);
    expect(ticks.at(-1)).toBeGreaterThanOrEqual(87);
    // Round steps: consecutive differences all equal.
    const diffs = new Set(ticks.slice(1).map((t, i) => t - (ticks[i] ?? 0)));
    expect(diffs.size).toBe(1);
  });

  it('collapses a degenerate domain to one tick', () => {
    expect(niceTicks(4, 4)).toEqual([4]);
  });

  it('includes zero for domains spanning zero', () => {
    expect(niceTicks(-30, 70, 4)).toContain(0);
  });
});

describe('quantileSorted', () => {
  it('interpolates linearly', () => {
    expect(quantileSorted([0, 10], 0.5)).toBe(5);
    expect(quantileSorted([1, 2, 3, 4], 0)).toBe(1);
    expect(quantileSorted([1, 2, 3, 4], 1)).toBe(4);
  });

  it('returns null for empty input', () => {
    expect(quantileSorted([], 0.5)).toBeNull();
  });
});

describe('bins', () => {
  it('produces equal-width bins whose counts sum to n', () => {
    const values = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const result = bins(values, 5);
    expect(result).toHaveLength(5);
    expect(result.reduce((sum, b) => sum + b.count, 0)).toBe(values.length);
    expect(result[0]?.x0).toBe(0);
    expect(result.at(-1)?.x1).toBe(10);
  });

  it('puts the max value in the last bin (inclusive upper edge)', () => {
    const result = bins([0, 10], 2);
    expect(result.at(-1)?.count).toBe(1);
  });

  it('returns [] for empty input', () => {
    expect(bins([], 4)).toEqual([]);
  });
});
