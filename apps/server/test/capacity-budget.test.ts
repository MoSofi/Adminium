// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What one guest's question of a limit costs the source database, counted
 * statement by statement: a fixed handful whatever the range asked, so a
 * page asking a month of days, or a show's every type, never reads a pool
 * row by row. And a month's strip over a busy kitchen answers quickly.
 */
import type { KyselyPlugin, PluginTransformQueryArgs, PluginTransformResultArgs, QueryResult, RootOperationNode, UnknownRow } from 'kysely';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { nightAnswer, parentAnswer, ruleOf, slotDayAnswer, slotStripAnswer } from '../src/crud/capacity/availability.js';
import type { NightRule, ParentRule, SlotRule } from '../src/crud/capacity/rules.js';
import { LEGS, type World } from './capacity.helpers.js';
import { at, house, iso, kitchen, neon, NEON_NOW } from './capacity-worlds.js';

/** Counts the statements run through a handle. */
class Counting implements KyselyPlugin {
  count = 0;
  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    this.count += 1;
    return args.node;
  }
  async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
    return args.result;
  }
}

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`what a guest's question of a limit costs, on ${dialect}`, () => {
    let w: World | null = null;
    beforeEach(() => vi.useFakeTimers({ toFake: ['Date'] }));
    afterEach(async () => {
      vi.useRealTimers();
      await w?.close();
      w = null;
    });

    const counted = async <T>(table: string, ask: (db: World['db'], target: Awaited<ReturnType<World['target']>>) => Promise<T>) => {
      const target = await w!.target(table);
      const counter = new Counting();
      const db = target.db.withPlugin(counter);
      await ask(db, { ...target, db });
      return counter.count;
    };

    it('asks a slot day in at most five statements and a month of days in at most six', async () => {
      vi.setSystemTime(at('2026-07-28 11:40'));
      w = await kitchen(dialect);
      const rule = ruleOf(await w.target('orders'), 0) as SlotRule;
      expect(await counted('orders', (db, t) => slotDayAnswer(db, t, rule, '2026-07-28', 1, new Date()))).toBeLessThanOrEqual(5);
      expect(await counted('orders', (db, t) => slotStripAnswer(db, t, rule, '2026-07-28', 31, 1, new Date()))).toBeLessThanOrEqual(6);
    });

    it("asks a show's types in at most six statements", async () => {
      vi.setSystemTime(NEON_NOW);
      w = await neon(dialect);
      const rule = ruleOf(await w.target('tickets'), 0) as ParentRule;
      const n = await counted('tickets', (db, t) => parentAnswer(db, t, rule, ['1', '2', '3'], { qty: 2, now: new Date(), showLeft: { below: 20 } }));
      expect(n).toBeLessThanOrEqual(6);
    });

    it("asks a stay's room types in at most five statements, the earliest arrival included", async () => {
      vi.setSystemTime(new Date('2026-07-20T09:00:00.000Z'));
      w = await house(dialect);
      const rule = ruleOf(await w.target('stays'), 0) as NightRule;
      const plain = await counted('stays', (db, t) => nightAnswer(db, t, rule, ['1', '2', '3'], { from: '2026-07-31', to: '2026-08-02', now: new Date() }));
      const earliest = await counted('stays', (db, t) => nightAnswer(db, t, rule, ['1', '2', '3'], { from: '2026-07-31', to: '2026-08-02', earliest: 30, now: new Date() }));
      expect(plain).toBeLessThanOrEqual(5);
      expect(earliest).toBe(plain);
    });

    it.runIf(dialect === 'sqlite')('answers a month of days over five thousand orders in under 300 ms', async () => {
      vi.setSystemTime(at('2026-07-28 11:40'));
      w = await kitchen(dialect);
      const rows = Array.from({ length: 5000 }, (_, i) => ({ pickup_at: iso(`2026-${i % 2 === 0 ? '07' : '08'}-${String(1 + (i % 28)).padStart(2, '0')} 13:00`), status: 'placed' }));
      await w.seed('orders', rows);
      const target = await w.target('orders');
      const rule = ruleOf(target, 0) as SlotRule;
      const started = performance.now();
      await slotStripAnswer(target.db, target, rule, '2026-07-28', 31, 1, new Date());
      expect(performance.now() - started).toBeLessThan(300);
    });
  });
}
