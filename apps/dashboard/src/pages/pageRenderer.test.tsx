/**
 * PageRenderer integration (09-generated-app.md §3–§4): mounts the real
 * router at /p/customers with a mocked page-crud envelope and a registered
 * test template, exercising the full glue end-to-end — envelope fetch +
 * validation → template registry → CrudApi list → rows; mutate WidgetEvent →
 * CRUD call → undo toast → undo POST; record-open → hrefForRecord navigation.
 * Plus the never-crash cards: unknown template, config too new, and the
 * page-scoped forbidden state.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { crudListQuery } from '../api/crud.js';
import { createQueryClient } from '../app/query.js';
import { createAppRouter } from '../app/router.js';
import { jsonResponse, makeBootstrap, makeCrudEnvelope, makeDashboardEnvelope } from '../test/fixtures.js';
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

/**
 * Minimal stand-in for the page-crud template: lists rows through the CrudApi
 * adapter, emits a mutate WidgetEvent from its New button and a record-open
 * event on row click — exactly the host-facing surface 04 §2.1 defines.
 */
function TestCrudTemplate({ page, adapters, recordId }: PageTemplateProps) {
  const crud = adapters.crud;
  if (crud === null) throw new Error('page-crud requires a bound source');
  const list = useQuery(crudListQuery(crud));
  return (
    <div>
      <h2>{page.title.fallback} · page-crud</h2>
      {recordId !== undefined ? <p>Record detail {recordId}</p> : null}
      <button
        type="button"
        onClick={() =>
          adapters.onEvent({
            type: 'mutate',
            intent: 'insert',
            table: crud.table,
            values: { name: 'Acme' },
          })
        }
      >
        New row
      </button>
      <ul>
        {(list.data?.data ?? []).map((row) => (
          <li key={String(row['id'])}>
            <button
              type="button"
              onClick={() =>
                adapters.onEvent({ type: 'record-open', table: crud.table, recordId: row['id'] as number })
              }
            >
              {String(row['name'])}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface Fixture {
  pageReply?: () => Response;
  batchReply?: () => Response;
}

function stubFetch(fixture: Fixture = {}) {
  let rows = [{ id: 1, name: 'Northwind' }];
  const fetchMock = vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
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
      });
      return Promise.resolve(jsonResponse(200, { data: bootstrap }));
    }
    if (url.startsWith('/api/v1/pages/page_customers')) {
      return Promise.resolve(
        fixture.pageReply?.() ?? jsonResponse(200, { data: makeCrudEnvelope() }),
      );
    }
    if (url.startsWith('/api/v1/pages/page_overview')) {
      return Promise.resolve(jsonResponse(200, { data: makeDashboardEnvelope() }));
    }
    if (url === '/api/v1/widget-data/batch' && method === 'POST') {
      return Promise.resolve(
        fixture.batchReply?.() ??
          jsonResponse(200, {
            results: { w1: { ok: true, result: { value: 42 }, cached: false } },
          }),
      );
    }
    if (url.startsWith('/api/v1/data/conn_1/public.customers') && method === 'GET') {
      return Promise.resolve(jsonResponse(200, { data: rows }));
    }
    if (url === '/api/v1/data/conn_1/public.customers' && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as { values: Record<string, unknown> };
      rows = [...rows, { id: 2, name: String(body.values['name']) }];
      return Promise.resolve(jsonResponse(201, { data: rows[1], undoToken: 'tok_undo_9' }));
    }
    if (url === '/api/v1/data/undo/tok_undo_9' && method === 'POST') {
      rows = rows.filter((row) => row.id !== 2);
      return Promise.resolve(jsonResponse(200, { restoredIds: [2] }));
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

describe('PageRenderer end-to-end (/p/customers, page-crud)', () => {
  it('envelope → template mount → CrudApi list → rows render', async () => {
    unregisterFns.push(registerPageTemplate('page-crud', TestCrudTemplate));
    const { fetchMock } = await renderAt('/p/customers');

    expect(await screen.findByText('Northwind')).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Customers · page-crud' })).toBeDefined();

    // Loader primed ['page', page_customers]: exactly one pages fetch.
    const pageCalls = fetchMock.mock.calls.filter((call) => String(call[0]).startsWith('/api/v1/pages/'));
    expect(pageCalls).toHaveLength(1);
  });

  it('mutate WidgetEvent → create + undo toast → Undo calls the undo endpoint', async () => {
    unregisterFns.push(registerPageTemplate('page-crud', TestCrudTemplate));
    const user = userEvent.setup();
    const { fetchMock } = await renderAt('/p/customers');
    await screen.findByText('Northwind');

    await user.click(screen.getByRole('button', { name: 'New row' }));

    // Undo-first mutation (09 §4.1): success toast with an Undo action.
    expect(await screen.findByText('Record created')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Undo' }));

    await waitFor(() => {
      const undoCalls = fetchMock.mock.calls.filter((call) =>
        String(call[0]).includes('/api/v1/data/undo/tok_undo_9'),
      );
      expect(undoCalls).toHaveLength(1);
    });
    expect(await screen.findByText('Change undone')).toBeDefined();
  });

  it('record-open WidgetEvent navigates to hrefForRecord (09 §2.3)', async () => {
    unregisterFns.push(registerPageTemplate('page-crud', TestCrudTemplate));
    const user = userEvent.setup();
    const { router } = await renderAt('/p/customers');

    await user.click(await screen.findByRole('button', { name: 'Northwind' }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/p/customers/r/1');
    });
    // The record child route re-mounts the template with recordId (09 §7.1).
    expect(await screen.findByText('Record detail 1')).toBeDefined();
  });
});

describe('built-in page-crud binding (real template, no registration)', () => {
  it('mounts @adminium/widgets PageCrud and lists rows through the CrudApi', async () => {
    await renderAt('/p/customers');
    // The real template's data-grid renders the fixture row via api.list.
    expect(await screen.findByText('Northwind')).toBeDefined();
    // Header CTA uses DB framing (09 §7.1) — proves the real PageCrud mounted.
    expect(screen.getByRole('button', { name: /New row/ })).toBeDefined();
  });
});

describe('built-in page-dashboard binding (real template, no registration)', () => {
  it('mounts PageDashboard: ONE deduped batch POST, fan-out feeds both hosts', async () => {
    const { fetchMock } = await renderAt('/p/overview');

    // Both kpi-stat-card instances share one descriptor → one wire item,
    // fan-out hands w2 the same payload (value 42 rendered twice).
    const values = await screen.findAllByText('42');
    expect(values).toHaveLength(2);

    const batchCalls = fetchMock.mock.calls.filter((call) => String(call[0]) === '/api/v1/widget-data/batch');
    expect(batchCalls).toHaveLength(1);
    const body = JSON.parse(String((batchCalls[0]?.[1] as RequestInit).body)) as { requests: unknown[] };
    expect(body.requests).toHaveLength(1); // deduped (04 §5.3)
  });

  it('maps a whole-batch failure to per-widget error cards — page and shell stay up', async () => {
    await renderAt('/p/overview', {
      batchReply: () =>
        // 4xx: not retried by the query client → immediate error states.
        jsonResponse(400, { error: { code: 'INVALID_DESCRIPTOR', message: 'boom', requestId: 'req_b' } }),
    });

    // Per-widget error states with Retry, never a page crash (09 §4.1).
    const retries = await screen.findAllByRole('button', { name: /Retry/ });
    expect(retries.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeDefined();
  });
});

/**
 * The page gutter (02 §1.8). PageRenderer wraps every template in ONE
 * `PageSurface` built from `surfaceDefaults`, so the padding of `/p/<slug>` is
 * decided in one table rather than by whichever binding was edited last. Before
 * this, `page-crud` carried the gutter and ten other templates carried none.
 */
describe('page gutter', () => {
  async function surfaceAt(path: string, fixture: Fixture = {}) {
    await renderAt(path, fixture);
    // Wait for the template itself — the skeleton renders a surface too, and
    // asserting on that one would prove nothing about the loaded page.
    await screen.findByRole('heading', { name: 'Customers · page-crud' });
    const surface = document.querySelector('[data-part="page-surface"]');
    if (surface === null) throw new Error('no page surface rendered');
    return surface as HTMLElement;
  }

  it('gives a template with no stored override its own default', async () => {
    unregisterFns.push(registerPageTemplate('page-crud', TestCrudTemplate));
    const surface = await surfaceAt('/p/customers');
    expect(surface.getAttribute('data-padding')).toBe('standard');
    expect(surface.className).toContain('max-w-wide');
  });

  it('lets a stored `padding` override the template default', async () => {
    unregisterFns.push(registerPageTemplate('page-crud', TestCrudTemplate));
    const surface = await surfaceAt('/p/customers', {
      pageReply: () => jsonResponse(200, { data: makeCrudEnvelope({ padding: 'none' }) }),
    });
    expect(surface.getAttribute('data-padding')).toBe('none');
    expect(surface.className).not.toContain('p-[var(--main-pad)]');
  });

  it('renders a stored custom pair as inline padding', async () => {
    unregisterFns.push(registerPageTemplate('page-crud', TestCrudTemplate));
    const surface = await surfaceAt('/p/customers', {
      pageReply: () => jsonResponse(200, { data: makeCrudEnvelope({ padding: { x: 40, y: 12 } }) }),
    });
    expect(surface.style.getPropertyValue('--adm-page-pad')).toBe('12px 40px');
    expect(surface.className).toContain('p-[var(--adm-page-pad)]');
  });
});

describe('never-crash cards (09 §3.1)', () => {
  it('renders the unknown-template card for unrecognized template ids', async () => {
    await renderAt('/p/customers', {
      pageReply: () =>
        jsonResponse(200, { data: makeCrudEnvelope({ template: 'page-from-the-future' }) }),
    });
    expect(await screen.findByText('Unknown page template')).toBeDefined();
    expect(screen.getByText('page-from-the-future')).toBeDefined();
  });

  it('renders the config-too-new card for documents newer than this build', async () => {
    await renderAt('/p/customers', {
      pageReply: () => jsonResponse(200, { data: { ...makeCrudEnvelope(), v: 99 } }),
    });
    expect(await screen.findByText('This page needs a newer Adminium')).toBeDefined();
  });

  it('renders the invalid-config card when the envelope fails validation', async () => {
    await renderAt('/p/customers', {
      pageReply: () => jsonResponse(200, { data: { ...makeCrudEnvelope(), template: 'NOT KEBAB' } }),
    });
    expect(await screen.findByText('This page’s configuration is invalid')).toBeDefined();
  });

  it('renders the forbidden system state inside the outlet on a pages 403', async () => {
    await renderAt('/p/customers', {
      pageReply: () =>
        jsonResponse(403, {
          error: { code: 'PAGE_FORBIDDEN', message: 'no grant', requestId: 'req_403' },
        }),
    });
    expect(await screen.findByText('You don’t have access')).toBeDefined();
    // Shell + nav stay usable (page-scoped state, §6.1).
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeDefined();
  });
});
