// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Which rows a person reaches: the test `crud/row-limit.ts`
 * builds, run as SQL on a real database of every engine, for each way a
 * person belongs to a row and each way roles add up.
 *
 * The firm is in `row-limit-world.ts`. Each case names who asks and lists the
 * keys they reach; `'all'` is "nothing limits them" — no SQL was built.
 */
import { apiKeysRepo, manifestsRepo, permissionsRepo, rolesRepo, teamsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { fetchVisible, isRowLimited, rowLimitFor } from '../src/crud/row-limit.js';
import { resolveForRoles, resolvePermissionSet } from '../src/rbac/resolver.js';
import { rowReachesOf } from '../src/rbac/row-limits.js';
import { ENGINES, IN_COVER, world, type World } from './row-limit-world.js';

const OWN = { reach: 'own' } as const;
const TEAM = { reach: 'team' } as const;

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`which rows a person reaches [${dialect}]`, () => {
    let w: World;
    beforeAll(async () => {
      w = await world(dialect);
      await w.role('rep', {
        deals: { actions: ['read', 'create', 'update'], rows: { read: OWN, update: OWN } },
        quotes: { actions: ['read'], rows: { read: OWN } },
        quote_lines: { actions: ['read'], rows: { read: OWN } },
        tickets: { actions: ['read'], rows: { read: OWN } },
        deliveries: { actions: ['read'], rows: { read: OWN } },
        one_to_ones: { actions: ['read', 'update'], rows: { read: OWN, update: OWN } },
      });
      await w.role('manager', {
        deals: { actions: ['read', 'update', 'delete'], rows: { read: TEAM, update: TEAM, delete: { reach: 'team', while: { column: 'state', in: ['lost'] } } } },
        tickets: { actions: ['read'], rows: { read: TEAM } },
        one_to_ones: { actions: ['read', 'update'], rows: { read: OWN, update: OWN } },
      });
      await w.role('inbox', { deals: { actions: ['read'], rows: { read: { reach: 'own', unowned: true } } }, quotes: { actions: ['read'], rows: { read: { reach: 'own', unowned: true } } }, tickets: { actions: ['read'], rows: { read: { reach: 'own', unowned: true } } }, deliveries: { actions: ['read'], rows: { read: { reach: 'own', unowned: true } } } });
      await w.role('accounts', { deals: { actions: ['read'], rows: { read: { reach: 'all', while: { column: 'state', in: ['won'] } } } } });
      await w.role('big', { deals: { actions: ['read'], rows: { read: { reach: 'all', while: { column: 'big', in: [true] } } } } });
      await w.role('reader', { deals: { actions: ['read'] }, one_to_ones: { actions: ['read'] } });
      await w.role('crew', { deliveries: { actions: ['read', 'update'], rows: { read: OWN, update: OWN } } });
      for (const person of ['dana', 'omar', 'sam'] as const) await w.give(person, 'rep');
      await w.give('mara', 'manager');
      await w.give('lena', 'manager');
      await w.give('kim', 'crew');
    }, 120_000);
    afterAll(async () => {
      await w?.close();
    });

    describe('a rep, whose rows are their own', () => {
      it('reaches the rows a staff column names them on, and the ones a listing puts them on', async () => {
        // Dana owns 1 and 2, and is a helper on Lena's deal 5.
        expect(await w.reached(await w.setOf('dana'), 'deals')).toEqual([1, 2, 5]);
        expect(await w.reached(await w.setOf('sam'), 'deals')).toEqual([6, 8]);
      });

      it('reaches a colleague\'s rows on the days they cover for them, and not a day later', async () => {
        const omar = await w.setOf('omar');
        expect(await w.reached(omar, 'deals', 'read', '2026-08-09')).toEqual([3, 4]);
        expect(await w.reached(omar, 'deals', 'read', '2026-08-10')).toEqual([3, 4, 6, 8]);
        expect(await w.reached(omar, 'deals', 'read', IN_COVER)).toEqual([3, 4, 6, 8]);
        expect(await w.reached(omar, 'deals', 'read', '2026-08-21')).toEqual([3, 4, 6, 8]);
        expect(await w.reached(omar, 'deals', 'read', '2026-08-22')).toEqual([3, 4]);
        // The owner column never changed.
        expect(await w.rows('SELECT owner_id FROM deals WHERE id = 6')).toEqual([{ owner_id: w.people.sam }]);
        // A cover with no end runs on.
        expect(await w.reached(await w.setOf('dana'), 'deals', 'read', '2026-08-31')).toEqual([1, 2, 5]);
        expect(await w.reached(await w.setOf('dana'), 'deals', 'read', '2027-01-01')).toEqual([1, 2, 5, 9]);
      });

      it('reaches the rows that hang off a row they reach, two links up', async () => {
        const dana = await w.setOf('dana');
        expect(await w.reached(dana, 'quotes')).toEqual([1, 3]);
        expect(await w.reached(dana, 'quote_lines')).toEqual([1, 3]);
        expect(await w.reached(await w.setOf('omar'), 'quote_lines')).toEqual([2]);
      });

      it('reaches the rows whose link names a row that holds them', async () => {
        expect(await w.reached(await w.setOf('dana'), 'tickets')).toEqual([1]);
        expect(await w.reached(await w.setOf('omar'), 'tickets')).toEqual([2]);
        expect(await w.reached(await w.setOf('sam'), 'tickets')).toEqual([]);
      });

      it('reaches the rows of the crew they are in', async () => {
        expect(await w.reached(await w.setOf('kim'), 'deliveries')).toEqual([1]);
        expect(await w.reached(await w.setOf('sam'), 'deliveries')).toEqual([2]);
        expect(await w.reached(await w.setOf('dana'), 'deliveries')).toEqual([]);
      });

      it('is held for an update as for a read, and for a delete it was never given', async () => {
        const dana = await w.setOf('dana');
        expect(await w.reached(dana, 'deals', 'update')).toEqual([1, 2, 5]);
        // No delete on the role: nothing limits what it does not hold, and the read under it still does.
        expect(await w.reached(dana, 'deals', 'delete')).toEqual([1, 2, 5]);
      });
    });

    describe('a manager, whose rows are their team\'s', () => {
      it('reaches the rows of the people in the team they lead, and what those people reach', async () => {
        // Mara leads North: Dana (1, 2, helper on 5) and Omar (3, 4, covering Sam's 6 and 8).
        expect(await w.reached(await w.setOf('mara'), 'deals')).toEqual([1, 2, 3, 4, 5, 6, 8]);
        expect(await w.reached(await w.setOf('mara'), 'deals', 'read', '2026-08-22')).toEqual([1, 2, 3, 4, 5]);
        expect(await w.reached(await w.setOf('mara'), 'tickets')).toEqual([1, 2]);
      });

      it('does not reach a team they only sit in', async () => {
        // Mara sits in South, which Lena leads: Sam's rows come to Lena.
        expect(await w.reached(await w.setOf('lena'), 'deals')).toEqual([5, 6, 8, 9]);
        expect((await w.setOf('mara')).reach).toEqual({ userId: w.people.mara, ledIds: [w.people.dana, w.people.omar].sort() });
        expect((await w.setOf('lena')).reach?.ledIds).toEqual([w.people.mara, w.people.sam].sort());
        // Lena reaches Mara's OWN rows, because Mara is in her team; Mara owns none.
      });

      it('may delete only what its delete reaches, and only what it reads', async () => {
        expect(await w.reached(await w.setOf('mara'), 'deals', 'delete')).toEqual([4]);
        expect(await w.reached(await w.setOf('lena'), 'deals', 'delete')).toEqual([]);
      });

      it('a change of team shows at the next question', async () => {
        const teams = teamsRepo(w.meta);
        const north = (await teams.findByName('North'))!;
        await teams.removeMember(north.id, w.people.omar);
        expect(await w.reached(await w.setOf('mara'), 'deals')).toEqual([1, 2, 5]);
        await teams.setMember(north.id, w.people.omar, false);
        expect(await w.reached(await w.setOf('mara'), 'deals')).toEqual([1, 2, 3, 4, 5, 6, 8]);
      });

      it('reaches two thousand people\'s rows in one question', async () => {
        const mara = await w.setOf('mara');
        const many = { ...mara, reach: { userId: w.people.mara, ledIds: [...Array.from({ length: 1998 }, (_, i) => `usr_${String(i).padStart(26, '0')}`), w.people.dana, w.people.omar] } };
        expect(await w.reached(many, 'deals')).toEqual([1, 2, 3, 4, 5, 6, 8]);
        expect(await w.reached(many, 'tickets')).toEqual([1, 2]);
        // The ids are named once per way, twice over for an update and its read: bound once each, never written out.
        expect(await w.reached(many, 'deals', 'update')).toEqual([1, 2, 3, 4, 5, 6, 8]);
        const test = rowLimitFor(await w.contextOf(many), w.id('deals'), 'update')!;
        const compiled = w.db.selectFrom(w.id('deals')).select('id').where(test(w.db, 'deals')).compile();
        expect(compiled.parameters.length).toBeLessThan(40);
        // A team of 150 on a table reached six ways, each through a parent reached six ways: written out until the budget, then packed.
        const wide = { ...mara, reach: { userId: w.people.mara, ledIds: [...Array.from({ length: 148 }, (_, i) => `usr_${String(i).padStart(26, '0')}`), w.people.dana, w.people.omar] } };
        const six = Array.from({ length: 6 }, () => ({ column: 'owner_id' }));
        const before = (await w.model()).tables.find((table) => table.id === w.id('deals'))!.belongs!;
        await w.belongs('deals', six);
        await w.belongs('quotes', Array.from({ length: 6 }, () => ({ via: 'deal_id' })));
        await w.belongs('quote_lines', Array.from({ length: 6 }, () => ({ via: 'quote_id' })));
        const lines = rowLimitFor(await w.contextOf({ ...wide, superAdmin: false, rowLimits: { read: [{ limited: [{ grant: `table:${w.connectionId}:${w.id('quote_lines')}:read`, reach: TEAM }], unlimited: new Set() }] } }), w.id('quote_lines'), 'read')!;
        const heavy = w.db.selectFrom(w.id('quote_lines')).select('id').where(lines(w.db, 'quote_lines')).orderBy('id');
        expect(heavy.compile().parameters.length).toBeLessThan(6500);
        expect((await heavy.execute()).map((row) => Number((row as { id: unknown }).id))).toEqual([1, 2]);
        await w.belongs('deals', before.map((way) => ('through' in way ? { through: { ...way.through, table: way.through.table.slice(way.through.table.lastIndexOf('.') + 1) } } : way)) as never);
        await w.belongs('quotes', [{ via: 'deal_id' }]);
        await w.belongs('quote_lines', [{ via: 'quote_id' }]);
        // A list just over the written-out length, and one just under.
        for (const extra of [197, 198, 199, 250]) {
          const some = { ...mara, reach: { userId: w.people.mara, ledIds: [...Array.from({ length: extra }, (_, i) => `usr_${String(i).padStart(26, '0')}`), w.people.dana, w.people.omar] } };
          expect(await w.reached(some, 'deals'), String(extra)).toEqual([1, 2, 3, 4, 5, 6, 8]);
        }
      });
    });

    describe('the rows nobody owns, and only while', () => {
      it('adds the rows no way gives anybody', async () => {
        await w.give('dana', 'inbox');
        const dana = await w.setOf('dana');
        expect(await w.reached(dana, 'deals')).toEqual([1, 2, 5, 7]);
        // Quote 4 hangs off deal 7, which is nobody's; quote 5 hangs off nothing.
        expect(await w.reached(dana, 'quotes')).toEqual([1, 3, 4, 5]);
        // Ticket 3 has no agent; ticket 4 an agent who is no person.
        expect(await w.reached(dana, 'tickets')).toEqual([1, 3, 4]);
        // Delivery 3 has no crew; delivery 4 a crew with nobody in it.
        expect(await w.reached(dana, 'deliveries')).toEqual([3, 4]);
        await w.take('dana', 'inbox');
      });

      it('keeps every row while a value holds, for a role that owns none', async () => {
        await w.give('kim', 'accounts');
        expect(await w.reached(await w.setOf('kim'), 'deals')).toEqual([2, 6, 9]);
        await w.take('kim', 'accounts');
        // A yes/no column, on every engine.
        await w.give('kim', 'big');
        expect(await w.reached(await w.setOf('kim'), 'deals')).toEqual([2, 5, 9]);
        await w.take('kim', 'big');
      });

      it('a value that is not the column\'s kind matches nothing, on every engine', async () => {
        const cases: [string, unknown[]][] = [
          ['state', [0]],
          ['state', [true]],
          ['amount', ['12000']],
          ['amount', [true]],
          ['title', [1]],
          ['nothing', ['x']],
        ];
        for (const [column, values] of cases) {
          await w.role('odd', { deals: { actions: ['read'], rows: { read: { reach: 'all', while: { column, in: values as never } } } } });
          await w.give('kim', 'odd');
          expect(await w.reached(await w.setOf('kim'), 'deals'), `${column} in ${JSON.stringify(values)}`).toEqual([]);
          await w.take('kim', 'odd');
        }
        // A number in a number column is itself.
        await w.role('odd', { deals: { actions: ['read'], rows: { read: { reach: 'all', while: { column: 'amount', in: [9000, 7000] } } } } });
        await w.give('kim', 'odd');
        expect(await w.reached(await w.setOf('kim'), 'deals')).toEqual([7, 8]);
        await w.take('kim', 'odd');
      });
    });

    describe('several roles', () => {
      it('two limited roles: a row either reaches whole, never a blend of their parts', async () => {
        await w.give('dana', 'accounts');
        // Her own (1, 2, 5) or any won deal (2, 6, 9).
        expect(await w.reached(await w.setOf('dana'), 'deals')).toEqual([1, 2, 5, 6, 9]);
        // The update is the rep's alone, and still needs the read.
        expect(await w.reached(await w.setOf('dana'), 'deals', 'update')).toEqual([1, 2, 5]);
        await w.take('dana', 'accounts');
      });

      it('"update own" from one and "read all" from another give read all, update own', async () => {
        await w.give('dana', 'reader');
        const dana = await w.setOf('dana');
        expect(await w.reached(dana, 'deals')).toBe('all');
        expect(await w.reached(dana, 'deals', 'update')).toEqual([1, 2, 5]);
        expect(rowReachesOf(dana, w.connectionId, w.id('deals'), 'read')).toBeNull();
        await w.take('dana', 'reader');
      });

      it('Super Admin is held to nothing but a private table', async () => {
        const owner = await resolvePermissionSet(w.meta, { kind: 'user', id: w.owner.id, label: 'Owner' });
        expect(owner.superAdmin).toBe(true);
        for (const table of ['deals', 'quotes', 'tickets', 'deliveries'] as const) expect(await w.reached(owner, table)).toBe('all');
        expect(isRowLimited(await w.contextOf(owner), w.id('deals'), 'delete')).toBe(false);
      });

      it('a person with no limit pays for no team read, and a set with none builds no SQL', async () => {
        const kim = await w.setOf('kim');
        expect(kim.reach).toEqual({ userId: w.people.kim, ledIds: [] });
        expect(kim.rowLimits?.read).toHaveLength(1);
        expect(kim.rowLimits?.read?.[0]?.limited).toHaveLength(1);
        expect(rowLimitFor(await w.contextOf(kim), w.id('deals'), 'read')).toBeNull();
        expect(rowLimitFor(await w.contextOf(kim), w.id('companies'), 'read')).toBeNull();
      });

      it('a table the model has not reaches nothing, never everything', async () => {
        const dana = await w.contextOf(await w.setOf('dana'));
        const test = rowLimitFor(dana, 'main.nothing', 'read');
        expect(test).not.toBeNull();
        expect(await w.db.selectFrom(w.id('deals')).select('id').where(test!(w.db, 'deals')).execute()).toEqual([]);
        // Asked of somebody nothing limits, too.
        const owner = await w.contextOf(await resolvePermissionSet(w.meta, { kind: 'user', id: w.owner.id, label: 'Owner' }));
        expect(rowLimitFor(owner, 'main.nothing', 'read')).not.toBeNull();
      });

      it('within one role a limit on a table stands over that role\'s own "every table"; another role\'s lifts it', async () => {
        // An editor of everything, whose deals are their own.
        const editor = await rolesRepo(w.meta).create({ slug: 'narrow-editor', name: 'Editor, own deals' });
        await permissionsRepo(w.meta).grant(editor.id, 'table', `${w.connectionId}/*`, { read: true, create: true, update: true, delete: true, export: false, import: false });
        await permissionsRepo(w.meta).grant(editor.id, 'table', `${w.connectionId}/${w.id('deals')}`, { read: true, create: true, update: true, delete: true, export: false, import: false, rowLimit: { read: OWN, update: OWN, delete: OWN } });
        await w.take('dana', 'rep');
        await w.give('dana', 'narrow-editor');
        const dana = await w.setOf('dana');
        expect(await w.reached(dana, 'deals')).toEqual([1, 2, 5]);
        expect(await w.reached(dana, 'deals', 'delete')).toEqual([1, 2, 5]);
        // Every other table is the wide grant's.
        expect(await w.reached(dana, 'quotes')).toBe('all');
        expect(await w.reached(dana, 'tickets')).toBe('all');
        // A second role with every table, and no limit of its own, lifts it.
        const wide = await rolesRepo(w.meta).create({ slug: 'wide', name: 'Wide' });
        await permissionsRepo(w.meta).grant(wide.id, 'table', `${w.connectionId}/*`, { read: true, create: false, update: false, delete: false, export: false, import: false });
        await w.give('dana', 'wide');
        expect(await w.reached(await w.setOf('dana'), 'deals')).toBe('all');
        expect(await w.reached(await w.setOf('dana'), 'deals', 'update')).toEqual([1, 2, 5]);
        await w.take('dana', 'wide');
        await w.take('dana', 'narrow-editor');
        await w.give('dana', 'rep');
      });

      it('actions add up across roles: one role\'s update reaches what another role\'s read shows', async () => {
        // Updates the team's rows but reads only their own; a second role reads the team's.
        await w.role('team-writer', { deals: { actions: ['read', 'update'], rows: { read: OWN, update: TEAM } } });
        await w.role('team-reader', { deals: { actions: ['read'], rows: { read: TEAM } } });
        await w.take('mara', 'manager');
        await w.give('mara', 'team-writer');
        // Alone: the update is the team's, and the read under it her own, of which she has none.
        expect(await w.reached(await w.setOf('mara'), 'deals', 'update')).toEqual([]);
        await w.give('mara', 'team-reader');
        expect(await w.reached(await w.setOf('mara'), 'deals', 'update')).toEqual([1, 2, 3, 4, 5, 6, 8]);
        await w.take('mara', 'team-writer');
        await w.take('mara', 'team-reader');
        await w.give('mara', 'manager');
      });

      it('a role of an app that is switched off limits nothing and grants nothing', async () => {
        const off = await rolesRepo(w.meta).create({ slug: 'offapp-reader', name: 'Off', appKey: 'offapp' });
        await permissionsRepo(w.meta).grant(off.id, 'table', `${w.connectionId}/${w.id('deals')}`, { read: true, create: false, update: false, delete: false, export: false, import: false });
        await manifestsRepo(w.meta, { encrypt: (v) => v, decrypt: (v) => v }).install({ manifestKey: 'offapp', version: '1.0.0', kind: 'app', source: 'file', document: { kind: 'app', key: 'offapp' }, connectionId: w.connectionId, status: 'disabled' });
        await w.give('dana', 'offapp-reader');
        // The plain read is a suspended app's: Dana's limit stands.
        expect(await w.reached(await w.setOf('dana'), 'deals')).toEqual([1, 2, 5]);
        await w.take('dana', 'offapp-reader');
      });
    });

    describe('a private table', () => {
      it('is read by the two people of a row, whatever their roles say', async () => {
        expect(await w.reached(await w.setOf('mara'), 'one_to_ones')).toEqual([1, 3]);
        expect(await w.reached(await w.setOf('dana'), 'one_to_ones')).toEqual([1]);
        expect(await w.reached(await w.setOf('sam'), 'one_to_ones')).toEqual([2]);
        // A role that reads it plainly reads no more of it.
        await w.give('dana', 'reader');
        expect(await w.reached(await w.setOf('dana'), 'one_to_ones')).toEqual([1]);
        await w.take('dana', 'reader');
        // Kim holds no grant on it at all: the test is the same, and is nobody's.
        expect(await w.reached(await w.setOf('kim'), 'one_to_ones')).toEqual([]);
      });

      it('is not opened by Super Admin, nor by a key', async () => {
        const owner = await resolvePermissionSet(w.meta, { kind: 'user', id: w.owner.id, label: 'Owner' });
        expect(await w.reached(owner, 'one_to_ones')).toEqual([]);
        expect(await w.reached(owner, 'one_to_ones', 'update')).toEqual([]);
        expect(await w.reached(owner, 'one_to_ones', 'delete')).toEqual([]);
        const admin = (await rolesRepo(w.meta).findBySlug('super-admin'))!;
        const key = await apiKeysRepo(w.meta).create({ name: 'k', tokenHash: 'h1', prefix: 'adm_sk_1', roleId: admin.id, createdBy: w.owner.id });
        const set = await resolvePermissionSet(w.meta, { kind: 'api-key', id: key.id, label: 'k', roleId: admin.id });
        expect(await w.reached(set, 'one_to_ones')).toEqual([]);
        expect(await w.reached(set, 'deals')).toBe('all');
      });
    });

    describe('a key, and a set that names nobody', () => {
      it('a key whose role is limited reaches no row of that table, the unowned and the "while" included', async () => {
        for (const slug of ['rep', 'inbox', 'accounts']) {
          const role = (await rolesRepo(w.meta).findBySlug(slug))!;
          const key = await apiKeysRepo(w.meta).create({ name: slug, tokenHash: `h-${slug}`, prefix: `adm_sk_${slug}`, roleId: role.id, createdBy: w.owner.id });
          const set = await resolvePermissionSet(w.meta, { kind: 'api-key', id: key.id, label: slug, roleId: role.id });
          expect(set.reach).toEqual({ userId: null, ledIds: [] });
          expect(await w.reached(set, 'deals'), slug).toEqual([]);
        }
        const reader = (await rolesRepo(w.meta).findBySlug('reader'))!;
        expect(await w.reached(await resolvePermissionSet(w.meta, { kind: 'api-key', id: 'key_x', label: 'r', roleId: reader.id }), 'deals')).toBe('all');
      });

      it('roles resolved with no person behind them reach no limited row', async () => {
        const bare = await resolveForRoles(w.meta, [(await rolesRepo(w.meta).findBySlug('rep'))!]);
        expect(bare.reach).toBeUndefined();
        expect(await w.reached(bare, 'deals')).toEqual([]);
      });
    });

    describe('a way that cannot be read reaches nobody', () => {
      const cases: [string, Parameters<World['belongs']>[1]][] = [
        ['a column the table has not', [{ column: 'boss_id' }]],
        ['a column that holds no staff member', [{ column: 'title' }]],
        ['a link that links nothing', [{ column: 'owner_id', person: 'user_id' }]],
        ['a listing in a table that is not there', [{ through: { table: 'helpers' as never, link: 'deal_id', user: 'user_id' } }]],
        ['a listing by a column it has not', [{ through: { table: 'deal_members', link: 'deal', user: 'user_id' } }]],
        ['a listing dated by a column it has not', [{ through: { table: 'covers', link: 'owner_id', on: 'owner_id', user: 'cover_id', to: 'until' } }]],
        ['a listing dated by a column that is no day', [{ through: { table: 'covers', link: 'owner_id', on: 'owner_id', user: 'cover_id', from: 'cover_id' } }]],
        ['a listing matched on a column of another kind', [{ through: { table: 'deal_members', link: 'deal_id', on: 'owner_id', user: 'user_id' } }]],
        ['a parent by a column that is no link', [{ via: 'state' }]],
        ['no way at all', null],
      ];
      for (const [what, ways] of cases) {
        it(what, async () => {
          const before = (await w.model()).tables.find((table) => table.id === w.id('deals'))!.belongs!;
          // `helpers` is not a table: the world maps a listing's table to its id, so name one that maps to nothing.
          await w.belongs('deals', ways === null ? null : ways.map((way) => ('through' in way && (way.through.table as string) === 'helpers' ? way : way))).catch(async () => {
            await w.meta.db.deleteFrom('adminium_schema_overrides').where('op', '=', 'table.belongs' as never).where('tableName', '=', w.id('deals')).execute();
            await w.meta.db
              .insertInto('adminium_schema_overrides')
              .values({ id: `ovr_bad${String(Date.now())}`, connectionId: w.connectionId, op: 'table.belongs', tableName: w.id('deals'), columnName: null, value: JSON.stringify({ ways: [{ through: { table: 'main.helpers', link: 'deal_id', user: 'user_id' } }] }), origin: 'user', llmRunId: null, status: 'active', createdAt: Date.now(), updatedAt: Date.now(), createdBy: null } as never)
              .execute();
          });
          try {
            await w.give('dana', 'inbox');
            const dana = await w.setOf('dana');
            // Nobody belongs, and "nobody owns it" is not true either: the rows are hidden, never shown.
            expect(await w.reached(dana, 'deals')).toEqual([]);
            // A quote hangs off a deal nobody can be shown to reach.
            expect(await w.reached(dana, 'quotes')).toEqual(ways === null ? [5] : [5]);
          } finally {
            await w.take('dana', 'inbox');
            await w.meta.db.deleteFrom('adminium_schema_overrides').where('op', '=', 'table.belongs' as never).where('tableName', '=', w.id('deals')).execute();
            await w.belongs('deals', before.map((way) => ('through' in way ? { through: { ...way.through, table: way.through.table.slice(way.through.table.lastIndexOf('.') + 1) } } : way)) as never);
          }
        });
      }
    });

    describe('a row asked for by its key', () => {
      it('comes back when the person reaches it, and is not there when they do not', async () => {
        const model = await w.model();
        const table = { id: w.id('deals'), name: 'deals', primaryKey: ['id'] } as never;
        const dana = await w.contextOf(await w.setOf('dana'));
        expect(dana.model.tables).toHaveLength(model.tables.length);
        expect(await fetchVisible(dana, w.db, table, { id: 1 }, 'read')).toMatchObject({ id: 1, title: 'Deal 1' });
        expect(await fetchVisible(dana, w.db, table, { id: 5 }, 'update')).toMatchObject({ id: 5 });
        // Omar's deal, and a deal that does not exist: the same answer.
        expect(await fetchVisible(dana, w.db, table, { id: 3 }, 'read')).toBeUndefined();
        expect(await fetchVisible(dana, w.db, table, { id: 999 }, 'read')).toBeUndefined();
        expect(await fetchVisible(dana, w.db, table, { id: 3 }, 'update')).toBeUndefined();
        // Somebody nothing limits reads it as ever.
        const owner = await w.contextOf(await resolvePermissionSet(w.meta, { kind: 'user', id: w.owner.id, label: 'Owner' }));
        expect(await fetchVisible(owner, w.db, table, { id: 3 }, 'read')).toMatchObject({ id: 3 });
      });
    });
  });
}
