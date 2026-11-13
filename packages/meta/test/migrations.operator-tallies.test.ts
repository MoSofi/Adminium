// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0089: what the server counts for its operator, on every available
 * dialect. A store from before the wave upgrades with nothing counted; adds
 * from two callers at once both count; a claim is taken once; a raise keeps
 * the highest amount; a listing by prefix holds that prefix's names alone.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ALL_MIGRATIONS, applyMigrations, operatorTalliesRepo } from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const T0 = 1_750_000_000_000;
const PRE_0089 = ALL_MIGRATIONS.filter((m) => m.name < '0089_operator_tallies');

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`0089_operator_tallies [${dialect.name}]`, () => {
    let t: TestDb;

    beforeEach(async () => {
      t = await dialect.make();
    });
    afterEach(async () => {
      await t.destroy();
    });

    it('upgrades with nothing counted, then adds, at once from many callers, past 32 bits', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: PRE_0089 });
      expect((await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS })).applied).toContain('0089_operator_tallies');

      const repo = operatorTalliesRepo(t.meta);
      expect(await repo.get('ai-tokens')).toBeNull();
      await repo.open('ai-tokens', T0);
      expect(await repo.get('ai-tokens')).toEqual({ name: 'ai-tokens', amount: 0, changedAt: T0 });
      // Opening again keeps what is counted.
      await repo.add('ai-tokens', 5, T0 + 1);
      await repo.open('ai-tokens', T0 + 2);
      expect((await repo.get('ai-tokens'))?.amount).toBe(5);

      await Promise.all(Array.from({ length: 8 }, (_, n) => repo.add('ai-tokens', 10, T0 + 3 + n)));
      expect((await repo.get('ai-tokens'))?.amount).toBe(85);
      await repo.add('ai-tokens', 5_000_000_000, T0 + 20);
      expect(await repo.get('ai-tokens')).toEqual({ name: 'ai-tokens', amount: 5_000_000_085, changedAt: T0 + 20 });

      // A tally that was never opened starts at what is added.
      await repo.add('other', 3, T0);
      expect((await repo.get('other'))?.amount).toBe(3);
      await expect(repo.add('other', -1)).rejects.toThrow(/whole number/);
    });

    it('a claim is taken by one caller only, and can be taken back', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      const repo = operatorTalliesRepo(t.meta);
      const taken = await Promise.all([repo.claim('start-prompt', T0), repo.claim('start-prompt', T0), repo.claim('start-prompt', T0)]);
      expect(taken.filter(Boolean)).toHaveLength(1);
      expect(await repo.claim('start-prompt', T0 + 1)).toBe(false);
      await repo.release('start-prompt');
      expect(await repo.claim('start-prompt', T0 + 2)).toBe(true);
    });
  });
}

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`operator tallies kept at their highest [${dialect.name}]`, () => {
    let t: TestDb;

    beforeEach(async () => {
      t = await dialect.make();
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
    });
    afterEach(async () => {
      await t.destroy();
    });

    it('a raise keeps the highest amount, from many callers at once, past 32 bits', async () => {
      const repo = operatorTalliesRepo(t.meta);
      await repo.raise('peak:a', 40, T0);
      expect(await repo.get('peak:a')).toEqual({ name: 'peak:a', amount: 40, changedAt: T0 });
      // A lower amount changes nothing, not even when it changed.
      await repo.raise('peak:a', 10, T0 + 1);
      expect(await repo.get('peak:a')).toEqual({ name: 'peak:a', amount: 40, changedAt: T0 });
      await Promise.all([7, 90, 55, 12, 89].map((amount, n) => repo.raise('peak:b', amount, T0 + n)));
      expect((await repo.get('peak:b'))?.amount).toBe(90);
      await repo.raise('peak:a', 6_000_000_000, T0 + 2);
      expect((await repo.get('peak:a'))?.amount).toBe(6_000_000_000);
      await expect(repo.raise('peak:a', 1.5)).rejects.toThrow(/whole number/);
    });

    it('lists the tallies whose names start with a prefix, and no other', async () => {
      const repo = operatorTalliesRepo(t.meta);
      await repo.raise('peak:one:x', 1, T0);
      await repo.raise('peak:one:y', 2, T0);
      await repo.raise('peak:onex', 3, T0);
      await repo.raise('PEAK:ONE:Z', 4, T0);
      await repo.add('ai-tokens', 5, T0);
      const listed = await repo.list('peak:one:');
      expect(listed.map((tally) => [tally.name, tally.amount]).sort()).toEqual([
        ['peak:one:x', 1],
        ['peak:one:y', 2],
      ]);
      // A prefix that a LIKE would read as a pattern is refused.
      await expect(repo.list('peak_%')).rejects.toThrow(/prefix/);
    });
  });
}
