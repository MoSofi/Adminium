// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * A page link to `@staff` — the owning app's staff screens — is drawn only
 * when the host says it can open it. A host that cannot, or that does not
 * answer at all, gets no button: never one that goes nowhere.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PageDashboard } from './PageDashboard.js';
import type { PageLayout } from '../../page-config/index.js';

afterEach(cleanup);

const layout = (href: string): PageLayout => ({
  version: 1,
  items: [],
  toolbar: { link: { label: 'Open the desk', href, icon: 'external-link' } },
});

describe('a page link to the app’s staff screens', () => {
  it('is drawn when the host can open it, and hands the host `@staff`', () => {
    const onEvent = vi.fn();
    render(<PageDashboard layout={layout('@staff')} states={{}} onEvent={onEvent} linkAvailable={(href) => href === '@staff'} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open the desk' }));
    expect(onEvent).toHaveBeenCalledWith('__toolbar', { type: 'drill-through', href: '@staff' });
  });

  it('is not drawn when the host cannot, or does not say', () => {
    render(<PageDashboard layout={layout('@staff')} states={{}} linkAvailable={() => false} />);
    expect(screen.queryByTestId('page-dashboard-link')).toBeNull();
    cleanup();
    render(<PageDashboard layout={layout('@staff')} states={{}} />);
    expect(screen.queryByTestId('page-dashboard-link')).toBeNull();
  });

  it('leaves an ordinary route link drawn, with or without an answer', () => {
    render(<PageDashboard layout={layout('/p/invoices?f.balance=gt:0')} states={{}} />);
    expect(screen.getByTestId('page-dashboard-link')).toBeDefined();
  });
});

describe('one link or two', () => {
  const two = (first: string, second: string): PageLayout => ({
    version: 1,
    items: [],
    toolbar: { links: [{ label: 'Receive', labels: { 'de-DE': 'Annehmen' }, href: first, icon: 'package-plus', tone: 'primary' }, { label: 'Count', href: second, icon: 'clipboard-check' }] },
  });

  it('draws two links in the order written, the primary one as the primary button', () => {
    const onEvent = vi.fn();
    render(<PageDashboard layout={two('/add-ons/inventory/receive', '/add-ons/inventory/counts')} states={{}} onEvent={onEvent} />);
    const buttons = screen.getAllByTestId('page-dashboard-link');
    expect(buttons.map((button) => button.textContent)).toEqual(['Receive', 'Count']);
    expect(buttons[0]!.className).toContain('bg-accent');
    expect(buttons[1]!.className).not.toContain('bg-accent ');
    expect(buttons[1]!.className).toContain('bg-surface');
    fireEvent.click(buttons[1]!);
    expect(onEvent).toHaveBeenCalledWith('__toolbar', { type: 'drill-through', href: '/add-ons/inventory/counts' });
  });

  it('a link the host says is unavailable is not drawn; the other is', () => {
    render(<PageDashboard layout={two('/add-ons/inventory/receive', '/add-ons/inventory/counts')} states={{}} linkAvailable={(href) => href.endsWith('/counts')} />);
    expect(screen.getAllByTestId('page-dashboard-link').map((button) => button.textContent)).toEqual(['Count']);
    cleanup();
    render(<PageDashboard layout={two('/a', '/b')} states={{}} linkAvailable={() => false} />);
    expect(screen.queryByTestId('page-dashboard-link')).toBeNull();
    expect(document.querySelector('[data-part="page-dashboard-links"]')).toBeNull();
  });

  it('the single link of a released page is a secondary button, as it was', () => {
    render(<PageDashboard layout={layout('/p/invoices')} states={{}} />);
    expect(screen.getByTestId('page-dashboard-link').className).toContain('bg-surface');
  });
});
