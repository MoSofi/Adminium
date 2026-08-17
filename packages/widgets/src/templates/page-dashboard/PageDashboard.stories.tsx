// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `page-dashboard` template stories (M4-T05): the full demo-mode comp port
 * (4-card KPI row + hero line-area + donut + secondary bar + mini-table
 * slot), a mocked-adapter run showing per-item error isolation, and the
 * mixed loading/error/success states through the `states` override. Typed
 * loosely — the 04-T17 QA harness wires widgets stories into the
 * workspace Storybook.
 */
import { PageDashboard } from './PageDashboard.js';
import { demoDashboardLayout } from './demo-layout.js';
import { timeseriesDemoData } from '../../families/charts/definitions.js';
import type { DashboardDataAdapter } from './data-adapter.js';

const meta = {
  title: 'Templates/PageDashboard',
};
export default meta;

/** Demo mode (04 §5.3): no adapter, every widget seeds from its instance id. */
export const DemoMode = {
  render: () => <PageDashboard layout={demoDashboardLayout} />,
};

/** Bound layout resolved by a canned adapter with one failing item. */
const boundLayout = {
  version: 1,
  items: demoDashboardLayout.items.slice(0, 5).map((item) => ({
    ...item,
    config: {
      ...item.config,
      binding: {
        connectionId: 'story-conn',
        shape: item.widget === 'chart-line-area' ? 'timeseries' : 'metric+delta',
        source: { name: 'orders' },
        aggregations: [{ fn: 'count', alias: 'n' }],
        ...(item.widget === 'chart-line-area'
          ? { bucket: { column: 'order_date', unit: 'month' } }
          : {}),
      },
    },
  })),
};

const cannedAdapter: DashboardDataAdapter = {
  queryBatch: async (requests) => {
    await new Promise((resolve) => setTimeout(resolve, 600)); // visible skeletons
    return Object.fromEntries(
      requests.map((request) => [
        request.instanceId,
        request.instanceId === 'demo-kpi-errors'
          ? { status: 'error' as const, error: new Error('TABLE_FORBIDDEN') }
          : request.descriptor.shape === 'timeseries'
            ? { status: 'success' as const, data: timeseriesDemoData(21) }
            : { status: 'success' as const, data: { value: 4821, prior: 4210 } },
      ]),
    );
  },
};

export const BoundWithAdapter = {
  render: () => <PageDashboard layout={boundLayout} adapter={cannedAdapter} />,
};

/** Explicit per-instance state overrides: loading + error + empty at once. */
export const MixedStates = {
  render: () => (
    <PageDashboard
      layout={demoDashboardLayout}
      states={{
        'demo-kpi-revenue': { status: 'loading' },
        'demo-kpi-projects': { status: 'error', error: new Error('COLUMN_FORBIDDEN'), refetch: () => {} },
        'demo-breakdown-tasks': { status: 'success', data: { items: [], total: 0 } },
      }}
    />
  ),
};

/** Corrupt stored layout → the template's non-crashing invalid notice. */
export const InvalidLayout = {
  render: () => <PageDashboard layout={{ version: 99, items: 'nope' }} />,
};
