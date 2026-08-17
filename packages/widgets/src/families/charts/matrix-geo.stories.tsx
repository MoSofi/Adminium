// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Track E charts family stories (matrix, calendar & geo-grid): each registry
 * widget's loaded variant plus the four WidgetFrame states through WidgetHost
 * (acceptance #4), and light/dark × LTR/RTL matrices (acceptance #9). The
 * widgets are resolved through a LOCAL registry override so the stories work
 * before the green loop merges the definitions into the global map. Demo
 * payloads are the same seeded generators the registry `demoData` uses.
 */
import { ChartDirectionContext } from '@adminium/charts';
import type { ReactNode } from 'react';

import { WidgetHost } from '../../frame/WidgetHost.js';
import type { WidgetDefinition } from '../../registry/types.js';
import {
  choroplethGridDemoData,
  cohortMatrixDemoData,
  heatCalendarDemoData,
  heatMonthDemoData,
  matrixGeoChartDefinitions,
  sankeyDemoData,
} from './defs.matrix-geo.js';

const registry: ReadonlyMap<string, WidgetDefinition> = new Map(
  matrixGeoChartDefinitions.map((def) => [def.id, def] as const),
);

const meta = {
  title: 'Widgets/Charts/MatrixGeo',
};
export default meta;

type Status = 'success' | 'loading' | 'error';

function host(
  widgetId: string,
  instanceId: string,
  config: Record<string, unknown>,
  data: unknown,
  status: Status = 'success',
  width = 'w-[36rem]',
) {
  return (
    <div className={width}>
      <WidgetHost
        widgetId={widgetId}
        instanceId={instanceId}
        config={config}
        registry={registry}
        data={
          status === 'success'
            ? { status, data }
            : status === 'error'
              ? { status, error: new Error('TABLE_FORBIDDEN'), refetch: () => {} }
              : { status }
        }
      />
    </div>
  );
}

function Frame({ dark, dir, children }: { dark?: boolean; dir?: 'ltr' | 'rtl'; children: ReactNode }) {
  const content = <div className="flex flex-wrap gap-4 bg-bg p-4">{children}</div>;
  const dirWrapped = dir === undefined ? content : <ChartDirectionContext.Provider value={dir}>{content}</ChartDirectionContext.Provider>;
  return dark ? <div data-theme="dark">{dirWrapped}</div> : dirWrapped;
}

export const CohortMatrix = {
  render: () =>
    host('chart-cohort-matrix', 'story-cohort', { title: 'Retention by cohort' }, cohortMatrixDemoData(7)),
};

export const HeatmapCalendar = {
  render: () =>
    host(
      'chart-heatmap-calendar',
      'story-heatcal',
      { title: 'Contributions', weeks: 30 },
      heatCalendarDemoData(7, 30),
      'success',
      'w-[48rem]',
    ),
};

export const HeatMonth = {
  render: () => host('chart-heat-month', 'story-heatmonth', { title: 'June activity' }, heatMonthDemoData(7), 'success', 'w-96'),
};

export const ChoroplethGrid = {
  render: () =>
    host('chart-choropleth-grid', 'story-choropleth', { title: 'Sales by state', metric: 'sales', valueFormat: 'currency' }, choroplethGridDemoData(7)),
};

export const Sankey = {
  render: () =>
    host('chart-sankey', 'story-sankey', { title: 'Conversion flow', summaryLabel: '42% conversion' }, sankeyDemoData(7)),
};

export const States = {
  render: () => (
    <Frame>
      {host('chart-cohort-matrix', 'story-cohort-skeleton', { title: 'Loading' }, undefined, 'loading', 'w-96')}
      {host('chart-sankey', 'story-sankey-error', { title: 'Denied' }, undefined, 'error', 'w-96')}
      {host('chart-choropleth-grid', 'story-choropleth-empty', { title: 'No regions' }, { points: [] }, 'success', 'w-96')}
      {host('chart-heatmap-calendar', 'story-heatcal-empty', { title: 'No activity' }, { points: [] }, 'success', 'w-96')}
    </Frame>
  ),
};

export const DarkRtl = {
  render: () => (
    <Frame dark dir="rtl">
      {host('chart-cohort-matrix', 'story-cohort-dark-rtl', { title: 'الاحتفاظ حسب الفوج' }, cohortMatrixDemoData(3), 'success', 'w-96')}
      {host('chart-heatmap-calendar', 'story-heatcal-dark-rtl', { title: 'المساهمات', weeks: 26 }, heatCalendarDemoData(3, 26), 'success', 'w-[40rem]')}
    </Frame>
  ),
};

export const LightRtl = {
  render: () => (
    <Frame dir="rtl">
      {host('chart-heat-month', 'story-heatmonth-rtl', { title: 'النشاط الشهري' }, heatMonthDemoData(3), 'success', 'w-96')}
      {host('chart-sankey', 'story-sankey-rtl', { title: 'تدفق التحويل' }, sankeyDemoData(3), 'success', 'w-96')}
    </Frame>
  ),
};
