// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0045: an installed app's table records gain the shape their table is
 * declared with, read from the app's stored manifest — on every available
 * dialect (Postgres hands the stored manifest back as an object, SQLite and
 * MySQL may hand it back as text).
 *
 * - Exactly the tables the manifest declares with a shape gain it.
 * - A record already carrying a shape keeps it; a sample ledger, a released
 *   record (no manifest) and a dropped one are left alone.
 * - A stored manifest that does not parse is skipped, not fatal.
 * - Running the wave again changes nothing.
 */
import { sql } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ALL_MIGRATIONS, appTablesRepo, applyMigrations, connectionsRepo, manifestsRepo, type MetaDb } from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const PRE_0045 = ALL_MIGRATIONS.filter((m) => m.name < '0045_app_table_shapes');
const crypto = { encrypt: (v: string) => v, decrypt: (v: string) => v };

/** A till's manifest as a released one declares it: four menu tables with the shape, the rest without. */
const MENU = ['menu_categories', 'menu_items', 'modifier_groups', 'modifiers'];
const PLAIN = ['restaurant_tables', 'staff', 'tickets', 'ticket_items', 'payments'];
function till(key = 'pos') {
  return {
    kind: 'app',
    key,
    version: '0.2.2',
    requiredSchema: {
      prefixed: true,
      tables: [
        ...MENU.map((ref) => ({ ref, shape: 'menu@1', columns: [{ ref: 'id', type: 'int', role: 'pk' }] })),
        ...PLAIN.map((ref) => ({ ref, columns: [{ ref: 'id', type: 'int', role: 'pk' }] })),
        // A shape no manifest may declare (too long for the record): never copied.
        { ref: 'odd', shape: `${'x'.repeat(47)}@1`, columns: [{ ref: 'id', type: 'int', role: 'pk' }] },
      ],
    },
  };
}

async function connection(meta: MetaDb): Promise<string> {
  return (await connectionsRepo(meta, crypto).create({ name: 'Cafe', engine: 'postgres', introspectDsn: 'postgres://ro@db.internal:5432/cafe' })).id;
}

async function installed(meta: MetaDb, connectionId: string, doc: ReturnType<typeof till>): Promise<string> {
  const row = await manifestsRepo(meta, crypto).install({ manifestKey: doc.key, version: doc.version, kind: 'app', source: 'file', document: doc, connectionId });
  const records = appTablesRepo(meta);
  for (const table of doc.requiredSchema.tables) {
    await records.record({ appKey: doc.key, manifestId: row.row.id, connectionId, ref: table.ref, tableName: `${doc.key}_${table.ref}`, owned: true, state: 'created' });
  }
  return row.row.id;
}

const shapesOf = async (meta: MetaDb, connectionId: string, appKey: string) =>
  Object.fromEntries((await appTablesRepo(meta).forInstall(connectionId, appKey)).map((r) => [r.ref, r.shape]));

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`0045_app_table_shapes [${dialect.name}]`, () => {
    let t: TestDb;
    beforeEach(async () => {
      t = await dialect.make();
    });
    afterEach(async () => {
      await t.destroy();
    });

    it('gives exactly the tables the stored manifest declares with a shape their shape, once', async () => {
      expect(PRE_0045.at(-1)?.name).toBe('0044_invoicing_platform');
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: PRE_0045 });
      const connectionId = await connection(t.meta);
      await installed(t.meta, connectionId, till());
      const records = appTablesRepo(t.meta);
      // Already carrying a shape: kept as it is.
      await records.record({ appKey: 'pos', manifestId: null, connectionId, ref: 'modifiers', tableName: 'pos_modifiers', owned: true, state: 'created', shape: 'menu@7' });
      const manifestId = (await records.find(connectionId, 'pos', 'menu_items'))!.manifestId;
      await records.record({ appKey: 'pos', manifestId, connectionId, ref: 'modifiers', tableName: 'pos_modifiers', owned: true, state: 'created' });
      // A sample ledger, and a dropped record, of a shaped short name: left alone.
      await records.record({ appKey: 'pos', manifestId, connectionId, ref: 'menu_categories_ledger', tableName: 'pos__sample', owned: true, state: 'created', role: 'sample-ledger' });
      const dropped = await records.record({ appKey: 'pos', manifestId, connectionId, ref: 'menu_categories', tableName: 'pos_menu_categories', owned: true, state: 'created' });
      await records.setState(dropped.id, 'dropped');

      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      const after = await shapesOf(t.meta, connectionId, 'pos');
      expect(after).toEqual({
        menu_categories: null,
        menu_items: 'menu@1',
        modifier_groups: 'menu@1',
        modifiers: 'menu@7',
        restaurant_tables: null,
        staff: null,
        tickets: null,
        ticket_items: null,
        payments: null,
        odd: null,
        menu_categories_ledger: null,
      });

      // Again: nothing changes.
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      await sql`delete from adminium_migrations where name = ${'0045_app_table_shapes'}`.execute(t.meta.db);
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      expect(await shapesOf(t.meta, connectionId, 'pos')).toEqual(after);
    });

    it('leaves a released record (its app uninstalled) and skips a stored manifest that does not parse', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: PRE_0045 });
      const connectionId = await connection(t.meta);
      const posId = await installed(t.meta, connectionId, till('pos'));
      const kioskId = await installed(t.meta, connectionId, till('kiosk'));
      // The till uninstalled, its tables kept: the record loses its manifest.
      const records = appTablesRepo(t.meta);
      for (const record of await records.forInstall(connectionId, 'pos')) await records.setState(record.id, 'released');
      await manifestsRepo(t.meta, crypto).uninstall(posId);
      // The kiosk's stored manifest is not a manifest any more.
      const broken = t.meta.dialect === 'sqlite' ? sql`'{"requiredSchema": [not json'` : sql`${JSON.stringify(['not', 'a', 'manifest'])}`;
      await sql`update adminium_manifests set manifest = ${broken} where id = ${kioskId}`.execute(t.meta.db);

      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      expect(Object.values(await shapesOf(t.meta, connectionId, 'pos')).every((shape) => shape === null)).toBe(true);
      expect(Object.values(await shapesOf(t.meta, connectionId, 'kiosk')).every((shape) => shape === null)).toBe(true);
    });
  });
}

describe('the wave’s checksum', () => {
  it('covers everything the wave decides: what a shape looks like and how a manifest is read are inside `up`', () => {
    const wave = ALL_MIGRATIONS.find((m) => m.name === '0045_app_table_shapes')!;
    const text = wave.up.toString();
    expect(text).toContain('[a-z][a-z0-9-]*@');
    expect(text).toContain('requiredSchema');
    expect(text).toContain('JSON.parse');
    expect(text).toContain('shape.length > 48');
  });
});
