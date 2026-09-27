// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A row whose count reads another row, and the writes that change the other:
 * an order moved while its first line is written, two ticket types sharing a
 * room while each is locked by its own type, and a waitlist offer extended
 * after it lapsed. Each on every engine, at a fixed time.
 *
 * A write held open after its judge and before its INSERT stands for a
 * second guest's checkout caught between the two: the doors take exactly
 * these steps (name, lock, judge, write).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { capacityLockNames, judgeCapacity } from '../src/crud/capacity/judge.js';
import { withNamedLocks } from '../src/crud/capacity/locks.js';
import type { Row } from '../src/crud/mask.js';
import { writeClock } from '../src/crud/write-clock.js';
import type { WriteOrigin } from '../src/crud/write-context.js';
import { LEGS, refusal, type World } from './capacity.helpers.js';
import { at, iso, kitchen, neon, NEON_NOW, NEON_RULE } from './capacity-worlds.js';

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Writes still held open: let go after a test that failed before it could. */
const holding: (() => void)[] = [];

/** A create that has named and taken its locks and been judged, and waits to be let go before it writes its row. */
async function heldCreate(w: World, table: string, row: Row, origin: WriteOrigin): Promise<{ release: () => void; done: Promise<void> }> {
  const target = await w.target(table);
  const names = await capacityLockNames(target.db, [{ target, row, before: null, prepared: true }]);
  let judged!: () => void;
  const ready = new Promise<void>((resolve) => (judged = resolve));
  let go!: () => void;
  const gate = new Promise<void>((resolve) => (go = resolve));
  const done = withNamedLocks(target, names, async (db) => {
    await judgeCapacity(db, [{ target, pk: null, row, before: null }], { clock: writeClock(), origin, mode: 'save' });
    judged();
    await gate;
    await db.insertInto(target.table.id).values(row as never).execute();
  });
  done.catch(() => judged());
  holding.push(go);
  await ready;
  return { release: go, done };
}

const later = (minutes: number) => new Date(NEON_NOW.getTime() + minutes * 60_000).toISOString();

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`writes that reach a limited row on ${dialect}`, () => {
    let w: World | null = null;
    beforeEach(() => vi.useFakeTimers({ toFake: ['Date'] }));
    afterEach(async () => {
      vi.useRealTimers();
      for (const go of holding.splice(0)) go();
      await w?.close();
      w = null;
    });

    it("sees an order's first line written while the order moves to a sold-out day, and refuses the move", async () => {
      w = await kitchen(dialect);
      vi.setSystemTime(at('2026-07-28 11:40'));
      // Tuesday's two portions of Diavola are sold; Wednesday's order has no line yet.
      for (const wall of ['2026-07-28 13:00', '2026-07-28 13:15']) {
        const made = await w.create('orders', { pickup_at: iso(wall) }, 'dashboard');
        await w.create('order_items', { order_id: made['id'], menu_item_id: 1, qty: 1 });
      }
      const wednesday = (await w.create('orders', { pickup_at: iso('2026-07-29 13:00') }, 'dashboard'))['id'];
      // A Diavola judged on Wednesday (no limit), not yet written.
      const line = await heldCreate(w, 'order_items', { order_id: wednesday, menu_item_id: 1, qty: 1 }, 'dashboard');
      let moved = false;
      const move = refusal(w.update('orders', wednesday, { pickup_at: iso('2026-07-28 14:00') })).then((outcome) => {
        moved = true;
        return outcome;
      });
      await pause(400);
      // The move waits for the line: moving first, it would take Tuesday unjudged.
      expect(moved).toBe(false);
      line.release();
      await line.done;
      expect(await move).toMatchObject({ code: 'CAPACITY_FULL', details: { column: 'pickup_at', kind: 'parent', pool: { key: '1', at: '2026-07-28' } } });
      const [tuesday] = await w.query(`select count(*) as n from order_items join orders on orders.id = order_items.order_id where orders.pickup_at < '2026-07-29'`);
      expect(Number(tuesday!['n'])).toBe(2);
    }, 20_000);

    it("locks a room shared by two ticket types when each type is locked by itself, so the room's last place is sold once", async () => {
      vi.setSystemTime(NEON_NOW);
      // A room of 247: 246 taken, one left, across every type.
      w = await neon(dialect, 247, undefined, { ...NEON_RULE, lockBy: 'ticket_type_id' });
      const tickets = await w.target('tickets');
      const names = (await capacityLockNames(tickets.db, [{ target: tickets, row: { order_id: 2, ticket_type_id: 1, event_id: 1 }, before: null, prepared: true }])).map((l) => l.name);
      const base = `${w.connectionId}|${tickets.table.id}|cap|`;
      expect(names).toEqual(expect.arrayContaining([`${base}p0|1`, `${base}p0|a0|1`]));
      const first = await w.create('orders', { status: 'held', held_until: later(10) });
      const second = await w.create('orders', { status: 'held', held_until: later(10) });
      const standard = await heldCreate(w, 'tickets', { order_id: first['id'], ticket_type_id: 1, event_id: 1, status: 'valid' }, 'dashboard');
      let settled = false;
      const guestList = refusal(w.create('tickets', { order_id: second['id'], ticket_type_id: 3 })).then((outcome) => {
        settled = true;
        return outcome;
      });
      await pause(400);
      expect(settled).toBe(false);
      standard.release();
      await standard.done;
      expect(await guestList).toMatchObject({ code: 'CAPACITY_FULL', details: { column: 'ticket_type_id', kind: 'parent' } });
      const [total] = await w.query('select count(*) as n from tickets');
      expect(Number(total!['n'])).toBe(247);
    }, 20_000);

    it('judges a lapsed waitlist offer extended for the places its order would take again', async () => {
      vi.setSystemTime(NEON_NOW);
      w = await neon(dialect);
      // Full: 243 sold and 3 held of 246. Mia's offer lapsed a minute ago; her two places went back.
      await w.query('update ticket_types set capacity = 246 where id = 1');
      await w.seed('waitlist', [{ id: 1, email: 'mia@example.com', offered_until: later(-1) }]);
      await w.seed('orders', [{ id: 3, status: 'offered', held_until: null, waitlist_id: 1 }]);
      await w.seed('tickets', [
        { order_id: 3, ticket_type_id: 1, event_id: 1, status: 'valid' },
        { order_id: 3, ticket_type_id: 1, event_id: 1, status: 'valid' },
      ]);
      const extended = await refusal(w.update('waitlist', 1, { offered_until: later(12 * 60) }));
      expect(extended).toMatchObject({ code: 'CAPACITY_FULL', details: { column: 'offered_until', kind: 'parent', pool: { key: '1' } } });
      // With room for them, the offer runs again, and its places are held.
      await w.query('update ticket_types set capacity = 260 where id = 1');
      expect(await refusal(w.update('waitlist', 1, { offered_until: later(12 * 60) }))).toBe('ok');
      const target = await w.target('tickets');
      const { capacityState } = await import('../src/crud/capacity/judge.js');
      const [state] = await capacityState(target.db, target, { rule: 0, keys: ['1'] }, new Date());
      expect(state).toMatchObject({ taken: 248, held: 5 });
      // An offer changed while it runs moves nothing, and is not refused.
      expect(await refusal(w.update('waitlist', 1, { offered_until: later(6 * 60) }))).toBe('ok');
    });
  });
}
