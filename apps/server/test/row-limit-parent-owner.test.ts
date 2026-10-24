// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "TEAM" JUDGED BY THE PARENT'S OWNER, against the whole server on every
 * engine: a reach of a child table that names its parent (`via`) and a
 * staff column of the parent (`by`) reaches a child row only where the
 * parent's owner is the person or somebody they lead — also where the child
 * names a person of its own.
 *
 * The firm of `row-limit-world.ts`: Mara leads North (Dana, Omar); Lena
 * leads South (Sam, and Mara sits there). Dana helps on Sam's deal 8. The
 * visits hang off their deal (`via: deal_id`) and are their rep's too
 * (`rep_id`, a team column):
 *
 *   1  deal 8 (Sam's)   by Dana   the helper's own visit on another team's deal
 *   2  deal 8 (Sam's)   by Sam
 *   3  deal 1 (Dana's)  by Dana
 *   4  deal 1 (Dana's)  by Sam    South's rep visiting North's deal
 *
 * Each manager's role reads deals "of the team, by owner" and visits "of the
 * team, by the deal's owner". So Mara reaches visits 3 and 4 and is refused
 * 1 and 2, though Dana is on deal 8 and visit 1 names Dana; Lena reaches 1
 * and 2 and is refused 4, though it names Sam. Every door is asked: the
 * list and the record, a change, a new row, a dashboard figure and its
 * cache, the live frames, and the role editor's count.
 */
import { overridesRepo, type RowReach } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runIntrospection } from '../src/connections/introspect.js';
import { widgetDataChannel, type RealtimeEvent } from '../src/realtime/hub.js';
import { orderedSink, readLimitedFrames } from '../src/realtime/read-frames.js';
import { ENGINES, world, type PersonName, type World } from './row-limit-world.js';

const BY_OWNER: RowReach = { reach: 'team', by: 'owner_id' };
const BY_DEAL_OWNER: RowReach = { reach: 'team', via: 'deal_id', by: 'owner_id' };

type Who = PersonName | 'owner';
type Reply = { statusCode: number; body: string };
type Frame = { type: string; pk: Record<string, unknown> | null; row: Record<string, unknown> | null; changed?: true };

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`team judged by the parent's owner [${dialect}]`, () => {
    let w: World;
    let visits = '';
    const cookies = new Map<Who, string>();
    const as = async (who: Who): Promise<string> => {
      if (!cookies.has(who)) cookies.set(who, who === 'owner' ? w.owner.cookie : (await w.signIn(who)).cookie);
      return cookies.get(who)!;
    };
    const call = async (who: Who, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown): Promise<Reply> =>
      w.app.inject({ method, url: `/api/v1/${url}`, headers: { cookie: await as(who) }, ...(payload === undefined ? {} : { payload: payload as never }) });
    const get = (who: Who, url: string) => call(who, 'GET', url);
    const data = (path: string): string => `data/${w.connectionId}/${path}`;
    const json = <T = Record<string, unknown>>(res: Reply): T => JSON.parse(res.body) as T;
    const ids = (res: Reply): number[] => json<{ data: { id: unknown }[] }>(res).data.map((row) => Number(row.id));
    const v = (): string => encodeURIComponent(visits);
    const listed = async (who: Who): Promise<number[]> => {
      const res = await get(who, data(`${v()}?order=id.asc`));
      expect(res.statusCode, res.body).toBe(200);
      return ids(res);
    };
    const counted = async (who: Who): Promise<number> => {
      const res = await call(who, 'POST', 'widget-data/query', { descriptor: { connectionId: w.connectionId, source: { name: 'visits', ...(visits.includes('.') && dialect === 'postgres' ? { schema: 'public' } : {}) }, shape: 'single-metric', aggregations: [{ fn: 'count', alias: 'n' }] } });
      expect(res.statusCode, res.body).toBe(200);
      return Number(json<{ result: { value: number } }>(res).result.value);
    };
    /** A missing row and an unreached one, told apart by nothing but the key. */
    const shape = (res: Reply, key: number): unknown => ({ status: res.statusCode, body: res.body.replace(new RegExp(`\\b${String(key)}\\b`, 'g'), 'KEY').replace(/req_[0-9a-zA-Z]+/g, 'REQ') });
    const reason = (res: Reply): unknown => json<{ error?: { details?: { reason?: unknown } } }>(res).error?.details?.reason;

    beforeAll(async () => {
      w = await world(dialect);
      await w.run('CREATE TABLE visits (id INTEGER PRIMARY KEY, deal_id INTEGER NOT NULL, rep_id VARCHAR(36), note VARCHAR(80) NOT NULL, FOREIGN KEY (deal_id) REFERENCES deals(id))');
      await runIntrospection({ manager: w.manager, meta: w.meta, connectionId: w.connectionId });
      visits = (await w.model()).tables.find((table) => table.name === 'visits')!.id;
      const overrides = overridesRepo(w.meta);
      await overrides.create({ connectionId: w.connectionId, op: 'column.staff', tableName: visits, columnName: 'rep_id', value: { staff: true }, origin: 'user' });
      await overrides.create({ connectionId: w.connectionId, op: 'table.belongs', tableName: visits, value: { ways: [{ column: 'rep_id', set: 'team' }, { via: 'deal_id' }] }, origin: 'user' });
      await w.run(`INSERT INTO deal_members (id, deal_id, user_id) VALUES (8, 8, '${w.people.dana}')`);
      await w.run(
        `INSERT INTO visits (id, deal_id, rep_id, note) VALUES (1, 8, '${w.people.dana}', 'Dana helps Sam'), (2, 8, '${w.people.sam}', 'Sam on his own'), (3, 1, '${w.people.dana}', 'Dana on hers'), (4, 1, '${w.people.sam}', 'Sam visits for Dana')`,
      );

      // A manager: the deals her team owns, and the visits of those deals. A second, wider one reads the deals by every way.
      await w.role('manager', { deals: { actions: ['read', 'update'], rows: { read: BY_OWNER, update: BY_OWNER } } });
      await w.role('wide-manager', { deals: { actions: ['read'], rows: { read: { reach: 'team' } } } });
      const { permissionsRepo, rolesRepo } = await import('@adminium/meta');
      const grant = async (slug: string, rowLimit: Record<string, unknown>): Promise<void> => {
        const role = (await rolesRepo(w.meta).findBySlug(slug))!;
        await permissionsRepo(w.meta).grant(role.id, 'table', `${w.connectionId}/${visits}`, { read: true, create: true, update: true, delete: false, export: false, import: false, rowLimit } as never);
      };
      await grant('manager', { read: BY_DEAL_OWNER, update: BY_DEAL_OWNER });
      await grant('wide-manager', { read: BY_DEAL_OWNER, update: BY_DEAL_OWNER });
      await w.give('mara', 'manager');
      await w.give('lena', 'manager');
    }, 180_000);
    afterAll(async () => {
      await w?.close();
    });

    it('the list and the record: a manager reads the visits of her team\'s deals, never another team\'s deal her rep helps on', async () => {
      expect(await listed('mara')).toEqual([3, 4]);
      expect(await listed('lena')).toEqual([1, 2]);
      // The helper's own visit on Sam's deal names Dana, whom Mara leads: still South's.
      for (const key of [1, 2]) expect(shape(await get('mara', data(`${v()}/${String(key)}`)), key), `visit ${String(key)}`).toEqual(shape(await get('mara', data(`${v()}/999`)), 999));
      expect((await get('mara', data(`${v()}/4`))).statusCode).toBe(200);
      expect((await get('lena', data(`${v()}/1`))).statusCode).toBe(200);
      // A visit by Lena's rep on North's deal is North's.
      expect((await get('lena', data(`${v()}/4`))).statusCode).toBe(404);
      // The deal itself: Mara is refused Sam's deal 8 (R1d's `by`), the deal owner's manager reads it.
      expect((await get('mara', data('deals/8'))).statusCode).toBe(404);
      expect((await get('lena', data('deals/8'))).statusCode).toBe(200);
    });

    it('a change: refused on another team\'s deal as a row that is not there, made on her own team\'s', async () => {
      const refused = await call('mara', 'PATCH', data(`${v()}/1`), { values: { note: 'Mara was here' } });
      expect(shape(refused, 1)).toEqual(shape(await call('mara', 'PATCH', data(`${v()}/999`), { values: { note: 'Mara was here' } }), 999));
      expect((await w.rows('SELECT note FROM visits WHERE id = 1'))[0]).toEqual({ note: 'Dana helps Sam' });
      // The deal owner's manager changes the helper's visit, and may give it back to its own deal's people.
      expect((await call('lena', 'PATCH', data(`${v()}/1`), { values: { note: 'Seen by Lena' } })).statusCode).toBe(200);
      expect((await call('mara', 'PATCH', data(`${v()}/4`), { values: { note: 'Seen by Mara' } })).statusCode).toBe(200);
      await w.run(`UPDATE visits SET note = 'Dana helps Sam' WHERE id = 1`);
      await w.run(`UPDATE visits SET note = 'Sam visits for Dana' WHERE id = 4`);
    });

    it('a new row: hung only under a deal her team owns, whoever it names', async () => {
      // With deals read by every way, Mara reads Sam's deal 8 (Dana is on it): a visit there naming Dana is still not hers to add.
      await w.take('mara', 'manager');
      await w.give('mara', 'wide-manager');
      try {
        expect((await get('mara', data('deals/8'))).statusCode).toBe(200);
        const refused = await call('mara', 'POST', data(v()), { values: { id: 20, deal_id: 8, rep_id: w.people.dana, note: 'Mara adds to Sam' } });
        expect(refused.statusCode, refused.body).toBe(403);
        expect(reason(refused)).toBe('parent-not-theirs');
        const made = await call('mara', 'POST', data(v()), { values: { id: 21, deal_id: 1, rep_id: w.people.dana, note: 'Mara adds to Dana' } });
        expect(made.statusCode, made.body).toBeLessThan(300);
        // …and moving a visit of hers onto Sam's deal is the same refusal.
        const moved = await call('mara', 'PATCH', data(`${v()}/21`), { values: { deal_id: 8 } });
        expect(moved.statusCode, moved.body).toBe(403);
        expect(await w.rows('SELECT id FROM visits WHERE id IN (20, 21) ORDER BY id')).toEqual([{ id: 21 }]);
      } finally {
        await w.run('DELETE FROM visits WHERE id IN (20, 21)');
        await w.take('mara', 'wide-manager');
        await w.give('mara', 'manager');
      }
    });

    it('a dashboard figure counts her team\'s deals\' visits, and moves at once when a deal changes hands', async () => {
      expect(await counted('mara')).toBe(2);
      expect(await counted('lena')).toBe(2);
      // Sam's deal 8 handed to Dana, by somebody nothing limits: its visits are North's now, the kept figures notwithstanding.
      expect((await call('owner', 'PATCH', data('deals/8'), { values: { owner_id: w.people.dana } })).statusCode).toBe(200);
      try {
        expect(await counted('mara')).toBe(4);
        expect(await counted('lena')).toBe(0);
        expect(await listed('mara')).toEqual([1, 2, 3, 4]);
      } finally {
        expect((await call('owner', 'PATCH', data('deals/8'), { values: { owner_id: w.people.sam } })).statusCode).toBe(200);
      }
      expect(await counted('mara')).toBe(2);
    });

    it('the live frames of the visits tell her that something changed, never a row', async () => {
      const channel = widgetDataChannel(w.connectionId, visits);
      const got: Record<string, Frame[]> = { mara: [], lena: [] };
      const frameFor = readLimitedFrames(w.meta);
      const offs = [];
      for (const who of ['mara', 'lena'] as const) offs.push(w.app.realtime.subscribe(channel, orderedSink(await frameFor({ id: w.people[who] }, channel), (event: RealtimeEvent) => got[who]!.push(event.data as Frame))));
      expect((await call('owner', 'PATCH', data(`${v()}/1`), { values: { note: 'A new note' } })).statusCode).toBe(200);
      for (let turn = 0; turn < 20; turn += 1) await new Promise((resolve) => setTimeout(resolve, 5));
      for (const off of offs) off();
      await w.run(`UPDATE visits SET note = 'Dana helps Sam' WHERE id = 1`);
      for (const who of ['mara', 'lena']) {
        expect(got[who]!.length, who).toBeGreaterThan(0);
        for (const frame of got[who]!) expect([frame.pk, frame.row, frame.changed], who).toEqual([null, null, true]);
      }
    });

    it('the role editor counts what the reach would reach, and refuses a parent the table does not hang off', async () => {
      const preview = async (reach: RowReach): Promise<Reply> => call('owner', 'POST', 'roles/rows/preview', { connectionId: w.connectionId, table: visits, userId: w.people.mara, action: 'read', reach });
      const judged = await preview(BY_DEAL_OWNER);
      expect(judged.statusCode, judged.body).toBe(200);
      expect(json(judged)).toMatchObject({ reached: 2, total: 4 });
      // Without the parent's owner, every way counts: the helper's visit and Sam's on the deal she helps on.
      expect(json(await preview({ reach: 'team' }))).toMatchObject({ reached: 4, total: 4 });
      const wrong = await preview({ reach: 'team', via: 'note', by: 'owner_id' });
      expect(wrong.statusCode, wrong.body).toBe(422);
      expect(wrong.body).toContain('not-a-parent');
      const notStaff = await preview({ reach: 'team', via: 'deal_id', by: 'title' });
      expect(notStaff.statusCode, notStaff.body).toBe(422);
      expect(notStaff.body).toContain('not-a-staff-column');
    });

    it('Dana herself, whose own reach is not judged by the parent, still reads her visit on the deal she helps on', async () => {
      await w.role('rep', { deals: { actions: ['read'], rows: { read: { reach: 'own' } } } });
      const { permissionsRepo, rolesRepo } = await import('@adminium/meta');
      await permissionsRepo(w.meta).grant((await rolesRepo(w.meta).findBySlug('rep'))!.id, 'table', `${w.connectionId}/${visits}`, { read: true, create: false, update: false, delete: false, export: false, import: false, rowLimit: { read: { reach: 'own' } } } as never);
      await w.give('dana', 'rep');
      // Her own visits by her column, and every visit of the deals she owns or helps on: as before.
      expect(await listed('dana')).toEqual([1, 2, 3, 4]);
    });
  });
}
