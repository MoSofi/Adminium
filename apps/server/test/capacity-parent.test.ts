// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A limit held on the row a row points at — tickets of a type, within the
 * room's cap across the show's types — with holds that end on the clock, on
 * every engine, at a fixed time.
 *
 * The show: Neon, in a room of 300. Neon Standard sells 260, six an order;
 * 243 are sold and 3 held for ten minutes, so 14 are left. The Balcony goes
 * on sale tomorrow.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { capacityState } from '../src/crud/capacity/judge.js';
import { withNamedLocks } from '../src/crud/capacity/locks.js';
import { LEGS, refusal, type World } from './capacity.helpers.js';
import { neon, NEON_NOW as NOW } from './capacity-worlds.js';

const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`a limit per ticket type on ${dialect}`, () => {
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

    const standard = async (at = new Date()) => {
      const target = await w!.target('tickets');
      const [state] = await capacityState(target.db, target, { rule: 0, keys: ['1'] }, at);
      return state!;
    };

    it('counts 243 sold and 3 held as 14 left, and a hold ten minutes old no more', async () => {
      w = await neon(dialect);
      expect(await standard()).toMatchObject({ kind: 'parent', key: '1', size: 260, taken: 246, held: 3, left: 14, fits: true });
      // Eleven minutes on, and no sweep has run: the hold has simply ended.
      vi.setSystemTime(new Date(NOW.getTime() + 11 * 60_000));
      expect(await standard()).toMatchObject({ taken: 243, held: 0, left: 17 });
    });

    it('keeps counting a paid order whose hold is long over', async () => {
      w = await neon(dialect);
      // Order 1 is paid, and its held_until an hour ago: its 243 still count.
      vi.setSystemTime(new Date(NOW.getTime() + 24 * 60 * 60_000));
      expect(await standard()).toMatchObject({ taken: 243 });
    });

    it('refuses the seventh ticket of a type on one order', async () => {
      w = await neon(dialect);
      const order = await w.create('orders', { status: 'held', held_until: later(10) });
      for (let i = 0; i < 6; i += 1) await w.create('tickets', { order_id: order['id'], ticket_type_id: 1 });
      const seventh = await refusal(w.create('tickets', { order_id: order['id'], ticket_type_id: 1 }));
      expect(seventh).toMatchObject({ code: 'VALIDATION_FAILED', details: { fields: { ticket_type_id: { code: 'too-many' } }, reason: 'CAPACITY_TOO_MANY' } });
    });

    it('sells the Balcony to a guest only once it is on sale; staff may sell before', async () => {
      w = await neon(dialect);
      const order = await w.create('orders', { status: 'held', held_until: later(10) });
      const early = await refusal(w.create('tickets', { order_id: order['id'], ticket_type_id: 2 }, 'public'));
      expect(early).toMatchObject({ code: 'VALIDATION_FAILED', details: { fields: { ticket_type_id: { code: 'not-on-sale' } }, reason: 'CAPACITY_NOT_ON_SALE' } });
      expect(await refusal(w.create('tickets', { order_id: order['id'], ticket_type_id: 2 }, 'dashboard'))).toBe('ok');
    });

    it('sells the last 14 and refuses the 15th, naming the pool', async () => {
      w = await neon(dialect);
      const orders = [];
      for (let i = 0; i < 3; i += 1) orders.push(await w.create('orders', { status: 'held', held_until: later(10) }));
      let sold = 0;
      for (const order of orders) {
        for (let i = 0; i < 5 && sold < 14; i += 1, sold += 1) await w.create('tickets', { order_id: order['id'], ticket_type_id: 1 });
      }
      const full = await refusal(w.create('tickets', { order_id: orders[2]!['id'], ticket_type_id: 1 }));
      expect(full).toMatchObject({ code: 'CAPACITY_FULL', details: { column: 'ticket_type_id', rule: 0, kind: 'parent', row: 0, pool: { key: '1' }, left: 0 } });
      expect(await standard()).toMatchObject({ taken: 260, left: 0 });
    });

    it("stops a sale at the room's cap, though the type has places", async () => {
      w = await neon(dialect, 247);
      const order = await w.create('orders', { status: 'held', held_until: later(10) });
      await w.create('tickets', { order_id: order['id'], ticket_type_id: 1 });
      const second = await refusal(w.create('tickets', { order_id: order['id'], ticket_type_id: 1 }));
      expect(second).toMatchObject({ code: 'CAPACITY_FULL', details: { pool: { key: '1' }, left: 0 } });
    });

    it("judges an order's move for its tickets: paid after its hold ended, with the type sold out, is refused on the status", async () => {
      w = await neon(dialect);
      // The held order's hold ends; its three places are sold to others.
      vi.setSystemTime(new Date(NOW.getTime() + 11 * 60_000));
      const buyers = await Promise.all(Array.from({ length: 3 }, () => w!.create('orders', { status: 'paid' })));
      let left = 17;
      for (const buyer of buyers) {
        for (let i = 0; i < 6 && left > 0; i += 1, left -= 1) await w.create('tickets', { order_id: buyer['id'], ticket_type_id: 1 });
      }
      expect(await standard()).toMatchObject({ taken: 260, left: 0 });
      const paid = await refusal(w.update('orders', 2, { status: 'paid' }));
      expect(paid).toMatchObject({ code: 'CAPACITY_FULL', details: { column: 'status', kind: 'parent' } });
      // Released instead: no count asked, nothing refused.
      expect(await refusal(w.update('orders', 2, { status: 'released' }))).toBe('ok');
    });

    it("waits for the pool's lock when a confirm crosses its hold's end, so a checkout behind it cannot take the same places", async () => {
      w = await neon(dialect);
      const target = await w.target('tickets');
      // Another server's writer holds the show's pool.
      const pool = `${w.connectionId}|${target.table.id}|cap|p0|1`;
      let release!: () => void;
      const released = new Promise<void>((resolve) => (release = resolve));
      let holding!: () => void;
      const held = new Promise<void>((resolve) => (holding = resolve));
      const elsewhere = withNamedLocks({ db: target.db, dialect: target.dialect }, [{ name: pool, busy: 'CAPACITY_BUSY' }], async () => {
        holding();
        await released;
      });
      await held;
      // Past the hold's end: the confirm must count the order again, under the lock.
      vi.setSystemTime(new Date(NOW.getTime() + 10 * 60_000 + 50));
      let done = false;
      const confirm = w.update('orders', 2, { status: 'paid' }).then(() => (done = true));
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(done).toBe(false);
      release();
      await elsewhere;
      await confirm;
      expect(await standard()).toMatchObject({ taken: 246, held: 0 });
    });
  });
}
