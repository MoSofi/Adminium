// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The rail grouped by workspace, in the states the comp draws and the ones
 * built from notes: One at a time with its block, Shared and the platform
 * rows; All in one menu with a database in two workspaces (one current copy,
 * the other saying where else it is); "Other databases" as the tab's group.
 * A memory router stands in for the app's: the links point where they would.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import type { BootstrapData, NavItem } from '../../app/bootstrap.js';
import { chooseGroup } from './current.js';
import { WorkspaceRail } from './WorkspaceRail.js';

const DB = { fernhill: 'c_fernhill', archive: 'c_archive', suppliers: 'c_suppliers', kiln: 'c_kiln', scratch: 'c_scratch' } as const;
const HOLDERS: Record<string, string[]> = { c_fernhill: ['wsp_coffee'], c_archive: ['wsp_coffee'], c_suppliers: ['wsp_coffee', 'wsp_kiln'], c_kiln: ['wsp_kiln'], c_scratch: [] };

function page(slug: string, label: string, connectionId: string | null, connectionName: string | null, icon: string, order: number): NavItem {
  return {
    pageId: `page_${slug}`,
    slug,
    labelKey: `nav.${slug}`,
    fallback: label,
    icon,
    order,
    connectionId,
    connectionName,
    ...(connectionId === null ? {} : { workspaceIds: HOLDERS[connectionId] ?? [] }),
  };
}

function bootstrap(view: 'one' | 'all'): BootstrapData {
  return {
    user: { id: 'usr_rosa', email: 'rosa@fernhill.coffee', name: 'Rosa Okafor', status: 'active', totpEnabled: false, lastLoginAt: null, createdAt: 1, updatedAt: 1 },
    roles: ['super-admin'],
    systemActions: ['users.manage', 'roles.manage', 'audit.read', 'connections.manage', 'settings.manage', 'automations.manage', 'files.manage'],
    prefs: { theme: 'light', accent: 'indigo', density: 'comfortable', locale: 'en_US', dir: 'ltr', source: { theme: 'system', accent: 'system', density: 'system', locale: 'system', dir: 'system' } } as never,
    nav: {
      groups: [
        {
          key: 'workspace',
          items: [
            page('orders', 'Orders', DB.fernhill, 'fernhill', 'shopping-cart', 1),
            page('customers', 'Customers', DB.fernhill, 'fernhill', 'users', 2),
            page('old-orders', 'Old orders', DB.archive, 'fernhill_archive', 'archive', 3),
            page('suppliers', 'Suppliers', DB.suppliers, 'suppliers', 'truck', 4),
            page('purchase-orders', 'Purchase orders', DB.suppliers, 'suppliers', 'clipboard-list', 5),
            page('pieces', 'Pieces', DB.kiln, 'kiln', 'box', 6),
            page('firings', 'Firings', DB.kiln, 'kiln', 'flame', 7),
            page('notes', 'Notes', DB.scratch, 'scratch', 'notebook', 8),
            page('team-notes', 'Team notes', null, null, 'sticky-note', 9),
          ],
        },
      ],
    },
    appSections: [
      {
        appKey: 'fernhill-ops',
        installId: 'man_ops',
        connectionId: DB.fernhill,
        label: 'Fernhill Ops',
        version: '1.1.0',
        groups: [{ key: '', label: null, items: [{ ...page('todays-roasts', 'Today’s roasts', DB.fernhill, 'fernhill', 'flame', 1), appKey: 'fernhill-ops' }] }],
        staff: null,
      },
      {
        kind: 'add-on',
        appKey: 'invoices',
        installId: 'man_inv_kiln',
        connectionId: DB.kiln,
        label: 'Invoices & Receipts',
        version: '1.0.16',
        groups: [{ key: '', label: null, items: [{ ...page('kiln-invoices', 'Invoices', DB.kiln, 'kiln', 'receipt-text', 1), addOnKey: 'invoices' }] }],
        staff: null,
      },
    ],
    version: '0.3.48',
    configVersion: 1,
    llm: { enabled: false },
    workspaces: {
      workspaces: [
        { id: 'wsp_coffee', name: 'Fernhill Coffee', initials: 'FC', position: 0, connectionIds: [DB.fernhill, DB.archive, DB.suppliers] },
        { id: 'wsp_kiln', name: 'Kiln Street Pottery', initials: 'KS', position: 1, connectionIds: [DB.kiln, DB.suppliers] },
      ],
      otherDatabases: [DB.scratch],
      workspaceView: view,
      lastWorkspaceId: null,
      manage: true,
      engines: { c_fernhill: 'postgres', c_archive: 'postgres', c_suppliers: 'postgres', c_kiln: 'mysql', c_scratch: 'sqlite' },
    },
  };
}

function Rail({ view, at, group }: { view: 'one' | 'all'; at: string; group: string }): ReactNode {
  const data = bootstrap(view);
  chooseGroup(data.user.id, group);
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <aside className="flex h-[900px] w-sidebar flex-col border-e border-border bg-surface pt-4 leading-[normal]">
          <WorkspaceRail bootstrap={data} />
        </aside>
      ),
    }),
    history: createMemoryHistory({ initialEntries: [at] }),
  });
  return (
    <QueryClientProvider client={client}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  );
}

const meta = { title: 'Shell/Workspaces/Rail' };
export default meta;

export const OneAtATime = { tags: ['vrt'], render: () => <Rail view="one" at="/p/orders" group="wsp_coffee" /> };
export const OtherDatabases = { tags: ['vrt'], render: () => <Rail view="one" at="/p/notes" group="other" /> };
export const AllInOneMenu = { tags: ['vrt'], render: () => <Rail view="all" at="/p/purchase-orders" group="wsp_kiln" /> };
