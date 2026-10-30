// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0072: the desktop first-run wizard's `common.desktop.setup.*` messages
 * became `common.onboarding.desktopSetup.*` (a deferred group of `common`), so
 * every override an admin wrote against the old key has to be re-filed or it
 * silently stops resolving. The twin of 0043's test, with the namespace kept
 * and only the key moved.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ALL_MIGRATIONS, applyMigrations } from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const T0 = 1_750_000_000_000;

const PRE_0072 = ALL_MIGRATIONS.filter((m) => m.name < '0072_desktop_setup_words');

function row(id: string, namespace: string, key: string, value: string, locale = 'de_DE') {
  return {
    id,
    scope: 'workspace',
    locale,
    namespace,
    key,
    value,
    sourceText: null,
    updatedBy: null,
    createdAt: T0,
    updatedAt: T0,
  };
}

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`0072_desktop_setup_words [${dialect.name}]`, () => {
    let t: TestDb;

    beforeEach(async () => {
      t = await dialect.make();
    });
    afterEach(async () => {
      await t.destroy();
    });

    async function overrides() {
      return t.meta.db
        .selectFrom('adminium_translations')
        .select(['locale', 'namespace', 'key', 'value'])
        .orderBy('namespace')
        .orderBy('key')
        .orderBy('locale')
        .execute();
    }

    it('re-files every `common` `desktop.setup.*` override under `onboarding.desktopSetup.*`', async () => {
      // The filter must end exactly where 0072 begins.
      expect(PRE_0072.at(-1)?.name).toBe('0071_pictures_made');
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: PRE_0072 });

      await t.meta.db
        .insertInto('adminium_translations')
        .values([
          row('trn_ttl', 'common', 'desktop.setup.title', 'Willkommen bei der Bäckerei'),
          row('trn_ttf', 'common', 'desktop.setup.title', 'Bienvenue', 'fr_FR'),
          row('trn_dsn', 'common', 'desktop.setup.source.remote.dsn', 'Verbindungstext'),
          // Untouched neighbours: the rest of `desktop.*` (the topbar chip stays
          // eager), a key that only CONTAINS the prefix, and the same prefix in
          // another namespace.
          row('trn_chp', 'common', 'desktop.chip.local', 'Lokal'),
          row('trn_nst', 'common', 'nav.desktop.setup.title', 'Einrichtung'),
          row('trn_std', 'studio', 'desktop.setup.title', 'Studio-Einrichtung'),
        ])
        .execute();

      await applyMigrations(t.meta.db, { dialect: t.meta.dialect });

      expect(await overrides()).toEqual([
        { locale: 'de_DE', namespace: 'common', key: 'desktop.chip.local', value: 'Lokal' },
        { locale: 'de_DE', namespace: 'common', key: 'nav.desktop.setup.title', value: 'Einrichtung' },
        { locale: 'de_DE', namespace: 'common', key: 'onboarding.desktopSetup.source.remote.dsn', value: 'Verbindungstext' },
        { locale: 'de_DE', namespace: 'common', key: 'onboarding.desktopSetup.title', value: 'Willkommen bei der Bäckerei' },
        { locale: 'fr_FR', namespace: 'common', key: 'onboarding.desktopSetup.title', value: 'Bienvenue' },
        { locale: 'de_DE', namespace: 'studio', key: 'desktop.setup.title', value: 'Studio-Einrichtung' },
      ]);
    });

    it('is a no-op on an instance that never overrode anything', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      expect(await overrides()).toEqual([]);
    });
  });
}
