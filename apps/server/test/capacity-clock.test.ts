// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Limits on the night the venue's clocks go back (Sunday 25 October 2026,
 * Europe/London), with the server itself in another zone: each wall time of
 * the kitchen's small hours is one slot, a hold ending in the repeated hour
 * ends at its instant, and a stay across the change takes one night per date.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { capacityState } from '../src/crud/capacity/judge.js';
import { LEGS, type World } from './capacity.helpers.js';
import { house, kitchen, neon } from './capacity-worlds.js';

const SERVER_ZONE = 'America/Los_Angeles';

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`the night the clocks go back, on ${dialect}`, () => {
    let w: World | null = null;
    let zone: string | undefined;
    beforeAll(() => {
      zone = process.env.TZ;
      process.env.TZ = SERVER_ZONE;
    });
    afterAll(() => {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    });
    afterEach(async () => {
      vi.useRealTimers();
      await w?.close();
      w = null;
    });

    it('offers each wall time of the small hours once, the first reading of the repeated one', async () => {
      w = await kitchen(dialect);
      await w.query(`update hours set opens = '00:30', closes = '03:00' where weekday = 'sun'`);
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-24T12:00:00.000Z'));
      const answer = await w.staff('orders/capacity-counts?date=2026-10-25');
      const times = (answer.body['data'] as { rows: { time: string }[] }).rows.map((r) => r.time);
      expect(times).toEqual(['00:30', '00:45', '01:00', '01:15', '01:30', '01:45', '02:00', '02:15', '02:30', '02:45']);
      // 01:30 is the first reading (00:30 UTC): an order there fills that slot, not the one an hour on.
      const target = await w.target('orders');
      await w.create('orders', { pickup_at: '2026-10-25T00:30:00.000Z' });
      const slots = await capacityState(target.db, target, { rule: 0, day: '2026-10-25' }, new Date());
      expect(slots.filter((s) => s.taken > 0).map((s) => s.key)).toEqual(['2026-10-25T00:30:00.000Z']);
    });

    it('ends a hold in the repeated hour at its instant', async () => {
      w = await neon(dialect);
      // 01:30 on the second reading: 01:30 UTC.
      await w.query(`update orders set status = 'held' where id = 2`);
      const target = await w.target('orders');
      await w.writes.update({ target, pk: { id: 2 }, values: { held_until: '2026-10-25T01:30:00.000Z' }, context: { origin: 'import', hops: 0, actor: null, request: null }, announce: async () => {} });
      const tickets = await w.target('tickets');
      const held = async (instant: string) => (await capacityState(tickets.db, tickets, { rule: 0, keys: ['1'] }, new Date(instant)))[0]!.held;
      expect(await held('2026-10-25T00:59:59.000Z')).toBe(3);
      expect(await held('2026-10-25T01:29:59.000Z')).toBe(3);
      expect(await held('2026-10-25T01:30:00.000Z')).toBe(0);
    });

    it('takes one night per date for a stay across the change', async () => {
      w = await house(dialect);
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-20T09:00:00.000Z'));
      await w.create('stays', { arrive: '2026-10-24', depart: '2026-10-26', room_type_id: 1 }, 'public');
      const target = await w.target('stays');
      const nights = await capacityState(target.db, target, { rule: 0, keys: ['1'], from: '2026-10-23', to: '2026-10-27' }, new Date());
      expect(nights.map((n) => [n.at, n.taken])).toEqual([
        ['2026-10-23', 0],
        ['2026-10-24', 1],
        ['2026-10-25', 1],
        ['2026-10-26', 0],
      ]);
    });
  });
}
