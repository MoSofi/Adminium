// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0039: the per-install table record, app roles and `managed_by`, on
 * every available dialect.
 *
 * - A released install upgrades, and the roles, keys and endpoints 0038 wrote
 *   still read, as operator-made rows (no app, not screens-only, not managed).
 * - Every bounded column takes its FULL width on Postgres and MySQL, where
 *   `varchar(n)` is enforced — SQLite is `text` and would pass anything.
 * - `installing`, the longest manifest status an install writes, fits `str(10)`.
 * - Uninstalling the manifest keeps its table records (SET NULL), and deleting
 *   the connection removes them (CASCADE).
 * - One real table per short name per install (the unique index).
 * - `rules` reads back as the array written, whichever way the driver hands it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ALL_MIGRATIONS,
  applyMigrations,
  connectionsRepo,
  manifestsRepo,
  newId,
  publicEndpointsRepo,
  publicKeysRepo,
  publicScopesRepo,
  rolesRepo,
  type MetaDb,
} from '../src/index.js';
import { readJson, writeBool } from '../src/repos/util.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const T0 = 1_750_000_000_000;
const PRE_0039 = ALL_MIGRATIONS.filter((m) => m.name < '0039_app_install_records');
const crypto = { encrypt: (v: string) => v, decrypt: (v: string) => v };

async function connection(meta: MetaDb): Promise<string> {
  const row = await connectionsRepo(meta, crypto).create({
    name: 'Cafe',
    engine: 'postgres',
    introspectDsn: 'postgres://ro@db.internal:5432/cafe',
  });
  return row.id;
}

/** A record row at the widest value every bounded column admits. */
function widest(meta: MetaDb, connectionId: string, manifestId: string | null, ref = 'r'.repeat(64)) {
  return {
    id: newId('atb'),
    appKey: 'a'.repeat(80),
    manifestId,
    connectionId,
    ref,
    tableName: 't'.repeat(64),
    schemaName: 's'.repeat(64),
    owned: writeBool(meta, true),
    state: 'released',
    role: 'sample-ledger',
    prefix: 'p'.repeat(96),
    shape: 'm'.repeat(46) + '@1',
    rules: JSON.stringify([{ op: 'column.copy', table: 'pos_ticket_items', column: 'unit_price', valueHash: 'h', overrideId: 'ovr_1' }]),
    createdAt: T0,
    updatedAt: T0,
    releasedAt: null,
  };
}

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`0039_app_install_records [${dialect.name}]`, () => {
    let t: TestDb;

    beforeEach(async () => {
      t = await dialect.make();
    });
    afterEach(async () => {
      await t.destroy();
    });

    const migrateAll = () => applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });

    it('upgrades a released install, and existing roles, keys and endpoints read as operator-made', async () => {
      expect(PRE_0039.at(-1)?.name).toBe('0038_public_endpoints');
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: PRE_0039 });
      const connectionId = await connection(t.meta);

      const roleId = newId('role');
      await t.meta.db
        .insertInto('adminium_roles')
        .values({ id: roleId, slug: 'barista', name: 'Barista', description: null, isBuiltin: 0, createdAt: T0, updatedAt: T0 } as never)
        .execute();
      const scope = await publicScopesRepo(t.meta).create({
        connectionId,
        side: 'customer',
        name: 'web',
        timezone: 'UTC',
        document: '{}',
      });
      const keyId = newId('pbk');
      await t.meta.db
        .insertInto('adminium_public_keys')
        .values({
          id: keyId,
          name: 'web',
          prefix: 'adm_pub_cccccccc',
          tokenHash: 'h'.repeat(64),
          tokenEncrypted: 'sealed',
          scopeId: scope.id,
          side: 'customer',
          appKey: null,
          origins: '[]',
          access: null,
          kind: 'browser',
          expiresAt: null,
          revokedAt: null,
          lastUsedAt: null,
          createdBy: null,
          createdAt: T0,
          updatedAt: T0,
        } as never)
        .execute();
      const endpointId = newId('pep');
      await t.meta.db
        .insertInto('adminium_public_endpoints')
        .values({ id: endpointId, connectionId, ref: 'menu', origin: 'custom', definition: '{}', createdBy: null, createdAt: T0, updatedAt: T0 } as never)
        .execute();

      await migrateAll();

      const role = await rolesRepo(t.meta).findById(roleId);
      expect(role?.appKey).toBeNull();
      expect(role?.screensOnly).toBe(false);
      expect((await publicKeysRepo(t.meta).findById(keyId))?.managedBy).toBeNull();
      const endpoints = await publicEndpointsRepo(t.meta).listByConnection(connectionId);
      expect(endpoints.find((e) => e.id === endpointId)?.managedBy).toBeNull();
    });

    it('writes an app role and managed rows at full width', async () => {
      await migrateAll();
      const connectionId = await connection(t.meta);
      const role = await rolesRepo(t.meta).create({
        slug: 'x'.repeat(40),
        name: 'POS cashier',
        appKey: 'a'.repeat(80),
        screensOnly: true,
      });
      expect(role.appKey).toBe('a'.repeat(80));
      expect(role.screensOnly).toBe(true);
      const reread = await rolesRepo(t.meta).findById(role.id);
      expect(reread?.screensOnly).toBe(true);

      const endpoint = await publicEndpointsRepo(t.meta).create({
        connectionId,
        ref: 'pos_reservations',
        origin: 'custom',
        definition: '{}',
        managedBy: 'a'.repeat(80),
      });
      expect(endpoint.managedBy).toBe('a'.repeat(80));
    });

    it('fits "installing" in the manifest status column', async () => {
      await migrateAll();
      const installed = await manifestsRepo(t.meta, crypto).install({
        manifestKey: 'pos',
        version: '0.2.0',
        kind: 'app',
        source: 'file',
        document: { key: 'pos' },
      });
      await t.meta.db
        .updateTable('adminium_manifests')
        .set({ status: 'installing' })
        .where('id', '=', installed.row.id)
        .execute();
      const row = await t.meta.db
        .selectFrom('adminium_manifests')
        .select('status')
        .where('id', '=', installed.row.id)
        .executeTakeFirstOrThrow();
      expect(row.status).toBe('installing');
    });

    it('keeps table records through an uninstall and drops them with the connection', async () => {
      await migrateAll();
      const connectionId = await connection(t.meta);
      const installed = await manifestsRepo(t.meta, crypto).install({
        manifestKey: 'pos',
        version: '0.2.0',
        kind: 'app',
        source: 'file',
        document: { key: 'pos' },
        connectionId,
      });
      const record = widest(t.meta, connectionId, installed.row.id);
      await t.meta.db.insertInto('adminium_app_tables').values(record).execute();

      const read = await t.meta.db
        .selectFrom('adminium_app_tables')
        .selectAll()
        .where('id', '=', record.id)
        .executeTakeFirstOrThrow();
      expect(read.tableName).toBe('t'.repeat(64));
      expect(read.prefix).toBe('p'.repeat(96));
      expect(readJson(read.rules)).toEqual(JSON.parse(record.rules));

      await manifestsRepo(t.meta, crypto).uninstall(installed.row.id);
      const kept = await t.meta.db
        .selectFrom('adminium_app_tables')
        .select(['manifestId', 'appKey'])
        .where('id', '=', record.id)
        .executeTakeFirstOrThrow();
      expect(kept.manifestId).toBeNull();
      expect(kept.appKey).toBe('a'.repeat(80));

      await connectionsRepo(t.meta, crypto).delete(connectionId);
      const gone = await t.meta.db
        .selectFrom('adminium_app_tables')
        .select('id')
        .where('id', '=', record.id)
        .executeTakeFirst();
      expect(gone).toBeUndefined();
    });

    it('refuses a second real table for the same short name in one install', async () => {
      await migrateAll();
      const connectionId = await connection(t.meta);
      await t.meta.db.insertInto('adminium_app_tables').values(widest(t.meta, connectionId, null, 'tickets')).execute();
      await expect(
        t.meta.db.insertInto('adminium_app_tables').values(widest(t.meta, connectionId, null, 'tickets')).execute(),
      ).rejects.toThrow();
    });
  });
}
