// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ResourceBundle } from '@adminium/i18n';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { WidgetFrame } from './WidgetFrame.js';
import type { WidgetSkeleton } from '../registry/types.js';

function frameEl(): HTMLElement {
  const el = document.querySelector('[data-widget-frame]');
  if (!(el instanceof HTMLElement)) throw new Error('frame not rendered');
  return el;
}

describe('WidgetFrame states (04 §4)', () => {
  it('loaded renders children inside the frame', () => {
    render(
      <WidgetFrame state="loaded" title="Orders">
        <div>widget body</div>
      </WidgetFrame>,
    );
    expect(frameEl().getAttribute('data-state')).toBe('loaded');
    expect(screen.getByText('widget body')).toBeDefined();
    expect(screen.getByText('Orders')).toBeDefined();
  });

  it.each(['card', 'chart', 'table', 'list', 'block'] as WidgetSkeleton[])(
    'skeleton renders the %s silhouette',
    (variant) => {
      render(<WidgetFrame state="skeleton" skeleton={variant} />);
      expect(frameEl().getAttribute('data-state')).toBe('skeleton');
      const silhouette = document.querySelector('[data-skeleton-variant]');
      expect(silhouette?.getAttribute('data-skeleton-variant')).toBe(variant);
      expect(silhouette?.getAttribute('aria-busy')).toBe('true');
    },
  );

  it('empty renders the default copy "No data for range"', () => {
    render(<WidgetFrame state="empty" title="Orders" />);
    expect(frameEl().getAttribute('data-state')).toBe('empty');
    expect(screen.getByText('No data for range')).toBeDefined();
  });

  it('empty copy is overridable via the empty prop (config.emptyState)', () => {
    render(<WidgetFrame state="empty" empty={{ title: 'All caught up', body: 'Nothing pending.' }} />);
    expect(screen.getByText('All caught up')).toBeDefined();
    expect(screen.getByText('Nothing pending.')).toBeDefined();
    expect(screen.queryByText('No data for range')).toBeNull();
  });

  it('error renders the message and a Retry button firing onRetry', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<WidgetFrame state="error" errorMessage="Query timed out" onRetry={onRetry} />);
    expect(frameEl().getAttribute('data-state')).toBe('error');
    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.getByText('Query timed out')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('error state without onRetry renders no Retry button', () => {
    render(<WidgetFrame state="error" />);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('a render throw inside loaded children degrades to the error card (error boundary)', async () => {
    const user = userEvent.setup();
    const onRenderError = vi.fn();
    const onRetry = vi.fn();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    function Boom(): never {
      throw new Error('widget render exploded');
    }
    render(
      <WidgetFrame state="loaded" title="Boom" onRetry={onRetry} onRenderError={onRenderError}>
        <Boom />
      </WidgetFrame>,
    );
    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.getByText('widget render exploded')).toBeDefined();
    expect(onRenderError).toHaveBeenCalledTimes(1);
    // Retry resets the boundary and re-runs the query hook.
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('stale-while-revalidate: refetching keeps loaded and shows a header spinner', () => {
    render(
      <WidgetFrame state="loaded" title="Orders" refetching>
        <div>widget body</div>
      </WidgetFrame>,
    );
    expect(frameEl().getAttribute('data-state')).toBe('loaded');
    expect(screen.getByText('widget body')).toBeDefined();
    expect(screen.getByRole('status', { name: 'Refreshing' })).toBeDefined();
  });

  it('renders the drag-grip render prop at the header start', () => {
    render(
      <WidgetFrame state="loaded" title="Orders" dragGrip={() => <span data-testid="grip" />}>
        <div>body</div>
      </WidgetFrame>,
    );
    expect(screen.getByTestId('grip')).toBeDefined();
  });

  it('frameless variant renders states without card chrome (page placement)', () => {
    render(<WidgetFrame state="skeleton" frameless skeleton="block" />);
    const el = frameEl();
    expect(el.className).not.toContain('shadow-card');
  });
});

describe('frame chrome localization (ui:frame.* + empty-state key translator)', () => {
  async function providerWith(bundle: ResourceBundle) {
    const { createI18n } = await import('@adminium/i18n');
    const { I18nProvider } = await import('@adminium/i18n/react');
    const i18n = await createI18n({
      locale: 'de_DE',
      loadBundle: async (_tag, ns) => (ns === 'ui' ? bundle : null),
    });
    return function Provider({ children }: { children: ReactNode }) {
      return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
    };
  }

  it('resolves bundle strings inside I18nProvider and falls back to English outside', async () => {
    const Provider = await providerWith({
      action: { retry: 'Erneut versuchen' },
      frame: { emptyTitle: 'Keine Daten im Zeitraum' },
    });
    render(
      <Provider>
        <WidgetFrame state="empty" title="Orders" />
      </Provider>,
    );
    expect(screen.getByText('Keine Daten im Zeitraum')).toBeDefined();
    cleanup();
    render(
      <Provider>
        <WidgetFrame state="error" onRetry={() => {}} />
      </Provider>,
    );
    expect(screen.getByRole('button', { name: 'Erneut versuchen' })).toBeDefined();

    cleanup();
    render(<WidgetFrame state="empty" title="Orders" />);
    expect(screen.getByText('No data for range')).toBeDefined();
  });

  it('empty-state translator: key-shaped copy resolves via the bundle, plain copy renders verbatim', async () => {
    const Provider = await providerWith({
      widgets: { charts: { bullet: { emptyTitle: 'Keine Ziele', emptyBody: 'Kennzahlen mit Zielwerten ergänzen.' } } },
    });
    render(
      <Provider>
        <WidgetFrame
          state="empty"
          empty={{ title: 'widgets.charts.bullet.emptyTitle', body: 'widgets.charts.bullet.emptyBody' }}
        />
      </Provider>,
    );
    expect(screen.getByText('Keine Ziele')).toBeDefined();
    expect(screen.getByText('Kennzahlen mit Zielwerten ergänzen.')).toBeDefined();

    // Plain (non-key-shaped) config copy is untouched, even under the provider.
    cleanup();
    render(
      <Provider>
        <WidgetFrame state="empty" empty={{ title: 'All caught up', body: 'Nothing pending.' }} />
      </Provider>,
    );
    expect(screen.getByText('All caught up')).toBeDefined();
    expect(screen.getByText('Nothing pending.')).toBeDefined();
  });

  it('empty-state translator outside a provider humanizes an unresolvable key instead of leaking it', () => {
    render(<WidgetFrame state="empty" empty={{ title: 'widgets.charts.bullet.emptyTitle' }} />);
    expect(screen.getByText('Empty title')).toBeDefined();
    expect(screen.queryByText('widgets.charts.bullet.emptyTitle')).toBeNull();
  });
});
