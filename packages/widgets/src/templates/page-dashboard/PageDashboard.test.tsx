// @vitest-environment happy-dom
/**
 * page-dashboard template tests (M4-T05): renders a fixture layout on the
 * static grid with per-instance data states, resolves demo mode for
 * unbound widgets, batches all bound descriptors into ONE adapter call,
 * isolates per-item failures, and survives invalid layouts + unknown
 * widget ids (widget-missing fallback, never a crash).
 */
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PageDashboard } from './PageDashboard.js';
import { demoDashboardLayout } from './demo-layout.js';
import type { DashboardDataAdapter, WidgetQueryRequest } from './data-adapter.js';
import type { PageLayout } from '../../page-config/index.js';

function binding(table: string) {
  return {
    kind: 'table-query',
    connectionId: 'conn_1',
    source: { name: table, schema: 'public', type: 'table' },
    shape: 'metric+delta',
    aggregations: [{ fn: 'count', alias: 'n' }],
  };
}

const boundLayout: PageLayout = {
  version: 1,
  items: [
    {
      i: 'kpi-a',
      widget: 'kpi-stat-card',
      x: 0,
      y: 0,
      w: 3,
      h: 3,
      config: { title: 'Orders', binding: binding('orders') },
    },
    {
      i: 'kpi-b',
      widget: 'kpi-stat-card',
      x: 3,
      y: 0,
      w: 3,
      h: 3,
      config: { title: 'Customers', binding: binding('customers') },
    },
    {
      i: 'kpi-demo',
      widget: 'kpi-stat-card',
      x: 6,
      y: 0,
      w: 3,
      h: 3,
      config: { title: 'Demo card' }, // unbound → demo mode
    },
  ],
};

describe('PageDashboard', () => {
  it('renders the demo layout: 4 KPI cards + hero line-area + donut + mini-table slot', async () => {
    const { container } = render(<PageDashboard layout={demoDashboardLayout} />);
    expect(screen.getByTestId('page-dashboard')).toBeDefined();
    expect(container.querySelectorAll('[data-grid-item]')).toHaveLength(8);
    // Lazy family chunks resolve through Suspense.
    await waitFor(() => {
      expect(container.querySelectorAll('[data-widget="kpi-stat-card"]')).toHaveLength(4);
    });
    await waitFor(() => {
      expect(container.querySelector('[data-widget="chart-line-area"]')).not.toBeNull();
      expect(container.querySelector('[data-widget="chart-donut"]')).not.toBeNull();
      expect(container.querySelector('[data-widget="chart-bar"]')).not.toBeNull();
    });
    // Grid placement rides the --gi-* escape-hatch custom properties.
    const hero = container.querySelector('[data-grid-item="demo-hero-revenue"]') as HTMLElement;
    expect(hero.style.getPropertyValue('--gi-col')).toBe('1 / span 8');
    expect(hero.style.getPropertyValue('--gi-row')).toBe('4 / span 6');
  });

  it('sends every bound descriptor in ONE queryBatch call and resolves demo data for the rest', async () => {
    const queryBatch = vi.fn(async (requests: readonly WidgetQueryRequest[]) => {
      const out: Record<string, { status: 'success'; data: unknown }> = {};
      for (const request of requests) {
        out[request.instanceId] = { status: 'success', data: { value: 42, prior: 21 } };
      }
      return out;
    });
    const adapter: DashboardDataAdapter = { queryBatch };

    const { container } = render(
      <PageDashboard layout={boundLayout} adapter={adapter} params={{ 'dateRange.start': '2026-01-01' }} />,
    );

    await waitFor(() => {
      expect(queryBatch).toHaveBeenCalledTimes(1);
    });
    const [requests, params] = queryBatch.mock.calls[0] as unknown as [
      WidgetQueryRequest[],
      Record<string, unknown>,
    ];
    expect(requests.map((request) => request.instanceId)).toEqual(['kpi-a', 'kpi-b']);
    expect(requests[0]?.descriptor.source.name).toBe('orders');
    expect(params).toEqual({ 'dateRange.start': '2026-01-01' });

    await waitFor(() => {
      expect(container.querySelectorAll('[data-widget="kpi-stat-card"]').length).toBe(3);
    });
    expect(screen.getAllByText('42')).toHaveLength(2); // bound results
  });

  it('isolates per-item failures: one error state, siblings stay loaded', async () => {
    const adapter: DashboardDataAdapter = {
      queryBatch: async () => ({
        'kpi-a': { status: 'success', data: { value: 7 } },
        'kpi-b': { status: 'error', error: new Error('TABLE_FORBIDDEN') },
      }),
    };
    const { container } = render(<PageDashboard layout={boundLayout} adapter={adapter} />);
    await waitFor(() => {
      expect(container.querySelector('[data-grid-item="kpi-b"] [data-state="error"]')).not.toBeNull();
    });
    await waitFor(() => {
      expect(container.querySelector('[data-grid-item="kpi-a"] [data-state="loaded"]')).not.toBeNull();
    });
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDefined();
  });

  it('renders the widget-missing card for unknown ids and an alert for invalid layouts', async () => {
    const withUnknown: PageLayout = {
      version: 1,
      items: [
        { i: 'x1', widget: 'x-uninstalled-widget', x: 0, y: 0, w: 3, h: 3, config: {} },
      ],
    };
    const { container, rerender } = render(<PageDashboard layout={withUnknown} />);
    await waitFor(() => {
      expect(container.textContent).toContain('x-uninstalled-widget');
    });

    rerender(<PageDashboard layout={{ version: 99, items: 'nope' }} />);
    expect(screen.getByTestId('page-dashboard-invalid')).toBeDefined();
  });

  it('honors external state overrides (stories/tests) without an adapter', async () => {
    const { container } = render(
      <PageDashboard
        layout={boundLayout}
        states={{
          'kpi-a': { status: 'success', data: { value: 1234 } },
          'kpi-b': { status: 'loading' },
          'kpi-demo': { status: 'success', data: { value: 5 } },
        }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText('1,234')).toBeDefined();
    });
    expect(container.querySelector('[data-grid-item="kpi-b"] [data-state="skeleton"]')).not.toBeNull();
  });
});
