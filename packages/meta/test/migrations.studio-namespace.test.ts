// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0022 (10-T06): the Studio's messages became their own namespace, so
 * every override an admin wrote against the old `common:studio.*` address has
 * to be re-filed or it silently stops resolving — the string reverts to
 * compiled English on the one surface whose users did the rewording.
 *
 * Runs the real migration list split at 0021/0022 on every available dialect,
 * because the move is a JS loop over rows precisely so it does not depend on
 * three spellings of `substr`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ALL_MIGRATIONS, applyMigrations } from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const T0 = 1_750_000_000_000;

const PRE_0022 = ALL_MIGRATIONS.filter((m) => m.name < '0022_studio_namespace');

function row(id: string, namespace: string, key: string, value: string) {
  return {
    id,
    scope: 'workspace',
    locale: 'de_DE',
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
  describe.skipIf(!dialect.available)(`0022_studio_namespace [${dialect.name}]`, () => {
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
        .select(['namespace', 'key', 'value'])
        .orderBy('namespace')
        .orderBy('key')
        .execute();
    }

    it('re-files studio overrides and carries the two the topbar lost', async () => {
      // The filter must end exactly where 0022 begins — asserted, because the
      // 0016 test learned the hard way that "the last migration" stops being
      // true the moment the next one lands.
      expect(PRE_0022.at(-1)?.name).toBe('0021_add_on_credentials');
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: PRE_0022 });

      await t.meta.db
        .insertInto('adminium_translations')
        .values([
          row('trn_hub', 'common', 'studio.hub.title', 'Datenbanken'),
          row('trn_settings', 'common', 'studio.settingsHub.title', 'Einstellungen'),
          row('trn_deep', 'common', 'studio.addOns.browse.download', 'Holen'),
          row('trn_pages', 'common', 'studioPages.title', 'Seiten'),
          // Untouched neighbours: a `common` key that merely starts with the
          // same letters, and one that does not.
          row('trn_other', 'common', 'nav.home', 'Start'),
          row('trn_ui', 'ui', 'action.save', 'Sichern'),
        ])
        .execute();

      // The full list — the ledger is validated against whatever is passed, so
      // handing it only 0022 would report every earlier entry as unknown.
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect });

      expect(await overrides()).toEqual([
        { namespace: 'common', key: 'nav.home', value: 'Start' },
        // Copied, not moved: the menu item and the page it opens keep saying
        // the same thing.
        { namespace: 'common', key: 'topbar.dataConnections', value: 'Datenbanken' },
        { namespace: 'common', key: 'topbar.workspaceSettings', value: 'Einstellungen' },
        { namespace: 'studio', key: 'addOns.browse.download', value: 'Holen' },
        { namespace: 'studio', key: 'hub.title', value: 'Datenbanken' },
        { namespace: 'studio', key: 'pages.title', value: 'Seiten' },
        { namespace: 'studio', key: 'settingsHub.title', value: 'Einstellungen' },
        { namespace: 'ui', key: 'action.save', value: 'Sichern' },
      ]);
    });

    it('does not overwrite a topbar override somebody already wrote', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: PRE_0022 });
      await t.meta.db
        .insertInto('adminium_translations')
        .values([
          row('trn_hub', 'common', 'studio.hub.title', 'Datenbanken'),
          row('trn_topbar', 'common', 'topbar.dataConnections', 'Quellen'),
        ])
        .execute();

      // The full list — the ledger is validated against whatever is passed, so
      // handing it only 0022 would report every earlier entry as unknown.
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect });

      expect(await overrides()).toEqual([
        { namespace: 'common', key: 'topbar.dataConnections', value: 'Quellen' },
        { namespace: 'studio', key: 'hub.title', value: 'Datenbanken' },
      ]);
    });

    it('is a no-op on an instance that never overrode anything', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      expect(await overrides()).toEqual([]);
    });
  });
}
