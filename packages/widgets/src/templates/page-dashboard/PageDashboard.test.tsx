// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * page-dashboard template tests: renders a fixture layout on the static
 * grid with per-instance data states, resolves demo mode for unbound
 * widgets, batches all bound descriptors into ONE adapter call, isolates
 * per-item failures, and survives invalid layouts + unknown widget ids
 * (widget-missing fallback, never a crash).
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

describe('dashboard chrome localization (ui:templates.dashboard.* / ui:frame.noResult)', () => {
  it('resolves bundle strings inside I18nProvider and falls back to English outside', async () => {
    const { createI18n } = await import('@adminium/i18n');
    const { I18nProvider } = await import('@adminium/i18n/react');
    const i18n = await createI18n({
      locale: 'de_DE',
      loadBundle: async (_tag, ns) =>
        ns === 'ui'
          ? {
              templates: { dashboard: { invalidLayout: 'Das gespeicherte Layout dieses Dashboards ist ungültig.' } },
              frame: { noResult: 'Kein Ergebnis für dieses Widget' },
            }
          : null,
    });
    // A batch reply missing every requested instance → the data-adapter's
    // frame.noResult error surfaces through the widget frame.
    const emptyAdapter: DashboardDataAdapter = { queryBatch: async () => ({}) };
    render(
      <I18nProvider i18n={i18n}>
        <PageDashboard layout={{ version: 99, items: 'nope' }} />
        <PageDashboard layout={boundLayout} adapter={emptyAdapter} />
      </I18nProvider>,
    );
    expect(screen.getByTestId('page-dashboard-invalid').textContent).toBe(
      'Das gespeicherte Layout dieses Dashboards ist ungültig.',
    );
    await waitFor(() => {
      expect(screen.getAllByText('Kein Ergebnis für dieses Widget').length).toBeGreaterThan(0);
    });

    cleanup();
    render(
      <>
        <PageDashboard layout={{ version: 99, items: 'nope' }} />
        <PageDashboard layout={boundLayout} adapter={emptyAdapter} />
      </>,
    );
    expect(screen.getByTestId('page-dashboard-invalid').textContent).toBe(
      'This dashboard’s stored layout is invalid. Regenerate the page or reset its layout.',
    );
    await waitFor(() => {
      expect(screen.getAllByText('No result for widget').length).toBeGreaterThan(0);
    });
  });
});

describe('the page day control', () => {
  it('draws only when the layout asks, starts on today, and re-asks every binding for the day picked', async () => {
    const queryBatch = vi.fn<DashboardDataAdapter['queryBatch']>(async (requests) =>
      Object.fromEntries(requests.map((r) => [r.instanceId, { status: 'success' as const, data: { shape: 'metric+delta', value: 1 } }])),
    );
    const { rerender } = render(<PageDashboard layout={boundLayout} adapter={{ queryBatch }} />);
    expect(screen.queryByTestId('page-dashboard-day')).toBeNull();

    rerender(<PageDashboard layout={{ ...boundLayout, toolbar: { day: true } }} adapter={{ queryBatch }} params={{ other: 1 }} />);
    await waitFor(() => expect(queryBatch.mock.calls.at(-1)?.[1]).toEqual({ other: 1, day: 'today' }));

    screen.getByRole('radio', { name: 'Yesterday' }).click();
    await waitFor(() => expect(queryBatch.mock.calls.at(-1)?.[1]).toEqual({ other: 1, day: 'yesterday' }));
    screen.getByRole('radio', { name: 'This week' }).click();
    await waitFor(() => expect(queryBatch.mock.calls.at(-1)?.[1]).toEqual({ other: 1, day: 'week' }));
    // "Pick a day" is a fourth segment that opens a popover; Cancel changes nothing …
    const asked = queryBatch.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Pick a day' }));
    fireEvent.change(await screen.findByLabelText('Pick a day'), { target: { value: '2026-09-20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByLabelText('Pick a day')).toBeNull());
    expect(queryBatch.mock.calls.length).toBe(asked);
    // … "Show day" shows it, and the trigger then names the day.
    fireEvent.click(screen.getByRole('button', { name: 'Pick a day' }));
    fireEvent.change(await screen.findByLabelText('Pick a day'), { target: { value: '2026-09-20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Show day' }));
    await waitFor(() => expect(queryBatch.mock.calls.at(-1)?.[1]).toEqual({ other: 1, day: '2026-09-20' }));
    expect(screen.getByRole('button', { name: /20/ }).getAttribute('data-part')).toBe('day-pick');
    cleanup();
  });
});

describe('the page’s link, currency and languages', () => {
  const money: PageLayout = {
    version: 1,
    items: [
      { i: 'taken', widget: 'kpi-stat-card', x: 0, y: 0, w: 3, h: 3, config: { title: 'Taken', titles: { 'de-DE': 'Eingenommen', fr: 'Encaissé' }, metricFormat: 'currency' } },
      { i: 'dollars', widget: 'kpi-stat-card', x: 3, y: 0, w: 3, h: 3, config: { title: 'Dollars', metricFormat: 'currency', format: { currency: 'USD' } } },
    ],
  };
  const states = {
    taken: { status: 'success' as const, data: { value: 40 } },
    dollars: { status: 'success' as const, data: { value: 40 } },
  };

  it('draws a money card in the connection’s currency unless it names its own', async () => {
    render(<PageDashboard layout={money} states={states} currency="GBP" />);
    expect(await screen.findByText(/£40/)).toBeDefined();
    expect(await screen.findByText(/\$40/)).toBeDefined();
    cleanup();
  });

  it('titles a card in the page’s language, the same language in another region, else its own title', async () => {
    const { createI18n } = await import('@adminium/i18n');
    const { I18nProvider } = await import('@adminium/i18n/react');
    for (const [locale, title] of [['de_DE', 'Eingenommen'], ['fr_FR', 'Encaissé'], ['da_DK', 'Taken']] as const) {
      const i18n = await createI18n({ locale, loadBundle: async () => null });
      render(
        <I18nProvider i18n={i18n}>
          <PageDashboard layout={money} states={states} />
        </I18nProvider>,
      );
      expect(screen.getByText(title)).toBeDefined();
      cleanup();
    }
  });

  it('ends its controls with one link the host opens, named in the page’s language', async () => {
    const onEvent = vi.fn();
    const withLink: PageLayout = { ...money, toolbar: { day: true, link: { label: 'Open the desk', labels: { 'de-DE': 'Zum Empfang' }, href: '/p/clinic-day' } } };
    render(<PageDashboard layout={withLink} states={states} onEvent={onEvent} day="today" onDay={() => undefined} />);
    const controls = screen.getByTestId('page-dashboard-day');
    const link = screen.getByRole('button', { name: 'Open the desk' });
    expect(controls.contains(link)).toBe(true);
    fireEvent.click(link);
    expect(onEvent).toHaveBeenCalledWith('__toolbar', { type: 'drill-through', href: '/p/clinic-day' });
    cleanup();
    // Without a day control it still stands, alone; in German it says so.
    const { createI18n } = await import('@adminium/i18n');
    const { I18nProvider } = await import('@adminium/i18n/react');
    const i18n = await createI18n({ locale: 'de_DE', loadBundle: async () => null });
    render(
      <I18nProvider i18n={i18n}>
        <PageDashboard layout={{ ...withLink, toolbar: { link: withLink.toolbar!.link! } }} states={states} onEvent={onEvent} />
      </I18nProvider>,
    );
    expect(screen.queryByTestId('page-dashboard-day')).toBeNull();
    expect(screen.getByRole('button', { name: 'Zum Empfang' })).toBeDefined();
    cleanup();
  });
});
