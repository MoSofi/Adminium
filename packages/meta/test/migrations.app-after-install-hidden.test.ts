// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0083: an install's "After you install" list put away, on every
 * available dialect. An install from before the wave upgrades with nothing
 * hidden; hiding and showing again is one row; the row goes with the install.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ALL_MIGRATIONS, appAfterInstallRepo, applyMigrations, manifestsRepo } from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const T0 = 1_750_000_000_000;
const PRE_0083 = ALL_MIGRATIONS.filter((m) => m.name < '0083_app_after_install_hidden');
const crypto = { encrypt: (v: string) => v, decrypt: (v: string) => v };
const SHOP = { manifestKey: 'corner-shop', version: '1.0.0', kind: 'app' as const, source: 'file', document: { kind: 'app', key: 'corner-shop', version: '1.0.0' } };

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`0083_app_after_install_hidden [${dialect.name}]`, () => {
    let t: TestDb;

    beforeEach(async () => {
      t = await dialect.make();
    });
    afterEach(async () => {
      await t.destroy();
    });

    it('starts with nothing hidden, and hides and shows one install', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: PRE_0083 });
      const installed = await manifestsRepo(t.meta, crypto).install(SHOP, T0);
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });

      const repo = appAfterInstallRepo(t.meta);
      expect(await repo.hiddenAt(installed.row.id)).toBeNull();
      await repo.setHidden(installed.row.id, true, null, T0 + 1);
      expect(await repo.hiddenAt(installed.row.id)).toBe(T0 + 1);
      // Hiding again keeps one row, at the new time.
      await repo.setHidden(installed.row.id, true, null, T0 + 2);
      expect(await repo.hiddenAt(installed.row.id)).toBe(T0 + 2);
      await repo.setHidden(installed.row.id, false, null);
      expect(await repo.hiddenAt(installed.row.id)).toBeNull();
    });

    it('goes with the install', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      const installed = await manifestsRepo(t.meta, crypto).install(SHOP, T0);
      await appAfterInstallRepo(t.meta).setHidden(installed.row.id, true, null, T0);
      await manifestsRepo(t.meta, crypto).uninstall(installed.row.id);
      expect(await appAfterInstallRepo(t.meta).hiddenAt(installed.row.id)).toBeNull();
    });
  });
}
