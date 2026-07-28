/**
 * Registry-metadata + mapping tests for the part-to-whole & hierarchy charts
 * (04-T09). Kept free of the @adminium/charts chart primitives (they load
 * lazily through PartWholeWidgets.tsx) so this suite collects against the
 * built barrel: it exercises definitions, config schemas + per-widget empty
 * copy, deterministic demoData against the declared §3 contract, the pure
 * config→primitive mappings, and the isEmpty predicates.
 */
import { describe, expect, it } from 'vitest';

import { isEmptyData } from '../../registry/data-empty.js';
import type { DataShape } from '../../page-config/index.js';
import { asFlows, asMatrix, asTwoLevelTree } from './part-whole-shapes.js';
import {
  chartChordConfigSchema,
  chartFunnelConfigSchema,
  chartRadarConfigSchema,
  chartRadialBarConfigSchema,
  chartSunburstConfigSchema,
  chartTreemapConfigSchema,
  chartWordcloudConfigSchema,
  chordDemoData,
  chordInputsOf,
  funnelDemoData,
  funnelInputsOf,
  partWholeChartDefinitions,
  radarDemoData,
  radarInputsOf,
  radialBarDemoData,
  radialBarInputsOf,
  sunburstDemoData,
  sunburstInputsOf,
  treemapDemoData,
  treemapInputsOf,
  wordcloudDemoData,
  wordcloudInputsOf,
} from './def.part-whole.js';

const byId = new Map(partWholeChartDefinitions.map((d) => [d.id, d]));

describe('part-whole chart definitions', () => {
  it('registers the 7 annex ids with grid placement, chart skeleton and PNG export', () => {
    expect(partWholeChartDefinitions.map((d) => d.id)).toEqual([
      'chart-treemap',
      'chart-sunburst',
      'chart-funnel',
      'chart-radial-bar',
      'chart-radar',
      'chart-chord',
      'chart-wordcloud',
    ]);
    for (const def of partWholeChartDefinitions) {
      expect(def.family).toBe('charts');
      expect(def.placement).toBe('grid');
      expect(def.skeleton).toBe('chart');
      expect(def.capabilities?.exportPng).toBe(true);
      expect(def.descriptionKey).toMatch(/^widgets\.charts\./);
    }
  });

  it('declares the annex data contracts and half-unit sizing', () => {
    const contract = (id: string): DataShape | DataShape[] => byId.get(id)!.dataContract;
    expect(contract('chart-treemap')).toBe('categorical');
    expect(contract('chart-sunburst')).toBe('hierarchy/tree');
    expect(contract('chart-funnel')).toBe('categorical');
    expect(contract('chart-radial-bar')).toBe('categorical');
    expect(contract('chart-radar')).toBe('matrix');
    expect(contract('chart-chord')).toBe('flows');
    expect(contract('chart-wordcloud')).toBe('categorical');
    // annex chart-treemap "min 4×3, default 6×3" → half-units minH/defaultH = 6.
    expect(byId.get('chart-treemap')!.sizing).toEqual({ minW: 4, minH: 6, defaultW: 6, defaultH: 6 });
    expect(byId.get('chart-funnel')!.sizing).toEqual({ minW: 3, minH: 4, defaultW: 4, defaultH: 6 });
  });
});

describe('config schemas + per-widget empty copy', () => {
  it('apply annex defaults', () => {
    expect(chartTreemapConfigSchema.parse({}).maxTiles).toBe(12);
    expect(chartFunnelConfigSchema.parse({}).variant).toBe('stepped');
    expect(chartRadialBarConfigSchema.parse({}).maxRings).toBe(4);
    expect(chartRadarConfigSchema.parse({}).levels).toBe(4);
    expect(chartChordConfigSchema.parse({}).nodeLimit).toBe(8);
    expect(chartWordcloudConfigSchema.parse({}).maxTerms).toBe(40);
    expect(chartSunburstConfigSchema.parse({}).size).toBe(220);
  });

  it('each widget carries distinct per-widget empty-state copy keys', () => {
    const titles = [
      chartTreemapConfigSchema.parse({}).emptyState?.titleKey,
      chartSunburstConfigSchema.parse({}).emptyState?.titleKey,
      chartFunnelConfigSchema.parse({}).emptyState?.titleKey,
      chartRadialBarConfigSchema.parse({}).emptyState?.titleKey,
      chartRadarConfigSchema.parse({}).emptyState?.titleKey,
      chartChordConfigSchema.parse({}).emptyState?.titleKey,
      chartWordcloudConfigSchema.parse({}).emptyState?.titleKey,
    ];
    expect(titles).toEqual([
      'widgets.charts.treemap.emptyTitle',
      'widgets.charts.sunburst.emptyTitle',
      'widgets.charts.funnel.emptyTitle',
      'widgets.charts.radialBar.emptyTitle',
      'widgets.charts.radar.emptyTitle',
      'widgets.charts.chord.emptyTitle',
      'widgets.charts.wordcloud.emptyTitle',
    ]);
    expect(new Set(titles).size).toBe(7); // all distinct
  });
});

describe('deterministic demoData matches the declared contract', () => {
  it('is byte-identical for a given seed and non-empty under the contract', () => {
    for (const def of partWholeChartDefinitions) {
      expect(def.demoData(42)).toEqual(def.demoData(42));
      expect(isEmptyData(def.demoData(42), def.dataContract)).toBe(false);
    }
  });

  it('produces the right §3 envelope shape per widget', () => {
    expect(treemapDemoData(1).items.length).toBe(8);
    expect(funnelDemoData(1).items[0]!.value).toBeGreaterThan(funnelDemoData(1).items[4]!.value); // monotone drop
    expect(radialBarDemoData(1).items.length).toBe(4);
    expect(radarDemoData(1).rowKeys.length).toBe(6);
    expect(radarDemoData(1).colKeys).toEqual(['Current', 'Target']);
    expect(chordDemoData(1).nodes.length).toBe(5);
    expect(sunburstDemoData(1).roots.length).toBe(4);
    expect(wordcloudDemoData(1).items.length).toBe(15);
  });
});

describe('config → primitive mappings', () => {
  it('maps categorical envelopes (treemap/funnel/radial/wordcloud)', () => {
    const cat = { items: [{ key: 'a', label: 'A', value: 10 }, { key: 'b', label: 'B', value: 4 }], total: 14 };
    expect(treemapInputsOf(cat)).toEqual([{ label: 'A', value: 10 }, { label: 'B', value: 4 }]);
    expect(funnelInputsOf(cat)?.[0]).toEqual({ label: 'A', value: 10 });
    expect(radialBarInputsOf(cat, 1)).toEqual([{ label: 'A', value: 10 }]); // maxRings cap
    expect(wordcloudInputsOf(cat, 5)).toEqual([{ term: 'A', weight: 10 }, { term: 'B', weight: 4 }]);
    expect(treemapInputsOf({ items: [] })).toBeNull();
    expect(treemapInputsOf({ nope: true })).toBeNull();
  });

  it('maps matrix → radar axes + series, flows → chord nodes/links, tree → sunburst', () => {
    const radar = radarInputsOf({ rowKeys: ['Speed', 'Cost'], colKeys: ['Cur', 'Tgt'], cells: [[80, 90], [40, 50]] });
    expect(radar?.axes).toEqual(['Speed', 'Cost']);
    expect(radar?.series).toEqual([
      { label: 'Cur', values: [80, 40] },
      { label: 'Tgt', values: [90, 50] },
    ]);
    expect(radarInputsOf({ rowKeys: [], colKeys: [], cells: [] })).toBeNull();

    const chord = chordInputsOf(
      { nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }], links: [{ from: 'a', to: 'b', weight: 3 }, { from: 'a', to: 'c', weight: 2 }] },
      2,
    );
    expect(chord?.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(chord?.links).toEqual([{ from: 'a', to: 'b', weight: 3 }]); // link to dropped node 'c' removed
    expect(chordInputsOf({ nodes: 'no', links: [] }, 8)).toBeNull();

    const tree = sunburstInputsOf({ roots: [{ id: 'p', label: 'P', children: [{ id: 'c', label: 'C', value: 5 }] }] });
    expect(tree).toEqual([{ label: 'P', children: [{ label: 'C', value: 5 }] }]);
    expect(sunburstInputsOf({ roots: [] })).toBeNull();
  });

  it('narrowing helpers tolerate malformed payloads', () => {
    expect(asMatrix(null)).toBeNull();
    expect(asMatrix({ rowKeys: ['a'], colKeys: ['b'], cells: [['x']] })).toEqual({ rowKeys: ['a'], colKeys: ['b'], cells: [[null]] });
    expect(asFlows({ nodes: [{ id: 'a' }], links: [] })).toEqual({ nodes: [{ id: 'a', label: 'a' }], links: [] });
    expect(asFlows({ nodes: [{ label: 'no-id' }], links: [] })).toBeNull();
    expect(asTwoLevelTree({ roots: [{ label: 'p', children: [{ label: 'c', meta: { value: 7 } }] }] })).toEqual([
      { label: 'p', children: [{ label: 'c', value: 7 }] },
    ]);
  });
});

describe('isEmpty predicates for the declared contracts', () => {
  it('treats empty §3 envelopes as empty', () => {
    expect(isEmptyData({ items: [] }, 'categorical')).toBe(true);
    expect(isEmptyData({ rowKeys: [], colKeys: [], cells: [] }, 'matrix')).toBe(true);
    expect(isEmptyData({ nodes: [], links: [] }, 'flows')).toBe(true);
    expect(isEmptyData({ roots: [] }, 'hierarchy/tree')).toBe(true);
  });
});
