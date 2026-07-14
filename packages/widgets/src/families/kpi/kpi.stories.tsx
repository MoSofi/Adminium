/**
 * KPI family stories (M4-T06): each widget's loaded variants plus the
 * WidgetFrame states through WidgetHost (acceptance criterion #4). Typed
 * loosely — the 04-T17 QA harness wires widgets stories into the
 * workspace Storybook.
 */
import { WidgetHost } from '../../frame/WidgetHost.js';
import { kpiStatCardDemoData, usageMeterDemoData } from './definitions.js';

const meta = {
  title: 'Widgets/KPI',
};
export default meta;

function host(
  widgetId: string,
  instanceId: string,
  config: Record<string, unknown>,
  data: unknown,
  status: 'success' | 'loading' | 'error' = 'success',
) {
  return (
    <div className="w-64">
      <WidgetHost
        widgetId={widgetId}
        instanceId={instanceId}
        config={config}
        data={
          status === 'success'
            ? { status, data }
            : status === 'error'
              ? { status, error: new Error('COLUMN_FORBIDDEN'), refetch: () => {} }
              : { status }
        }
      />
    </div>
  );
}

export const StatCardCurrency = {
  render: () =>
    host(
      'kpi-stat-card',
      'story-kpi-1',
      { title: 'Revenue', metricLabel: 'Revenue (30d)', metricFormat: 'currency', iconName: 'dollar' },
      { value: 48_210, prior: 42_900, spark: kpiStatCardDemoData(3).spark },
    ),
};

export const StatCardDownIsGood = {
  render: () =>
    host(
      'kpi-stat-card',
      'story-kpi-2',
      {
        title: 'Error rate',
        metricFormat: 'percent',
        invertDeltaGood: true,
        iconName: 'zap',
        iconTone: 'danger',
        showSparkline: false,
      },
      { value: 0.031, prior: 0.045 },
    ),
};

export const StatCardAbsoluteDelta = {
  render: () =>
    host(
      'kpi-stat-card',
      'story-kpi-3',
      { title: 'Team members', deltaMode: 'abs', iconName: 'users', iconTone: 'pos' },
      { value: 248, prior: 236 },
    ),
};

export const StatCardStates = {
  render: () => (
    <div className="flex gap-4">
      {host('kpi-stat-card', 'story-kpi-skeleton', { title: 'Loading' }, undefined, 'loading')}
      {host('kpi-stat-card', 'story-kpi-error', { title: 'Broken' }, undefined, 'error')}
      {host('kpi-stat-card', 'story-kpi-demo', { title: 'Demo seed' }, kpiStatCardDemoData(9))}
    </div>
  ),
};

export const UsageMeterTones = {
  render: () => (
    <div className="flex flex-col gap-4">
      {host('usage-meter', 'story-meter-ok', { title: 'AI credits', limit: 100 }, usageMeterDemoData(2))}
      {host('usage-meter', 'story-meter-warn', { title: 'Storage', limit: 100, unit: 'GB' }, { value: 85 })}
      {host(
        'usage-meter',
        'story-meter-danger',
        { title: 'API quota', limit: 100, ctaLabel: 'Upgrade plan', ctaHref: '/p/billing' },
        { value: 97 },
      )}
    </div>
  ),
};
