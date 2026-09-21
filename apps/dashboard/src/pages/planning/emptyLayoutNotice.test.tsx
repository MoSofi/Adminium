// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The blank-page backstop. A board/calendar/scheduler page created without a
 * table stores `layout: { items: [] }`, and those three templates render their
 * whole body through `DashboardGrid` — an empty grid is an empty SCREEN. These
 * cover the predicate that detects it, the binding that swaps the template out
 * for the notice, and who is offered the way out of it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactElement } from 'react';
import type { PageEnvelope } from '@adminium/engine/config';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { bootstrapQuery } from '../../app/bootstrap.js';
import { makeBootstrap } from '../../test/fixtures.js';
import { PageCalendarBinding } from '../PageCalendarBinding.js';
import type { PageTemplateProps } from '../template-types.js';
import { EmptyLayoutNotice, layoutIsEmpty } from './EmptyLayoutNotice.js';

const navigate = vi.fn();

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return { ...actual, useNavigate: () => navigate };
});

const ADAPTERS: PageTemplateProps['adapters'] = {
  crud: null,
  dashboard: null,
  onEvent: () => undefined,
  openRecord: () => undefined,
  notifyUndoable: () => undefined,
};

function page(items: unknown[]): PageEnvelope {
  return {
    v: 1,
    kind: 'page',
    id: 'page_cal',
    template: 'page-calendar',
    title: { key: 'nav.calendar', fallback: 'Calendar' },
    source: { connectionId: null, table: null },
    nav: { group: 'planning', icon: 'calendar', order: 10, slug: 'calendar' },
    access: { minRole: 'viewer', permissions: [] },
    config: { templateVersion: 1, toolbar: [], overlays: [], layout: { version: 1, items } },
  } as unknown as PageEnvelope;
}

function renderWith(ui: ReactElement, roles: string[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(bootstrapQuery().queryKey, makeBootstrap({ roles }));
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

afterEach(() => {
  navigate.mockReset();
  vi.unstubAllGlobals();
});

describe('layoutIsEmpty', () => {
  it('is true for the body the create route stores for an unbound page', () => {
    expect(
      layoutIsEmpty({ templateVersion: 1, toolbar: [], overlays: [], layout: { version: 1, items: [] } }),
    ).toBe(true);
  });

  it('is false once the layout holds an item', () => {
    expect(layoutIsEmpty({ layout: { version: 1, items: [{ i: 'calendar' }] } })).toBe(false);
  });

  it('is false for a MALFORMED layout, which is the template’s own alert to give', () => {
    // "Regenerate the page" and "bind a table" are different instructions;
    // claiming the second one for an invalid document would misdirect.
    expect(layoutIsEmpty({ layout: 'not an object' })).toBe(false);
    expect(layoutIsEmpty({ layout: { version: 1 } })).toBe(false);
    expect(layoutIsEmpty({})).toBe(false);
    expect(layoutIsEmpty(null)).toBe(false);
  });
});

describe('EmptyLayoutNotice', () => {
  it('names what the template needs and offers page settings to an admin', async () => {
    renderWith(<EmptyLayoutNotice pageId="page_cal" template="calendar" />, ['admin']);

    expect(screen.getByText('This page has nothing to show yet')).toBeTruthy();
    expect(screen.getByText(/a table with a date column/)).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Open page settings' }));
    expect(navigate).toHaveBeenCalledWith({
      to: '/studio/pages/$pageId',
      params: { pageId: 'page_cal' },
    });
  });

  it('sends a viewer to an administrator instead of to the Studio guard', () => {
    renderWith(<EmptyLayoutNotice pageId="page_cal" template="board" />, ['viewer']);

    expect(screen.queryByRole('button', { name: 'Open page settings' })).toBeNull();
    expect(screen.getByText(/Ask an administrator to finish setting it up\./)).toBeTruthy();
  });

  it('describes the board and the scheduler in their own terms', () => {
    const { unmount } = renderWith(
      <EmptyLayoutNotice pageId="page_b" template="board" />,
      ['admin'],
    );
    expect(screen.getByText(/a status column/)).toBeTruthy();
    unmount();

    renderWith(<EmptyLayoutNotice pageId="page_s" template="scheduler" />, ['admin']);
    expect(screen.getByText(/a person to schedule/)).toBeTruthy();
  });
});

describe('PageCalendarBinding', () => {
  it('renders the notice instead of a blank grid when the layout is empty', () => {
    vi.stubGlobal('fetch', vi.fn());
    renderWith(<PageCalendarBinding page={page([])} adapters={ADAPTERS} />, ['admin']);

    expect(screen.getByTestId('page-empty-layout')).toBeTruthy();
    expect(screen.queryByTestId('page-calendar')).toBeNull();
  });
});
