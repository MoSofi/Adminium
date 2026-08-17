// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * Render + frame-state tests for the "bars & ranking" widgets (04-T09,
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
import { barsRankingChartDefinitions } from './bars-ranking-definitions.js';
import {
  bulletDemoData,
  marimekkoDemoData,
  paretoDemoData,
  rankingDemoData,
  slopeDemoData,
  stackedBar100DemoData,
  waterfallDemoData,
} from './bars-ranking-demo.js';

const registry = buildRegistry([widgetMissingDefinition, ...barsRankingChartDefinitions]);

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
  ['chart-bullet', { title: 'Goals vs target' }, bulletDemoData(3)],
  ['chart-ranking-bars', { title: 'Top regions' }, rankingDemoData(3)],
  ['chart-pareto', { title: 'Issues by cause' }, paretoDemoData(3)],
  ['chart-waterfall', { title: 'MRR bridge' }, waterfallDemoData(3)],
  ['chart-marimekko', { title: 'Revenue by region' }, marimekkoDemoData(3)],
  ['chart-stacked-bar-100', { title: 'Traffic by source' }, stackedBar100DemoData(3)],
  ['chart-slope', { title: 'Plan mix shift' }, slopeDemoData(3)],
] as const;

describe('loaded state', () => {
  for (const [id, config, data] of loaded) {
    it(`${id} renders a labelled chart from demo data`, async () => {
      const { container } = host(id, config, { status: 'success', data });
      await waitFor(() =>
        expect(container.querySelector(`[data-widget="${id}"]`)).not.toBeNull(),
      );
      const svg = container.querySelector('svg[role="img"]');
      expect(svg?.getAttribute('aria-label')).toBe(config.title);
    });
  }
});

describe('the four WidgetFrame states', () => {
  it('skeleton on loading uses the chart silhouette', () => {
    const { container } = host('chart-pareto', { title: 'x' }, { status: 'loading' });
    expect(container.querySelector('[data-skeleton-variant="chart"]')).not.toBeNull();
  });

  it('empty renders the per-widget empty copy (default keys resolve through the frame translator)', async () => {
    const { createI18n } = await import('@adminium/i18n');
    const { I18nProvider } = await import('@adminium/i18n/react');
    const i18n = await createI18n({
      locale: 'en_US',
      loadBundle: async (_tag, ns) =>
        ns === 'ui'
          ? {
              widgets: {
                charts: {
                  bullet: { emptyTitle: 'No goals to track', emptyBody: 'Add measures with targets to compare against.' },
                },
              },
            }
          : null,
    });
    const { container } = render(
      <I18nProvider i18n={i18n}>
        <WidgetHost
          widgetId="chart-bullet"
          instanceId="i-chart-bullet"
          config={{}}
          data={{ status: 'success', data: { rows: [], columns: [], total: 0 } }}
          registry={registry}
        />
      </I18nProvider>,
    );
    expect(container.textContent).toContain('No goals to track');
    // The raw key path must never leak into the DOM (the pre-translator defect).
    expect(container.textContent).not.toContain('widgets.charts.bullet.emptyTitle');
  });

  it('empty differs per widget (ranking vs slope keys)', async () => {
    const { createI18n } = await import('@adminium/i18n');
    const { I18nProvider } = await import('@adminium/i18n/react');
    const i18n = await createI18n({
      locale: 'en_US',
      loadBundle: async (_tag, ns) =>
        ns === 'ui'
          ? {
              widgets: {
                charts: {
                  rankingBars: { emptyTitle: 'Nothing to rank' },
                  slope: { emptyTitle: 'No period shift to show' },
                },
              },
            }
          : null,
    });
    const ranking = render(
      <I18nProvider i18n={i18n}>
        <WidgetHost
          widgetId="chart-ranking-bars"
          instanceId="i-chart-ranking-bars"
          config={{}}
          data={{ status: 'success', data: { items: [], total: 0 } }}
          registry={registry}
        />
      </I18nProvider>,
    );
    expect(ranking.container.textContent).toContain('Nothing to rank');
    cleanup();
    const slope = render(
      <I18nProvider i18n={i18n}>
        <WidgetHost
          widgetId="chart-slope"
          instanceId="i-chart-slope"
          config={{}}
          data={{ status: 'success', data: { rows: [], columns: [], total: 0 } }}
          registry={registry}
        />
      </I18nProvider>,
    );
    expect(slope.container.textContent).toContain('No period shift to show');
  });

  it('error renders a Retry that re-runs the query', () => {
    const refetch = vi.fn();
    const { getByRole } = host('chart-waterfall', { title: 'x' }, {
      status: 'error',
      error: new Error('TABLE_FORBIDDEN'),
      refetch,
    });
    const retry = getByRole('button', { name: /retry/i });
    retry.click();
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
