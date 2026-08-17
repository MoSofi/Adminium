// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * Render + frame-state tests for the "time, forecast & flow" widgets (04-T09,
 * acceptance #4): each renders its loaded chart through WidgetHost (registry
 * override, since the family barrel is green-loop-assembled), labels the SVG
 * from config.title, and drives all four WidgetFrame states — skeleton, empty
 * (per-widget copy), error + Retry.
 */
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WidgetHost } from '../../frame/WidgetHost.js';
import type { WidgetDataState } from '../../frame/WidgetHost.js';
import { buildRegistry } from '../../registry/index.js';
import { widgetMissingDefinition } from '../../registry/widget-missing.js';
import { timeFlowChartDefinitions } from './time-flow-definitions.js';
import {
  chartAnomalyDemoData,
  chartBumpDemoData,
  chartCandlestickDemoData,
  chartForecastDemoData,
  chartMultilineDemoData,
  chartStreamDemoData,
  chartTimelineLanesDemoData,
} from './time-flow-demo.js';

const registry = buildRegistry([widgetMissingDefinition, ...timeFlowChartDefinitions]);

function host(widgetId: string, config: Record<string, unknown>, data: WidgetDataState) {
  return render(
    <WidgetHost widgetId={widgetId} instanceId={`i-${widgetId}`} config={config} data={data} registry={registry} />,
  );
}

beforeEach(() => {
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
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const loaded = [
  ['chart-multiline', { title: 'Cohort LTV' }, chartMultilineDemoData(3)],
  ['chart-stream', { title: 'Traffic composition' }, chartStreamDemoData(3)],
  ['chart-forecast', { title: 'Revenue forecast' }, chartForecastDemoData(3)],
  ['chart-anomaly', { title: 'Error rate' }, chartAnomalyDemoData(3)],
  ['chart-candlestick', { title: 'ADMN share price' }, chartCandlestickDemoData(3)],
  ['chart-bump', { title: 'Channel rank' }, chartBumpDemoData(3)],
  ['chart-timeline-lanes', { title: 'Release timeline' }, chartTimelineLanesDemoData(3)],
] as const;

describe('loaded state', () => {
  for (const [id, config, data] of loaded) {
    it(`${id} renders a labelled chart from demo data`, async () => {
      const { container } = host(id, config, { status: 'success', data });
      await waitFor(() => expect(container.querySelector(`[data-widget="${id}"]`)).not.toBeNull());
      const svg = container.querySelector('svg[role="img"]');
      expect(svg?.getAttribute('aria-label')).toBe(config.title);
    });
  }
});

describe('the four WidgetFrame states', () => {
  it('skeleton on loading uses the chart silhouette', () => {
    const { container } = host('chart-forecast', { title: 'x' }, { status: 'loading' });
    expect(container.querySelector('[data-skeleton-variant="chart"]')).not.toBeNull();
  });

  it('empty renders the per-widget empty copy', () => {
    const { container } = host(
      'chart-multiline',
      { emptyState: { titleKey: 'Nothing to plot' } },
      { status: 'success', data: { series: [] } },
    );
    expect(container.textContent).toContain('Nothing to plot');
  });

  it('empty differs per widget (candlestick vs timeline-lanes)', () => {
    const candles = host(
      'chart-candlestick',
      { emptyState: { titleKey: 'No candles yet' } },
      { status: 'success', data: { candles: [] } },
    );
    expect(candles.container.textContent).toContain('No candles yet');
    cleanup();
    const lanes = host(
      'chart-timeline-lanes',
      { emptyState: { titleKey: 'No events yet' } },
      { status: 'success', data: { events: [] } },
    );
    expect(lanes.container.textContent).toContain('No events yet');
  });

  it('error renders a Retry that re-runs the query', () => {
    const refetch = vi.fn();
    const { getByRole } = host('chart-bump', { title: 'x' }, {
      status: 'error',
      error: new Error('TABLE_FORBIDDEN'),
      refetch,
    });
    const retry = getByRole('button', { name: /retry/i });
    retry.click();
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
