// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A released app's slot limit (no hours, closures, pauses or notice) judges a
 * change exactly as it always did, on every engine, at a fixed time: a party
 * of none or fewer is refused whatever else the change does, a slot sent
 * again is placed again, a booking restored with no time is refused, and a
 * guest's question it never took is refused. The one change it did not
 * always let through: a status step at a slot already over its limit.
 *
 * The diner: 17:00 to 22:00, half-hour slots, six covers, a week ahead.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LEGS, refusal, type World } from './capacity.helpers.js';
import { at, diner, iso } from './capacity-worlds.js';

const bare = (column: string) => ({ code: 'VALIDATION_FAILED', details: { fields: { [column]: { code: 'out-of-range' } } } });

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`a released slot limit on ${dialect}`, () => {
    let w: World | null = null;
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(at('2026-07-20 13:00'));
    });
    afterEach(async () => {
      vi.useRealTimers();
      await w?.close();
      w = null;
    });

    const book = (party: number, wall = '2026-07-21 19:00') => refusal(w!.create('bookings', { name: 'Guest', starts_at: iso(wall), party }));
    const idOf = async () => (await w!.query('select max(id) as id from bookings'))[0]!['id'];

    it('refuses a party of none or fewer, new or shrunk, and a slot is never oversold by one', async () => {
      w = await diner(dialect);
      expect(await book(0)).toEqual(bare('party'));
      expect(await book(-2)).toEqual(bare('party'));
      expect(await book(6)).toBe('ok');
      const first = await idOf();
      // Shrunk below nothing: it would free twelve covers of a slot of six.
      expect(await refusal(w.update('bookings', first, { party: -10 }))).toEqual(bare('party'));
      expect(await refusal(w.update('bookings', first, { party: 0 }))).toEqual(bare('party'));
      expect(await book(6)).toEqual({ code: 'CAPACITY_FULL', details: { column: 'starts_at' } });
      // Shrunk to four: two covers free.
      expect(await refusal(w.update('bookings', first, { party: 4 }))).toBe('ok');
      expect(await book(2)).toBe('ok');
      const [taken] = await w.query('select sum(party) as n from bookings');
      expect(Number(taken!['n'])).toBe(6);
    });

    it('places a slot sent again, counts an amount sent again, and lets a status step alone through', async () => {
      w = await diner(dialect);
      expect(await book(4)).toBe('ok');
      const first = await idOf();
      expect(await book(2)).toBe('ok');
      const second = await idOf();
      // The limit lowered under a full slot: six at a slot of four.
      await w.query('update covers set per_slot = 4');
      expect(await refusal(w.update('bookings', first, { status: 'seated' }))).toBe('ok');
      expect(await refusal(w.update('bookings', first, { status: 'seated', party: 4 }))).toEqual({ code: 'CAPACITY_FULL', details: { column: 'starts_at' } });
      expect(await refusal(w.update('bookings', first, { starts_at: iso('2026-07-21 19:00') }))).toEqual({ code: 'CAPACITY_FULL', details: { column: 'starts_at' } });
      // Half past seven: the slot is past. Sent again, it is refused as a new one would be; a status step is not.
      vi.setSystemTime(at('2026-07-21 19:30'));
      expect(await refusal(w.update('bookings', second, { starts_at: iso('2026-07-21 19:00'), status: 'seated' }))).toEqual(bare('starts_at'));
      expect(await refusal(w.update('bookings', second, { status: 'seated' }))).toBe('ok');
    });

    it('refuses a booking restored with no time, and restores one with a time though it is past', async () => {
      w = await diner(dialect);
      await w.seed('bookings', [
        { id: 1, name: 'No time', starts_at: null, party: 2, status: 'cancelled' },
        { id: 2, name: 'Last week', starts_at: iso('2026-07-13 19:00'), party: 2, status: 'cancelled' },
      ]);
      expect(await refusal(w.update('bookings', 1, { status: 'confirmed' }))).toEqual(bare('starts_at'));
      expect(await refusal(w.update('bookings', 2, { status: 'confirmed' }))).toBe('ok');
    });

    it("refuses a guest's question it never took", async () => {
      w = await diner(dialect, { bookings_availability: { source: 'bookings', methods: ['GET'], kind: 'availability' } });
      const asked = await w.get('availability/bookings_availability?date=2026-07-21&party=2');
      expect(asked.status, JSON.stringify(asked.body)).toBe(200);
      expect((asked.body['data'] as unknown[]).length).toBe(10);
      for (const extra of ['qty=2', 'to=2026-07-22', 'under=1', 'guests=2', 'earliest=3', 'code=EARLY']) {
        const refused = await w.get(`availability/bookings_availability?date=2026-07-21&party=2&${extra}`);
        expect(refused.status, extra).toBe(400);
        expect((refused.body['error'] as { code: string }).code, extra).toBe('PUBLIC_QUERY_REFUSED');
      }
    });
  });
}
