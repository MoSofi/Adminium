// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A create sent with a retry key (`clientKey`) to a table whose rows take a
 * resource for a time (`table.occupies`), on a real database of each engine.
 *
 * A retry key is there so a reply lost on the way back does not make two
 * rows, and a table that places rows is where a second row hurts most. So a
 * keyed create of ONE row is made as an unkeyed one is, under the same lock
 * and judged by the same rule; the same key again answers the row the first
 * made; and a key is no way round the rule: another key for days that are
 * taken is refused. A row with rows below it is still written one at a time.
 */
import { overridesRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runIntrospection } from '../src/connections/introspect.js';
import { ENGINES, world, type World } from './row-limit-world.js';

type Reply = { statusCode: number; body: string };
type Made = { data: Record<string, unknown>; replayed?: boolean; undoToken?: string | null };
type Refusal = { error: { code: string; message: string; details?: Record<string, unknown> } };

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`a create with a retry key on a table that places its rows [${dialect}]`, () => {
    let w: World;
    let covers = '';
    const json = <T>(res: Reply): T => JSON.parse(res.body) as T;
    const send = async (cookie: string, body: Record<string, unknown>): Promise<Reply> =>
      w.app.inject({ method: 'POST', url: `/api/v1/data/${w.connectionId}/${encodeURIComponent(covers)}`, headers: { cookie }, payload: body as never }) as unknown as Reply;
    const count = async (where: string): Promise<number> => Number(Object.values((await w.rows(`SELECT COUNT(*) AS n FROM covers WHERE ${where}`))[0]!)[0]);
    const span = (owner: string, from: string, to: string | null, id: number) => ({ id, owner_id: owner, cover_id: w.people.kim, starts_on: from, ends_on: to });
    const key = (n: number): string => `cover-retry-key-${String(n).padStart(10, '0')}`;

    beforeAll(async () => {
      w = await world(dialect);
      await w.run(`ALTER TABLE covers ADD COLUMN client_key VARCHAR(64)`);
      await w.run(`CREATE UNIQUE INDEX covers_client_key ON covers (client_key)`);
      await w.run(`CREATE TABLE cover_notes (id INTEGER PRIMARY KEY, cover_id INTEGER NOT NULL, note VARCHAR(80) NOT NULL, FOREIGN KEY (cover_id) REFERENCES covers(id))`);
      await runIntrospection({ manager: w.manager, meta: w.meta, connectionId: w.connectionId });
      covers = (await w.model()).tables.find((table) => table.name === 'covers')!.id;
      const rule = (op: string, value: unknown, column?: string) => overridesRepo(w.meta).create({ connectionId: w.connectionId, op, tableName: covers, ...(column === undefined ? {} : { columnName: column }), value, origin: 'user' } as never);
      await rule('table.occupies', { resource: 'owner_id', day: 'starts_on', until: 'ends_on' });
      await rule('column.retryKey', { retryKey: true }, 'client_key');
      // Kim stands in for people: somebody named in a cover reads the deals it opens to them.
      await w.role('cover-desk', { covers: { actions: ['read', 'create'] }, deals: { actions: ['read'] } });
      await w.give('kim', 'cover-desk');
    }, 120_000);
    afterAll(async () => {
      await w?.close();
    });

    it('makes the row, and answers the same key again with the row it made', async () => {
      const values = span(w.people.dana, '2027-01-10', '2027-01-14', 101);
      const first = await send(w.owner.cookie, { values, clientKey: key(1) });
      expect(first.statusCode, first.body).toBe(201);
      const made = json<Made>(first).data;
      expect(made['id']).toBe(101);
      // The key is kept as a keyed hash, never as sent.
      expect(made['client_key']).not.toBe(key(1));
      // The reply was lost; the same create is sent again, and nothing else of it matters.
      const again = await send(w.owner.cookie, { values: { ...values, id: 102, ends_on: '2027-01-20' }, clientKey: key(1) });
      expect(again.statusCode, again.body).toBe(200);
      expect(json<Made>(again)).toMatchObject({ data: { id: 101 }, replayed: true, undoToken: null });
      expect(await count(`owner_id = '${w.people.dana}' AND starts_on >= '2027-01-01'`)).toBe(1);
    });

    it('refuses another key for days that are taken, and an unkeyed create the same', async () => {
      const taken = await send(w.owner.cookie, { values: span(w.people.dana, '2027-01-12', '2027-01-18', 103), clientKey: key(2) });
      expect(taken.statusCode, taken.body).toBe(409);
      expect(json<Refusal>(taken).error).toMatchObject({ code: 'BOOKING_TAKEN', details: { column: 'starts_on' } });
      const plain = await send(w.owner.cookie, { values: span(w.people.dana, '2027-01-14', '2027-01-15', 104) });
      expect(json<Refusal>(plain).error).toMatchObject({ code: 'BOOKING_TAKEN' });
      // The refused key made nothing, so it is free to be used for days that are.
      const free = await send(w.owner.cookie, { values: span(w.people.dana, '2027-01-15', '2027-01-18', 103), clientKey: key(2) });
      expect(free.statusCode, free.body).toBe(201);
      expect(await count(`owner_id = '${w.people.dana}' AND starts_on >= '2027-01-01'`)).toBe(2);
    });

    it('makes one row of three creates sent at once under one key, and one of two keys for the same days', async () => {
      const values = span(w.people.omar, '2027-02-01', '2027-02-05', 110);
      const same = await Promise.all([0, 1, 2].map(() => send(w.owner.cookie, { values, clientKey: key(3) })));
      for (const res of same) expect([200, 201], res.body).toContain(res.statusCode);
      expect(same.filter((res) => res.statusCode === 201)).toHaveLength(1);
      expect(await count(`owner_id = '${w.people.omar}' AND starts_on = '2027-02-01'`)).toBe(1);
      const two = await Promise.all([0, 1].map((n) => send(w.owner.cookie, { values: span(w.people.mara, '2027-03-01', '2027-03-05', 120 + n), clientKey: key(10 + n) })));
      // One is made; the other waited its turn and is refused, or was asked to try again.
      expect(two.filter((res) => res.statusCode === 201), two.map((res) => res.body).join('\n')).toHaveLength(1);
      const lost = two.find((res) => res.statusCode !== 201)!;
      expect(['BOOKING_TAKEN', 'BOOKING_BUSY']).toContain(json<Refusal>(lost).error.code);
      expect(await count(`owner_id = '${w.people.mara}' AND starts_on = '2027-03-01'`)).toBe(1);
    });

    it('keeps one person’s key apart from another’s, and holds a keyed create to its writer’s rights', async () => {
      await w.give('mara', 'cover-desk');
      const mara = (await w.signIn('mara')).cookie;
      const first = await send(w.owner.cookie, { values: span(w.people.sam, '2027-04-01', '2027-04-02', 130), clientKey: key(20) });
      expect(first.statusCode, first.body).toBe(201);
      // The same key from somebody else is hers: a row of its own, judged by the rule.
      const hers = await send(mara, { values: span(w.people.sam, '2027-04-02', '2027-04-03', 131), clientKey: key(20) });
      expect(json<Refusal>(hers).error).toMatchObject({ code: 'BOOKING_TAKEN' });
      const free = await send(mara, { values: span(w.people.sam, '2027-04-03', '2027-04-04', 131), clientKey: key(20) });
      expect(free.statusCode, free.body).toBe(201);
      expect(json<Made>(free).data['id']).toBe(131);
      // Somebody with no right to make a cover is refused with or without a key.
      const dana = (await w.signIn('dana')).cookie;
      expect((await send(dana, { values: span(w.people.sam, '2027-05-01', '2027-05-02', 140), clientKey: key(21) })).statusCode).toBe(403);
    });

    it('still writes a row with rows below it one at a time', async () => {
      const notes = (await w.model()).tables.find((table) => table.name === 'cover_notes')!;
      const relation = (await w.model()).relations.find((one) => one.from.tableId === notes.id && one.to.tableId === covers)!;
      const tree = await send(w.owner.cookie, { values: span(w.people.kim, '2027-06-01', '2027-06-02', 150), clientKey: key(30), children: { [relation.id]: [{ values: { id: 1, note: 'Keys with the desk' } }] } });
      expect(tree.statusCode, tree.body).toBe(409);
      expect(json<Refusal>(tree).error).toMatchObject({ code: 'CONFLICT', details: { reason: 'CAPACITY_ONE_AT_A_TIME' } });
      expect(await count(`owner_id = '${w.people.kim}'`)).toBe(0);
    });
  });
}
