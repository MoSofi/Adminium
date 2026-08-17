// SPDX-License-Identifier: AGPL-3.0-only
/**
 * localesRepo + translationsRepo (23-runtime-translations.md §3.1–§3.4).
 *
 * The load-bearing behaviours under test are the ones the design depends on:
 * the three override states (absent / text / deliberately blank), reset being
 * a hard DELETE rather than an empty write, and the version stamp moving on
 * every mutation INCLUDING deletes — which is exactly what a
 * `MAX(updated_at)` stamp could not do.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  applyMigrations,
  localesRepo,
  readI18nVersion,
  settingsRepo,
  translationsRepo,
} from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const T0 = 1_750_000_000_000;

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`localesRepo + translationsRepo [${dialect.name}]`, () => {
    let t: TestDb;

    beforeEach(async () => {
      t = await dialect.make();
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect });
    });
    afterEach(async () => {
      await t.destroy();
    });

    it('starts empty — zero rows is the "behaves exactly like today" state', async () => {
      expect(await localesRepo(t.meta).list()).toEqual([]);
      expect(await translationsRepo(t.meta).listLocale('de_DE')).toEqual([]);
      expect(await readI18nVersion(t.meta.db)).toBe(0);
      expect(await settingsRepo(t.meta).get('i18n.version')).toBe(0);
    });

    it('keeps a built-in row to enabled/sortOrder only', async () => {
      const locales = localesRepo(t.meta);
      const row = await locales.upsertBuiltin('ar_EG', { enabled: false, sortOrder: 3 }, { at: T0 });
      expect(row.isBuiltin).toBe(true);
      expect(row.enabled).toBe(false);
      expect(row.sortOrder).toBe(3);
      // Direction/fonts/names stay null: the compiled registry owns them, so an
      // admin cannot flip ar_EG to ltr and corrupt a shipped bundle.
      expect(row.dir).toBeNull();
      expect(row.fontHint).toBeNull();
      expect(row.native).toBeNull();
      expect(row.intlTag).toBeNull();

      const again = await locales.upsertBuiltin('ar_EG', { enabled: true }, { at: T0 + 1 });
      expect(again.enabled).toBe(true);
      expect(again.sortOrder).toBe(3); // untouched by a partial update
      expect((await locales.list()).length).toBe(1);
    });

    it('round-trips a custom locale with its frozen plural categories', async () => {
      const locales = localesRepo(t.meta);
      await locales.upsertCustom(
        'tlh_KL',
        {
          english: 'Klingon',
          native: 'tlhIngan Hol',
          dir: 'ltr',
          fontHint: 'latin',
          intlTag: 'pl-PL',
          pluralCategories: ['one', 'few', 'many', 'other'],
        },
        { at: T0 },
      );
      const row = await locales.get('tlh_KL');
      expect(row?.isBuiltin).toBe(false);
      expect(row?.native).toBe('tlhIngan Hol');
      expect(row?.intlTag).toBe('pl-PL');
      expect(row?.pluralCategories).toEqual(['one', 'few', 'many', 'other']);
    });

    it('orders the list by sortOrder then locale', async () => {
      const locales = localesRepo(t.meta);
      await locales.upsertBuiltin('zh_CN', { sortOrder: 2 }, { at: T0 });
      await locales.upsertBuiltin('de_DE', { sortOrder: 1 }, { at: T0 });
      await locales.upsertBuiltin('ar_EG', { sortOrder: 1 }, { at: T0 });
      expect((await locales.list()).map((l) => l.locale)).toEqual(['ar_EG', 'de_DE', 'zh_CN']);
    });

    it('distinguishes the three override states', async () => {
      const tr = translationsRepo(t.meta);
      const ref = { locale: 'de_DE', namespace: 'common', key: 'account.title' };

      // 1. absent
      expect(await tr.get(ref)).toBeNull();

      // 2. override
      await tr.upsert({ ...ref, value: 'Mein Konto', sourceText: 'Account' }, { at: T0 });
      expect((await tr.get(ref))?.value).toBe('Mein Konto');
      expect((await tr.get(ref))?.sourceText).toBe('Account');

      // 3. deliberately blank — a ROW with an empty value, not an absence
      await tr.upsert({ ...ref, value: '' }, { at: T0 + 1 });
      const blank = await tr.get(ref);
      expect(blank).not.toBeNull();
      expect(blank?.value).toBe('');

      // reset is a hard DELETE, which is a different operation from (3)
      expect(await tr.remove(ref)).toBe(true);
      expect(await tr.get(ref)).toBeNull();
      expect(await tr.remove(ref)).toBe(false);
    });

    it('bumps the version stamp on every mutation, deletes included', async () => {
      const tr = translationsRepo(t.meta);
      const locales = localesRepo(t.meta);
      const ref = { locale: 'de_DE', namespace: 'ui', key: 'action.save' };

      await tr.upsert({ ...ref, value: 'Sichern' }, { at: T0 });
      const afterWrite = await readI18nVersion(t.meta.db);
      expect(afterWrite).toBe(1);

      // The whole reason the stamp is a counter and not MAX(updated_at):
      // reset-to-built-in removes the row, so a max-timestamp would go
      // BACKWARDS (or not move) on the most common admin operation.
      await tr.remove(ref, { at: T0 + 1 });
      expect(await readI18nVersion(t.meta.db)).toBe(2);

      await locales.upsertBuiltin('de_DE', { enabled: false }, { at: T0 + 2 });
      expect(await readI18nVersion(t.meta.db)).toBe(3);

      await locales.remove('de_DE', { at: T0 + 3 });
      expect(await readI18nVersion(t.meta.db)).toBe(4);

      // A no-op delete must not move it.
      await tr.remove({ locale: 'fr_FR', namespace: 'ui', key: 'nope' });
      expect(await readI18nVersion(t.meta.db)).toBe(4);
    });

    it('writes a bulk batch atomically under a single version bump', async () => {
      const tr = translationsRepo(t.meta);
      await tr.upsertMany(
        [
          { locale: 'fr_FR', namespace: 'common', key: 'a.one', value: 'un' },
          { locale: 'fr_FR', namespace: 'common', key: 'a.two', value: 'deux' },
          { locale: 'fr_FR', namespace: 'ui', key: 'action.save', value: 'Enregistrer' },
        ],
        { at: T0 },
      );
      expect(await readI18nVersion(t.meta.db)).toBe(1);
      expect((await tr.listBundle('fr_FR', 'common')).map((r) => r.key)).toEqual(['a.one', 'a.two']);
      expect((await tr.listLocale('fr_FR')).length).toBe(3);
    });

    it('serves the editor slice through an IN lookup', async () => {
      const tr = translationsRepo(t.meta);
      await tr.upsertMany(
        [
          { locale: 'de_DE', namespace: 'ui', key: 'action.save', value: 'Sichern' },
          { locale: 'de_DE', namespace: 'ui', key: 'action.cancel', value: 'Abbruch' },
        ],
        { at: T0 },
      );
      const slice = await tr.listKeys('de_DE', 'ui', ['action.save', 'action.missing']);
      expect(slice.map((r) => r.key)).toEqual(['action.save']);
      expect(await tr.listKeys('de_DE', 'ui', [])).toEqual([]);
    });

    it('measures per-locale override bytes for the budget check', async () => {
      const tr = translationsRepo(t.meta);
      await tr.upsertMany(
        [
          { locale: 'de_DE', namespace: 'common', key: 'a', value: 'abcde' },
          { locale: 'de_DE', namespace: 'ui', key: 'b', value: 'fg' },
          { locale: 'de_DE', namespace: 'studio', key: 'c', value: 'ignored-namespace' },
        ],
        { at: T0 },
      );
      expect(await tr.byteSize('de_DE', ['common', 'ui', 'errors'])).toBe(7);
      expect(await tr.byteSize('de_DE', [])).toBe(0);
    });

    it('drops every override for a locale when the locale is deleted', async () => {
      const tr = translationsRepo(t.meta);
      await tr.upsertMany(
        [
          { locale: 'tlh_KL', namespace: 'common', key: 'a', value: 'x' },
          { locale: 'tlh_KL', namespace: 'ui', key: 'b', value: 'y' },
          { locale: 'de_DE', namespace: 'ui', key: 'b', value: 'z' },
        ],
        { at: T0 },
      );
      expect(await tr.removeLocale('tlh_KL', { at: T0 + 1 })).toBe(2);
      expect(await tr.listLocale('tlh_KL')).toEqual([]);
      expect((await tr.listLocale('de_DE')).length).toBe(1);
    });

    it('counts overrides per locale for the manifest', async () => {
      const tr = translationsRepo(t.meta);
      await tr.upsertMany(
        [
          { locale: 'de_DE', namespace: 'common', key: 'a', value: '1' },
          { locale: 'de_DE', namespace: 'ui', key: 'b', value: '2' },
          { locale: 'fr_FR', namespace: 'ui', key: 'b', value: '3' },
        ],
        { at: T0 },
      );
      const counts = await tr.countsByLocale();
      expect(counts.get('de_DE')).toBe(2);
      expect(counts.get('fr_FR')).toBe(1);
      expect(counts.get('zh_CN')).toBeUndefined();
    });
  });
}
