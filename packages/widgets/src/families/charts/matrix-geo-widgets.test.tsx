// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * Track E charts family wrapper tests (matrix, calendar & geo-grid): config→
 * chart prop mapping (aria-label from config.title), §3 envelope narrowing,
 * the per-contract empty predicate, deterministic demo payloads matching the
 * declared contracts, and bad-shape fallback.
 */
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isEmptyData } from '../../registry/data-empty.js';
import {
  ChartChoroplethGridWidget,
  ChartCohortMatrixWidget,
  ChartHeatMonthWidget,
  ChartHeatmapCalendarWidget,
  ChartSankeyWidget,
  asFlows,
  asGeoPoints,
  asMatrix,
  chartChoroplethGridConfigSchema,
  chartCohortMatrixConfigSchema,
  chartHeatMonthConfigSchema,
  chartHeatmapCalendarConfigSchema,
  chartSankeyConfigSchema,
} from './MatrixGeoWidgets.js';
import {
  choroplethGridDemoData,
  cohortMatrixDemoData,
  heatCalendarDemoData,
  heatMonthDemoData,
  matrixGeoChartDefinitions,
  sankeyDemoData,
} from './defs.matrix-geo.js';

function installMatchMedia(): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    })),
  );
}

beforeEach(installMatchMedia);
afterEach(() => vi.unstubAllGlobals());

const noop = () => {};

describe('envelope narrowers', () => {
  it('asMatrix coerces cells and rejects non-matrix payloads', () => {
    expect(asMatrix({ rowKeys: ['a'], colKeys: ['M0'], cells: [[42]] })).toEqual({
      rowKeys: ['a'],
      colKeys: ['M0'],
      cells: [[42]],
    });
    expect(asMatrix({ rowKeys: ['a'], colKeys: ['M0'], cells: [['x', null]] })).toEqual({
      rowKeys: ['a'],
      colKeys: ['M0'],
      cells: [[null, null]],
    });
    expect(asMatrix({ nope: true })).toBeNull();
  });

  it('asGeoPoints keeps numeric metric values only', () => {
    const geo = asGeoPoints({ points: [{ code: 'CA', name: 'California', values: { sales: 10, bad: 'x' } }] });
    expect(geo?.points[0]).toEqual({ code: 'CA', name: 'California', values: { sales: 10 } });
    expect(asGeoPoints({})).toBeNull();
  });

  it('asFlows drops malformed nodes/links', () => {
    const flows = asFlows({
      nodes: [{ id: 'a', label: 'A' }, { nope: 1 }],
      links: [{ from: 'a', to: 'b', weight: 5 }, { from: 'a', weight: 2 }],
    });
    expect(flows?.nodes).toHaveLength(1);
    expect(flows?.links).toHaveLength(1);
    expect(asFlows({ nodes: [] })).toBeNull();
  });
});

describe('empty predicate per contract', () => {
  it('matches WidgetFrame emptiness for each declared shape', () => {
    expect(isEmptyData({ rowKeys: [], colKeys: [], cells: [] }, 'matrix')).toBe(true);
    expect(isEmptyData(cohortMatrixDemoData(1), 'matrix')).toBe(false);
    expect(isEmptyData({ points: [] }, 'timeseries')).toBe(true);
    expect(isEmptyData(heatCalendarDemoData(1, 8), 'timeseries')).toBe(false);
    expect(isEmptyData({ points: [] }, 'geo-points')).toBe(true);
    expect(isEmptyData(choroplethGridDemoData(1), 'geo-points')).toBe(false);
    expect(isEmptyData({ nodes: [], links: [] }, 'flows')).toBe(true);
    expect(isEmptyData(sankeyDemoData(1), 'flows')).toBe(false);
  });
});

describe('deterministic demo payloads match their contracts', () => {
  it('cohort matrix is triangular and stable', () => {
    expect(cohortMatrixDemoData(7)).toEqual(cohortMatrixDemoData(7));
    const demo = cohortMatrixDemoData(7);
    expect(demo.rowKeys).toHaveLength(8);
    expect(demo.colKeys).toEqual(['M0', 'M1', 'M2', 'M3', 'M4', 'M5']);
    expect(demo.cells[0]?.[0]).toBe(100); // M0 always full retention
    expect(demo.cells.at(-1)?.slice(1).every((c) => c === null)).toBe(true); // newest cohort: only M0
  });

  it('heat calendar / month yield daily timeseries', () => {
    expect(heatCalendarDemoData(3, 6)).toEqual(heatCalendarDemoData(3, 6));
    expect(heatCalendarDemoData(3, 6).points).toHaveLength(42);
    const month = heatMonthDemoData(3);
    expect(month).toEqual(heatMonthDemoData(3));
    expect(month.points.length).toBeGreaterThanOrEqual(28);
    expect(typeof month.points[0]?.t).toBe('string');
  });

  it('choropleth points carry two metrics; sankey funnel conserves flow', () => {
    const geo = choroplethGridDemoData(5);
    expect(geo).toEqual(choroplethGridDemoData(5));
    expect(geo.points[0]?.values).toHaveProperty('sales');
    expect(geo.points[0]?.values).toHaveProperty('orders');
    const flow = sankeyDemoData(5);
    const visited = flow.links.filter((l) => l.from === 'visited').reduce((s, l) => s + l.weight, 0);
    expect(visited).toBe(10_000);
  });
});

describe('config → chart wrappers', () => {
  it('cohort matrix labels the SVG and renders one cell per matrix entry', () => {
    const { container } = render(
      <ChartCohortMatrixWidget
        config={chartCohortMatrixConfigSchema.parse({ title: 'Retention by cohort' })}
        data={{ rowKeys: ['Jan', 'Feb'], colKeys: ['M0', 'M1'], cells: [[100, 60], [100, null]] }}
        instanceId="c1"
        onEvent={noop}
      />,
    );
    expect(container.querySelector('svg[role="img"]')?.getAttribute('aria-label')).toBe('Retention by cohort');
    expect(container.querySelector('[data-widget="chart-cohort-matrix"]')).not.toBeNull();
    expect(container.querySelectorAll('rect[data-cohort-cell]')).toHaveLength(4);
  });

  it('heatmap calendar renders day cells from a timeseries', () => {
    const { container } = render(
      <ChartHeatmapCalendarWidget
        config={chartHeatmapCalendarConfigSchema.parse({ title: 'Commits', weeks: 8 })}
        data={heatCalendarDemoData(2, 8)}
        instanceId="c2"
        onEvent={noop}
      />,
    );
    expect(container.querySelector('svg[role="img"]')?.getAttribute('aria-label')).toBe('Commits');
    expect(container.querySelectorAll('rect[data-heat-cell]').length).toBeGreaterThan(0);
  });

  it('heat month places day numbers', () => {
    const { container } = render(
      <ChartHeatMonthWidget
        config={chartHeatMonthConfigSchema.parse({ title: 'June' })}
        data={heatMonthDemoData(2)}
        instanceId="c3"
        onEvent={noop}
      />,
    );
    expect(container.querySelectorAll('rect[data-heat-cell]').length).toBeGreaterThanOrEqual(28);
  });

  it('choropleth renders tilegram tiles + a top-N ranking companion', () => {
    const { container } = render(
      <ChartChoroplethGridWidget
        config={chartChoroplethGridConfigSchema.parse({ title: 'Sales', metric: 'sales', topN: 5 })}
        data={choroplethGridDemoData(4)}
        instanceId="c4"
        onEvent={noop}
      />,
    );
    expect(container.querySelector('rect[data-region-tile="CA"]')).not.toBeNull();
    expect(container.querySelector('[data-region-ranking]')?.querySelectorAll('li')).toHaveLength(5);
  });

  /**
   * The empty-tilegram trap, shared with the cross-listed `map-choropleth-grid`.
   * `us-tilegram` (the default) plots only known USPS tiles, so a non-US
   * region-coded payload would place ZERO tiles under a live legend. The widget
   * degrades to the code-agnostic `grid` so the data stays visible. (Codes chosen
   * to avoid the ISO-country/USPS overlap: `DE` is Delaware, `LA` Louisiana.)
   */
  it('choropleth falls back to grid on a non-US payload (never a bare legend)', () => {
    const { container } = render(
      <ChartChoroplethGridWidget
        config={chartChoroplethGridConfigSchema.parse({ metric: 'sales' })}
        data={{
          points: [
            { code: 'FR', name: 'France', values: { sales: 300 } },
            { code: 'JP', name: 'Japan', values: { sales: 220 } },
            { code: 'BR', name: 'Brazil', values: { sales: 140 } },
          ],
        }}
        instanceId="c4b"
        onEvent={noop}
      />,
    );
    expect(container.querySelectorAll('rect[data-region-tile]')).toHaveLength(3);
  });

  it('sankey renders ribbons and an optional summary pill', () => {
    const { container } = render(
      <ChartSankeyWidget
        config={chartSankeyConfigSchema.parse({ title: 'Funnel', summaryLabel: '42% conversion' })}
        data={sankeyDemoData(4)}
        instanceId="c5"
        onEvent={noop}
      />,
    );
    expect(container.querySelectorAll('path[data-sankey-link]').length).toBeGreaterThan(0);
    expect(container.textContent).toContain('42% conversion');
  });

  it('falls back safely on a malformed payload', () => {
    const { container } = render(
      <ChartSankeyWidget
        config={chartSankeyConfigSchema.parse({})}
        data={{ nonsense: true }}
        instanceId="c6"
        onEvent={noop}
      />,
    );
    expect(container.querySelector('svg')).toBeNull();
    expect(container.textContent).toContain('Unexpected data shape');
  });
});

describe('matrix-geo definitions', () => {
  it('registers the five widgets with the annex ids, contracts and half-unit sizing', () => {
    expect(matrixGeoChartDefinitions.map((d) => d.id)).toEqual([
      'chart-cohort-matrix',
      'chart-heatmap-calendar',
      'chart-heat-month',
      'chart-choropleth-grid',
      'chart-sankey',
    ]);
    expect(matrixGeoChartDefinitions.map((d) => d.dataContract)).toEqual([
      'matrix',
      'timeseries',
      'timeseries',
      'geo-points',
      'flows',
    ]);
    for (const def of matrixGeoChartDefinitions) {
      expect(def.family).toBe('charts');
      expect(def.placement).toBe('grid');
      expect(def.skeleton).toBe('chart');
      expect(def.capabilities?.exportPng).toBe(true);
    }
    expect(matrixGeoChartDefinitions[0]?.sizing).toEqual({ minW: 6, minH: 6, defaultW: 8, defaultH: 6 });
  });
});
