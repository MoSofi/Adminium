/**
 * Pure contract for the "time, forecast & flow" widget group (04-T09): config-
 * schema defaults + per-widget empty copy, §3 envelope narrowing, deterministic
 * demo payloads, and registry metadata (ids/sizing/contract/skeleton/export).
 * No rendering — this runs in the node env, independent of the @adminium/charts
 * build. The isolated pure modules also have dedicated tests (time-flow-meta,
 * time-flow-adapters); this file ties them to the registry `WidgetDefinition`s.
 */
import { describe, expect, it } from 'vitest';

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
  toBumpInputs,
  toCandles,
  toForecastInputs,
  toLaneInputs,
  toTimeSeriesGroup,
} from './time-flow-adapters.js';
import {
  chartAnomalyDemoData,
  chartBumpDemoData,
  chartCandlestickDemoData,
  chartForecastDemoData,
  chartMultilineDemoData,
  chartStreamDemoData,
  chartTimelineLanesDemoData,
} from './time-flow-demo.js';
import { timeFlowChartDefinitions } from './time-flow-definitions.js';
import { isEmptyData } from '../../registry/data-empty.js';
import { buildRegistry } from '../../registry/index.js';

const schemas = [
  chartMultilineConfigSchema,
  chartStreamConfigSchema,
  chartForecastConfigSchema,
  chartAnomalyConfigSchema,
  chartCandlestickConfigSchema,
  chartBumpConfigSchema,
  chartTimelineLanesConfigSchema,
];

describe('config schemas', () => {
  it('every schema accepts {} and applies shared-config defaults', () => {
    for (const schema of schemas) expect(schema.safeParse({}).success).toBe(true);
  });

  it('each carries per-widget empty copy (04 §4)', () => {
    for (const schema of schemas) {
      const parsed = schema.parse({});
      expect(typeof parsed.emptyState?.titleKey).toBe('string');
      expect(typeof parsed.emptyState?.bodyKey).toBe('string');
    }
    expect(chartMultilineConfigSchema.parse({}).emptyState?.titleKey).toBe(
      'widgets.charts.multiline.emptyTitle',
    );
    expect(chartTimelineLanesConfigSchema.parse({}).emptyState?.titleKey).toBe(
      'widgets.charts.timelineLanes.emptyTitle',
    );
  });

  it('applies field defaults (forecast horizon/confidence/method, candlestick candleCount)', () => {
    expect(chartForecastConfigSchema.parse({})).toMatchObject({ horizon: 12, confidence: 0.9, method: 'provided' });
    expect(chartAnomalyConfigSchema.parse({}).sensitivity).toBe(2);
    expect(chartCandlestickConfigSchema.parse({}).candleCount).toBe(40);
  });
});

describe('envelope narrowers round-trip the demo payloads', () => {
  it('narrows each group envelope to primitive inputs', () => {
    expect(toTimeSeriesGroup(chartMultilineDemoData(3))).not.toBeNull();
    expect(toTimeSeriesGroup(chartStreamDemoData(3))).not.toBeNull();
    expect(toForecastInputs(chartForecastDemoData(3))).not.toBeNull();
    expect(toCandles(chartCandlestickDemoData(3))).not.toBeNull();
    expect(toBumpInputs(chartBumpDemoData(3))).not.toBeNull();
    expect(toLaneInputs(chartTimelineLanesDemoData(3))).not.toBeNull();
  });

  it('returns null on malformed payloads (renders its own fallback, never throws)', () => {
    expect(toTimeSeriesGroup({ series: [] })).toBeNull();
    expect(toForecastInputs({ forecast: [] })).toBeNull();
    expect(toCandles({ candles: [] })).toBeNull();
    expect(toLaneInputs({ events: [] })).toBeNull();
  });
});

describe('demo payloads', () => {
  const cases = [
    ['multiline', chartMultilineDemoData, 'multi-timeseries'],
    ['stream', chartStreamDemoData, 'multi-timeseries'],
    ['forecast', chartForecastDemoData, 'timeseries'],
    ['anomaly', chartAnomalyDemoData, 'timeseries'],
    ['candlestick', chartCandlestickDemoData, 'ohlc'],
    ['bump', chartBumpDemoData, 'multi-timeseries'],
    ['timelineLanes', chartTimelineLanesDemoData, 'calendar-events'],
  ] as const;

  it('are byte-identical across two calls and vary across seeds', () => {
    for (const [, generator] of cases) {
      // Byte-identical across two independent calls with the same seed.
      expect(JSON.stringify(generator(11))).toBe(JSON.stringify(generator(11)));
      expect(generator(11)).toEqual(generator(11));
      expect(generator(11)).not.toEqual(generator(12));
    }
  });

  it('match their declared §3 envelope and read as non-empty', () => {
    for (const [name, generator, shape] of cases) {
      expect(isEmptyData(generator(7), shape), name).toBe(false);
    }
  });
});

describe('registry metadata', () => {
  const byId = new Map(timeFlowChartDefinitions.map((d) => [d.id, d]));

  it('registers exactly the seven annex ids, all in the charts family', () => {
    expect([...byId.keys()]).toEqual([
      'chart-multiline',
      'chart-stream',
      'chart-forecast',
      'chart-anomaly',
      'chart-candlestick',
      'chart-bump',
      'chart-timeline-lanes',
    ]);
    for (const definition of timeFlowChartDefinitions) expect(definition.family).toBe('charts');
    expect(() => buildRegistry(timeFlowChartDefinitions)).not.toThrow();
  });

  it('uses chart skeletons, grid placement, PNG export, and annex sizing (half-units)', () => {
    for (const definition of timeFlowChartDefinitions) {
      expect(definition.skeleton).toBe('chart');
      expect(definition.placement).toBe('grid');
      expect(definition.capabilities?.exportPng).toBe(true);
    }
    expect(byId.get('chart-multiline')?.sizing).toEqual({ minW: 4, minH: 4, defaultW: 6, defaultH: 6 });
    expect(byId.get('chart-forecast')?.sizing).toEqual({ minW: 6, minH: 6, defaultW: 8, defaultH: 6 });
    expect(byId.get('chart-anomaly')?.sizing).toEqual({ minW: 6, minH: 4, defaultW: 8, defaultH: 4 });
    expect(byId.get('chart-timeline-lanes')?.sizing).toEqual({ minW: 6, minH: 4, defaultW: 8, defaultH: 4 });
  });

  it('maps each id to its §3 data contract', () => {
    expect(byId.get('chart-multiline')?.dataContract).toBe('multi-timeseries');
    expect(byId.get('chart-stream')?.dataContract).toBe('multi-timeseries');
    expect(byId.get('chart-forecast')?.dataContract).toBe('timeseries');
    expect(byId.get('chart-anomaly')?.dataContract).toBe('timeseries');
    expect(byId.get('chart-candlestick')?.dataContract).toBe('ohlc');
    expect(byId.get('chart-bump')?.dataContract).toBe('multi-timeseries');
    expect(byId.get('chart-timeline-lanes')?.dataContract).toBe('calendar-events');
  });

  it('demoData on each definition is deterministic (byte-identical across two calls)', () => {
    for (const definition of timeFlowChartDefinitions) {
      expect(definition.demoData(9)).toEqual(definition.demoData(9));
      expect(JSON.stringify(definition.demoData(9))).toBe(JSON.stringify(definition.demoData(9)));
    }
  });
});
