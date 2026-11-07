// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The menu under workspaces, through the real shell:
 *  - a server with no workspace draws the rail it always drew, byte for byte
 *    (the snapshot was written by the rail before workspaces existed), and so
 *    does a person who sees one group;
 *  - One at a time: the card names the tab's workspace; the rail holds its
 *    block, then Shared, then the platform rows once; choosing another in the
 *    card's menu moves the tab and stores the choice for the next tab;
 *  - All in one menu: a block per workspace, a database in two workspaces in
 *    both, ONE `aria-current`, the other copy saying where else it is;
 *  - the view is offered to settings managers only, "Manage workspaces" to
 *    whoever manages connections;
 *  - a link to a page of another workspace's database moves the tab and
 *    says so; one the tab's workspace holds keeps it;
 *  - the tab's workspace is kept per person;
 *  - a `config-changed` redraws the rail without a reload.
 */
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { invalidateForRealtimeEvent } from '../../api/realtime.js';
import type { BootstrapData, NavItem } from '../../app/bootstrap.js';
import { createQueryClient } from '../../app/query.js';
import { createAppRouter } from '../../app/router.js';
import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../../test/fixtures.js';
import { resetCurrentGroups } from './current.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

const DB = {
  fernhill: { id: 'conn_fernhill', name: 'fernhill' },
  archive: { id: 'conn_archive', name: 'fernhill_archive' },
  suppliers: { id: 'conn_suppliers', name: 'suppliers' },
  kiln: { id: 'conn_kiln', name: 'kiln' },
  scratch: { id: 'conn_scratch', name: 'scratch' },
} as const;
type Db = keyof typeof DB;

function page(slug: string, label: string, db: Db | null, icon = 'table', order = 1): NavItem {
  return {
    pageId: `page_${slug}`,
    slug,
    labelKey: `nav.${slug}`,
    fallback: label,
    icon,
    order,
    connectionId: db === null ? null : DB[db].id,
    connectionName: db === null ? null : DB[db].name,
    currency: null,
    sourceTable: null,
    appKey: null,
  };
}

/** Fernhill Coffee holds fernhill, its archive and suppliers; Kiln Street Pottery holds kiln and suppliers; scratch is in none. */
const COFFEE = { id: 'wsp_coffee', name: 'Fernhill Coffee', initials: 'FC', position: 0, connectionIds: [DB.fernhill.id, DB.archive.id, DB.suppliers.id] };
const KILN = { id: 'wsp_kiln', name: 'Kiln Street Pottery', initials: 'KS', position: 1, connectionIds: [DB.kiln.id, DB.suppliers.id] };

const holders: Record<string, string[]> = {
  [DB.fernhill.id]: [COFFEE.id],
  [DB.archive.id]: [COFFEE.id],
  [DB.suppliers.id]: [COFFEE.id, KILN.id],
  [DB.kiln.id]: [KILN.id],
  [DB.scratch.id]: [],
};

function nav(withWorkspaces: boolean): BootstrapData['nav'] {
  const stamp = (item: NavItem): NavItem =>
    withWorkspaces && typeof item.connectionId === 'string' ? { ...item, workspaceIds: holders[item.connectionId] ?? [] } : item;
  return {
    groups: [
      {
        key: 'workspace',
        items: [
          page('orders', 'Orders', 'fernhill', 'shopping-cart', 1),
          page('old-orders', 'Old orders', 'archive', 'archive', 2),
          page('purchase-orders', 'Purchase orders', 'suppliers', 'clipboard-list', 3),
          page('pieces', 'Pieces', 'kiln', 'box', 4),
          page('notes', 'Notes', 'scratch', 'notebook', 5),
          page('team-notes', 'Team notes', null, 'sticky-note', 6),
        ].map(stamp),
      },
      { key: 'planning', items: [page('firing-board', 'Firing board', 'kiln', 'columns-3', 1)].map(stamp) },
    ],
  };
}

const SECTION = {
  appKey: 'fernhill-ops',
  installId: 'man_ops',
  connectionId: DB.fernhill.id,
  label: 'Fernhill Ops',
  version: '1.1.0',
  groups: [{ key: '', label: null, items: [{ ...page('todays-roasts', "Today's roasts", 'fernhill', 'flame', 1), appKey: 'fernhill-ops' }] }],
  staff: null,
};

function bootstrapOf(over: Partial<BootstrapData> & { view?: 'one' | 'all'; last?: string | null; seen?: 'all' | 'kiln-only' } = {}): BootstrapData {
  const { view = 'one', last = null, seen = 'all', ...rest } = over;
  const kilnOnly = seen === 'kiln-only';
  return makeBootstrap({
    systemActions: ['users.manage', 'roles.manage', 'audit.read', 'connections.manage', 'settings.manage', 'automations.manage'],
    nav: nav(true),
    appSections: [SECTION],
    workspaces: {
      workspaces: kilnOnly ? [KILN] : [COFFEE, KILN],
      otherDatabases: kilnOnly ? null : [DB.scratch.id],
      workspaceView: view,
      lastWorkspaceId: last,
      manage: !kilnOnly,
      engines: { [DB.fernhill.id]: 'postgres', [DB.archive.id]: 'postgres', [DB.suppliers.id]: 'postgres', [DB.kiln.id]: 'mysql', [DB.scratch.id]: 'sqlite' },
    },
    ...rest,
  });
}

interface Rendered {
  queryClient: QueryClient;
  fetchMock: ReturnType<typeof vi.fn>;
  setBootstrap: (next: BootstrapData) => void;
}

async function renderShell(bootstrap: BootstrapData, path = '/account/security'): Promise<Rendered> {
  let served = bootstrap;
  const fetchMock = vi.fn().mockImplementation((input: unknown) => {
    const url = String(input);
    if (url.startsWith('/api/v1/branding')) return Promise.resolve(jsonResponse(200, { data: { appName: 'Fernhill main', logoUrl: null, showVersion: true } }));
    if (url.startsWith('/api/v1/bootstrap')) return Promise.resolve(jsonResponse(200, { data: served }));
    if (url.startsWith('/api/v1/me/notifications')) return Promise.resolve(jsonResponse(200, { data: { items: [], unreadCount: 0, nextCursor: null } }));
    if (url.startsWith('/api/v1/me/prefs')) return Promise.resolve(jsonResponse(200, { data: { prefs: {}, resolved: {} } }));
    return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope', requestId: 'req_a' } }));
  });
  vi.stubGlobal('fetch', fetchMock);
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, { history: createMemoryHistory({ initialEntries: [path] }) });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findAllByRole('navigation');
  return { queryClient, fetchMock, setBootstrap: (next) => (served = next) };
}

const rail = () => document.querySelector<HTMLElement>('aside[data-part="sidebar"]')!;
/** The rail below the brand (whose name arrives on its own query): every child after the first. */
const menuMarkup = () => [...rail().children].slice(1).map((child) => child.outerHTML).join('\n');
const railText = () => [...rail().querySelectorAll('a, button')].map((node) => node.textContent?.trim() ?? '');

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});
beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  window.sessionStorage.clear();
  resetCurrentGroups();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a server with no workspace', () => {
  it('draws the rail it always drew', async () => {
    await renderShell(makeBootstrap({ systemActions: ['users.manage', 'roles.manage', 'audit.read', 'connections.manage', 'settings.manage', 'automations.manage'], nav: nav(false), appSections: [SECTION] }));
    await screen.findByRole('navigation', { name: 'Primary' });
    expect(rail().querySelector('[data-part="workspace-card"]')).toBeNull();
    expect(menuMarkup()).toMatchSnapshot();
  });

  it('and so does a server whose workspaces this person sees one of', async () => {
    await renderShell(bootstrapOf({ seen: 'kiln-only', nav: nav(false) }));
    await screen.findByRole('navigation', { name: 'Primary' });
    expect(rail().querySelector('[data-part="workspace-card"]')).toBeNull();
    expect(menuMarkup()).toMatchSnapshot();
  });
});

describe('One at a time', () => {
  it('shows the tab\'s workspace, then Shared and the platform rows once', async () => {
    await renderShell(bootstrapOf({ view: 'one', last: KILN.id }));
    const card = await screen.findByRole('button', { name: /Workspace\s*Kiln Street Pottery/ });
    expect(card).toBeTruthy();
    const block = screen.getByRole('navigation', { name: 'Kiln Street Pottery' });
    const rows = within(block).getAllByRole('link').map((link) => link.textContent);
    expect(rows).toEqual(['Purchase orders', 'Pieces', 'Firing board']);
    // Pages of two groups: today's headings inside the block; two databases: their names.
    expect(block.textContent).toContain('Planning');
    expect([...block.querySelectorAll('[data-part="nav-database-label"]')].map((label) => label.textContent)).toEqual(['suppliers', 'kiln', 'kiln']);
    const server = screen.getByRole('navigation', { name: 'Server' });
    expect(within(server).getByText('Shared')).toBeTruthy();
    expect(within(server).getByRole('link', { name: 'Team notes' })).toBeTruthy();
    expect(within(server).getAllByRole('link', { name: 'People' })).toHaveLength(1);
    expect(railText()).not.toContain('Orders');
  });

  it('switches from the card\'s menu, ticks the current one, and stores the choice', async () => {
    const { fetchMock } = await renderShell(bootstrapOf({ view: 'one' }));
    fireEvent.click(await screen.findByRole('button', { name: /Workspace\s*Fernhill Coffee/ }));
    const menu = await screen.findByRole('dialog', { name: 'Workspaces on Fernhill main' });
    const rows = within(menu).getAllByRole('button').filter((button) => button.getAttribute('data-part') === 'workspace-menu-row');
    expect(rows.map((row) => row.textContent)).toEqual([
      'FCFernhill Coffee3 databases · Postgres',
      'KSKiln Street Pottery2 databases · MySQL, Postgres',
      'Other databases1 database · SQLite',
    ]);
    expect(rows[0]!.getAttribute('aria-current')).toBe('true');
    expect(within(menu).getByText('Applies to everyone on this server.')).toBeTruthy();
    expect(within(menu).getByRole('link', { name: 'Manage workspaces' })).toBeTruthy();
    fireEvent.click(rows[2]!);
    await screen.findByRole('button', { name: /Not in a workspace\s*Other databases/ });
    expect(within(screen.getByRole('navigation', { name: 'Other databases' })).getAllByRole('link').map((link) => link.textContent)).toEqual(['Notes']);
    // Kept for this tab, per person; stored on the server as "no workspace" for the next tab.
    expect(window.sessionStorage.getItem('adminium-workspace:usr_test')).toBe('other');
    const patch = fetchMock.mock.calls.find(([url, init]) => String(url) === '/api/v1/me/prefs' && (init as RequestInit | undefined)?.method === 'PATCH');
    expect(JSON.parse(String((patch![1] as RequestInit).body))).toEqual({ workspaceId: null });
  });

  it('offers the view to settings managers only, and "Manage workspaces" to whoever manages connections', async () => {
    await renderShell(bootstrapOf({ view: 'one', systemActions: ['connections.manage'] }));
    fireEvent.click(await screen.findByRole('button', { name: /Workspace\s*Fernhill Coffee/ }));
    const menu = await screen.findByRole('dialog', { name: 'Workspaces on Fernhill main' });
    expect(within(menu).queryByRole('radiogroup')).toBeNull();
    expect(within(menu).getByRole('link', { name: 'Manage workspaces' })).toBeTruthy();
  });

  it('keeps the tab\'s workspace per person', async () => {
    window.sessionStorage.setItem('adminium-workspace:usr_someone_else', KILN.id);
    await renderShell(bootstrapOf({ view: 'one' }));
    expect(await screen.findByRole('button', { name: /Workspace\s*Fernhill Coffee/ })).toBeTruthy();
  });
});

describe('All in one menu', () => {
  it('draws a block per workspace, a shared database in both, and one aria-current', async () => {
    await renderShell(bootstrapOf({ view: 'all' }), '/p/purchase-orders');
    expect(await screen.findByRole('button', { name: /Server\s*Fernhill main/ })).toBeTruthy();
    const all = screen.getByRole('navigation', { name: 'All workspaces' });
    const blocks = [...all.querySelectorAll<HTMLElement>('[data-part="nav-workspace-block"]')];
    expect(blocks.map((block) => block.dataset['workspace'])).toEqual([COFFEE.id, KILN.id, 'other']);
    const copies = within(all).getAllByRole('link', { name: /Purchase orders/ });
    expect(copies).toHaveLength(2);
    await waitFor(() => expect(rail().querySelectorAll('[aria-current="page"]')).toHaveLength(1));
    // The copy in the other block says, to a screen reader, where it is current.
    expect(copies.map((copy) => copy.textContent)).toEqual(['Purchase orders', 'Purchase orders (also in Fernhill Coffee)']);
  });

  it('folds a block from its header', async () => {
    await renderShell(bootstrapOf({ view: 'all' }));
    const head = await screen.findByRole('button', { name: 'Kiln Street Pottery' });
    expect(head.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(head);
    expect(head.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById(head.getAttribute('aria-controls')!)!.hidden).toBe(true);
  });
});

describe('a link to a page', () => {
  it('moves the tab to a workspace that holds its database, and says so', async () => {
    await renderShell(bootstrapOf({ view: 'one', last: COFFEE.id }), '/p/pieces');
    expect(await screen.findByRole('button', { name: /Workspace\s*Kiln Street Pottery/ })).toBeTruthy();
    expect(await screen.findByText('Switched to Kiln Street Pottery')).toBeTruthy();
  });

  it('keeps the tab\'s workspace when it holds the database', async () => {
    window.sessionStorage.setItem('adminium-workspace:usr_test', KILN.id);
    await renderShell(bootstrapOf({ view: 'one', last: COFFEE.id }), '/p/purchase-orders');
    expect(await screen.findByRole('button', { name: /Workspace\s*Kiln Street Pottery/ })).toBeTruthy();
    expect(screen.queryByText(/Switched to/)).toBeNull();
  });
});

describe('a person who reaches part of a workspace', () => {
  it('is told only of the databases they reach, and every row they have sits in its workspace', async () => {
    // The server sends each workspace's databases cut to the ones this person reaches, and their engines alone.
    const reached = new Set<string>([DB.fernhill.id, DB.kiln.id]);
    const kept = (item: NavItem): boolean => typeof item.connectionId !== 'string' || reached.has(item.connectionId);
    const cut = (ids: readonly string[]) => ids.filter((id) => reached.has(id));
    // Their rows: the pages of the databases they reach (each still naming its workspaces), and those of none.
    const stamped = { groups: nav(true).groups.map((group) => ({ ...group, items: group.items.filter(kept) })) };
    await renderShell(
      makeBootstrap({
        systemActions: [],
        nav: stamped,
        appSections: [SECTION],
        workspaces: {
          workspaces: [{ ...COFFEE, connectionIds: cut(COFFEE.connectionIds) }, { ...KILN, connectionIds: cut(KILN.connectionIds) }],
          otherDatabases: null,
          workspaceView: 'one',
          lastWorkspaceId: KILN.id,
          manage: false,
          engines: { [DB.fernhill.id]: 'postgres', [DB.kiln.id]: 'mysql' },
        },
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: /Workspace\s*Kiln Street Pottery/ }));
    const menu = await screen.findByRole('dialog', { name: 'Workspaces on Fernhill main' });
    const rows = within(menu).getAllByRole('button').filter((button) => button.getAttribute('data-part') === 'workspace-menu-row');
    expect(rows.map((row) => row.textContent)).toEqual(['FCFernhill Coffee1 database · Postgres', 'KSKiln Street Pottery1 database · MySQL']);
    fireEvent.keyDown(menu, { key: 'Escape' });
    const block = screen.getByRole('navigation', { name: 'Kiln Street Pottery' });
    expect(within(block).getAllByRole('link').map((link) => link.textContent)).toEqual(['Pieces', 'Firing board']);
    // Nothing of a workspace's database falls to Shared for want of its id.
    const server = screen.getByRole('navigation', { name: 'Server' });
    expect(within(server).getByRole('link', { name: 'Team notes' })).toBeTruthy();
    expect(within(server).queryByRole('link', { name: 'Pieces' })).toBeNull();
    expect(within(server).queryByRole('link', { name: 'Orders' })).toBeNull();
  });
});

describe('another session\'s change', () => {
  it('redraws the rail without a reload', async () => {
    const { queryClient, setBootstrap } = await renderShell(makeBootstrap({ nav: nav(false) }));
    await screen.findByRole('navigation', { name: 'Primary' });
    expect(rail().querySelector('[data-part="workspace-card"]')).toBeNull();
    setBootstrap(bootstrapOf({ view: 'one' }));
    act(() => invalidateForRealtimeEvent(queryClient, { channel: 'config-changed', type: 'workspaces.changed', payload: {}, at: 1 } as never));
    expect(await screen.findByRole('button', { name: /Workspace\s*Fernhill Coffee/ })).toBeTruthy();
  });
});
