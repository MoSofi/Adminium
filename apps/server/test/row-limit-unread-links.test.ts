// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A LINK INTO A TABLE THE WRITER DOES NOT READ AT ALL.
 *
 * A writer who reads a table in part may link only to the rows they reach.
 * A writer who holds no read of the table was asked nothing: a clerk who
 * writes quotes and reads no deal could hang a quote on anybody's deal, and
 * read through it whatever the quote copies from the deal.
 *
 * Where a table says whose its rows are, such a writer may name a row that
 * is theirs by the table's own ways, and no other; the refusal is that of a
 * row that is not there. A table that says nothing of its rows is as it
 * always was.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ENGINES, world, type PersonName, type World } from './row-limit-world.js';

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`a link into a table the writer does not read [${dialect}]`, () => {
    let w: World;
    const cookies = new Map<PersonName, string>();
    const as = async (who: PersonName): Promise<string> => {
      if (!cookies.has(who)) cookies.set(who, (await w.signIn(who)).cookie);
      return cookies.get(who)!;
    };
    type Reply = { statusCode: number; body: string };
    const call = async (who: PersonName, method: 'GET' | 'POST' | 'PATCH', path: string, payload?: Record<string, unknown>): Promise<Reply> =>
      w.app.inject({ method, url: `/api/v1/data/${w.connectionId}/${path}`, headers: { cookie: await as(who) }, ...(payload === undefined ? {} : { payload }) });
    const shape = (res: Reply, key: number): unknown => ({ status: res.statusCode, body: res.body.replace(/req_[0-9a-f]{8}/g, 'req_x').replace(new RegExp(`\\b${String(key)}\\b`, 'g'), 'K') });
    let next = 2000;
    const fresh = (): number => (next += 1);
    const dealOf = async (quote: number): Promise<unknown> => (await w.rows(`SELECT deal_id FROM quotes WHERE id = ${String(quote)}`))[0]?.['deal_id'];

    beforeAll(async () => {
      w = await world(dialect);
      // Writes quotes, reads every quote, and holds nothing on deals.
      await w.role('clerk', { quotes: { actions: ['read', 'create', 'update'] } });
      // Makes deals and reads nothing: not the deals, not the companies a deal names.
      await w.role('maker', { deals: { actions: ['create'] } });
      await w.role('editor', { deals: { actions: ['read'] }, quotes: { actions: ['read', 'create', 'update'] } });
      for (const person of ['kim', 'omar', 'dana'] as const) await w.give(person, 'clerk');
      await w.give('sam', 'maker');
      await w.give('lena', 'editor');
    }, 120_000);
    afterAll(async () => {
      await w?.close();
    });

    it('to somebody else\'s row, or to nobody\'s, is refused as a link to a row that is not there', async () => {
      // Kim owns no deal. Deal 3 is Omar's; deal 7 is nobody's.
      expect((await call('kim', 'GET', 'deals')).statusCode).toBe(403);
      const missing = await call('kim', 'POST', 'quotes', { values: { id: fresh(), deal_id: 999, total: 1 } });
      for (const deal of [3, 7]) {
        const theirs = await call('kim', 'POST', 'quotes', { values: { id: fresh(), deal_id: deal, total: 1 } });
        expect(theirs.statusCode, theirs.body).toBe(409);
        expect(shape(theirs, deal)).toEqual(shape(missing, 999));
        expect(await w.rows(`SELECT id FROM quotes WHERE id = ${String(next)}`)).toEqual([]);
      }
    });

    it('to a row that is the writer\'s own by the table\'s ways is made: the owner\'s, and a helper\'s', async () => {
      // Omar reads no deal either, and deal 3 is his.
      expect((await call('omar', 'GET', 'deals')).statusCode).toBe(403);
      const own = await call('omar', 'POST', 'quotes', { values: { id: fresh(), deal_id: 3, total: 1 } });
      expect(own.statusCode, own.body).toBeLessThan(300);
      expect(await dealOf(next)).toBe(3);
      expect((await call('omar', 'POST', 'quotes', { values: { id: fresh(), deal_id: 1, total: 1 } })).statusCode).toBe(409);
      // Dana owns deal 1 and is listed on deal 5; deal 3 is neither.
      for (const [deal, status] of [[1, 201], [5, 201], [3, 409]] as const) {
        const made = await call('dana', 'POST', 'quotes', { values: { id: fresh(), deal_id: deal, total: 1 } });
        expect(made.statusCode === 409 ? 409 : 201, `deal ${String(deal)}: ${made.body}`).toBe(status);
      }
    });

    it('moved onto somebody else\'s row is refused; left as it is, or emptied, it is not asked about', async () => {
      // Quote 2 sits on deal 3 (Omar's); quote 5 on none.
      const moved = await call('kim', 'PATCH', 'quotes/5', { values: { deal_id: 3 } });
      const nowhere = await call('kim', 'PATCH', 'quotes/5', { values: { deal_id: 999 } });
      expect(moved.statusCode, moved.body).toBe(409);
      expect(shape(moved, 3)).toEqual(shape(nowhere, 999));
      expect(await dealOf(5)).toBeNull();
      // A form sends the whole row back: the link it already holds is no change.
      expect((await call('kim', 'PATCH', 'quotes/2', { values: { deal_id: 3, total: 201 } })).statusCode).toBe(200);
      expect((await call('kim', 'PATCH', 'quotes/2', { values: { deal_id: null } })).statusCode).toBe(200);
      await w.run('UPDATE quotes SET deal_id = 3, total = 200 WHERE id = 2');
    });

    it('into a table that says nothing of its rows is a key like any other, read or not', async () => {
      // Sam reads no company, and companies are nobody's in particular.
      expect((await call('sam', 'GET', 'companies')).statusCode).toBe(403);
      const made = await call('sam', 'POST', 'deals', { values: { id: fresh(), title: 'A new deal', state: 'open', amount: 100, big: false, company_id: 1 } });
      expect(made.statusCode, made.body).toBeLessThan(300);
      expect((await w.rows(`SELECT company_id FROM deals WHERE id = ${String(next)}`))[0]!['company_id']).toBe(1);
    });

    it('by somebody who reads the table is as it was', async () => {
      const made = await call('lena', 'POST', 'quotes', { values: { id: fresh(), deal_id: 3, total: 1 } });
      expect(made.statusCode, made.body).toBeLessThan(300);
    });
  });
}
