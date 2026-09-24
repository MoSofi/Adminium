// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0043: `common.roles.*` became the `roles` namespace, so every override
 * an admin wrote against the old address has to be re-filed or it silently
 * stops resolving — the string reverts to compiled English for exactly the
 * people who reworded it.
 *
 * The twin of `migrations.dataio-files-email-namespace.test.ts` (0029), minus
 * the carried keys: every `roles.*` key moved, so nothing is copied and
 * nothing stays behind. It runs on every available dialect for the reason
 * that test gives — the move is a JS loop over rows precisely so it does not
 * depend on three spellings of `substr`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ALL_MIGRATIONS, applyMigrations } from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const T0 = 1_750_000_000_000;

const PRE_0043 = ALL_MIGRATIONS.filter((m) => m.name < '0043_roles_namespace');

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
  describe.skipIf(!dialect.available)(`0043_roles_namespace [${dialect.name}]`, () => {
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

    it('re-files every `common.roles.*` override under the `roles` namespace', async () => {
      // The filter must end exactly where 0043 begins — asserted, because "the
      // last migration" stops being true the moment the next one lands.
      expect(PRE_0043.at(-1)?.name).toBe('0042_clinic_platform');
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: PRE_0043 });

      await t.meta.db
        .insertInto('adminium_translations')
        .values([
          row('trn_ttl', 'common', 'roles.title', 'Rollen & Rechte'),
          row('trn_pii', 'common', 'roles.data.readPii', 'Personendaten sehen'),
          // The same key in a second locale moves too: the address is per
          // (scope, locale), and the move must not collapse them.
          row('trn_pfr', 'common', 'roles.data.readPii', 'Voir les données personnelles', 'fr_FR'),
          row('trn_prm', 'common', 'roles.permission.usersManage', 'Benutzer verwalten'),
          // Untouched neighbours: a `common` key that merely starts with the
          // same letters, a key that CONTAINS `roles.` without starting with
          // it, and the same prefix in another namespace entirely.
          row('trn_rol', 'common', 'rolesHint', 'Rollenhinweis'),
          row('trn_nav', 'common', 'nav.roles.title', 'Rollen'),
          row('trn_std', 'studio', 'roles.title', 'Studio-Rollen'),
        ])
        .execute();

      // The full list — the ledger is validated against whatever is passed, so
      // handing it only 0043 would report every earlier entry as unknown.
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect });

      expect(await overrides()).toEqual([
        { locale: 'de_DE', namespace: 'common', key: 'nav.roles.title', value: 'Rollen' },
        { locale: 'de_DE', namespace: 'common', key: 'rolesHint', value: 'Rollenhinweis' },
        { locale: 'de_DE', namespace: 'roles', key: 'data.readPii', value: 'Personendaten sehen' },
        { locale: 'fr_FR', namespace: 'roles', key: 'data.readPii', value: 'Voir les données personnelles' },
        { locale: 'de_DE', namespace: 'roles', key: 'permission.usersManage', value: 'Benutzer verwalten' },
        { locale: 'de_DE', namespace: 'roles', key: 'title', value: 'Rollen & Rechte' },
        { locale: 'de_DE', namespace: 'studio', key: 'roles.title', value: 'Studio-Rollen' },
      ]);
    });

    it('is a no-op on an instance that never overrode anything', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      expect(await overrides()).toEqual([]);
    });
  });
}
