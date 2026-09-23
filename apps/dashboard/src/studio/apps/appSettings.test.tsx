// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One app's own page: what it shows, and that each control sends exactly the
 * change it names — a switch sends `off`, a choice sends its value, Disable
 * asks first, Enable does not, and a new host goes back beside the old ones.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { createAppRouter } from '../../app/router.js';
import type { AppSection } from '../../app/bootstrap.js';
import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../../test/fixtures.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

interface Call {
  method: string;
  url: string;
  body?: unknown;
}

let calls: Call[];
let status: 'installed' | 'disabled';
let settings: Record<string, unknown>;
let sample: Record<string, unknown>;
let sectionStaff: AppSection['staff'] | undefined;
let removePlan: Record<string, unknown>;

beforeEach(async () => {
  await installTestI18n();
  calls = [];
  status = 'installed';
  sectionStaff = undefined;
  sample = {
    offered: true,
    loaded: false,
    total: 0,
    addedAt: null,
    tables: [],
    available: { total: 31, tables: [{ ref: 'menu_items', count: 25 }, { ref: 'tickets', count: 6 }], assets: 2 },
  };
  removePlan = {
    tables: [{ ref: 'menu_items', count: 25 }, { ref: 'tickets', count: 6 }],
    kept: [{ ref: 'menu_items', label: 'item:latte', title: 'Latte', usedBy: 3 }],
    changed: [{ ref: 'menu_items', label: 'item:tea', title: 'Green tea', columns: ['name'] }],
    total: 31,
  };
  settings = {
    key: 'pos',
    name: null,
    placement: 'internal',
    connectionId: null,
    off: [],
    values: { business_type: 'restaurant' },
    domains: { 'shop.example.test': { side: 'customer' } },
    declared: [
      { key: 'business_type', type: 'enum', enum: ['restaurant', 'retail'], label: 'Business type', help: 'Retail hides the floor plan.' },
    ],
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
      calls.push({ method, url, ...(body === undefined ? {} : { body }) });
      if (url.startsWith('/api/v1/bootstrap')) {
        return Promise.resolve(
          jsonResponse(200, {
            data: makeBootstrap({
              nav: {
                groups: [
                  {
                    key: 'workspace',
                    items: [
                      {
                        pageId: 'page_menu',
                        slug: 'pos-menu',
                        labelKey: 'nav.pos-menu',
                        fallback: 'Menu',
                        icon: 'utensils',
                        order: 1,
                        connectionId: 'con_1',
                        sourceTable: 'public.pos_menu_items',
                        appKey: 'pos',
                      },
                    ],
                  },
                ],
              },
              roles: ['super-admin'],
              ...(sectionStaff === undefined
                ? {}
                : { appSections: [{ appKey: 'pos', label: 'Point of Sale', version: '0.2.0', groups: [], staff: sectionStaff }] }),
            }),
          }),
        );
      }
      if (url === '/api/v1/apps' && method === 'GET') {
        return Promise.resolve(
          jsonResponse(200, {
            apps: [
              {
                key: 'pos',
                version: '0.2.0',
                source: 'file',
                installedAt: 0,
                connectionId: 'con_1',
                missing: false,
                status,
                sides: [
                  { side: 'staff', prefix: '/apps/pos/staff', navAvailable: true, openUrl: '/apps/pos/staff/', state: 'on' },
                  { side: 'customer', prefix: '/apps/pos/customer', navAvailable: true, openUrl: 'https://shop.example.test/', state: 'on' },
                ],
              },
            ],
            staged: [],
          }),
        );
      }
      if (url === '/api/v1/apps/catalog') {
        return Promise.resolve(
          jsonResponse(200, {
            apps: [
              {
                key: 'pos', version: '0.2.0', name: 'Point of Sale', description: '', categories: [], publisher: 'Adminium',
                capabilities: [], sides: ['staff', 'customer'], installed: true, installedVersion: null, readable: true,
                source: 'disk', state: 'installed', updateTo: null, updateStaged: false, needsNewerAdminium: null,
              },
            ],
            catalogFetchedAt: null,
            onlineEnabled: false,
          }),
        );
      }
      if (url === '/api/v1/apps/pos/settings' && method === 'GET') return Promise.resolve(jsonResponse(200, settings));
      if (url === '/api/v1/apps/pos/settings' && method === 'PATCH') return Promise.resolve(jsonResponse(200, settings));
      if (url === '/api/v1/apps/pos/overview') {
        return Promise.resolve(
          jsonResponse(200, {
            key: 'pos',
            connection: { id: 'con_1', name: 'Daybreak production', engine: 'postgres' },
            tables: [
              { ref: 'menu_items', table: 'pos_menu_items', state: 'created', rows: 25 },
              { ref: 'tickets', table: 'pos_tickets', state: 'created', rows: null },
              ...(sample.loaded === true
                ? [{ ref: 'sample_data', table: 'pos_sample_data', state: 'created', role: 'sample-ledger', rows: 31 }]
                : []),
            ],
            activity: [
              { action: 'app.sample-data.add', at: Date.now() - 30_000, actor: 'Ava Reyes' },
              { action: 'app.installed', at: Date.now() - 60_000, actor: 'Ava Reyes' },
            ],
          }),
        );
      }
      if (url === '/api/v1/apps/pos/sample-data' && method === 'GET') return Promise.resolve(jsonResponse(200, sample));
      if (url === '/api/v1/apps/pos/sample-data' && method === 'POST') {
        sample = { ...sample, loaded: true, total: 31, addedAt: Date.UTC(2026, 8, 22), available: null };
        return Promise.resolve(jsonResponse(200, { jobId: 'job_sample' }));
      }
      if (url === '/api/v1/jobs/job_sample') {
        return Promise.resolve(
          jsonResponse(200, { data: { id: 'job_sample', status: 'succeeded', progress: { pct: 100 }, lastError: null } }),
        );
      }
      if (url === '/api/v1/apps/pos/sample-data/remove-plan') return Promise.resolve(jsonResponse(200, removePlan));
      if (url === '/api/v1/apps/pos/sample-data/remove') {
        sample = { ...sample, total: 2 };
        return Promise.resolve(jsonResponse(200, { removed: 29, kept: 2, byTable: { menu_items: 23, tickets: 6 } }));
      }
      if (url === '/api/v1/apps/pos/disable') return Promise.resolve(jsonResponse(200, { key: 'pos', status: 'disabled' }));
      if (url === '/api/v1/apps/pos/enable') return Promise.resolve(jsonResponse(200, { key: 'pos', status: 'installed' }));
      if (url === '/api/v1/apps/pos/domains') return Promise.resolve(jsonResponse(200, { domains: {} }));
      if (url.startsWith('/api/v1/connections')) return Promise.resolve(jsonResponse(200, { connections: [] }));
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: url, requestId: 'r' } }));
    }),
  );
}

async function renderPage() {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  stubFetch();
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, { history: createMemoryHistory({ initialEntries: ['/studio/apps/pos'] }) });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  // The page's own heading; the top bar names the page too.
  await screen.findByRole('heading', { name: 'Point of Sale', level: 2 });
}

const sent = (method: string, url: string) => calls.filter((c) => c.method === method && c.url === url);

describe('one app’s own page', () => {
  it('shows the app, its screens, its setting, its data and its activity', async () => {
    await renderPage();
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getByText('Version 0.2.0 · by Adminium')).toBeTruthy();
    expect(within(screen.getByTestId('app-side-staff')).getByText('Staff screens')).toBeTruthy();
    expect(within(screen.getByTestId('app-side-customer')).getByText('https://shop.example.test/')).toBeTruthy();
    const setting = screen.getByTestId('app-setting-business_type');
    expect(within(setting).getByText('Business type')).toBeTruthy();
    expect(within(setting).getByText('Retail hides the floor plan.')).toBeTruthy();
    expect(screen.getByText('Daybreak production · postgres')).toBeTruthy();
    expect(screen.getByText('25 rows')).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.getByText(/Installed by Ava Reyes/)).toBeTruthy();
    expect(screen.getByText(/Sample data added by Ava Reyes/)).toBeTruthy();
  });

  it('sends the side a switch turns off, and the value a choice picks', async () => {
    await renderPage();
    await userEvent.click(screen.getByRole('switch', { name: /Customer screens/ }));
    await waitFor(() => expect(sent('PATCH', '/api/v1/apps/pos/settings')[0]?.body).toEqual({ off: ['customer'] }));
    await userEvent.click(within(screen.getByTestId('app-setting-business_type')).getByRole('radio', { name: 'Retail' }));
    await waitFor(() =>
      expect(sent('PATCH', '/api/v1/apps/pos/settings')[1]?.body).toEqual({ values: { business_type: 'retail' } }),
    );
  });

  it('asks before Disable, and says nothing is deleted', async () => {
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Disable' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Disable Point of Sale?')).toBeTruthy();
    expect(within(dialog).getByText('Nothing is deleted.')).toBeTruthy();
    expect(sent('POST', '/api/v1/apps/pos/disable')).toHaveLength(0);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Disable' }));
    await waitFor(() => expect(sent('POST', '/api/v1/apps/pos/disable')).toHaveLength(1));
  });

  it('enables a disabled app at once', async () => {
    status = 'disabled';
    await renderPage();
    expect(screen.getByText('Disabled')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Enable' }));
    await waitFor(() => expect(sent('POST', '/api/v1/apps/pos/enable')).toHaveLength(1));
  });

  it('adds a host beside the app’s others', async () => {
    await renderPage();
    await userEvent.click(within(screen.getByTestId('app-side-staff')).getByRole('button', { name: 'Add a domain' }));
    await userEvent.type(screen.getByLabelText('Domain'), 'till.example.test');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(sent('PUT', '/api/v1/apps/pos/domains')[0]?.body).toEqual({
        domains: { 'shop.example.test': { side: 'customer' }, 'till.example.test': { side: 'staff' } },
      }),
    );
  });
});

describe('the app’s sample data', () => {
  it('offers the sample data, lists what it adds, and adds it as a job', async () => {
    await renderPage();
    const card = await screen.findByTestId('app-sample-data');
    expect(within(card).getByText('Not loaded')).toBeTruthy();
    expect(screen.queryByText('pos_sample_data')).toBeNull();
    await userEvent.click(within(card).getByRole('button', { name: 'Add sample data' }));
    const dialog = await screen.findByRole('dialog');
    const tables = within(dialog).getByTestId('sample-add-tables');
    // The tables by their real names, the images, and the total.
    expect(within(tables).getByText('pos_menu_items')).toBeTruthy();
    expect(within(tables).getByText('Images, added to Files')).toBeTruthy();
    expect(within(tables).getByText('31 records')).toBeTruthy();
    expect(within(dialog).getByText(/Nothing else in Daybreak production is touched/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add sample data' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(sent('POST', '/api/v1/apps/pos/sample-data')).toHaveLength(1);
    expect(await within(card).findByText(/Loaded · 31 records ·/)).toBeTruthy();
    // The ledger now exists, dimmed, and says what it is.
    const ledger = (await screen.findByText('pos_sample_data')).closest('li')!;
    expect(ledger.className).toContain('opacity-60');
    expect(within(ledger).getByText('Adminium’s list of sample records')).toBeTruthy();
  });

  it('removes it, naming what it keeps, and keeps what you changed unless told otherwise', async () => {
    sample = { ...sample, loaded: true, total: 31, addedAt: Date.UTC(2026, 8, 22), tables: [], available: null };
    await renderPage();
    const card = await screen.findByTestId('app-sample-data');
    await userEvent.click(await within(card).findByRole('button', { name: 'Remove sample data' }));
    const dialog = await screen.findByRole('dialog');
    const removes = await within(dialog).findByTestId('sample-remove-tables');
    // A table a page shows goes by the page's name; the others by their own.
    expect(within(removes).getByText('Menu')).toBeTruthy();
    expect(within(removes).getByText('pos_tickets')).toBeTruthy();
    const kept = within(dialog).getByTestId('sample-remove-kept');
    expect(kept.textContent).toContain('Latte — used by 3 of your own records');
    expect(within(dialog).getByText(/1 sample record you edited: Green tea\./)).toBeTruthy();
    const keep = within(dialog).getByRole('checkbox');
    expect(keep.getAttribute('aria-checked')).toBe('true');
    await userEvent.click(keep);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(sent('POST', '/api/v1/apps/pos/sample-data/remove')[0]?.body).toEqual({ keepChanged: false }));
    expect(await within(card).findByText(/2 sample records stay/)).toBeTruthy();
  });

  it('is not drawn for an app that ships none', async () => {
    sample = { offered: false, loaded: false, total: 0, addedAt: null, tables: [], available: null };
    await renderPage();
    await waitFor(() => expect(sent('GET', '/api/v1/apps/pos/sample-data')).toHaveLength(1));
    expect(screen.queryByTestId('app-sample-data')).toBeNull();
  });
});

describe('opening the app', () => {
  it('opens its section in the dashboard when its staff screens live there', async () => {
    sectionStaff = { placement: 'internal', items: [{ id: 'till', path: '', label: 'Register' }] };
    await renderPage();
    const open = screen.getByRole('link', { name: 'Open the app' });
    expect(open.getAttribute('href')).toBe('/a/pos');
    expect(open.getAttribute('target')).toBeNull();
  });

  it('opens its own address in a new tab when it lives there', async () => {
    sectionStaff = { placement: 'external', url: 'https://till.example.test/' };
    await renderPage();
    const open = screen.getByRole('link', { name: 'Open the app' });
    expect(open.getAttribute('href')).toBe('https://till.example.test/');
    expect(open.getAttribute('target')).toBe('_blank');
  });
});
