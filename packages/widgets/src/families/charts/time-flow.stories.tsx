/**
 * "Time, forecast & flow" group stories (04-T09 / 04-T17): each widget's loaded
 * variant plus the four WidgetFrame states, through WidgetHost with a registry
 * override (the family barrel is green-loop-assembled). Demo payloads are the
 * definitions' deterministic `demoData`, so stories match demo mode. RTL is
 * exercised by feeding the charts' `ChartDirectionContext` (the same context the
 * ChartDirectionBridge feeds in the live app), which is what actually mirrors the
 * SVG geometry — a bare `dir="rtl"` wrapper does not.
 */
import { ChartDirectionContext } from '@adminium/charts';
import type { ReactNode } from 'react';

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

const meta = { title: 'Widgets/Charts/TimeFlow' };
export default meta;

function host(
  widgetId: string,
  instanceId: string,
  config: Record<string, unknown>,
  data: unknown,
  status: WidgetDataState['status'] = 'success',
  width = 'w-[34rem]',
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

export const Multiline = {
  render: () => host('chart-multiline', 's-multiline', { title: 'Cohort LTV' }, chartMultilineDemoData(3)),
};

export const Stream = {
  render: () => host('chart-stream', 's-stream', { title: 'Traffic composition' }, chartStreamDemoData(3)),
};

export const Forecast = {
  render: () => host('chart-forecast', 's-forecast', { title: 'Revenue forecast' }, chartForecastDemoData(3)),
};

export const Anomaly = {
  render: () => host('chart-anomaly', 's-anomaly', { title: 'Error rate' }, chartAnomalyDemoData(3)),
};

export const Candlestick = {
  render: () => host('chart-candlestick', 's-candlestick', { title: 'ADMN share price', livePill: true }, chartCandlestickDemoData(3)),
};

export const Bump = {
  render: () => host('chart-bump', 's-bump', { title: 'Channel rank' }, chartBumpDemoData(3)),
};

export const TimelineLanes = {
  render: () => host('chart-timeline-lanes', 's-lanes', { title: 'Release timeline' }, chartTimelineLanesDemoData(3)),
};

function Rtl({ children }: { children: ReactNode }): ReactNode {
  return (
    <div dir="rtl">
      <ChartDirectionContext.Provider value="rtl">{children}</ChartDirectionContext.Provider>
    </div>
  );
}

export const RtlMultiline = {
  render: () => <Rtl>{host('chart-multiline', 's-multiline-rtl', { title: 'منحنى الأتراب' }, chartMultilineDemoData(3))}</Rtl>,
};

export const RtlForecast = {
  render: () => <Rtl>{host('chart-forecast', 's-forecast-rtl', { title: 'توقع الإيرادات' }, chartForecastDemoData(3))}</Rtl>,
};

export const States = {
  render: () => (
    <div className="flex flex-wrap gap-4">
      {host('chart-forecast', 's-skeleton', { title: 'Loading' }, undefined, 'loading', 'w-96')}
      {host('chart-forecast', 's-error', { title: 'Denied' }, undefined, 'error', 'w-96')}
      {host('chart-multiline', 's-empty', {}, { series: [] }, 'success', 'w-96')}
    </div>
  ),
};
