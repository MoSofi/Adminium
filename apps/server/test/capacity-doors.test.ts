// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The doors a write to a limited table comes through, other than a single
 * row: a bulk change or a public batch (no pool lock is held there, so a row
 * that could take from a limit is refused, and a row leaving what counts —
 * a bulk cancel — goes through), and history (an import, sample rows),
 * which is never judged but counts for every write after it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { capacityState } from '../src/crud/capacity/judge.js';
import { LEGS, refusal, type World } from './capacity.helpers.js';
import { at, iso, kitchen } from './capacity-worlds.js';

const staff = { origin: 'bulk' as const, hops: 0, actor: null, request: null };

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`a limited table's other doors on ${dialect}`, () => {
    let w: World | null = null;
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(at('2026-07-28 11:40'));
    });
    afterEach(async () => {
      vi.useRealTimers();
      await w?.close();
      w = null;
    });

    it('lets a bulk cancel through and refuses a bulk restore, a bulk move and a batch of new rows', async () => {
      w = await kitchen(dialect);
      const target = await w.target('orders');
      const rows = await w.query('select id from orders order by id');
      const plan = (values: Record<string, unknown>) => rows.map((row) => ({ match: { id: row['id'] }, values }));
      await expect(w.writes.beforeEach('update', target, staff, plan({ status: 'cancelled' }))).resolves.toHaveLength(2);
      for (const values of [{ status: 'placed' }, { pickup_at: iso('2026-07-28 13:00') }]) {
        await expect(w.writes.beforeEach('update', target, staff, plan(values))).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'CAPACITY_ONE_AT_A_TIME' } });
      }
      await expect(w.writes.beforeEach('create', target, staff, [{ values: { pickup_at: iso('2026-07-28 13:00') } }])).rejects.toMatchObject({
        details: { reason: 'CAPACITY_ONE_AT_A_TIME' },
      });
      // A batch of cancelled rows takes nothing.
      await expect(w.writes.beforeEach('create', target, staff, [{ values: { pickup_at: iso('2026-07-28 13:00'), status: 'cancelled' } }])).resolves.toHaveLength(1);
      // An order's lines: a bulk move of the orders' state into counting is refused for the lines they own.
      const lines = await w.target('order_items');
      await expect(w.writes.beforeEach('create', lines, staff, [{ values: { order_id: rows[0]!['id'], menu_item_id: 2, qty: 1 } }])).rejects.toMatchObject({
        details: { reason: 'CAPACITY_ONE_AT_A_TIME' },
      });
    });

    it('takes history unjudged, and counts it for the next write', async () => {
      w = await kitchen(dialect);
      const target = await w.target('orders');
      const history = { origin: 'import' as const, hops: 0, actor: null, request: null };
      // Six more orders at 12:15 than it holds: an import brings in what happened.
      const checked = await w.writes.check('create', target, history, Array.from({ length: 6 }, () => ({ pickup_at: iso('2026-07-28 12:15') })), { capacity: 'unchecked' });
      expect(checked.issues.every((issue) => issue === null)).toBe(true);
      await w.seed('orders', Array.from({ length: 6 }, () => ({ pickup_at: iso('2026-07-28 12:15'), status: 'placed' })));
      const [slot] = (await capacityState(target.db, target, { rule: 0, day: '2026-07-28' }, new Date())).filter((s) => s.key === at('2026-07-28 12:15').toISOString());
      expect(slot).toMatchObject({ taken: 8, size: 6, left: -2, fits: false });
      expect(await refusal(w.create('orders', { pickup_at: iso('2026-07-28 12:15') }))).toMatchObject({ code: 'CAPACITY_FULL' });
      // A status step on the over-full slot asks no count, and goes through.
      const any = (await w.query('select id from orders order by id'))[0]!['id'];
      expect(await refusal(w.update('orders', any, { status: 'ready' }))).toBe('ok');
    });
  });
}
