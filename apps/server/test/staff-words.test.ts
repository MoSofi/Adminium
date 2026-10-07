// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT STAFF ARE TOLD OF THE ROWS A SCREEN SHOWS, in an add-on's stock words.
 *
 * The table is asked by its stored name. A caller who reads the add-on's
 * stock tables is given the figure behind the word — the exact count, the
 * batch and its expiry, the line that runs out first; any other caller who
 * reads the table is given what a customer is. Where the rows are also
 * limited a day (a dish's portions) the smaller of the two is the answer.
 * Nothing is kept between two asks, and an add-on that cannot answer is said
 * to have failed — never "in stock".
 */
import { overridesRepo, permissionsRepo, rolesRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { WordsLine } from '../src/crud/ledger-write.js';
import { joinPortions } from '../src/routes/words/index.js';
import { staffWordsReply } from '../src/routes/words/schema.js';
import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from './auth-helpers.js';
import { ledgerKitManifest } from './fixtures/ledger-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';
import { ledgerWorld, type LedgerWorld } from './ledger.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Doc = Record<string, unknown>;

/** The kit, with a second word whose figure is a column of two tables: the accounts and the holds. */
function manifest(): Doc {
  const kit = ledgerKitManifest() as Doc & { addOn: Doc & { ledgers: (Doc & { actions: Record<string, Doc & { locks: Doc[] }> })[]; words: Doc[] } };
  const [units] = kit.addOn.ledgers;
  units!.actions['weigh'] = { ...structuredClone(units!.actions['use']!), locks: [...units!.actions['use']!.locks, { read: 'mine', column: 'id', table: 'holds' }] };
  kit.addOn.words = [...kit.addOn.words, { id: 'units-weighed', ledger: 'units', action: 'weigh', input: 'account', showLeftBelow: { setting: 'show_left_below' } }];
  return kit;
}

describe.each(LEGS)('stock words for staff — %s', (dialect, available) => {
  let w: LedgerWorld;
  let served: Served;
  const cookies = new Map<string, string>();
  const trusted = process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
  const STORED = 'ledger-kit:accounts';
  const ask = (who: string, query: string, words = 'units-left') => served.composed.app.inject({ method: 'GET', url: `/api/v1/words/ledger-kit/${words}${query}`, headers: { cookie: cookies.get(who)! } });
  const lines = async (who: string, ids: string, words = 'units-left', more = '') => {
    const res = await ask(who, `?table=${encodeURIComponent(STORED)}&ids=${ids}${more}`, words);
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: Doc[] }).data;
  };
  const note = (value: Doc | null) => w.h.rows(`UPDATE ledger_kit_settings SET note = ${value === null ? 'NULL' : `'${JSON.stringify(value)}'`}`);

  async function person(name: string, grants: 'super-admin' | string[]): Promise<void> {
    const user = await usersRepo(w.h.meta).create({ email: `${name}@words.dev`, name, passwordHash: await adminPasswordHash() });
    const roles = rolesRepo(w.h.meta);
    if (grants === 'super-admin') await roles.assignToUser(user.id, (await roles.findBySlug('super-admin'))!.id);
    else {
      const role = await roles.create({ slug: `${name}-role`, name } as never);
      for (const table of grants) {
        await permissionsRepo(w.h.meta).grant(role.id, 'table', `${w.h.connectionId}/${w.target(table).table.id}`, { read: true, create: false, update: false, delete: false, export: false, import: false } as never);
      }
      await roles.assignToUser(user.id, role.id);
    }
    const login = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.2.0.${String(cookies.size + 1)}`, payload: { email: `${name}@words.dev`, password: ADMIN_PASSWORD } });
    cookies.set(name, sessionCookie(login.headers['set-cookie']));
  }

  beforeAll(async () => {
    if (!available) return;
    // A dish's portions: servings of an account, counted by the day, as many as the account's own number says.
    const servings = { columns: 'account_id INT NULL, qty INT NULL, on_day DATE NULL, FOREIGN KEY (account_id) REFERENCES ledger_kit_accounts(id)', postings: [] };
    w = await ledgerWorld(dialect, { servings }, manifest(), async (h, idOf) => {
      await overridesRepo(h.meta).create({ connectionId: h.connectionId, op: 'table.capacity', tableName: idOf('servings'), columnName: null, value: { kind: 'parent', via: 'account_id', size: { column: 'max_holds' }, amount: 'qty', day: 'on_day' }, origin: 'user' } as never);
    });
    const row = (id: number, name: string, balance: number, reorder: number, portions: number) => `(${String(id)}, '${name}', ${String(balance)}, 0, ${String(balance)}, ${w.flag(false)}, ${String(reorder)}, ${String(portions)})`;
    // Stock for 8 and 3 portions; stock for 2 and 5 portions; plenty of both; none in stock; none of either.
    await w.h.rows(`INSERT INTO ledger_kit_accounts (id, name, opening, taken, balance, allow_below, reorder_at, max_holds) VALUES ${[row(1, 'Stew', 8, 1, 3), row(2, 'Pie', 2, 1, 5), row(3, 'Bread', 40, 2, 100), row(4, 'Soup', 0, 1, 6), row(5, 'Tart', 4, 4, 100)].join(', ')}`);
    if ((await w.count('ledger_kit_settings')) === 0) await w.h.rows('INSERT INTO ledger_kit_settings (id) VALUES (1)');
    await w.h.rows('UPDATE ledger_kit_settings SET show_left_below = 5');
    process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = 'ledger-kit';
    served = await servePublic(w.h as never, null, { ADMINIUM_DATA_DIR: w.h.dataDir });
    await person('owner', 'super-admin');
    // Reads the accounts — the table asked about, and the one stock table of `units-left` — and not the holds.
    await person('floor', ['ledger_kit_accounts']);
    await person('stock', ['ledger_kit_accounts', 'ledger_kit_holds']);
    await person('clerk', ['servings']);
    // The server loads an add-on's code once it is up: wait for the kit.
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && (await ask('owner', `?table=${encodeURIComponent(STORED)}&ids=3`)).statusCode !== 200) await new Promise((resolve) => setTimeout(resolve, 100));
  }, 240_000);
  afterAll(async () => {
    if (trusted === undefined) delete process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
    else process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = trusted;
    if (!available) return;
    await served?.close();
    await w?.close();
  });

  it.skipIf(!available)('a stock role gets the exact figure, the batch and its expiry, the line that runs out first and whether it expires soon', async () => {
    await note({ words: { '3': { batch: 'LOT-7', expires: '2031-02-01', after: '12.000', first: { item: `Flour ${'x'.repeat(90)}`, unit: 'kg' }, soon: true }, '5': { soon: false } } });
    try {
      const told = await lines('owner', '3,5');
      expect(told).toEqual([
        { id: '3', state: 'in', exact: '40.000', after: '12.000', batch: 'LOT-7', expires: '2031-02-01', cause: 'stock', first: { item: `Flour ${'x'.repeat(74)}`, unit: 'kg' }, soon: true },
        // Low, four left and shown below five: what a customer is told, and the figure behind it. "Not soon" is not said.
        { id: '5', state: 'low', left: 4, exact: '4.000', cause: 'stock' },
      ]);
      expect(staffWordsReply.safeParse({ data: told }).success).toBe(true);
      // The same for a role that reads every stock table of the word.
      expect(await lines('floor', '3,5')).toEqual(told);
      expect(await lines('stock', '3,5', 'units-weighed')).toEqual(told);
    } finally {
      await note(null);
    }
  });

  it.skipIf(!available)('a role without the stock tables gets what a customer is told, and never the line that runs out first', async () => {
    await note({ words: { '3': { batch: 'LOT-7', first: { item: 'Flour', unit: 'kg' }, soon: true } } });
    try {
      // `units-weighed` is a figure of the accounts and the holds: the floor reads the first only.
      const res = await ask('floor', `?table=${encodeURIComponent(STORED)}&ids=3,5,4`, 'units-weighed');
      expect(res.statusCode, res.body).toBe(200);
      expect((res.json() as { data: unknown }).data).toEqual([{ id: '3', state: 'in' }, { id: '5', state: 'low', left: 4 }, { id: '4', state: 'out' }]);
      expect(res.body).not.toMatch(/Flour|LOT-7|exact|soon|cause|40\.000/);
    } finally {
      await note(null);
    }
  });

  it.skipIf(!available)('a dish with 3 portions and stock for 8 answers 3, cause portions; stock for 2 and 5 portions answers 2, cause stock', async () => {
    await note({ words: { '1': { first: { item: 'Beef', unit: 'kg' } }, '2': { first: { item: 'Butter', unit: 'g' } } } });
    try {
      expect(await lines('owner', '1,2')).toEqual([
        // The portions bind: no stock line is what runs out, and none is named.
        { id: '1', state: 'in', exact: '3', cause: 'portions' },
        { id: '2', state: 'in', left: 2, exact: '2.000', cause: 'stock', first: { item: 'Butter', unit: 'g' } },
      ]);
      // Two of the stew's three are served today: one left. All three: out, whatever the shelf holds.
      const today = new Date().toISOString().slice(0, 10);
      await w.h.rows(`INSERT INTO servings (account_id, qty, on_day) VALUES (1, 2, '${today}')`);
      expect(await lines('owner', '1')).toEqual([{ id: '1', state: 'in', exact: '1', cause: 'portions' }]);
      await w.h.rows(`INSERT INTO servings (account_id, qty, on_day) VALUES (1, 1, '${today}')`);
      expect(await lines('owner', '1')).toEqual([{ id: '1', state: 'out', exact: '0', cause: 'portions' }]);
      // Another day's portions are that day's own; and how many are left is said of today only.
      expect(await lines('owner', '1,5', 'units-left', '&date=2031-06-01')).toEqual([
        { id: '1', state: 'in', exact: '3', cause: 'portions' },
        { id: '5', state: 'low', exact: '4.000', cause: 'stock' },
      ]);
      // None in stock is out by its stock, whatever the portions.
      expect(await lines('owner', '4')).toEqual([{ id: '4', state: 'out', exact: '0.000', cause: 'stock' }]);
    } finally {
      await w.h.rows('DELETE FROM servings');
      await note(null);
    }
  });

  it.skipIf(!available)('no read on the table is 403; no session is 401', async () => {
    const res = await ask('clerk', `?table=${encodeURIComponent(STORED)}&ids=3`);
    expect(res.statusCode, res.body).toBe(403);
    expect(res.body).not.toMatch(/40\.000|"state"/);
    const anonymous = await served.composed.app.inject({ method: 'GET', url: `/api/v1/words/ledger-kit/units-left?table=${encodeURIComponent(STORED)}&ids=3` });
    expect(anonymous.statusCode).toBe(401);
  });

  it.skipIf(!available)('the table is asked by its stored name; a name that resolves to nothing, words or an add-on that are not here, and a table the words are not over, are 404', async () => {
    expect((await ask('owner', `?table=${encodeURIComponent(STORED)}&ids=3`)).statusCode).toBe(200);
    for (const [words, table] of [
      ['units-left', 'ledger-kit:nothing'],
      ['units-left', 'gone:accounts'],
      ['no-such-words', STORED],
      // Words over an account are asked of the accounts, and of no other table — the kit's own or the owner's.
      ['units-left', 'ledger-kit:holds'],
      ['units-left', w.target('servings').table.id],
    ] as const) {
      const res = await ask('owner', `?table=${encodeURIComponent(table)}&ids=3`, words);
      expect(res.statusCode, `${words} ${table} ${res.body}`).toBe(404);
    }
    const other = await served.composed.app.inject({ method: 'GET', url: `/api/v1/words/no-such-add-on/units-left?table=${encodeURIComponent(STORED)}&ids=3`, headers: { cookie: cookies.get('owner')! } });
    expect(other.statusCode).toBe(404);
  });

  it.skipIf(!available)('one to sixty rows are asked about; an id that could be no row is left out; any other parameter is refused', async () => {
    const sixtyOne = Array.from({ length: 61 }, (_, index) => String(index + 100)).join(',');
    // A parameter missing, one this route does not take, no row, or too many.
    for (const query of [`?table=${encodeURIComponent(STORED)}`, `?table=${encodeURIComponent(STORED)}&ids=3&under=3`, '?ids=3', `?table=${encodeURIComponent(STORED)}&ids=%20,`, `?table=${encodeURIComponent(STORED)}&ids=${sixtyOne}`]) {
      expect((await ask('owner', query)).statusCode, query).toBe(422);
    }
    expect((await lines('owner', 'abc,3,03,99999999999')).map((line) => line['id'])).toEqual(['3']);
    expect(await lines('owner', 'abc')).toEqual([]);
  });

  it.skipIf(!available)('the staff answer is never kept: two asks hear the shelf twice', async () => {
    expect(await lines('owner', '3')).toEqual([{ id: '3', state: 'in', exact: '40.000', cause: 'stock' }]);
    await w.h.rows('UPDATE ledger_kit_accounts SET balance = 1, opening = 1 WHERE id = 3');
    try {
      expect(await lines('owner', '3')).toEqual([{ id: '3', state: 'low', left: 1, exact: '1.000', cause: 'stock' }]);
    } finally {
      await w.h.rows('UPDATE ledger_kit_accounts SET balance = 40, opening = 40 WHERE id = 3');
    }
  });

  it.skipIf(!available)('an add-on whose code fails is said to have failed: never in stock', async () => {
    await w.misbehave('throw');
    try {
      const res = await ask('owner', `?table=${encodeURIComponent(STORED)}&ids=4`);
      expect(res.statusCode, res.body).toBe(409);
      expect(res.json()).toMatchObject({ error: { code: 'POSTING_REFUSED', details: { reason: 'planner-failed' } } });
    } finally {
      await w.misbehave(null);
    }
  });
});

describe('the stock answer and the day\'s portions, joined', () => {
  const line = (over: Partial<WordsLine> = {}): WordsLine => ({ id: '1', state: 'in', left: '8.000', first: { item: 'Beef', unit: 'kg' }, ...over });
  it('the smaller is what is left, and the answer says which it was', () => {
    expect(joinPortions(line(), 3)).toEqual({ id: '1', state: 'in', left: '8.000', exact: '3', cause: 'portions' });
    expect(joinPortions(line({ left: '2.000', state: 'low' }), 5)).toEqual({ id: '1', state: 'low', left: '2.000', cause: 'stock', first: { item: 'Beef', unit: 'kg' } });
    // Level: the stock is what runs out.
    expect(joinPortions(line({ left: '3.000' }), 3).cause).toBe('stock');
    // The exact figure, where the add-on gives one beside what it shows, is what is compared.
    expect(joinPortions(line({ left: '2.000', exact: '9.500' }), 4)).toMatchObject({ exact: '4', cause: 'portions' });
  });
  it('out when either is none', () => {
    expect(joinPortions(line(), 0)).toMatchObject({ state: 'out', exact: '0', cause: 'portions' });
    expect(joinPortions(line({ left: '0.000', state: 'in' }), 5)).toMatchObject({ state: 'out', cause: 'stock' });
  });
  it('a row with no figure of its own is as many as its portions; with no portions, stock is the cause of anything but in', () => {
    const { left: _left, ...bare } = line();
    expect(joinPortions(bare, 2)).toEqual({ id: '1', state: 'in', exact: '2', cause: 'portions' });
    expect(joinPortions(line(), undefined)).toEqual(line());
    expect(joinPortions(line({ state: 'low' }), undefined).cause).toBe('stock');
    expect(joinPortions(line({ state: 'out', cause: 'portions' }), undefined).cause).toBe('portions');
  });
});
