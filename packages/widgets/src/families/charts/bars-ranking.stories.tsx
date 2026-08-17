// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Bars & ranking" group stories (04-T09 / 04-T17): each widget's loaded
 * variant plus the four WidgetFrame states, through WidgetHost with a registry
 * override (the family barrel is green-loop-assembled). Demo payloads are the
 * definitions' deterministic `demoData`, so stories match demo mode. RTL is
 * exercised by feeding the charts' `ChartDirectionContext` (the same context
 * the ChartDirectionBridge feeds in the live app), which is what actually
 * mirrors the SVG geometry — a bare `dir="rtl"` wrapper does not.
 */
import { ChartDirectionContext } from '@adminium/charts';
import type { ReactNode } from 'react';

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

const meta = { title: 'Widgets/Charts/BarsRanking' };
export default meta;

function host(
  widgetId: string,
  instanceId: string,
  config: Record<string, unknown>,
  data: unknown,
  status: WidgetDataState['status'] = 'success',
  width = 'w-[30rem]',
): ReactNode {
  const state: WidgetDataState =
    status === 'success'
      ? { status, data }
      : status === 'error'
        ? { status, error: new Error('TABLE_FORBIDDEN'), refetch: () => {} }
        : { status };
  return (
    <div className={width}>
      <WidgetHost widgetId={widgetId} instanceId={instanceId} config={config} data={state} registry={registry} />
    </div>
  );
}

export const Bullet = {
  render: () => host('chart-bullet', 's-bullet', { title: 'Goals vs target' }, bulletDemoData(3)),
};

export const RankingBarsStory = {
  render: () => host('chart-ranking-bars', 's-ranking', { title: 'Top regions' }, rankingDemoData(3), 'success', 'w-80'),
};

export const Pareto = {
  render: () => host('chart-pareto', 's-pareto', { title: 'Issues by cause' }, paretoDemoData(5)),
};

export const Waterfall = {
  render: () => host('chart-waterfall', 's-waterfall', { title: 'MRR bridge' }, waterfallDemoData(2)),
};

export const Marimekko = {
  render: () => host('chart-marimekko', 's-marimekko', { title: 'Revenue by region' }, marimekkoDemoData(4)),
};

export const StackedBar100Story = {
  render: () =>
    host('chart-stacked-bar-100', 's-stacked', { title: 'Traffic by source', legendColumns: 2 }, stackedBar100DemoData(6)),
};

export const Slope = {
  render: () =>
    host('chart-slope', 's-slope', { title: 'Plan mix shift', periodLabels: ['Q1', 'Q2'] }, slopeDemoData(3)),
};

function Rtl({ children }: { children: ReactNode }): ReactNode {
  return (
    <div dir="rtl">
      <ChartDirectionContext.Provider value="rtl">{children}</ChartDirectionContext.Provider>
    </div>
  );
}

export const RtlRanking = {
  render: () => (
    <Rtl>{host('chart-ranking-bars', 's-ranking-rtl', { title: 'أعلى المناطق' }, rankingDemoData(3), 'success', 'w-80')}</Rtl>
  ),
};

export const RtlWaterfall = {
  render: () => <Rtl>{host('chart-waterfall', 's-waterfall-rtl', { title: 'جسر الإيرادات' }, waterfallDemoData(2))}</Rtl>,
};

export const States = {
  render: () => (
    <div className="flex flex-wrap gap-4">
      {host('chart-pareto', 's-skeleton', { title: 'Loading' }, undefined, 'loading', 'w-80')}
      {host('chart-pareto', 's-error', { title: 'Denied' }, undefined, 'error', 'w-80')}
      {host('chart-bullet', 's-empty', {}, { rows: [], columns: [], total: 0 }, 'success', 'w-80')}
    </div>
  ),
};
