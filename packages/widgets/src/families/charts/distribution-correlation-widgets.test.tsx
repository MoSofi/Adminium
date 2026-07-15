// @vitest-environment happy-dom
/**
 * Distribution & correlation group — wrapper render behaviour (04-T09):
 * config→chart prop mapping (aria label from config.title), §3 envelope
 * narrowing → BadShape fallback, the pure record-list projections, and the four
 * WidgetFrame states through WidgetHost with a registry override (acceptance
 * #4). Requires the family component chunk (@adminium/charts primitives).
 */
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { WidgetHost } from '../../frame/WidgetHost.js';
import type { WidgetDefinition } from '../../registry/types.js';
import { distributionCorrelationChartDefinitions } from './definitions.distribution-correlation.js';
import {
  ChartBoxplotWidget,
  ChartCorrelationMatrixWidget,
  ChartHexbinWidget,
  ChartParallelCoordinatesWidget,
  ChartRidgelineWidget,
  ChartScatterBubbleWidget,
  ChartViolinWidget,
  parallelInputsOf,
  scatterPointsOf,
} from './DistributionCorrelationWidgets.js';
import {
  boxplotDemoData,
  chartBoxplotConfigSchema,
  chartCorrelationMatrixConfigSchema,
  chartHexbinConfigSchema,
  chartParallelCoordinatesConfigSchema,
  chartRidgelineConfigSchema,
  chartScatterBubbleConfigSchema,
  chartViolinConfigSchema,
  correlationDemoData,
  hexbinDemoData,
  parallelDemoData,
  ridgelineDemoData,
  scatterDemoData,
  violinDemoData,
} from './distributionShapes.js';

const noop = () => {};
const registry: ReadonlyMap<string, WidgetDefinition> = new Map(
  distributionCorrelationChartDefinitions.map((def) => [def.id, def]),
);

describe('wrapper render + aria labelling', () => {
  it('boxplot labels the SVG from config.title', () => {
    const { container } = render(
      <ChartBoxplotWidget config={chartBoxplotConfigSchema.parse({ title: 'Latency by region' })} data={boxplotDemoData(1)} instanceId="b1" onEvent={noop} />,
    );
    expect(container.querySelector('svg[role="img"]')?.getAttribute('aria-label')).toBe('Latency by region');
    expect(container.querySelector('[data-widget="chart-boxplot"]')).not.toBeNull();
  });

  it('violin / ridgeline render from distribution density', () => {
    const violin = render(
      <ChartViolinWidget config={chartViolinConfigSchema.parse({ title: 'V' })} data={violinDemoData(2)} instanceId="v1" onEvent={noop} />,
    );
    expect(violin.container.querySelector('[data-widget="chart-violin"] svg')).not.toBeNull();
    const ridge = render(
      <ChartRidgelineWidget config={chartRidgelineConfigSchema.parse({ title: 'R' })} data={ridgelineDemoData(2)} instanceId="r1" onEvent={noop} />,
    );
    expect(ridge.container.querySelector('[data-widget="chart-ridgeline"] svg')).not.toBeNull();
  });

  it('scatter / hexbin / correlation / parallel render from their envelopes', () => {
    const scatter = render(
      <ChartScatterBubbleWidget config={chartScatterBubbleConfigSchema.parse({ title: 'S', rField: 'deals', segmentField: 'segment' })} data={scatterDemoData(2)} instanceId="s1" onEvent={noop} />,
    );
    expect(scatter.container.querySelector('[data-widget="chart-scatter-bubble"] svg')).not.toBeNull();
    const hexbin = render(
      <ChartHexbinWidget config={chartHexbinConfigSchema.parse({ title: 'H' })} data={hexbinDemoData(2)} instanceId="h1" onEvent={noop} />,
    );
    expect(hexbin.container.querySelector('polygon[data-count]')).not.toBeNull();
    const corr = render(
      <ChartCorrelationMatrixWidget config={chartCorrelationMatrixConfigSchema.parse({ title: 'C' })} data={correlationDemoData(2)} instanceId="c1" onEvent={noop} />,
    );
    expect(corr.container.querySelector('[data-sign]')).not.toBeNull();
    const parallel = render(
      <ChartParallelCoordinatesWidget config={chartParallelCoordinatesConfigSchema.parse({ title: 'P', colorBy: 'segment' })} data={parallelDemoData(2)} instanceId="p1" onEvent={noop} />,
    );
    expect(parallel.container.querySelectorAll('[data-record-index]').length).toBeGreaterThan(0);
  });

  it('falls back to BadShape on a malformed payload', () => {
    const { container } = render(
      <ChartBoxplotWidget config={chartBoxplotConfigSchema.parse({})} data={{ nope: true }} instanceId="b2" onEvent={noop} />,
    );
    expect(container.querySelector('svg')).toBeNull();
    expect(container.textContent).toContain('Unexpected data shape');
  });
});

describe('record-list projections', () => {
  it('scatterPointsOf maps configured fields and skips rows missing x/y', () => {
    const points = scatterPointsOf(
      [
        { team_size: 10, revenue: 5000, deals: 3, segment: 'SMB' },
        { team_size: 20, revenue: 9000 },
        { revenue: 100 },
      ],
      chartScatterBubbleConfigSchema.parse({ rField: 'deals', segmentField: 'segment' }),
    );
    expect(points).toHaveLength(2);
    expect(points[0]).toEqual({ x: 10, y: 5000, r: 3, segment: 'SMB' });
    expect(points[1]?.r).toBeUndefined();
  });

  it('parallelInputsOf computes per-axis bounds and one record per row', () => {
    const inputs = parallelInputsOf(
      [
        { speed: 2, reach: 8, cost: 5, roi: 1, segment: 'Free' },
        { speed: 6, reach: 4, cost: 9, roi: 7, segment: 'Pro' },
      ],
      chartParallelCoordinatesConfigSchema.parse({ colorBy: 'segment' }),
    );
    expect(inputs?.axes.map((a) => a.key)).toEqual(['speed', 'reach', 'cost', 'roi']);
    expect(inputs?.axes[0]).toEqual({ key: 'speed', label: 'speed', min: 2, max: 6 });
    expect(inputs?.records).toHaveLength(2);
    expect(inputs?.records[0]?.segment).toBe('Free');
  });
});

describe('four WidgetFrame states through WidgetHost (acceptance #4)', () => {
  it('renders skeleton, empty, and error states with a chart silhouette + Retry', () => {
    const skeleton = render(
      <WidgetHost widgetId="chart-boxplot" instanceId="w-sk" config={{ title: 'Loading' }} data={{ status: 'loading' }} registry={registry} />,
    );
    expect(skeleton.container.querySelector('[data-skeleton-variant="chart"]')).not.toBeNull();

    const empty = render(
      <WidgetHost widgetId="chart-boxplot" instanceId="w-empty" config={{ title: 'Empty' }} data={{ status: 'success', data: { groups: [] } }} registry={registry} />,
    );
    expect(empty.container.querySelector('[data-state="empty"]')).not.toBeNull();

    const error = render(
      <WidgetHost widgetId="chart-boxplot" instanceId="w-err" config={{ title: 'Denied' }} data={{ status: 'error', error: new Error('TABLE_FORBIDDEN'), refetch: noop }} registry={registry} />,
    );
    expect(error.getByRole('alert')).toBeTruthy();
    expect(error.getByRole('button', { name: /retry/i })).toBeTruthy();
  });

  it('renders the loaded chart for a bound success payload', async () => {
    render(
      <WidgetHost widgetId="chart-scatter-bubble" instanceId="w-loaded" config={{ title: 'Revenue vs size' }} data={{ status: 'success', data: scatterDemoData(4) }} registry={registry} />,
    );
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'Revenue vs size' })).toBeTruthy(),
    );
  });
});
