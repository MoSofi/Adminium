// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The guard's own contract, below any door: it judges only rows whose locks
 * are held (a row that moved away from the lock it was named by starts the
 * write over, three times, then 409 `WRITE_CONFLICT`), it counts the rows it
 * is handed once whether they are in the table yet or not, and a quote holds
 * nothing and refuses exactly as a save.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withLimitLocks } from '../src/crud/capacity/door.js';
import { capacityLockNames, judgeCapacity } from '../src/crud/capacity/judge.js';
import { LockMoved, withNamedLocks } from '../src/crud/capacity/locks.js';
import { writeClock } from '../src/crud/write-clock.js';
import { LEGS, type World } from './capacity.helpers.js';
import { at, iso, kitchen } from './capacity-worlds.js';

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`the limit guard's contract on ${dialect}`, () => {
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

    it('refuses to judge a row whose lock is not held, and a door names again and gives up after three tries', async () => {
      w = await kitchen(dialect);
      const target = await w.target('orders');
      const row = { pickup_at: iso('2026-07-28 13:00'), status: 'placed' };
      const names = await capacityLockNames(target.db, [{ target, row, before: null, prepared: true }]);
      expect(names).toEqual([{ name: `${w.connectionId}|${target.table.id}|cap|slot|2026-07-28`, busy: 'CAPACITY_BUSY' }]);
      const judge = (db: typeof target.db) => judgeCapacity(db, [{ target, pk: null, row, before: null }], { clock: writeClock(), origin: 'dashboard', mode: 'save' });
      // Held under another day's name: the row is not where its lock was named.
      await expect(withNamedLocks(target, [{ name: `${w.connectionId}|${target.table.id}|cap|slot|2026-07-29`, busy: 'CAPACITY_BUSY' }], judge)).rejects.toBeInstanceOf(LockMoved);
      await expect(withNamedLocks(target, names, judge)).resolves.toMatchObject([{ key: at('2026-07-28 13:00').toISOString(), taken: 1, size: 6 }]);
      // A quote needs no lock at all.
      await expect(
        withNamedLocks(target, [], (db) => judgeCapacity(db, [{ target, pk: null, row, before: null }], { clock: writeClock(), origin: 'dashboard', mode: 'dry' })),
      ).resolves.toHaveLength(1);
      // Named wrong once, then right: the door's second try goes through; named wrong every time: 409.
      let tries = 0;
      const wrongOnce = async () => (++tries === 1 ? [] : names);
      await expect(withLimitLocks(target, wrongOnce, judge)).resolves.toHaveLength(1);
      expect(tries).toBe(2);
      await expect(withLimitLocks(target, async () => [], judge)).rejects.toMatchObject({ code: 'WRITE_CONFLICT', details: { retry: true } });
    });

    it('counts a row it is handed once, whether it is in the table yet or not', async () => {
      w = await kitchen(dialect);
      const target = await w.target('orders');
      const row = { pickup_at: iso('2026-07-28 12:15'), status: 'placed' };
      const names = await capacityLockNames(target.db, [{ target, row, before: null, prepared: true }]);
      const before = await withNamedLocks(target, names, (db) => judgeCapacity(db, [{ target, pk: null, row, before: null }], { clock: writeClock(), origin: 'dashboard', mode: 'save' }));
      expect(before[0]).toMatchObject({ taken: 3 });
      const made = await w.create('orders', row);
      const after = await withNamedLocks(target, names, (db) =>
        judgeCapacity(db, [{ target, pk: { id: made['id'] }, row: made, before: null }], { clock: writeClock(), origin: 'dashboard', mode: 'save' }),
      );
      expect(after[0]).toMatchObject({ taken: 3 });
    });
  });
}
