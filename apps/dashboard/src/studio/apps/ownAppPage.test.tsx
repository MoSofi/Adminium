// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The app page for an app someone made, and for one copy of an app installed
 * on several databases: what each shows, and that every read and write names
 * the copy (`X-Adminium-Install`).
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
import { afterInstallRows, afterInstallText } from './OwnAppCards.js';
import type { AfterInstallItem, InstalledApp } from './appsApi.js';

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
  install: string | null;
  body?: unknown;
}

let calls: Call[];
let apps: InstalledApp[];
let afterItems: AfterInstallItem[];
let hidden: boolean;
let look: Record<string, unknown> | null;
let editable: Record<string, unknown>;
let tables: { ref: string; table: string; state: string; rows: number | null; before?: true }[];
let workspaces: unknown;

const own: InstalledApp = {
  key: 'fernhill-ops',
  version: '1.0.0',
  source: 'file',
  installedAt: Date.now() - 60_000,
  connectionId: 'con_new',
  sides: [],
  missing: false,
  status: 'installed',
  publisher: { id: 'local', name: 'Fernhill main' },
  installId: 'mf_ops',
  slug: '',
  address: 'fernhill-ops',
  connectionName: 'fernhill',
  name: 'Fernhill Ops',
  madeAt: { label: 'Fernhill main', savedAt: '2026-11-01T10:00:00.000Z', adminiumVersion: '0.3.49' },
};

function item(over: Partial<AfterInstallItem> & Pick<AfterInstallItem, 'id' | 'kind' | 'item'>): AfterInstallItem {
  return { field: 'url', name: null, done: false, doneBy: null, doneAt: null, seen: false, right: 'system:automations:manage', canTick: true, link: null, ...over };
}

beforeEach(async () => {
  await installTestI18n();
  calls = [];
  apps = [own];
  hidden = false;
  workspaces = undefined;
  tables = [
    { ref: 'roast_profiles', table: 'roast_profiles', state: 'created', rows: 12 },
    { ref: 'green_lots', table: 'green_lots', state: 'adopted', rows: 30, before: true },
  ];
  afterItems = [
    item({ id: 'a1', kind: 'webhook', item: 'post-orders', name: 'Post wholesale orders to Slack', link: { to: 'automation', id: 'rule_1' } }),
    item({ id: 'a2', kind: 'sender', item: 'order-mail', field: 'from', right: 'system:settings:manage', link: { to: 'email-templates' } }),
    item({ id: 'a3', kind: 'sender', item: 'invoice-mail', field: 'from', right: 'system:settings:manage', link: { to: 'email-templates' } }),
    item({ id: 'a4', kind: 'system-grant', item: 'finance', field: 'system:reports:manage', name: 'Finance', right: 'system:roles:manage', done: true, doneBy: { id: 'u1', name: 'Rosa Okafor' }, doneAt: Date.now() - 5_000 }),
  ];
  look = {
    appliedAt: Date.now() - 60_000,
    logo: true,
    colours: true,
    languages: ['en-US', 'de-DE'],
    wordings: 12,
    systemEmails: 2,
    settings: 0,
    changed: ['colours'],
    canUndo: true,
  };
  editable = { state: 'none', folder: 'apps/fernhill-ops/' };
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
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ method, url, install: headers['x-adminium-install'] ?? null, ...(body === undefined ? {} : { body }) });
      const list = { items: afterItems, hidden };
      if (url.startsWith('/api/v1/bootstrap')) {
        return Promise.resolve(jsonResponse(200, { data: { ...makeBootstrap({ roles: ['super-admin'] }), ...(workspaces === undefined ? {} : { workspaces }) } }));
      }
      if (url === '/api/v1/apps' && method === 'GET') return Promise.resolve(jsonResponse(200, { apps, staged: [] }));
      if (url === '/api/v1/apps/catalog') {
        return Promise.resolve(
          jsonResponse(200, {
            apps: apps.map((app) => ({
              key: app.key, version: app.version, name: app.name ?? app.key, description: '', categories: ['Finance'], publisher: 'Adminium',
              capabilities: [], sides: [], installed: true, installedVersion: null, readable: true, source: 'disk', state: 'installed',
              updateTo: app.key === 'invoices' ? '1.0.17' : null, updateStaged: true, needsNewerAdminium: null,
            })),
            catalogFetchedAt: null,
            onlineEnabled: false,
          }),
        );
      }
      const match = /^\/api\/v1\/apps\/([a-z-]+)\/(.*)$/.exec(url);
      if (match !== null) {
        const [, key, rest] = match as unknown as [string, string, string];
        if (rest === 'settings') {
          return Promise.resolve(jsonResponse(200, { key, name: null, placement: 'internal', connectionId: null, off: [], values: {}, domains: {}, declared: [] }));
        }
        if (rest === 'overview') {
          const install = headers['x-adminium-install'];
          return Promise.resolve(
            jsonResponse(200, {
              key,
              connection: { id: 'con_new', name: install === 'mf_inv_kiln' ? 'kiln' : 'fernhill', engine: 'postgres' },
              added: { pages: install === 'mf_inv_kiln' ? 2 : 22, emailTemplates: 3, scheduledReports: 0, roles: 1 },
              tables,
              activity: [{ action: 'app.installed', at: Date.now() - 60_000, actor: 'Rosa Okafor' }],
            }),
          );
        }
        if (rest === 'after-install' && method === 'GET') return Promise.resolve(jsonResponse(200, list));
        if (rest.startsWith('after-install/') && method === 'PUT') {
          const id = rest.slice('after-install/'.length);
          if (id === 'hidden') {
            hidden = (body as { hidden: boolean }).hidden;
          } else {
            afterItems = afterItems.map((one) => (one.id === id ? { ...one, done: (body as { done: boolean }).done, doneBy: { id: 'u1', name: 'Rosa Okafor' }, doneAt: Date.now() } : one));
          }
          return Promise.resolve(jsonResponse(200, { items: afterItems, hidden }));
        }
        if (rest === 'look' && method === 'GET') return Promise.resolve(jsonResponse(200, { look }));
        if (rest === 'look/undo') {
          look = null;
          return Promise.resolve(jsonResponse(200, { restored: ['setting:branding.appName'], kept: ['setting:appearance.accent'] }));
        }
        if (rest === 'editable' && method === 'GET') return Promise.resolve(jsonResponse(200, editable));
        if (rest === 'editable' && method === 'POST') {
          editable = { state: 'refused', reason: 'FROM_FOLDER', folder: 'apps/fernhill-ops/' };
          return Promise.resolve(jsonResponse(200, { key, folder: 'apps/fernhill-ops/' }));
        }
      }
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: url, requestId: 'r' } }));
    }),
  );
}

async function renderAt(path: string, heading: string) {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  stubFetch();
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, { history: createMemoryHistory({ initialEntries: [path] }) });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole('heading', { name: heading, level: 2 });
}

const sent = (method: string, url: string) => calls.filter((c) => c.method === method && c.url === url);

describe('an app someone made', () => {
  it('reads as your own app, made at its label, with Upload a newer version and no screens card', async () => {
    await renderAt('/studio/apps/fernhill-ops', 'Fernhill Ops');
    const line = screen.getByTestId('app-version-line');
    expect(line.textContent).toBe('Version 1.0.0 · Your own app · made at Fernhill main on Nov 1, 2026');
    expect(screen.getByRole('button', { name: 'Upload a newer version' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Up to date|Update/ })).toBeNull();
    expect(screen.queryByText('Sets of screens')).toBeNull();
    const added = await screen.findByTestId('app-added');
    expect(within(added).getByText('Pages only. This app has no screens of its own.')).toBeTruthy();
    expect(within(added).getByText('22')).toBeTruthy();
    expect(screen.getByTestId('app-tables-before').textContent).toBe('2 tables. 1 of them were here before the app.');
  });

  it('lists what is left after the install, ticks a row off, and says who must do the rest', async () => {
    await renderAt('/studio/apps/fernhill-ops', 'Fernhill Ops');
    const card = await screen.findByTestId('after-install');
    // Two senders are one row: four items, three rows.
    expect(within(card).getAllByTestId('after-install-row')).toHaveLength(3);
    expect(within(card).getByRole('progressbar').getAttribute('aria-valuetext')).toBe('1 of 3 done');
    expect(within(card).getByText('Done by Rosa Okafor', { exact: false })).toBeTruthy();
    await userEvent.click(within(card).getByRole('checkbox', { name: 'Set the sender address for 2 email templates' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'PUT' && c.url.includes('/after-install/a'))).toHaveLength(2));
    expect(calls.filter((c) => c.method === 'PUT').every((c) => c.install === 'mf_ops')).toBe(true);
  });

  it('holds a row whose right the reader lacks, and says who may do it', async () => {
    afterItems = afterItems.map((one) => (one.kind === 'webhook' ? { ...one, canTick: false } : one));
    await renderAt('/studio/apps/fernhill-ops', 'Fernhill Ops');
    const card = await screen.findByTestId('after-install');
    const box = within(card).getByRole('checkbox', { name: "Add the web address to 'Post wholesale orders to Slack'" });
    expect(box.getAttribute('aria-disabled')).toBe('true');
    expect(within(card).getByText('Needs someone who manages automations')).toBeTruthy();
    await userEvent.click(box);
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
  });

  it('offers Hide once everything is done', async () => {
    afterItems = afterItems.map((one) => ({ ...one, done: true }));
    await renderAt('/studio/apps/fernhill-ops', 'Fernhill Ops');
    await screen.findByText('All set');
    await userEvent.click(screen.getByRole('button', { name: 'Hide' }));
    await waitFor(() => expect(sent('PUT', '/api/v1/apps/fernhill-ops/after-install/hidden')[0]?.body).toEqual({ hidden: true }));
    await waitFor(() => expect(screen.queryByTestId('after-install')).toBeNull());
  });

  it('shows the look and languages the file applied, and puts them back after asking', async () => {
    await renderAt('/studio/apps/fernhill-ops', 'Fernhill Ops');
    const card = await screen.findByTestId('app-look');
    expect(card.textContent).toContain('logo, colours, 2 languages, 12 wordings, 2 system emails');
    await userEvent.click(within(card).getByRole('button', { name: 'Undo' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Put back what was here before?')).toBeTruthy();
    expect(within(dialog).getByText('changed since, left as they are')).toBeTruthy();
    expect(within(dialog).getByText('Pages, rules and data are not touched.')).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Put it back' }));
    await waitFor(() => expect(sent('POST', '/api/v1/apps/fernhill-ops/look/undo')).toHaveLength(1));
    await screen.findByText('The look and languages are back to what was here before');
  });

  it('hides Undo from someone who may not change the server’s settings', async () => {
    look = { ...look, canUndo: false };
    await renderAt('/studio/apps/fernhill-ops', 'Fernhill Ops');
    const card = await screen.findByTestId('app-look');
    expect(within(card).queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('says the tables were here before the app only when every one was', async () => {
    await renderAt('/studio/apps/fernhill-ops', 'Fernhill Ops');
    expect(screen.getByText('Removes the app’s pages and rules. Keeps the tables and their rows.')).toBeTruthy();
  });

  it('says the tables were here before the app when every one was', async () => {
    tables = tables.map((table) => ({ ...table, before: true as const }));
    await renderAt('/studio/apps/fernhill-ops', 'Fernhill Ops');
    expect(screen.getByText('Removes the app’s pages and rules. Keeps the tables and their rows — they were here before the app.')).toBeTruthy();
  });
});

describe('Make it editable here', () => {
  beforeEach(() => {
    apps = [{ ...own, key: 'fernhill-shop', address: 'fernhill-shop', name: 'Fernhill Shop', sides: [{ side: 'customer', prefix: '/apps/fernhill-shop/customer', navAvailable: true, state: 'on' }] }];
  });

  it('asks first, copies the source, and then says where it is', async () => {
    editable = { state: 'offered', folder: 'apps/fernhill-shop/' };
    await renderAt('/studio/apps/fernhill-shop', 'Fernhill Shop');
    const card = await screen.findByTestId('app-edit-screens');
    await userEvent.click(within(card).getByRole('button', { name: 'Make it editable here' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Make Fernhill Shop editable here?')).toBeTruthy();
    expect(dialog.textContent).toContain("newer files of it can't be uploaded here");
    await userEvent.click(within(dialog).getByRole('button', { name: 'Make it editable' }));
    await waitFor(() => expect(sent('POST', '/api/v1/apps/fernhill-shop/editable')).toHaveLength(1));
    await screen.findByText('Open this server with the Designer to change the screens.');
  });

  it('refuses inside the confirm when the folder exists, with nothing to press', async () => {
    editable = { state: 'refused', reason: 'FOLDER_EXISTS', folder: 'apps/fernhill-shop/' };
    await renderAt('/studio/apps/fernhill-shop', 'Fernhill Shop');
    const card = await screen.findByTestId('app-edit-screens');
    await userEvent.click(within(card).getByRole('button', { name: 'Make it editable here' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('alert').textContent).toContain('apps/fernhill-shop/ already exists here. Rename or remove that folder first.');
    expect((within(dialog).getByRole('button', { name: 'Make it editable' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('refuses a copy installed on two databases', async () => {
    editable = { state: 'refused', reason: 'SEVERAL_INSTALLS', installs: 2, folder: 'apps/fernhill-shop/' };
    await renderAt('/studio/apps/fernhill-shop', 'Fernhill Shop');
    await userEvent.click(within(await screen.findByTestId('app-edit-screens')).getByRole('button', { name: 'Make it editable here' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Fernhill Shop is installed on 2 databases. Remove the others first.');
  });

  it('says a server with no project folder cannot, with no button', async () => {
    editable = { state: 'refused', reason: 'NO_PROJECT', folder: 'apps/fernhill-shop/' };
    await renderAt('/studio/apps/fernhill-shop', 'Fernhill Shop');
    const card = await screen.findByTestId('app-edit-screens');
    expect(within(card).getByText('Editing screens needs a project folder. Open this server with the Designer to make one.')).toBeTruthy();
    expect(within(card).queryByRole('button')).toBeNull();
  });
});

describe('an app on two databases', () => {
  const fernhill: InstalledApp = {
    key: 'invoices', version: '1.0.16', source: 'file', installedAt: Date.now() - 86_400_000, connectionId: 'con_fh', sides: [], missing: false, status: 'installed',
    publisher: { id: 'adminium', name: 'Adminium' }, installId: 'mf_inv', slug: '', address: 'invoices', connectionName: 'fernhill', name: 'Invoices & Receipts',
  };
  const kiln: InstalledApp = { ...fernhill, connectionId: 'con_kiln', installId: 'mf_inv_kiln', slug: 'kiln', address: 'invoices~kiln', connectionName: 'kiln' };

  beforeEach(() => {
    apps = [fernhill, kiln];
    afterItems = [];
    look = null;
    workspaces = {
      workspaces: [{ id: 'ws_ks', name: 'Kiln Street Pottery', initials: 'KS', position: 0, connectionIds: ['con_kiln'] }],
      otherDatabases: null,
      workspaceView: 'all',
      lastWorkspaceId: null,
      manage: true,
    };
  });

  it('opens a later copy at its own address, and names that copy on every read', async () => {
    await renderAt('/studio/apps/invoices~kiln', 'Invoices & Receipts');
    expect(screen.getByTestId('app-version-line').textContent).toBe('on kiln · Kiln Street Pottery · Version 1.0.16 · by Adminium');
    const added = await screen.findByTestId('app-added');
    expect(within(added).getByText('On kiln only.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Uninstall Invoices & Receipts from kiln' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Update every copy' })).toBeTruthy();
    const reads = calls.filter((c) => c.url.startsWith('/api/v1/apps/invoices/'));
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every((c) => c.install === 'mf_inv_kiln')).toBe(true);
  });

  it('says where a retired plain address went, with a link to each copy', async () => {
    apps = [kiln];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    stubFetch();
    const queryClient = createQueryClient();
    const router = createAppRouter(queryClient, { history: createMemoryHistory({ initialEntries: ['/studio/apps/invoices'] }) });
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    const retired = await screen.findByTestId('retired-address');
    expect(within(retired).getByText('Invoices & Receipts is installed on kiln')).toBeTruthy();
    expect(within(retired).getByRole('link', { name: /Open it on kiln/ }).getAttribute('href')).toBe('/studio/apps/invoices~kiln');
  });
});

describe('the list’s rows', () => {
  it('groups senders and scheduled reports, and words each row', () => {
    const rows = afterInstallRows([
      item({ id: '1', kind: 'sender', item: 'a', field: 'from' }),
      item({ id: '2', kind: 'sender', item: 'b', field: 'from' }),
      item({ id: '3', kind: 'recipients', item: 'weekly', field: 'to' }),
      item({ id: '4', kind: 'webhook', item: 'r1', field: 'url', name: 'Post orders' }),
      item({ id: '5', kind: 'webhook', item: 'r1', field: 'header:Authorization', name: 'Post orders' }),
    ]);
    expect(rows.map((row) => afterInstallText(row))).toEqual([
      'Set the sender address for 2 email templates',
      'Choose who receives the scheduled report',
      "Add the web address to 'Post orders'",
    ]);
    expect(rows[2]?.items).toHaveLength(2);
  });
});
