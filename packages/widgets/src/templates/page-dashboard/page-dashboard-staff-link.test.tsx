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
