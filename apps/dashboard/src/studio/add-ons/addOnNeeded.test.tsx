// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/studio/add-ons` and the apps that use an add-on.
 *
 * The page reads who uses each add-on BEFORE any click, so it can say so
 * first: an app that requires it stops an uninstall (and switching it off for
 * that app) with the way out named; an app that uses it for a feature is
 * warned about, and the removal goes ahead only when asked again. A stale page
 * still ends in the same dialog, from the server's 409.
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
import type { AddOnDto, AddOnUse } from './addOnsApi.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

const PORTAL: AddOnUse = { app: 'clients', appName: 'Client Portal', status: 'installed', need: 'requires', range: '>=1.1.0', features: [] };
const TILL: AddOnUse = {
  app: 'pos',
  appName: 'Point of Sale',
  status: 'disabled',
  need: 'feature',
  range: '>=1.0.0',
  features: [{ id: 'emailed-receipts', label: { 'en-US': 'Emailed receipts' } }],
};

function invoices(usedBy: AddOnUse[]): AddOnDto {
  return {
    key: 'invoices',
    name: 'Invoices & Receipts',
    version: '1.1.0',
    connectKind: 'none',
    connected: false,
    missing: false,
    connectionExpiresAt: null,
    attachments: [
      { attachedTo: 'clients', enabled: true },
      { attachedTo: 'pos', enabled: true },
    ],
    slots: [],
    provides: [],
    networkAllow: [],
    settings: [],
    settingValues: {},
    bundles: [],
    usedBy,
  };
}

let calls: { method: string; url: string; body?: unknown }[];
let installed: AddOnDto[];
let deleteReply: () => Response;

beforeEach(async () => {
  await installTestI18n();
  calls = [];
  deleteReply = () => jsonResponse(200, { key: 'invoices', tablesKept: true, packageRemoved: true });
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
      calls.push({ method, url, ...(body === undefined ? {} : { body }) });
      if (url.startsWith('/api/v1/bootstrap')) {
        return Promise.resolve(jsonResponse(200, { data: makeBootstrap({ nav: { groups: [] }, roles: ['super-admin'] }) }));
      }
      if (url === '/api/v1/add-ons' && method === 'GET') return Promise.resolve(jsonResponse(200, { addOns: installed }));
      if (url === '/api/v1/add-ons/catalog') {
        return Promise.resolve(jsonResponse(200, { addOns: [], catalogFetchedAt: null, onlineEnabled: false }));
      }
      if (url === '/api/v1/add-ons/invoices' && method === 'DELETE') return Promise.resolve(deleteReply());
      if (url === '/api/v1/add-ons/invoices' && method === 'PATCH') {
        return Promise.resolve(jsonResponse(200, { addOn: installed[0] }));
      }
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: url, requestId: 'r' } }));
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderPage() {
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, { history: createMemoryHistory({ initialEntries: ['/studio/add-ons'] }) });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByText('Invoices & Receipts');
  return router;
}

const sent = (method: string, url: string) => calls.filter((call) => call.method === method && call.url === url);

describe('an add-on an app uses', () => {
  it('says who uses it, before anyone clicks', async () => {
    installed = [invoices([PORTAL, TILL])];
    await renderPage();
    expect(document.querySelector('[data-part="add-on-used-by"]')?.textContent).toBe(
      'Used by Client Portal (Required) · Point of Sale (Needed for: Emailed receipts)',
    );
  });

  it('refuses the uninstall while an app requires it, names the way out, and sends nothing', async () => {
    installed = [invoices([PORTAL, TILL])];
    const router = await renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Uninstall' }));
    const dialog = await screen.findByTestId('add-on-needed');
    expect(screen.getByRole('dialog').textContent).toContain('Uninstall Invoices & Receipts');
    expect(dialog.textContent).toContain('Invoices & Receipts can’t be uninstalled. Client Portal needs it.');
    expect(dialog.textContent).toContain('Used by');
    expect(dialog.textContent).toContain('To uninstall it, uninstall Client Portal first.');
    // Only the app that stops it is listed; the feature user is not the reason.
    expect(dialog.textContent).not.toContain('Point of Sale');
    const buttons = within(screen.getByRole('dialog')).getAllByRole('button').map((button) => button.textContent);
    expect(buttons).not.toContain('Uninstall anyway');
    expect(sent('DELETE', '/api/v1/add-ons/invoices')).toHaveLength(0);
    await user.click(within(dialog).getByRole('link', { name: /Open Client Portal/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/studio/apps/clients'));
  });

  it('warns that a feature will stop, and uninstalls only when asked again', async () => {
    installed = [invoices([TILL])];
    await renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Uninstall' }));
    const dialog = await screen.findByTestId('add-on-needed');
    expect(dialog.textContent).toContain('Point of Sale’s Emailed receipts will switch off.');
    expect(dialog.textContent).toContain('The rest of Point of Sale works without it.');
    // A switched-off app still holds its need, and says so.
    expect(dialog.textContent).toContain('Switched off — it still needs it');
    expect(sent('DELETE', '/api/v1/add-ons/invoices')).toHaveLength(0);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Uninstall anyway' }));
    await waitFor(() => expect(sent('DELETE', '/api/v1/add-ons/invoices')).toHaveLength(1));
  });

  it('refuses switching it off for the app that requires it, and lets it go for the others', async () => {
    installed = [invoices([PORTAL])];
    await renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^clients/ }));
    const dialog = await screen.findByTestId('add-on-needed');
    expect(screen.getByRole('dialog').textContent).toContain('Switch off for Client Portal');
    expect(dialog.textContent).toContain('Invoices & Receipts can’t be switched off for Client Portal. Client Portal needs it.');
    expect(dialog.textContent).toContain('To switch it off, uninstall Client Portal first.');
    expect(sent('PATCH', '/api/v1/add-ons/invoices')).toHaveLength(0);
    await user.click(within(screen.getByRole('dialog')).getAllByRole('button', { name: 'Close' }).at(-1)!);
    await user.click(screen.getByRole('button', { name: /^pos/ }));
    await waitFor(() => expect(sent('PATCH', '/api/v1/add-ons/invoices')).toHaveLength(1));
    expect(sent('PATCH', '/api/v1/add-ons/invoices')[0]?.body).toEqual({ attachedTo: 'pos', enabled: false });
  });

  it('ends in the same dialog when the server says an app requires it', async () => {
    installed = [invoices([])];
    deleteReply = () =>
      jsonResponse(409, {
        error: {
          code: 'ADD_ON_REQUIRED_BY',
          message: '"invoices" can’t be removed: Client Portal needs it.',
          requestId: 'r',
          details: { addOn: 'invoices', apps: [{ app: 'clients', name: 'Client Portal', status: 'installed' }] },
        },
      });
    await renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Uninstall' }));
    // Nobody used it as far as the page knew: the ordinary confirm first.
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Uninstall' }));
    const dialog = await screen.findByTestId('add-on-needed');
    expect(dialog.textContent).toContain('Invoices & Receipts can’t be uninstalled. Client Portal needs it.');
  });
});
