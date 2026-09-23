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

function installFetch() {
  const puts: { url: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'PUT') {
        puts.push({ url, body: JSON.parse(String(init?.body)) });
        return Promise.resolve(jsonResponse(200, { roleId: 'role_viewer', grants: [] }));
      }
      if (url === '/api/v1/roles') return Promise.resolve(jsonResponse(200, { roles: ROLES }));
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
