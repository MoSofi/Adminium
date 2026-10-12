// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The live frames of a table, as somebody whose role reaches only some of
 * its rows gets them, through the whole
 * server's own hub and frame filter on every engine: the frame of a row of
 * theirs; a key with no row for one that was handed away; NOTHING for a
 * colleague's; and, where whose a row is cannot be told from the row (a
 * person's row, a listing, a parent), a bare "this table changed".
 *
 * Follow-ups are their own person's by one staff column: 1 Dana, 2 Omar,
 * 3 Omar, 4 Dana. Mara leads both.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { widgetDataChannel, type RealtimeEvent } from '../src/realtime/hub.js';
import { orderedSink, readLimitedFrames } from '../src/realtime/read-frames.js';
import { ENGINES, world, type PersonName, type TableName, type World } from './row-limit-world.js';

const OWN = { reach: 'own' } as const;
const TEAM = { reach: 'team' } as const;

type Who = PersonName | 'owner';
type Frame = { type: string; pk: Record<string, unknown> | null; row: Record<string, unknown> | null; changed?: true };

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`live frames of a limited table [${dialect}]`, () => {
    let w: World;
    const cookies = new Map<Who, string>();
    const as = async (who: Who): Promise<string> => {
      if (!cookies.has(who)) cookies.set(who, who === 'owner' ? w.owner.cookie : (await w.signIn(who)).cookie);
      return cookies.get(who)!;
    };
    const call = async (who: Who, method: 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) => {
      const res = await w.app.inject({ method, url: `/api/v1/data/${w.connectionId}/${url}`, headers: { cookie: await as(who) }, ...(payload === undefined ? {} : { payload: payload as never }) });
      expect(res.statusCode, `${method} ${url}: ${res.body}`).toBeLessThan(300);
      return res;
    };
    const table = (name: TableName): string => encodeURIComponent(w.id(name));

    /** Everybody watching a table, each through the server's own filter; `stop` answers what each was sent. */
    const watch = async (name: TableName, people: Who[]): Promise<() => Promise<Record<string, Frame[]>>> => {
      const channel = widgetDataChannel(w.connectionId, w.id(name));
      const frameFor = readLimitedFrames(w.meta);
      const got: Record<string, Frame[]> = {};
      const offs: (() => void)[] = [];
      for (const who of people) {
        got[who] = [];
        const id = who === 'owner' ? w.owner.id : w.people[who];
        offs.push(w.app.realtime.subscribe(channel, orderedSink(await frameFor({ id }, channel), (event: RealtimeEvent) => got[who]!.push(event.data as Frame))));
      }
      return async () => {
        // Each frame is judged after its publisher returns: let the judging finish.
        for (let turn = 0; turn < 20; turn += 1) await new Promise((resolve) => setTimeout(resolve, 5));
        for (const off of offs) off();
        return got;
      };
    };
    const shape = (frames: Frame[]): (string | number | null)[][] => frames.map((frame) => [frame.type, frame.pk === null ? null : Number(frame.pk['id']), frame.row === null ? null : String(frame.row['note'] ?? frame.row['title'] ?? frame.row['total'] ?? ''), frame.changed === true ? 'changed' : null]);

    beforeAll(async () => {
      w = await world(dialect);
      const all = ['read', 'create', 'update', 'delete'] as const;
      await w.role('rep', {
        followups: { actions: [...all], rows: { read: OWN, update: OWN, delete: OWN } },
        deals: { actions: ['read', 'update'], rows: { read: OWN, update: OWN } },
        quotes: { actions: ['read'], rows: { read: OWN } },
        one_to_ones: { actions: ['read', 'update'], rows: { read: OWN, update: OWN } },
      });
      await w.role('manager', { followups: { actions: [...all], rows: { read: TEAM, update: TEAM, delete: TEAM } }, deals: { actions: ['read'], rows: { read: TEAM } }, one_to_ones: { actions: ['read', 'update'], rows: { read: OWN, update: OWN } } });
      await w.role('reader', { followups: { actions: [...all] }, deals: { actions: ['read', 'update'] }, quotes: { actions: ['read', 'update'] } });
      for (const person of ['dana', 'omar'] as const) await w.give(person, 'rep');
      await w.give('mara', 'manager');
      await w.give('lena', 'reader');
    }, 120_000);
    afterAll(async () => {
      await w?.close();
    });

    it('a row of a colleague is told to nobody it is not theirs to read', async () => {
      const stop = await watch('followups', ['dana', 'omar', 'mara', 'lena']);
      // Lena, whom nothing limits, changes Omar's follow-up 2.
      await call('lena', 'PATCH', `${table('followups')}/2`, { values: { note: 'Samples sent' } });
      const got = await stop();
      expect(got['dana']).toEqual([]);
      for (const who of ['omar', 'mara', 'lena']) expect(shape(got[who]!), who).toEqual([['record.update', 2, 'Samples sent', null]]);
    });

    it('a row handed to a colleague is a key with no row for the one it left', async () => {
      const stop = await watch('followups', ['dana', 'omar', 'mara']);
      await call('lena', 'PATCH', `${table('followups')}/1`, { values: { owner_id: w.people.omar, note: 'Now Omar rings Harbour' } });
      const got = await stop();
      expect(shape(got['dana']!)).toEqual([['record.update', 1, null, null]]);
      // Marked: a key with no row is also how "a file was attached" arrives, and only the mark tells her screen to let go of the row.
      expect(got['dana']!.map((frame) => (frame as { gone?: unknown }).gone)).toEqual([true]);
      expect(got['omar']!.map((frame) => (frame as { gone?: unknown }).gone)).toEqual([undefined]);
      expect(shape(got['omar']!)).toEqual([['record.update', 1, 'Now Omar rings Harbour', null]]);
      expect(shape(got['mara']!)).toEqual([['record.update', 1, 'Now Omar rings Harbour', null]]);
      await w.run(`UPDATE followups SET owner_id = '${w.people.dana}', note = 'Ring Harbour' WHERE id = 1`);
    });

    it('a new row and a deleted one go to the people they belong to', async () => {
      const stop = await watch('followups', ['dana', 'omar', 'mara']);
      await call('lena', 'POST', table('followups'), { values: { id: 50, deal_id: 3, owner_id: w.people.omar, note: 'New for Omar' } });
      await call('lena', 'DELETE', `${table('followups')}/50`);
      const got = await stop();
      expect(got['dana']).toEqual([]);
      expect(shape(got['omar']!)).toEqual([['record.create', 50, 'New for Omar', null], ['record.delete', 50, 'New for Omar', null]]);
      expect(got['mara']).toHaveLength(2);
    });

    it('many rows changed at once are judged one by one, with what each was before', async () => {
      const stop = await watch('followups', ['dana', 'omar']);
      // Follow-ups 3 (Omar's) and 4 (Dana's) both go to Omar.
      await call('lena', 'POST', `${table('followups')}/bulk`, { action: 'update', ids: ['3', '4'], values: { owner_id: w.people.omar } });
      const got = await stop();
      expect(shape(got['dana']!)).toEqual([['record.update', 4, null, null]]);
      expect(shape(got['omar']!).map((frame) => frame[1]).sort()).toEqual([3, 4]);
      await w.run(`UPDATE followups SET owner_id = '${w.people.dana}' WHERE id = 4`);
    });

    it('a table whose people are found through a listing or a parent says only that it changed', async () => {
      const deals = await watch('deals', ['dana', 'lena']);
      // Deal 3 is Omar's; a deal belongs by its owner, its helpers and the cover for its owner.
      await call('lena', 'PATCH', `${table('deals')}/3`, { values: { title: 'Deal 3, renamed' } });
      const seen = await deals();
      expect(seen['dana']).toEqual([{ type: 'record.update', pk: null, row: null, changed: true }]);
      expect(shape(seen['lena']!)).toEqual([['record.update', 3, 'Deal 3, renamed', null]]);
      await w.run(`UPDATE deals SET title = 'Deal 3' WHERE id = 3`);

      const quotes = await watch('quotes', ['dana', 'lena']);
      // Quote 2 is under Omar's deal 3.
      await call('lena', 'PATCH', `${table('quotes')}/2`, { values: { total: 201 } });
      const told = await quotes();
      expect(told['dana']).toEqual([{ type: 'record.update', pk: null, row: null, changed: true }]);
      expect(told['lena']).toHaveLength(1);
      expect(JSON.stringify(told['dana'])).not.toContain('201');
      await w.run('UPDATE quotes SET total = 200 WHERE id = 2');
    });

    it('a private note is told to its two people and to nobody else, the Super Admin included', async () => {
      const stop = await watch('one_to_ones', ['mara', 'dana', 'omar', 'owner']);
      // One-to-one 1 is Mara's with Dana.
      await call('mara', 'PATCH', `${table('one_to_ones')}/1`, { values: { note: 'Dana, September' } });
      const got = await stop();
      expect(got['mara']).toHaveLength(1);
      expect(got['dana']).toHaveLength(1);
      expect(got['omar']).toEqual([]);
      expect(got['owner']).toEqual([]);
      expect(JSON.stringify([got['omar'], got['owner']])).not.toContain('September');
    });

    it('a role that reaches its own rows only while a column holds a value is told of none of a colleague\'s', async () => {
      await w.role('opener', { deals: { actions: ['read'] }, followups: { actions: ['read'], rows: { read: { reach: 'own', while: { column: 'note', in: ['Open'] } } } } });
      await w.give('kim', 'opener');
      await w.run(`INSERT INTO followups (id, deal_id, owner_id, note) VALUES (60, 1, '${w.people.kim}', 'Open')`);
      const stop = await watch('followups', ['kim']);
      // Omar's follow-up 2: not hers by its people, whatever its note.
      await call('lena', 'PATCH', `${table('followups')}/2`, { values: { note: 'Open' } });
      // Her own: hers by its people, and whether the note still fits is for the screen to ask.
      await call('lena', 'PATCH', `${table('followups')}/60`, { values: { note: 'Closed' } });
      const got = await stop();
      expect(got['kim']).toEqual([{ type: 'record.update', pk: null, row: null, changed: true }]);
      await w.run('DELETE FROM followups WHERE id = 60');
    });

    it('a way that can no longer be read tells nobody a row, where "nobody owns it" would have told everybody', async () => {
      await w.role('inbox', { followups: { actions: ['read'], rows: { read: { reach: 'own', unowned: true } } } });
      await w.give('sam', 'inbox');
      // The owner column loses its mark: no row is anybody's by it any more, and none is "nobody's" either.
      await w.meta.db.deleteFrom('adminium_schema_overrides').where('connectionId', '=', w.connectionId).where('op', '=', 'column.staff' as never).where('tableName', '=', w.id('followups')).execute();
      try {
        const stop = await watch('followups', ['sam', 'lena']);
        await call('lena', 'PATCH', `${table('followups')}/2`, { values: { note: 'Unmarked' } });
        const got = await stop();
        expect(got['sam']).toEqual([{ type: 'record.update', pk: null, row: null, changed: true }]);
        expect(JSON.stringify(got['sam'])).not.toContain('Unmarked');
        expect(got['lena']).toHaveLength(1);
        // …as a list answers her nothing of that table.
        const listed = await w.app.inject({ method: 'GET', url: `/api/v1/data/${w.connectionId}/${table('followups')}`, headers: { cookie: await as('sam') } });
        expect((JSON.parse(listed.body) as { data: unknown[] }).data).toEqual([]);
      } finally {
        const { overridesRepo } = await import('@adminium/meta');
        await overridesRepo(w.meta).create({ connectionId: w.connectionId, op: 'column.staff', tableName: w.id('followups'), columnName: 'owner_id', value: { staff: true }, origin: 'user' });
      }
    });

    it('a frame that names a row and says nothing of whose it is goes to nobody as a row', async () => {
      const stop = await watch('followups', ['lena', 'dana']);
      w.app.realtime.publish(widgetDataChannel(w.connectionId, w.id('followups')), 'record.update', { type: 'record.update', pk: { id: 2 }, row: { id: 2, note: 'From nowhere' } });
      const got = await stop();
      for (const who of ['lena', 'dana']) expect(got[who], who).toEqual([{ type: 'record.update', pk: null, row: null, changed: true }]);
    });

    it('a team change holds from the next frame on', async () => {
      const { teamsRepo } = await import('@adminium/meta');
      const teams = teamsRepo(w.meta);
      const north = (await teams.list()).find((team) => team.name === 'North')!;
      const stop = await watch('followups', ['mara']);
      await call('lena', 'PATCH', `${table('followups')}/2`, { values: { note: 'One' } });
      await new Promise((resolve) => setTimeout(resolve, 30));
      await teams.removeMember(north.id, w.people.omar);
      await call('lena', 'PATCH', `${table('followups')}/2`, { values: { note: 'Two' } });
      const got = await stop();
      expect(shape(got['mara']!).map((frame) => frame[2])).toEqual(['One']);
      await teams.setMember(north.id, w.people.omar, false);
    });
  });
}
