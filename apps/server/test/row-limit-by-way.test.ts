// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "THEIR OWN" SAYS BY WHICH WAY.
 *
 * A person reaches a row in several ways: the row names them, they are
 * listed on it as a helper, they cover for its owner, or it hangs under a
 * row they reach. Until now all of them were "their own" alike, so a helper
 * on a colleague's deal could make themselves its owner, and anybody on a
 * deal could rewrite a colleague's note under it.
 *
 * Two things hold that apart. The columns that decide whose a row is are
 * changed only by somebody the row itself names (or who leads them): a
 * helper and a cover work on the row and do not give it away. And a role's
 * reach may say `by`: of the rows the person reaches, only the ones a staff
 * column names them in — every note of the deal to read, their own to change.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ENGINES, world, type PersonName, type World } from './row-limit-world.js';

const OWN = { reach: 'own' } as const;
const TEAM = { reach: 'team' } as const;

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`their own, by which way [${dialect}]`, () => {
    let w: World;
    const cookies = new Map<PersonName, string>();
    const as = async (who: PersonName): Promise<string> => {
      if (!cookies.has(who)) cookies.set(who, (await w.signIn(who)).cookie);
      return cookies.get(who)!;
    };
    type Reply = { statusCode: number; body: string };
    const call = async (who: PersonName, method: 'GET' | 'PATCH' | 'DELETE', path: string, payload?: Record<string, unknown>): Promise<Reply> =>
      w.app.inject({ method, url: `/api/v1/data/${w.connectionId}/${path}`, headers: { cookie: await as(who) }, ...(payload === undefined ? {} : { payload }) });
    const keys = async (who: PersonName, table: string): Promise<number[]> => (JSON.parse((await call(who, 'GET', `${table}?limit=100`)).body) as { data: { id: number }[] }).data.map((row) => Number(row.id)).sort((a, b) => a - b);
    const one = async (statement: string): Promise<Record<string, unknown>> => (await w.rows(statement))[0]!;
    const reason = (res: Reply): unknown => (JSON.parse(res.body) as { error?: { details?: { reason?: unknown } } }).error?.details?.reason;

    beforeAll(async () => {
      w = await world(dialect);
      // A follow-up hangs under its deal, and says who it is by.
      await w.belongs('followups', [{ via: 'deal_id' }]);
      await w.role('rep', {
        deals: { actions: ['read', 'update'], rows: { read: OWN, update: OWN } },
        followups: { actions: ['read', 'update', 'delete'], rows: { read: OWN, update: { reach: 'own', by: 'owner_id' }, delete: { reach: 'own', by: 'owner_id' } } },
      });
      await w.role('manager', {
        deals: { actions: ['read', 'update'], rows: { read: TEAM, update: TEAM } },
        followups: { actions: ['read', 'update'], rows: { read: TEAM, update: { reach: 'team', by: 'owner_id' } } },
      });
      for (const person of ['dana', 'omar'] as const) await w.give(person, 'rep');
      await w.give('mara', 'manager');
    }, 120_000);
    afterAll(async () => {
      await w?.close();
    });

    describe('a row under a parent, held to who it is by', () => {
      it('is read by everybody who reaches the parent, and changed or removed only by the person it names', async () => {
        // Deal 1 is Dana's, with a follow-up of hers (1) and one of Omar's (2). Deal 3 is Omar's, with his (3) and one of Dana's (4).
        expect(await keys('dana', w.id('followups'))).toEqual([1, 2]);
        expect(await keys('omar', w.id('followups'))).toEqual([3, 4]);
        const hers = await call('dana', 'PATCH', `${w.id('followups')}/1`, { values: { note: 'Ring Harbour again' } });
        expect(hers.statusCode, hers.body).toBe(200);
        // Omar's note on her own deal: she reads it, and it is not hers to rewrite or remove.
        const his = await call('dana', 'PATCH', `${w.id('followups')}/2`, { values: { note: 'Rewritten by the deal\'s owner' } });
        expect(his.statusCode, his.body).toBeGreaterThanOrEqual(400);
        expect((await call('dana', 'DELETE', `${w.id('followups')}/2`)).statusCode).toBeGreaterThanOrEqual(400);
        expect(await one('SELECT note FROM followups WHERE id = 2')).toEqual({ note: 'Send the samples' });
        // The same from the other side: Omar owns deal 3 and does not rewrite Dana's note under it.
        expect((await call('omar', 'PATCH', `${w.id('followups')}/4`, { values: { note: 'Rewritten' } })).statusCode).toBeGreaterThanOrEqual(400);
        expect((await call('omar', 'PATCH', `${w.id('followups')}/3`, { values: { note: 'Chase the PO today' } })).statusCode).toBe(200);
        expect(await one('SELECT note FROM followups WHERE id = 4')).toEqual({ note: 'Dana helps on three' });
        await w.run(`UPDATE followups SET note = 'Ring Harbour' WHERE id = 1`);
        await w.run(`UPDATE followups SET note = 'Chase the PO' WHERE id = 3`);
      });

      it('with a team\'s reach, is changed by whoever leads the person it names', async () => {
        // Mara leads Dana and Omar: she reaches their deals, and changes the notes that are by either of them.
        const changed = await call('mara', 'PATCH', `${w.id('followups')}/2`, { values: { note: 'Send the samples on Monday' } });
        expect(changed.statusCode, changed.body).toBe(200);
        await w.run(`UPDATE followups SET note = 'Send the samples' WHERE id = 2`);
      });
    });

    describe('the column that says whose a row is', () => {
      it('is not changed by a helper or a cover, who work on the row all the same', async () => {
        // Deal 5 is Lena's. Dana is listed on it, and covers Lena: she reaches it twice over, and neither way makes it hers.
        expect(await keys('dana', w.id('deals'))).toContain(5);
        const worked = await call('dana', 'PATCH', `${w.id('deals')}/5`, { values: { amount: 21000 } });
        expect(worked.statusCode, worked.body).toBe(200);
        const taken = await call('dana', 'PATCH', `${w.id('deals')}/5`, { values: { owner_id: w.people.dana } });
        expect(taken.statusCode, taken.body).toBe(403);
        expect(reason(taken)).toBe('not-theirs-to-give');
        expect(await one('SELECT owner_id FROM deals WHERE id = 5')).toEqual({ owner_id: w.people.lena });
        // Deal 9 she reaches by cover alone: the same.
        expect((await call('dana', 'PATCH', `${w.id('deals')}/9`, { values: { owner_id: w.people.dana } })).statusCode).toBe(403);
        await w.run('UPDATE deals SET amount = 20000 WHERE id = 5');
      });

      it('is changed by the person the row names, and by who leads them, as the table lets them', async () => {
        // Dana's own deal, sent back whole by a form: nothing of whose it is changes, and nothing is asked.
        expect((await call('dana', 'PATCH', `${w.id('deals')}/1`, { values: { owner_id: w.people.dana, amount: 12500 } })).statusCode).toBe(200);
        // Mara leads Dana and Omar: the deal goes from one to the other.
        const moved = await call('mara', 'PATCH', `${w.id('deals')}/1`, { values: { owner_id: w.people.omar } });
        expect(moved.statusCode, moved.body).toBe(200);
        expect(await one('SELECT owner_id FROM deals WHERE id = 1')).toEqual({ owner_id: w.people.omar });
        await w.run(`UPDATE deals SET owner_id = '${w.people.dana}', amount = 12000 WHERE id = 1`);
      });
    });
  });
}
