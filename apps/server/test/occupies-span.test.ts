// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A SPAN OF WHOLE DAYS (`table.occupies` with `day` and `until`).
 *
 * Who covers for whom, from a day until a day: no two covers of one person
 * share a day. Both ends are counted, so a cover that ends on the 14th and
 * one that starts on the 14th overlap; a cover with no last day runs until
 * further notice, and overlaps everything after its first.
 *
 * One test a door: a new row, a change of either day alone, a last day
 * taken away, a change of whose the cover is, a row that counts again, a
 * rule's write, a guest's write, a batch, a file brought in — and many
 * writers at once, on one server and across several. Each on every engine:
 * a date is text on SQLite and a Date from the other two drivers.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { HISTORY } from '../src/data-io/import-judge.js';
import { filled, LEGS, refusal, types, type World } from './capacity.helpers.js';

const TAKEN = { code: 'BOOKING_TAKEN', details: { column: 'starts_on' } };

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`a span of whole days on ${dialect}`, () => {
    let w: World;
    let person = 0;
    /** Somebody nobody has written a cover for yet. */
    const someone = (): string => `rep-${String((person += 1))}`;
    const cover = (owner: string | null, from: string | null, to: string | null, more: Record<string, unknown> = {}, origin: Parameters<World['create']>[2] = 'dashboard') =>
      w.create('covers', { owner_id: owner, cover_id: 'stand-in', starts_on: from, ends_on: to, ...more }, origin);
    const said = (run: Promise<unknown>) => refusal(run);
    const reason = async (run: Promise<unknown>): Promise<unknown> => {
      const answer = await refusal(run);
      return answer === 'ok' ? 'ok' : (answer.details['reason'] ?? answer.code);
    };

    beforeAll(async () => {
      w = await filled(
        dialect,
        {
          zone: 'UTC',
          ddl: (d) => {
            const t = types(d);
            return [
              `create table covers (id ${t.key}, owner_id ${t.text(36)}, cover_id ${t.text(36)} not null, starts_on date, ends_on date, note ${t.text(80)})`,
              `create table leaves (id ${t.key}, owner_id ${t.text(36)} not null, starts_on date not null, ends_on date, state ${t.text(12)} not null default 'asked')`,
            ];
          },
          overrides: () => [
            { op: 'table.occupies', table: 'covers', value: { resource: 'owner_id', day: 'starts_on', until: 'ends_on' } },
            { op: 'table.occupies', table: 'leaves', value: { resource: 'owner_id', day: 'starts_on', until: 'ends_on', countWhere: { column: 'state', values: ['asked', 'agreed'] } } },
          ],
          endpoints: {
            covers: { source: 'covers', methods: ['POST'], select: ['id'], writable: ['owner_id', 'cover_id', 'starts_on', 'ends_on'] },
          },
        },
        async () => undefined,
      );
    }, 120_000);
    afterAll(async () => {
      await w?.close();
    });

    it('refuses a new span that shares a day with another of the same person, both ends counted', async () => {
      const sam = someone();
      await cover(sam, '2026-08-10', '2026-08-14');
      // Inside it, around it, into its first day, out of its last day.
      expect(await said(cover(sam, '2026-08-12', '2026-08-13'))).toEqual(TAKEN);
      expect(await said(cover(sam, '2026-08-01', '2026-08-31'))).toEqual(TAKEN);
      expect(await said(cover(sam, '2026-08-08', '2026-08-10'))).toEqual(TAKEN);
      expect(await said(cover(sam, '2026-08-14', '2026-08-20'))).toEqual(TAKEN);
      // One day long, on a day that is taken.
      expect(await said(cover(sam, '2026-08-14', '2026-08-14'))).toEqual(TAKEN);
      // The day after its last, and the day before its first: free.
      expect(await said(cover(sam, '2026-08-15', '2026-08-20'))).toBe('ok');
      expect(await said(cover(sam, '2026-08-05', '2026-08-09'))).toBe('ok');
      // Somebody else has the same days to themselves.
      expect(await said(cover(someone(), '2026-08-10', '2026-08-14'))).toBe('ok');
    });

    it('takes a span with no last day as taking every day after its first', async () => {
      const lena = someone();
      await cover(lena, '2026-09-01', null);
      expect(await said(cover(lena, '2026-09-05', '2026-09-06'))).toEqual(TAKEN);
      expect(await said(cover(lena, '2030-01-01', '2030-01-02'))).toEqual(TAKEN);
      expect(await said(cover(lena, '2026-08-30', '2026-09-01'))).toEqual(TAKEN);
      // A second one with no end overlaps it wherever it starts, before or after.
      expect(await said(cover(lena, '2026-08-01', null))).toEqual(TAKEN);
      expect(await said(cover(lena, '2027-01-01', null))).toEqual(TAKEN);
      // Days that end before it starts are free.
      expect(await said(cover(lena, '2026-08-22', '2026-08-31'))).toBe('ok');
      // And a new one with no end, in front of a row that ends: it would run into that row.
      const omar = someone();
      await cover(omar, '2026-10-10', '2026-10-12');
      expect(await said(cover(omar, '2026-10-01', null))).toEqual(TAKEN);
      expect(await said(cover(omar, '2026-10-13', null))).toBe('ok');
    });

    it('refuses a change of the first day alone, of the last day alone, and a last day taken away', async () => {
      const dana = someone();
      const first = await cover(dana, '2026-08-10', '2026-08-14');
      const second = await cover(dana, '2026-08-20', '2026-08-24');
      // The second starts earlier, onto the first's last day.
      expect(await said(w.update('covers', second['id'], { starts_on: '2026-08-14' }))).toEqual(TAKEN);
      // The first ends later, on the second's first day.
      expect(await said(w.update('covers', first['id'], { ends_on: '2026-08-20' }))).toEqual(TAKEN);
      // The first loses its last day: it would run through the second.
      expect(await said(w.update('covers', first['id'], { ends_on: null }))).toEqual(TAKEN);
      // Up to the day before is fine; its own days are no clash; the last one may lose its end.
      expect(await said(w.update('covers', first['id'], { ends_on: '2026-08-19' }))).toBe('ok');
      expect(await said(w.update('covers', first['id'], { starts_on: '2026-08-11', ends_on: '2026-08-19' }))).toBe('ok');
      expect(await said(w.update('covers', second['id'], { ends_on: null }))).toBe('ok');
      // A change that places nothing is not judged at all.
      expect(await said(w.update('covers', first['id'], { note: 'Back on the 20th' }))).toBe('ok');
      const rows = await w.query(`select count(*) as n from covers where owner_id = '${dana}'`);
      expect(Number(rows[0]!['n'])).toBe(2);
    });

    it('refuses a cover handed to somebody who has one on those days', async () => {
      const [kim, mara] = [someone(), someone()];
      await cover(kim, '2026-08-10', '2026-08-14');
      const other = await cover(mara, '2026-08-12', '2026-08-18');
      expect(await said(w.update('covers', other['id'], { owner_id: kim }))).toEqual(TAKEN);
      // With days that are free there, in the same write, it moves.
      expect(await said(w.update('covers', other['id'], { owner_id: kim, starts_on: '2026-08-15' }))).toBe('ok');
    });

    it('refuses a last day before the first, and judges nothing while the row has nobody or no day', async () => {
      const sam = someone();
      expect(await reason(cover(sam, '2026-08-10', '2026-08-09'))).toBe('BOOKING_OUT_OF_RANGE');
      const one = await cover(sam, '2026-08-10', '2026-08-12');
      expect(await reason(w.update('covers', one['id'], { ends_on: '2026-08-01' }))).toBe('BOOKING_OUT_OF_RANGE');
      expect(await reason(w.update('covers', one['id'], { starts_on: '2026-08-13' }))).toBe('BOOKING_OUT_OF_RANGE');
      // Nobody yet, or no day yet: it takes nothing. Given both, it is judged like any other.
      expect(await said(cover(null, '2026-08-10', '2026-08-12'))).toBe('ok');
      const waiting = await cover(sam, null, null);
      expect(await said(w.update('covers', waiting['id'], { starts_on: '2026-08-12' }))).toEqual(TAKEN);
      expect(await said(w.update('covers', waiting['id'], { starts_on: '2026-08-13' }))).toBe('ok');
    });

    it('counts only the rows the rule counts, and judges one that counts again', async () => {
      const lena = someone();
      const leave = (from: string, to: string | null, state = 'asked') => w.create('leaves', { owner_id: lena, starts_on: from, ends_on: to, state });
      const first = await leave('2026-08-10', '2026-08-14');
      expect(await said(leave('2026-08-14', '2026-08-16'))).toEqual(TAKEN);
      // Turned down, it takes nothing: the days are free for another.
      expect(await said(w.update('leaves', first['id'], { state: 'refused' }))).toBe('ok');
      expect(await said(leave('2026-08-14', '2026-08-16'))).toBe('ok');
      // And it cannot be asked again over the one that took its days.
      expect(await said(w.update('leaves', first['id'], { state: 'asked' }))).toEqual(TAKEN);
      // A row that never counted is written wherever it likes.
      expect(await said(leave('2026-08-14', '2026-08-16', 'refused'))).toBe('ok');
    });

    it('holds a rule\'s write and a guest\'s write to the same days', async () => {
      const omar = someone();
      await cover(omar, '2026-08-10', '2026-08-14');
      expect(await said(cover(omar, '2026-08-14', null, {}, 'automation'))).toEqual(TAKEN);
      expect(await said(cover(omar, '2026-08-14', null, {}, 'action'))).toEqual(TAKEN);
      const guest = await w.post('records/covers', { values: { owner_id: omar, cover_id: 'stand-in', starts_on: '2026-08-12', ends_on: '2026-08-13' } });
      expect(guest.status, JSON.stringify(guest.body)).toBe(409);
      // A guest is told the days are taken in the public API's own word, and nothing of the row in the way.
      expect((guest.body['error'] as { code: string }).code).toBe('PUBLIC_SLOT_FULL');
      expect(JSON.stringify(guest.body)).not.toMatch(/2026-08-1[04]/);
      const free = await w.post('records/covers', { values: { owner_id: omar, cover_id: 'stand-in', starts_on: '2026-08-15', ends_on: '2026-08-16' } });
      expect(free.status, JSON.stringify(free.body)).toBe(201);
    });

    it('tells nothing of the row in the way', async () => {
      const dana = someone();
      const held = await cover(dana, '2026-08-10', '2026-08-14', { note: 'Wedding' });
      const answer = await refusal(cover(dana, '2026-08-01', '2026-08-31'));
      expect(answer).toEqual(TAKEN);
      const error = await cover(dana, '2026-08-01', '2026-08-31').catch((e: unknown) => e as Error);
      const told = `${(error as Error).message} ${JSON.stringify(answer)}`;
      expect(told).not.toContain('Wedding');
      expect(told).not.toMatch(/2026-08-1[04]/);
      expect(told).not.toContain(`"id":${String(held['id'])}`);
    });

    it('refuses a batch of new rows and a batch change that could move a span, and lets one that cannot through', async () => {
      const kim = someone();
      await cover(kim, '2026-08-10', '2026-08-14');
      const target = await w.target('covers');
      const staff = { origin: 'bulk' as const, hops: 0, actor: null, request: null };
      const rows = await w.query(`select id from covers where owner_id = '${kim}'`);
      const plan = (values: Record<string, unknown>) => rows.map((row) => ({ match: { id: row['id'] }, values }));
      await expect(w.writes.beforeEach('create', target, staff, [{ values: { owner_id: kim, cover_id: 'x', starts_on: '2026-08-12', ends_on: '2026-08-13' } }])).rejects.toMatchObject({ details: { reason: 'CAPACITY_ONE_AT_A_TIME' } });
      for (const values of [{ starts_on: '2026-08-01' }, { ends_on: null }, { owner_id: 'somebody-else' }]) {
        await expect(w.writes.beforeEach('update', target, staff, plan(values))).rejects.toMatchObject({ details: { reason: 'CAPACITY_ONE_AT_A_TIME' } });
      }
      await expect(w.writes.beforeEach('update', target, staff, plan({ note: 'All of them' }))).resolves.toHaveLength(1);
    });

    // The one door left open, as it is for every rule that places rows: a file brought in is history.
    it('takes a file brought in unjudged, and counts its rows for the next write', async () => {
      const mara = someone();
      await cover(mara, '2026-08-10', '2026-08-14');
      const target = await w.target('covers');
      const history = { origin: 'import' as const, hops: 0, actor: null, request: null };
      const checked = await w.writes.check('create', target, history, [{ owner_id: mara, cover_id: 'x', starts_on: '2026-08-12', ends_on: '2026-08-20' }], HISTORY);
      expect(checked.issues.every((issue) => issue === null)).toBe(true);
      await w.seed('covers', [{ owner_id: mara, cover_id: 'x', starts_on: '2026-08-12', ends_on: '2026-08-20' }]);
      expect(await said(cover(mara, '2026-08-20', '2026-08-21'))).toEqual(TAKEN);
      expect(await said(cover(mara, '2026-08-21', '2026-08-22'))).toBe('ok');
    });

    it('lets one of many writers of the same days in, and one of two that only share a day', async () => {
      const sam = someone();
      const outcomes = await Promise.all(Array.from({ length: 8 }, () => refusal(cover(sam, '2026-08-10', '2026-08-14', {}, 'public'))));
      expect(outcomes.filter((o) => o === 'ok')).toHaveLength(1);
      expect(new Set(outcomes.filter((o) => o !== 'ok').map((o) => (o as { code: string }).code))).toEqual(new Set(['BOOKING_TAKEN']));
      // Two spans that meet on the 20th, and two with no end: one of each pair.
      const lena = someone();
      const pair = await Promise.all([refusal(cover(lena, '2026-08-15', '2026-08-20')), refusal(cover(lena, '2026-08-20', '2026-08-25'))]);
      expect(pair.filter((o) => o === 'ok')).toHaveLength(1);
      const open = await Promise.all([refusal(cover(lena, '2026-09-01', null)), refusal(cover(lena, '2026-10-01', null))]);
      expect(open.filter((o) => o === 'ok')).toHaveLength(1);
      // A change and a new row for the same day, at once: never both.
      const dana = someone();
      const mine = await cover(dana, '2026-08-01', '2026-08-05');
      const both = await Promise.all([refusal(w.update('covers', mine['id'], { ends_on: '2026-08-10' })), refusal(cover(dana, '2026-08-10', '2026-08-12'))]);
      expect(both.filter((o) => o === 'ok')).toHaveLength(1);
      const days = await w.query(`select count(*) as n from covers where owner_id in ('${sam}', '${lena}')`);
      expect(Number(days[0]!['n'])).toBe(3);
    }, 30_000);

    // Two servers over one SQLite file is not a deployment: one server serialises its writers.
    it.skipIf(dialect === 'sqlite')('lets one of twelve writers in across six servers', async () => {
      const omar = someone();
      const servers = [await w.target('covers')];
      for (let i = 1; i < 6; i += 1) servers.push(await (await w.twin()).target('covers'));
      const context = { origin: 'public' as const, hops: 0, actor: null, request: null };
      const outcomes = await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          // Every one overlaps every other: a day each, inside one that has no end.
          refusal(w.writes.create({ target: servers[i % 6]!, values: { owner_id: omar, cover_id: 'x', starts_on: `2026-08-${String(10 + (i % 3))}`, ends_on: i % 2 === 0 ? null : '2026-12-31' }, context, announce: async () => {} })),
        ),
      );
      expect(outcomes.filter((o) => o === 'ok')).toHaveLength(1);
      expect(new Set(outcomes.filter((o) => o !== 'ok').map((o) => (o as { code: string }).code))).toEqual(new Set(['BOOKING_TAKEN']));
      const rows = await w.query(`select count(*) as n from covers where owner_id = '${omar}'`);
      expect(Number(rows[0]!['n'])).toBe(1);
    }, 30_000);
  });
}
