/**
 * Pure-geometry tests for the part-to-whole & hierarchy charts (04-T09):
 * determinism (same input → byte-identical output, proving Node-vs-browser
 * parity for report rasterization), golden path/coordinate strings for the
 * core geometry, empty/edge predicates, and the RTL mirroring policy (§7.4).
 * Runs in the default `node` environment — no DOM.
 */
import { describe, expect, it } from 'vitest';

import { mirrorTiles, treemapTiles } from './treemap.js';
import { funnelLayout } from './funnel.js';
import { radialBarRings } from './radialBar.js';
import { radarLayout } from './radar.js';
import { adjacencyMatrix, chordLayout } from './chord.js';
import { sunburstArcs } from './sunburst.js';
import { wordCloudLayout } from './wordcloud.js';

const round = (n: number): number => Math.round(n);

describe('treemap geometry', () => {
  const input = [
    { label: 'A', value: 50 },
    { label: 'B', value: 30 },
    { label: 'C', value: 15 },
    { label: 'D', value: 5 },
  ];

  it('squarifies into one tile per category, shares summing to 1 (golden coords)', () => {
    const tiles = treemapTiles(input, { width: 300, height: 200 });
    expect(tiles.map((t) => [t.label, round(t.x), round(t.y), round(t.width), round(t.height)])).toEqual([
      ['A', 0, 0, 150, 200],
      ['B', 150, 0, 150, 120],
      ['C', 150, 120, 113, 80],
      ['D', 263, 120, 38, 80],
    ]);
    expect(tiles.reduce((s, t) => s + t.share, 0)).toBeCloseTo(1, 6);
    expect(tiles[0]?.colorVar).toBe('var(--viz-1)');
    // Largest tile gets the strongest alpha ramp step.
    expect(tiles[0]?.rampVar).toBe('var(--viz-ramp-6)');
    expect(tiles[3]?.rampVar).toBe('var(--viz-ramp-1)');
  });

  it('is deterministic and folds overflow into an "Other" tile', () => {
    expect(treemapTiles(input, { width: 300, height: 200 })).toEqual(
      treemapTiles(input, { width: 300, height: 200 }),
    );
    const folded = treemapTiles(input, { width: 300, height: 200, maxTiles: 2, otherLabel: 'Rest' });
    expect(folded.map((t) => t.label).sort()).toEqual(['A', 'B', 'Rest']);
    expect(folded.find((t) => t.label === 'Rest')?.value).toBe(20);
  });

  it('mirrors tiles across the vertical axis in RTL and drops non-positive/empty', () => {
    const tiles = treemapTiles(input, { width: 300, height: 200 });
    const mirrored = mirrorTiles(tiles, 300);
    const a = tiles[0];
    const aM = mirrored[0];
    expect(aM?.x).toBeCloseTo(300 - (a?.x ?? 0) - (a?.width ?? 0), 6);
    expect(treemapTiles([{ label: 'x', value: 0 }], { width: 100, height: 100 })).toEqual([]);
    expect(treemapTiles(input, { width: 0, height: 200 })).toEqual([]);
  });
});

describe('funnel geometry', () => {
  const input = [
    { label: 'Visit', value: 1000 },
    { label: 'Signup', value: 400 },
    { label: 'Paid', value: 120 },
  ];

  it('computes width fractions, overall/step percents and conversion (golden)', () => {
    const { stages, overallConversion } = funnelLayout(input);
    expect(stages.map((s) => [s.label, s.widthFrac, round(s.overallPct), round(s.stepPct)])).toEqual([
      ['Visit', 1, 100, 100],
      ['Signup', 0.4, 40, 40],
      ['Paid', 0.12, 12, 30],
    ]);
    expect(round(overallConversion)).toBe(12);
    // Centered offsets shrink as the funnel narrows.
    expect(stages[0]?.offsetFrac).toBeCloseTo(0, 6);
    expect(stages[2]?.offsetFrac).toBeCloseTo(0.44, 6);
    // Fading accent-alpha ramp down the stages.
    expect(stages.map((s) => s.colorVar)).toEqual(['var(--viz-ramp-6)', 'var(--viz-ramp-4)', 'var(--viz-ramp-2)']);
  });

  it('is deterministic and empty when the head stage is non-positive', () => {
    expect(funnelLayout(input)).toEqual(funnelLayout(input));
    expect(funnelLayout([{ label: 'x', value: 0 }])).toEqual({ stages: [], overallConversion: 0 });
    expect(funnelLayout([])).toEqual({ stages: [], overallConversion: 0 });
  });
});

describe('radial-bar geometry', () => {
  const input = [
    { label: 'Desktop', value: 62 },
    { label: 'Mobile', value: 30 },
    { label: 'Tablet', value: 8 },
  ];

  it('lays out concentric rings outside-in with a golden value-arc path', () => {
    const rings = radialBarRings(input, { size: 160 });
    expect(rings.map((r) => [r.label, round(r.radius), r.fraction, r.colorVar])).toEqual([
      ['Desktop', 74, 0.62, 'var(--viz-1)'],
      ['Mobile', 56, 0.3, 'var(--viz-2)'],
      ['Tablet', 38, 0.08, 'var(--viz-3)'],
    ]);
    // Golden arc for the first ring — sweeps clockwise from 12 o'clock.
    expect(radialBarRings([{ label: 'Desktop', value: 62 }], { size: 160 })[0]?.valuePath).toBe(
      'M0,-73.756A6,6,0,0,1,6.486,-79.737A80,80,0,1,1,-49.855,62.566A6,6,0,0,1,-50.49,53.766L-50.49,53.766A6,6,0,0,1,-42.377,53.181A68,68,0,1,0,5.514,-67.776A6,6,0,0,1,0,-73.756Z',
    );
  });

  it('clamps percents, empties the value arc at 0%, and is deterministic', () => {
    const rings = radialBarRings([{ label: 'z', value: 0 }, { label: 'over', value: 250 }], { size: 120 });
    expect(rings[0]?.valuePath).toBe('');
    expect(rings[1]?.fraction).toBe(1);
    expect(radialBarRings(input, { size: 160 })).toEqual(radialBarRings(input, { size: 160 }));
    expect(radialBarRings([], { size: 160 })).toEqual([]);
  });
});

describe('radar geometry', () => {
  const axes = ['Speed', 'Power', 'Range', 'Cost', 'UX'];
  const series = [{ label: 'Current', values: [80, 60, 90, 40, 70] }];

  it('places the first axis at 12 o’clock and normalizes the series (golden polygon)', () => {
    const layout = radarLayout(axes, series, { size: 200 });
    expect(layout.axes[0]?.label).toBe('Speed');
    expect([round(layout.axes[0]?.point.x ?? 0), round(layout.axes[0]?.point.y ?? 0)]).toEqual([100, 0]);
    expect(layout.max).toBe(90);
    expect(layout.series[0]?.path).toBe(
      'M100.000,11.111L163.404,79.399L158.779,180.902L73.876,135.956L26.029,75.965Z',
    );
    expect(layout.rings).toHaveLength(4);
  });

  it('mirrors axis order in RTL (second axis moves to the opposite side)', () => {
    const ltr = radarLayout(axes, series, { size: 200, rtl: false });
    const rtl = radarLayout(axes, series, { size: 200, rtl: true });
    expect(ltr.axes[0]?.point.x).toBeCloseTo(rtl.axes[0]?.point.x ?? 0, 6); // top axis unchanged
    expect(Math.sign((ltr.axes[1]?.point.x ?? 0) - 100)).toBe(-Math.sign((rtl.axes[1]?.point.x ?? 0) - 100));
    expect(radarLayout(['A', 'B'], series, { size: 200 }).axes).toEqual([]); // <3 axes
  });
});

describe('chord geometry', () => {
  const nodes = [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
    { id: 'c', label: 'C' },
  ];
  const links = [
    { from: 'a', to: 'b', weight: 10 },
    { from: 'a', to: 'c', weight: 5 },
    { from: 'b', to: 'c', weight: 8 },
  ];

  it('builds a symmetric adjacency matrix and weight-sized node arcs (golden)', () => {
    const matrix = adjacencyMatrix(['a', 'b', 'c'], links);
    expect(matrix).toEqual([
      [0, 10, 5],
      [10, 0, 8],
      [5, 8, 0],
    ]);
    const layout = chordLayout(nodes, matrix, { size: 200 });
    expect(layout.arcs.map((arc) => [arc.id, round(arc.total)])).toEqual([
      ['a', 15],
      ['b', 18],
      ['c', 13],
    ]);
    expect(layout.arcs[0]?.path).toBe('M2,-99.98A100,100,0,0,1,89.652,44.3L78.894,38.984A88,88,0,0,0,1.76,-87.982Z');
    expect(layout.ribbons).toHaveLength(3);
    expect(layout.ribbons[0]?.path).toBe('M175.209,54.309Q100.000,100.000 88.245,187.211');
  });

  it('is deterministic and empty for <2 nodes', () => {
    const matrix = adjacencyMatrix(['a', 'b', 'c'], links);
    expect(chordLayout(nodes, matrix, { size: 200 })).toEqual(chordLayout(nodes, matrix, { size: 200 }));
    expect(chordLayout([{ id: 'a', label: 'A' }], [[0]], { size: 200 })).toEqual({
      arcs: [],
      ribbons: [],
      radius: 100,
      center: { x: 100, y: 100 },
    });
  });
});

describe('sunburst geometry', () => {
  const input = [
    { label: 'Direct', children: [{ label: 'Home', value: 30 }, { label: 'Docs', value: 10 }] },
    { label: 'Search', children: [{ label: 'Brand', value: 25 }, { label: 'Generic', value: 35 }] },
  ];

  it('nests parent + child rings with shares over the grand total (golden arc)', () => {
    const { arcs, total } = sunburstArcs(input, { size: 200, innerRadius: 28 });
    expect(total).toBe(100);
    expect(arcs.map((a) => [a.label, a.depth, round(a.share * 100)])).toEqual([
      ['Direct', 0, 40],
      ['Home', 1, 30],
      ['Docs', 1, 10],
      ['Search', 0, 60],
      ['Brand', 1, 25],
      ['Generic', 1, 35],
    ]);
    expect(arcs[0]?.colorVar).toBe('var(--viz-1)');
    expect(arcs[1]?.colorVar).toBe('color-mix(in srgb, var(--viz-1) 62%, var(--surface))');
    expect(arcs[0]?.path).toBe('M0,-64A64,64,0,0,1,37.618,51.777L16.458,22.652A28,28,0,0,0,0,-28Z');
  });

  it('is deterministic and empty for a zero total', () => {
    expect(sunburstArcs(input, { size: 200 })).toEqual(sunburstArcs(input, { size: 200 }));
    expect(sunburstArcs([{ label: 'p', children: [{ label: 'c', value: 0 }] }], { size: 200 })).toEqual({
      arcs: [],
      total: 0,
    });
  });
});

describe('wordcloud geometry', () => {
  const input = [
    { term: 'database', weight: 90 },
    { term: 'schema', weight: 50 },
    { term: 'query', weight: 70 },
    { term: 'index', weight: 30 },
    { term: 'migration', weight: 20 },
  ];

  it('scales font size to weight and flows into wrapped rows (golden)', () => {
    const { tokens } = wordCloudLayout(input, { width: 320 });
    expect(tokens.map((t) => [t.term, t.fontSize])).toEqual([
      ['database', 40],
      ['schema', 25],
      ['query', 32],
      ['index', 17],
      ['migration', 13],
    ]);
    // First term starts at the row origin; a later term wraps to a new baseline.
    expect(round(tokens[0]?.x ?? -1)).toBe(0);
    expect((tokens[2]?.y ?? 0) > (tokens[0]?.y ?? 0)).toBe(true);
    expect(tokens[0]?.colorVar).toBe('var(--viz-1)');
  });

  it('mirrors row start edges in RTL and is deterministic', () => {
    expect(wordCloudLayout(input, { width: 320 })).toEqual(wordCloudLayout(input, { width: 320 }));
    const rtl = wordCloudLayout([{ term: 'database', weight: 90 }, { term: 'schema', weight: 50 }], {
      width: 320,
      rtl: true,
    });
    expect(round(rtl.tokens[0]?.x ?? 0)).toBe(114); // database mirrored from x≈0
    expect(wordCloudLayout([], { width: 320 }).tokens).toEqual([]);
    expect(wordCloudLayout(input, { width: 0 }).tokens).toEqual([]);
  });
});
