// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/studio/public-api` — API keys & tokens, router-mounted: the route is
 * lazy, sits behind `StudioGuard`, and publishes its heading through the
 * PageActions channel, so a bare render proves none of that.
 *
 * What these pin, beyond "it renders":
 *  - a revealed token and a created token never enter the query cache;
 *  - revoke is behind a type-to-confirm door;
 *  - the sheet creates ONE key over several endpoints with different methods
 *    on each, and sends the generated endpoint's fingerprint;
 *  - the builder's form edits keep a key the form does not draw, a pane draft
 *    locks Save, and a refused save names the keys it would break.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { createAppRouter } from '../../app/router.js';
import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../../test/fixtures.js';
import type { EndpointDto, KeyDto, SourceDto } from './apiKeysApi.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

const REVEALED = 'adm_pub_ZZZZZZZZ1111111111111111111111111111111111';
const CREATED = 'adm_pub_NEWKEY001111111111111111111111111111111111';

function def(ref: string, methods: string[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify(
    {
      path: `/${ref}`,
      source: `public.${ref}`,
      methods,
      select: ['id', 'status'],
      filters: [],
      pagination: { default_limit: 20, max_limit: 200, order: 'id.desc' },
      auth: { role: 'anon' },
      rate_limit: { requests: 120, window: '1m' },
      response: { shape: 'object', envelope: 'data' },
      ...extra,
    },
    null,
    2,
  );
}

function endpoint(ref: string, methods: EndpointDto['methods'], over: Partial<EndpointDto> = {}): EndpointDto {
  return {
    id: null,
    ref,
    path: `/${ref}`,
    origin: 'generated',
    stored: false,
    definition: def(ref, methods),
    source: `public.${ref}`,
    methods,
    selectHash: `hash_${ref}`,
    issues: [],
    ...over,
  };
}

const SOURCES: SourceDto[] = ['orders', 'customers'].map((ref) => ({
  id: `public.${ref}`,
  label: ref,
  kind: 'table',
  rowCountEstimate: 830,
  icon: null,
  columns: [
    { name: 'id', type: 'integer', primaryKey: true, pii: false },
    { name: 'status', type: 'text', primaryKey: false, pii: false },
    { name: 'email', type: 'text', primaryKey: false, pii: true },
  ],
}));

function makeKey(over: Partial<KeyDto> = {}): KeyDto {
  return {
    id: 'pbk_1',
    name: 'Storefront web',
    prefix: 'adm_pub_4f2a91cd',
    scopeId: 'psc_1',
    connectionId: 'conn_1',
    kind: 'browser',
    access: [{ endpointId: 'pep_1', ref: 'orders', path: '/orders', methods: ['GET', 'PATCH'], suspended: [] }],
    issues: [],
    side: 'customer',
    appKey: null,
    origins: [],
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
    createdBy: null,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

interface StubOptions {
  keys?: KeyDto[];
  endpoints?: EndpointDto[];
  registered?: boolean;
  enabled?: boolean;
  /** Make PUT /public-endpoints refuse naming a key. */
  refuseSave?: boolean;
}

function stubFetch(options: StubOptions = {}) {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  const fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url, ...(init?.body === undefined ? {} : { body: JSON.parse(String(init.body)) as unknown }) });
    const ok = (status: number, body: unknown) => Promise.resolve(jsonResponse(status, body));
    if (url.startsWith('/api/v1/bootstrap')) {
      return ok(200, { data: makeBootstrap({ nav: { groups: [] }, roles: ['super-admin'] }) });
    }
    if (url === '/api/v1/public-api') {
      return ok(200, { enabled: options.enabled ?? true, registered: options.registered ?? true, origins: [], docsEnabled: true });
    }
    if (url === '/api/v1/connections') {
      return ok(200, { connections: [{ id: 'conn_1', name: 'Shop', engine: 'postgres', status: 'ok' }] });
    }
    if (url.startsWith('/api/v1/public-endpoints?')) {
      return ok(200, {
        snapshot: true,
        endpoints: options.endpoints ?? [endpoint('customers', ['GET', 'POST']), endpoint('orders', ['GET', 'PATCH', 'DELETE'])],
        methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'BATCH'],
        sources: SOURCES,
        unaddressable: [],
      });
    }
    if (url.startsWith('/api/v1/public-api/stats')) return ok(200, { requests24h: 128_400, errors24h: 2 });
    if (url === '/api/v1/public-keys' && method === 'GET') return ok(200, { keys: options.keys ?? [makeKey()] });
    if (url === '/api/v1/public-keys' && method === 'POST') {
      return ok(201, { key: makeKey({ id: 'pbk_new', name: 'Orders sync worker' }), token: CREATED });
    }
    if (url.endsWith('/reveal')) return ok(200, { token: REVEALED });
    if (url.startsWith('/api/v1/public-keys/') && method === 'DELETE') return ok(200, { ok: true });
    if (url === '/api/v1/public-endpoints/check') return ok(200, { issues: [], keys: [], keysStillBroken: [], widened: [] });
    if (url.startsWith('/api/v1/public-endpoints/') && method === 'PUT') {
      if (options.refuseSave === true) {
        return ok(422, {
          error: {
            code: 'VALIDATION_FAILED',
            message: 'The endpoint definition did not compile.',
            requestId: 'req_x',
            details: {
              issues: [{ code: 'KEY_SERVICE_ROLE_BROWSER', message: '"orders" is a service-role endpoint' }],
              keys: [{ id: 'pbk_1', name: 'Storefront web', prefix: 'adm_pub_4f2a91cd', scopeId: 'psc_1' }],
            },
          },
        });
      }
      return ok(200, { endpoint: endpoint('orders', ['GET']), keysStillBroken: [], widened: [] });
    }
    return ok(404, { error: { code: 'NOT_FOUND', message: 'nope', requestId: 'req_t' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls };
}

async function renderPage(options: StubOptions = {}) {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  const stub = stubFetch(options);
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, { history: createMemoryHistory({ initialEntries: ['/studio/public-api'] }) });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole('heading', { name: 'Active keys' });
  return { ...stub, queryClient };
}

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const cacheText = (queryClient: ReturnType<typeof createQueryClient>): string =>
  JSON.stringify(queryClient.getQueryCache().getAll().map((q) => q.state.data));

describe('the page body', () => {
  it('renders the comp’s header, stats, keys and endpoints', async () => {
    await renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'API keys & tokens' })).toBeTruthy();
    expect(screen.getByText('Manage programmatic access to your workspace')).toBeTruthy();
    expect(await screen.findByText('128K')).toBeTruthy();
    const keys = screen.getAllByRole('table')[0] as HTMLElement;
    expect(within(keys).getByText('Storefront web')).toBeTruthy();
    expect(within(keys).getByText('BROWSER')).toBeTruthy();
    expect(within(keys).getByText('1 endpoint · 2 methods')).toBeTruthy();
    expect(within(keys).getByText('Never')).toBeTruthy();
    expect(screen.getByText('1 key')).toBeTruthy();
    expect(await screen.findByText('/api/v1/public/records/orders')).toBeTruthy();
    expect(screen.getByText('Explore API').closest('a')?.getAttribute('href')).toBe('/api-docs');
  });

  it('states the server-level fact when the public API is not registered', async () => {
    await renderPage({ registered: false });
    expect(screen.getByRole('note').textContent).toContain('ADMINIUM_PUBLIC_API_ORIGINS');
  });

  it('reveals a browser key with an audited read, and never caches the token', async () => {
    const user = userEvent.setup();
    const { calls, queryClient } = await renderPage();
    await user.click(screen.getByRole('button', { name: 'Reveal key' }));
    expect(await screen.findByText(REVEALED)).toBeTruthy();
    expect(calls.some((c) => c.url.endsWith('/pbk_1/reveal'))).toBe(true);
    expect(cacheText(queryClient)).not.toContain(REVEALED);
  });

  it('a server key has no reveal button', async () => {
    await renderPage({ keys: [makeKey({ kind: 'server', prefix: 'adm_srv_ab12cd34' })] });
    expect(screen.getByText('SERVER')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reveal key' })).toBeNull();
  });

  it('revokes only through the type-to-confirm door', async () => {
    const user = userEvent.setup();
    const { calls } = await renderPage();
    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    const dialog = await screen.findByRole('dialog');
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    await user.type(within(dialog).getByRole('textbox'), 'Storefront web');
    await user.click(within(dialog).getByRole('button', { name: 'Revoke key' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/v1/public-keys/pbk_1')).toBe(true));
  });
});

describe('the create-key sheet', () => {
  it('makes ONE key over two endpoints with different methods, then shows it once in the banner', async () => {
    const user = userEvent.setup();
    const { calls, queryClient } = await renderPage();
    await user.click(screen.getByRole('button', { name: 'Create key' }));
    const sheet = await screen.findByRole('dialog', { name: 'Create API key' });
    const submit = within(sheet).getByRole('button', { name: 'Create key' });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    expect(within(sheet).getByText('Select at least one method to create a key.')).toBeTruthy();

    // customers: every method via its tri-state box; orders: GET only via its method row.
    await user.click(within(sheet).getAllByRole('checkbox', { name: '/customers' })[0] as HTMLElement);
    await user.click(within(sheet).getByRole('button', { name: /\/orders/ }));
    await user.click(within(sheet).getByRole('checkbox', { name: /Read/ }));
    expect(within(sheet).getByText(/This key will be able to call \/customers, \/orders/)).toBeTruthy();
    expect(within(sheet).getByText('3')).toBeTruthy();

    await user.type(within(sheet).getByPlaceholderText('e.g. Orders sync worker'), 'Orders sync worker');
    await user.click(submit);
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/v1/public-keys')).toBe(true));
    const body = calls.find((c) => c.method === 'POST' && c.url === '/api/v1/public-keys')?.body as {
      access: { ref: string; methods: string[]; selectHash?: string }[];
      kind: string;
    };
    expect(body.kind).toBe('browser');
    expect(body.access).toEqual([
      { ref: 'customers', methods: ['GET', 'POST'], source: 'public.customers', selectHash: 'hash_customers' },
      { ref: 'orders', methods: ['GET'], source: 'public.orders', selectHash: 'hash_orders' },
    ]);
    expect(await screen.findByText(CREATED)).toBeTruthy();
    expect(screen.getByText('Orders sync worker created')).toBeTruthy();
    expect(cacheText(queryClient)).not.toContain(CREATED);
  });

  it('Select all touches only the endpoints the filter shows, and the layout choice persists', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: 'Create key' }));
    const sheet = await screen.findByRole('dialog', { name: 'Create API key' });
    await user.type(within(sheet).getByRole('textbox', { name: 'Filter endpoints' }), 'orders');
    await user.click(within(sheet).getByRole('button', { name: 'Select all' }));
    await user.clear(within(sheet).getByRole('textbox', { name: 'Filter endpoints' }));
    expect(within(sheet).getByRole('checkbox', { name: '/orders' }).getAttribute('aria-checked')).toBe('true');
    expect(within(sheet).getByRole('checkbox', { name: '/customers' }).getAttribute('aria-checked')).toBe('false');

    await user.click(within(sheet).getByRole('radio', { name: 'List' }));
    expect(window.localStorage.getItem('adm.apiKeys.layout')).toBe('list');
    expect(within(sheet).getAllByRole('button', { expanded: true }).length).toBeGreaterThan(0);
  });
});

describe('the endpoint builder', () => {
  it('a form edit keeps a key the form does not draw, and a pane draft locks Save', async () => {
    const user = userEvent.setup();
    const stored = endpoint('orders', ['GET', 'PATCH'], {
      id: 'pep_1',
      stored: true,
      definition: def('orders', ['GET', 'PATCH'], { writable: ['status'] }),
    });
    const { calls } = await renderPage({ endpoints: [stored] });
    await user.click(screen.getByRole('button', { name: 'Edit endpoint' }));
    const builder = await screen.findByRole('dialog', { name: 'Edit endpoint' });
    const pane = within(builder).getByRole('textbox', { name: 'Route definition, JSON' }) as HTMLTextAreaElement;
    expect(within(builder).getByText('synced with form')).toBeTruthy();

    await user.click(within(builder).getByRole('button', { name: /PATCH/ }));
    expect(pane.value).toContain('"writable"');
    expect(pane.value).not.toContain('"PATCH"');

    fireEvent.change(pane, { target: { value: `${pane.value} ` } });
    expect(within(builder).getByText('edited — not applied')).toBeTruthy();
    expect((within(builder).getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(builder).getByText('Apply or revert the edited definition first.')).toBeTruthy();
    await user.click(within(builder).getByRole('button', { name: 'Revert' }));
    expect(within(builder).getByText('synced with form')).toBeTruthy();

    await user.click(within(builder).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const saved = calls.find((c) => c.method === 'PUT')?.body as { definition: string };
    expect(JSON.parse(saved.definition)).toMatchObject({ methods: ['GET'], writable: ['status'] });
  });

  it('a refused save names the keys it would break', async () => {
    const user = userEvent.setup();
    const stored = endpoint('orders', ['GET'], { id: 'pep_1', stored: true });
    await renderPage({ endpoints: [stored], refuseSave: true });
    await user.click(screen.getByRole('button', { name: 'Edit endpoint' }));
    const builder = await screen.findByRole('dialog', { name: 'Edit endpoint' });
    await user.click(within(builder).getByRole('button', { name: 'Save changes' }));
    expect(await within(builder).findByRole('alert')).toBeTruthy();
    expect(within(builder).getByRole('alert').textContent).toContain('Saving this would break 1 key: Storefront web.');
  });
});
