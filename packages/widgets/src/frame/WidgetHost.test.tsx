// SPDX-License-Identifier: AGPL-3.0-only
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

/**
 * The `capabilities.exportPng` gate. 42 definitions advertise the flag, and
 * until the kebab existed it meant nothing: `WidgetFrame.menu` had no producer
 * anywhere in the repo and the single explicit pass in the tree was
 * `menu={undefined}`. These pin the flag to a real, clickable item — and pin
 * the negative case, so the flag cannot quietly go back to being decorative.
 */
describe('capabilities.exportPng → the kebab Download item', () => {
  const loaded: WidgetDataState = { status: 'success', data: { value: 7 }, refetch: () => {} };

  const exporting = buildRegistry([
    widgetMissingDefinition,
    makeTestDefinition({ capabilities: { exportPng: true } }),
  ]);

  function renderHost(map: ReadonlyMap<string, ReturnType<typeof makeTestDefinition>>, props = {}) {
    return render(
      <WidgetHost
        registry={map}
        widgetId="test-stat-card"
        instanceId="w-export"
        config={{ title: 'Revenue by region' }}
        data={loaded}
        onEvent={() => {}}
        {...props}
      />,
    );
  }

  it('renders no kebab at all when the definition does not advertise exportPng', () => {
    // The base fixture has no `capabilities`, so the header must stay
    // menu-less — `hasHeader` counts `menu !== undefined`, and an empty
    // dropdown trigger would be its own dead control.
    renderHost(registry);
    expect(screen.queryByRole('button', { name: 'Widget menu' })).toBeNull();
  });

  it('renders a kebab carrying a Download item when the flag is set', async () => {
    renderHost(exporting);
    const kebab = screen.getByRole('button', { name: 'Widget menu' });
    await userEvent.click(kebab);
    expect(await screen.findByText('Download')).toBeTruthy();
  });

  it('selecting Download rasterizes the frame’s own svg and hands over a stamped .png', async () => {
    // The frame renders no chart of its own here, so the widget body supplies
    // one — this asserts the containerRef actually reaches the rendered graphic.
    const png = new Blob(['png'], { type: 'image/png' });
    const context = { drawImage: vi.fn(), fillRect: vi.fn(), fillStyle: '' };
    const canvas = { width: 0, height: 0, getContext: () => context, toBlob: (cb: (b: Blob) => void) => cb(png) };
    const anchors: HTMLAnchorElement[] = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'canvas') return canvas as unknown as HTMLCanvasElement;
      const node = realCreate(tag);
      if (tag === 'a') {
        (node as HTMLAnchorElement).click = vi.fn();
        anchors.push(node as HTMLAnchorElement);
      }
      return node;
    });
    const handed: Blob[] = [];
    const createObjectURL = vi.fn((blob: Blob) => {
      handed.push(blob);
      return 'blob:png';
    });
    vi.stubGlobal('URL', Object.assign(Object.create(URL), { createObjectURL, revokeObjectURL: vi.fn() }));
    vi.stubGlobal(
      'Image',
      class {
        listeners: Record<string, () => void> = {};
        addEventListener(event: string, handler: () => void) {
          this.listeners[event] = handler;
        }
        set src(_value: string) {
          queueMicrotask(() => this.listeners['load']?.());
        }
      },
    );

    renderHost(exporting);
    // Put a graphic inside the frame the host owns.
    const frame = document.querySelector('[data-widget-frame]') as HTMLElement;
    const graphic = realCreate('div');
    // Parsed, not assigned as raw markup: packages/llm's injection.test.ts
    // scans this tree for raw-HTML sinks and counts one wherever it appears,
    // test file or not.
    graphic.append(
      new DOMParser().parseFromString('<svg viewBox="0 0 200 100"><rect /></svg>', 'image/svg+xml')
        .documentElement,
    );
    frame.append(graphic);

    await userEvent.click(screen.getByRole('button', { name: 'Widget menu' }));
    await userEvent.click(await screen.findByText('Download'));

    await vi.waitFor(() => {
      expect(createObjectURL).toHaveBeenCalledWith(png);
    });
    // The instance title becomes the filename slug, not the widget id.
    expect(anchors[0]?.getAttribute('download')).toMatch(/^Revenue-by-region-\d{8}-\d{4}\.png$/);

    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('warns rather than throwing when the widget has no graphic to rasterize', async () => {
    // The flag is the gate, so a flagged widget that renders no svg is a
    // capability-flag bug — it must degrade to a console warning, never an
    // unhandled rejection that takes the dashboard down.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderHost(exporting);
    await userEvent.click(screen.getByRole('button', { name: 'Widget menu' }));
    await userEvent.click(await screen.findByText('Download'));

    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith('[widgets] PNG export failed', expect.objectContaining({ widgetId: 'test-stat-card' }));
    });
    warn.mockRestore();
  });

  it('keeps host-supplied menu items, appending them after the capability item', async () => {
    renderHost(exporting, { menu: <span data-testid="host-item">Remove</span> });
    await userEvent.click(screen.getByRole('button', { name: 'Widget menu' }));
    expect(await screen.findByText('Download')).toBeTruthy();
    expect(screen.getByTestId('host-item')).toBeTruthy();
  });

  it('still renders a host menu when the definition has no exportPng flag', async () => {
    renderHost(registry, { menu: <span data-testid="host-item">Remove</span> });
    await userEvent.click(screen.getByRole('button', { name: 'Widget menu' }));
    expect(screen.getByTestId('host-item')).toBeTruthy();
    expect(screen.queryByText('Download')).toBeNull();
  });
});
