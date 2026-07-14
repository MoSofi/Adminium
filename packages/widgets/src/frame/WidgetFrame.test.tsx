// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
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
