// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0078: an app update that moved its version and has not finished, on
 * every available dialect. An install from before the wave upgrades as it
 * was; an update is kept from its first start to its finish, a second run
 * keeps the version it first came from; and the row goes with the install.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ALL_MIGRATIONS, applyMigrations, appUpdatesRepo, manifestsRepo } from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const T0 = 1_750_000_000_000;
const PRE_0078 = ALL_MIGRATIONS.filter((m) => m.name < '0078_app_updates');
const crypto = { encrypt: (v: string) => v, decrypt: (v: string) => v };
const SHOP = { manifestKey: 'corner-shop', version: '1.0.0', kind: 'app' as const, source: 'file', document: { kind: 'app', key: 'corner-shop', version: '1.0.0' } };

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`0078_app_updates [${dialect.name}]`, () => {
    let t: TestDb;

    beforeEach(async () => {
      t = await dialect.make();
    });
    afterEach(async () => {
      await t.destroy();
    });

    it('keeps an unfinished update from its start to its finish', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: PRE_0078 });
      const installed = await manifestsRepo(t.meta, crypto).install(SHOP, T0);
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });

      const repo = appUpdatesRepo(t.meta);
      expect(await repo.find(installed.row.id)).toBeNull();
      await repo.begin({ manifestId: installed.row.id, fromVersion: '1.0.0', toVersion: '1.1.0', fromTables: ['orders', 'items'] }, T0 + 1);
      await repo.stopped(installed.row.id, 'pages', T0 + 2);
      // Listed for the installed apps, so a copy stopped part way says so after a reload.
      expect((await repo.list()).map((update) => [update.manifestId, update.toVersion, update.stoppedAt])).toEqual([[installed.row.id, '1.1.0', 'pages']]);
      expect(await repo.find(installed.row.id)).toEqual({
        manifestId: installed.row.id,
        fromVersion: '1.0.0',
        toVersion: '1.1.0',
        fromTables: ['orders', 'items'],
        stoppedAt: 'pages',
        startedAt: T0 + 1,
        updatedAt: T0 + 2,
      });

      // Run again, to a later version: it still came from 1.0.0, and runs.
      await repo.begin({ manifestId: installed.row.id, fromVersion: '1.1.0', toVersion: '1.2.0', fromTables: ['orders'] }, T0 + 3);
      expect(await repo.find(installed.row.id)).toMatchObject({ fromVersion: '1.0.0', toVersion: '1.2.0', fromTables: ['orders', 'items'], stoppedAt: null });

      await repo.finish(installed.row.id);
      expect(await repo.find(installed.row.id)).toBeNull();
      expect(await repo.list()).toEqual([]);
    });

    it('goes with the install', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      const installed = await manifestsRepo(t.meta, crypto).install(SHOP, T0);
      await appUpdatesRepo(t.meta).begin({ manifestId: installed.row.id, fromVersion: '1.0.0', toVersion: '1.1.0', fromTables: [] }, T0);
      await manifestsRepo(t.meta, crypto).uninstall(installed.row.id);
      expect(await appUpdatesRepo(t.meta).find(installed.row.id)).toBeNull();
    });

    it('refuses a step longer than its column before the database sees it', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      const installed = await manifestsRepo(t.meta, crypto).install(SHOP, T0);
      await appUpdatesRepo(t.meta).begin({ manifestId: installed.row.id, fromVersion: '1.0.0', toVersion: '1.1.0', fromTables: [] }, T0);
      await expect(appUpdatesRepo(t.meta).stopped(installed.row.id, 's'.repeat(33))).rejects.toThrow('longer than its column');
    });
  });
}
