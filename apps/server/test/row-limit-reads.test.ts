// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A role whose rows are limited, held to it where a person reads a table and
 * where they name one row by its key (plan 67, A1; the matrix's D1, D5, D6,
 * D8–D11, D15, D16, D19–D23 start rows), against the whole server on every
 * engine. People sign in with a password: a rep, a manager, a crew member,
 * and somebody nothing limits.
 *
 * The server's clock is the real one, so the cover that is running is Dana's
 * for Lena (from 2026-09-01, with no end): Dana reaches Lena's deals 5 and 9
 * as well as her own 1 and 2, and Mara, who leads Dana, reaches them too.
 * Omar's cover for Sam ended in August.
 *
 * A row a person does not reach answers EXACTLY as a row that is not there:
 * each case asks for a colleague's row and for key 999 and compares the two
 * answers, status and body.
 */
import { permissionsRepo, rolesRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ENGINES, world, type PersonName, type World } from './row-limit-world.js';

const OWN = { reach: 'own' } as const;
const TEAM = { reach: 'team' } as const;

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`a limited person reads a table [${dialect}]`, () => {
    let w: World;
    const cookies = new Map<PersonName | 'owner', string>();
    const as = async (who: PersonName | 'owner'): Promise<string> => {
      if (!cookies.has(who)) cookies.set(who, who === 'owner' ? w.owner.cookie : (await w.signIn(who)).cookie);
      return cookies.get(who)!;
    };
    const call = async (who: PersonName | 'owner', method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, payload?: Record<string, unknown>) =>
      w.app.inject({ method, url: `/api/v1/data/${w.connectionId}/${path}`, headers: { cookie: await as(who) }, ...(payload === undefined ? {} : { payload }) });
    const ids = (body: string): number[] => (JSON.parse(body) as { data: { id: number }[] }).data.map((row) => Number(row.id));
    /** The answer with what differs between two requests taken out: the request's own id, and the key asked for. */
    const shape = (res: { statusCode: number; body: string }, key: number): unknown => ({ status: res.statusCode, body: res.body.replace(/req_[0-9a-f]{8}/g, 'req_x').replaceAll(`"${String(key)}"`, '"K"').replace(new RegExp(`\\b${String(key)}\\b`, 'g'), 'K') });

    beforeAll(async () => {
      w = await world(dialect);
      await w.role('rep', {
        deals: { actions: ['read', 'create', 'update', 'delete'], rows: { read: OWN, update: OWN, delete: OWN } },
        quotes: { actions: ['read'], rows: { read: OWN } },
        companies: { actions: ['read'] },
        tags: { actions: ['read'] },
        deal_tags: { actions: ['read'] },
      });
      await w.role('manager', { deals: { actions: ['read', 'update'], rows: { read: TEAM, update: TEAM } }, companies: { actions: ['read'] } });
      await w.role('crew', { deliveries: { actions: ['read'], rows: { read: OWN } } });
      await w.role('reader', { deals: { actions: ['read', 'update', 'delete'] }, quotes: { actions: ['read'] }, tags: { actions: ['read'] }, deal_tags: { actions: ['read'] } });
      // Moves an open deal along, and nothing else: a limit on what the update writes, beside which rows it reaches.
      const mover = await rolesRepo(w.meta).create({ slug: 'mover', name: 'Mover' });
      await permissionsRepo(w.meta).grant(mover.id, 'table', `${w.connectionId}/${w.id('deals')}`, {
        read: true,
        create: false,
        update: true,
        delete: false,
        export: false,
        import: false,
        updateLimit: { writable: ['state'], writableFrom: { state: ['open'] } },
        rowLimit: { read: OWN, update: OWN },
      });
      for (const person of ['dana', 'omar'] as const) await w.give(person, 'rep');
      await w.give('mara', 'manager');
      await w.give('kim', 'crew');
      await w.give('lena', 'reader');
      await w.give('sam', 'mover');
    }, 120_000);
    afterAll(async () => {
      await w?.close();
    });

    describe('a list', () => {
      it('is the rows the person reaches, and says how many those are', async () => {
        const dana = await call('dana', 'GET', 'deals?order=id.asc');
        expect(dana.statusCode, dana.body).toBe(200);
        expect(ids(dana.body)).toEqual([1, 2, 5, 9]);
        expect((JSON.parse(dana.body) as { page: { total: number } }).page.total).toBe(4);
        expect(ids((await call('mara', 'GET', 'deals?order=id.asc')).body)).toEqual([1, 2, 3, 4, 5, 9]);
        expect(ids((await call('omar', 'GET', 'deals?order=id.asc')).body)).toEqual([3, 4]);
        expect(ids((await call('kim', 'GET', 'deliveries?order=id.asc')).body)).toEqual([1]);
        // Nothing limits Lena or the owner: all nine, as ever.
        expect(ids((await call('lena', 'GET', 'deals?order=id.asc')).body)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
        expect(ids((await call('owner', 'GET', 'deals?order=id.asc')).body)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
      });

      it('is narrowed by a filter and a search of the person\'s own, never widened by one', async () => {
        const where = (filter: unknown) => `deals?order=id.asc&where=${encodeURIComponent(JSON.stringify(filter))}`;
        const is = (column: string, op: string, value: unknown) => ({ column, op, value });
        expect(ids((await call('dana', 'GET', where(is('state', 'eq', 'open')))).body)).toEqual([1, 5]);
        // A filter that names a colleague's row, an "or" that would take every row: still her four at most.
        expect(ids((await call('dana', 'GET', where(is('id', 'eq', 3)))).body)).toEqual([]);
        expect(ids((await call('dana', 'GET', where({ or: [is('id', 'eq', 3), is('id', 'gte', 1)] }))).body)).toEqual([1, 2, 5, 9]);
        expect(ids((await call('dana', 'GET', where({ or: [is('id', 'eq', 3), is('id', 'eq', 6)] }))).body)).toEqual([]);
        expect(ids((await call('dana', 'GET', where(is('id', 'neq', 1)))).body)).toEqual([2, 5, 9]);
        expect(ids((await call('dana', 'GET', where(is('owner_id', 'eq', w.people.omar)))).body)).toEqual([]);
        const searched = await call('dana', 'GET', 'deals?order=id.asc&q=Deal');
        expect(ids(searched.body)).toEqual([1, 2, 5, 9]);
        expect((JSON.parse(searched.body) as { page: { total: number } }).page.total).toBe(4);
        expect(ids((await call('dana', 'GET', 'deals?q=Deal%203')).body)).toEqual([]);
      });

      it('counts only her rows whichever count is asked for, and pages by key within them', async () => {
        for (const count of ['exact', 'estimated'] as const) {
          const res = await call('dana', 'GET', `deals?order=id.asc&count=${count}&limit=2`);
          expect(ids(res.body)).toEqual([1, 2]);
          expect((JSON.parse(res.body) as { page: { total: number } }).page.total, count).toBe(4);
        }
        const first = await call('dana', 'GET', 'deals?order=id.asc&cursor=&limit=2');
        expect(ids(first.body)).toEqual([1, 2]);
        const next = (JSON.parse(first.body) as { cursor: { next: string } }).cursor.next;
        const second = await call('dana', 'GET', `deals?order=id.asc&limit=2&cursor=${encodeURIComponent(next)}`);
        expect(ids(second.body)).toEqual([5, 9]);
        expect((JSON.parse(second.body) as { cursor: { next: string | null } }).cursor.next).toBeNull();
        // Offset past her rows is an empty page, not a colleague's.
        expect(ids((await call('dana', 'GET', 'deals?order=id.asc&offset=4')).body)).toEqual([]);
        // With no count asked for, the page is the same and nothing is counted.
        const bare = await call('dana', 'GET', 'deals?order=id.asc&count=none');
        expect(ids(bare.body)).toEqual([1, 2, 5, 9]);
        expect((JSON.parse(bare.body) as { page: { total: number | null } }).page.total).toBeNull();
      });

      it('a table that hangs off a limited one is read through it', async () => {
        expect(ids((await call('dana', 'GET', 'quotes?order=id.asc')).body)).toEqual([1, 3]);
        expect(ids((await call('lena', 'GET', 'quotes?order=id.asc')).body)).toEqual([1, 2, 3, 4, 5]);
      });
    });

    describe('one row, asked for by its key', () => {
      /** The id of the link from a deal to its tags, through `deal_tags`. */
      const tagsLink = async (): Promise<string> => {
        const model = await w.model();
        const link = model.relations.find((relation) => relation.through !== null && relation.from.tableId === w.id('deals') && relation.to.tableId === w.id('tags'));
        expect(link, JSON.stringify(model.relations.filter((relation) => relation.through !== null))).toBeDefined();
        return link!.id;
      };
      const READS: [string, (key: number) => string | Promise<string>][] = [
        ['the record', (key) => `deals/${String(key)}`],
        ['its history', (key) => `deals/${String(key)}/history`],
        ['what points at it', (key) => `deals/${String(key)}/references`],
        ['its sign-in lock', (key) => `deals/${String(key)}/claim-lock`],
        ['its linked rows', async (key) => `deals/${String(key)}/links/${encodeURIComponent(await tagsLink())}`],
      ];
      for (const [what, path] of READS) {
        it(`${what}: a colleague's row answers as a row that is not there`, async () => {
          const theirs = await call('dana', 'GET', await path(3));
          const missing = await call('dana', 'GET', await path(999));
          expect(shape(theirs, 3)).toEqual(shape(missing, 999));
          expect(theirs.statusCode, `${what}: ${theirs.body}`).toBe(404);
          // Her own row answers as it does for somebody nothing limits, and that is an answer.
          const mine = await call('dana', 'GET', await path(1));
          const whole = await call('lena', 'GET', await path(1));
          expect(mine.statusCode).toBe(whole.statusCode);
          if (what !== 'its linked rows' || (await w.setOf('lena')).grants.has(`table:${w.connectionId}:${w.id('tags')}:read`)) expect(mine.statusCode, `${what}: ${mine.body}`).toBe(200);
          // Somebody nothing limits reads the colleague's row too: it is there.
          expect((await call('lena', 'GET', await path(3))).statusCode).toBe(whole.statusCode);
          if (what === 'the record') {
            expect(theirs.statusCode).toBe(404);
            expect(mine.statusCode).toBe(200);
            expect((JSON.parse(mine.body) as { data: { title: string } }).data.title).toBe('Deal 1');
            expect(mine.body).toBe(whole.body.replace(/req_[0-9a-f]{8}/g, (id) => id));
          }
        });
      }

      it('a manager reaches a row of their team by its key, and not one of a team they sit in', async () => {
        expect((await call('mara', 'GET', 'deals/3')).statusCode).toBe(200);
        // Sam is in South, where Mara sits and Lena leads.
        expect(shape(await call('mara', 'GET', 'deals/6'), 6)).toEqual(shape(await call('mara', 'GET', 'deals/999'), 999));
      });

      it('a crew member reads their crew\'s delivery and not another crew\'s', async () => {
        expect((await call('kim', 'GET', 'deliveries/1')).statusCode).toBe(200);
        expect(shape(await call('kim', 'GET', 'deliveries/2'), 2)).toEqual(shape(await call('kim', 'GET', 'deliveries/999'), 999));
      });
    });

    describe('one row, named to be changed', () => {
      const WRITES: [string, 'PATCH' | 'DELETE' | 'POST', (key: number) => string, Record<string, unknown> | undefined][] = [
        ['a change', 'PATCH', (key) => `deals/${String(key)}`, { values: { title: 'Mine now' } }],
        ['a change tried without saving', 'POST', (key) => `deals/${String(key)}/dry-run`, { values: { title: 'Mine now' } }],
        ['a delete', 'DELETE', (key) => `deals/${String(key)}?confirm=true`, undefined],
        ['a delete tried without deleting', 'DELETE', (key) => `deals/${String(key)}?dryRun=true`, undefined],
        ['a new code', 'POST', (key) => `deals/${String(key)}/regenerate-code`, { column: 'ref_code' }],
        ['a lock cleared', 'DELETE', (key) => `deals/${String(key)}/claim-lock`, undefined],
        ['a button of the record', 'POST', (key) => `deals/${String(key)}/actions/win`, { from: 'open' }],
      ];
      for (const [what, method, path, payload] of WRITES) {
        it(`${what}: a colleague's row answers as a row that is not there, and is not touched`, async () => {
          const before = await w.rows('SELECT id, title, owner_id, state FROM deals ORDER BY id');
          await w.run('UPDATE deals SET ref_code = NULL');
          const theirs = await call('dana', method, path(3), payload);
          const missing = await call('dana', method, path(999), payload);
          expect(shape(theirs, 3), theirs.body).toEqual(shape(missing, 999));
          expect(theirs.statusCode, `${what}: ${theirs.body}`).toBe(404);
          expect(await w.rows('SELECT id, title, owner_id, state, ref_code FROM deals ORDER BY id')).toEqual(before.map((row) => ({ ...row, ref_code: null })));
        });
      }

      it('each of them reaches her own row: the refusals above are the row\'s, not the route\'s', async () => {
        expect((await call('dana', 'POST', 'deals/1/dry-run', { values: { title: 'Tried' } })).statusCode).toBe(200);
        expect((await call('dana', 'DELETE', 'deals/1?dryRun=true')).statusCode).toBe(200);
        const coded = await call('dana', 'POST', 'deals/1/regenerate-code', { column: 'ref_code' });
        expect(coded.statusCode, coded.body).toBe(200);
        expect(String((JSON.parse(coded.body) as { data: { ref_code: string } }).data.ref_code)).toHaveLength(8);
        expect((await call('dana', 'DELETE', 'deals/1/claim-lock')).statusCode).toBe(200);
        const won = await call('dana', 'POST', 'deals/1/actions/win', { from: 'open' });
        expect(won.statusCode, won.body).toBe(200);
        expect((JSON.parse(won.body) as { data: { state: string } }).data.state).toBe('won');
        await w.run(`UPDATE deals SET state = 'open', ref_code = NULL WHERE id = 1`);
      });

      it('a delete that reaches every row is still held to what the person reads', async () => {
        // Deletes any deal, reads only their own: a row out of sight is not theirs to remove.
        await w.role('sweeper', { deals: { actions: ['read', 'delete'], rows: { read: OWN } } });
        await w.give('kim', 'sweeper');
        expect(shape(await call('kim', 'DELETE', 'deals/3?confirm=true'), 3)).toEqual(shape(await call('kim', 'DELETE', 'deals/999?confirm=true'), 999));
        expect(await w.rows('SELECT id FROM deals WHERE id = 3')).toHaveLength(1);
        await w.take('kim', 'sweeper');
      });

      it('a role that may change its own rows and delete none is refused the delete, the same for every key', async () => {
        const answers = await Promise.all([3, 8, 999].map(async (key) => shape(await call('sam', 'DELETE', `deals/${String(key)}?confirm=true`), key)));
        expect(answers[0]).toEqual(answers[2]);
        expect(answers[1]).toEqual(answers[2]);
        expect((answers[0] as { status: number }).status).toBe(403);
      });

      it('a row handed to somebody else between the read and the write is not written', async () => {
        const { rowRefinement } = await import('../src/crud/row-limit.js');
        const { updateRows, deleteRows } = await import('../src/crud/write-service.js');
        const ctx = await w.contextOf(await w.setOf('dana'));
        const view = { id: w.id('deals'), name: 'deals', primaryKey: ['id'], columns: new Map() } as never;
        // The statement itself carries the test: her own row is written, Omar's is not.
        const refine = rowRefinement(ctx, w.db, view, 'update');
        expect(refine).toBeDefined();
        expect(await updateRows(w.db, dialect, view, { title: 'Hers' } as never, { id: 1 }, refine as never)).toBe(1);
        expect(await updateRows(w.db, dialect, view, { title: 'Not hers' } as never, { id: 3 }, refine as never)).toBe(0);
        expect(await deleteRows(w.db, view, { id: 3 }, rowRefinement(ctx, w.db, view, 'delete') as never)).toBe(0);
        expect(await w.rows('SELECT title FROM deals WHERE id IN (1, 3) ORDER BY id')).toEqual([{ title: 'Hers' }, { title: 'Deal 3' }]);
        await w.run(`UPDATE deals SET title = 'Deal 1' WHERE id = 1`);
        // Nothing limits the owner: no condition is added.
        expect(rowRefinement(null, w.db, view, 'update')).toBeUndefined();
      });

      it('"not there" comes before "your role may not change that": a row out of reach is never told apart by what the role may write', async () => {
        // Sam moves his own open deals along. Deal 6 is his and won: the role's own refusal.
        const own = await call('sam', 'PATCH', 'deals/6', { values: { state: 'lost' } });
        expect(own.statusCode, own.body).toBe(403);
        expect((JSON.parse(own.body) as { error: { code: string } }).error.code).toBe('COLUMN_FORBIDDEN');
        // Deal 2 is Dana's and won, deal 1 Dana's and open: both simply are not there.
        for (const key of [1, 2]) expect(shape(await call('sam', 'PATCH', `deals/${String(key)}`, { values: { state: 'lost' } }), key)).toEqual(shape(await call('sam', 'PATCH', 'deals/999', { values: { state: 'lost' } }), 999));
        // A column his role may not write, on a row out of reach: the same again, not a 403 about the column.
        expect(shape(await call('sam', 'PATCH', 'deals/1', { values: { title: 'x' } }), 1)).toEqual(shape(await call('sam', 'PATCH', 'deals/999', { values: { title: 'x' } }), 999));
        // His own open deal moves.
        const moved = await call('sam', 'PATCH', 'deals/8', { values: { state: 'won' } });
        expect(moved.statusCode, moved.body).toBe(200);
        await w.run(`UPDATE deals SET state = 'open' WHERE id = 8`);
      });

      it('her own row is changed and deleted as ever', async () => {
        const changed = await call('dana', 'PATCH', 'deals/1', { values: { title: 'Deal one' } });
        expect(changed.statusCode, changed.body).toBe(200);
        expect((JSON.parse(changed.body) as { data: { title: string } }).data.title).toBe('Deal one');
        await w.run(`UPDATE deals SET title = 'Deal 1' WHERE id = 1`);
        // A manager changes a row of their team.
        const managed = await call('mara', 'PATCH', 'deals/3', { values: { title: 'Deal three' } });
        expect(managed.statusCode, managed.body).toBe(200);
        await w.run(`UPDATE deals SET title = 'Deal 3' WHERE id = 3`);
      });
    });

    describe('a private table', () => {
      it('is read by its two people through the routes, and by nobody else: the owner of the workspace lists none and finds none', async () => {
        await w.role('one-to-one', { one_to_ones: { actions: ['read', 'update'], rows: { read: OWN, update: OWN } } });
        await w.give('mara', 'one-to-one');
        await w.give('dana', 'one-to-one');
        expect(ids((await call('mara', 'GET', 'one_to_ones?order=id.asc')).body)).toEqual([1, 3]);
        expect(ids((await call('dana', 'GET', 'one_to_ones?order=id.asc')).body)).toEqual([1]);
        expect((await call('dana', 'GET', 'one_to_ones/1')).statusCode).toBe(200);
        expect(shape(await call('dana', 'GET', 'one_to_ones/2'), 2)).toEqual(shape(await call('dana', 'GET', 'one_to_ones/999'), 999));
        const owner = await call('owner', 'GET', 'one_to_ones?order=id.asc');
        expect(owner.statusCode, owner.body).toBe(200);
        expect(ids(owner.body)).toEqual([]);
        expect((JSON.parse(owner.body) as { page: { total: number } }).page.total).toBe(0);
        expect(shape(await call('owner', 'GET', 'one_to_ones/1'), 1)).toEqual(shape(await call('owner', 'GET', 'one_to_ones/999'), 999));
        expect(shape(await call('owner', 'PATCH', 'one_to_ones/1', { values: { note: 'Read by the owner' } }), 1)).toEqual(shape(await call('owner', 'PATCH', 'one_to_ones/999', { values: { note: 'Read by the owner' } }), 999));
        expect(shape(await call('owner', 'DELETE', 'one_to_ones/1?confirm=true'), 1)).toEqual(shape(await call('owner', 'DELETE', 'one_to_ones/999?confirm=true'), 999));
        expect(await w.rows('SELECT note FROM one_to_ones WHERE id = 1')).toEqual([{ note: 'Dana, August' }]);
        // One of the two changes it.
        const changed = await call('mara', 'PATCH', 'one_to_ones/1', { values: { note: 'Dana, September' } });
        expect(changed.statusCode, changed.body).toBe(200);
        await w.run(`UPDATE one_to_ones SET note = 'Dana, August' WHERE id = 1`);
      });
    });

    describe('a key', () => {
      it('with a limited role lists no row and finds none by key; with a plain role reads as ever', async () => {
        const { apiKeysRepo } = await import('@adminium/meta');
        const { generateApiKey } = await import('../src/rbac/api-keys.js');
        const mint = async (slug: string): Promise<string> => {
          const role = (await rolesRepo(w.meta).findBySlug(slug))!;
          const token = generateApiKey();
          await apiKeysRepo(w.meta).create({ name: slug, tokenHash: token.tokenHash, prefix: token.prefix, roleId: role.id, createdBy: w.owner.id });
          return token.key;
        };
        const get = (token: string, path: string) => w.app.inject({ method: 'GET', url: `/api/v1/data/${w.connectionId}/${path}`, headers: { authorization: `Bearer ${token}` } });
        const rep = await mint('rep');
        const listed = await get(rep, 'deals');
        expect(listed.statusCode, listed.body).toBe(200);
        expect(ids(listed.body)).toEqual([]);
        expect((JSON.parse(listed.body) as { page: { total: number } }).page.total).toBe(0);
        expect((await get(rep, 'deals/1')).statusCode).toBe(404);
        // A table the role does not limit is read whole.
        expect(ids((await get(rep, 'companies?order=id.asc')).body)).toEqual([1, 2]);
        const reader = await mint('reader');
        expect(ids((await get(reader, 'deals?order=id.asc')).body)).toHaveLength(9);
        expect((await get(reader, 'deals/1')).statusCode).toBe(200);
      });
    });
  });
}
