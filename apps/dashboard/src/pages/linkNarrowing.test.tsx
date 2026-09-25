// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A link's narrowing on the templates that read their rows through layout
 * queries — the inbox and the master-detail list here, through the real
 * router; every other such template takes the same three calls.
 *
 * Worth proving: every query over the page's own table carries the server's
 * narrowing (the list and the counts beside it) and a query over another table
 * does not; nothing is read before the answer is in, nor after it failed; each
 * piece is a chip that can be taken away; a narrowing that cannot be carried
 * shows the failure, never the wider list.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PageEnvelope } from '@adminium/engine/config';

import { createQueryClient } from '../app/query.js';
import { createAppRouter } from '../app/router.js';
import { jsonResponse, makeBootstrap } from '../test/fixtures.js';
import { narrowLayout } from './linkNarrowing.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

const query = (name: string, extra: Record<string, unknown> = {}) => ({
  kind: 'table-query',
  connectionId: 'conn_1',
  source: { name, schema: 'public', type: 'table' },
  shape: 'record-list',
  limit: 50,
  ...extra,
});

function envelope(id: string, template: string, table: string, items: unknown[]): PageEnvelope {
  return {
    v: 1,
    kind: 'page',
    id: `page_${id}`,
    template,
    title: { key: `nav.${id}`, fallback: id },
    source: { connectionId: 'conn_1', table: `public.${table}` },
    nav: { group: 'workspace', icon: 'inbox', order: 10, slug: id },
    access: { minRole: 'viewer', permissions: [] },
    config: { templateVersion: 1, layout: { version: 1, items } },
  } as unknown as PageEnvelope;
}

const INBOX = envelope('enquiries', 'page-queue-inbox', 'enquiries', [
  { i: 'kpi-open', widget: 'kpi-stat-card', x: 0, y: 0, w: 3, h: 3, config: { binding: { ...query('enquiries'), shape: 'single-metric', aggregations: [{ fn: 'count', alias: 'n' }] } } },
  { i: 'queue', widget: 'master-list', x: 0, y: 3, w: 8, h: 12, config: { binding: query('enquiries', { filters: [{ column: 'fit', op: 'neq', value: 'no' }] }) } },
  { i: 'kpi-clients', widget: 'kpi-stat-card', x: 3, y: 0, w: 3, h: 3, config: { binding: { ...query('clients'), shape: 'single-metric', aggregations: [{ fn: 'count', alias: 'n' }] } } },
]);
const MASTER = envelope('clients', 'page-master-detail', 'clients', [
  { i: 'master', widget: 'master-list', x: 0, y: 0, w: 4, h: 12, config: { binding: query('clients') } },
]);

const NEW = { column: 'status', op: 'eq', value: 'new' };

/** Every other template that lists a table's rows, each with one list query over its own table. */
const OTHERS = [
  ['directory', 'page-directory', 'people-list'],
  ['board', 'page-board', 'kanban-board'],
  ['calendar', 'page-calendar', 'calendar-month'],
  ['scheduler', 'page-scheduler', 'schedule-matrix'],
  ['files', 'page-files', 'file-grid'],
  ['logs', 'page-log-viewer', 'log-table'],
].map(([id, template, widget]) =>
  Object.assign(envelope(id!, template!, 'items', [{ i: 'list', widget: widget!, x: 0, y: 0, w: 12, h: 12, config: { binding: query('items') } }]), { slug: id! }),
);

interface Fixture {
  linkReply?: (body: { filters: { column: string; raw: string }[] }) => Promise<Response>;
}

let asked: { column: string; raw: string }[][];
let batches: { instanceId: string; descriptor: { source: { name: string }; filters?: unknown[] } }[][];

function stub(fixture: Fixture = {}) {
  batches = [];
  asked = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.startsWith('/api/v1/bootstrap')) {
        const bootstrap = makeBootstrap();
        bootstrap.nav.groups[0]?.items.push(
          ...OTHERS.map((other, index) => ({ pageId: `page_${other.slug}`, slug: other.slug, labelKey: `nav.${other.slug}`, fallback: other.slug, icon: 'file', order: 20 + index })),
          { pageId: 'page_enquiries', slug: 'enquiries', labelKey: 'nav.enquiries', fallback: 'Enquiries', icon: 'inbox', order: 5 },
          { pageId: 'page_clients', slug: 'clients', labelKey: 'nav.clients', fallback: 'Clients', icon: 'users', order: 6 },
        );
        return jsonResponse(200, { data: bootstrap });
      }
      if (url.startsWith('/api/v1/pages/page_enquiries')) return jsonResponse(200, { data: INBOX });
      for (const other of OTHERS) {
        if (url.startsWith(`/api/v1/pages/page_${other.slug}`)) return jsonResponse(200, { data: other });
      }
      if (url.startsWith('/api/v1/pages/page_clients')) return jsonResponse(200, { data: MASTER });
      if (url === '/api/v1/widget-data/link-filters' && method === 'POST') {
        const body = JSON.parse(String(init?.body)) as { filters: { column: string; raw: string }[] };
        asked.push(body.filters);
        if (fixture.linkReply !== undefined) return fixture.linkReply(body);
        const applied = body.filters.filter((filter) => filter.column === 'status');
        return jsonResponse(200, {
          where: applied.length === 0 ? null : NEW,
          filters: body.filters.map((filter) =>
            filter.column === 'status'
              ? { ...filter, status: 'applied', op: 'eq', value: 'new' }
              : { ...filter, status: 'ignored', reason: 'unknown-column' },
          ),
        });
      }
      if (url === '/api/v1/widget-data/batch' && method === 'POST') {
        const body = JSON.parse(String(init?.body)) as { requests: (typeof batches)[number] };
        batches.push(body.requests);
        return jsonResponse(200, {
          results: Object.fromEntries(body.requests.map((request) => [request.instanceId, { ok: true, result: { shape: 'record-list', rows: [], columns: [] }, cached: false }])),
        });
      }
      return jsonResponse(404, { error: { code: 'NOT_FOUND', message: url, requestId: 'r' } });
    }),
  );
}

async function renderAt(path: string, fixture: Fixture = {}) {
  stub(fixture);
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, { history: createMemoryHistory({ initialEntries: [path] }) });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const filtersOf = (instanceId: string) => batches.at(-1)?.find((request) => request.instanceId === instanceId)?.descriptor.filters;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('narrowing a layout', () => {
  it('adds the conditions to every query over the page’s own table, and to no other', () => {
    const narrowed = narrowLayout(INBOX, { and: [NEW, { column: 'budget', op: 'not_null' }] } as never)!;
    const items = (narrowed.config['layout'] as { items: { i: string; config: { binding: { filters?: unknown[] } } }[] }).items;
    expect(items.map((item) => [item.i, item.config.binding.filters])).toEqual([
      ['kpi-open', [NEW, { column: 'budget', op: 'not_null' }]],
      ['queue', [{ column: 'fit', op: 'neq', value: 'no' }, NEW, { column: 'budget', op: 'not_null' }]],
      ['kpi-clients', undefined],
    ]);
  });

  it('refuses what a query cannot carry: a nested group, or more conditions than it takes', () => {
    expect(narrowLayout(INBOX, { and: [NEW, { or: [NEW, NEW] }] } as never)).toBeNull();
    expect(narrowLayout(INBOX, { and: Array.from({ length: 16 }, () => NEW) } as never)).toBeNull();
    expect(narrowLayout(INBOX, null)).toBe(INBOX);
  });
});

describe('an inbox opened from a link', () => {
  it('reads the queue and its count through the narrowing, and says so in chips', async () => {
    await renderAt('/p/enquiries?f.status=eq:new&f.ghost=set');
    await waitFor(() => expect(batches.length).toBeGreaterThan(0));
    // Every read of the page carried it — none went out without.
    for (const batch of batches) {
      expect(batch.find((request) => request.instanceId === 'queue')?.descriptor.filters).toEqual([{ column: 'fit', op: 'neq', value: 'no' }, NEW]);
    }
    expect(filtersOf('kpi-open')).toEqual([NEW]);
    expect(filtersOf('kpi-clients')).toBeUndefined();
    const bar = await screen.findByTestId('link-filter-bar');
    expect(screen.getAllByTestId('link-filter').map((chip) => chip.textContent)).toEqual(['status is new']);
    expect(screen.getByTestId('link-filter-ignored').textContent).toBe('Not filtered by ghost: this list has no such column');
    expect(bar.getAttribute('role')).toBe('group');
  });

  it('sends every piece a link repeats on one column — a band of days', async () => {
    await renderAt('/p/enquiries?f.received_at=gte:today-30&f.received_at=lt:today&f.status=eq:new');
    await screen.findByTestId('link-filter-bar');
    expect(asked[0]).toEqual([
      { column: 'received_at', raw: 'gte:today-30' },
      { column: 'received_at', raw: 'lt:today' },
      { column: 'status', raw: 'eq:new' },
    ]);
  });

  it('takes a chip away, and the page is read again without it', async () => {
    const router = await renderAt('/p/enquiries?f.status=eq:new');
    await screen.findByTestId('link-filter-bar');
    await userEvent.click(screen.getByRole('button', { name: 'Remove status filter' }));
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    await waitFor(() => expect(filtersOf('queue')).toEqual([{ column: 'fit', op: 'neq', value: 'no' }]));
    expect(screen.queryByTestId('link-filter-bar')).toBeNull();
  });

  it('reads nothing until the answer is in', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await renderAt('/p/enquiries?f.status=eq:new', {
      linkReply: async () => {
        await held;
        return jsonResponse(200, { where: NEW, filters: [{ column: 'status', raw: 'eq:new', status: 'applied', op: 'eq', value: 'new' }] });
      },
    });
    await screen.findByTestId('link-filters-pending');
    expect(batches).toEqual([]);
    release();
    await waitFor(() => expect(filtersOf('queue')).toEqual([{ column: 'fit', op: 'neq', value: 'no' }, NEW]));
  });

  it('says so when the answer fails, reads nothing, and shows the whole inbox only when asked', async () => {
    const router = await renderAt('/p/enquiries?f.status=eq:new', {
      linkReply: async () => jsonResponse(500, { error: { code: 'INTERNAL', message: 'boom', requestId: 'r' } }),
    });
    await screen.findByText('This link’s filters could not be applied', {}, { timeout: 4000 });
    expect(batches).toEqual([]);
    await userEvent.click(screen.getByTestId('link-filters-show-all'));
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    await waitFor(() => expect(filtersOf('queue')).toEqual([{ column: 'fit', op: 'neq', value: 'no' }]));
  });
});

describe.each(OTHERS.map((other) => [other.template, other.slug] as const))('a %s page opened from a link', (_template, slug) => {
  it('reads its rows through the narrowing, and shows the chips', async () => {
    await renderAt(`/p/${slug}?f.status=eq:new`);
    await waitFor(() => expect(filtersOf('list')).toEqual([NEW]));
    expect(batches.every((batch) => batch.find((request) => request.instanceId === 'list')?.descriptor.filters !== undefined)).toBe(true);
    await screen.findByTestId('link-filter-bar');
  });
});

describe('a master-detail list opened from a link', () => {
  it('reads its list through the narrowing', async () => {
    await renderAt('/p/clients?f.status=eq:new');
    await screen.findByTestId('link-filter-bar');
    await waitFor(() => expect(filtersOf('master')).toEqual([NEW]));
  });
});
