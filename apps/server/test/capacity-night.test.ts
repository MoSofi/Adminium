// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Stays that take a room of a type on every night from arrival to the night
 * before departure, a room that holds one stay a night, and parking spaces
 * that follow their stay's nights — on every engine, at a fixed time.
 *
 * The house: 4 Lofts, 14 Garden rooms (108 among them), 3 Harbour rooms
 * (204 among them). Stays of 1 to 14 nights, 2 when arriving on a Saturday,
 * sold a year ahead. Two parking spaces.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { capacityState } from '../src/crud/capacity/judge.js';
import { LEGS, refusal, type World } from './capacity.helpers.js';
import { house, roomId } from './capacity-worlds.js';

const NOW = new Date('2026-07-20T09:00:00.000Z');

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`stays by the night on ${dialect}`, () => {
    let w: World | null = null;
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(NOW);
    });
    afterEach(async () => {
      vi.useRealTimers();
      await w?.close();
      w = null;
    });
    const stay = (values: Record<string, unknown>, origin: 'public' | 'dashboard' = 'public') => refusal(w!.create('stays', values, origin));
    const nights = async (type: string, from: string, to: string, rule = 0) => {
      const target = await w!.target('stays');
      return Object.fromEntries((await capacityState(target.db, target, { rule, keys: [type], from, to }, new Date())).map((s) => [s.at!, `${String(s.taken)}/${String(s.size)}`]));
    };

    it('sells four Lofts on the night of 1 August and refuses a fifth stay across it', async () => {
      w = await house(dialect);
      for (let i = 0; i < 4; i += 1) expect(await stay({ arrive: '2026-07-31', depart: '2026-08-02', room_type_id: 1 })).toBe('ok');
      expect(await stay({ arrive: '2026-07-31', depart: '2026-08-02', room_type_id: 1 })).toMatchObject({
        code: 'CAPACITY_FULL',
        details: { column: 'room_type_id', kind: 'night', rule: 0, pool: { key: '1', at: '2026-07-31' } },
      });
      // The night after is free: a stay from the 2nd goes in.
      expect(await stay({ arrive: '2026-08-02', depart: '2026-08-04', room_type_id: 1 })).toBe('ok');
    });

    it('takes a room out of service on the nights its closure covers, and from its first night when it has no end', async () => {
      w = await house(dialect);
      await w.seed('room_closures', [{ room_id: await roomId(w, '108'), from_date: '2026-07-28', to_date: '2026-08-04' }]);
      expect(await nights('2', '2026-07-27', '2026-08-06')).toEqual({
        '2026-07-27': '0/14',
        '2026-07-28': '0/13',
        '2026-08-03': '0/13',
        '2026-08-04': '0/13',
        '2026-08-05': '0/14',
        ...Object.fromEntries(['2026-07-29', '2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02'].map((d) => [d, '0/13'])),
      });
      await w.seed('room_closures', [{ room_id: await roomId(w, '109'), from_date: '2026-08-05', to_date: null }]);
      expect(await nights('2', '2026-08-04', '2026-08-07')).toEqual({ '2026-08-04': '0/13', '2026-08-05': '0/13', '2026-08-06': '0/13' });
      // A second closure of 108 over nights it already covers takes no second room off the type.
      await w.seed('room_closures', [{ room_id: await roomId(w, '108'), from_date: '2026-07-30', to_date: '2026-08-01' }]);
      expect(await nights('2', '2026-07-30', '2026-08-01')).toEqual({ '2026-07-30': '0/13', '2026-07-31': '0/13' });
    });

    it('refuses a one-night stay arriving on a Saturday, a stay past fourteen nights, and a guest arriving past a year ahead', async () => {
      w = await house(dialect);
      expect(await stay({ arrive: '2026-08-01', depart: '2026-08-02', room_type_id: 2 })).toMatchObject({
        code: 'VALIDATION_FAILED',
        details: { fields: { depart: { code: 'out-of-range' } }, reason: 'CAPACITY_OUT_OF_RANGE' },
      });
      expect(await stay({ arrive: '2026-08-01', depart: '2026-08-03', room_type_id: 2 })).toBe('ok');
      expect(await stay({ arrive: '2026-08-03', depart: '2026-08-18', room_type_id: 2 })).toMatchObject({ details: { fields: { depart: { code: 'out-of-range' } } } });
      expect(await stay({ arrive: '2027-08-03', depart: '2027-08-05', room_type_id: 2 })).toMatchObject({ details: { fields: { arrive: { code: 'out-of-range' } } } });
      expect(await stay({ arrive: '2026-07-19', depart: '2026-07-21', room_type_id: 2 })).toMatchObject({ details: { fields: { arrive: { code: 'out-of-range' } } } });
      // The desk records a late walk-in and books far ahead.
      expect(await stay({ arrive: '2026-07-19', depart: '2026-07-21', room_type_id: 2 }, 'dashboard')).toBe('ok');
      expect(await stay({ arrive: '2027-08-03', depart: '2027-08-05', room_type_id: 2 }, 'dashboard')).toBe('ok');
    });

    it('lets one of two desks give room 204 to overlapping stays, and skips the room rule for a stay with no room', async () => {
      w = await house(dialect);
      const room = await roomId(w, '204');
      expect(await stay({ arrive: '2026-08-10', depart: '2026-08-12', room_type_id: 3, room_id: room }, 'dashboard')).toBe('ok');
      expect(await stay({ arrive: '2026-08-11', depart: '2026-08-13', room_type_id: 3, room_id: room }, 'dashboard')).toMatchObject({
        code: 'CAPACITY_FULL',
        details: { column: 'room_id', rule: 1, pool: { key: String(room), at: '2026-08-11' } },
      });
      expect(await stay({ arrive: '2026-08-11', depart: '2026-08-13', room_type_id: 3 }, 'dashboard')).toBe('ok');
      // A room out of service holds no stay.
      await w.seed('room_closures', [{ room_id: await roomId(w, '205'), from_date: '2026-08-20', to_date: '2026-08-20' }]);
      expect(await stay({ arrive: '2026-08-19', depart: '2026-08-21', room_type_id: 3, room_id: await roomId(w, '205') }, 'dashboard')).toMatchObject({ code: 'CAPACITY_FULL' });
    });

    it('counts a stay against the type of the room it is given', async () => {
      w = await house(dialect);
      // A Garden booking given a Harbour room: Harbour loses the night, Garden keeps it.
      await w.create('stays', { arrive: '2026-08-10', depart: '2026-08-11', room_type_id: 2, room_id: await roomId(w, '204') });
      expect(await nights('3', '2026-08-10', '2026-08-11')).toEqual({ '2026-08-10': '1/3' });
      expect(await nights('2', '2026-08-10', '2026-08-11')).toEqual({ '2026-08-10': '0/14' });
      await w.create('stays', { arrive: '2026-08-10', depart: '2026-08-11', room_type_id: 3 });
      await w.create('stays', { arrive: '2026-08-10', depart: '2026-08-11', room_type_id: 3 });
      expect(await stay({ arrive: '2026-08-10', depart: '2026-08-11', room_type_id: 3 })).toMatchObject({ code: 'CAPACITY_FULL', details: { pool: { key: '3' } } });
    });

    it("counts parking spaces on their stay's nights, and judges a stay moved onto full nights for its spaces", async () => {
      w = await house(dialect);
      const stays: Record<string, unknown>[] = [];
      for (const [arrive, depart] of [
        ['2026-08-10', '2026-08-12'],
        ['2026-08-11', '2026-08-13'],
        ['2026-08-12', '2026-08-14'],
        ['2026-08-20', '2026-08-22'],
      ] as const) {
        stays.push(await w.create('stays', { arrive, depart, room_type_id: 2 }));
      }
      const park = (i: number) => refusal(w!.create('stay_extras', { stay_id: stays[i]!['id'], extra_id: 1 }));
      expect(await park(0)).toBe('ok');
      expect(await park(1)).toBe('ok');
      // The 11th has both spaces taken.
      expect(await park(2)).toBe('ok');
      expect(await park(3)).toBe('ok');
      const third = await w.create('stays', { arrive: '2026-08-11', depart: '2026-08-12', room_type_id: 2 });
      expect(await refusal(w.create('stay_extras', { stay_id: third['id'], extra_id: 1 }))).toMatchObject({ code: 'CAPACITY_FULL', details: { column: 'extra_id', pool: { at: '2026-08-11' } } });
      // The stay of the 20th moved onto the 11th: its space has no room.
      expect(await refusal(w.update('stays', stays[3]!['id'], { arrive: '2026-08-11', depart: '2026-08-12' }))).toMatchObject({
        code: 'CAPACITY_FULL',
        details: { column: 'arrive', kind: 'night' },
      });
    });
  });
}
