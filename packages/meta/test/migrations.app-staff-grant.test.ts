// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0040: every role that exists when it runs — but an app's own roles and
 * Super Admin — keeps opening the apps' staff screens, now that doing so is a
 * grant; a role made afterwards starts without it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ALL_MIGRATIONS, applyMigrations, permissionsRepo, rolesRepo } from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const PRE_0040 = ALL_MIGRATIONS.filter((m) => m.name < '0040_app_staff_grant');

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`0040_app_staff_grant [${dialect.name}]`, () => {
    let t: TestDb;
    beforeEach(async () => {
      t = await dialect.make();
    });
    afterEach(async () => {
      await t.destroy();
    });

    it('gives every existing role but an app’s and Super Admin the every-app row, once', async () => {
      expect(PRE_0040.at(-1)?.name).toBe('0039_app_install_records');
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: PRE_0040 });
      const roles = rolesRepo(t.meta);
      const clerk = await roles.create({ slug: 'clerk', name: 'Clerk' });
      const cashier = await roles.create({ slug: 'pos-cashier', name: 'POS cashier', appKey: 'pos' });
      const superAdmin = await roles.create({ slug: 'super-admin', name: 'Super Admin', isBuiltin: true });

      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      const permissions = permissionsRepo(t.meta);
      expect(await permissions.find(clerk.id, 'app', '*')).toMatchObject({ actions: { staff: true } });
      expect(await permissions.find(cashier.id, 'app', '*')).toBeNull();
      expect(await permissions.find(superAdmin.id, 'app', '*')).toBeNull();

      // Once: a role made afterwards starts without it.
      const later = await roles.create({ slug: 'auditor', name: 'Auditor' });
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      expect(await permissions.find(later.id, 'app', '*')).toBeNull();
    });
  });
}
