// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0088: what the server's operator holds back, on every available
 * dialect. A store from before the wave upgrades with nothing held; setting a
 * hold on and off is one row, and its reason and time read back as written.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ALL_MIGRATIONS, applyMigrations, OPERATOR_HOLD_REASON_WIDTH, operatorHoldsRepo } from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const T0 = 1_750_000_000_000;
const PRE_0088 = ALL_MIGRATIONS.filter((m) => m.name < '0088_operator_holds');

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`0088_operator_holds [${dialect.name}]`, () => {
    let t: TestDb;

    beforeEach(async () => {
      t = await dialect.make();
    });
    afterEach(async () => {
      await t.destroy();
    });

    it('upgrades with nothing held, then holds and releases one row', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: PRE_0088 });
      expect((await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS })).applied).toContain('0088_operator_holds');

      const repo = operatorHoldsRepo(t.meta);
      expect(await repo.get('public-pages')).toBeNull();
      const reason = `A sign-in form that looks like another company’s. ${'x'.repeat(OPERATOR_HOLD_REASON_WIDTH - 60)}`;
      await repo.set({ name: 'public-pages', held: true, reason }, T0);
      expect(await repo.get('public-pages')).toEqual({ name: 'public-pages', held: true, reason, changedAt: T0 });
      await repo.set({ name: 'public-pages', held: false, reason: null }, T0 + 1);
      expect(await repo.get('public-pages')).toEqual({ name: 'public-pages', held: false, reason: null, changedAt: T0 + 1 });
      const rows = await t.meta.db.selectFrom('adminium_operator_holds').selectAll().execute();
      expect(rows).toHaveLength(1);
    });

    it('refuses a reason longer than its column', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      await expect(operatorHoldsRepo(t.meta).set({ name: 'public-pages', held: true, reason: 'x'.repeat(OPERATOR_HOLD_REASON_WIDTH + 1) })).rejects.toThrow(/longer/);
    });
  });
}
