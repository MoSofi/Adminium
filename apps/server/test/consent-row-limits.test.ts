// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A record's consent routes judged as a change of that row, against the whole
 * server on every engine: whoever may change the row (its owner, whoever
 * covers for them) records consent, presses "Replied" and puts its address on
 * the do-not-email list ("They said no"); a helper listed on it, whose change
 * reach leaves that listing out (`notThrough`), reads its panel and changes
 * nothing; someone who does not reach it at all sees a row that is not there.
 * None of them sees the install-wide list or takes anything off it.
 *
 * The firm of `row-limit-world.ts`, with Sam's deal 10 (as in
 * `row-limit-not-through.test.ts`): Kim helps on it, Mara covers Sam, and the
 * deals carry an e-mail address.
 */
import type { RowReach } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runIntrospection } from '../src/connections/introspect.js';
import { ENGINES, world, type PersonName, type World } from './row-limit-world.js';

type Reply = { statusCode: number; body: string };

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`a record's consent, as a change of the row [${dialect}]`, () => {
    let w: World;
    const cookies = new Map<PersonName, string>();
    const call = async (who: PersonName, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown): Promise<Reply> => {
      if (!cookies.has(who)) cookies.set(who, (await w.signIn(who)).cookie);
      return w.app.inject({ method, url: `/api/v1/${url}`, headers: { cookie: cookies.get(who)! }, ...(payload === undefined ? {} : { payload: payload as never }) });
    };
    const deal = (id: number) => ({ connectionId: w.connectionId, table: w.id('deals'), recordId: String(id) });
    /** A missing row and an unreached one, told apart by nothing but the key. */
    const shape = (res: Reply, key: number): unknown => ({ status: res.statusCode, body: res.body.replace(new RegExp(`\\b${String(key)}\\b`, 'g'), 'KEY').replace(/req_[0-9a-zA-Z]+/g, 'REQ') });

    beforeAll(async () => {
      w = await world(dialect);
      await w.run('ALTER TABLE deals ADD COLUMN email VARCHAR(254)');
      await w.run(`INSERT INTO deals (id, title, owner_id, state, amount, big, company_id, email) VALUES (10, 'Deal 10', '${w.people.sam}', 'open', 5000, ${dialect === 'postgres' ? 'false' : '0'}, 1, 'Buyer@Deal10.example')`);
      await w.run(`INSERT INTO deal_members (id, deal_id, user_id) VALUES (10, 10, '${w.people.kim}')`);
      await w.run(`INSERT INTO covers (id, owner_id, cover_id, starts_on, ends_on) VALUES (10, '${w.people.sam}', '${w.people.mara}', '2020-01-01', NULL)`);
      await runIntrospection({ manager: w.manager, meta: w.meta, connectionId: w.connectionId });
      const own: RowReach = { reach: 'own' };
      const notHelpers: RowReach = { reach: 'own', notThrough: w.id('deal_members') };
      await w.role('rep', { deals: { actions: ['read', 'update'], rows: { read: own, update: notHelpers } } });
      for (const who of ['kim', 'mara', 'sam', 'dana'] as const) await w.give(who, 'rep');
    }, 180_000);
    afterAll(async () => {
      await w?.close();
    });

    it('lets the owner record consent, press "Replied" and say no, as a change of the row', async () => {
      const recorded = await call('sam', 'POST', 'consent/record-consent', { ...deal(10), purpose: 'newsletter', how: 'phone', note: null });
      expect(recorded.statusCode, recorded.body).toBe(200);
      expect((await call('sam', 'POST', 'consent/replied', deal(10))).statusCode).toBe(200);
      const said = await call('sam', 'POST', 'consent/said-no', deal(10));
      expect(said.statusCode, said.body).toBe(200);
      const panel = JSON.parse((await call('sam', 'POST', 'consent/panel', deal(10))).body) as { data: { purposes: { state: string }[]; stopped: unknown; mayChange: boolean; addressKnown: boolean } };
      expect(panel.data).toMatchObject({ addressKnown: true, purposes: [{ state: 'yes' }, { state: 'not-asked' }], stopped: { reason: 'hand' }, mayChange: true });
      // Whoever covers for the owner changes it too.
      expect((await call('mara', 'POST', 'consent/record-consent', { ...deal(10), purpose: 'surveys', how: 'in-person', note: null })).statusCode).toBe(200);
    });

    it('lets a helper read the panel and change nothing: a change answers as a row that is not there', async () => {
      const panel = await call('kim', 'POST', 'consent/panel', deal(10));
      expect(panel.statusCode, panel.body).toBe(200);
      expect((JSON.parse(panel.body) as { data: { mayChange: boolean } }).data.mayChange).toBe(false);
      for (const [path, extra] of [
        ['consent/record-consent', { purpose: 'newsletter', how: 'phone', note: null }],
        ['consent/replied', {}],
        ['consent/said-no', {}],
      ] as const) {
        const refused = await call('kim', 'POST', path, { ...deal(10), ...extra });
        expect(refused.statusCode, path).toBe(404);
        expect(shape(refused, 10), path).toEqual(shape(await call('kim', 'POST', path, { ...deal(999), ...extra }), 999));
      }
    });

    it('shows a row out of reach as one that is not there, and keeps the list and its removal from every rep', async () => {
      expect((await call('dana', 'POST', 'consent/panel', deal(10))).statusCode).toBe(404);
      expect((await call('dana', 'POST', 'consent/said-no', deal(10))).statusCode).toBe(404);
      expect((await call('sam', 'GET', 'consent/stop-list')).statusCode).toBe(403);
      const listed = await w.app.inject({ method: 'GET', url: '/api/v1/consent/stop-list?q=deal10', headers: { cookie: w.owner.cookie } });
      expect(listed.statusCode, listed.body).toBe(200);
      const [entry] = (JSON.parse(listed.body) as { data: { entries: { id: string; address: string }[] } }).data.entries;
      expect(entry?.address).toBe('buyer@deal10.example');
      expect((await call('sam', 'DELETE', `consent/stop-list/${entry!.id}`)).statusCode).toBe(403);
    });
  });
}
