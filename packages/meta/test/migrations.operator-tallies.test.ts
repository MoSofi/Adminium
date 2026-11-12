// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0089: what the server counts for its operator, on every available
 * dialect. A store from before the wave upgrades with nothing counted; adds
 * from two callers at once both count; a claim is taken once.
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
