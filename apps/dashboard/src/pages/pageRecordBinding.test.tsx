// SPDX-License-Identifier: AGPL-3.0-only
/**
 * PageRecordBinding integration (30-record-pages.md WS-C/WS-E): the real
 * router at `/p/customers/r/1` with a detail-block envelope mounts the REAL
 * `page-record` template — hero, fields, related tab with count pill and
 * cross-links, permission-gated activity — while an envelope without a
 * `detail` block keeps its own template on the record route byte-for-byte
 * (criterion 9). Plus the parity criteria (30 D7), the deleted-record 404
 * (criterion 7), and the grants-driven write affordances (30 D4): the page
 * reply's per-caller canCreate/canUpdate/canDelete — resolved server-side
 * from the caller's table grants — hide New row / Edit / Delete in the list,
 * the peek, and the record page.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PageEnvelope } from '@adminium/engine/config';

import { createQueryClient } from '../app/query.js';
import { createAppRouter } from '../app/router.js';
import type { BootstrapData } from '../app/bootstrap.js';
import { jsonResponse, makeBootstrap, makeCrudEnvelope } from '../test/fixtures.js';
import { registerPageTemplate, type PageTemplateProps } from './templates.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

const CUSTOMER = { id: 1, name: 'Northwind', status: 'active', phone: null, _masked: ['phone'] };
const ORDERS = [
  { id: 21, customer_id: 1, total: '120' },
  { id: 22, customer_id: 1, total: '85' },
];

/** The customers envelope with the stored detail block (30-T01's shape). */
function recordEnvelope(overrides: Partial<PageEnvelope> = {}): PageEnvelope {
  const base = makeCrudEnvelope();
  return {
    ...base,
    config: {
      columns: [
        { name: 'id', label: 'ID', logicalType: 'integer', primaryKey: true, hidden: true },
        { name: 'name', label: 'Name', logicalType: 'text', isDisplay: true },
        {
          name: 'status',
          label: 'Status',
          logicalType: 'enum',
          semantic: 'status-workflow',
          enumValues: ['active'],
          enumTones: { active: 'pos' },
        },
        { name: 'phone', label: 'Phone', logicalType: 'text', semantic: 'phone', pii: true },
      ],
      keyField: 'name',
      readOnly: false,
      detail: {
        template: 'page-record',
        tabsFromInboundFks: true,
        tabs: [{ table: 'public.orders', fkColumn: 'customer_id', label: 'Orders' }],
      },
    },
    ...overrides,
  };
}

function ordersEnvelope(): PageEnvelope {
  const base = makeCrudEnvelope();
  return {
    ...base,
    id: 'page_orders',
    title: { key: 'pages.orders', fallback: 'Orders' },
    source: { connectionId: 'conn_1', table: 'public.orders' },
    config: {
      columns: [
        { name: 'id', label: 'ID', logicalType: 'integer', primaryKey: true },
        { name: 'total', label: 'Total', logicalType: 'decimal', semantic: 'money' },
      ],
      defaultSort: [{ column: 'id', dir: 'desc' }],
    },
  };
}

interface Fixture {
  pageReply?: () => Response;
  /** The ORDERS page document reply — the related tab's resolve target. */
  ordersReply?: () => Response;
  bootstrap?: () => BootstrapData;
  /** GET of the single customer record; default answers CUSTOMER. */
  recordReply?: () => Response;
  auditReply?: () => Response;
}

function stubFetch(fixture: Fixture = {}) {
  const fetchMock = vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.startsWith('/api/v1/bootstrap')) {
      const bootstrap = fixture.bootstrap?.() ?? makeBootstrap();
      // The table→slug map's inputs (30 D5): each page names its source table.
      for (const group of bootstrap.nav.groups) {
        for (const item of group.items) {
          if (item.slug === 'customers') Object.assign(item, { connectionId: 'conn_1', sourceTable: 'public.customers' });
          if (item.slug === 'orders') Object.assign(item, { connectionId: 'conn_1', sourceTable: 'public.orders' });
        }
      }
      return Promise.resolve(jsonResponse(200, { data: bootstrap }));
    }
    if (url.startsWith('/api/v1/pages/page_customers')) {
      return Promise.resolve(fixture.pageReply?.() ?? jsonResponse(200, { data: recordEnvelope() }));
    }
    if (url.startsWith('/api/v1/pages/page_orders')) {
      return Promise.resolve(fixture.ordersReply?.() ?? jsonResponse(200, { data: ordersEnvelope() }));
    }
    if (url.startsWith('/api/v1/data/conn_1/public.orders') && method === 'POST') {
      return Promise.resolve(jsonResponse(201, { data: { id: 23 }, undoToken: null }));
    }
    if (url.startsWith('/api/v1/audit')) {
      return Promise.resolve(
        fixture.auditReply?.() ??
          jsonResponse(200, {
            entries: [
              {
                id: 'aud_1',
                createdAt: 1_750_000_000_000,
                actorKind: 'user',
                actorId: 'usr_test',
                actorLabel: 'Ava Reyes',
                category: 'data',
                action: 'record.update',
                connectionId: 'conn_1',
                entity: null,
                // One CHANGED field in a two-field union — the count must be
                // the flagged rows, not the union (the union is every column).
                changes: {
                  before: { name: 'Old', status: 'active' },
                  after: { name: 'Northwind', status: 'active' },
                },
                ip: null,
                userAgent: null,
                requestId: null,
              },
            ],
            nextCursor: null,
          }),
      );
    }
    if (url.startsWith('/api/v1/data/conn_1/public.customers/1') && method === 'GET') {
      return Promise.resolve(
        fixture.recordReply?.() ?? jsonResponse(200, {
          data: CUSTOMER,
          inboundCounts: [
            { relationId: 'rel_orders', table: 'public.orders', column: 'customer_id', count: 2 },
          ],
        }),
      );
    }
    if (url.startsWith('/api/v1/data/conn_1/public.customers') && method === 'GET') {
      return Promise.resolve(jsonResponse(200, { data: [CUSTOMER] }));
    }
    if (url.startsWith('/api/v1/data/conn_1/public.orders') && method === 'GET') {
      return Promise.resolve(jsonResponse(200, { data: ORDERS, cursor: { next: null } }));
    }
    return Promise.resolve(
      jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope', requestId: 'req_t' } }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function renderAt(path: string, fixture: Fixture = {}) {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  const fetchMock = stubFetch(fixture);
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, {
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, fetchMock, queryClient };
}

const unregisterFns: Array<() => void> = [];

afterEach(() => {
  for (const unregister of unregisterFns.splice(0)) unregister();
  vi.unstubAllGlobals();
});

describe('the record route renders the record PAGE (30 D1)', () => {
  it('mounts the real page-record template: hero, fields, no drawer', async () => {
    await renderAt('/p/customers/r/1');
    // Key-field hero + the field grid — a page, not a dialog (30 D1).
    expect((await screen.findByRole('heading', { level: 2 })).textContent).toBe('Northwind');
    const fields = document.querySelector('[data-part="record-fields"]') as HTMLElement;
    expect(within(fields).getByText('Status')).toBeDefined();
    expect(screen.queryByRole('dialog')).toBeNull();
    // Masked column renders the masked treatment on the page too (30 D7).
    expect(fields.querySelector('[data-part="cell-masked"]')).not.toBeNull();
    // Document title carries the record (WS-C).
    expect(document.title).toBe('Northwind · Customers');
  });

  it('related tab: count pill, rows from the referencing table, cross-link to its record page (30 D5)', async () => {
    const user = userEvent.setup();
    const { router } = await renderAt('/p/customers/r/1');
    const tab = await screen.findByRole('tab', { name: /Orders/ });
    expect(within(tab).getByText('2')).toBeDefined(); // live count pill
    // The tab grid lists the referencing rows (money column proves the target
    // page's OWN specs resolved, not derived text columns).
    expect(await screen.findByText('$120')).toBeDefined();
    // A row navigates to the orders page's record route (30 D5).
    await user.click(screen.getByText('$120'));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/p/orders/r/21');
    });
  });

  it('a HIDDEN target page still lends full tab specs and cross-links (30 follow-up)', async () => {
    /*
     * The cascade-owned-child default (and Studio's "Hide from sidebar") moves
     * a page out of the nav tree into `hiddenPages`. Before the follow-up this
     * degraded the parent's related tab to derived raw-key columns and
     * un-clickable rows — the exact trade the acceptance run recorded. Now
     * resolution reads hidden pages too, so the tab must be byte-for-byte what
     * it was when the page sat in the sidebar.
     */
    const user = userEvent.setup();
    const hiddenBootstrap = () => {
      const base = makeBootstrap();
      return {
        ...base,
        nav: {
          groups: base.nav.groups.map((group) => ({
            ...group,
            items: group.items.filter((item) => item.slug !== 'orders'),
          })),
        },
        hiddenPages: [
          {
            pageId: 'page_orders',
            slug: 'orders',
            labelKey: 'nav.orders',
            fallback: 'Orders',
            icon: 'shopping-cart',
            order: 2,
            connectionId: 'conn_1',
            sourceTable: 'public.orders',
          },
        ],
      };
    };
    const { router } = await renderAt('/p/customers/r/1', { bootstrap: hiddenBootstrap });
    await screen.findByRole('tab', { name: /Orders/ });
    // The money column proves the HIDDEN page's own specs resolved.
    expect(await screen.findByText('$120')).toBeDefined();
    // Rows still cross-link, and the hidden page's URL still answers.
    await user.click(screen.getByText('$120'));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/p/orders/r/21');
    });
  });

  it('in-tab create: "New row" posts the child with the FK injected (30 follow-up)', async () => {
    const user = userEvent.setup();
    const { fetchMock } = await renderAt('/p/customers/r/1');
    await screen.findByText('$120');

    await user.click(screen.getByRole('button', { name: 'New row' }));
    const form = document.getElementById('page-record-add-public.orders') as HTMLElement;
    expect(form).not.toBeNull();
    await user.type(within(form).getByLabelText(/Total/), '45');
    await user.click(screen.getByRole('button', { name: 'Add order' }));

    await waitFor(() => {
      const created = fetchMock.mock.calls.find(
        (call: unknown[]) =>
          String(call[0]) === '/api/v1/data/conn_1/public.orders' &&
          (call[1] as RequestInit | undefined)?.method === 'POST',
      );
      expect(created).toBeDefined();
      const body = JSON.parse(String((created?.[1] as RequestInit | undefined)?.body)) as {
        values: Record<string, unknown>;
      };
      // Born attached: the FK is injected from THIS record, never typed.
      expect(body.values['customer_id']).toBe(1);
      expect(body.values['total']).toBeDefined();
    });
    // The tab refetches its rows after the create.
    await waitFor(() => {
      const listCalls = fetchMock.mock.calls.filter(
        (call: unknown[]) =>
          String(call[0]).startsWith('/api/v1/data/conn_1/public.orders?') &&
          ((call[1] as RequestInit | undefined)?.method ?? 'GET') === 'GET',
      );
      expect(listCalls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('the tab offers no create when the TARGET page refuses it (viewer grants)', async () => {
    await renderAt('/p/customers/r/1', {
      ordersReply: () =>
        jsonResponse(200, {
          data: ordersEnvelope(),
          canEditLayout: false,
          canCreate: false,
          canUpdate: false,
          canDelete: false,
        }),
    });
    await screen.findByText('$120');
    expect(screen.queryByRole('button', { name: 'New row' })).toBeNull();
  });

  it('activity: present for an admin with entries; ABSENT for a viewer (30 D6)', async () => {
    const user = userEvent.setup();
    const first = await renderAt('/p/customers/r/1');
    await user.click(await screen.findByRole('tab', { name: 'Activity' }));
    expect(await screen.findByText('Ava Reyes updated this record')).toBeDefined();
    expect(screen.getByText('1 field changed')).toBeDefined();
    first.queryClient.clear();

    // A viewer's record page simply has fields and related records.
    //
    // Testing Library's automatic cleanup runs per TEST (test/setup.ts), and
    // this is a second render inside one, so the first tree has to be taken
    // down by hand. `cleanup()` rather than blanking the document body's
    // markup: emptying the container leaves React mounted, so the admin
    // render's effects, subscriptions and pending queries stay live underneath
    // the viewer render. (The blunt spelling also trips the `packages/llm`
    // raw-HTML-sink scan, which greps for assignments to that property and
    // cannot tell a test teardown from an injection — a comment naming the
    // pattern is enough to fail it, which is how this note got reworded.)
    cleanup();
    await renderAt('/p/customers/r/1', {
      bootstrap: () => makeBootstrap({ roles: ['viewer'] }),
    });
    await screen.findByRole('heading', { level: 2 });
    expect(screen.queryByRole('tab', { name: 'Activity' })).toBeNull();
  });

  it('readOnly page: no Edit, no Delete anywhere (30 D7)', async () => {
    await renderAt('/p/customers/r/1', {
      pageReply: () => {
        const envelope = recordEnvelope();
        (envelope.config as Record<string, unknown>)['readOnly'] = true;
        return jsonResponse(200, { data: envelope });
      },
    });
    await screen.findByRole('heading', { level: 2 });
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    // Tabs included: no in-tab create on a readOnly page, whatever the
    // TARGET page's capabilities say (D7's "anywhere").
    await screen.findByText('$120');
    expect(screen.queryByRole('button', { name: 'New row' })).toBeNull();
  });

  it('a deleted record renders the in-outlet 404; the shell stays usable (criterion 7)', async () => {
    await renderAt('/p/customers/r/1', {
      recordReply: () =>
        jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'gone', requestId: 'req_x' } }),
    });
    expect(await screen.findByText('This page went missing')).toBeDefined();
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeDefined();
  });

  it('back from the record page restores the list grid state (T12/criterion 3)', async () => {
    const user = userEvent.setup();
    const { router } = await renderAt('/p/customers');
    // Narrow the list, then walk into a record and back.
    const search = await screen.findByPlaceholderText(/Search public\.customers/);
    await user.type(search, 'north');
    await waitFor(() => {
      expect((screen.getByPlaceholderText(/Search public\.customers/) as HTMLInputElement).value).toBe('north');
    });
    await user.click(await screen.findByText('Northwind'));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/p/customers/r/1');
    });
    await screen.findByRole('heading', { level: 2 });

    router.history.back();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/p/customers');
    });
    // The remount restores the query the user left (search survives).
    const restored = (await screen.findByPlaceholderText(/Search public\.customers/)) as HTMLInputElement;
    expect(restored.value).toBe('north');
  });

  it('an envelope WITHOUT a detail block keeps its own template on the record route (criterion 9)', async () => {
    function OwnTemplate({ recordId }: PageTemplateProps) {
      return <p>own template, record {recordId ?? 'none'}</p>;
    }
    unregisterFns.push(registerPageTemplate('page-master-detail', OwnTemplate));
    await renderAt('/p/customers/r/1', {
      pageReply: () => {
        const base = makeCrudEnvelope({ template: 'page-master-detail' });
        // No `detail` in config — the page's own template owns the route.
        return jsonResponse(200, { data: base });
      },
    });
    expect(await screen.findByText('own template, record 1')).toBeDefined();
  });
});

/**
 * Grants-driven write affordances (30 D4): the page reply's per-caller
 * canCreate/canUpdate/canDelete — resolved server-side from the caller's
 * `table:` grants — thread through the crud/record bindings, so a read-only
 * grantee never sees a New row / Edit / Delete that would 403. The server
 * still enforces; this is affordance honesty.
 */
describe('grants-driven write affordances (30 D4)', () => {
  /** The reply of a read-only table grantee: every write capability false. */
  const viewerReply = () =>
    jsonResponse(200, {
      data: recordEnvelope(),
      canEditLayout: false,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
    });

  it('list: rows render, but there is no New row CTA', async () => {
    await renderAt('/p/customers', { pageReply: viewerReply });
    expect(await screen.findByText('Northwind')).toBeDefined();
    expect(screen.queryByRole('button', { name: /New row/ })).toBeNull();
  });

  it('peek: the drawer still shows the record — with no Edit/Delete', async () => {
    const user = userEvent.setup();
    await renderAt('/p/customers', { pageReply: viewerReply });
    await screen.findByText('Northwind');
    await user.click(screen.getByRole('button', { name: 'Peek' }));
    const drawer = await screen.findByRole('dialog');
    expect(await within(drawer).findByText('Status')).toBeDefined(); // record loaded
    expect(within(drawer).queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(within(drawer).queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('record page: fields render, no Edit/Delete anywhere', async () => {
    await renderAt('/p/customers/r/1', { pageReply: viewerReply });
    await screen.findByRole('heading', { level: 2 });
    expect(document.querySelector('[data-part="record-fields"]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('capabilities apply per action: update-only shows Edit but not Delete', async () => {
    await renderAt('/p/customers/r/1', {
      pageReply: () =>
        jsonResponse(200, {
          data: recordEnvelope(),
          canCreate: false,
          canUpdate: true,
          canDelete: false,
        }),
    });
    await screen.findByRole('heading', { level: 2 });
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });
});
