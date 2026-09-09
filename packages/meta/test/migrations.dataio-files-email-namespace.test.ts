// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0029: `common.dataio.*`, `common.files.*` and `common.email.*` became
 * their own namespaces, so every override an admin wrote against the old
 * address has to be re-filed or it silently stops resolving — the string
 * reverts to compiled English for exactly the people who reworded it.
 *
 * The twin of `migrations.studio-namespace.test.ts` (0022), and for the same
 * reason: the move is a JS loop over rows precisely so it does not depend on
 * three spellings of `substr`, so it runs on every available dialect.
 *
 * The interesting case here that 0022 did not have: one of the three carried
 * keys lands in a DIFFERENT namespace (`ui`), not merely a different key in
 * `common`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ALL_MIGRATIONS, applyMigrations } from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const T0 = 1_750_000_000_000;

const PRE_0029 = ALL_MIGRATIONS.filter((m) => m.name < '0029_dataio_files_email_namespace');

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
  describe.skipIf(!dialect.available)(`0029_dataio_files_email_namespace [${dialect.name}]`, () => {
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

    it('re-files all three groups and carries the three keys that did not move', async () => {
      // The filter must end exactly where 0029 begins — asserted, because the
      // 0016 test learned the hard way that "the last migration" stops being
      // true the moment the next one lands.
      expect(PRE_0029.at(-1)?.name).toBe('0028_automations_runtime');
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: PRE_0029 });

      await t.meta.db
        .insertInto('adminium_translations')
        .values([
          row('trn_dio', 'common', 'dataio.builder.columns.title', 'Spalten'),
          row('trn_imp', 'common', 'dataio.import.title', 'Daten einlesen'),
          row('trn_exp', 'common', 'dataio.exports.title', 'Datenexporte'),
          row('trn_fil', 'common', 'files.title', 'Dateien'),
          row('trn_una', 'common', 'files.uploadsUnavailable', 'Kein Upload hier'),
          row('trn_eml', 'common', 'email.passwordReset.subject', 'Passwort zurücksetzen'),
          // Untouched neighbours: a `common` key that merely starts with the
          // same letters, and one in another namespace entirely.
          row('trn_nav', 'common', 'nav.home', 'Start'),
          row('trn_ui', 'ui', 'action.save', 'Sichern'),
        ])
        .execute();

      // The full list — the ledger is validated against whatever is passed, so
      // handing it only 0029 would report every earlier entry as unknown.
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect });

      expect(await overrides()).toEqual([
        // Copied, not moved: the two page titles the entry-chunk-resident
        // route factory reads from `common:nav.*` now.
        { namespace: 'common', key: 'nav.exports', value: 'Datenexporte' },
        { namespace: 'common', key: 'nav.home', value: 'Start' },
        { namespace: 'common', key: 'nav.imports', value: 'Daten einlesen' },
        { namespace: 'dataio', key: 'builder.columns.title', value: 'Spalten' },
        // The originals still move with their group, where they are inert. An
        // override is text a human wrote; deleting it is the worse failure.
        { namespace: 'dataio', key: 'exports.title', value: 'Datenexporte' },
        { namespace: 'dataio', key: 'import.title', value: 'Daten einlesen' },
        { namespace: 'email', key: 'passwordReset.subject', value: 'Passwort zurücksetzen' },
        { namespace: 'files', key: 'title', value: 'Dateien' },
        { namespace: 'files', key: 'uploadsUnavailable', value: 'Kein Upload hier' },
        { namespace: 'ui', key: 'action.save', value: 'Sichern' },
        // The carried key that crosses INTO another namespace — the case 0022
        // never had, and the one a `common`-only copy would have silently lost.
        { namespace: 'ui', key: 'templates.files.uploadsUnavailable', value: 'Kein Upload hier' },
      ]);
    });

    it('does not overwrite a twin somebody already wrote by hand', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: PRE_0029 });
      await t.meta.db
        .insertInto('adminium_translations')
        .values([
          row('trn_imp', 'common', 'dataio.import.title', 'Daten einlesen'),
          row('trn_nav', 'common', 'nav.imports', 'Importieren'),
        ])
        .execute();

      await applyMigrations(t.meta.db, { dialect: t.meta.dialect });

      expect(await overrides()).toEqual([
        { namespace: 'common', key: 'nav.imports', value: 'Importieren' },
        { namespace: 'dataio', key: 'import.title', value: 'Daten einlesen' },
      ]);
    });

    it('is a no-op on an instance that never overrode anything', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      expect(await overrides()).toEqual([]);
    });
  });
}
