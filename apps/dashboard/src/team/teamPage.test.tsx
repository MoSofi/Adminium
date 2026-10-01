// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Team directory offers a row only the actions its viewer can carry out.
 *
 * `users.manage` (the built-in Admin's key) opens this page, but the server
 * refuses a non-Super-Admin anything on a Super Admin's account, refuses
 * anyone suspending or deleting their own, and wants `roles.manage` on top for
 * role changes. Before these rules reached the UI an Admin could open the
 * delete dialog on the Super Admin, type the address, and watch nothing
 * happen while the request failed in the network tab.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { bootstrapQuery, type BootstrapData } from '../app/bootstrap.js';
import { installTestI18n } from '../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../test/fixtures.js';
import { ShellHarness } from '../test/shellHarness.js';
import { TeamPage } from './TeamPage.js';
import type { UserDto } from './teamApi.js';

function user(overrides: Partial<UserDto> & Pick<UserDto, 'id' | 'name' | 'email'>): UserDto {
  return {
    status: 'active',
    totpEnabled: false,
    lastLoginAt: null,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    roles: [],
    ...overrides,
  };
}

const owner = user({
  id: 'usr_owner',
  name: 'Ava Owner',
  email: 'ava@example.test',
  roles: [{ id: 'role_sa', slug: 'super-admin', name: 'Super Admin' }],
});
const me = user({
  id: 'usr_me',
  name: 'Ian Admin',
  email: 'ian@example.test',
  roles: [{ id: 'role_admin', slug: 'admin', name: 'Admin' }],
});
const colleague = user({
  id: 'usr_colleague',
  name: 'Cleo Viewer',
  email: 'cleo@example.test',
  roles: [{ id: 'role_viewer', slug: 'viewer', name: 'Viewer' }],
});

/** The built-in Admin: users.manage, no roles.manage. */
const adminBootstrap = makeBootstrap({
  user: { ...makeBootstrap().user, id: me.id, email: me.email, name: me.name },
  roles: ['admin'],
  systemActions: ['users.manage', 'audit.read', 'connections.manage'],
});

function installFetch(overrides: Record<string, () => Response> = {}) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const key = `${init?.method ?? 'GET'} ${url}`;
      calls.push(key);
      const override = overrides[key];
      if (override !== undefined) return Promise.resolve(override());
      if (key.startsWith('GET /api/v1/users')) {
        return Promise.resolve(
          jsonResponse(200, {
            users: [owner, me, colleague],
            nextCursor: null,
            counts: { active: 3, invited: 0, suspended: 0 },
          }),
        );
      }
      if (key === 'GET /api/v1/roles') {
        return Promise.resolve(jsonResponse(200, { roles: [] }));
      }
      return Promise.resolve(
        jsonResponse(404, { error: { code: 'NOT_FOUND', message: `no route: ${key}` } }),
      );
    }),
  );
  return calls;
}

function renderTeam(bootstrap: BootstrapData) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(bootstrapQuery().queryKey, bootstrap);
  render(
    <QueryClientProvider client={queryClient}>
      <ShellHarness>
        <TeamPage />
      </ShellHarness>
    </QueryClientProvider>,
  );
}

async function rowOf(name: string): Promise<HTMLElement> {
  const cell = await screen.findByText(name);
  const row = cell.closest('tr');
  if (row === null) throw new Error(`no row for ${name}`);
  return row;
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

describe('TeamPage row actions', () => {
  it('offers an Admin nothing on a Super Admin’s row', async () => {
    installFetch();
    renderTeam(adminBootstrap);
    const row = await rowOf('Ava Owner');
    expect(within(row).queryAllByRole('button')).toHaveLength(0);
  });

  it('offers no Suspend or Delete on the viewer’s own row', async () => {
    installFetch();
    renderTeam(adminBootstrap);
    const row = await rowOf('Ian Admin');
    expect(within(row).queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(within(row).queryByRole('button', { name: 'Suspend' })).toBeNull();
  });

  it('offers Suspend and Delete on an ordinary colleague, but never Roles without roles.manage', async () => {
    installFetch();
    renderTeam(adminBootstrap);
    const row = await rowOf('Cleo Viewer');
    expect(within(row).getByRole('button', { name: 'Delete' })).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Suspend' })).toBeTruthy();
    expect(within(row).queryByRole('button', { name: 'Roles' })).toBeNull();
  });

  it('does not ask for the role list without roles.manage', async () => {
    const calls = installFetch();
    renderTeam(adminBootstrap);
    await rowOf('Cleo Viewer');
    expect(calls).not.toContain('GET /api/v1/roles');
    expect(screen.queryByRole('combobox', { name: 'Filter by role' })).toBeNull();
  });

  it('offers a Super Admin every action on another Super Admin', async () => {
    installFetch();
    renderTeam(
      makeBootstrap({
        user: { ...makeBootstrap().user, id: 'usr_other', email: 'o@example.test', name: 'Other' },
        roles: ['super-admin'],
      }),
    );
    const row = await rowOf('Ava Owner');
    expect(within(row).getByRole('button', { name: 'Delete' })).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Suspend' })).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Roles' })).toBeTruthy();
  });

  it('says in the dialog why a delete was refused', async () => {
    installFetch({
      [`DELETE /api/v1/users/${colleague.id}?permanent=true`]: () =>
        jsonResponse(409, { error: { code: 'CONFLICT', message: 'Cannot remove the last Super Admin.' } }),
    });
    renderTeam(adminBootstrap);
    const row = await rowOf('Cleo Viewer');
    await userEvent.click(within(row).getByRole('button', { name: 'Delete' }));

    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByRole('textbox'), colleague.email);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete permanently' }));

    const alert = await within(dialog).findByTestId('team-remove-error');
    expect(alert.textContent).toContain('The account was not deleted');
    expect(alert.textContent).toContain('Cannot remove the last Super Admin.');
  });

  it('says above the table why a suspend was refused', async () => {
    installFetch({
      [`PATCH /api/v1/users/${colleague.id}`]: () =>
        jsonResponse(403, { error: { code: 'FORBIDDEN', message: 'Only a Super Admin can change a Super Admin account.' } }),
    });
    renderTeam(adminBootstrap);
    const row = await rowOf('Cleo Viewer');
    await userEvent.click(within(row).getByRole('button', { name: 'Suspend' }));

    const alert = await screen.findByTestId('team-action-error');
    expect(alert.textContent).toContain('Only a Super Admin can change a Super Admin account.');
  });
});

describe('the invitation banner says what the server did', () => {
  /*
   * The banner used to read "Adminium did not email this link" whatever had
   * happened — beside an invitation that arrived in the inbox seconds later.
   * The reply's own `emailSent` decides the sentence now.
   */
  const invited = user({ id: 'usr_new', name: 'Noor New', email: 'noor@example.test', status: 'invited' });
  const withInvite = (emailSent: boolean) => ({
    'GET /api/v1/users?limit=50': () =>
      jsonResponse(200, { users: [me, invited], nextCursor: null, counts: { active: 1, invited: 1, suspended: 0 } }),
    [`POST /api/v1/users/${invited.id}/invite/resend`]: () =>
      jsonResponse(200, {
        user: invited,
        invite: { token: 'adm_reset_x', expiresAt: Date.now() + 86_400_000, activationPath: '/reset/adm_reset_x' },
        emailSent,
      }),
  });

  async function resend(emailSent: boolean) {
    const routes = withInvite(emailSent);
    vi.stubGlobal(
      'fetch',
      vi.fn((input: unknown, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        if (method === 'POST' && url.endsWith('/invite/resend')) return Promise.resolve(routes[`POST /api/v1/users/${invited.id}/invite/resend`]!());
        if (method === 'GET' && url.startsWith('/api/v1/users')) return Promise.resolve(routes['GET /api/v1/users?limit=50']());
        if (url === '/api/v1/roles') return Promise.resolve(jsonResponse(200, { roles: [] }));
        return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: url } }));
      }),
    );
    renderTeam(adminBootstrap);
    const row = await rowOf('Noor New');
    await userEvent.click(within(row).getByRole('button', { name: 'New link' }));
    return await screen.findByTestId('team-invite-banner');
  }

  it('says it emailed the link when the server queued the mail', async () => {
    const banner = await resend(true);
    expect(banner.textContent).toContain('Adminium emailed this link');
    expect(banner.textContent).toContain('noor@example.test');
    expect(banner.textContent).not.toContain('did not email');
    // The link is still there: an email can fail to arrive.
    expect(within(banner).getByTestId('team-invite-link').textContent).toContain('/reset/adm_reset_x');
  });

  it('says it did not, and why, when nothing was sent', async () => {
    const banner = await resend(false);
    expect(banner.textContent).toContain('Adminium did not email this link');
    expect(within(banner).queryByTestId('team-invite-emailed')).toBeNull();
  });
});
