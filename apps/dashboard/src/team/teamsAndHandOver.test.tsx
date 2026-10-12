// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Teams on the Team page, and the rows a person leaves behind.
 *
 * A team's lead reaches its members' rows, so the card says so, and each
 * change is one small request. And an account is not deleted for good while
 * rows still name its person: the dialog lists them, asks who takes them,
 * hands them over and only then deletes — a private table's rows excepted,
 * which it says stay where they are.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { bootstrapQuery } from '../app/bootstrap.js';
import { installTestI18n } from '../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../test/fixtures.js';
import { ShellHarness } from '../test/shellHarness.js';
import { TeamPage } from './TeamPage.js';
import { namedRowsByTable, type NamedRows, type TeamDto, type UserDto } from './teamApi.js';

const user = (id: string, name: string, slug = 'viewer'): UserDto => ({
  id,
  name,
  email: `${name.split(' ')[0]!.toLowerCase()}@example.test`,
  status: 'active',
  totpEnabled: false,
  lastLoginAt: null,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  roles: [{ id: `role_${slug}`, slug, name: slug }],
});
const me = user('usr_me', 'Ava Owner', 'super-admin');
const dana = user('usr_dana', 'Dana Whitlock');
const sam = user('usr_sam', 'Sam Okonjo');

const SALES: TeamDto = {
  id: 'team_1',
  name: 'Sales',
  createdAt: 1,
  updatedAt: 1,
  members: [
    { userId: 'usr_ivy', name: 'Ivy Sandoval', email: 'ivy@example.test', status: 'active', lead: true },
    { userId: dana.id, name: dana.name, email: dana.email, status: 'active', lead: false },
  ],
};
const NAMED: NamedRows = {
  total: 8,
  unreadable: [],
  named: [
    { connectionId: 'c1', connectionName: 'Main', tableId: 'main.crm_deals', tableLabel: 'Deals', column: 'owner_id', rows: 6, private: false },
    { connectionId: 'c1', connectionName: 'Main', tableId: 'main.crm_follow_ups', tableLabel: 'Follow-ups', column: 'owner_id', rows: 2, private: false },
    { connectionId: 'c1', connectionName: 'Main', tableId: 'main.crm_one_to_ones', tableLabel: 'One-to-ones', column: 'rep_id', rows: 3, private: true },
  ],
};

function installFetch(named: NamedRows = NAMED) {
  const calls: { key: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const key = `${method} ${url}`;
      if (method !== 'GET') calls.push({ key, body: init?.body === undefined ? null : (JSON.parse(String(init.body)) as unknown) });
      if (key === 'GET /api/v1/teams') return Promise.resolve(jsonResponse(200, { teams: [SALES], reachMax: 2000, over: [] }));
      if (key.startsWith('GET /api/v1/people')) {
        return Promise.resolve(jsonResponse(200, { people: [me, dana, sam].map((one) => ({ id: one.id, name: one.name, sample: false })) }));
      }
      if (key === `GET /api/v1/users/${dana.id}/rows`) return Promise.resolve(jsonResponse(200, named));
      if (key.startsWith('GET /api/v1/users')) return Promise.resolve(jsonResponse(200, { users: [me, dana, sam], nextCursor: null, counts: { active: 3, invited: 0, suspended: 0, sample: 0 } }));
      if (key === 'GET /api/v1/roles') return Promise.resolve(jsonResponse(200, { roles: [] }));
      if (method !== 'GET') return Promise.resolve(jsonResponse(200, method === 'DELETE' && url.includes('/users/') ? { ok: true, permanent: true, user: null } : SALES));
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: key } }));
    }),
  );
  return calls;
}

function renderTeam() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(bootstrapQuery().queryKey, makeBootstrap({ user: { ...makeBootstrap().user, id: me.id, email: me.email, name: me.name }, roles: ['super-admin'], systemActions: ['users.manage', 'roles.manage'] }));
  render(
    <QueryClientProvider client={queryClient}>
      <ShellHarness>
        <TeamPage />
      </ShellHarness>
    </QueryClientProvider>,
  );
}

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => restoreI18n());
afterEach(() => vi.unstubAllGlobals());

describe('teams on the Team page', () => {
  it('says what leading a team gives, lists each team with its lead, and sends one request per change', async () => {
    const calls = installFetch();
    renderTeam();
    const card = within(await screen.findByTestId('teams-card'));
    expect(card.getByText('Where a role is held to “their team’s rows”, a team’s lead reaches the rows of everyone in it. A member reaches only their own.')).toBeTruthy();
    const sales = within(await screen.findByTestId('teams-team-Sales'));
    expect(sales.getByText('2 people')).toBeTruthy();
    const boxes = sales.getAllByRole('checkbox');
    expect(boxes.map((box) => box.getAttribute('aria-checked'))).toEqual(['true', 'false']);
    // Dana is made a lead: one request, naming her.
    await userEvent.click(boxes[1]!);
    await waitFor(() => expect(calls.at(-1)).toEqual({ key: `PUT /api/v1/teams/team_1/members/${dana.id}`, body: { lead: true } }));
    // Only somebody not yet in the team is offered; adding puts them in as a member, not a lead.
    const add = screen.getByTestId('teams-add-Sales') as HTMLSelectElement;
    expect([...add.options].map((option) => option.textContent)).toEqual(['Add a person…', 'Ava Owner', 'Sam Okonjo']);
    await userEvent.selectOptions(add, sam.id);
    await userEvent.click(screen.getByTestId('teams-add-confirm-Sales'));
    await waitFor(() => expect(calls.at(-1)).toEqual({ key: `PUT /api/v1/teams/team_1/members/${sam.id}`, body: { lead: false } }));
    await userEvent.click(sales.getByRole('button', { name: 'Remove Dana Whitlock from Sales' }));
    await waitFor(() => expect(calls.at(-1)?.key).toBe(`DELETE /api/v1/teams/team_1/members/${dana.id}`));
    await userEvent.type(screen.getByTestId('teams-new-name'), 'North');
    await userEvent.click(screen.getByTestId('teams-create'));
    await waitFor(() => expect(calls.at(-1)).toEqual({ key: 'POST /api/v1/teams', body: { name: 'North' } }));
    // Deleting asks first, and says what it does and does not touch.
    await userEvent.click(screen.getByTestId('teams-delete-Sales'));
    expect(await screen.findByText('Its lead stops reaching the members’ rows. Nobody’s account and nobody’s rows are touched.')).toBeTruthy();
    await userEvent.click(screen.getByTestId('teams-delete-confirm'));
    await waitFor(() => expect(calls.at(-1)?.key).toBe('DELETE /api/v1/teams/team_1'));
  });
});

describe('removing a person rows still name', () => {
  const openRemove = async () => {
    const cell = await screen.findByText(dana.email);
    await userEvent.click(within(cell.closest('tr')!).getByRole('button', { name: 'Delete' }));
    return within(await screen.findByRole('dialog'));
  };

  it('lists the rows, asks who takes them, hands them over, then deletes', async () => {
    const calls = installFetch();
    renderTeam();
    const dialog = await openRemove();
    const rows = within(await dialog.findByTestId('team-remove-rows'));
    expect(rows.getByText('Dana Whitlock is named in 8 rows')).toBeTruthy();
    expect(rows.getByText('Deals: 6')).toBeTruthy();
    expect(rows.getByText('Follow-ups: 2')).toBeTruthy();
    expect(rows.getByTestId('team-remove-rows-kept').textContent).toBe('3 rows of private tables stay as they are: nobody else may read them.');
    // She is not offered her own rows.
    const to = rows.getByTestId('team-remove-rows-to') as HTMLSelectElement;
    expect([...to.options].map((option) => option.textContent)).toEqual(['Choose a person…', 'Ava Owner', 'Sam Okonjo']);
    await userEvent.type(dialog.getByRole('textbox'), dana.email);
    // Nobody chosen: nothing is sent, and the dialog says what is missing.
    await userEvent.click(dialog.getByRole('button', { name: 'Delete permanently' }));
    expect((await dialog.findByTestId('team-remove-error')).textContent).toContain('Choose who takes the rows first.');
    expect(calls).toEqual([]);
    await userEvent.selectOptions(to, sam.id);
    await userEvent.click(dialog.getByRole('button', { name: 'Delete permanently' }));
    await waitFor(() => expect(calls.map((call) => call.key)).toEqual([`POST /api/v1/users/${dana.id}/rows/hand-over`, `DELETE /api/v1/users/${dana.id}?permanent=true`]));
    expect(calls[0]!.body).toEqual({ to: sam.id });
  });

  it('asks nothing when no row names them, and deletes at once', async () => {
    const calls = installFetch({ named: [], unreadable: [], total: 0 });
    renderTeam();
    const dialog = await openRemove();
    await userEvent.type(dialog.getByRole('textbox'), dana.email);
    expect(dialog.queryByTestId('team-remove-rows')).toBeNull();
    await userEvent.click(dialog.getByRole('button', { name: 'Delete permanently' }));
    await waitFor(() => expect(calls.map((call) => call.key)).toEqual([`DELETE /api/v1/users/${dana.id}?permanent=true`]));
  });

  it('says so when a database could not be checked', async () => {
    installFetch({ named: [], unreadable: [{ connectionId: 'c2', connectionName: 'Warehouse' }], total: 0 });
    renderTeam();
    const dialog = await openRemove();
    expect((await dialog.findByTestId('team-remove-rows-unreadable')).textContent).toBe('Could not check Warehouse. Rows there may still name this person.');
  });
});

describe('the named rows, as the dialog lists them', () => {
  it('adds a table\'s columns together, most rows first, and keeps the private ones apart', () => {
    expect(namedRowsByTable({ ...NAMED, named: [...NAMED.named, { ...NAMED.named[1]!, column: 'done_by_id', rows: 5 }] })).toEqual({
      moved: [
        { label: 'Follow-ups', rows: 7 },
        { label: 'Deals', rows: 6 },
      ],
      kept: 3,
    });
  });
});
