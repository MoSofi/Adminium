// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A ROW HUNG ON A PRIVATE ROW, REACHED BY THAT ROW'S OWN PEOPLE — on SQLite,
 * Postgres and MySQL, through the whole server.
 *
 * A one-to-one is private to its manager and its rep. Its steps are another
 * table, whose rows are reached through the one-to-one by the two people it
 * names (`{ column: one_to_one_id, person: rep_id }` and `… person:
 * manager_id`): exactly who already reads the one-to-one. So:
 *
 *  - each of the two reads the steps (one by one and in a list), changes
 *    them, and adds one — the manager too, though her way is the second of
 *    the link's two;
 *  - a third person is refused each of those: a colleague, or the other
 *    manager whose own one-to-one with the same rep is a different row;
 *  - a manager whose reach of the steps is her TEAM's does not reach, through
 *    her rep, the steps of a one-to-one another manager holds with that rep:
 *    a private row is read by its own people, never by whoever leads them.
 *
 * The world's one-to-ones: 1 Mara+Dana, 2 Lena+Sam, 3 Mara+Omar, and here 4
 * Lena+Omar (Omar's one-to-one with a manager who is not his lead). Mara
 * leads Dana and Omar.
 */
import { parseDatabaseModel } from '@adminium/engine';
import { overridesRepo, permissionsRepo, rolesRepo, snapshotsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runIntrospection } from '../src/connections/introspect.js';
import { ENGINES, world, type PersonName, type World } from './row-limit-world.js';

const OWN = { reach: 'own' } as const;
const NONE = { read: false, create: false, update: false, delete: false, export: false, import: false };

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`a row hung on a private row [${dialect}]`, () => {
    let w: World;
    let steps: string;
    const cookies = new Map<PersonName, string>();
    const as = async (who: PersonName): Promise<string> => {
      if (!cookies.has(who)) cookies.set(who, (await w.signIn(who)).cookie);
      return cookies.get(who)!;
    };
    type Reply = { statusCode: number; body: string };
    const call = async (who: PersonName, method: 'GET' | 'POST' | 'PATCH', path: string, payload?: Record<string, unknown>): Promise<Reply> =>
      w.app.inject({ method, url: `/api/v1/data/${w.connectionId}/${path}`, headers: { cookie: await as(who) }, ...(payload === undefined ? {} : { payload }) });
    const ids = (res: Reply): number[] => (JSON.parse(res.body) as { data: { id: number }[] }).data.map((row) => Number(row.id));
    const codeOf = (res: Reply): string | undefined => (JSON.parse(res.body) as { error?: { code: string } }).error?.code;
    const textOf = async (key: number): Promise<string> => String((await w.rows(`SELECT text FROM oto_steps WHERE id = ${String(key)}`))[0]?.['text']);
    let next = 100;
    const fresh = (): number => (next += 1);

    beforeAll(async () => {
      w = await world(dialect);
      await w.run(`INSERT INTO one_to_ones (id, manager_id, rep_id, note) VALUES (4, '${w.people.lena}', '${w.people.omar}', 'Omar, with Lena')`);
      await w.run('CREATE TABLE oto_steps (id INTEGER PRIMARY KEY, one_to_one_id INTEGER NOT NULL, text VARCHAR(200) NOT NULL, FOREIGN KEY (one_to_one_id) REFERENCES one_to_ones(id))');
      await w.run(`INSERT INTO oto_steps (id, one_to_one_id, text) VALUES (1, 1, 'Dana: call two clients'), (2, 2, 'Sam: shadow Lena'), (3, 3, 'Omar: pipeline review'), (4, 4, 'Omar, with Lena: a course')`);
      await runIntrospection({ manager: w.manager, meta: w.meta, connectionId: w.connectionId });
      steps = parseDatabaseModel((await snapshotsRepo(w.meta).latest(w.connectionId))!.schema).tables.find((table) => table.name === 'oto_steps')!.id;
      // Whose a step is: the rep's and the manager's of the one-to-one it hangs on.
      await overridesRepo(w.meta).create({ connectionId: w.connectionId, op: 'table.belongs', tableName: steps, value: { ways: [{ column: 'one_to_one_id', person: 'rep_id' }, { column: 'one_to_one_id', person: 'manager_id' }] }, origin: 'user' });
      await w.role('stepper', { one_to_ones: { actions: ['read', 'create', 'update'], rows: { read: OWN, update: OWN } } });
      const stepper = (await rolesRepo(w.meta).findBySlug('stepper'))!;
      await permissionsRepo(w.meta).grant(stepper.id, 'table', `${w.connectionId}/${steps}`, { ...NONE, read: true, create: true, update: true, rowLimit: { read: OWN, update: OWN } } as never);
      for (const person of ['mara', 'dana', 'omar', 'lena', 'sam'] as const) await w.give(person, 'stepper');
    }, 180_000);
    afterAll(async () => {
      await w?.close();
    });

    it('reads: each of a one-to-one\'s two people reaches its steps; nobody else does', async () => {
      const listed = async (who: PersonName) => ids(await call(who, 'GET', 'oto_steps?order=id.asc'));
      expect(await listed('dana')).toEqual([1]);
      expect(await listed('mara')).toEqual([1, 3]);
      expect(await listed('omar')).toEqual([3, 4]);
      expect(await listed('lena')).toEqual([2, 4]);
      expect(await listed('sam')).toEqual([2]);
      for (const who of ['dana', 'mara'] as const) expect((await call(who, 'GET', 'oto_steps/1')).statusCode).toBe(200);
      // A colleague, and a manager whose one-to-one with the same rep is another row: as a row that is not there.
      for (const who of ['omar', 'lena'] as const) expect((await call(who, 'GET', 'oto_steps/1')).statusCode).toBe(404);
      expect((await call('mara', 'GET', 'oto_steps/4')).statusCode).toBe(404);
    });

    it('changes: the rep and the manager change a step; a third person is refused', async () => {
      const byDana = await call('dana', 'PATCH', 'oto_steps/1', { values: { text: 'Dana: call three clients' } });
      expect(byDana.statusCode, byDana.body).toBe(200);
      const byMara = await call('mara', 'PATCH', 'oto_steps/1', { values: { text: 'Dana: call four clients' } });
      expect(byMara.statusCode, byMara.body).toBe(200);
      expect(await textOf(1)).toBe('Dana: call four clients');
      for (const who of ['omar', 'lena'] as const) {
        const refused = await call(who, 'PATCH', 'oto_steps/1', { values: { text: `Changed by ${who}` } });
        expect([who, refused.statusCode]).toEqual([who, 404]);
      }
      expect(await textOf(1)).toBe('Dana: call four clients');
      // Moved onto a one-to-one that is not hers: refused, and the step stays where it was.
      const moved = await call('mara', 'PATCH', 'oto_steps/1', { values: { one_to_one_id: 4 } });
      expect([moved.statusCode, codeOf(moved)]).toEqual([409, 'FK_VIOLATION']);
      expect((await w.rows('SELECT one_to_one_id FROM oto_steps WHERE id = 1'))[0]).toEqual({ one_to_one_id: 1 });
    });

    it('adds: the rep and the manager each add a step under their one-to-one; a third person is refused', async () => {
      for (const who of ['dana', 'mara'] as const) {
        const key = fresh();
        const made = await call(who, 'POST', 'oto_steps', { values: { id: key, one_to_one_id: 1, text: `Added by ${who}` } });
        expect(made.statusCode, made.body).toBeLessThan(300);
        expect(await textOf(key)).toBe(`Added by ${who}`);
      }
      for (const who of ['omar', 'lena'] as const) {
        const key = fresh();
        const refused = await call(who, 'POST', 'oto_steps', { values: { id: key, one_to_one_id: 1, text: `Added by ${who}` } });
        // The link names a row that is not theirs to hang anything on: refused as a row that is not there.
        expect([who, refused.statusCode, codeOf(refused)]).toEqual([who, 409, 'FK_VIOLATION']);
        expect(await w.rows(`SELECT id FROM oto_steps WHERE id = ${String(key)}`)).toEqual([]);
      }
    });

    it('a team\'s reach of the steps does not open, through her rep, another manager\'s one-to-one', async () => {
      const lead = await rolesRepo(w.meta).create({ slug: 'step-lead', name: 'Step lead' });
      await permissionsRepo(w.meta).grant(lead.id, 'table', `${w.connectionId}/${steps}`, { ...NONE, read: true, update: true, rowLimit: { read: { reach: 'team' }, update: { reach: 'team' } } } as never);
      await w.give('mara', 'step-lead');
      try {
        // Mara leads Omar, and Omar's one-to-one 4 is with Lena: its step is Lena's and Omar's, not Mara's.
        expect(ids(await call('mara', 'GET', 'oto_steps?order=id.asc'))).not.toContain(4);
        expect((await call('mara', 'GET', 'oto_steps/4')).statusCode).toBe(404);
        expect((await call('mara', 'PATCH', 'oto_steps/4', { values: { text: 'Changed by Mara' } })).statusCode).toBe(404);
        expect(await textOf(4)).toBe('Omar, with Lena: a course');
        // Her own one-to-ones' steps she still reaches.
        expect(ids(await call('mara', 'GET', 'oto_steps?order=id.asc'))).toEqual(expect.arrayContaining([1, 3]));
      } finally {
        await w.take('mara', 'step-lead');
      }
    });
  });
}
