// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0086: a saved app's name, description and icon, on every available dialect.
 * A save from before the wave upgrades with neither; a new one keeps both, at
 * their full widths, and reads them back.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ALL_MIGRATIONS, appSavesRepo, applyMigrations, connectionsRepo, type MetaDb } from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const T0 = 1_762_000_000_000;
const PRE_0086 = ALL_MIGRATIONS.filter((m) => m.name < '0086_app_save_names');
const crypto = { encrypt: (v: string) => v, decrypt: (v: string) => v };
const FP = `sha512-${'A'.repeat(86)}==`;

async function connection(meta: MetaDb): Promise<string> {
  return (await connectionsRepo(meta, crypto).create({ name: 'fernhill', engine: 'postgres', introspectDsn: 'postgres://ro@db.internal:5432/fernhill' })).id;
}

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`0086_app_save_names [${dialect.name}]`, () => {
    let t: TestDb;
    beforeEach(async () => {
      t = await dialect.make();
    });
    afterEach(async () => {
      await t.destroy();
    });

    it('upgrades a save without a name, then keeps a new save’s name and description', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: PRE_0086 });
      const conn = await connection(t.meta);
      await t.meta.db
        .insertInto('adminium_app_saves')
        .values({ id: 'asv_old', appKey: 'fernhill-ops', version: '1.0.0', lineage: 'l', connectionId: conn, label: 'Fernhill main', savedBy: null, savedAt: T0, integrity: FP, bytes: 10, fileId: null } as never)
        .execute();
      expect((await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS })).applied).toContain('0086_app_save_names');

      const saves = appSavesRepo(t.meta);
      const old = await saves.findById('asv_old');
      expect([old?.name, old?.description, old?.icon]).toEqual([null, null, null]);

      const made = await saves.create({ appKey: 'fernhill-ops', version: '1.0.1', lineage: 'l', connectionId: conn, label: 'Fernhill main', savedBy: null, integrity: FP, bytes: 11, name: 'N'.repeat(80), description: 'D'.repeat(500), icon: 'i'.repeat(60) }, T0 + 1);
      const read = await saves.findById(made.id);
      expect(read?.name).toBe('N'.repeat(80));
      expect(read?.description).toBe('D'.repeat(500));
      expect(read?.icon).toBe('i'.repeat(60));
      expect((await saves.listForKey('fernhill-ops')).map((s) => [s.version, s.name === null])).toEqual([
        ['1.0.1', false],
        ['1.0.0', true],
      ]);
    });
  });
}
