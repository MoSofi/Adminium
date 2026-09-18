// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0035 (option lists): `adminium_option_lists` lands on every dialect, and
 * the repo over it keeps the two promises the rest of the plan relies on — the
 * key is unique and the key never moves.
 *
 * Runs the real migration list split at 0034/0035 on every available dialect,
 * because the unique index and the JSON column are exactly where a
 * portable-DDL mistake shows up, and sqlite alone would not find it (MySQL
 * cannot `CREATE INDEX IF NOT EXISTS`, and its `json` column is not text).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ALL_MIGRATIONS, applyMigrations, optionListsRepo } from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const T0 = 1_750_000_000_000;
const PRE_0035 = ALL_MIGRATIONS.filter((m) => m.name < '0035_option_lists');

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`0035_option_lists [${dialect.name}]`, () => {
    let t: TestDb;

    beforeEach(async () => {
      t = await dialect.make();
    });
    afterEach(async () => {
      await t.destroy();
    });

    it('upgrades a released install rather than needing a fresh one', async () => {
      // Ends exactly where 0035 begins — not "0035 is last", which every later
      // wave would invalidate.
      expect(PRE_0035.at(-1)?.name).toBe('0034_project_files');
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: PRE_0035 });
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });

      const repo = optionListsRepo(t.meta);
      expect(await repo.list()).toEqual([]);
    });

    it('stores a list and reads its items back as items, not as text', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      const repo = optionListsRepo(t.meta);

      const created = await repo.create(
        {
          key: 'departments',
          name: 'Departments',
          items: [
            { value: 'support', label: 'Support' },
            { value: 'ops', label: 'Operations', tone: 'accent' },
          ],
        },
        T0,
      );
      expect(created.id.startsWith('opl_')).toBe(true);
      expect(created.origin).toBe('custom');

      // `jsonb` on postgres, `json` on MySQL, `text` on SQLite — the driver
      // decodes two of the three, and the repo has to answer the same shape on
      // all of them.
      const read = await repo.findByKey('departments');
      expect(read?.items).toEqual([
        { value: 'support', label: 'Support' },
        { value: 'ops', label: 'Operations', tone: 'accent' },
      ]);
    });

    it('refuses a second list with the same key', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      const repo = optionListsRepo(t.meta);
      await repo.create({ key: 'stages', name: 'Stages', items: [{ value: 'new' }] }, T0);
      // The key is what rules and project files name; two lists answering to it
      // would make a rule mean different things in two installs.
      await expect(
        repo.create({ key: 'stages', name: 'Stages again', items: [{ value: 'old' }] }, T0),
      ).rejects.toThrow(/already exists/);
    });

    it('refuses an empty list, a duplicate value and a key that is not a slug', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      const repo = optionListsRepo(t.meta);
      await expect(repo.create({ key: 'empty', name: 'Empty', items: [] })).rejects.toThrow(/not a list/);
      await expect(
        repo.create({ key: 'dupes', name: 'Dupes', items: [{ value: 'a' }, { value: 'a' }] }),
      ).rejects.toThrow(/listed twice/);
      await expect(
        repo.create({ key: 'Not A Slug', name: 'Bad', items: [{ value: 'a' }] }),
      ).rejects.toThrow(/invalid option list key/);
    });

    it('edits the name and the items, and never the key', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      const repo = optionListsRepo(t.meta);
      await repo.create({ key: 'stages', name: 'Stages', items: [{ value: 'new' }] }, T0);

      const updated = await repo.update('stages', { name: 'Pipeline stages', items: [{ value: 'open' }] }, T0 + 5);
      expect(updated?.name).toBe('Pipeline stages');
      expect(updated?.items).toEqual([{ value: 'open' }]);
      expect(updated?.key).toBe('stages');
      expect(await repo.update('nothing-here', { name: 'x' })).toBeNull();
    });

    it('moves its revision whenever any list does', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      const repo = optionListsRepo(t.meta);

      const empty = await repo.revision();
      await repo.create({ key: 'stages', name: 'Stages', items: [{ value: 'new' }] }, T0);
      const created = await repo.revision();
      expect(created).not.toBe(empty);

      await repo.update('stages', { items: [{ value: 'open' }] }, T0 + 1000);
      const edited = await repo.revision();
      expect(edited).not.toBe(created);

      // The delete has to move it too, which a `max(updated_at)` alone would
      // not: removing the newest row lowers the max back to an old value.
      await repo.remove('stages');
      expect(await repo.revision()).not.toBe(edited);
    });
  });
}
