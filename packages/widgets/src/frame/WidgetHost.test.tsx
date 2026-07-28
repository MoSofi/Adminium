// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { buildRegistry } from '../registry/index.js';
import { widgetMissingDefinition } from '../registry/widget-missing.js';
import { makeTestDefinition } from '../test/fixtures.js';
import { WidgetHost } from './WidgetHost.js';
import type { WidgetDataState } from './WidgetHost.js';

const registry = buildRegistry([widgetMissingDefinition, makeTestDefinition()]);

const successData: WidgetDataState = {
  status: 'success',
  data: { value: 42, deltaPct: 3.2 },
  refetch: () => {},
};

function hostState(): string | null {
  return document.querySelector('[data-widget-frame]')?.getAttribute('data-state') ?? null;
}

describe('WidgetHost', () => {
  it('binds definition + config + data and renders the lazy component (Suspense)', async () => {
    render(
      <WidgetHost
        widgetId="test-stat-card"
        instanceId="inst-1"
        config={{ title: 'Revenue', metricLabel: 'MRR' }}
        data={successData}
        registry={registry}
      />,
    );
    // Lazy chunk resolves through Suspense → component visible.
    expect(await screen.findByTestId('test-widget')).toBeDefined();
    expect(hostState()).toBe('loaded');
    expect(screen.getByText('MRR')).toBeDefined();
    expect(screen.getByText('Revenue')).toBeDefined();
    expect(screen.getByTestId('test-widget').getAttribute('data-instance')).toBe('inst-1');
  });

  it('forwards widget events to onEvent', async () => {
    const user = userEvent.setup();
    const onEvent = vi.fn();
    render(
      <WidgetHost
        widgetId="test-stat-card"
        instanceId="inst-2"
        config={{}}
        data={successData}
        onEvent={onEvent}
        registry={registry}
      />,
    );
    await user.click(await screen.findByRole('button', { name: 'Open' }));
    expect(onEvent).toHaveBeenCalledWith({ type: 'drill-through', href: '/p/orders' });
  });

  it('loading → skeleton silhouette from the definition', () => {
    render(
      <WidgetHost
        widgetId="test-stat-card"
        instanceId="inst-3"
        config={{}}
        data={{ status: 'loading' }}
        registry={registry}
      />,
    );
    expect(hostState()).toBe('skeleton');
    expect(document.querySelector('[data-skeleton-variant]')?.getAttribute('data-skeleton-variant')).toBe('card');
  });

  it('error → error card; Retry re-issues refetch', async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();
    render(
      <WidgetHost
        widgetId="test-stat-card"
        instanceId="inst-4"
        config={{}}
        data={{ status: 'error', error: new Error('COLUMN_FORBIDDEN'), refetch }}
        registry={registry}
      />,
    );
    expect(hostState()).toBe('error');
    expect(screen.getByText('COLUMN_FORBIDDEN')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('success with empty payload (per dataContract) → empty state', () => {
    render(
      <WidgetHost
        widgetId="test-stat-card"
        instanceId="inst-5"
        config={{}}
        data={{ status: 'success', data: null }}
        registry={registry}
      />,
    );
    expect(hostState()).toBe('empty');
    expect(screen.getByText('No data for range')).toBeDefined();
  });

  it('empty copy honors config.emptyState override (key paths resolve, never render raw)', () => {
    render(
      <WidgetHost
        widgetId="test-stat-card"
        instanceId="inst-6"
        config={{ emptyState: { titleKey: 'widgets.empty.allCaughtUp' } }}
        data={{ status: 'success', data: null }}
        registry={registry}
      />,
    );
    // Key-shaped copy goes through the frame's empty-state translator; outside
    // a provider that yields the humanized leaf, never the raw key path.
    expect(screen.getByText('All caught up')).toBeDefined();
    expect(screen.queryByText('widgets.empty.allCaughtUp')).toBeNull();
  });

  it('empty copy honors a plain-text config.emptyState override verbatim', () => {
    render(
      <WidgetHost
        widgetId="test-stat-card"
        instanceId="inst-6b"
        config={{ emptyState: { titleKey: 'Queue drained' } }}
        data={{ status: 'success', data: null }}
        registry={registry}
      />,
    );
    expect(screen.getByText('Queue drained')).toBeDefined();
  });

  it('unknown widget id renders the widget-missing card naming the id (04 §2.2)', async () => {
    render(
      <WidgetHost
        widgetId="x-uninstalled-widget"
        instanceId="inst-7"
        config={{}}
        data={{ status: 'loading' }}
        registry={registry}
      />,
    );
    expect(await screen.findByText('x-uninstalled-widget')).toBeDefined();
    expect(screen.getByText('Widget unavailable')).toBeDefined();
    expect(hostState()).toBe('loaded');
  });

  it('invalid config logs one structured warning and still renders with defaults', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(
      <WidgetHost
        widgetId="test-stat-card"
        instanceId="inst-8"
        config={{ refreshInterval: 1, metricLabel: 123 }}
        data={successData}
        registry={registry}
      />,
    );
    expect(await screen.findByTestId('test-widget')).toBeDefined();
    // metricLabel fell back to its schema default.
    expect(screen.getByText('Total')).toBeDefined();
    expect(warn).toHaveBeenCalledWith(
      '[widgets] invalid instance config',
      expect.objectContaining({
        instanceId: 'inst-8',
        warnings: expect.arrayContaining([
          expect.objectContaining({ path: 'refreshInterval' }),
          expect.objectContaining({ path: 'metricLabel' }),
        ]),
      }),
    );
    warn.mockRestore();
  });

  it('stale-while-revalidate: isRefetching shows spinner, keeps loaded', async () => {
    render(
      <WidgetHost
        widgetId="test-stat-card"
        instanceId="inst-9"
        config={{}}
        data={{ ...successData, isRefetching: true }}
        registry={registry}
      />,
    );
    expect(await screen.findByTestId('test-widget')).toBeDefined();
    expect(screen.getByRole('status', { name: 'Refreshing' })).toBeDefined();
  });
});

describe('info popover descriptionKey resolution', () => {
  const loadedData: WidgetDataState = { status: 'success', data: { value: 7 }, refetch: () => {} };

  it('never renders the raw key: dangling keys fall back to the humanized widget id', async () => {
    render(
      <WidgetHost
        registry={registry}
        widgetId="test-stat-card"
        instanceId="w1"
        config={{}}
        data={loadedData}
        onEvent={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Widget info' }));
    expect(screen.queryByText('widgets.test.statCard.description')).toBeNull();
    expect(screen.getByText('Test stat card')).toBeTruthy();
  });

  it('resolves the descriptionKey from the bundle under an I18nProvider', async () => {
    const { createI18n } = await import('@adminium/i18n');
    const { I18nProvider } = await import('@adminium/i18n/react');
    const i18n = await createI18n({
      locale: 'de_DE',
      loadBundle: async (_tag, ns) =>
        ns === 'ui' ? { widgets: { test: { statCard: { description: 'Die Testkarte.' } } } } : null,
    });
    render(
      <I18nProvider i18n={i18n}>
        <WidgetHost
          registry={registry}
          widgetId="test-stat-card"
          instanceId="w2"
          config={{}}
          data={loadedData}
          onEvent={() => {}}
        />
      </I18nProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Widget info' }));
    expect(screen.getByText('Die Testkarte.')).toBeTruthy();
  });
});
