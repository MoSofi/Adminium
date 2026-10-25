// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A CHANGE THAT DOES NOT COUNT A LISTING (`notThrough`), against the whole
 * server on every engine: a reach of an update or a delete that names a
 * listing does not make a row the person's by it — on the table itself, or
 * on a row it hangs off (`via`, two links up) — while every other way counts
 * as before. A helper on a colleague's deal reads the deal, its quotes and
 * their lines and visits, and changes none of them, nor adds to them; whoever
 * covers for the deal's owner, and the owner, do as they always did.
 *
 * The firm of `row-limit-world.ts`, with one more deal: Sam's deal 10, which
 * Kim helps on (`deal_members`) and Mara covers Sam for (`covers`, open
 * ended). Under it quote 10, its line 10, and the visits (`via: deal_id`,
 * and their rep's by `rep_id`):
 *
 *   1  deal 10   by Kim   the helper's own visit, made before
 *   2  deal 10   by Sam
 *
 * Every rep reads their own rows (every way), and changes and removes them
 * `notThrough: deal_members`.
 *
 * Then the install: a manifest that says it, with its listing made real.
 */
import { parseDatabaseModel } from '@adminium/engine';
import { overridesRepo, permissionsRepo, rolesRepo, snapshotsRepo, usersRepo, type RowReach, type TableActions } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { applyOverrides } from '../src/connections/effective-schema.js';
import { runIntrospection } from '../src/connections/introspect.js';
import { storedRowLimit } from '../src/apps/manifest-roles.js';
import { rowLimitFor } from '../src/crud/row-limit.js';
import { grantsFromMatrixRows } from '../src/rbac/permissions.js';
import { resolvePermissionSet } from '../src/rbac/resolver.js';
import { installHarness, type Harness } from './app-install-harness.js';
import { ENGINES, world, type PersonName, type World } from './row-limit-world.js';

// The manifest below uses a word read from 0.3.36 on (`rows.notThrough`); until the release this server says 0.3.35.
vi.mock('../src/version.js', async (original) => ({ ...(await original<typeof import('../src/version.js')>()), APP_VERSION: '0.3.36' }));

type Who = PersonName | 'owner';
type Reply = { statusCode: number; body: string };

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`a change that does not count a listing [${dialect}]`, () => {
    let w: World;
    let visits = '';
    let notHelpers: RowReach;
    let repId = '';
    const cookies = new Map<Who, string>();
    const as = async (who: Who): Promise<string> => {
      if (!cookies.has(who)) cookies.set(who, who === 'owner' ? w.owner.cookie : (await w.signIn(who)).cookie);
      return cookies.get(who)!;
    };
    const call = async (who: Who, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown): Promise<Reply> =>
      w.app.inject({ method, url: `/api/v1/${url}`, headers: { cookie: await as(who) }, ...(payload === undefined ? {} : { payload: payload as never }) });
    const data = (path: string): string => `data/${w.connectionId}/${path}`;
    const v = (): string => encodeURIComponent(visits);
    const json = <T = Record<string, unknown>>(res: Reply): T => JSON.parse(res.body) as T;
    const reason = (res: Reply): unknown => json<{ error?: { details?: { reason?: unknown } } }>(res).error?.details?.reason;
    /** A missing row and an unreached one, told apart by nothing but the key. */
    const shape = (res: Reply, key: number): unknown => ({ status: res.statusCode, body: res.body.replace(new RegExp(`\\b${String(key)}\\b`, 'g'), 'KEY').replace(/req_[0-9a-zA-Z]+/g, 'REQ') });
    const ids = (res: Reply): number[] => json<{ data: { id: unknown }[] }>(res).data.map((row) => Number(row.id));

    beforeAll(async () => {
      w = await world(dialect);
      await w.run('CREATE TABLE visits (id INTEGER PRIMARY KEY, deal_id INTEGER, rep_id VARCHAR(36), note VARCHAR(80) NOT NULL, FOREIGN KEY (deal_id) REFERENCES deals(id))');
      await runIntrospection({ manager: w.manager, meta: w.meta, connectionId: w.connectionId });
      visits = (await w.model()).tables.find((table) => table.name === 'visits')!.id;
      const overrides = overridesRepo(w.meta);
      await overrides.create({ connectionId: w.connectionId, op: 'column.staff', tableName: visits, columnName: 'rep_id', value: { staff: true }, origin: 'user' });
      await overrides.create({ connectionId: w.connectionId, op: 'table.belongs', tableName: visits, value: { ways: [{ column: 'rep_id' }, { via: 'deal_id' }] }, origin: 'user' });
      await w.run(`INSERT INTO deals (id, title, owner_id, state, amount, big, company_id) VALUES (10, 'Deal 10', '${w.people.sam}', 'open', 5000, ${dialect === 'postgres' ? 'false' : '0'}, 1)`);
      await w.run(`INSERT INTO deal_members (id, deal_id, user_id) VALUES (10, 10, '${w.people.kim}')`);
      await w.run(`INSERT INTO covers (id, owner_id, cover_id, starts_on, ends_on) VALUES (10, '${w.people.sam}', '${w.people.mara}', '2020-01-01', NULL)`);
      await w.run('INSERT INTO quotes (id, deal_id, total) VALUES (10, 10, 1000)');
      await w.run('INSERT INTO quote_lines (id, quote_id, amount) VALUES (10, 10, 100)');
      await w.run(`INSERT INTO visits (id, deal_id, rep_id, note) VALUES (1, 10, '${w.people.kim}', 'Kim helps Sam'), (2, 10, '${w.people.sam}', 'Sam on his own')`);

      // As an install writes it: the listing by its table's id.
      notHelpers = { reach: 'own', notThrough: w.id('deal_members') };
      const own: RowReach = { reach: 'own' };
      repId = await w.role('rep', {
        deals: { actions: ['read', 'update', 'delete'], rows: { read: own, update: notHelpers, delete: notHelpers } },
        quotes: { actions: ['read', 'create', 'update', 'delete'], rows: { read: own, update: notHelpers, delete: notHelpers } },
        quote_lines: { actions: ['read', 'create', 'update', 'delete'], rows: { read: own, update: notHelpers, delete: [notHelpers] } },
      });
      await permissionsRepo(w.meta).grant(repId, 'table', `${w.connectionId}/${visits}`, { read: true, create: true, update: true, delete: true, export: false, import: false, rowLimit: { read: own, update: { ...notHelpers, by: 'rep_id' }, delete: notHelpers } } as never);
      for (const who of ['kim', 'mara', 'sam'] as const) await w.give(who, 'rep');
    }, 180_000);
    afterAll(async () => {
      await w?.close();
    });

    it('the row test: the helper reads the deal and changes none of it; the cover and the owner change it', async () => {
      const [kim, mara, sam] = [await w.setOf('kim'), await w.setOf('mara'), await w.setOf('sam')];
      expect(await w.reached(kim, 'deals')).toEqual([10]);
      expect(await w.reached(kim, 'deals', 'update')).toEqual([]);
      expect(await w.reached(kim, 'deals', 'delete')).toEqual([]);
      // Two links up: a line of a quote of the deal she helps on.
      expect(await w.reached(kim, 'quotes')).toEqual([10]);
      expect(await w.reached(kim, 'quotes', 'update')).toEqual([]);
      expect(await w.reached(kim, 'quote_lines')).toEqual([10]);
      expect(await w.reached(kim, 'quote_lines', 'delete')).toEqual([]);
      // Mara covers Sam today; Omar's cover of him ended in August.
      expect(await w.reached(mara, 'deals', 'update', '2026-10-25')).toEqual([6, 8, 10]);
      expect(await w.reached(mara, 'quote_lines', 'update', '2026-10-25')).toEqual([10]);
      expect(await w.reached(sam, 'deals', 'update')).toEqual([6, 8, 10]);
      expect(await w.reached(sam, 'quotes', 'update')).toEqual([10]);
    });

    it('as the helper: she reads the deal, its quote, its line and its visits', async () => {
      expect(ids(await call('kim', 'GET', data('deals?order=id.asc')))).toEqual([10]);
      for (const path of ['deals/10', 'quotes/10', 'quote_lines/10', `${v()}/1`, `${v()}/2`]) expect((await call('kim', 'GET', data(path))).statusCode, path).toBe(200);
    });

    it('as the helper: a change or a removal of the deal, its quote and its line is a row that is not there', async () => {
      for (const [path, values] of [
        ['deals', { title: 'Kim was here' }],
        ['quotes', { total: 1 }],
        ['quote_lines', { amount: 1 }],
      ] as const) {
        const refused = await call('kim', 'PATCH', data(`${path}/10`), { values });
        expect(shape(refused, 10), path).toEqual(shape(await call('kim', 'PATCH', data(`${path}/999`), { values }), 999));
        expect((await call('kim', 'DELETE', data(`${path}/10`))).statusCode, path).toBe(404);
      }
      // The deal's button and a batch of it: the same.
      expect((await call('kim', 'POST', data('deals/10/actions/win'), { from: 'open' })).statusCode).toBe(404);
      const batch = await call('kim', 'POST', data('deals/bulk'), { action: 'update', ids: [10], values: { title: 'Batch' } });
      expect(json<{ results: unknown[] }>(batch).results).toEqual([{ id: 10, ok: false, error: 'NOT_FOUND' }]);
      expect(await w.rows('SELECT title, state FROM deals WHERE id = 10')).toEqual([{ title: 'Deal 10', state: 'open' }]);
      expect(await w.rows('SELECT total FROM quotes WHERE id = 10')).toEqual([{ total: 1000 }]);
      expect(await w.rows('SELECT amount FROM quote_lines WHERE id = 10')).toEqual([{ amount: 100 }]);
    });

    it('as the helper: nothing is hung under the deal, even a visit that names her', async () => {
      const quote = await call('kim', 'POST', data('quotes'), { values: { id: 20, deal_id: 10, total: 5 } });
      expect(quote.statusCode, quote.body).toBe(403);
      expect(reason(quote)).toBe('parent-not-theirs');
      const line = await call('kim', 'POST', data('quote_lines'), { values: { id: 20, quote_id: 10, amount: 5 } });
      expect(line.statusCode, line.body).toBe(403);
      expect(reason(line)).toBe('parent-not-theirs');
      // Her own column names her: on the deal she only helps on, that does not make it hers to add.
      const visit = await call('kim', 'POST', data(v()), { values: { id: 20, deal_id: 10, rep_id: w.people.kim, note: 'Kim adds' } });
      expect(visit.statusCode, visit.body).toBe(403);
      expect(reason(visit)).toBe('parent-not-theirs');
      expect(await w.rows(`SELECT id FROM visits WHERE id = 20`)).toEqual([]);
      // …and a visit of hers on no deal is hers, as before.
      const loose = await call('kim', 'POST', data(v()), { values: { id: 21, deal_id: null, rep_id: w.people.kim, note: 'Kim on her own' } });
      expect(loose.statusCode, loose.body).toBeLessThan(300);
      // Moving it under the deal is the same refusal.
      const moved = await call('kim', 'PATCH', data(`${v()}/21`), { values: { deal_id: 10 } });
      expect(moved.statusCode, moved.body).toBe(403);
      expect((await call('kim', 'DELETE', data(`${v()}/21`))).statusCode).toBe(200);
    });

    it('as the helper: her own visit on the deal, made before, she changes and removes; Sam\'s she does not', async () => {
      expect((await call('kim', 'PATCH', data(`${v()}/1`), { values: { note: 'Kim, later' } })).statusCode).toBe(200);
      expect((await call('kim', 'PATCH', data(`${v()}/2`), { values: { note: 'Kim, later' } })).statusCode).toBe(404);
      await w.run(`INSERT INTO visits (id, deal_id, rep_id, note) VALUES (3, 10, '${w.people.kim}', 'Kim, again')`);
      expect((await call('kim', 'DELETE', data(`${v()}/3`))).statusCode).toBe(200);
      expect((await call('kim', 'DELETE', data(`${v()}/2`))).statusCode).toBe(404);
      expect(await w.rows('SELECT id, note FROM visits ORDER BY id')).toEqual([{ id: 1, note: 'Kim, later' }, { id: 2, note: 'Sam on his own' }]);
    });

    it('as the one who covers for the owner, and as the owner: every change and every new row, as before', async () => {
      for (const who of ['mara', 'sam'] as const) {
        expect((await call(who, 'PATCH', data('deals/10'), { values: { title: `By ${who}` } })).statusCode, who).toBe(200);
        expect((await call(who, 'PATCH', data('quotes/10'), { values: { total: 2000 } })).statusCode, who).toBe(200);
        expect((await call(who, 'PATCH', data('quote_lines/10'), { values: { amount: 200 } })).statusCode, who).toBe(200);
        const quote = await call(who, 'POST', data('quotes'), { values: { id: who === 'mara' ? 30 : 31, deal_id: 10, total: 5 } });
        expect(quote.statusCode, quote.body).toBeLessThan(300);
        const visit = await call(who, 'POST', data(v()), { values: { id: who === 'mara' ? 30 : 31, deal_id: 10, rep_id: w.people[who], note: `${who} visits` } });
        expect(visit.statusCode, visit.body).toBeLessThan(300);
      }
      const won = await call('mara', 'POST', data('deals/10/actions/win'), { from: 'open' });
      expect(won.statusCode, won.body).toBe(200);
      expect(await w.rows('SELECT state FROM deals WHERE id = 10')).toEqual([{ state: 'won' }]);
      await w.run(`UPDATE deals SET title = 'Deal 10', state = 'open' WHERE id = 10`);
      await w.run('DELETE FROM visits WHERE id IN (30, 31)');
      await w.run('DELETE FROM quotes WHERE id IN (30, 31)');
    });

    it('the role editor keeps the listing, names it, counts by it, and refuses one the table is not read through', async () => {
      const rows = await call('owner', 'GET', `roles/${repId}/rows`);
      expect(rows.statusCode, rows.body).toBe(200);
      const tables = json<{ tables: { tableId: string; limit: unknown; listings: { table: string; label: string }[] }[] }>(rows).tables;
      const quotes = tables.find((table) => table.tableId === w.id('quotes'))!;
      expect(quotes.limit).toMatchObject({ update: notHelpers });
      expect(quotes.listings.map((one) => one.table).sort()).toEqual([w.id('covers'), w.id('deal_members')].sort());
      const preview = async (reach: RowReach, action = 'update'): Promise<Reply> => call('owner', 'POST', 'roles/rows/preview', { connectionId: w.connectionId, table: w.id('deals'), userId: w.people.kim, action, reach });
      expect(json(await preview(notHelpers))).toMatchObject({ reached: 0 });
      expect(json(await preview({ reach: 'own' }))).toMatchObject({ reached: 1 });
      const wrong = await preview({ reach: 'own', notThrough: w.id('quotes') });
      expect(wrong.statusCode, wrong.body).toBe(422);
      expect(wrong.body).toContain('not-a-listing');
      // The editor's save: the role's grants as they are, and the deals' rows as the dialog sends them back.
      const grants = grantsFromMatrixRows(await permissionsRepo(w.meta).listForRole(repId));
      const ref = `${w.connectionId}/${w.id('deals')}`;
      const save = (rows: Record<string, unknown>): Promise<Reply> => call('owner', 'PUT', `roles/${repId}/permissions`, { grants, rows: { [ref]: rows } });
      // A listing left out of a read: a person listed on a row still reads it.
      const read = await save({ read: notHelpers });
      expect(read.statusCode, read.body).toBe(422);
      expect(read.body).toContain('not-through-read');
      const elsewhere = await save({ read: { reach: 'own' }, update: { reach: 'own', notThrough: w.id('quotes') } });
      expect(elsewhere.statusCode, elsewhere.body).toBe(422);
      expect(elsewhere.body).toContain('not-a-listing');
      // Kept through a save, as the app wrote it.
      const kept = await save({ read: { reach: 'own' }, update: notHelpers, delete: notHelpers });
      expect(kept.statusCode, kept.body).toBe(200);
      const held = (await permissionsRepo(w.meta).find(repId, 'table', ref))!.actions as TableActions;
      expect(held.rowLimit).toEqual({ read: { reach: 'own' }, update: notHelpers, delete: notHelpers });
      expect(await w.reached(await w.setOf('kim'), 'deals', 'update')).toEqual([]);
    });
  });
}

/** The same word written by an app: installed with its listing made real, and held to at once. */
const id = { ref: 'id', type: 'int', role: 'pk' };
const staff = (ref: string) => ({ ref, type: 'text', maxLength: 36, nullable: true, rules: { staff: true } });
const fk = (ref: string, references: string) => ({ ref, type: 'fk', references });
const NOT_HELPERS = { reach: 'own', notThrough: 'deal_members' };

function sales(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'crm',
    name: 'Sales',
    version: '1.0.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'Sales.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.36' },
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'deals', columns: [id, { ref: 'title', type: 'text', maxLength: 80 }, staff('owner_id')], belongs: [{ column: 'owner_id' }, { through: { table: 'deal_members', link: 'deal_id', user: 'user_id' } }] },
        { ref: 'deal_members', columns: [id, fk('deal_id', 'deals'), staff('user_id')] },
        { ref: 'quotes', columns: [id, fk('deal_id', 'deals'), { ref: 'total', type: 'int' }], belongs: [{ via: 'deal_id' }] },
      ],
    },
    pages: [{ ref: 'crm-deals', template: 'page-crud', title: { key: 't', fallback: 'Deals' }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: 'deals' } }],
    roles: [
      {
        key: 'rep',
        name: 'Sales rep',
        permissions: ['table:@deals:read', 'table:@deals:update', 'table:@quotes:read', 'table:@quotes:update', 'page:@crm-deals:view'],
        limits: { deals: { rows: { read: { reach: 'own' }, update: NOT_HELPERS } }, quotes: { rows: { read: { reach: 'own' }, update: [NOT_HELPERS, { reach: 'own', notThrough: ['deal_members'] }] } } },
      },
    ],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  };
}

describe('storedRowLimit', () => {
  it('keeps the listing a reach leaves out, made real, one or several', () => {
    const real = (ref: string): string => `main.crm_${ref}`;
    expect(storedRowLimit({ update: { reach: 'own', notThrough: 'deal_members' }, delete: [{ reach: 'team', notThrough: ['deal_members', 'covers'] }] }, real)).toEqual({
      update: { reach: 'own', notThrough: 'main.crm_deal_members' },
      delete: [{ reach: 'team', notThrough: ['main.crm_deal_members', 'main.crm_covers'] }],
    });
  });
});

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`an app whose rep changes no deal she helps on [${dialect}]`, () => {
    let h: Harness;
    const model = async () => applyOverrides(parseDatabaseModel((await snapshotsRepo(h.meta).latest(h.connectionId))!.schema), await overridesRepo(h.meta).listForConnection(h.connectionId, { status: 'active' }));
    const tableId = async (name: string) => (await model()).tables.find((table) => table.name === name)!.id;
    beforeAll(async () => {
      h = await installHarness(dialect);
    }, 120_000);
    afterAll(async () => {
      await h?.close();
    });

    it('installs the reach with its listing\'s real table, and holds the helper to it', async () => {
      const installed = await h.install(sales());
      expect(installed.statusCode, installed.body).toBe(200);
      const role = (await rolesRepo(h.meta).findBySlug('crm-rep'))!;
      const actionsOf = async (table: string) => (await permissionsRepo(h.meta).find(role.id, 'table', `${h.connectionId}/${await tableId(table)}`))!.actions as TableActions;
      const members = await tableId('crm_deal_members');
      expect((await actionsOf('crm_deals')).rowLimit).toEqual({ read: { reach: 'own' }, update: { reach: 'own', notThrough: members } });
      expect((await actionsOf('crm_quotes')).rowLimit).toEqual({ read: { reach: 'own' }, update: [{ reach: 'own', notThrough: members }, { reach: 'own', notThrough: [members] }] });

      const users = usersRepo(h.meta);
      const dana = await users.create({ email: 'dana@firm.test', name: 'Dana' });
      const leo = await users.create({ email: 'leo@firm.test', name: 'Leo' });
      for (const one of [dana, leo]) await rolesRepo(h.meta).assignToUser(one.id, role.id);
      await h.run(`INSERT INTO crm_deals (id, title, owner_id) VALUES (1, 'Dana''s', '${dana.id}')`);
      await h.run(`INSERT INTO crm_deal_members (id, deal_id, user_id) VALUES (1, 1, '${leo.id}')`);
      await h.run('INSERT INTO crm_quotes (id, deal_id, total) VALUES (1, 1, 10)');
      const { db } = await h.manager.data(h.connectionId);
      const reached = async (who: { id: string; name: string }, table: string, action: 'read' | 'update'): Promise<number[]> => {
        const set = await resolvePermissionSet(h.meta, { kind: 'user', id: who.id, label: who.name });
        const test = rowLimitFor({ set, connectionId: h.connectionId, model: await model(), today: '2026-10-25' }, await tableId(table), action)!;
        return (await db.selectFrom(await tableId(table)).select('id').where(test(db, table)).orderBy('id').execute()).map((row) => Number((row as { id: unknown }).id));
      };
      expect(await reached(leo, 'crm_deals', 'read')).toEqual([1]);
      expect(await reached(leo, 'crm_deals', 'update')).toEqual([]);
      expect(await reached(leo, 'crm_quotes', 'read')).toEqual([1]);
      expect(await reached(leo, 'crm_quotes', 'update')).toEqual([]);
      expect(await reached(dana, 'crm_deals', 'update')).toEqual([1]);
      expect(await reached(dana, 'crm_quotes', 'update')).toEqual([1]);
    });
  });
}
