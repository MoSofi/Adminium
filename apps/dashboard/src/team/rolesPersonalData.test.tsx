// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "See personal data in records" in the Roles matrix: the grant that shows
 * people's phone numbers and addresses in clear. It is its own row because
 * nothing else implies it — "every action" on a table does not include it —
 * and a role that holds it on one table only (an app's reception, on its
 * patients) keeps that grant through a save.
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

// Reception reads every table, and sees personal data in one of them only.
const VIEWER_GRANTS = ['page:*:view', 'table:*:*:read', 'table:conn_1:main.patients:read_pii'];

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
            tableActions: ['read', 'create', 'update', 'delete', 'export', 'import', 'read_pii'],
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

describe('RolesPage — personal data', () => {
  it('draws its own row, off for a role that holds it on one table only', async () => {
    installFetch();
    renderRoles();
    const row = await screen.findByRole('button', { name: 'See personal data in records — Viewer' });
    await waitFor(() => expect(row.getAttribute('aria-pressed')).toBe('false'));
    expect((await screen.findByTestId('roles-narrow-grants')).textContent).toContain('1 grant');
  });

  it('grants it on every table, keeping the one-table grant', async () => {
    const puts = installFetch();
    const user = userEvent.setup();
    renderRoles();
    const row = await screen.findByRole('button', { name: 'See personal data in records — Viewer' });
    await waitFor(() => expect((row as HTMLButtonElement).disabled).toBe(false));
    await user.click(row);
    await user.click(screen.getByTestId('roles-save'));
    await waitFor(() => expect(puts).toHaveLength(1));
    const sent = (puts[0]!.body as { grants: string[] }).grants;
    expect([...sent].sort()).toEqual([...VIEWER_GRANTS, 'table:*:*:read_pii'].sort());
  });
});
