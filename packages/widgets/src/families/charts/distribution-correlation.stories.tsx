/**
 * Distribution & correlation charts stories (04-T09 / 04-T17): each widget's
 * loaded variant plus the four WidgetFrame states through WidgetHost with a
 * registry override (these ids join the global registry only once the green
 * loop assembles the family). Demo payloads are the same deterministic seeded
 * generators the registry's `demoData` uses. Theme (light/dark) is applied by
 * the Storybook decorators; an explicit RTL story exercises chart mirroring.
 */
import { ChartDirectionContext } from '@adminium/charts';
import type { ReactNode } from 'react';

import { WidgetHost } from '../../frame/WidgetHost.js';
import type { WidgetDataState } from '../../frame/WidgetHost.js';
import type { WidgetDefinition } from '../../registry/types.js';
import { distributionCorrelationChartDefinitions } from './definitions.distribution-correlation.js';
import {
  boxplotDemoData,
  correlationDemoData,
  hexbinDemoData,
  parallelDemoData,
  ridgelineDemoData,
  scatterDemoData,
  violinDemoData,
} from './distributionShapes.js';

const registry: ReadonlyMap<string, WidgetDefinition> = new Map(
  distributionCorrelationChartDefinitions.map((def) => [def.id, def]),
);

const meta = { title: 'Widgets/Charts/Distribution & Correlation' };
export default meta;

function host(
  widgetId: string,
  instanceId: string,
  config: Record<string, unknown>,
  state: WidgetDataState,
  width = 'w-[30rem]',
) {
  return (
    <div className={width}>
      <WidgetHost widgetId={widgetId} instanceId={instanceId} config={config} data={state} registry={registry} />
    </div>
  );
}

const ok = (data: unknown): WidgetDataState => ({ status: 'success', data });

export const Boxplot = {
  render: () => host('chart-boxplot', 'st-box', { title: 'Response time by region', unit: 'ms' }, ok(boxplotDemoData(7))),
};

export const Violin = {
  render: () => host('chart-violin', 'st-violin', { title: 'Conversion by variant' }, ok(violinDemoData(7))),
};

export const Ridgeline = {
  render: () => host('chart-ridgeline', 'st-ridge', { title: 'Activity by weekday' }, ok(ridgelineDemoData(7))),
};

export const ScatterBubble = {
  render: () =>
    host(
      'chart-scatter-bubble',
      'st-scatter',
      { title: 'Revenue vs team size', rField: 'deals', segmentField: 'segment' },
      ok(scatterDemoData(7)),
    ),
};

export const Hexbin = {
  render: () => host('chart-hexbin', 'st-hex', { title: 'User density' }, ok(hexbinDemoData(7))),
};

export const CorrelationMatrix = {
  render: () => host('chart-correlation-matrix', 'st-corr', { title: 'Metric correlations' }, ok(correlationDemoData(7))),
};

export const ParallelCoordinates = {
  render: () =>
    host('chart-parallel-coordinates', 'st-par', { title: 'Segment profiles', colorBy: 'segment' }, ok(parallelDemoData(7)), 'w-[40rem]'),
};

export const States = {
  render: () => (
    <div className="flex flex-wrap gap-4">
      {host('chart-boxplot', 'st-skeleton', { title: 'Loading' }, { status: 'loading' }, 'w-80')}
      {host('chart-boxplot', 'st-empty', { title: 'No data' }, ok({ groups: [] }), 'w-80')}
      {host(
        'chart-boxplot',
        'st-error',
        { title: 'Denied' },
        { status: 'error', error: new Error('TABLE_FORBIDDEN'), refetch: () => {} },
        'w-80',
      )}
    </div>
  ),
};

function Rtl({ children }: { children: ReactNode }) {
  return (
    <div dir="rtl">
      <ChartDirectionContext.Provider value="rtl">{children}</ChartDirectionContext.Provider>
    </div>
  );
}

export const RtlMirroring = {
  render: () => (
    <Rtl>
      <div className="flex flex-wrap gap-4">
        {host('chart-boxplot', 'st-rtl-box', { title: 'زمن الاستجابة' }, ok(boxplotDemoData(7)), 'w-80')}
        {host('chart-scatter-bubble', 'st-rtl-scatter', { title: 'الإيرادات', segmentField: 'segment' }, ok(scatterDemoData(7)), 'w-80')}
      </div>
    </Rtl>
  ),
};
