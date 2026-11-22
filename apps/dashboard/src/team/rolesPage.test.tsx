// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The "Pages & records" rows of the Roles matrix: the only screen that grants
 * a role access to pages and tables. Before them, a built-in role's data
 * access could only be changed through the API.
 *
 * What matters is what a save SENDS: `PUT /roles/:id/permissions` replaces the
 * role's whole grant list, so a toggle on one wildcard must keep every other
 * grant — including a narrow one on a single table this screen does not draw.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Suspense } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../test/fixtures.js';
import { ShellHarness } from '../test/shellHarness.js';
import { RolesPage } from './RolesPage.js';
import type { RoleListItem } from './rolesApi.js';

function role(id: string, slug: string, name: string): RoleListItem {
  return {
    id,
    slug,
    name,
    description: null,
    isBuiltin: true,
    memberCount: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

const ROLES = [
  role('role_sa', 'super-admin', 'Super Admin'),
  role('role_viewer', 'viewer', 'Viewer'),
];

const VIEWER_GRANTS = ['page:*:view', 'table:*:*:read', 'table:conn_1:main.orders:export', 'app:*:staff', 'app:booking:staff'];

function installFetch(opts: { roles?: RoleListItem[]; grantable?: { all: boolean; grants: string[] }; refuseSave?: boolean } = {}) {
  const puts: { url: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'PUT') {
        puts.push({ url, body: JSON.parse(String(init?.body)) });
        if (opts.refuseSave === true) {
          return Promise.resolve(jsonResponse(403, { error: { code: 'FORBIDDEN', message: 'server words', details: { reason: 'role-above-you', roleId: 'role_viewer' } } }));
        }
        return Promise.resolve(jsonResponse(200, { roleId: 'role_viewer', grants: [] }));
      }
      if (url === '/api/v1/roles') return Promise.resolve(jsonResponse(200, { roles: opts.roles ?? ROLES }));
      if (url === '/api/v1/roles/grantable') return Promise.resolve(jsonResponse(200, opts.grantable ?? { all: true, grants: [] }));
      if (url === '/api/v1/roles/role_top/permissions') return Promise.resolve(jsonResponse(200, { roleId: 'role_top', grants: ['system:settings:manage'] }));
      if (url.startsWith('/api/v1/bootstrap')) {
        return Promise.resolve(
          jsonResponse(200, {
            data: makeBootstrap({
              appSections: [{ appKey: 'pos', label: 'Point of Sale', version: '0.2.0', groups: [], staff: null }],
            }),
          }),
        );
      }
      if (url === '/api/v1/permissions/catalog') {
        return Promise.resolve(
          jsonResponse(200, {
            system: [{ key: 'system:users:manage', label: 'Manage users', category: 'access' }],
            tableActions: ['read', 'create', 'update', 'delete', 'export', 'import'],
            pageActions: ['view', 'edit'],
          }),
        );
      }
      if (url === '/api/v1/roles/role_viewer/permissions') {
        return Promise.resolve(jsonResponse(200, { roleId: 'role_viewer', grants: VIEWER_GRANTS }));
      }
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: url } }));
    }),
  );
  return puts;
}

function renderRoles() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ShellHarness>
        <Suspense fallback={null}>
          <RolesPage />
        </Suspense>
      </ShellHarness>
    </QueryClientProvider>,
  );
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
});

describe('RolesPage — pages & records', () => {
  it('draws the data rows first, and says a narrower grant exists', async () => {
    installFetch();
    renderRoles();
    expect(await screen.findByText('Pages & records')).toBeTruthy();
    for (const label of ['See every page', 'Read records', 'Create records', 'Delete records']) {
      expect(screen.getByText(label), label).toBeTruthy();
    }
    expect((await screen.findByTestId('roles-narrow-grants')).textContent).toContain('1 grant');
  });

  it('saves a toggled wildcard and keeps every other grant the role holds', async () => {
    const puts = installFetch();
    const user = userEvent.setup();
    renderRoles();

    const toggle = await screen.findByRole('button', { name: 'Create records — Viewer' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false));
    await user.click(toggle);
    await user.click(screen.getByTestId('roles-save'));

    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]!.url).toBe('/api/v1/roles/role_viewer/permissions');
    const sent = (puts[0]!.body as { grants: string[] }).grants;
    expect([...sent].sort()).toEqual([...VIEWER_GRANTS, 'table:*:*:create'].sort());
  });

  it('shows the seeded wildcards as granted', async () => {
    installFetch();
    renderRoles();
    const read = await screen.findByRole('button', { name: 'Read records — Viewer' });
    await waitFor(() => expect(read.getAttribute('aria-pressed')).toBe('true'));
    expect(screen.getByRole('button', { name: 'Delete records — Viewer' }).getAttribute('aria-pressed')).toBe('false');
  });
});

describe('RolesPage — what the viewer cannot hand out', () => {
  const LIMITED = { all: false, grants: ['table:*:*:read', 'page:*:view', 'system:roles:manage'] };
  const TOP: RoleListItem = { ...role('role_top', 'top', 'Top'), isBuiltin: false, mayChange: false };
  const MINE: RoleListItem = { ...role('role_viewer', 'viewer', 'Viewer'), isBuiltin: false, mayChange: true };
  const NOT_HELD = 'You do not hold this permission, so you cannot give it.';
  const ABOVE = 'This role holds permissions you do not, so you cannot change it.';

  it('shows a permission the viewer lacks as unavailable, says why, and does not toggle it', async () => {
    const puts = installFetch({ roles: [MINE], grantable: LIMITED });
    const user = userEvent.setup();
    renderRoles();
    expect(await screen.findByTestId('roles-limited-note')).toBeTruthy();
    const lacking = await screen.findByRole('button', { name: 'Delete records — Viewer' });
    await waitFor(() => expect(lacking.getAttribute('title')).toBe(NOT_HELD));
    expect(lacking.getAttribute('aria-disabled')).toBe('true');
    await user.click(lacking);
    expect(lacking.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('roles-pending').textContent).toBe('No pending changes');
    expect(puts).toHaveLength(0);
  });

  it('still lets the viewer take off a permission the role has, and give one they hold', async () => {
    installFetch({ roles: [MINE], grantable: { ...LIMITED, grants: ['page:*:view'] } });
    renderRoles();
    const held = await screen.findByRole('button', { name: 'Read records — Viewer' });
    await waitFor(() => expect(held.getAttribute('aria-pressed')).toBe('true'));
    expect(held.getAttribute('title')).toBeNull();
    expect(screen.getByRole('button', { name: 'See every page — Viewer' }).getAttribute('title')).toBeNull();
  });

  it('locks a role above the viewer: its cells, rows, rename and delete', async () => {
    installFetch({ roles: [MINE, TOP], grantable: LIMITED });
    renderRoles();
    const cell = await screen.findByRole('button', { name: 'Read records — Top' });
    await waitFor(() => expect(cell.getAttribute('title')).toBe(ABOVE));
    for (const id of ['roles-rows-top', 'roles-rename-top', 'roles-delete-top']) {
      const button = screen.getByTestId(id) as HTMLButtonElement;
      expect(button.disabled, id).toBe(true);
      expect(button.getAttribute('title'), id).toBe(ABOVE);
    }
    expect((screen.getByTestId('roles-rename-viewer') as HTMLButtonElement).disabled).toBe(false);
  });

  it('offers no role above the viewer to move members to, and says so when none is left', async () => {
    const SPARE: RoleListItem = { ...role('role_spare', 'spare', 'Spare'), isBuiltin: false, mayChange: true };
    const user = userEvent.setup();
    installFetch({ roles: [SPARE, TOP], grantable: LIMITED });
    renderRoles();
    await user.click(await screen.findByTestId('roles-delete-spare'));
    expect((await screen.findByTestId('roles-no-targets')).textContent).toContain('no role you can give');
    expect(screen.queryByTestId('roles-reassign')).toBeNull();
    expect((screen.getByTestId('roles-delete-confirm') as HTMLButtonElement).disabled).toBe(true);
  });

  it('says a refused save in the reader’s words', async () => {
    installFetch({ roles: [MINE], grantable: { all: true, grants: [] }, refuseSave: true });
    const user = userEvent.setup();
    renderRoles();
    const toggle = await screen.findByRole('button', { name: 'Create records — Viewer' });
    await waitFor(() => expect((toggle as HTMLButtonElement).getAttribute('aria-disabled')).toBeNull());
    await user.click(toggle);
    await user.click(screen.getByTestId('roles-save'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('You can give only permissions you hold yourself');
    expect(alert.textContent).not.toContain('server words');
  });
});

describe('RolesPage — a permission that equals full access', () => {
  it('says plainly that installing apps is full access, to everybody who opens the page', async () => {
    installFetch();
    renderRoles();
    expect((await screen.findByTestId('roles-full-access-note')).textContent).toContain('equals full access');
  });
});

describe('RolesPage — apps', () => {
  it('draws every app’s staff screens, then each installed app’s, and any app a role already holds', async () => {
    installFetch();
    renderRoles();
    expect(await screen.findByText('Apps')).toBeTruthy();
    const every = await screen.findByRole('button', { name: 'Open every app’s staff screens — Viewer' });
    await waitFor(() => expect(every.getAttribute('aria-pressed')).toBe('true'));
    const pos = await screen.findByRole('button', { name: 'Open Point of Sale’s staff screens — Viewer' });
    expect(pos.getAttribute('aria-pressed')).toBe('false');
    // Not installed, but held: it is never invisible here.
    expect(screen.getByRole('button', { name: 'Open booking’s staff screens — Viewer' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('saves one app’s staff screens as its own grant', async () => {
    const puts = installFetch();
    const user = userEvent.setup();
    renderRoles();
    const pos = await screen.findByRole('button', { name: 'Open Point of Sale’s staff screens — Viewer' });
    await waitFor(() => expect((pos as HTMLButtonElement).disabled).toBe(false));
    await user.click(pos);
    await user.click(screen.getByTestId('roles-save'));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect((puts[0]!.body as { grants: string[] }).grants).toContain('app:pos:staff');
  });
});
