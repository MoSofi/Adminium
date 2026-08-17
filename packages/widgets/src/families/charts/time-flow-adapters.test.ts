// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tests for the pure §3-envelope → primitive-input adapters (04-T09). Exercised
 * against the deterministic demo payloads plus hand-built edge cases; null on
 * malformed input. Independent of the component barrel.
 */
import { describe, expect, it } from 'vitest';

import {
  toBumpInputs,
  toCandles,
  toForecastInputs,
  toLaneInputs,
  toTimeSeriesGroup,
} from './time-flow-adapters.js';
import {
  chartBumpDemoData,
  chartCandlestickDemoData,
  chartForecastDemoData,
  chartMultilineDemoData,
  chartTimelineLanesDemoData,
} from './time-flow-demo.js';

describe('toTimeSeriesGroup', () => {
  it('maps a multi-timeseries envelope to Date-x series', () => {
    const group = toTimeSeriesGroup(chartMultilineDemoData(1));
    expect(group).not.toBeNull();
    expect(group).toHaveLength(3);
    expect(group?.[0]?.points[0]?.x).toBeInstanceOf(Date);
    expect(typeof group?.[0]?.points[0]?.y).toBe('number');
  });

  it('returns null for empty/malformed payloads', () => {
    expect(toTimeSeriesGroup({ series: [] })).toBeNull();
    expect(toTimeSeriesGroup({ series: [{ key: 'a', label: 'A', points: [] }] })).toBeNull();
    expect(toTimeSeriesGroup({ nope: true })).toBeNull();
  });
});

describe('toForecastInputs', () => {
  it('splits history / forecast / band', () => {
    const inputs = toForecastInputs(chartForecastDemoData(2));
    expect(inputs?.history.length).toBeGreaterThan(0);
    expect(inputs?.forecast.length).toBe(inputs?.band.length);
    expect(inputs?.history[0]?.x).toBeInstanceOf(Date);
  });

  it('returns null without history points', () => {
    expect(toForecastInputs({ forecast: [{ t: '2026-01-01T00:00:00.000Z', v: 1 }] })).toBeNull();
  });
});

describe('toCandles', () => {
  it('keeps only the last `count` candles', () => {
    const all = toCandles(chartCandlestickDemoData(3));
    expect(all?.length).toBe(48);
    const trimmed = toCandles(chartCandlestickDemoData(3), 10);
    expect(trimmed?.length).toBe(10);
    expect(trimmed?.at(-1)).toEqual(all?.at(-1)); // last candle preserved
  });

  it('returns null when there are no candles', () => {
    expect(toCandles({ candles: [] })).toBeNull();
    expect(toCandles({ candles: [{ t: '1', o: 1 }] })).toBeNull(); // missing h/l/c
  });
});

describe('toBumpInputs', () => {
  it('derives periods, maxRank and aligned ranks from a rank multi-timeseries', () => {
    const inputs = toBumpInputs(chartBumpDemoData(4));
    expect(inputs?.periods).toBe(6);
    expect(inputs?.maxRank).toBe(5);
    expect(inputs?.series).toHaveLength(5);
    expect(inputs?.series[0]?.ranks).toHaveLength(6);
    expect(inputs?.periodLabels).toHaveLength(6);
  });

  it('honors config overrides for periods/maxRank', () => {
    const inputs = toBumpInputs(chartBumpDemoData(4), 4, 8);
    expect(inputs?.periods).toBe(4);
    expect(inputs?.maxRank).toBe(8);
    expect(inputs?.series[0]?.ranks).toHaveLength(4);
  });
});

describe('toLaneInputs', () => {
  it('maps categories to lanes and normalizes positions to [0,1]', () => {
    const inputs = toLaneInputs(chartTimelineLanesDemoData(2));
    expect(inputs?.lanes).toEqual(expect.arrayContaining(['Deploys', 'Incidents', 'Releases']));
    const positions = inputs?.events.map((e) => e.position) ?? [];
    expect(Math.min(...positions)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...positions)).toBeLessThanOrEqual(1);
    expect(inputs?.axisLabels).toHaveLength(4);
  });

  it('honors explicit lane order and axisBuckets, null on no dated events', () => {
    const inputs = toLaneInputs(chartTimelineLanesDemoData(2), ['Releases', 'Deploys'], 6);
    expect(inputs?.lanes).toEqual(['Releases', 'Deploys']);
    expect(inputs?.axisLabels).toHaveLength(6);
    expect(toLaneInputs({ events: [] })).toBeNull();
    expect(toLaneInputs({ events: [{ title: 'x', category: 'y' }] })).toBeNull(); // no date
  });
});
