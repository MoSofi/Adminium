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

import { wallTimeToInstant } from '../src/crud/venue-time.js';
import { filled, LEGS, refusal, types, type Dialect, type World } from './capacity.helpers.js';

const ZONE = 'Europe/London';
const at = (wall: string) => wallTimeToInstant(wall, ZONE)!;
const iso = (wall: string) => at(wall).toISOString();

function ddl(dialect: Dialect): string[] {
  const t = types(dialect);
  return [
    `create table settings (id ${t.key}, slot_capacity integer, slot_minutes integer, lead_minutes integer)`,
    `create table hours (id ${t.key}, weekday ${t.text(3)} not null, open ${t.bool} not null, opens ${t.text(5)}, closes ${t.text(5)})`,
    `create table closures (id ${t.key}, from_date date not null, to_date date null, active ${t.bool} not null)`,
    `create table slot_pauses (id ${t.key}, slot_at ${t.at} not null, active ${t.bool} not null)`,
    `create table menu_items (id ${t.key}, name ${t.text(40)}, stock_today integer null, stock_on date null)`,
    `create table orders (id ${t.key}, pickup_at ${t.at} null, status ${t.text(16)} not null default 'placed')`,
    `create table order_items (id ${t.key}, order_id integer not null, menu_item_id integer not null, qty integer not null, ${t.fk('order_id', 'orders')}, ${t.fk('menu_item_id', 'menu_items')})`,
  ];
}

const counted = { column: 'status', values: ['placed', 'ready'] };

export async function kitchen(dialect: Dialect, endpoints?: Record<string, Record<string, unknown>>): Promise<World> {
  return filled(
    dialect,
    {
      zone: ZONE,
      ddl,
      overrides: (id) => [
        {
          op: 'table.capacity',
          table: 'orders',
          value: {
            kind: 'slot',
            slot: 'pickup_at',
            amount: 1,
            perSlot: { table: id('settings'), column: 'slot_capacity' },
            slotMinutes: { table: id('settings'), column: 'slot_minutes' },
            countWhere: counted,
            hours: { table: id('hours'), weekday: 'weekday', open: 'open', opens: 'opens', closes: 'closes' },
            closures: { table: id('closures'), from: 'from_date', to: 'to_date', active: 'active' },
            pauses: { table: id('slot_pauses'), slot: 'slot_at', active: 'active' },
            noticeMinutes: { table: id('settings'), column: 'lead_minutes' },
            windowDays: 1,
          },
        },
        {
          op: 'table.capacity',
          table: 'order_items',
          value: {
            kind: 'parent',
            via: 'menu_item_id',
            size: { column: 'stock_today', onDay: 'stock_on' },
            amount: 'qty',
            countWhere: { ...counted, via: 'order_id' },
            day: { via: 'order_id', column: 'pickup_at' },
          },
        },
      ],
      ...(endpoints === undefined ? {} : { endpoints }),
    },
    async (w) => {
      await w.seed('settings', [{ slot_capacity: 6, slot_minutes: 15, lead_minutes: 20 }]);
      await w.seed('hours', [
        { weekday: 'mon', open: false, opens: null, closes: null },
        ...['tue', 'wed', 'thu', 'sat', 'sun'].map((weekday) => ({ weekday, open: true, opens: '12:00', closes: '21:00' })),
        { weekday: 'fri', open: true, opens: '18:00', closes: '02:00' },
      ]);
      await w.seed('closures', [{ from_date: '2026-07-30', to_date: '2026-07-30', active: true }]);
      await w.seed('slot_pauses', [{ slot_at: iso('2026-07-28 12:30'), active: true }]);
      await w.seed('menu_items', [
        { id: 1, name: 'Diavola', stock_today: 2, stock_on: '2026-07-28' },
        { id: 2, name: 'Margherita', stock_today: null, stock_on: null },
        { id: 3, name: 'Calzone', stock_today: 0, stock_on: '2026-07-28' },
      ]);
      // Two orders already in the 12:15 slot.
      await w.seed('orders', [
        { pickup_at: iso('2026-07-28 12:15'), status: 'placed' },
        { pickup_at: iso('2026-07-28 12:15'), status: 'ready' },
      ]);
    },
  );
}

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
