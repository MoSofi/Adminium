// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a write is held to when its writer reaches only some rows (plan 67,
 * A1; the matrix's D2–D4, D17–D25), against the whole server on every engine.
 *
 * A LINK a limited writer sets names a row they reach, or is refused as a
 * link to a row that is not there — each case compares the two answers.
 * A PERSON they put in a staff column is one the table lets them name.
 * Rows named in a batch, a row-by-row call and an undo are each judged.
 *
 * The clock is the real one: Dana covers Lena (deals 5 and 9), so Dana
 * reaches deals 1, 2, 5 and 9.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ENGINES, world, type PersonName, type World } from './row-limit-world.js';

const OWN = { reach: 'own' } as const;
const TEAM = { reach: 'team' } as const;

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`a limited person writes [${dialect}]`, () => {
    let w: World;
    const cookies = new Map<PersonName | 'owner', string>();
    const as = async (who: PersonName | 'owner'): Promise<string> => {
      if (!cookies.has(who)) cookies.set(who, who === 'owner' ? w.owner.cookie : (await w.signIn(who)).cookie);
      return cookies.get(who)!;
    };
    type Reply = { statusCode: number; body: string };
    const call = async (who: PersonName | 'owner', method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, payload?: Record<string, unknown>): Promise<Reply> =>
      w.app.inject({ method, url: `/api/v1/data/${w.connectionId}/${path}`, headers: { cookie: await as(who) }, ...(payload === undefined ? {} : { payload }) });
    const json = <T = Record<string, unknown>>(res: Reply): T => JSON.parse(res.body) as T;
    const code = (res: Reply): string | undefined => json<{ error?: { code: string } }>(res).error?.code;
    /** An answer with the request's own id and the key it named taken out. */
    const shape = (res: Reply, key: number): unknown => ({ status: res.statusCode, body: res.body.replace(/req_[0-9a-f]{8}/g, 'req_x').replace(new RegExp(`\\b${String(key)}\\b`, 'g'), 'K') });
    const one = async (statement: string): Promise<Record<string, unknown>> => (await w.rows(statement))[0]!;
    let next = 1000;
    const fresh = (): number => (next += 1);
    const relationOf = async (from: 'quotes' | 'followups' | 'tags' | 'tickets' | 'deals'): Promise<string> => {
      const model = await w.model();
      const found =
        from === 'tags' || from === 'tickets'
          ? model.relations.find((relation) => relation.through !== null && relation.from.tableId === w.id('deals') && relation.to.tableId === w.id(from))
          : from === 'deals'
            ? model.relations.find((relation) => relation.through === null && relation.from.tableId === w.id('deals') && relation.to.tableId === w.id('companies'))
            : model.relations.find((relation) => relation.through === null && relation.from.tableId === w.id(from) && relation.to.tableId === w.id('deals'));
      expect(found, from).toBeDefined();
      return found!.id;
    };
    const deal = (key: number, over: Record<string, unknown> = {}) => ({ id: key, title: `Deal ${String(key)}`, state: 'open', amount: 100, big: false, company_id: 1, ...over });

    beforeAll(async () => {
      w = await world(dialect);
      await w.role('rep', {
        deals: { actions: ['read', 'create', 'update', 'delete'], rows: { read: OWN, update: OWN, delete: OWN } },
        quotes: { actions: ['read', 'create', 'update'], rows: { read: OWN, update: OWN } },
        followups: { actions: ['read', 'create', 'update', 'delete'], rows: { read: OWN, update: OWN, delete: OWN } },
        tickets: { actions: ['read'], rows: { read: OWN } },
        deal_tickets: { actions: ['read', 'create', 'delete'] },
        deal_tags: { actions: ['read', 'create', 'delete'] },
        tags: { actions: ['read'] },
        companies: { actions: ['read', 'create'] },
        one_to_ones: { actions: ['read', 'create', 'update'], rows: { read: OWN, update: OWN } },
      });
      await w.role('manager', {
        deals: { actions: ['read', 'create', 'update'], rows: { read: TEAM, update: TEAM } },
        companies: { actions: ['read'] },
        one_to_ones: { actions: ['read', 'create', 'update'], rows: { read: OWN, update: OWN } },
      });
      await w.role('inbox', { deals: { actions: ['read', 'update'], rows: { read: { reach: 'own', unowned: true }, update: { reach: 'own', unowned: true } } } });
      await w.role('editor', { deals: { actions: ['read', 'create', 'update', 'delete'] }, quotes: { actions: ['read', 'create', 'update'] }, followups: { actions: ['read', 'create', 'update', 'delete'] }, companies: { actions: ['read'] }, tickets: { actions: ['read'] }, deal_tickets: { actions: ['read', 'create', 'delete'] } });
      for (const person of ['dana', 'omar'] as const) await w.give(person, 'rep');
      await w.give('mara', 'manager');
      await w.give('lena', 'editor');
    }, 120_000);
    afterAll(async () => {
      await w?.close();
    });

    describe('a link', () => {
      it('to a colleague\'s row is refused as a link to a row that is not there, with nothing of the database\'s own words', async () => {
        const theirs = await call('dana', 'POST', 'quotes', { values: { id: fresh(), deal_id: 3, total: 1 } });
        const missing = await call('dana', 'POST', 'quotes', { values: { id: next, deal_id: 999, total: 1 } });
        expect(theirs.statusCode, theirs.body).toBe(409);
        expect(json<{ error: { code: string; details: unknown } }>(theirs).error).toMatchObject({ code: 'FK_VIOLATION', details: { constraint: null, detail: null } });
        expect(shape(theirs, 3)).toEqual(shape(missing, 999));
        expect(await w.rows(`SELECT id FROM quotes WHERE id = ${String(next)}`)).toEqual([]);
        // To her own deal, and to one she helps on: made.
        for (const dealId of [1, 5]) {
          const made = await call('dana', 'POST', 'quotes', { values: { id: fresh(), deal_id: dealId, total: 1 } });
          expect(made.statusCode, made.body).toBeLessThan(300);
          expect(json<{ data: { deal_id: number } }>(made).data.deal_id).toBe(dealId);
        }
      });

      it('moved to a colleague\'s row is refused the same way; left as it is, it is never asked about', async () => {
        const theirs = await call('dana', 'PATCH', 'quotes/1', { values: { deal_id: 3 } });
        const missing = await call('dana', 'PATCH', 'quotes/1', { values: { deal_id: 999 } });
        expect(theirs.statusCode, theirs.body).toBe(409);
        expect(shape(theirs, 3)).toEqual(shape(missing, 999));
        expect(await one('SELECT deal_id FROM quotes WHERE id = 1')).toEqual({ deal_id: 1 });
        // A form sends the whole row back: the link it already holds is no change.
        const same = await call('dana', 'PATCH', 'quotes/1', { values: { deal_id: 1, total: 101 } });
        expect(same.statusCode, same.body).toBe(200);
        // Moved to a deal she reaches.
        expect((await call('dana', 'PATCH', 'quotes/1', { values: { deal_id: 5 } })).statusCode).toBe(200);
        await w.run('UPDATE quotes SET deal_id = 1, total = 100 WHERE id = 1');
      });

      it('somebody nothing limits is told what the database says, as ever', async () => {
        const res = await call('lena', 'POST', 'quotes', { values: { id: fresh(), deal_id: 999, total: 1 } });
        expect(res.statusCode, res.body).toBe(409);
        expect(code(res)).toBe('FK_VIOLATION');
        // To any deal: made.
        expect((await call('lena', 'POST', 'quotes', { values: { id: fresh(), deal_id: 3, total: 1 } })).statusCode).toBeLessThan(300);
      });

      it('to a table the writer reads whole is not asked about', async () => {
        const made = await call('dana', 'POST', 'deals', { values: deal(fresh(), { owner_id: w.people.dana, company_id: 2 }) });
        expect(made.statusCode, made.body).toBeLessThan(300);
      });
    });

    describe('a person in a staff column', () => {
      it('a rep who leads nobody names nobody but themselves, though the column would take a person of a team they led', async () => {
        // `owner_id` is `set: 'team'`: Dana leads no team, so it is hers alone to fill.
        expect((await call('dana', 'PATCH', 'deals/2', { values: { owner_id: w.people.omar } })).statusCode).toBe(403);
        expect((await call('dana', 'PATCH', 'deals/2', { values: { owner_id: w.people.mara } })).statusCode).toBe(403);
      });

      it('a rep names themselves; a colleague, somebody who is no person, and nobody are each refused', async () => {
        const mine = await call('dana', 'POST', 'deals', { values: deal(fresh(), { owner_id: w.people.dana }) });
        expect(mine.statusCode, mine.body).toBeLessThan(300);
        const theirs = await call('dana', 'POST', 'deals', { values: deal(fresh(), { owner_id: w.people.omar }) });
        expect(theirs.statusCode, theirs.body).toBe(403);
        expect(json<{ error: { code: string; details: { reason: string; column: string } } }>(theirs).error).toMatchObject({ code: 'COLUMN_FORBIDDEN', details: { reason: 'staff-column', column: 'owner_id' } });
        expect(await w.rows(`SELECT id FROM deals WHERE id = ${String(next)}`)).toEqual([]);
        const nobody = await call('dana', 'POST', 'deals', { values: deal(fresh(), { owner_id: 'usr_00000000000000000000000000' }) });
        expect(nobody.statusCode, nobody.body).toBe(422);
        expect(json<{ error: { details: { fields: Record<string, { code: string }> } } }>(nobody).error.details.fields).toEqual({ owner_id: { code: 'not-found' } });
        // …for somebody nothing limits too: a staff column holds a person who can sign in.
        expect((await call('lena', 'POST', 'deals', { values: deal(fresh(), { owner_id: 'usr_00000000000000000000000000' }) })).statusCode).toBe(422);
        // Emptied: the row would be nobody's, which her reach does not include.
        const emptied = await call('dana', 'PATCH', 'deals/1', { values: { owner_id: null } });
        expect(emptied.statusCode, emptied.body).toBe(403);
        expect(await one('SELECT owner_id FROM deals WHERE id = 1')).toEqual({ owner_id: w.people.dana });
        // Her own name sent back with the rest of the form is no change.
        expect((await call('dana', 'PATCH', 'deals/1', { values: { owner_id: w.people.dana, amount: 12001 } })).statusCode).toBe(200);
        await w.run('UPDATE deals SET amount = 12000 WHERE id = 1');
      });

      it('a manager names a person of the team they lead, and nobody of a team they sit in', async () => {
        const led = await call('mara', 'POST', 'deals', { values: deal(fresh(), { owner_id: w.people.omar }) });
        expect(led.statusCode, led.body).toBeLessThan(300);
        expect((await call('mara', 'PATCH', 'deals/1', { values: { owner_id: w.people.omar } })).statusCode).toBe(200);
        expect((await call('mara', 'PATCH', 'deals/1', { values: { owner_id: w.people.dana } })).statusCode).toBe(200);
        const other = await call('mara', 'PATCH', 'deals/1', { values: { owner_id: w.people.sam } });
        expect(other.statusCode, other.body).toBe(403);
        expect(await one('SELECT owner_id FROM deals WHERE id = 1')).toEqual({ owner_id: w.people.dana });
      });

      it('somebody whose reach includes the rows nobody owns may leave one without an owner; anyone unlimited names anybody', async () => {
        await w.give('dana', 'inbox');
        const emptied = await call('dana', 'PATCH', 'deals/2', { values: { owner_id: null } });
        expect(emptied.statusCode, emptied.body).toBe(200);
        // Still hers to read: it is nobody's now.
        expect((await call('dana', 'GET', 'deals/2')).statusCode).toBe(200);
        await w.take('dana', 'inbox');
        expect((await call('lena', 'PATCH', 'deals/2', { values: { owner_id: w.people.dana } })).statusCode).toBe(200);
        expect((await call('lena', 'PATCH', 'deals/2', { values: { owner_id: w.people.kim } })).statusCode).toBe(200);
        await w.run(`UPDATE deals SET owner_id = '${w.people.dana}' WHERE id = 2`);
      });

      it('a hand-over button gives the row to anybody, and its writer is then told the key alone; a button that does not say so is held like any change', async () => {
        const passed = await call('dana', 'POST', 'deals/1/actions/pass', { from: 'open', values: { owner_id: w.people.omar } });
        expect(passed.statusCode, passed.body).toBe(403);
        const given = await call('dana', 'POST', 'deals/1/actions/give', { from: 'open', values: { owner_id: w.people.omar } });
        expect(given.statusCode, given.body).toBe(200);
        expect(json<{ data: Record<string, unknown> }>(given).data).toEqual({ id: 1, _handedOver: true });
        expect(await one('SELECT owner_id FROM deals WHERE id = 1')).toEqual({ owner_id: w.people.omar });
        // It is Omar's now: Dana finds no such deal.
        expect((await call('dana', 'GET', 'deals/1')).statusCode).toBe(404);
        // Handed over by mistake: taken back with the undo the save answered, because the undo leaves her a row she reaches.
        const token = json<{ undoToken: string | null }>(given).undoToken;
        if (token !== null) {
          const undone = await w.app.inject({ method: 'POST', url: `/api/v1/data/undo/${token}`, headers: { cookie: await as('dana') } });
          expect(undone.statusCode, undone.body).toBe(200);
          expect(await one('SELECT owner_id FROM deals WHERE id = 1')).toEqual({ owner_id: w.people.dana });
        }
        await w.run(`UPDATE deals SET owner_id = '${w.people.dana}' WHERE id = 1`);
      });

      it('a new row with no owner is made, and its maker is told its key alone', async () => {
        const key = fresh();
        const made = await call('dana', 'POST', 'deals', { values: deal(key) });
        expect(made.statusCode, made.body).toBeLessThan(300);
        expect(json<{ data: Record<string, unknown> }>(made).data).toEqual({ id: key, _handedOver: true });
        expect(await one(`SELECT owner_id FROM deals WHERE id = ${String(key)}`)).toEqual({ owner_id: null });
      });

      it('in a private table: one of the two is the writer, and the other somebody they lead — for the owner of the workspace too', async () => {
        const mine = await call('mara', 'POST', 'one_to_ones', { values: { id: fresh(), manager_id: w.people.mara, rep_id: w.people.dana, note: 'September' } });
        expect(mine.statusCode, mine.body).toBeLessThan(300);
        const asLena = await call('mara', 'POST', 'one_to_ones', { values: { id: fresh(), manager_id: w.people.lena, rep_id: w.people.dana, note: 'Not mine' } });
        expect(asLena.statusCode, asLena.body).toBe(403);
        const withSam = await call('mara', 'POST', 'one_to_ones', { values: { id: fresh(), manager_id: w.people.mara, rep_id: w.people.sam, note: 'Not my team' } });
        expect(withSam.statusCode, withSam.body).toBe(403);
        const owner = await call('owner', 'POST', 'one_to_ones', { values: { id: fresh(), manager_id: w.people.mara, rep_id: w.people.dana, note: 'Written by the owner' } });
        expect(owner.statusCode, owner.body).toBe(403);
        expect(await w.rows(`SELECT id FROM one_to_ones WHERE id > 1000 AND note <> 'September'`)).toEqual([]);
      });
    });

    describe('several rows at once', () => {
      it('row by row: a colleague\'s row answers as a row that is not there, and is not written', async () => {
        const res = await call('dana', 'POST', 'deals/one-by-one', { ids: [1, 3, 999], values: { title: 'Mine' } });
        expect(res.statusCode, res.body).toBe(200);
        const results = json<{ results: { id: number; ok: boolean; error?: { code: string; message?: string; details?: unknown } }[] }>(res).results;
        expect(results.map((result) => [result.id, result.ok, result.error?.code])).toEqual([[1, true, undefined], [3, false, 'NOT_FOUND'], [999, false, 'NOT_FOUND']]);
        expect(JSON.stringify(results[1]!.error).replaceAll('3', 'K')).toBe(JSON.stringify(results[2]!.error).replaceAll('999', 'K'));
        expect(await w.rows('SELECT id, title FROM deals WHERE id IN (1, 3) ORDER BY id')).toEqual([{ id: 1, title: 'Mine' }, { id: 3, title: 'Deal 3' }]);
        await w.run(`UPDATE deals SET title = 'Deal 1' WHERE id = 1`);
        // Row by row, new rows: each held as a row made on its own.
        const made = await call('dana', 'POST', 'deals/one-by-one', { creates: [deal(fresh(), { owner_id: w.people.dana }), deal(fresh(), { owner_id: w.people.omar }), deal(fresh())] });
        const created = json<{ results: { ok: boolean; data?: Record<string, unknown>; error?: { code: string } }[] }>(made).results;
        expect(created.map((result) => result.ok)).toEqual([true, false, true]);
        expect(created[1]!.error!.code).toBe('COLUMN_FORBIDDEN');
        expect(created[2]!.data).toEqual({ id: next, _handedOver: true });
      });

      it('in one batch: the rows out of reach leave it before anything is done, the rest are changed, and the undo puts them back', async () => {
        const res = await call('dana', 'POST', 'deals/bulk', { action: 'update', ids: [1, 3, 2, 999], values: { title: 'Batch' } });
        expect(res.statusCode, res.body).toBe(200);
        const body = json<{ results: { id: number; ok: boolean; error?: string }[]; undoToken: string | null }>(res);
        expect(body.results).toEqual([{ id: 1, ok: true }, { id: 3, ok: false, error: 'NOT_FOUND' }, { id: 2, ok: true }, { id: 999, ok: false, error: 'NOT_FOUND' }]);
        expect((await w.rows('SELECT title FROM deals WHERE id IN (1, 2, 3) ORDER BY id')).map((row) => row.title)).toEqual(['Batch', 'Batch', 'Deal 3']);
        // A deal moves through states, so its changes carry no undo: put back by hand.
        expect(body.undoToken).toBeNull();
        await w.run(`UPDATE deals SET title = 'Deal 1' WHERE id = 1`);
        await w.run(`UPDATE deals SET title = 'Deal 2' WHERE id = 2`);
        // A batch that names a colleague as the owner of her rows: refused whole, naming the row.
        const taken = await call('dana', 'POST', 'deals/bulk', { action: 'update', ids: [1, 2], values: { owner_id: w.people.omar } });
        expect(taken.statusCode, taken.body).toBe(403);
        expect((await w.rows('SELECT owner_id FROM deals WHERE id IN (1, 2)')).every((row) => row.owner_id === w.people.dana)).toBe(true);
        // A batch delete: her own row with nothing under it goes, a colleague's is not found.
        const key = fresh();
        await w.run(`INSERT INTO deals (id, title, owner_id, state, amount, big, company_id) VALUES (${String(key)}, 'Spare', '${w.people.dana}', 'open', 1, ${dialect === 'postgres' ? 'false' : '0'}, 1)`);
        const gone = await call('dana', 'POST', 'deals/bulk', { action: 'delete', ids: [key, 4] });
        expect(json<{ results: unknown[] }>(gone).results).toEqual([{ id: key, ok: true }, { id: 4, ok: false, error: 'NOT_FOUND' }]);
        expect(await w.rows(`SELECT id FROM deals WHERE id IN (${String(key)}, 4)`)).toEqual([{ id: 4 }]);
      });
    });

    describe('an undo', () => {
      // A follow-up keeps no states, so a change to it answers an undo token.
      it('is refused when the row was given to somebody else since, and the row is left as it is', async () => {
        const changed = await call('dana', 'PATCH', 'followups/1', { values: { note: 'Rang Harbour' } });
        expect(changed.statusCode, changed.body).toBe(200);
        const token = json<{ undoToken: string }>(changed).undoToken;
        expect(token).toEqual(expect.any(String));
        // Somebody gives the follow-up to Omar before she presses Undo.
        await w.run(`UPDATE followups SET owner_id = '${w.people.omar}' WHERE id = 1`);
        const undone = await w.app.inject({ method: 'POST', url: `/api/v1/data/undo/${token}`, headers: { cookie: await as('dana') } });
        expect(undone.statusCode, undone.body).toBe(409);
        expect(json<{ error: { details: { code: string } } }>(undone).error.details.code).toBe('UNDO_CONFLICT');
        expect(await one('SELECT note, owner_id FROM followups WHERE id = 1')).toEqual({ note: 'Rang Harbour', owner_id: w.people.omar });
        await w.run(`UPDATE followups SET owner_id = '${w.people.dana}', note = 'Ring Harbour' WHERE id = 1`);
      });

      it('of her own change of her own row goes through, as ever; so does one of a row she made and one she deleted', async () => {
        const changed = await call('dana', 'PATCH', 'followups/1', { values: { note: 'Changed' } });
        const undone = await w.app.inject({ method: 'POST', url: `/api/v1/data/undo/${json<{ undoToken: string }>(changed).undoToken}`, headers: { cookie: await as('dana') } });
        expect(undone.statusCode, undone.body).toBe(200);
        expect(await one('SELECT note FROM followups WHERE id = 1')).toEqual({ note: 'Ring Harbour' });
        const key = fresh();
        const made = await call('dana', 'POST', 'followups', { values: { id: key, deal_id: 1, owner_id: w.people.dana, note: 'New' } });
        expect(made.statusCode, made.body).toBeLessThan(300);
        const unmade = await w.app.inject({ method: 'POST', url: `/api/v1/data/undo/${json<{ undoToken: string }>(made).undoToken}`, headers: { cookie: await as('dana') } });
        expect(unmade.statusCode, unmade.body).toBe(200);
        expect(await w.rows(`SELECT id FROM followups WHERE id = ${String(key)}`)).toEqual([]);
        const gone = await call('dana', 'DELETE', 'followups/1?confirm=true');
        expect(gone.statusCode, gone.body).toBe(200);
        const back = await w.app.inject({ method: 'POST', url: `/api/v1/data/undo/${json<{ undoToken: string }>(gone).undoToken}`, headers: { cookie: await as('dana') } });
        expect(back.statusCode, back.body).toBe(200);
        expect(await one('SELECT note, owner_id FROM followups WHERE id = 1')).toEqual({ note: 'Ring Harbour', owner_id: w.people.dana });
      });

      it('of a row she made and somebody else was given since is refused: it is theirs to keep', async () => {
        const key = fresh();
        const made = await call('dana', 'POST', 'followups', { values: { id: key, deal_id: 1, owner_id: w.people.dana, note: 'New' } });
        await w.run(`UPDATE followups SET owner_id = '${w.people.omar}' WHERE id = ${String(key)}`);
        const unmade = await w.app.inject({ method: 'POST', url: `/api/v1/data/undo/${json<{ undoToken: string }>(made).undoToken}`, headers: { cookie: await as('dana') } });
        expect(unmade.statusCode, unmade.body).toBe(409);
        expect(await w.rows(`SELECT id FROM followups WHERE id = ${String(key)}`)).toHaveLength(1);
        await w.run(`DELETE FROM followups WHERE id = ${String(key)}`);
      });
    });

    describe('rows under a record', () => {
      it('a form shows the rows its reader reaches, and sending them back removes none of the others', async () => {
        const relation = await relationOf('followups');
        const tried = await call('dana', 'POST', 'deals/1/dry-run', { values: {}, children: { [relation]: [{ key: { id: 1 }, values: { note: 'Ring Harbour today' } }] } });
        expect(tried.statusCode, tried.body).toBe(200);
        expect(json<{ children: Record<string, { data: { id: number } }[]> }>(tried).children[relation]!.map((row) => Number(row.data.id))).toEqual([1]);
        const saved = await call('dana', 'PATCH', 'deals/1', { values: {}, children: { [relation]: [{ key: { id: 1 }, values: { note: 'Ring Harbour today' } }] } });
        expect(saved.statusCode, saved.body).toBe(200);
        // Omar's follow-up under the same deal is as it was: not hers to see, and not taken for one she removed.
        expect(await w.rows('SELECT id, note FROM followups WHERE deal_id = 1 ORDER BY id')).toEqual([
          { id: 1, note: 'Ring Harbour today' },
          { id: 2, note: 'Send the samples' },
        ]);
        await w.run(`UPDATE followups SET note = 'Ring Harbour' WHERE id = 1`);
      });

      it('a new row under it names its writer and nobody else', async () => {
        const relation = await relationOf('followups');
        const keep = { key: { id: 1 }, values: { note: 'Ring Harbour' } };
        const theirs = await call('dana', 'PATCH', 'deals/1', { values: {}, children: { [relation]: [keep, { values: { id: fresh(), note: 'For Omar', owner_id: w.people.omar } }] } });
        expect(theirs.statusCode, theirs.body).toBe(403);
        expect(await w.rows(`SELECT id FROM followups WHERE id = ${String(next)}`)).toEqual([]);
        const mine = await call('dana', 'PATCH', 'deals/1', { values: {}, children: { [relation]: [keep, { values: { id: fresh(), note: 'Mine', owner_id: w.people.dana } }] } });
        expect(mine.statusCode, mine.body).toBe(200);
        expect(await w.rows(`SELECT owner_id FROM followups WHERE id = ${String(next)}`)).toEqual([{ owner_id: w.people.dana }]);
        await w.run(`DELETE FROM followups WHERE id = ${String(next)}`);
      });
    });

    describe('a new record with rows under it', () => {
      it('each row under it is a new row, whatever key it is sent with: it names its writer and nobody else', async () => {
        const relation = await relationOf('followups');
        const sent = (owner: string, key?: number) => ({ values: deal(fresh(), { owner_id: w.people.dana }), children: { [relation]: [{ ...(key === undefined ? {} : { key: { id: key } }), values: { id: fresh(), note: 'Under a new deal', owner_id: owner } }] } });
        for (const key of [undefined, 2]) {
          const theirs = await call('dana', 'POST', 'deals', sent(w.people.omar, key));
          expect(theirs.statusCode, `${String(key)}: ${theirs.body}`).toBe(403);
          expect(await w.rows(`SELECT id FROM followups WHERE id = ${String(next)}`)).toEqual([]);
          expect(await w.rows(`SELECT id FROM deals WHERE id = ${String(next - 1)}`)).toEqual([]);
          // Tried without saving: the same answer, and nothing shown.
          expect((await call('dana', 'POST', 'deals/dry-run', sent(w.people.omar, key))).statusCode).toBe(403);
        }
        const mine = await call('dana', 'POST', 'deals', sent(w.people.dana));
        expect(mine.statusCode, mine.body).toBeLessThan(300);
        expect(await w.rows(`SELECT owner_id FROM followups WHERE id = ${String(next)}`)).toEqual([{ owner_id: w.people.dana }]);
      });

      it('and so is a row two levels down', async () => {
        const deals = await relationOf('deals');
        const followups = await relationOf('followups');
        const tree = (owner: string) => ({
          values: { id: fresh(), name: 'New company' },
          children: { [deals]: [{ values: deal(fresh(), { owner_id: w.people.dana, company_id: undefined }), children: { [followups]: [{ values: { id: fresh(), note: 'Two down', owner_id: owner } }] } }] },
        });
        const theirs = await call('dana', 'POST', 'companies', tree(w.people.omar));
        expect(theirs.statusCode, theirs.body).toBe(403);
        expect(await w.rows(`SELECT id FROM companies WHERE id = ${String(next - 2)}`)).toEqual([]);
        expect((await call('dana', 'POST', 'companies/dry-run', tree(w.people.omar))).statusCode).toBe(403);
        const mine = await call('dana', 'POST', 'companies', tree(w.people.dana));
        expect(mine.statusCode, mine.body).toBeLessThan(300);
        expect(await w.rows(`SELECT owner_id FROM followups WHERE id = ${String(next)}`)).toEqual([{ owner_id: w.people.dana }]);
      });
    });

    describe('links to many rows', () => {
      it('a set sent back keeps the links to rows its writer cannot see; one added names a row they reach', async () => {
        const relation = await relationOf('tickets');
        const links = async () => (await w.rows('SELECT ticket_id FROM deal_tickets WHERE deal_id = 1 ORDER BY ticket_id')).map((row) => Number(row.ticket_id));
        // Deal 1 is linked to ticket 1 (hers) and ticket 2 (Omar's). She sends back what she was shown.
        const same = await call('dana', 'PATCH', 'deals/1', { values: {}, links: { [relation]: [1] } });
        expect(same.statusCode, same.body).toBe(200);
        expect(await links()).toEqual([1, 2]);
        // She removes hers: Omar's stays.
        expect((await call('dana', 'PATCH', 'deals/1', { values: {}, links: { [relation]: [] } })).statusCode).toBe(200);
        expect(await links()).toEqual([2]);
        // She adds hers back, and tries Omar's and one that is not there: the same refusal for both.
        expect((await call('dana', 'PATCH', 'deals/1', { values: {}, links: { [relation]: [1] } })).statusCode).toBe(200);
        expect(await links()).toEqual([1, 2]);
        const theirs = await call('dana', 'PATCH', 'deals/1', { values: {}, links: { [relation]: [1, 3] } });
        const missing = await call('dana', 'PATCH', 'deals/1', { values: {}, links: { [relation]: [1, 999] } });
        expect(theirs.statusCode, theirs.body).toBe(409);
        expect(shape(theirs, 3)).toEqual(shape(missing, 999));
        expect(await links()).toEqual([1, 2]);
        // Somebody nothing limits replaces the whole set.
        expect((await call('lena', 'PATCH', 'deals/1', { values: {}, links: { [relation]: [1] } })).statusCode).toBe(200);
        expect(await links()).toEqual([1]);
        await w.run('INSERT INTO deal_tickets (deal_id, ticket_id) VALUES (1, 2)');
      });
    });

    describe('a delete', () => {
      it('of a row that rows out of the writer\'s sight hang off is refused, saying no more than that something holds it', async () => {
        // Deal 1 is Dana's; Omar's follow-up 2 is under it.
        const res = await call('dana', 'DELETE', 'deals/1?confirm=true');
        expect(res.statusCode, res.body).toBe(409);
        expect(json<{ error: { code: string; details: unknown } }>(res).error).toMatchObject({ code: 'FK_VIOLATION', details: { constraint: null, detail: null } });
        expect(await w.rows('SELECT id FROM deals WHERE id = 1')).toHaveLength(1);
        expect(await w.rows('SELECT id FROM followups WHERE deal_id = 1')).toHaveLength(2);
        // In a batch too: named, and nothing of the batch is kept.
        const batch = await call('dana', 'POST', 'deals/bulk', { action: 'delete', ids: [1] });
        expect(batch.statusCode, batch.body).toBe(409);
        expect(await w.rows('SELECT id FROM deals WHERE id = 1')).toHaveLength(1);
      });

      it('is refused the same way when the row under it has no owner at all, and when the delete is only tried', async () => {
        const key = fresh();
        await w.run(`INSERT INTO deals (id, title, owner_id, state, amount, big, company_id) VALUES (${String(key)}, 'With a stray', '${w.people.dana}', 'open', 1, ${dialect === 'postgres' ? 'false' : '0'}, 1)`);
        await w.run(`INSERT INTO followups (id, deal_id, owner_id, note) VALUES (${String(fresh())}, ${String(key)}, NULL, 'A stray')`);
        for (const query of ['confirm=true', 'dryRun=true']) {
          const res = await call('dana', 'DELETE', `deals/${String(key)}?${query}`);
          expect(res.statusCode, `${query}: ${res.body}`).toBe(409);
          expect(json<{ error: { code: string; details: unknown } }>(res).error).toMatchObject({ code: 'FK_VIOLATION', details: { constraint: null, detail: null } });
        }
        expect(await w.rows(`SELECT id FROM deals WHERE id = ${String(key)}`)).toHaveLength(1);
      });

      it('tried on a row with her own rows under it counts those, and no table she may not read', async () => {
        const key = fresh();
        await w.run(`INSERT INTO deals (id, title, owner_id, state, amount, big, company_id) VALUES (${String(key)}, 'With her own', '${w.people.dana}', 'open', 1, ${dialect === 'postgres' ? 'false' : '0'}, 1)`);
        await w.run(`INSERT INTO followups (id, deal_id, owner_id, note) VALUES (${String(fresh())}, ${String(key)}, '${w.people.dana}', 'Hers')`);
        await w.run(`INSERT INTO deal_members (id, deal_id, user_id) VALUES (${String(fresh())}, ${String(key)}, '${w.people.omar}')`);
        const tried = await call('dana', 'DELETE', `deals/${String(key)}?dryRun=true`);
        expect(tried.statusCode, tried.body).toBe(200);
        const references = json<{ references: { table: string; count: number }[] }>(tried).references;
        expect(references.find((reference) => reference.table === w.id('followups'))?.count).toBe(1);
        // The helpers' table is not hers to read: left out, not counted.
        expect(references.find((reference) => reference.table === w.id('deal_members'))).toBeUndefined();
        // Somebody nothing limits is told of every table, as ever.
        const whole = json<{ references: { table: string; count: number }[] }>(await call('lena', 'DELETE', `deals/${String(key)}?dryRun=true`)).references;
        expect(whole.find((reference) => reference.table === w.id('deal_members'))?.count).toBe(1);
      });

      it('of her own row with nothing under it goes through', async () => {
        const key = fresh();
        await w.run(`INSERT INTO deals (id, title, owner_id, state, amount, big, company_id) VALUES (${String(key)}, 'Spare', '${w.people.dana}', 'open', 1, ${dialect === 'postgres' ? 'false' : '0'}, 1)`);
        const res = await call('dana', 'DELETE', `deals/${String(key)}?confirm=true`);
        expect(res.statusCode, res.body).toBe(200);
        expect(await w.rows(`SELECT id FROM deals WHERE id = ${String(key)}`)).toEqual([]);
      });
    });

    describe('a key', () => {
      it('names nobody: a row it makes has no owner it could give, and it is told the key alone', async () => {
        const { apiKeysRepo, rolesRepo } = await import('@adminium/meta');
        const { generateApiKey } = await import('../src/rbac/api-keys.js');
        const token = generateApiKey();
        await apiKeysRepo(w.meta).create({ name: 'rep', tokenHash: token.tokenHash, prefix: token.prefix, roleId: (await rolesRepo(w.meta).findBySlug('rep'))!.id, createdBy: w.owner.id });
        const post = (values: Record<string, unknown>) => w.app.inject({ method: 'POST', url: `/api/v1/data/${w.connectionId}/deals`, headers: { authorization: `Bearer ${token.key}` }, payload: { values } });
        const named = await post(deal(fresh(), { owner_id: w.people.dana }));
        expect(named.statusCode, named.body).toBe(403);
        const bare = await post(deal(fresh()));
        expect(bare.statusCode, bare.body).toBeLessThan(300);
        expect(json<{ data: Record<string, unknown> }>(bare).data).toEqual({ id: next, _handedOver: true });
        // …and it changes no row: it reaches none.
        const patched = await w.app.inject({ method: 'PATCH', url: `/api/v1/data/${w.connectionId}/deals/1`, headers: { authorization: `Bearer ${token.key}` }, payload: { values: { title: 'By a key' } } });
        expect(patched.statusCode).toBe(404);
      });
    });
  });
}
