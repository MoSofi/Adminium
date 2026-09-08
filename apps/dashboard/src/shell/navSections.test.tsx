// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Per-connection nav sectioning (M5-T05): the pure helpers plus SidebarNav
 * rendering — flat with zero/one connection (no redundant label), sub-labeled
 * by connection display name with 2+, "Shared" for connection-less pages.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { NavItem, NavTree } from '../app/bootstrap.js';
import { createQueryClient } from '../app/query.js';
import { createAppRouter } from '../app/router.js';
import { installTestI18n } from '../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../test/fixtures.js';
import { distinctConnectionCount, sectionNavItems } from './navSections.js';

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function item(slug: string, connection: { id: string; name: string } | null, order = 0): NavItem {
  return {
    pageId: `page_${slug}`,
    slug,
    labelKey: `nav.${slug}`,
    fallback: slug.charAt(0).toUpperCase() + slug.slice(1),
    icon: 'table-2',
    order,
    connectionId: connection?.id ?? null,
    connectionName: connection?.name ?? null,
  };
}

const PROD = { id: 'conn_prod', name: 'Production Postgres' };
const ANALYTICS = { id: 'conn_wh', name: 'Analytics MySQL' };

describe('navSections helpers', () => {
  it('counts distinct connections across the whole tree', () => {
    const nav: NavTree = {
      groups: [
        { key: 'workspace', items: [item('customers', PROD), item('orders', PROD)] },
        { key: 'library', items: [item('events', ANALYTICS), item('exports', null)] },
      ],
    };
    expect(distinctConnectionCount(nav)).toBe(2);
    expect(distinctConnectionCount({ groups: [] })).toBe(0);
  });

  it('treats missing connection fields (older payloads) as shared', () => {
    const legacy = { ...item('customers', PROD) };
    delete (legacy as Partial<NavItem>).connectionId;
    delete (legacy as Partial<NavItem>).connectionName;
    expect(distinctConnectionCount({ groups: [{ key: 'workspace', items: [legacy] }] })).toBe(0);
    expect(sectionNavItems([legacy])[0]?.connectionId).toBeNull();
  });

  it('clusters items by connection in first-appearance order, keeping item order', () => {
    const sections = sectionNavItems([
      item('customers', PROD, 1),
      item('events', ANALYTICS, 2),
      item('orders', PROD, 3),
      item('exports', null, 4),
    ]);
    expect(sections.map((s) => s.connectionId)).toEqual(['conn_prod', 'conn_wh', null]);
    expect(sections[0]?.connectionName).toBe('Production Postgres');
    expect(sections[0]?.items.map((i) => i.slug)).toEqual(['customers', 'orders']);
    expect(sections[2]?.items.map((i) => i.slug)).toEqual(['exports']);
  });
});

// --- SidebarNav rendering -------------------------------------------------------

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

async function renderShellWithNav(nav: NavTree, roles: string[] = ['super-admin']) {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: unknown) => {
      const url = String(input);
      if (url.startsWith('/api/v1/bootstrap')) {
        return Promise.resolve(jsonResponse(200, { data: makeBootstrap({ nav, roles }) }));
      }
      if (url.startsWith('/api/v1/pages/')) {
        return Promise.resolve(
          jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'no page' } }),
        );
      }
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: url } }));
    }),
  );
  const queryClient: QueryClient = createQueryClient();
  const router = createAppRouter(queryClient, {
    // A studio path avoids the `/` → first-nav-item page redirect/loader.
    history: createMemoryHistory({ initialEntries: ['/studio/connect'] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole('navigation', { name: 'Primary' });
}

describe('SidebarNav connection labels', () => {
  it('stays flat with a single connection — no connection label rendered', async () => {
    await renderShellWithNav({
      groups: [
        { key: 'workspace', items: [item('customers', PROD), item('orders', PROD)] },
        { key: 'library', items: [item('exports', null)] },
      ],
    });
    expect(screen.getByText('Customers')).toBeTruthy();
    expect(screen.queryByText('Production Postgres')).toBeNull();
    expect(screen.queryByText('Shared')).toBeNull();
  });

  it('sub-labels items per connection once 2+ connections exist', async () => {
    await renderShellWithNav({
      groups: [
        {
          key: 'workspace',
          items: [item('customers', PROD), item('events', ANALYTICS), item('orders', PROD)],
        },
        { key: 'library', items: [item('exports', null)] },
      ],
    });
    expect(screen.getByText('Analytics MySQL')).toBeTruthy();
    expect(screen.getByText('Production Postgres')).toBeTruthy();
    // Connection-less utility pages fall under the localized "Shared" label.
    expect(screen.getByText('Shared')).toBeTruthy();

    // Items cluster under their connection label within the group.
    const labels = screen.getAllByText(/Production Postgres|Analytics MySQL|Shared/);
    expect(labels.length).toBeGreaterThanOrEqual(3);
  });
});

/**
 * `/api-keys` shipped with a route, a 519-line page and no entry point in any
 * nav — `PLATFORM_NAV` never listed it, the avatar menu never has, and the
 * palette only knows generated pages. It was reachable by URL alone. This
 * asserts the door exists and that it is gated the way the route is.
 */
describe('SidebarNav platform tail: API keys', () => {
  const nav: NavTree = { groups: [{ key: 'workspace', items: [item('customers', PROD)] }] };

  it('gives an admin a link to API keys, beside the other governance rows', async () => {
    await renderShellWithNav(nav, ['admin']);
    const link = screen.getByRole('link', { name: 'API keys' });
    expect(link.getAttribute('href')).toBe('/api-keys');
    // It belongs with the principals that can act, not with personal settings.
    expect(screen.getByRole('link', { name: 'Roles & permissions' })).toBeTruthy();
  });

  it('hides it from a viewer, like the rest of the admin tail', async () => {
    await renderShellWithNav(nav, ['viewer']);
    expect(screen.queryByRole('link', { name: 'API keys' })).toBeNull();
    // The personal rows still render — this gates the admin tail, not the rail.
    expect(screen.getByRole('link', { name: 'Password & sessions' })).toBeTruthy();
  });
});

/**
 * The platform tail used to be conditional on having generated pages: with no
 * `nav.groups` the rail rendered the "connect a database" prompt and returned,
 * skipping `platformOnlyGroups` entirely. So on a fresh instance — the one
 * state every deployment passes through — Team, Roles, API keys, the audit log,
 * Files, Email templates, imports, exports and scheduled reports were all
 * invisible until a source was connected, which none of them need. Inviting
 * people is the first thing an admin does, and Team was behind that wall.
 */
describe('SidebarNav on a fresh instance (no connection)', () => {
  const empty: NavTree = { groups: [] };

  it('still offers the platform tail an admin needs before any database exists', async () => {
    await renderShellWithNav(empty, ['admin']);
    for (const name of ['Team', 'Roles & permissions', 'API keys', 'Audit log']) {
      expect(screen.getByRole('link', { name })).toBeTruthy();
    }
    expect(screen.getByRole('link', { name: 'Import data' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Password & sessions' })).toBeTruthy();
  });

  it('keeps the prompt, which now explains only the missing pages', async () => {
    await renderShellWithNav(empty, ['admin']);
    // It sits ALONGSIDE the tail rather than replacing it: the sentence is
    // about generated pages, and those really are absent.
    expect(screen.getByText('Pages appear here once a database is connected.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Team' })).toBeTruthy();
  });

  it('still respects the admin gate with nothing connected', async () => {
    await renderShellWithNav(empty, ['viewer']);
    expect(screen.queryByRole('link', { name: 'Team' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'API keys' })).toBeNull();
    // …and the ungated rows are what a viewer is left with, not an empty rail.
    expect(screen.getByRole('link', { name: 'Password & sessions' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Data exports' })).toBeTruthy();
  });
});
