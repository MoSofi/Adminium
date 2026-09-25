// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Where an app's Overview leads, through the real router:
 *
 *  - a link that opens a records page FILTERED (`?f.status=eq:active`): the
 *    server's answer rides every read of the list, each piece is a chip that
 *    can be taken away, and until the answer is in (or when it fails) the
 *    whole table is never shown in its place;
 *  - `@staff`: the owning app's staff screens, opened where the sidebar opens
 *    them — and no button at all for an app that has none.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AppSection } from '../app/bootstrap.js';
import { createQueryClient } from '../app/query.js';
import { createAppRouter } from '../app/router.js';
import { jsonResponse, makeBootstrap, makeCrudEnvelope, makeDashboardEnvelope } from '../test/fixtures.js';
import { andWhere, linkPiecesOf, searchWithout } from './linkFilters.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

interface Fixture {
  /** The link-filters answer; a function so a test can hold it back. */
  linkReply?: (body: { filters: { column: string; raw: string }[] }) => Promise<Response>;
  /** The staff screens of the app that owns the Overview (absent: no app). */
  staff?: AppSection['staff'];
  /** The Overview's toolbar link. */
  href?: string;
}

const APPLIED_WHERE = { and: [{ column: 'status', op: 'eq', value: 'active' }, { column: 'mrr', op: 'gt', value: 0 }] };

function stubFetch(fixture: Fixture) {
  const fetchMock = vi.fn().mockImplementation(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.startsWith('/api/v1/bootstrap')) {
      const bootstrap = makeBootstrap();
      bootstrap.nav.groups[0]?.items.push({
        pageId: 'page_overview',
        slug: 'overview',
        labelKey: 'nav.overview',
        fallback: 'Overview',
        icon: 'layout-dashboard',
        order: 3,
        ...(fixture.staff === undefined ? {} : { appKey: 'clients' }),
      });
      if (fixture.staff !== undefined) {
        bootstrap.appSections = [{ appKey: 'clients', label: 'Client Portal', version: '1.0.0', groups: [], staff: fixture.staff }];
      }
      return jsonResponse(200, { data: bootstrap });
    }
    if (url.startsWith('/api/v1/pages/page_customers')) return jsonResponse(200, { data: makeCrudEnvelope() });
    if (url.startsWith('/api/v1/pages/page_overview')) {
      const envelope = makeDashboardEnvelope();
      const layout = envelope.config['layout'] as Record<string, unknown>;
      const toolbar = { link: { label: 'Open the desk', href: fixture.href ?? '@staff', icon: 'external-link' } };
      return jsonResponse(200, { data: { ...envelope, config: { ...envelope.config, layout: { ...layout, toolbar } } } });
    }
    if (url === '/api/v1/widget-data/batch' && method === 'POST') {
      return jsonResponse(200, { results: { w1: { ok: true, result: { value: 42 }, cached: false } } });
    }
    if (url === '/api/v1/widget-data/link-filters' && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as { filters: { column: string; raw: string }[] };
      if (fixture.linkReply !== undefined) return fixture.linkReply(body);
      return jsonResponse(200, answerFor(body.filters));
    }
    if (url.startsWith('/api/v1/data/conn_1/public.customers') && method === 'GET') {
      return jsonResponse(200, { data: [{ id: 1, name: 'Northwind' }] });
    }
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope', requestId: 'req_t' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** What the server would say: status and mrr apply, anything else is not a column. */
function answerFor(filters: { column: string; raw: string }[]) {
  const where: unknown[] = [];
  const out = filters.map((filter) => {
    if (filter.column === 'status') where.push({ column: 'status', op: 'eq', value: 'active' });
    else if (filter.column === 'mrr') where.push({ column: 'mrr', op: 'gt', value: 0 });
    else return { ...filter, status: 'ignored', reason: 'unknown-column' };
    const [op, value] = filter.raw.split(':');
    return { ...filter, status: 'applied', op, value: value ?? null };
  });
  return { where: where.length === 0 ? null : where.length === 1 ? where[0] : { and: where }, filters: out };
}

async function renderAt(path: string, fixture: Fixture = {}) {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  const fetchMock = stubFetch(fixture);
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, { history: createMemoryHistory({ initialEntries: [path] }) });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, fetchMock };
}

/** Every `where` the list asked the data route for. */
const listWheres = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls
    .map((call) => String(call[0]))
    .filter((url) => url.startsWith('/api/v1/data/conn_1/public.customers') && !url.includes('offset='))
    .map((url) => {
      const where = new URLSearchParams(url.split('?')[1] ?? '').get('where');
      return where === null ? null : (JSON.parse(where) as unknown);
    });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the address of a filtered link', () => {
  it('keeps every other key, and reads a piece only as text', () => {
    // The router reads `?f.mrr=5` as a number and `?f.paid=true` as a boolean: spelled back as text.
    expect(linkPiecesOf({ tab: 2, 'f.mrr': 5, 'f.paid': true, 'f.status': ['eq:a', { x: 1 }], 'f.bad': { x: 1 } })).toEqual([
      { column: 'mrr', raw: '5' },
      { column: 'paid', raw: 'true' },
      { column: 'status', raw: 'eq:a' },
    ]);
    expect(linkPiecesOf({ tab: 2, 'f.status': ['eq:a', 'neq:b'], 'f.mrr': 'gt:0', 'f.': 'x' })).toEqual([
      { column: 'status', raw: 'eq:a' },
      { column: 'status', raw: 'neq:b' },
      { column: 'mrr', raw: 'gt:0' },
    ]);
    expect(searchWithout({ tab: 2, 'f.status': ['eq:a', 'neq:b'], 'f.mrr': 'gt:0' }, 1)).toEqual({ tab: 2, 'f.status': ['eq:a'], 'f.mrr': 'gt:0' });
    expect(searchWithout({ tab: 2, 'f.status': 'eq:a' }, 'all')).toEqual({ tab: 2 });
  });

  it('ANDs the link under the list’s own filter, flat', () => {
    const own = { and: [{ column: 'name', op: 'eq' as const, value: 'x' }] };
    expect(andWhere(APPLIED_WHERE as never, own)).toEqual({ and: [...APPLIED_WHERE.and, ...own.and] });
    expect(andWhere(APPLIED_WHERE as never, undefined)).toEqual(APPLIED_WHERE);
  });
});

describe('a records page opened from a filtered link', () => {
  it('reads the list through the server’s answer, and draws a chip per piece', async () => {
    const { fetchMock } = await renderAt('/p/customers?f.status=eq:active&f.mrr=gt:0&f.ghost=set');
    await screen.findByText('Northwind');
    const asked = fetchMock.mock.calls.find((call) => String(call[0]) === '/api/v1/widget-data/link-filters');
    expect(JSON.parse(String((asked?.[1] as RequestInit).body))).toEqual({
      connectionId: 'conn_1',
      table: 'public.customers',
      filters: [
        { column: 'status', raw: 'eq:active' },
        { column: 'mrr', raw: 'gt:0' },
        { column: 'ghost', raw: 'set' },
      ],
    });
    // Every read of the list carried the link's filter — none went out without it.
    const wheres = listWheres(fetchMock);
    expect(wheres.length).toBeGreaterThan(0);
    for (const where of wheres) expect(where).toEqual(APPLIED_WHERE);
    expect(screen.getAllByTestId('link-filter').map((chip) => chip.textContent)).toEqual(['status is active', 'mrr more than 0']);
    expect(screen.getByTestId('link-filter-ignored').textContent).toBe('Not filtered by ghost: this list has no such column');
  });

  it('takes a chip away from the address, and the list is read again without it', async () => {
    const { router, fetchMock } = await renderAt('/p/customers?f.status=eq:active&f.mrr=gt:0');
    await screen.findByText('Northwind');
    await userEvent.click(screen.getByRole('button', { name: 'Remove mrr filter' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ 'f.status': 'eq:active' }));
    await waitFor(() => expect(listWheres(fetchMock).at(-1)).toEqual({ column: 'status', op: 'eq', value: 'active' }));
  });

  it('shows no list at all until the answer is in', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { fetchMock } = await renderAt('/p/customers?f.status=eq:active', {
      linkReply: async (body) => {
        await held;
        return jsonResponse(200, answerFor(body.filters));
      },
    });
    await screen.findByTestId('link-filters-pending');
    expect(listWheres(fetchMock)).toEqual([]);
    release();
    await screen.findByText('Northwind');
    expect(listWheres(fetchMock).every((where) => where !== null)).toBe(true);
  });

  it('says so when the answer fails — and shows the whole list only when asked', async () => {
    const { router, fetchMock } = await renderAt('/p/customers?f.status=eq:active', {
      linkReply: async () => jsonResponse(500, { error: { code: 'INTERNAL', message: 'boom', requestId: 'req_x' } }),
    });
    await screen.findByText('This link’s filters could not be applied', {}, { timeout: 4000 });
    expect(listWheres(fetchMock)).toEqual([]);
    await userEvent.click(screen.getByTestId('link-filters-show-all'));
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    await screen.findByText('Northwind');
    expect(listWheres(fetchMock)).toEqual([null]);
  });
});

describe('“Open the desk” — the app’s staff screens', () => {
  it('opens an app placed on its own address in a new tab, as the sidebar does', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    await renderAt('/p/overview', { staff: { placement: 'external', url: 'https://desk.studio.test/' } });
    await userEvent.click(await screen.findByTestId('page-dashboard-link'));
    expect(open).toHaveBeenCalledWith('https://desk.studio.test/', '_blank', 'noopener,noreferrer');
  });

  it('routes to an app placed inside the dashboard', async () => {
    const { router } = await renderAt('/p/overview', {
      staff: { placement: 'internal', items: [{ id: 'desk', label: 'Desk', path: 'desk/today' }] as never },
    });
    await userEvent.click(await screen.findByTestId('page-dashboard-link'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/a/clients/desk/today'));
  });

  it('draws no button for an app without staff screens, or a page no app owns', async () => {
    await renderAt('/p/overview', { staff: null });
    await screen.findAllByText('42');
    expect(screen.queryByTestId('page-dashboard-link')).toBeNull();
    cleanup();
    await renderAt('/p/overview');
    await screen.findAllByText('42');
    expect(screen.queryByTestId('page-dashboard-link')).toBeNull();
  });

  it('keeps an ordinary route link as it was', async () => {
    const { router } = await renderAt('/p/overview', { href: '/p/customers?f.status=eq:active' });
    await userEvent.click(await screen.findByTestId('page-dashboard-link'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/p/customers'));
    expect(router.state.location.search).toEqual({ 'f.status': 'eq:active' });
  });
});
