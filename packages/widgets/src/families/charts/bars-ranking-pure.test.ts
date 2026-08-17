// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pure contract for the "bars & ranking" widget group (04-T09): config-schema
 * defaults + per-widget empty copy, §3 envelope narrowing, deterministic demo
 * payloads, and registry metadata (ids/sizing/contract). No rendering — this
 * runs in the node env, independent of the @adminium/charts build.
 */
import { describe, expect, it } from 'vitest';

import {
  chartBulletConfigSchema,
  chartMarimekkoConfigSchema,
  chartParetoConfigSchema,
  chartRankingBarsConfigSchema,
  chartSlopeConfigSchema,
  chartStackedBar100ConfigSchema,
  chartWaterfallConfigSchema,
} from './bars-ranking-config.js';
import { asBulletRows, asMatrix, asSlopeRecords, asWaterfallSteps, recordRows } from './bars-ranking-shapes.js';
import {
  bulletDemoData,
  marimekkoDemoData,
  paretoDemoData,
  rankingDemoData,
  slopeDemoData,
  stackedBar100DemoData,
  waterfallDemoData,
} from './bars-ranking-demo.js';
import { barsRankingChartDefinitions } from './bars-ranking-definitions.js';
import { isEmptyData } from '../../registry/data-empty.js';
import { buildRegistry } from '../../registry/index.js';

const schemas = [
  chartBulletConfigSchema,
  chartRankingBarsConfigSchema,
  chartParetoConfigSchema,
  chartWaterfallConfigSchema,
  chartMarimekkoConfigSchema,
  chartStackedBar100ConfigSchema,
  chartSlopeConfigSchema,
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
    expect(chartBulletConfigSchema.parse({}).emptyState?.titleKey).toBe('widgets.charts.bullet.emptyTitle');
    expect(chartRankingBarsConfigSchema.parse({}).emptyState?.titleKey).toBe('widgets.charts.rankingBars.emptyTitle');
  });

  it('applies field defaults (pareto cutline, ranking n)', () => {
    expect(chartParetoConfigSchema.parse({}).cutline).toBe(0.8);
    expect(chartParetoConfigSchema.parse({ cutline: null }).cutline).toBeNull();
    expect(chartRankingBarsConfigSchema.parse({}).n).toBe(6);
  });
});

describe('envelope narrowers', () => {
  it('recordRows reads both `rows` and `data`', () => {
    expect(recordRows({ rows: [{ a: 1 }] })).toEqual([{ a: 1 }]);
    expect(recordRows({ data: [{ a: 1 }] })).toEqual([{ a: 1 }]);
    expect(recordRows({ items: [] })).toBeNull();
    expect(recordRows(42)).toBeNull();
  });

  it('asBulletRows requires label/measure/target; coerces numeric strings', () => {
    const rows = asBulletRows({ rows: [{ label: 'Rev', measure: '60', target: 80, max: 100, bandCutoffs: [40, 75] }] });
    expect(rows).toEqual([{ label: 'Rev', measure: 60, target: 80, max: 100, bandCutoffs: [40, 75] }]);
    expect(asBulletRows({ rows: [{ label: 'x', measure: 1 }] })).toBeNull();
    expect(asBulletRows({ rows: [] })).toBeNull();
  });

  it('asWaterfallSteps defaults unknown type to up', () => {
    const steps = asWaterfallSteps({ rows: [{ label: 'S', value: 10, type: 'weird' }] });
    expect(steps).toEqual([{ label: 'S', value: 10, type: 'up' }]);
    expect(asWaterfallSteps({ rows: [{ label: 'D', value: 5, type: 'down' }] })?.[0]?.type).toBe('down');
  });

  it('asSlopeRecords requires a and b', () => {
    expect(asSlopeRecords({ rows: [{ label: 'Free', a: 40, b: 20 }] })).toEqual([{ label: 'Free', a: 40, b: 20 }]);
    expect(asSlopeRecords({ rows: [{ label: 'x', a: 1 }] })).toBeNull();
  });

  it('asMatrix reads rowKeys/colKeys/cells and coerces cells', () => {
    const matrix = asMatrix({ rowKeys: ['P'], colKeys: ['R1', 'R2'], cells: [[1, '2']] });
    expect(matrix).toEqual({ rowKeys: ['P'], colKeys: ['R1', 'R2'], cells: [[1, 2]] });
    expect(asMatrix({ rowKeys: [], colKeys: [], cells: [] })).toBeNull();
  });
});

describe('demo payloads', () => {
  const cases = [
    ['bullet', bulletDemoData, 'record-list'],
    ['ranking', rankingDemoData, 'categorical'],
    ['pareto', paretoDemoData, 'categorical'],
    ['waterfall', waterfallDemoData, 'record-list'],
    ['marimekko', marimekkoDemoData, 'matrix'],
    ['stacked', stackedBar100DemoData, 'categorical'],
    ['slope', slopeDemoData, 'record-list'],
  ] as const;

  it('are deterministic per seed and vary across seeds', () => {
    for (const [, generator] of cases) {
      expect(generator(11)).toEqual(generator(11));
      expect(generator(11)).not.toEqual(generator(12));
    }
  });

  it('match their declared §3 envelope and read as non-empty', () => {
    for (const [name, generator, shape] of cases) {
      const payload = generator(7) as unknown as Record<string, unknown>;
      if (shape === 'record-list') {
        expect(Array.isArray(payload.rows), name).toBe(true);
        expect(payload.total).toBe((payload.rows as unknown[]).length);
      } else if (shape === 'categorical') {
        expect(Array.isArray(payload.items), name).toBe(true);
      } else {
        expect(Array.isArray(payload.rowKeys), name).toBe(true);
        expect(Array.isArray(payload.cells), name).toBe(true);
      }
      expect(isEmptyData(payload, shape), name).toBe(false);
    }
  });

  it('narrowers round-trip the demo envelopes', () => {
    expect(asBulletRows(bulletDemoData(3))).not.toBeNull();
    expect(asWaterfallSteps(waterfallDemoData(3))).not.toBeNull();
    expect(asSlopeRecords(slopeDemoData(3))).not.toBeNull();
    expect(asMatrix(marimekkoDemoData(3))).not.toBeNull();
  });
});

describe('registry metadata', () => {
  const byId = new Map(barsRankingChartDefinitions.map((d) => [d.id, d]));

  it('registers exactly the seven annex ids, all in the charts family', () => {
    expect([...byId.keys()]).toEqual([
      'chart-bullet',
      'chart-ranking-bars',
      'chart-pareto',
      'chart-waterfall',
      'chart-marimekko',
      'chart-stacked-bar-100',
      'chart-slope',
    ]);
    for (const definition of barsRankingChartDefinitions) expect(definition.family).toBe('charts');
    expect(() => buildRegistry(barsRankingChartDefinitions)).not.toThrow();
  });

  it('uses chart skeletons, grid placement, PNG export, and annex sizing (half-units)', () => {
    for (const definition of barsRankingChartDefinitions) {
      expect(definition.skeleton).toBe('chart');
      expect(definition.placement).toBe('grid');
      expect(definition.capabilities?.exportPng).toBe(true);
    }
    expect(byId.get('chart-ranking-bars')?.sizing).toEqual({ minW: 3, minH: 4, defaultW: 3, defaultH: 6 });
    // minH is 4, not the annex's 2: see the sizing comment on the definition and
    // qa/chart-legibility-floor.test.ts — 2 half-units is 80px, below the card's
    // own chrome, and minW is inert on the single-column mobile grid.
    expect(byId.get('chart-stacked-bar-100')?.sizing).toEqual({ minW: 3, minH: 4, defaultW: 4, defaultH: 4 });
    expect(byId.get('chart-slope')?.sizing).toEqual({ minW: 4, minH: 6, defaultW: 6, defaultH: 6 });
  });

  it('maps each id to its §3 data contract', () => {
    expect(byId.get('chart-bullet')?.dataContract).toBe('record-list');
    expect(byId.get('chart-ranking-bars')?.dataContract).toBe('categorical');
    expect(byId.get('chart-marimekko')?.dataContract).toBe('matrix');
    expect(byId.get('chart-waterfall')?.dataContract).toBe('record-list');
    expect(byId.get('chart-slope')?.dataContract).toBe('record-list');
  });

  it('demoData on each definition is deterministic', () => {
    for (const definition of barsRankingChartDefinitions) {
      expect(definition.demoData(9)).toEqual(definition.demoData(9));
    }
  });
});
