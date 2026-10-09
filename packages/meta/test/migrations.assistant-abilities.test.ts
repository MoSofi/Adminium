// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0054: a workspace that was there before keeps what its assistant
 * did (it could save its drafts as new documents), on every available dialect.
 *
 * - A NEW store (every migration in one pass) is given no row: all four
 *   switches read the default, off.
 * - A store that existed AND has somebody in it gets `create` on and the
 *   other three off.
 * - A store that existed and was never set up (no user) is given nothing.
 * - A value somebody stored is never touched; running it again changes nothing.
 */
import { sql } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ALL_MIGRATIONS, applyMigrations, settingsRepo, usersRepo } from '../src/index.js';
import { up as up0054 } from '../src/migrations/0054_assistant_abilities.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const WAVE = '0054_assistant_abilities';
const BEFORE = ALL_MIGRATIONS.filter((m) => m.name < WAVE);
const DAY = 24 * 60 * 60 * 1000;
const OFF = { create: false, change: false, send: false, delete: false };

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`${WAVE} [${dialect.name}]`, () => {
    let t: TestDb;
    beforeEach(async () => {
      t = await dialect.make();
    });
    afterEach(async () => {
      await t.destroy();
    });

    const stored = async (): Promise<unknown> => {
      const rows = await sql<{ value: unknown }>`SELECT ${sql.ref('value')} FROM adminium_settings WHERE ${sql.ref('key')} = ${'assistant.abilities'}`.execute(t.meta.db);
      const value = rows.rows[0]?.value;
      return value === undefined ? null : typeof value === 'string' ? JSON.parse(value) : value;
    };
    /** An install made by an earlier version, a day ago. */
    const yesterday = async (): Promise<void> => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: BEFORE });
      await sql`UPDATE adminium_migrations SET applied_at = ${Date.now() - DAY}`.execute(t.meta.db);
    };
    const someone = () => usersRepo(t.meta).create({ email: 'owner@example.test', name: 'Owner', passwordHash: 'x' });

    it('leaves a new store with everything off: no row is written', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      await someone();
      expect(await stored()).toBeNull();
      expect(await settingsRepo(t.meta).get('assistant.abilities')).toEqual(OFF);
      expect(await settingsRepo(t.meta).get('assistant.maxRows')).toBe(50);
    });

    it('gives a workspace that was in use create, and nothing else', async () => {
      await yesterday();
      await someone();
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      expect(await stored()).toEqual({ ...OFF, create: true });
      expect(await settingsRepo(t.meta).get('assistant.abilities')).toEqual({ ...OFF, create: true });
    });

    it('gives a store that was migrated and never set up nothing: there is nobody whose work would change', async () => {
      await yesterday();
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      expect(await stored()).toBeNull();
    });

    it('never touches a stored value, and changes nothing when it runs again', async () => {
      await yesterday();
      await someone();
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      // The operator then switches create off and change on.
      await settingsRepo(t.meta).set('assistant.abilities', { ...OFF, change: true });
      await up0054(t.meta.db as never, undefined as never);
      expect(await stored()).toEqual({ ...OFF, change: true });
    });

    it('refuses a value that is not the four switches', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      await expect(settingsRepo(t.meta).set('assistant.abilities', { create: true } as never)).rejects.toThrow();
      await expect(settingsRepo(t.meta).set('assistant.maxRows', 51)).rejects.toThrow();
    });
  });
}
