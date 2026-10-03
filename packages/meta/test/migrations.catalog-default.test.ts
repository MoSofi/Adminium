// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0050: an install that was there before 0.3.16 keeps its catalogue
 * switches as they were, on every available dialect.
 *
 * - A NEW store (every migration in one pass) is given no row: both switches
 *   read the new default, on.
 * - A store that already existed (its first migration was applied in an
 *   earlier run, whichever version it comes from) gets `false` for each switch it never stored: what it
 *   was running on. Upgrading starts no call to adminium.dev.
 * - A value somebody stored, on or off, is never touched.
 * - Running the wave again changes nothing.
 */
import { sql } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ALL_MIGRATIONS, applyMigrations, settingsRepo } from '../src/index.js';
import { up as up0050 } from '../src/migrations/0050_catalog_default.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const PRE_0050 = ALL_MIGRATIONS.filter((m) => m.name < '0050_catalog_default');
const DAY = 24 * 60 * 60 * 1000;

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`0050_catalog_default [${dialect.name}]`, () => {
    let t: TestDb;
    beforeEach(async () => {
      t = await dialect.make();
    });
    afterEach(async () => {
      await t.destroy();
    });

    const stored = async (): Promise<Record<string, unknown>> => {
      const rows = await sql<{ key: string; value: unknown }>`SELECT ${sql.ref('key')}, ${sql.ref('value')} FROM adminium_settings WHERE ${sql.ref('key')} IN ('addOns.catalogEnabled', 'apps.catalogEnabled')`.execute(t.meta.db);
      return Object.fromEntries(rows.rows.map((row) => [row.key, typeof row.value === 'string' ? JSON.parse(row.value) : row.value]));
    };

    it('leaves a new store on the new default: no row, both switches on', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      expect(await stored()).toEqual({});
      expect(await settingsRepo(t.meta).get('addOns.catalogEnabled')).toBe(true);
      expect(await settingsRepo(t.meta).get('apps.catalogEnabled')).toBe(true);
    });

    it('writes off for a store that was there before, and only where nothing was stored', async () => {
      // An install made by an earlier version, a day ago.
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: PRE_0050 });
      await sql`UPDATE adminium_migrations SET applied_at = ${Date.now() - DAY}`.execute(t.meta.db);
      // Its operator switched the add-on list ON; the app list was never touched.
      await sql`INSERT INTO adminium_settings (${sql.ref('key')}, ${sql.ref('value')}, updated_at, updated_by) VALUES (${'addOns.catalogEnabled'}, ${'true'}, ${Date.now() - DAY}, ${null})`.execute(t.meta.db);

      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      expect(await stored()).toEqual({ 'addOns.catalogEnabled': true, 'apps.catalogEnabled': false });
      expect(await settingsRepo(t.meta).get('addOns.catalogEnabled')).toBe(true);
      expect(await settingsRepo(t.meta).get('apps.catalogEnabled')).toBe(false);

      // Again: nothing moves, and a later change of mind by the operator stands.
      await settingsRepo(t.meta).set('apps.catalogEnabled', true);
      await up0050(t.meta.db as never, undefined as never);
      expect(await stored()).toEqual({ 'addOns.catalogEnabled': true, 'apps.catalogEnabled': true });
    });

    it('writes off for both on an upgraded store that stored neither, and a stored off stays off', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: PRE_0050 });
      await sql`UPDATE adminium_migrations SET applied_at = ${Date.now() - DAY}`.execute(t.meta.db);
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      expect(await stored()).toEqual({ 'addOns.catalogEnabled': false, 'apps.catalogEnabled': false });
    });

    it('keeps a store from before 0.3.13 off too: it applies the migration before this one in the same pass', async () => {
      // 0049 first shipped in 0.3.13. A store on 0.3.12 has neither it nor this one.
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS.filter((m) => m.name < '0049_project_apps') });
      await sql`UPDATE adminium_migrations SET applied_at = ${Date.now() - 30 * DAY}`.execute(t.meta.db);
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      expect(await stored()).toEqual({ 'addOns.catalogEnabled': false, 'apps.catalogEnabled': false });
      expect(await settingsRepo(t.meta).get('addOns.catalogEnabled')).toBe(false);
    });

    it('keeps a store from the very first version off', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS.slice(0, 3) });
      await sql`UPDATE adminium_migrations SET applied_at = ${Date.now() - 300 * DAY}`.execute(t.meta.db);
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      expect(await stored()).toEqual({ 'addOns.catalogEnabled': false, 'apps.catalogEnabled': false });
    });

    it('reads a first pass that began a few minutes ago as the same run', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: PRE_0050 });
      // A slow first pass on a far database, five minutes in: still a new store.
      await sql`UPDATE adminium_migrations SET applied_at = ${Date.now() - 5 * 60_000}`.execute(t.meta.db);
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      expect(await stored()).toEqual({});
    });
  });
}
