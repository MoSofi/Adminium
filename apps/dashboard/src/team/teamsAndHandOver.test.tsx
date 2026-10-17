// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Teams, a page of its own; the People list; and the rows a person leaves
 * behind.
 *
 * A team's lead reaches its members' rows, so the page says what a team
 * decides, and a team's sheet holds its changes until "Save team", which
 * sends one small request a change. And an account is not suspended or
 * deleted for good without the question of its rows: the dialog lists them,
 * asks who takes them, and the server hands them over in the same call that
 * suspends or deletes — a private table's rows excepted, which it says stay
 * where they are. Suspending may leave them where they are; a suspended
 * person's rows can be handed on afterwards.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { bootstrapQuery } from '../app/bootstrap.js';
import { installTestI18n } from '../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../test/fixtures.js';
import { ShellHarness } from '../test/shellHarness.js';
import { TeamPage } from './TeamPage.js';
import { TeamsPage, draftChanges } from './TeamsPage.js';
import { namedRowsByTable, teamsQuery, type NamedRows, type TeamDto, type UserDto } from './teamApi.js';

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
const ivy = user('usr_ivy', 'Ivy Sandoval');
const leo: UserDto = { ...user('usr_leo', 'Leo Vance'), status: 'suspended' };

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
    { connectionId: 'c1', connectionName: 'Main', tableId: 'main.crm_deals', tableLabel: 'Deals', column: 'owner_id', rows: 6 },
    { connectionId: 'c1', connectionName: 'Main', tableId: 'main.crm_follow_ups', tableLabel: 'Follow-ups', column: 'owner_id', rows: 2 },
  ],
  // A one-to-one names her too: said, and neither counted nor named.
  private: true,
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
      if (/^GET \/api\/v1\/users\/usr_[a-z]+\/rows$/.test(key)) return Promise.resolve(jsonResponse(200, named));
      if (key.startsWith('GET /api/v1/users')) return Promise.resolve(jsonResponse(200, { users: [me, ivy, dana, sam, leo], nextCursor: null, counts: { active: 4, invited: 0, suspended: 1, sample: 0 } }));
      if (key === 'GET /api/v1/roles') return Promise.resolve(jsonResponse(200, { roles: [] }));
      if (method !== 'GET') return Promise.resolve(jsonResponse(200, method === 'DELETE' && url.includes('/users/') ? { ok: true, permanent: true, user: null } : url.endsWith('/rows/hand-over') ? named : SALES));
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

// The page's link to Roles & access, without a router around the page.
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  Link: ({ to, className, children }: { to: string; className?: string; children: ReactNode }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => restoreI18n());
afterEach(() => vi.unstubAllGlobals());

function renderTeams(teams: TeamDto[] = [SALES]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(bootstrapQuery().queryKey, makeBootstrap({ user: { ...makeBootstrap().user, id: me.id, email: me.email, name: me.name }, roles: ['super-admin'], systemActions: ['users.manage', 'roles.manage'] }));
  queryClient.setQueryData(teamsQuery().queryKey, { teams, reachMax: 2000, over: [] });
  render(
    <QueryClientProvider client={queryClient}>
      <ShellHarness>
        <TeamsPage />
      </ShellHarness>
    </QueryClientProvider>,
  );
}

describe('the Teams page', () => {
  it('says what a team decides, and lists each team with who leads it and who is in it', async () => {
    installFetch();
    renderTeams();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Teams');
    const notice = within(screen.getByTestId('teams-notice'));
    expect(notice.getByText('A team decides whose records a person can open when their role says “their team’s”.')).toBeTruthy();
    expect(notice.getByRole('link', { name: 'Roles & access' }).getAttribute('href')).toBe('/settings/roles');
    expect(screen.getByTestId('teams-summary').textContent).toBe('1 team · 2 people in one or more');
    const sales = within(screen.getByTestId('teams-row-Sales'));
    expect(sales.getByRole('button', { name: 'Sales' }).getAttribute('aria-haspopup')).toBe('dialog');
    expect(sales.getByText('Ivy Sandoval')).toBeTruthy();
    expect(sales.getByText('Dana · 2 people in all')).toBeTruthy();
  });

  it('says what no team means for "their team’s"', async () => {
    installFetch();
    renderTeams([]);
    const empty = within(await screen.findByTestId('teams-empty'));
    expect(empty.getByText('No teams yet')).toBeTruthy();
    expect(empty.getByText('Until there is one, a role set to “their team’s” opens the same rows as “their own”.')).toBeTruthy();
  });

  it('holds a team\'s changes as a draft, and sends one request a change on "Save team"', async () => {
    const calls = installFetch();
    renderTeams();
    await userEvent.click(screen.getByRole('button', { name: 'Sales' }));
    const sheet = within(await screen.findByRole('dialog'));
    expect(sheet.getByText('Tick who leads. A lead’s “their team’s” covers everyone here.')).toBeTruthy();
    const boxes = sheet.getAllByRole('checkbox');
    expect(boxes.map((box) => box.getAttribute('aria-checked'))).toEqual(['true', 'false']);
    // Dana leads, Sam joins, Ivy leaves: nothing is sent yet.
    await userEvent.click(boxes[1]!);
    const add = sheet.getByTestId('team-sheet-add') as HTMLSelectElement;
    // Only somebody not yet in the team is offered.
    expect([...add.options].map((option) => option.textContent)).toEqual(['Pick someone…', 'Ava Owner', 'Sam Okonjo']);
    await userEvent.selectOptions(add, sam.id);
    await userEvent.click(sheet.getByTestId('team-sheet-add-confirm'));
    await userEvent.click(sheet.getByRole('button', { name: 'Remove Ivy Sandoval from Sales' }));
    expect(calls).toEqual([]);
    await userEvent.click(sheet.getByTestId('team-sheet-save'));
    // Who leaves first, then who joins or now leads; the name was not changed, so it is not sent.
    await waitFor(() =>
      expect(calls).toEqual([
        { key: 'DELETE /api/v1/teams/team_1/members/usr_ivy', body: null },
        { key: `PUT /api/v1/teams/team_1/members/${dana.id}`, body: { lead: true } },
        { key: `PUT /api/v1/teams/team_1/members/${sam.id}`, body: { lead: false } },
      ]),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('makes a new team only once it has a name', async () => {
    const calls = installFetch();
    renderTeams();
    await userEvent.click(screen.getByTestId('teams-new'));
    const sheet = within(await screen.findByRole('dialog'));
    await userEvent.click(sheet.getByTestId('team-sheet-save'));
    expect(await sheet.findByText('Give the team a name first.')).toBeTruthy();
    expect(calls).toEqual([]);
    await userEvent.type(sheet.getByTestId('team-sheet-name'), 'North');
    await userEvent.selectOptions(sheet.getByTestId('team-sheet-add'), sam.id);
    await userEvent.click(sheet.getByTestId('team-sheet-add-confirm'));
    await userEvent.click(sheet.getByTestId('team-sheet-save'));
    await waitFor(() =>
      expect(calls).toEqual([
        { key: 'POST /api/v1/teams', body: { name: 'North' } },
        // The new team's id is the one the server answered with.
        { key: `PUT /api/v1/teams/team_1/members/${sam.id}`, body: { lead: false } },
      ]),
    );
  });

  it('asks before deleting a team, and says what it does and does not touch', async () => {
    const calls = installFetch();
    renderTeams();
    await userEvent.click(screen.getByRole('button', { name: 'Sales' }));
    await userEvent.click(await screen.findByTestId('team-sheet-delete'));
    expect(await screen.findByText('Its lead stops reaching the members’ rows. Nobody’s account and nobody’s rows are touched.')).toBeTruthy();
    expect(calls).toEqual([]);
    await userEvent.click(screen.getByTestId('teams-delete-confirm'));
    await waitFor(() => expect(calls.at(-1)?.key).toBe('DELETE /api/v1/teams/team_1'));
  });

  it('works out what a save sends without a screen', () => {
    const draft = { id: SALES.id, name: 'Sales North', members: [{ ...SALES.members[1]!, lead: true }] };
    expect(draftChanges(SALES, draft)).toEqual({ rename: 'Sales North', remove: ['usr_ivy'], set: [{ userId: dana.id, lead: true }] });
    expect(draftChanges(SALES, { ...draft, name: ' Sales ', members: SALES.members })).toEqual({ rename: null, remove: [], set: [] });
    expect(draftChanges(null, { id: null, name: 'New', members: [] })).toEqual({ rename: 'New', remove: [], set: [] });
  });
});

describe('the People list', () => {
  it('is called People, and says which teams each person is in and which they lead', async () => {
    installFetch();
    renderTeam();
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe('People');
    const teamsOf = async (email: string) => within((await screen.findByText(email)).closest('tr')!).getByTestId('team-row-teams').textContent;
    await waitFor(async () => expect(await teamsOf(ivy.email)).toBe('Sales (leads)'));
    expect(await teamsOf(dana.email)).toBe('Sales');
    expect(await teamsOf(sam.email)).toBe('—');
  });
});

describe('suspending a person rows still name', () => {
  const openSuspend = async (who: UserDto, button = 'Suspend') => {
    const cell = await screen.findByText(who.email);
    await userEvent.click(within(cell.closest('tr')!).getByRole('button', { name: button }));
    return within(await screen.findByRole('dialog'));
  };

  it('asks who takes the rows, and suspends and hands them over in one call', async () => {
    const calls = installFetch();
    renderTeam();
    const dialog = await openSuspend(dana);
    expect(dialog.getByText('Suspend Dana Whitlock?')).toBeTruthy();
    const rows = within(await dialog.findByTestId('team-suspend-rows'));
    expect(rows.getByText('Hand their 8 rows to…')).toBeTruthy();
    expect(rows.getByText('Dana Whitlock owns these. Suspended, they stay Dana Whitlock’s until somebody takes them.')).toBeTruthy();
    expect(rows.getByText('Deals: 6')).toBeTruthy();
    expect(rows.getByTestId('team-suspend-rows-kept')).toBeTruthy();
    const to = rows.getByTestId('team-suspend-rows-to') as HTMLSelectElement;
    expect([...to.options].map((option) => option.textContent)).toEqual(['Nobody for now', 'Ava Owner', 'Sam Okonjo']);
    expect(dialog.getByTestId('team-suspend-confirm').textContent).toBe('Suspend');
    await userEvent.selectOptions(to, sam.id);
    expect(dialog.getByTestId('team-suspend-confirm').textContent).toBe('Hand over and suspend');
    await userEvent.click(dialog.getByTestId('team-suspend-confirm'));
    // One call: the server hands the rows over only once it has agreed to the suspension.
    await waitFor(() => expect(calls.map((call) => call.key)).toEqual([`DELETE /api/v1/users/${dana.id}?handTo=${sam.id}`]));
  });

  it('may leave the rows where they are: a suspension that hands nothing on', async () => {
    const calls = installFetch();
    renderTeam();
    const dialog = await openSuspend(dana);
    await dialog.findByTestId('team-suspend-rows');
    await userEvent.click(dialog.getByTestId('team-suspend-confirm'));
    await waitFor(() => expect(calls.map((call) => call.key)).toEqual([`DELETE /api/v1/users/${dana.id}`]));
  });

  it('hands a suspended person\'s rows on afterwards, and only to somebody chosen', async () => {
    const calls = installFetch();
    renderTeam();
    const dialog = await openSuspend(leo, 'Hand on rows');
    expect(await dialog.findByText('Leo Vance is suspended and still owns these. Choose who takes them.')).toBeTruthy();
    await userEvent.click(dialog.getByTestId('team-suspend-confirm'));
    expect((await dialog.findByTestId('team-suspend-error')).textContent).toContain('Choose who takes the rows first.');
    expect(calls).toEqual([]);
    await userEvent.selectOptions(dialog.getByTestId('team-suspend-rows-to'), sam.id);
    await userEvent.click(dialog.getByTestId('team-suspend-confirm'));
    await waitFor(() => expect(calls).toEqual([{ key: `POST /api/v1/users/${leo.id}/rows/hand-over`, body: { to: sam.id } }]));
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
    expect(rows.getByText('Hand their 8 rows to…')).toBeTruthy();
    expect(rows.getByText('Dana Whitlock owns these. Removed for good, they would be nobody’s: choose who takes them.')).toBeTruthy();
    expect(rows.getByText('Deals: 6')).toBeTruthy();
    expect(rows.getByText('Follow-ups: 2')).toBeTruthy();
    expect(rows.getByTestId('team-remove-rows-kept').textContent).toBe('Rows of private tables stay as they are: nobody else may read them.');
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
    // One call: the server hands the rows over once it has agreed to the removal, never before.
    await waitFor(() => expect(calls.map((call) => call.key)).toEqual([`DELETE /api/v1/users/${dana.id}?permanent=true&handTo=${sam.id}`]));
  });

  it('asks nothing when no row names them, and deletes at once', async () => {
    const calls = installFetch({ named: [], private: false, unreadable: [], total: 0 });
    renderTeam();
    const dialog = await openRemove();
    await userEvent.type(dialog.getByRole('textbox'), dana.email);
    expect(dialog.queryByTestId('team-remove-rows')).toBeNull();
    await userEvent.click(dialog.getByRole('button', { name: 'Delete permanently' }));
    await waitFor(() => expect(calls.map((call) => call.key)).toEqual([`DELETE /api/v1/users/${dana.id}?permanent=true`]));
  });

  it('says so when a database could not be checked', async () => {
    installFetch({ named: [], private: false, unreadable: [{ connectionId: 'c2', connectionName: 'Warehouse' }], total: 0 });
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
      kept: true,
    });
  });
});
