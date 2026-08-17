// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Charts family stories (M4-T05): each registry widget's loaded variants
 * plus the WidgetFrame states through WidgetHost (acceptance criterion
 * #4). Demo payloads are the same deterministic seeded generators the
 * registry's `demoData` uses, so stories match demo mode exactly. Typed
 * loosely — the 04-T17 QA harness wires widgets stories into the
 * workspace Storybook.
 */
import { WidgetHost } from '../../frame/WidgetHost.js';
import {
  categoricalDemoData,
  shortTimeseriesDemoData,
  timeseriesDemoData,
} from './definitions.js';

const meta = {
  title: 'Widgets/Charts',
};
export default meta;

function host(
  widgetId: string,
  instanceId: string,
  config: Record<string, unknown>,
  data: unknown,
  status: 'success' | 'loading' | 'error' = 'success',
  width = 'w-[28rem]',
) {
  return (
    <div className={width}>
      <WidgetHost
        widgetId={widgetId}
        instanceId={instanceId}
        config={config}
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

export const LineAreaWithComparison = {
  render: () =>
    host(
      'chart-line-area',
      'story-line-1',
      { title: 'Revenue over time', compareToPrior: true },
      timeseriesDemoData(7),
    ),
};

export const LineAreaMinimal = {
  render: () =>
    host(
      'chart-line-area',
      'story-line-2',
      { title: 'Signups', smooth: false, axis: false, compareToPrior: false, height: 160 },
      { points: timeseriesDemoData(11).points },
    ),
};

export const BarTimeseries = {
  render: () =>
    host(
      'chart-bar',
      'story-bar-1',
      { title: 'Weekly activity', highlight: 'max' },
      shortTimeseriesDemoData(5),
    ),
};

export const BarCategorical = {
  render: () =>
    host(
      'chart-bar',
      'story-bar-2',
      { title: 'Orders by region', highlight: 'none', barRadius: 6 },
      categoricalDemoData(4),
    ),
};

export const Donut = {
  render: () =>
    host(
      'chart-donut',
      'story-donut-1',
      { title: 'Task breakdown', centerLabel: 'Total' },
      categoricalDemoData(2),
      'success',
      'w-80',
    ),
};

export const DonutManySlicesFold = {
  render: () =>
    host(
      'chart-donut',
      'story-donut-2',
      { title: 'Plans', maxSlices: 3, metricFormat: 'currency' },
      categoricalDemoData(9),
      'success',
      'w-80',
    ),
};

export const SparklineVariants = {
  render: () => (
    <div className="flex items-end gap-6">
      {host('chart-sparkline', 'story-spark-bar', { title: 'MRR trend' }, shortTimeseriesDemoData(3), 'success', 'w-32')}
      {host(
        'chart-sparkline',
        'story-spark-line',
        { title: 'Latency trend', variant: 'line', emphasisLast: false },
        shortTimeseriesDemoData(6),
        'success',
        'w-32',
      )}
    </div>
  ),
};

export const ChartStates = {
  render: () => (
    <div className="flex gap-4">
      {host('chart-line-area', 'story-chart-skeleton', { title: 'Loading' }, undefined, 'loading', 'w-80')}
      {host('chart-line-area', 'story-chart-error', { title: 'Denied' }, undefined, 'error', 'w-80')}
      {host('chart-donut', 'story-chart-empty', { title: 'No data' }, { items: [], total: 0 }, 'success', 'w-80')}
    </div>
  ),
};
