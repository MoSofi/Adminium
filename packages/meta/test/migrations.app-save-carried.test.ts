// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0087: what a saved app carried, on every available dialect. A save from
 * before the wave upgrades with none (only its saver downloads it again); a new
 * one keeps the record and reads it back as it was written.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ALL_MIGRATIONS, appSavesRepo, applyMigrations, connectionsRepo, type MetaDb } from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const T0 = 1_762_000_000_000;
const PRE_0087 = ALL_MIGRATIONS.filter((m) => m.name < '0087_app_save_carried');
const crypto = { encrypt: (v: string) => v, decrypt: (v: string) => v };
const FP = `sha512-${'A'.repeat(86)}==`;

async function connection(meta: MetaDb): Promise<string> {
  return (await connectionsRepo(meta, crypto).create({ name: 'fernhill', engine: 'postgres', introspectDsn: 'postgres://ro@db.internal:5432/fernhill' })).id;
}

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`0087_app_save_carried [${dialect.name}]`, () => {
    let t: TestDb;
    beforeEach(async () => {
      t = await dialect.make();
    });
    afterEach(async () => {
      await t.destroy();
    });

    it('upgrades a save with no record, then keeps a new save’s record', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: PRE_0087 });
      const conn = await connection(t.meta);
      await t.meta.db
        .insertInto('adminium_app_saves')
        .values({ id: 'asv_old', appKey: 'fernhill-ops', version: '1.0.0', lineage: 'l', connectionId: conn, label: 'Fernhill main', savedBy: null, savedAt: T0, integrity: FP, bytes: 10, fileId: null } as never)
        .execute();
      expect((await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS })).applied).toContain('0087_app_save_carried');

      const saves = appSavesRepo(t.meta);
      expect((await saves.findById('asv_old'))?.carried).toBeNull();

      const carried = { rows: { 'public.orders': ['total', 'customer_id'] }, personal: ['public.orders'], files: true, instance: false };
      const made = await saves.create({ appKey: 'fernhill-ops', version: '1.0.1', lineage: 'l', connectionId: conn, label: 'Fernhill main', savedBy: null, integrity: FP, bytes: 11, carried }, T0 + 1);
      expect((await saves.findById(made.id))?.carried).toEqual(carried);
      expect((await saves.listForKey('fernhill-ops')).map((s) => s.carried)).toEqual([carried, null]);
    });
  });
}
