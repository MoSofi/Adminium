// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app's add-ons after the install: its settings page's Add-ons card, what
 * an uninstall keeps, and the address of a page whose feature waits on an
 * add-on.
 *
 * Worth proving: every row says whether the add-on is here and offers the one
 * thing to do about it; Install asks the add-on's own consent (downloading it
 * first when only the catalogue has it) and connects it to THIS app; a
 * feature that waits says its pages left the sidebar; and a bookmark to such a
 * page lands on what it needs, not on a 404.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { createAppRouter } from '../../app/router.js';
import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../../test/fixtures.js';
import { UninstallAppDialog } from './UninstallAppDialog.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

function row(over: Record<string, unknown> & { key: string; name: string }): Record<string, unknown> {
  return {
    need: 'suggests',
    range: '>=1.1.0',
    reason: { 'en-US': 'Why.' },
    checked: false,
    features: [],
    state: 'attached',
    source: 'bundled',
    installedVersion: '1.1.0',
    offeredVersion: null,
    satisfiesRange: true,
    staged: true,
    enabled: true,
    action: null,
    usedBy: [],
    problems: [],
    ...over,
  };
}

const RECEIPTS = { id: 'emailed-receipts', label: { 'en-US': 'Emailed receipts', 'de-DE': 'Belege per E-Mail' } };

let calls: { method: string; url: string; body?: unknown }[];
let addOns: Record<string, unknown>[];
let jobPolls: number;
let managesApps: boolean;

beforeEach(async () => {
  await installTestI18n();
  calls = [];
  jobPolls = 0;
  managesApps = true;
  addOns = [
    row({ key: 'invoices', name: 'Invoices & Receipts', need: 'feature', features: [RECEIPTS] }),
    row({
      key: 'holiday-calendars',
      name: 'Holiday calendars',
      state: 'absent',
      source: 'catalog',
      installedVersion: null,
      offeredVersion: '1.1.0',
      satisfiesRange: false,
      staged: false,
      enabled: false,
      action: 'install',
    }),
  ];
  vi.stubGlobal('WebSocket', FakeWebSocket);
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
              nav: { groups: [{ key: 'workspace', items: [] }] },
              roles: managesApps ? ['super-admin'] : ['viewer'],
              ...(managesApps ? {} : { systemActions: [] }),
              featurePages: [
                {
                  pageId: 'page_receipts',
                  slug: 'pos-receipts',
                  labelKey: 'nav.pos-receipts',
                  fallback: 'Receipts',
                  icon: 'receipt',
                  order: 4,
                  appKey: 'pos',
                  feature: 'emailed-receipts',
                  needs: ['invoices'],
                },
              ],
            }),
          }),
        );
      }
      if (url === '/api/v1/apps' && method === 'GET') {
        return Promise.resolve(
          jsonResponse(200, {
            apps: [{ key: 'pos', version: '0.2.0', source: 'file', installedAt: 0, connectionId: 'con_1', missing: false, status: 'installed', sides: [] }],
            staged: [],
          }),
        );
      }
      if (url === '/api/v1/apps/catalog') return Promise.resolve(jsonResponse(200, { apps: [], catalogFetchedAt: null, onlineEnabled: false }));
      if (url === '/api/v1/apps/pos/settings') {
        return Promise.resolve(
          jsonResponse(200, { key: 'pos', name: 'Point of Sale', placement: 'internal', connectionId: null, off: [], values: {}, domains: {}, declared: [], addOns }),
        );
      }
      if (url === '/api/v1/apps/pos/overview') {
        return Promise.resolve(jsonResponse(200, { key: 'pos', connection: null, tables: [], activity: [] }));
      }
      if (url === '/api/v1/apps/pos/sample-data') {
        return Promise.resolve(jsonResponse(200, { offered: false, loaded: false, total: 0, addedAt: null, tables: [], available: null }));
      }
      if (url === '/api/v1/add-ons/catalog') return Promise.resolve(jsonResponse(200, { addOns: [], catalogFetchedAt: null, onlineEnabled: true }));
      if (url === '/api/v1/add-ons/download') return Promise.resolve(jsonResponse(200, { jobId: 'job_dl' }));
      if (url === '/api/v1/jobs/job_dl') {
        jobPolls += 1;
        return Promise.resolve(jsonResponse(200, { data: { id: 'job_dl', status: jobPolls > 1 ? 'succeeded' : 'running', progress: { pct: 50 }, lastError: null } }));
      }
      if (url === '/api/v1/add-ons/holiday-calendars/plan') {
        return Promise.resolve(
          jsonResponse(200, {
            plan: {
              addOnKey: 'holiday-calendars',
              version: '1.1.0',
              installable: true,
              touchesData: true,
              create: [{ ref: 'holidays', columns: [] }],
              reuse: [],
              references: [],
              problems: [],
              requiresSchemaChange: true,
            },
          }),
        );
      }
      if (url === '/api/v1/add-ons' && method === 'POST') {
        addOns = addOns.map((one) => (one['key'] === 'holiday-calendars' ? { ...one, state: 'attached', installedVersion: '1.1.0', enabled: true } : one));
        return Promise.resolve(jsonResponse(200, { addOn: {}, plan: {} }));
      }
      if (url === '/api/v1/add-ons/invoices/attachments') return Promise.resolve(jsonResponse(200, { addOn: {}, change: 'attached' }));
      if (url.startsWith('/api/v1/connections')) return Promise.resolve(jsonResponse(200, { connections: [] }));
      if (url === '/api/v1/apps/pos/uninstall-plan') {
        return Promise.resolve(
          jsonResponse(200, {
            key: 'pos',
            pages: { removed: [], kept: [] },
            keys: 0,
            endpoints: 0,
            roles: [],
            tables: [],
            hosts: [],
            canDropTables: false,
            addOns: [{ key: 'invoices', name: 'Invoices & Receipts', version: '1.1.0' }],
          }),
        );
      }
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: url, requestId: 'r' } }));
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderAt(path: string) {
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, { history: createMemoryHistory({ initialEntries: [path] }) });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const rowOf = (key: string) => document.querySelector(`[data-testid="app-add-ons"] [data-add-on="${key}"]`) as HTMLElement;

describe('an app’s Add-ons card', () => {
  it('says what is here and offers the one thing to do', async () => {
    const router = await renderAt('/studio/apps/pos');
    await screen.findByTestId('app-add-ons');
    const invoices = rowOf('invoices');
    expect(invoices.querySelector('[data-need="feature"]')?.textContent).toBe('Needed for: Emailed receipts');
    expect(invoices.textContent).toContain('Installed · v1.1.0 · Comes with Adminium');
    const holidays = rowOf('holiday-calendars');
    expect(holidays.querySelector('[data-need="suggests"]')?.textContent).toBe('Suggested');
    expect(holidays.textContent).toContain('Not installed · v1.1.0 · From the add-on catalogue');
    expect(within(holidays).getByRole('button', { name: 'Install' })).toBeTruthy();
    const open = within(invoices).getByRole('link', { name: /Open its settings/ });
    await userEvent.setup().click(open);
    await waitFor(() => expect(router.state.location.pathname).toBe('/studio/add-ons'));
    expect(router.state.location.hash).toBe('add-on-invoices');
  });

  it('downloads a catalogue add-on, asks its consent, and installs it connected to this app', async () => {
    await renderAt('/studio/apps/pos');
    await screen.findByTestId('app-add-ons');
    const user = userEvent.setup();
    await user.click(within(rowOf('holiday-calendars')).getByRole('button', { name: 'Install' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Install Holiday calendars');
    expect(dialog.textContent).toContain('holidays');
    expect(dialog.textContent).toContain('It will be connected to Point of Sale.');
    expect(calls.find((call) => call.url === '/api/v1/add-ons/download')?.body).toEqual({ key: 'holiday-calendars', version: '1.1.0' });
    // Nothing installed until the consent is given.
    expect(calls.filter((call) => call.url === '/api/v1/add-ons' && call.method === 'POST')).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Install' }));
    await screen.findByText('Holiday calendars installed and connected to Point of Sale');
    expect(calls.find((call) => call.url === '/api/v1/add-ons' && call.method === 'POST')?.body).toEqual({
      key: 'holiday-calendars',
      version: '1.1.0',
      attachTo: ['pos'],
    });
  });

  it('connects an installed add-on, and says where a waiting feature’s pages went', async () => {
    addOns = [row({ key: 'invoices', name: 'Invoices & Receipts', need: 'feature', features: [RECEIPTS], state: 'installed', enabled: false, action: 'attach' })];
    await renderAt('/studio/apps/pos');
    await screen.findByTestId('app-add-ons');
    const invoices = rowOf('invoices');
    expect(invoices.textContent).toContain('Not connected to Point of Sale');
    expect(invoices.querySelector('[data-part="add-on-feature-off"]')?.textContent).toBe(
      'Emailed receipts is off: its pages are not in the sidebar until Invoices & Receipts is installed and connected.',
    );
    await userEvent.setup().click(within(invoices).getByRole('button', { name: 'Connect' }));
    await screen.findByText('Invoices & Receipts connected to Point of Sale');
    expect(calls.find((call) => call.url === '/api/v1/add-ons/invoices/attachments')?.body).toEqual({ app: 'pos' });
  });

  it('says how to add one this Adminium cannot have, and that one installed is too old', async () => {
    addOns = [
      row({ key: 'invoices', name: 'Invoices & Receipts', need: 'requires', state: 'outdated', installedVersion: '1.0.2', satisfiesRange: false }),
      row({ key: 'barcode-labels', name: 'Barcode labels', state: 'unavailable', source: null, installedVersion: null, satisfiesRange: false }),
    ];
    await renderAt('/studio/apps/pos');
    await screen.findByTestId('app-add-ons');
    const invoices = rowOf('invoices');
    expect(invoices.querySelector('[data-need="requires"]')?.textContent).toBe('Required');
    expect(invoices.textContent).toContain('Installed · v1.0.2');
    expect(invoices.querySelector('[data-part="add-on-note"]')?.textContent).toBe('Point of Sale needs 1.1.0 or later');
    const labels = rowOf('barcode-labels');
    await waitFor(() =>
      expect(labels.textContent).toContain('Not installed · Doesn’t come with this Adminium, and the add-on catalogue has no version it can use'),
    );
    expect(within(labels).getByRole('link', { name: /How to add an add-on/ })).toBeTruthy();
  });

  it('is not drawn for an app that names no add-on', async () => {
    addOns = [];
    await renderAt('/studio/apps/pos');
    await screen.findByRole('heading', { name: 'Point of Sale', level: 2 });
    expect(screen.queryByTestId('app-add-ons')).toBeNull();
  });
});

describe('a page whose feature waits on an add-on', () => {
  it('says what it needs and sends a manager to the app’s settings', async () => {
    const router = await renderAt('/p/pos-receipts');
    const notice = await screen.findByTestId('feature-page-notice');
    expect(notice.textContent).toContain('Receipts needs an add-on');
    expect(notice.textContent).toContain('so it is not in the sidebar');
    expect(notice.textContent).toContain('invoices');
    await userEvent.setup().click(within(notice).getByRole('link', { name: /Open the app’s settings/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/studio/apps/pos'));
  });

  it('tells someone who cannot manage apps whom to ask', async () => {
    managesApps = false;
    await renderAt('/p/pos-receipts');
    const notice = await screen.findByTestId('feature-page-notice');
    expect(notice.textContent).toContain('Someone who manages apps can install it.');
    expect(within(notice).queryByRole('link')).toBeNull();
  });
});

describe('uninstalling an app with add-ons', () => {
  it('keeps the add-on installed, drops only its link, and says so', async () => {
    render(
      <QueryClientProvider client={createQueryClient()}>
        <UninstallAppDialog appKey="pos" name="Point of Sale" onClose={() => {}} onUninstalled={() => {}} />
      </QueryClientProvider>,
    );
    await screen.findByText('Kept');
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('Its link to Invoices & Receipts');
    expect(dialog.textContent).toContain('Invoices & Receipts stays installed. Uninstall it from Add-ons if nothing else uses it.');
  });
});
