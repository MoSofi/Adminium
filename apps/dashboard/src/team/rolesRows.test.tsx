// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Which rows a role reaches", on the Roles page.
 *
 * The dialog says how each table tells whose a row is, in words; lets read,
 * change and delete each be held to the person's own rows or their team's;
 * counts what a chosen person would see before anything is saved; and says
 * when another role of that person makes the limit moot. What matters most is
 * what a save SENDS: the role's whole grant list untouched but for the table
 * being named, and only the limits that changed.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Suspense } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../test/fixtures.js';
import { ShellHarness } from '../test/shellHarness.js';
import { RolesPage, reachSentence } from './RolesPage.js';
import { rowLimitsSave, withReach, type RoleListItem, type RoleRowsTable } from './rolesApi.js';

const role = (id: string, slug: string, name: string): RoleListItem => ({ id, slug, name, description: null, isBuiltin: false, memberCount: 1, createdAt: 1, updatedAt: 1 });
const ROLES = [role('role_sa', 'super-admin', 'Super Admin'), role('role_rep', 'rep', 'Rep')];
const REP_GRANTS = ['table:*:*:read', 'table:conn_1:main.deals:update', 'page:*:view'];

const table = (over: Partial<RoleRowsTable>): RoleRowsTable => ({
  ref: 'conn_1/main.deals',
  connectionId: 'conn_1',
  connectionName: 'Main',
  tableId: 'main.deals',
  label: 'Deals',
  private: false,
  ways: [
    { kind: 'person', column: 'owner_id', label: 'Owner' },
    { kind: 'listing', table: 'main.deal_members', label: 'Deal members', dated: false },
  ],
  granted: { read: true, update: true, delete: false },
  own: true,
  limit: null,
  ...over,
});
const TABLES = [
  table({}),
  table({ ref: 'conn_1/main.quotes', tableId: 'main.quotes', label: 'Quotes', own: false, granted: { read: true, update: false, delete: false }, ways: [{ kind: 'parent', column: 'deal_id', table: 'main.deals', label: 'Deals' }] }),
  table({ ref: 'conn_1/main.notes', tableId: 'main.notes', label: 'One-to-ones', private: true, ways: [] }),
];

function installFetch() {
  const puts: { url: string; body: { grants: string[]; rows: Record<string, unknown> } }[] = [];
  const previews: Record<string, unknown>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'PUT') {
        puts.push({ url, body: JSON.parse(String(init?.body)) as { grants: string[]; rows: Record<string, unknown> } });
        return Promise.resolve(jsonResponse(200, { roleId: 'role_rep', grants: [], rows: {} }));
      }
      if (url === '/api/v1/roles/rows/preview') {
        const body = JSON.parse(String(init?.body)) as { userId: string; reach: { reach: string } | { reach: string }[] };
        previews.push(body as unknown as Record<string, unknown>);
        const own = !Array.isArray(body.reach) && body.reach.reach === 'own';
        return Promise.resolve(jsonResponse(200, { reached: own ? 6 : 14, total: 14, capped: false, liftedBy: body.userId === 'usr_ivy' ? ['Sales manager'] : [] }));
      }
      if (url === '/api/v1/roles') return Promise.resolve(jsonResponse(200, { roles: ROLES }));
      if (url.startsWith('/api/v1/bootstrap')) return Promise.resolve(jsonResponse(200, { data: makeBootstrap({}) }));
      if (url === '/api/v1/permissions/catalog') return Promise.resolve(jsonResponse(200, { system: [], tableActions: ['read', 'update', 'delete'], pageActions: ['view'] }));
      if (url === '/api/v1/roles/role_rep/permissions') return Promise.resolve(jsonResponse(200, { roleId: 'role_rep', grants: REP_GRANTS, rows: {} }));
      if (url === '/api/v1/roles/role_rep/rows') return Promise.resolve(jsonResponse(200, { roleId: 'role_rep', locked: false, tables: TABLES }));
      if (url.startsWith('/api/v1/people')) {
        return Promise.resolve(jsonResponse(200, { people: [{ id: 'usr_dana', name: 'Dana Whitlock', sample: true }, { id: 'usr_ivy', name: 'Ivy Sandoval', sample: false }] }));
      }
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: url } }));
    }),
  );
  return { puts, previews };
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
beforeAll(async () => {
  restoreI18n = await installTestI18n();
});
afterAll(() => restoreI18n());
afterEach(() => vi.unstubAllGlobals());

async function open() {
  const user = userEvent.setup();
  const io = installFetch();
  renderRoles();
  await user.click(await screen.findByTestId('roles-rows-rep'));
  await screen.findByTestId('roles-rows-tables');
  return { user, ...io };
}

describe('which rows a role reaches', () => {
  it('says in words how each table tells whose a row is, and offers nothing for a private one', async () => {
    await open();
    const deals = within(screen.getByTestId('roles-rows-table-main.deals'));
    expect(deals.getByText('A row belongs to the person in Owner or anyone listed for it in Deal members.')).toBeTruthy();
    // Read and change are the role's; delete is not, so it is not offered.
    expect(screen.queryByTestId('roles-rows-main.deals-read')).not.toBeNull();
    expect(screen.queryByTestId('roles-rows-main.deals-update')).not.toBeNull();
    expect(screen.queryByTestId('roles-rows-main.deals-delete')).toBeNull();
    // In the design's sentences: the table named, and every way its rows are somebody's.
    expect(screen.getByTestId('roles-rows-main.deals-read-sentence').textContent).toBe('Every row of Deals.');
    // A table reached through its parent keeps a limit of its own: said like any other, never "Follows: Deals".
    const quotes = within(screen.getByTestId('roles-rows-table-main.quotes'));
    expect(quotes.getByText('A row belongs to whoever reaches its Deals.')).toBeTruthy();
    expect(quotes.queryByText(/Follows/)).toBeNull();
    expect(screen.getByTestId('roles-rows-main.quotes-read-sentence').textContent).toBe('Every row of Quotes.');
    // The three choices, in the design's order and words.
    expect(within(screen.getByTestId('roles-rows-main.deals-read')).getAllByRole('radio').map((one) => one.textContent)).toEqual(['All rows', 'Their team’s', 'Their own']);
    const notes = within(screen.getByTestId('roles-rows-table-main.notes'));
    expect(notes.getByText('Read by the people each row belongs to, and by nobody else. There is nothing to choose.')).toBeTruthy();
    expect(screen.queryByTestId('roles-rows-main.notes-read')).toBeNull();
    // The locked column has no rows to choose.
    expect((screen.getByTestId('roles-rows-super-admin') as HTMLButtonElement).disabled).toBe(true);
  });

  it('saves only what changed, with the role\'s other grants as they were', async () => {
    const { user, puts } = await open();
    expect((screen.getByTestId('roles-rows-save') as HTMLButtonElement).disabled).toBe(true);
    await user.click(within(screen.getByTestId('roles-rows-main.deals-read')).getByRole('radio', { name: 'Their team’s' }));
    expect(screen.getByTestId('roles-rows-main.deals-read-sentence').textContent).toBe(
      'Only rows of Deals where Owner is this person or this person is listed in Deal members, or the same for someone in a team they lead.',
    );
    await user.click(within(screen.getByTestId('roles-rows-table-main.deals')).getAllByRole('checkbox')[0]!);
    expect(screen.getByTestId('roles-rows-main.deals-read-sentence').textContent).toBe(
      'Only rows of Deals where Owner is this person or this person is listed in Deal members, or the same for someone in a team they lead, and rows nobody owns yet.',
    );
    // Quotes are opened by the wider "read every table": a limit names the table for the role as well.
    await user.click(within(screen.getByTestId('roles-rows-main.quotes-read')).getByRole('radio', { name: 'Their own' }));
    expect(screen.getByTestId('roles-rows-main.quotes-read-sentence').textContent).toBe('Only rows of Quotes where this person reaches its Deals.');
    await user.click(screen.getByTestId('roles-rows-save'));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]!.url).toBe('/api/v1/roles/role_rep/permissions');
    expect(puts[0]!.body.rows).toEqual({ 'conn_1/main.deals': { read: { reach: 'team', unowned: true } }, 'conn_1/main.quotes': { read: { reach: 'own' } } });
    expect([...puts[0]!.body.grants].sort()).toEqual([...REP_GRANTS, 'table:conn_1:main.deals:read', 'table:conn_1:main.quotes:read'].sort());
  });

  it('counts what a chosen person would see under the limit as drawn, and says when another role lifts it', async () => {
    const { user, previews } = await open();
    await user.selectOptions(screen.getByTestId('roles-rows-person'), 'usr_dana');
    expect((await screen.findByTestId('roles-rows-main.deals-count')).textContent).toContain('Dana Whitlock would see 14 of 14 rows of Deals.');
    await user.click(within(screen.getByTestId('roles-rows-main.deals-read')).getByRole('radio', { name: 'Their own' }));
    await waitFor(() => expect(screen.getByTestId('roles-rows-main.deals-count').textContent).toContain('Dana Whitlock would see 6 of 14 rows of Deals.'));
    // Asked as that person, about this role, with the limit not yet saved.
    expect(previews.at(-1)).toMatchObject({ connectionId: 'conn_1', table: 'main.deals', userId: 'usr_dana', roleId: 'role_rep', reach: { reach: 'own' } });
    await user.selectOptions(screen.getByTestId('roles-rows-person'), 'usr_ivy');
    await waitFor(() => expect(screen.getByTestId('roles-rows-main.deals-count').textContent).toContain('Ivy Sandoval also holds Sales manager, which gives every row. This limit does not hold for them.'));
  });
});

describe('several reaches an app wrote for one action', () => {
  const WON = { reach: 'all' as const, while: { column: 'state', in: ['won'] } };
  const several = (): RoleRowsTable[] => [
    table({
      limit: { read: [WON, { reach: 'own' }] },
      ways: [
        { kind: 'person', column: 'owner_id', label: 'Owner' },
        { kind: 'listing', table: 'main.deal_members', label: 'Deal members', dated: false, when: { column: 'ended_on', label: 'Ended on', isNull: true } },
      ],
    }),
  ];
  async function openSeveral() {
    const user = userEvent.setup();
    const io = installFetch();
    const fetcher = globalThis.fetch as unknown as (input: unknown, init?: RequestInit) => Promise<Response>;
    vi.stubGlobal('fetch', vi.fn((input: unknown, init?: RequestInit) => (String(input) === '/api/v1/roles/role_rep/rows' ? Promise.resolve(jsonResponse(200, { roleId: 'role_rep', locked: false, tables: several() })) : fetcher(input, init))));
    renderRoles();
    await user.click(await screen.findByTestId('roles-rows-rep'));
    await screen.findByTestId('roles-rows-tables');
    return { user, ...io };
  }

  it('are said in words, each its own line, with nothing to pick; a listing that counts while a column is empty says so', async () => {
    await openSeveral();
    const deals = within(screen.getByTestId('roles-rows-table-main.deals'));
    expect(deals.getByText('A row belongs to the person in Owner or anyone listed for it in Deal members, while Ended on is empty.')).toBeTruthy();
    expect(screen.queryByTestId('roles-rows-main.deals-read')).toBeNull();
    expect(screen.getByTestId('roles-rows-main.deals-read-several').textContent).toContain('Any one of these is enough.');
    const lines = within(screen.getByTestId('roles-rows-main.deals-read-sentence')).getAllByRole('listitem').map((item) => item.textContent);
    expect(lines).toEqual(['Every row of Deals, only while state is won.', 'Only rows of Deals where Owner is this person or this person is listed in Deal members.']);
    // Change is still the dialog's to choose.
    expect(screen.queryByTestId('roles-rows-main.deals-update')).not.toBeNull();
  });

  it('are kept as written through a save of another action, and tried whole as a person', async () => {
    const { user, puts, previews } = await openSeveral();
    await user.selectOptions(screen.getByTestId('roles-rows-person'), 'usr_dana');
    await waitFor(() => expect(previews.at(-1)).toMatchObject({ reach: [WON, { reach: 'own' }] }));
    await user.click(within(screen.getByTestId('roles-rows-main.deals-update')).getByRole('radio', { name: 'Their own' }));
    await user.click(screen.getByTestId('roles-rows-save'));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]!.body.rows).toEqual({ 'conn_1/main.deals': { read: [WON, { reach: 'own' }], update: { reach: 'own' } } });
  });
});

describe('the sentence a limit is said in', () => {
  const one = { label: 'Deals', ways: [{ kind: 'person' as const, column: 'owner_id', label: 'Owner' }] };
  it('names the table and its one column as the design does', () => {
    expect(reachSentence(one, null)).toBe('Every row of Deals, whoever Owner is.');
    expect(reachSentence(one, { reach: 'own' })).toBe('Only rows of Deals where Owner is this person.');
    expect(reachSentence(one, { reach: 'team', unowned: true })).toBe('Only rows of Deals where Owner is this person, or someone in a team they lead, and rows nobody owns yet.');
    expect(reachSentence(one, { reach: 'own', while: { column: 'state', in: ['won'] } })).toBe('Only rows of Deals where Owner is this person, only while state is won.');
    expect(reachSentence(one, { reach: 'all', while: { column: 'state', in: ['won', 'lost'] } })).toBe('Every row of Deals, only while state is won or lost.');
    expect(reachSentence({ label: 'Follow-ups', ways: [{ kind: 'listing', table: 'main.x', label: 'Crew days', dated: true }] }, { reach: 'own' })).toBe('Only rows of Follow-ups where this person is listed in Crew days on the day.');
    // A reach judged by the parent row's person names that link and column, never the table's own ways or "rows nobody owns".
    expect(reachSentence(one, { reach: 'team', via: 'deal_id', by: 'owner_id', unowned: true })).toBe('Only rows of Deals whose deal_id names them, or someone in a team they lead, in owner_id.');
    expect(reachSentence(one, { reach: 'own', via: 'deal_id', by: 'owner_id' })).toBe('Only rows of Deals whose deal_id names them in owner_id.');
  });
});

describe('what a save of row limits sends', () => {
  it('leaves an untouched table out, takes a limit off with null, and names a table only when it is limited', () => {
    const held = table({ limit: { read: { reach: 'own' } } });
    const wide = table({ ref: 'conn_1/main.quotes', tableId: 'main.quotes', own: false });
    expect(rowLimitsSave(REP_GRANTS, [held, wide], {})).toEqual({ grants: REP_GRANTS, rows: {} });
    expect(rowLimitsSave(REP_GRANTS, [held, wide], { [held.ref]: { read: { reach: 'own' } } }).rows).toEqual({});
    expect(rowLimitsSave(REP_GRANTS, [held, wide], { [held.ref]: null })).toEqual({ grants: REP_GRANTS, rows: { [held.ref]: null } });
    expect(withReach({ read: { reach: 'own' } }, 'read', null)).toBeNull();
    expect(withReach({ read: { reach: 'own' } }, 'update', { reach: 'team' })).toEqual({ read: { reach: 'own' }, update: { reach: 'team' } });
  });

  it('gives a role back no action it no longer holds: a limit for one is dropped, never turned into the grant', () => {
    // Update was unticked in the matrix since; the table still carries a limit for it.
    const lost = table({ granted: { read: true, update: false, delete: false }, limit: { read: { reach: 'own' }, update: { reach: 'own' } } });
    const grants = ['table:conn_1:main.deals:read'];
    const saved = rowLimitsSave(grants, [lost], { [lost.ref]: { read: { reach: 'team' }, update: { reach: 'own' } } });
    expect(saved.grants).toEqual(grants);
    expect(saved.rows).toEqual({ [lost.ref]: { read: { reach: 'team' } } });
    // Nothing held at all: the limit goes, and no grant is made.
    const none = table({ granted: { read: false, update: false, delete: false }, limit: { read: { reach: 'own' } } });
    expect(rowLimitsSave([], [none], { [none.ref]: { read: { reach: 'team' } } })).toEqual({ grants: [], rows: { [none.ref]: null } });
  });
});
