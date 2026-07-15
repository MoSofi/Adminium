/**
 * Metadata-layer tests for the M7 "time, forecast & flow" charts group: config
 * schema parsing + per-widget default empty copy, deterministic seeded demo
 * payloads (acceptance #11), and the declared data-contract emptiness
 * predicates (04 §3/§4). Imports only the pure config/demo modules, so it runs
 * independently of the green-loop-assembled component barrel.
 */
import { describe, expect, it } from 'vitest';

import { isEmptyData } from '../../registry/data-empty.js';
import type { DataShape } from '../../page-config/index.js';
import {
  chartAnomalyConfigSchema,
  chartBumpConfigSchema,
  chartCandlestickConfigSchema,
  chartForecastConfigSchema,
  chartMultilineConfigSchema,
  chartStreamConfigSchema,
  chartTimelineLanesConfigSchema,
} from './time-flow-config.js';
import {
  chartAnomalyDemoData,
  chartBumpDemoData,
  chartCandlestickDemoData,
  chartForecastDemoData,
  chartMultilineDemoData,
  chartStreamDemoData,
  chartTimelineLanesDemoData,
} from './time-flow-demo.js';

const cases = [
  { name: 'multiline', schema: chartMultilineConfigSchema, demo: chartMultilineDemoData, shape: 'multi-timeseries' as DataShape },
  { name: 'stream', schema: chartStreamConfigSchema, demo: chartStreamDemoData, shape: 'multi-timeseries' as DataShape },
  { name: 'forecast', schema: chartForecastConfigSchema, demo: chartForecastDemoData, shape: 'timeseries' as DataShape },
  { name: 'anomaly', schema: chartAnomalyConfigSchema, demo: chartAnomalyDemoData, shape: 'timeseries' as DataShape },
  { name: 'candlestick', schema: chartCandlestickConfigSchema, demo: chartCandlestickDemoData, shape: 'ohlc' as DataShape },
  { name: 'bump', schema: chartBumpConfigSchema, demo: chartBumpDemoData, shape: 'multi-timeseries' as DataShape },
  { name: 'timelineLanes', schema: chartTimelineLanesConfigSchema, demo: chartTimelineLanesDemoData, shape: 'calendar-events' as DataShape },
];

describe('time-flow config schemas', () => {
  for (const { name, schema } of cases) {
    it(`${name}: parses {} to defaults with per-widget empty copy`, () => {
      const parsed = schema.parse({});
      expect(parsed.emptyState?.titleKey).toBe(`widgets.charts.${name}.empty.title`);
      expect(parsed.emptyState?.bodyKey).toBe(`widgets.charts.${name}.empty.body`);
      // Shared config still threads through.
      const withTitle = schema.parse({ title: 'X', tone: 'pos' });
      expect(withTitle.title).toBe('X');
      expect(withTitle.tone).toBe('pos');
    });
  }

  it('forecast/anomaly/candlestick expose their annex knobs', () => {
    expect(chartForecastConfigSchema.parse({ horizon: 20, confidence: 0.95, method: 'linear' })).toMatchObject({
      horizon: 20,
      confidence: 0.95,
      method: 'linear',
    });
    expect(chartAnomalyConfigSchema.parse({ sensitivity: 3 }).sensitivity).toBe(3);
    expect(chartCandlestickConfigSchema.parse({ livePill: true, candleCount: 60 })).toMatchObject({
      livePill: true,
      candleCount: 60,
    });
  });
});

describe('time-flow demo payloads', () => {
  for (const { name, demo, shape } of cases) {
    it(`${name}: deterministic per seed and non-empty for its contract`, () => {
      expect(demo(11)).toEqual(demo(11)); // byte-identical
      expect(JSON.stringify(demo(3))).toBe(JSON.stringify(demo(3)));
      expect(isEmptyData(demo(7), shape)).toBe(false);
    });
  }

  it('forecast carries history points, forward forecast points and a widening band', () => {
    const demo = chartForecastDemoData(5);
    expect(demo.points.length).toBeGreaterThan(0);
    expect(demo.forecast.length).toBe(demo.band.length);
    const w0 = demo.band[0]!.hi - demo.band[0]!.lo;
    const wN = demo.band.at(-1)!.hi - demo.band.at(-1)!.lo;
    expect(wN).toBeGreaterThan(w0);
  });

  it('candlestick emits ordered OHLC candles with h ≥ max(o,c) and l ≤ min(o,c)', () => {
    const { candles } = chartCandlestickDemoData(9);
    expect(candles.length).toBe(48);
    for (const candle of candles) {
      expect(candle.h).toBeGreaterThanOrEqual(Math.max(candle.o, candle.c));
      expect(candle.l).toBeLessThanOrEqual(Math.min(candle.o, candle.c));
    }
  });

  it('bump ranks are a 1…N permutation per period', () => {
    const { series } = chartBumpDemoData(4);
    const periods = series[0]!.points.length;
    for (let p = 0; p < periods; p += 1) {
      const ranks = series.map((s) => s.points[p]!.v).sort((a, b) => a - b);
      expect(ranks).toEqual([1, 2, 3, 4, 5]);
    }
  });

  it('timeline-lanes events are date-sorted with lane categories', () => {
    const { events } = chartTimelineLanesDemoData(2);
    expect(events.length).toBeGreaterThan(0);
    for (let i = 1; i < events.length; i += 1) {
      expect(events[i - 1]!.date <= events[i]!.date).toBe(true);
    }
    expect(new Set(events.map((e) => e.category))).toEqual(new Set(['Deploys', 'Incidents', 'Releases']));
  });

  it('empty envelopes read as empty for their contract', () => {
    expect(isEmptyData({ series: [] }, 'multi-timeseries')).toBe(true);
    expect(isEmptyData({ points: [] }, 'timeseries')).toBe(true);
    expect(isEmptyData({ candles: [] }, 'ohlc')).toBe(true);
    expect(isEmptyData({ events: [] }, 'calendar-events')).toBe(true);
  });
});
