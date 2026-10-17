// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHO ADDS SOMEBODY TO A DEAL, AND WHO MAY BE ADDED.
 *
 * The people on a deal are a way to reach it. Until now anybody who reached
 * a deal could list anybody on it: a helper added a third colleague, and
 * whoever covered for the owner added herself on the last day of the cover
 * and kept the deal for good. The owner could not undo either, since a row
 * of the listing belonged to whoever made it.
 *
 * Two things hold that. A listing's rows are the deal's owner's (a staff
 * column kept as a copy of the deal's, named in `belongs`): the row is hung
 * only under a deal that names its writer or somebody they lead, and its
 * owner removes any of them. And a listing names only somebody who reads a
 * table the listing opens.
 */
import { overridesRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ENGINES, world, type PersonName, type World } from './row-limit-world.js';

const OWN = { reach: 'own' } as const;
const TEAM = { reach: 'team' } as const;

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`who adds to a listing, and who is added [${dialect}]`, () => {
    let w: World;
    const cookies = new Map<PersonName, string>();
    const as = async (who: PersonName): Promise<string> => {
      if (!cookies.has(who)) cookies.set(who, (await w.signIn(who)).cookie);
      return cookies.get(who)!;
    };
    type Reply = { statusCode: number; body: string };
    const call = async (who: PersonName | 'owner', method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, payload?: Record<string, unknown>): Promise<Reply> =>
      w.app.inject({ method, url: `/api/v1/data/${w.connectionId}/${path}`, headers: { cookie: who === 'owner' ? w.owner.cookie : await as(who) }, ...(payload === undefined ? {} : { payload }) });
    const members = (): string => w.id('deal_members');
    const add = (who: PersonName | 'owner', id: number, deal: number, person: PersonName): Promise<Reply> => call(who, 'POST', members(), { values: { id, deal_id: deal, user_id: w.people[person] } });
    const one = async (statement: string): Promise<Record<string, unknown> | undefined> => (await w.rows(statement))[0];
    const count = async (): Promise<number> => Number((await one('SELECT COUNT(*) AS n FROM deal_members'))!['n']);
    const reason = (res: Reply): unknown => (JSON.parse(res.body) as { error?: { details?: { reason?: unknown } } }).error?.details?.reason;
    const field = (res: Reply, column: string): unknown => (JSON.parse(res.body) as { error?: { details?: { fields?: Record<string, { code?: unknown }> } } }).error?.details?.fields?.[column]?.code;

    beforeAll(async () => {
      w = await world(dialect);
      const overrides = overridesRepo(w.meta);
      // A member's row says whose deal it is on, kept as the deal's owner changes.
      await overrides.create({ connectionId: w.connectionId, op: 'column.staff', tableName: members(), columnName: 'deal_owner_id', value: { staff: true }, origin: 'user' });
      await overrides.create({ connectionId: w.connectionId, op: 'column.copy', tableName: members(), columnName: 'deal_owner_id', value: { via: 'deal_id', from: 'owner_id', mode: 'always', follow: true }, origin: 'user' } as never);
      await w.belongs('deal_members', [{ column: 'deal_owner_id', set: 'team' }]);
      await w.run(`UPDATE deal_members SET deal_owner_id = (SELECT owner_id FROM deals WHERE deals.id = deal_members.deal_id)`);
      const listing = { actions: ['read', 'create', 'update', 'delete'] as ('read' | 'create' | 'update' | 'delete')[] };
      await w.role('rep', { deals: { actions: ['read', 'create', 'update'], rows: { read: OWN, update: OWN } }, deal_members: { ...listing, rows: { update: OWN, delete: OWN } } });
      await w.role('manager', { deals: { actions: ['read', 'create', 'update'], rows: { read: TEAM, update: TEAM } }, deal_members: { ...listing, rows: { update: TEAM, delete: TEAM } } });
      // Holds every deal and every listing, limited by nothing.
      await w.role('editor', { deals: { actions: ['read', 'create', 'update'] }, deal_members: listing });
      // Reads companies and no deal.
      await w.role('desk', { companies: { actions: ['read'] } });
      for (const person of ['dana', 'omar', 'sam'] as const) await w.give(person, 'rep');
      await w.give('mara', 'manager');
      await w.give('lena', 'editor');
      await w.give('kim', 'desk');
    }, 120_000);
    afterAll(async () => {
      await w?.close();
    });

    describe('a row of the listing is the deal\'s owner\'s', () => {
      it('is added by the deal\'s owner, and says whose deal it is on without being told', async () => {
        const added = await add('dana', 10, 1, 'omar');
        expect(added.statusCode, added.body).toBe(201);
        expect(await one('SELECT deal_owner_id FROM deal_members WHERE id = 10')).toEqual({ deal_owner_id: w.people.dana });
      });

      it('is not added by a helper on a colleague\'s deal', async () => {
        // Dana is listed on deal 5, Lena's: she reads it, works on it, and lists nobody on it.
        const before = await count();
        const refused = await add('dana', 11, 5, 'omar');
        expect(refused.statusCode, refused.body).toBe(403);
        expect(reason(refused)).toBe('parent-not-theirs');
        expect(await count()).toBe(before);
      });

      it('is not added by whoever covers for the owner, herself included', async () => {
        // Dana covers Lena with no end: deal 9 is on her desk, and stays Lena's.
        const before = await count();
        for (const person of ['dana', 'omar'] as const) {
          const refused = await add('dana', 12, 9, person);
          expect(refused.statusCode, refused.body).toBe(403);
          expect(reason(refused)).toBe('parent-not-theirs');
        }
        expect(await count()).toBe(before);
      });

      it('is added by whoever leads the owner, and to no deal of a team she only sits in', async () => {
        const led = await add('mara', 13, 3, 'dana');
        expect(led.statusCode, led.body).toBe(201);
        expect(await one('SELECT deal_owner_id FROM deal_members WHERE id = 13')).toEqual({ deal_owner_id: w.people.omar });
        // Deal 8 is Sam's, of South: Mara sits there and leads nobody.
        const before = await count();
        expect((await add('mara', 14, 8, 'dana')).statusCode).toBeGreaterThanOrEqual(400);
        expect(await count()).toBe(before);
      });

      it('is removed by the deal\'s owner whoever added it, and by no helper', async () => {
        // Mara lists Sam on Dana's deal 1; Omar is on it since the first test.
        expect((await add('mara', 15, 1, 'sam')).statusCode).toBe(201);
        expect((await call('omar', 'DELETE', `${members()}/15`)).statusCode).toBeGreaterThanOrEqual(400);
        expect((await call('sam', 'DELETE', `${members()}/10`)).statusCode).toBeGreaterThanOrEqual(400);
        expect(await one('SELECT id FROM deal_members WHERE id = 15')).toEqual({ id: 15 });
        const removed = await call('dana', 'DELETE', `${members()}/15`);
        expect(removed.statusCode, removed.body).toBeLessThan(300);
        expect(await one('SELECT id FROM deal_members WHERE id = 15')).toBeUndefined();
      });

      it('is moved only under another deal that is its writer\'s', async () => {
        // Row 10 is on Dana's deal 1. Deal 2 is hers too; deal 5 is Lena's, where she only helps.
        const moved = await call('dana', 'PATCH', `${members()}/10`, { values: { deal_id: 2 } });
        expect(moved.statusCode, moved.body).toBe(200);
        const refused = await call('dana', 'PATCH', `${members()}/10`, { values: { deal_id: 5 } });
        expect(refused.statusCode, refused.body).toBe(403);
        expect(reason(refused)).toBe('parent-not-theirs');
        expect(await one('SELECT deal_id, deal_owner_id FROM deal_members WHERE id = 10')).toEqual({ deal_id: 2, deal_owner_id: w.people.dana });
        await call('dana', 'PATCH', `${members()}/10`, { values: { deal_id: 1 } });
      });

      it('follows the deal when it is handed to somebody else', async () => {
        // Mara hands deal 1 from Dana to Omar: the listing on it is now Omar's to keep.
        const handed = await call('mara', 'PATCH', `${w.id('deals')}/1`, { values: { owner_id: w.people.omar } });
        expect(handed.statusCode, handed.body).toBe(200);
        await w.jobs();
        expect(await one('SELECT deal_owner_id FROM deal_members WHERE id = 10')).toEqual({ deal_owner_id: w.people.omar });
        expect((await add('dana', 16, 1, 'sam')).statusCode).toBeGreaterThanOrEqual(400);
        expect((await call('dana', 'DELETE', `${members()}/10`)).statusCode).toBeGreaterThanOrEqual(400);
        expect((await add('omar', 16, 1, 'sam')).statusCode).toBe(201);
        await call('mara', 'PATCH', `${w.id('deals')}/1`, { values: { owner_id: w.people.dana } });
        await w.jobs();
      });
    });

    describe('the same through a deal\'s own form, where the link is never sent', () => {
      const relation = async (): Promise<string> => {
        const model = await w.model();
        const found = model.relations.find((one) => one.through === null && one.from.tableId === members() && one.to.tableId === w.id('deals'));
        return found!.id;
      };
      const under = async (who: PersonName, deal: number, rows: Record<string, unknown>[]): Promise<Reply> => call(who, 'PATCH', `${w.id('deals')}/${String(deal)}`, { values: {}, children: { [await relation()]: rows } });
      const on = async (deal: number): Promise<number[]> => (await w.rows(`SELECT id FROM deal_members WHERE deal_id = ${String(deal)} ORDER BY id`)).map((row) => Number(row['id']));

      it('a helper adds nobody under the deal, whatever owner the row claims', async () => {
        // Deal 5 is Lena's; Dana is listed on it (row 1). She sends the form back with one more row, naming herself as the deal's owner.
        const before = await on(5);
        for (const forged of [{}, { deal_owner_id: w.people.dana }]) {
          const refused = await under('dana', 5, [{ key: { id: 1 }, values: {} }, { values: { id: 30, user_id: w.people.omar, ...forged } }]);
          expect(refused.statusCode, refused.body).toBe(403);
          expect(reason(refused)).toBe('parent-not-theirs');
        }
        expect(await on(5)).toEqual(before);
      });

      it('whoever covers adds nobody under the deal either', async () => {
        // Deal 9 is Lena's, on Dana's desk while she covers.
        const refused = await under('dana', 9, [{ values: { id: 31, user_id: w.people.dana, deal_owner_id: w.people.dana } }]);
        expect(refused.statusCode, refused.body).toBe(403);
        expect(await on(9)).toEqual([]);
      });

      it('the owner adds one under her deal, and the row is hers by the copy', async () => {
        const kept = (await on(1)).map((id) => ({ key: { id }, values: {} }));
        const added = await under('dana', 1, [...kept, { values: { id: 32, user_id: w.people.sam } }]);
        expect(added.statusCode, added.body).toBe(200);
        expect(await one('SELECT deal_id, deal_owner_id FROM deal_members WHERE id = 32')).toEqual({ deal_id: 1, deal_owner_id: w.people.dana });
        await w.run('DELETE FROM deal_members WHERE id = 32');
      });

      it('a new deal is made with its people by its owner, and for nobody she does not lead', async () => {
        const rel = await relation();
        const deal = (key: number, owner: string) => ({ values: { id: key, title: `Deal ${String(key)}`, state: 'open', amount: 100, big: false, company_id: 1, owner_id: owner }, children: { [rel]: [{ values: { id: key, user_id: w.people.omar } }] } });
        const hers = await call('dana', 'POST', w.id('deals'), deal(40, w.people.dana));
        expect(hers.statusCode, hers.body).toBe(201);
        expect(await one('SELECT deal_owner_id FROM deal_members WHERE id = 40')).toEqual({ deal_owner_id: w.people.dana });
        // Mara leads Dana: a deal she makes for her may carry its people.
        const led = await call('mara', 'POST', w.id('deals'), deal(41, w.people.dana));
        expect(led.statusCode, led.body).toBe(201);
        await w.run('DELETE FROM deal_members WHERE id IN (40, 41)');
        await w.run('DELETE FROM deals WHERE id IN (40, 41)');
      });

      it('nobody held to some rows writes the kept column of a stored row by hand', async () => {
        // The copy runs again only when the link moves: a typed value would stay, and say an owner the deal does not have.
        const typed = await call('mara', 'PATCH', `${members()}/10`, { values: { deal_owner_id: w.people.omar } });
        expect(typed.statusCode, typed.body).toBe(403);
        expect(reason(typed)).toBe('kept-by-copy');
        expect(await one('SELECT deal_owner_id FROM deal_members WHERE id = 10')).toEqual({ deal_owner_id: w.people.dana });
      });
    });

    describe('a listing names somebody who can open what it lists them on', () => {
      it('refuses a person who reads no table the listing opens, whoever writes', async () => {
        // Kim reads companies and no deal. Lena is limited by nothing; the owner of the workspace is a Super Admin.
        const before = await count();
        for (const writer of ['lena', 'owner', 'dana'] as const) {
          const refused = await add(writer, 20, writer === 'dana' ? 1 : 5, 'kim');
          expect(refused.statusCode, `${writer}: ${refused.body}`).toBe(422);
          expect(field(refused, 'user_id'), writer).toBe('cannot-open');
        }
        expect(await count()).toBe(before);
      });

      it('takes the same person once a role of theirs reads deals', async () => {
        await w.give('kim', 'rep');
        const added = await add('lena', 20, 5, 'kim');
        expect(added.statusCode, added.body).toBe(201);
        await w.take('kim', 'rep');
        await w.run('DELETE FROM deal_members WHERE id = 20');
      });

      it('holds a cover to the same: whoever covers reads deals', async () => {
        const refused = await call('owner', 'POST', w.id('covers'), { values: { id: 9, owner_id: w.people.sam, cover_id: w.people.kim, starts_on: '2027-01-04', ends_on: '2027-01-08' } });
        expect(refused.statusCode, refused.body).toBe(422);
        expect(field(refused, 'cover_id')).toBe('cannot-open');
        expect(await one('SELECT id FROM covers WHERE id = 9')).toBeUndefined();
      });

      it('asks nothing of a person column no table is read through', async () => {
        // A follow-up's owner is the row's own person, not a listing: Kim may be named by somebody nothing limits.
        const made = await call('lena', 'PATCH', `${w.id('deals')}/7`, { values: { owner_id: w.people.kim } });
        expect(made.statusCode, made.body).toBe(200);
        await w.run('UPDATE deals SET owner_id = NULL WHERE id = 7');
      });
    });
  });
}
