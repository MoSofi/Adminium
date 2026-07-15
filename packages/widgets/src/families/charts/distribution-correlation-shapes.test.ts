/**
 * Distribution & correlation group — metadata + data layer (04-T09). Verifies
 * the pieces that don't need the family component chunk: §3 envelope narrowing,
 * config-schema defaults, deterministic demo payloads, per-shape emptiness, and
 * the registry definitions (annex ids, half-unit sizing, contracts). Wrapper
 * render behaviour lives in distribution-correlation-widgets.test.tsx.
 */
import { describe, expect, it } from 'vitest';

import { isEmptyData } from '../../registry/data-empty.js';
import {
  asDistribution,
  asMatrix,
  asRecordList,
  boxplotDemoData,
  chartBoxplotConfigSchema,
  chartParallelCoordinatesConfigSchema,
  chartScatterBubbleConfigSchema,
  correlationDemoData,
  hexbinDemoData,
  parallelDemoData,
  ridgelineDemoData,
  scatterDemoData,
  violinDemoData,
} from './distributionShapes.js';
import { distributionCorrelationChartDefinitions } from './definitions.distribution-correlation.js';

describe('narrowing guards', () => {
  it('asDistribution reads quantiles + optional density, rejects malformed', () => {
    const d = asDistribution({
      groups: [{ key: 'na', label: 'NA', min: 0, q1: 10, med: 20, q3: 30, max: 40, density: [1, 2] }],
    });
    expect(d?.groups[0]).toEqual({ key: 'na', label: 'NA', min: 0, q1: 10, med: 20, q3: 30, max: 40, density: [1, 2] });
    expect(asDistribution({ groups: 'no' })).toBeNull();
    expect(asDistribution(null)).toBeNull();
  });

  it('asMatrix coerces numeric/null cells, rejects malformed', () => {
    const m = asMatrix({ rowKeys: ['a'], colKeys: ['x', 'y'], cells: [[0.5, null]] });
    expect(m?.cells).toEqual([[0.5, null]]);
    expect(asMatrix({ rowKeys: ['a'], colKeys: ['x'], cells: 'no' })).toBeNull();
  });

  it('asRecordList collects rows and defaults total to row count', () => {
    const l = asRecordList({ rows: [{ x: 1 }, { x: 2 }] });
    expect(l?.rows).toHaveLength(2);
    expect(l?.total).toBe(2);
    expect(asRecordList({ rows: 'no' })).toBeNull();
  });
});

describe('config schema defaults', () => {
  it('boxplot / scatter / parallel carry annex-aligned defaults', () => {
    expect(chartBoxplotConfigSchema.parse({}).showAxis).toBe(true);
    const scatter = chartScatterBubbleConfigSchema.parse({});
    expect(scatter.xField).toBe('team_size');
    expect(scatter.yField).toBe('revenue');
    expect(scatter.trendLine).toBe(true);
    expect(chartParallelCoordinatesConfigSchema.parse({}).axes).toEqual(['speed', 'reach', 'cost', 'roi']);
  });

  it('parallel requires at least two axes', () => {
    expect(() => chartParallelCoordinatesConfigSchema.parse({ axes: ['only'] })).toThrow();
  });
});

describe('deterministic demo payloads (byte-stable per seed)', () => {
  it('distribution generators are stable and shaped', () => {
    expect(boxplotDemoData(7)).toEqual(boxplotDemoData(7));
    const box = boxplotDemoData(7);
    expect(box.groups).toHaveLength(4);
    for (const g of box.groups) {
      expect(g.min).toBeLessThanOrEqual(g.q1);
      expect(g.q1).toBeLessThanOrEqual(g.med);
      expect(g.med).toBeLessThanOrEqual(g.q3);
      expect(g.q3).toBeLessThanOrEqual(g.max);
    }
    const violin = violinDemoData(7);
    expect(violin).toEqual(violinDemoData(7));
    expect(violin.groups[0]?.density?.length).toBe(16);
    const ridge = ridgelineDemoData(7);
    expect(ridge).toEqual(ridgelineDemoData(7));
    expect(ridge.groups).toHaveLength(5);
    expect(ridge.groups[0]?.density?.length).toBe(24);
  });

  it('matrix generators are stable, symmetric (correlation) and sparse (hexbin)', () => {
    const corr = correlationDemoData(3);
    expect(corr).toEqual(correlationDemoData(3));
    expect(corr.cells[0]?.[0]).toBe(1);
    // Symmetric off-diagonal.
    expect(corr.cells[0]?.[1]).toBe(corr.cells[1]?.[0]);
    const hex = hexbinDemoData(3);
    expect(hex).toEqual(hexbinDemoData(3));
    expect(hex.cells.some((row) => row.some((c) => c === null))).toBe(true);
  });

  it('record-list generators are stable and carry the mapped fields', () => {
    const scatter = scatterDemoData(5);
    expect(scatter).toEqual(scatterDemoData(5));
    expect(scatter.total).toBe(scatter.rows.length);
    expect(scatter.rows[0]).toHaveProperty('team_size');
    expect(scatter.rows[0]).toHaveProperty('revenue');
    const parallel = parallelDemoData(5);
    expect(parallel).toEqual(parallelDemoData(5));
    expect(parallel.rows[0]).toHaveProperty('speed');
    expect(parallel.rows[0]).toHaveProperty('segment');
  });
});

describe('emptiness against the declared contract', () => {
  it('non-empty demo payloads are not empty; empty envelopes are', () => {
    for (const def of distributionCorrelationChartDefinitions) {
      const demo = def.demoData(1);
      expect(isEmptyData(demo, def.dataContract), `${def.id} demo not empty`).toBe(false);
    }
    expect(isEmptyData({ groups: [] }, 'distribution')).toBe(true);
    expect(isEmptyData({ rowKeys: [], colKeys: [], cells: [] }, 'matrix')).toBe(true);
    expect(isEmptyData({ rows: [], total: 0 }, 'record-list')).toBe(true);
  });
});

describe('registry definitions', () => {
  it('registers the seven annex ids with half-unit sizing and contracts', () => {
    expect(distributionCorrelationChartDefinitions.map((d) => d.id)).toEqual([
      'chart-boxplot',
      'chart-violin',
      'chart-ridgeline',
      'chart-scatter-bubble',
      'chart-hexbin',
      'chart-correlation-matrix',
      'chart-parallel-coordinates',
    ]);
    const byId = new Map(distributionCorrelationChartDefinitions.map((d) => [d.id, d]));
    expect(byId.get('chart-boxplot')?.dataContract).toBe('distribution');
    expect(byId.get('chart-hexbin')?.dataContract).toBe('matrix');
    expect(byId.get('chart-scatter-bubble')?.dataContract).toBe('record-list');
    // annex 6×3 → { defaultW: 6, defaultH: 6 }; parallel min 6×3.
    expect(byId.get('chart-boxplot')?.sizing).toEqual({ minW: 4, minH: 6, defaultW: 6, defaultH: 6 });
    expect(byId.get('chart-parallel-coordinates')?.sizing.minW).toBe(6);
    for (const def of distributionCorrelationChartDefinitions) {
      expect(def.family).toBe('charts');
      expect(def.placement).toBe('grid');
      expect(def.skeleton).toBe('chart');
      expect(def.capabilities?.exportPng).toBe(true);
    }
  });
});
