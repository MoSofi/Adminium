// SPDX-License-Identifier: AGPL-3.0-only
/**
 * PageRecordBinding integration (WS-C/WS-E): the real router at
 * `/p/customers/r/1` with a detail-block envelope mounts the REAL
 * `page-record` template — hero, fields, related tab with count pill and
 * cross-links, permission-gated activity — while an envelope without a
 * `detail` block keeps its own template on the record route byte-for-byte
 * (criterion 9). Plus the parity criteria, the deleted-record 404 (criterion
 * 7), and the grants-driven write affordances: the page reply's per-caller
 * canCreate/canUpdate/canDelete — resolved server-side from the caller's
 * table grants — hide New row / Edit / Delete in the list, the peek, and the
 * record page.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PageEnvelope } from '@adminium/engine/config';

import { createQueryClient } from '../app/query.js';
import { createAppRouter } from '../app/router.js';
import type { BootstrapData } from '../app/bootstrap.js';
import { jsonResponse, makeBootstrap, makeCrudEnvelope } from '../test/fixtures.js';
import { appStreamTransport, resetAppStreamTransport } from './lmc/stream.js';
import { registerPageTemplate, type PageTemplateProps } from './templates.js';

class FakeWebSocket {
  /**
   * Every socket the render opened: the AppShell's `config-changed` client and
   * the shared stream transport are separate connections by design, and a
   * realtime frame is dispatched per client, so a test that delivers one has
   * to reach the right socket — {@link deliver} reaches all of them.
   */
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  constructor() {
    FakeWebSocket.instances.push(this);
  }
  send(): void {}
  close(): void {}
}

/** Push one server frame into every open socket (see {@link FakeWebSocket}). */
function deliver(event: { channel: string; type: string; data: unknown; ts: string }): void {
  for (const socket of FakeWebSocket.instances) socket.onmessage?.({ data: JSON.stringify(event) });
}

const CUSTOMER = { id: 1, name: 'Northwind', status: 'active', phone: null, _masked: ['phone'] };
const ORDERS = [
  { id: 21, customer_id: 1, total: '120' },
  { id: 22, customer_id: 1, total: '85' },
];

/** The customers envelope with the stored detail block (shape). */
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

/**
 * The same page with the sidecar block on and no related tabs, so the
 * Attachments panel is the tab that opens. `tabs: []` is what makes it the
 * default: `hasTabs` gates on the stored tabs, not on the adapter.
 */
function attachmentsEnvelope(): PageEnvelope {
  const base = recordEnvelope();
  return {
    ...base,
    config: {
      ...base.config,
      detail: { template: 'page-record', tabs: [] },
      attachments: { enabled: true },
    },
  };
}

/** One `FileDto`, as `GET /api/v1/files?…&recordId=1` answers it. */
function fileDto(id: string, filename: string) {
  return {
    id,
    filename,
    mime: 'application/pdf',
    sizeBytes: 4096,
    sha256: 'a'.repeat(64),
    kind: 'upload',
    destinationId: null,
    uploadedBy: 'usr_test',
    createdAt: 1_750_000_000_000,
    attachedAt: 1_750_000_000_000,
    deletedAt: null,
    entity: { connectionId: 'conn_1', table: 'public.customers', recordId: '1' },
    contentPath: `/api/v1/files/${id}/content`,
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
  /** `GET /api/v1/files?…` — the Attachments panel's list, per call. */
  filesReply?: () => Response;
  /** `POST /api/v1/files/resolve` — the column-mode panel's batch. */
  resolveReply?: () => Response;
  /** `PATCH` of the customer record; column mode writes the list through it. */
  patchReply?: () => Response;
  /** `GET /api/v1/project/actions`; absent answers 404, as a server with no project does. */
  projectActions?: unknown[];
  /** `POST /api/v1/project/actions/:id`. */
  actionReply?: () => Response;
}

function stubFetch(fixture: Fixture = {}) {
  const fetchMock = vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.startsWith('/api/v1/bootstrap')) {
      const bootstrap = fixture.bootstrap?.() ?? makeBootstrap();
      // The table→slug map's inputs: each page names its source table.
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
    if (url === '/api/v1/project/actions' && fixture.projectActions !== undefined) {
      return Promise.resolve(jsonResponse(200, { data: fixture.projectActions }));
    }
    if (url.startsWith('/api/v1/project/actions/') && method === 'POST') {
      return Promise.resolve(
        fixture.actionReply?.() ?? jsonResponse(200, { data: { message: 'Refunded.', refresh: true } }),
      );
    }
    if (url.startsWith('/api/v1/files/resolve')) {
      return Promise.resolve(fixture.resolveReply?.() ?? jsonResponse(200, { data: {} }));
    }
    if (url.startsWith('/api/v1/files')) {
      return Promise.resolve(fixture.filesReply?.() ?? jsonResponse(200, { data: [] }));
    }
    if (url.startsWith('/api/v1/data/conn_1/public.customers/1') && method === 'PATCH') {
      return Promise.resolve(fixture.patchReply?.() ?? jsonResponse(200, { data: CUSTOMER, undoToken: null }));
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
  FakeWebSocket.instances = [];
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
  // The stream transport is an app-lifetime singleton; a live one would carry
  // the previous test's sockets into the next render.
  resetAppStreamTransport();
  vi.unstubAllGlobals();
});

describe('the record route renders the record PAGE', () => {
  it('mounts the real page-record template: hero, fields, no drawer', async () => {
    await renderAt('/p/customers/r/1');
    // Key-field hero + the field grid — a page, not a dialog.
    expect((await screen.findByRole('heading', { level: 2 })).textContent).toBe('Northwind');
    const fields = document.querySelector('[data-part="record-fields"]') as HTMLElement;
    expect(within(fields).getByText('Status')).toBeDefined();
    expect(screen.queryByRole('dialog')).toBeNull();
    // Masked column renders the masked treatment on the page too.
    expect(fields.querySelector('[data-part="cell-masked"]')).not.toBeNull();
    // Document title carries the record (WS-C), under the workspace name. It
    // is published through the topbar channel rather than written here, so it
    // lands one commit after the h1 — hence `waitFor`.
    await waitFor(() => expect(document.title).toBe('Northwind · Customers · Adminium'));
  });

  it('related tab: count pill, rows from the referencing table, cross-link to its record page', async () => {
    const user = userEvent.setup();
    const { router } = await renderAt('/p/customers/r/1');
    const tab = await screen.findByRole('tab', { name: /Orders/ });
    expect(within(tab).getByText('2')).toBeDefined(); // live count pill
    // The tab grid lists the referencing rows (money column proves the target
    // page's OWN specs resolved, not derived text columns).
    expect(await screen.findByText('$120')).toBeDefined();
    // A row navigates to the orders page's record route.
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

  it('activity: present for an admin with entries; ABSENT for a viewer', async () => {
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

  it('readOnly page: no Edit, no Delete anywhere', async () => {
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
 * Grants-driven write affordances: the page reply's per-caller
 * canCreate/canUpdate/canDelete — resolved server-side from the caller's
 * `table:` grants — thread through the crud/record bindings, so a read-only
 * grantee never sees a New row / Edit / Delete that would 403. The server
 * still enforces; this is affordance honesty.
 */
describe('grants-driven write affordances', () => {
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

/**
 * The Attachments panel's realtime refresh.
 *
 * The panel fetches its list once, on mount. Everything that changes it — a
 * colleague attaching a file, this user's own second tab, a form write that
 * replaced a column-bound reference — happens on the server, so without a
 * refresh path the only way to see it is a full remount. That is the gap these
 * tests close, and both halves of the wire are load-bearing: the frame has to
 * arrive (`STREAM_SSE_EVENT_TYPES`, streamTransport.test.ts) and the binding
 * has to react to it.
 */
describe('attachments refetch on record.attachments', () => {
  const CHANNEL = 'widget-data:conn_1:public.customers';
  const attachmentsFixture: Fixture = {
    pageReply: () => jsonResponse(200, { data: attachmentsEnvelope() }),
    filesReply: () => jsonResponse(200, { data: [fileDto('file_1', 'contract.pdf')] }),
  };

  /** How many times the panel has asked the server for its list. */
  const listCalls = (fetchMock: ReturnType<typeof stubFetch>): number =>
    fetchMock.mock.calls.filter(([input]) => String(input).startsWith('/api/v1/files?')).length;

  it('refetches the list when the table publishes record.attachments', async () => {
    const { fetchMock } = await renderAt('/p/customers/r/1', attachmentsFixture);
    // The panel is the default tab (no related tabs on this envelope).
    await screen.findByText('contract.pdf');
    await waitFor(() => expect(listCalls(fetchMock)).toBe(1));

    deliver({
      channel: CHANNEL,
      type: 'record.attachments',
      // The publisher's frame shape: the pk masked, no row.
      data: { type: 'record.attachments', pk: { id: 1 }, row: null },
      ts: '2026-09-05T00:00:00.000Z',
    });

    await waitFor(() => expect(listCalls(fetchMock)).toBe(2));
  });

  it('ignores another table’s attachments and its own table’s row traffic', async () => {
    const { fetchMock } = await renderAt('/p/customers/r/1', attachmentsFixture);
    await screen.findByText('contract.pdf');
    await waitFor(() => expect(listCalls(fetchMock)).toBe(1));

    // Each frame is flushed on its own, so a listener that reacted to all
    // three would be caught HERE and not hidden by React batching them into
    // one re-render — and the last step proves the pipeline was live for the
    // two that changed nothing.
    await act(async () => {
      deliver({
        channel: 'widget-data:conn_1:public.orders',
        type: 'record.attachments',
        data: { type: 'record.attachments', pk: { id: 21 }, row: null },
        ts: '2026-09-05T00:00:00.000Z',
      });
    });
    expect(listCalls(fetchMock)).toBe(1);

    await act(async () => {
      deliver({
        channel: CHANNEL,
        type: 'record.update',
        data: { type: 'record.update', pk: { id: 1 }, row: CUSTOMER },
        ts: '2026-09-05T00:00:01.000Z',
      });
    });
    expect(listCalls(fetchMock)).toBe(1);

    await act(async () => {
      deliver({
        channel: CHANNEL,
        type: 'record.attachments',
        data: { type: 'record.attachments', pk: { id: 1 }, row: null },
        ts: '2026-09-05T00:00:02.000Z',
      });
    });
    expect(listCalls(fetchMock)).toBe(2);
  });

  it('opens no stream channel at all for a page without the attachments block', async () => {
    // The rule, applied to the socket: a page that configures no
    // sidecar must cost nothing, not even a subscription.
    const { fetchMock } = await renderAt('/p/customers/r/1');
    await screen.findByRole('heading', { level: 2 });
    expect(listCalls(fetchMock)).toBe(0);
    expect(appStreamTransport().channelCount).toBe(0);
  });
});

/**
 * COLUMN-mode attachments.
 *
 * The panel is the same component; only the adapter differs. In column mode
 * the record's own column holds a JSON list of references, so `list` reads the
 * row and resolves the entries, and every write is a `PATCH` of that column —
 * never a `DELETE /files/:id`, because the column is the truth and a delete
 * that left the reference behind would leave the grid showing a chip for a
 * trashed file.
 */
describe('attachments bound to a column', () => {
  const FILE_A = 'file_01M1Q2R3S4T5V6W7X8Y9Z0ABCD';
  const FILE_B = 'file_01M1Q2R3S4T5V6W7X8Y9Z0ABCE';

  /** The customers page with attachments in COLUMN mode. */
  function columnEnvelope(): PageEnvelope {
    const base = recordEnvelope();
    return {
      ...base,
      config: {
        ...base.config,
        detail: { template: 'page-record', tabs: [] },
        attachments: { enabled: true, column: 'attachments' },
      },
    };
  }

  const columnFixture: Fixture = {
    pageReply: () => jsonResponse(200, { data: columnEnvelope() }),
    recordReply: () =>
      jsonResponse(200, {
        data: { ...CUSTOMER, attachments: JSON.stringify([FILE_A, FILE_B]) },
        inboundCounts: [],
      }),
    resolveReply: () =>
      jsonResponse(200, {
        data: {
          [FILE_A]: fileDto(FILE_A, 'contract.pdf'),
          [FILE_B]: fileDto(FILE_B, 'receipt.pdf'),
        },
      }),
  };

  it('lists what the record’s column names, through resolve rather than the files list', async () => {
    const { fetchMock } = await renderAt('/p/customers/r/1', columnFixture);

    expect(await screen.findByText('contract.pdf')).toBeTruthy();
    expect(screen.getByText('receipt.pdf')).toBeTruthy();

    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    // The batch resolver, not `GET /files?recordId=` — the sidecar's query
    // would answer nothing here, because no file is linked on Adminium's side.
    expect(urls.some((url) => url.startsWith('/api/v1/files/resolve'))).toBe(true);
    expect(urls.some((url) => url.includes('/api/v1/files?') && url.includes('recordId'))).toBe(false);
  });

  it('removes by PATCHing the column, never by deleting the file', async () => {
    const user = userEvent.setup();
    const { fetchMock } = await renderAt('/p/customers/r/1', columnFixture);
    await screen.findByText('contract.pdf');

    // By `data-part`, not by accessible name: the record page has its own
    // "Delete" action for the RECORD, and a name-based query finds that first.
    const remove = document.querySelectorAll('[data-part="attachment-delete"]')[0];
    expect(remove).toBeTruthy();
    await user.click(remove as HTMLElement);

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        (call) => (call[1] as RequestInit | undefined)?.method === 'PATCH',
      );
      expect(patch).toBeTruthy();
      // The remaining reference, and only it.
      expect(String((patch?.[1] as RequestInit).body)).toContain(FILE_B);
      expect(String((patch?.[1] as RequestInit).body)).not.toContain(FILE_A);
    });
    // The reconcile hook is what trashes the file; the panel never asks.
    const deletes = fetchMock.mock.calls.filter(
      (call) => (call[1] as RequestInit | undefined)?.method === 'DELETE',
    );
    expect(deletes).toEqual([]);
  });

  it('still uses the sidecar adapter when the block names no column', async () => {
    // The fallback path (D2) — unchanged from 37.
    const { fetchMock } = await renderAt('/p/customers/r/1', {
      pageReply: () => jsonResponse(200, { data: attachmentsEnvelope() }),
      filesReply: () => jsonResponse(200, { data: [fileDto(FILE_A, 'sidecar.pdf')] }),
    });
    expect(await screen.findByText('sidecar.pdf')).toBeTruthy();
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes('/api/v1/files?') && url.includes('recordId'))).toBe(true);
  });
});

describe('project actions (the project’s own buttons)', () => {
  const refund = {
    id: 'refund',
    label: 'Refund',
    icon: 'undo-2',
    confirm: 'Refund this customer?',
    bulk: true,
    permission: 'update',
    database: 'main',
    connectionId: 'conn_1',
    table: 'public.customers',
  };
  const other = { ...refund, id: 'ship', label: 'Ship', confirm: null, bulk: false, table: 'public.orders' };

  const actionCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
    fetchMock.mock.calls
      .filter(([url, init]) => String(url).startsWith('/api/v1/project/actions/') && (init as RequestInit | undefined)?.method === 'POST')
      .map(([url, init]) => ({ url: String(url), body: JSON.parse(String((init as RequestInit).body)) as unknown }));

  it('record page: asks the action’s question, runs it on this record, and reads the record again', async () => {
    const user = userEvent.setup();
    const { fetchMock } = await renderAt('/p/customers/r/1', { projectActions: [refund, other] });
    const button = await screen.findByTestId('project-action-refund');
    expect(button.textContent).toContain('Refund');
    // Another table's action stays on its own table.
    expect(screen.queryByTestId('project-action-ship')).toBeNull();
    const reads = () =>
      fetchMock.mock.calls.filter(
        ([url, init]) => String(url).startsWith('/api/v1/data/conn_1/public.customers/1') && (init as RequestInit | undefined)?.method === undefined,
      ).length;
    const before = reads();

    await user.click(button);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Refund this customer?')).toBeDefined();
    await user.click(within(dialog).getByTestId('project-action-confirm'));

    await waitFor(() => {
      expect(actionCalls(fetchMock)).toEqual([
        { url: '/api/v1/project/actions/refund', body: { database: 'main', table: 'public.customers', ids: ['1'] } },
      ]);
    });
    expect(await screen.findByText('Refunded.')).toBeDefined();
    await waitFor(() => {
      expect(reads()).toBeGreaterThan(before);
    });
  });

  it('record page: shows the server’s refusal', async () => {
    const user = userEvent.setup();
    await renderAt('/p/customers/r/1', {
      projectActions: [{ ...refund, confirm: null }],
      actionReply: () =>
        jsonResponse(422, { error: { code: 'VALIDATION_FAILED', message: 'Already refunded.', requestId: 'req_a' } }),
    });
    await user.click(await screen.findByTestId('project-action-refund'));
    expect(await screen.findByText('Refund did not finish')).toBeDefined();
    expect(await screen.findByText('Already refunded.')).toBeDefined();
  });

  it('record page: no project, no buttons', async () => {
    await renderAt('/p/customers/r/1');
    await screen.findByRole('heading', { level: 2 });
    expect(screen.queryByTestId('project-action-refund')).toBeNull();
  });

  it('list: a row menu and, for a bulk action, the bulk bar; the rows are read again after each', async () => {
    const user = userEvent.setup();
    const { fetchMock } = await renderAt('/p/customers', { projectActions: [{ ...refund, confirm: null }] });
    await screen.findByText('Northwind');
    const listReads = () =>
      fetchMock.mock.calls.filter(
        ([url, init]) =>
          String(url).startsWith('/api/v1/data/conn_1/public.customers?') && (init as RequestInit | undefined)?.method === undefined,
      ).length;
    const before = listReads();

    await user.click(screen.getByRole('button', { name: 'Actions' }));
    await user.click(await screen.findByTestId('project-action-refund'));
    await waitFor(() => {
      expect(actionCalls(fetchMock).at(-1)?.body).toEqual({ database: 'main', table: 'public.customers', ids: ['1'] });
    });
    await waitFor(() => {
      expect(listReads()).toBeGreaterThan(before);
    });
    const afterMenu = listReads();

    const [selectAll] = screen.getAllByRole('checkbox');
    await user.click(selectAll as HTMLElement);
    const bar = await screen.findByRole('toolbar');
    await user.click(within(bar).getByRole('button', { name: 'Refund' }));
    await waitFor(() => {
      expect(actionCalls(fetchMock)).toHaveLength(2);
    });
    await waitFor(() => {
      expect(listReads()).toBeGreaterThan(afterMenu);
    });
  });
});
