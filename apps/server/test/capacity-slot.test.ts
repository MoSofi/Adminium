// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Orders in pickup slots, and portions of a dish per day, on every engine at
 * a fixed time on the venue's clock (Europe/London).
 *
 * The kitchen: six orders a slot, every fifteen minutes, twenty minutes'
 * notice for a guest, today and tomorrow. Tuesday to Sunday it opens at noon
 * and closes at nine; Friday runs to two in the morning; Monday it does not
 * open. Thursday 30 July it is closed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LEGS, refusal, type World } from './capacity.helpers.js';
import { at, iso, kitchen } from './capacity-worlds.js';

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`orders in pickup slots on ${dialect}`, () => {
    let w: World | null = null;
    const clock = (wall: string) => vi.setSystemTime(at(wall));
    beforeEach(() => vi.useFakeTimers({ toFake: ['Date'] }));
    afterEach(async () => {
      vi.useRealTimers();
      await w?.close();
      w = null;
    });

    const order = (wall: string, origin: 'public' | 'dashboard' = 'public') => refusal(w!.create('orders', { pickup_at: iso(wall) }, origin));
    const code = (answer: Awaited<ReturnType<typeof refusal>>) =>
      answer === 'ok' ? 'ok' : ((answer.details['fields'] as Record<string, { code: string }> | undefined)?.['pickup_at']?.code ?? answer.code);

    it('fills the 12:15 slot to six and refuses the seventh', async () => {
      w = await kitchen(dialect);
      clock('2026-07-28 11:40');
      for (let i = 0; i < 4; i += 1) expect(await order('2026-07-28 12:15')).toBe('ok');
      expect(await order('2026-07-28 12:15')).toMatchObject({ code: 'CAPACITY_FULL', details: { column: 'pickup_at', kind: 'slot', pool: { at: '2026-07-28' } } });
      // A cancelled order holds no place.
      await w.query(`update orders set status = 'cancelled' where id = 1`);
      expect(await order('2026-07-28 12:15')).toBe('ok');
    });

    it('refuses a guest a paused slot, and lets staff squeeze an order in', async () => {
      w = await kitchen(dialect);
      clock('2026-07-28 11:40');
      expect(code(await order('2026-07-28 12:30'))).toBe('paused');
      expect(await order('2026-07-28 12:30')).toMatchObject({ details: { reason: 'CAPACITY_PAUSED' } });
      expect(await order('2026-07-28 12:30', 'dashboard')).toBe('ok');
    });

    it('says why a place is not offered, in order: closed, out of hours, off the grid, notice, window', async () => {
      w = await kitchen(dialect);
      clock('2026-07-28 11:45');
      // The lead: at 11:45 an order for 12:00 is too soon for a guest; staff may take it.
      expect(code(await order('2026-07-28 12:00'))).toBe('out-of-range');
      expect(await order('2026-07-28 12:00', 'dashboard')).toBe('ok');
      expect(code(await order('2026-07-28 12:05'))).toBe('out-of-range');
      // Thursday is closed, whatever the hour — and it is past the window, which is asked last.
      expect(code(await order('2026-07-30 13:00'))).toBe('closed');
      expect(await order('2026-07-30 13:00', 'dashboard')).toMatchObject({ details: { reason: 'CAPACITY_CLOSED' } });
      // Before noon, and Monday: out of hours.
      expect(code(await order('2026-07-28 11:00'))).toBe('out-of-hours');
      clock('2026-08-02 11:00');
      expect(code(await order('2026-08-03 13:00'))).toBe('out-of-hours');
      // The last slot starts before the close; the close itself is not a slot.
      clock('2026-07-28 11:45');
      expect(await order('2026-07-28 20:45')).toBe('ok');
      expect(code(await order('2026-07-28 21:00'))).toBe('out-of-range');
      // Today and tomorrow only.
      expect(code(await order('2026-07-31 19:00'))).toBe('out-of-range');
    });

    it("keeps Friday's small hours on Friday", async () => {
      w = await kitchen(dialect);
      clock('2026-07-31 17:00');
      expect(await order('2026-08-01 01:00')).toBe('ok');
      expect(code(await order('2026-08-01 02:00'))).toBe('out-of-range');
      expect(code(await order('2026-07-31 17:30'))).toBe('out-of-hours');
    });

    it('sells the last two portions of the day and refuses the third, naming its line', async () => {
      w = await kitchen(dialect);
      clock('2026-07-28 11:40');
      const line = async (wall: string, item = 1) => {
        const made = await w!.create('orders', { pickup_at: iso(wall) }, 'dashboard');
        return refusal(w!.create('order_items', { order_id: made['id'], menu_item_id: item, qty: 1 }, 'public'));
      };
      expect(await line('2026-07-28 13:00')).toBe('ok');
      expect(await line('2026-07-28 13:15')).toBe('ok');
      expect(await line('2026-07-28 13:30')).toMatchObject({ code: 'CAPACITY_FULL', details: { column: 'menu_item_id', kind: 'parent', row: 0, pool: { key: '1', at: '2026-07-28' } } });
      // Today's number is no limit tomorrow; no number is none; nought is sold out.
      expect(await line('2026-07-29 13:00', 1)).toBe('ok');
      expect(await line('2026-07-28 13:45', 2)).toBe('ok');
      expect(await line('2026-07-28 13:45', 3)).toMatchObject({ code: 'CAPACITY_FULL' });
    });

    it('refuses a line of none or fewer portions, new or shrunk, whatever else it asks', async () => {
      w = await kitchen(dialect);
      clock('2026-07-28 11:40');
      const made = await w.create('orders', { pickup_at: iso('2026-07-28 13:00') }, 'dashboard');
      const refused = { code: 'VALIDATION_FAILED', details: { fields: { qty: { code: 'out-of-range' } }, reason: 'CAPACITY_OUT_OF_RANGE', row: 0 } };
      expect(await refusal(w.create('order_items', { order_id: made['id'], menu_item_id: 1, qty: 0 }))).toEqual(refused);
      expect(await refusal(w.create('order_items', { order_id: made['id'], menu_item_id: 1, qty: 2 }))).toBe('ok');
      const line = (await w.query('select max(id) as id from order_items'))[0]!['id'];
      // Shrunk below nothing, the day's two portions would be sold again.
      expect(await refusal(w.update('order_items', line, { qty: -10 }))).toEqual(refused);
      expect(await refusal(w.update('order_items', line, { qty: 0 }))).toEqual(refused);
      expect(await refusal(w.create('order_items', { order_id: made['id'], menu_item_id: 1, qty: 1 }))).toMatchObject({ code: 'CAPACITY_FULL' });
      expect(await refusal(w.update('order_items', line, { qty: 1 }))).toBe('ok');
      expect(await refusal(w.create('order_items', { order_id: made['id'], menu_item_id: 1, qty: 1 }))).toBe('ok');
    });

    it("judges an order moved to a sold-out day for its lines, on the order's own column", async () => {
      w = await kitchen(dialect);
      clock('2026-07-28 11:40');
      for (const wall of ['2026-07-28 13:00', '2026-07-28 13:15', '2026-07-29 13:00']) {
        const made = await w.create('orders', { pickup_at: iso(wall) }, 'dashboard');
        await w.create('order_items', { order_id: made['id'], menu_item_id: 1, qty: 1 });
      }
      const wednesday = (await w.query(`select id from orders order by id desc`))[0]!['id'];
      const moved = await refusal(w.update('orders', wednesday, { pickup_at: iso('2026-07-28 14:00') }));
      expect(moved).toMatchObject({ code: 'CAPACITY_FULL', details: { column: 'pickup_at', kind: 'parent', pool: { key: '1', at: '2026-07-28' } } });
      // Moved within Wednesday: the same day's portions, nothing asked of Tuesday's.
      expect(await refusal(w.update('orders', wednesday, { pickup_at: iso('2026-07-29 14:00') }))).toBe('ok');
    });
  });
}
