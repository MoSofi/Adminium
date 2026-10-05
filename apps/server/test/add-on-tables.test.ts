// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Where a link into an add-on's table points, and when it points nowhere: the
 * add-on not installed here, half installed, in another database, the table
 * not its own — or the link an app's and the add-on not attached to that app,
 * or switched off there. Inert is an answer, never an error.
 */
import { appTablesRepo, connectionsRepo, createSqliteMetaDb, firstRun, manifestsRepo, snapshotsRepo, type MetaDb, type SchemaOverride } from '@adminium/meta';
import { applyClassification, parseDatabaseModel, type DatabaseModel } from '@adminium/engine';
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { addOnInstallsStamp, addOnTablesFor } from '../src/apps/add-on-tables.js';
import { applyOverrides } from '../src/connections/effective-schema.js';
import { codeLookupsOf } from '../src/crud/code-lookup.js';
import { SnapshotView } from '../src/crud/identifiers.js';

const CRYPTO = { encrypt: (v: string) => v, decrypt: (v: string) => v };
let CONN = '';
let OTHER = '';
const table = (name: string, columns: string[]) => ({
  schema: 'public',
  name,
  primaryKey: ['id'],
  columns: columns.map((column) => ({ name: column, logicalType: column === 'id' || column.endsWith('_id') ? 'integer' : 'text', nullable: column !== 'id', ...(column === 'id' ? { isPrimaryKey: true, default: { kind: 'autoincrement' } } : {}) })),
});
const MODEL = applyClassification(
  parseDatabaseModel({
    dialect: 'postgres',
    name: 'shop',
    defaultSchema: 'public',
    schemas: ['public'],
    tables: [table('shop_lines', ['id', 'item_id', 'item_name']), table('notes', ['id', 'item_id']), table('inventory_items', ['id', 'name']), table('inventory_moves', ['id', 'item_id'])],
    relations: [],
  }),
) as DatabaseModel;

let meta: MetaDb;
beforeEach(async () => {
  meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  const connections = connectionsRepo(meta, CRYPTO);
  CONN = (await connections.create({ name: 'Shop', engine: 'sqlite', introspectDsn: 'sqlite::memory:', dataDsn: 'sqlite::memory:' })).id;
  OTHER = (await connections.create({ name: 'Other', engine: 'sqlite', introspectDsn: 'sqlite::memory:', dataDsn: 'sqlite::memory:' })).id;
});
afterEach(async () => meta.db.destroy());

/** An app `shop` that made `shop_lines`, and the add-on `inventory` with its two tables, attached to the app. */
async function world(opts: { status?: 'installed' | 'installing' | 'updating' | 'disabled'; elsewhere?: boolean; attach?: boolean; state?: 'created' | 'pending' | 'released' } = {}) {
  const manifests = manifestsRepo(meta, CRYPTO);
  const records = appTablesRepo(meta);
  const app = await manifests.install({ manifestKey: 'shop', version: '0.3.0', kind: 'app', source: 'file', document: { kind: 'app', key: 'shop' }, connectionId: CONN });
  await records.record({ appKey: 'shop', manifestId: app.row.id, connectionId: CONN, ref: 'lines', tableName: 'shop_lines', owned: true, state: 'created', prefix: 'shop_' });
  const addOn = await manifests.install({
    manifestKey: 'inventory',
    version: '1.0.8',
    kind: 'add-on',
    source: 'marketplace',
    document: { kind: 'add-on', key: 'inventory' },
    connectionId: opts.elsewhere === true ? OTHER : CONN,
    status: opts.status ?? 'installed',
    attachTo: opts.attach === false ? [] : ['shop'],
  });
  for (const ref of ['items', 'moves']) {
    await records.record({ appKey: 'inventory', manifestId: addOn.row.id, connectionId: CONN, ref, tableName: `inventory_${ref}`, owned: true, state: opts.state ?? 'created', prefix: 'inventory_' });
  }
  return { addOn, resolve: await addOnTablesFor(meta, CONN, MODEL) };
}
const ITEMS = { tableId: 'public.inventory_items', key: 'id' };

describe('a link into an add-on\'s table', () => {
  it('points at the add-on\'s real table and its key while the add-on is installed here and attached to the app', async () => {
    const { resolve } = await world();
    expect(resolve('inventory', 'items', 'public.shop_lines')).toEqual(ITEMS);
    expect(resolve('inventory', 'moves', 'public.shop_lines')?.tableId).toBe('public.inventory_moves');
  });

  it.each([
    ['still being installed', { status: 'installing' as const }],
    ['being changed', { status: 'updating' as const }],
    ['switched off as a whole', { status: 'disabled' as const }],
    ['keeping its tables in another database', { elsewhere: true }],
    ['not attached to the app', { attach: false }],
    ['with tables not made yet', { state: 'pending' as const }],
    ['with tables it let go of', { state: 'released' as const }],
  ])('is inert while the add-on is %s', async (_name, opts) => {
    const { resolve } = await world(opts);
    expect(resolve('inventory', 'items', 'public.shop_lines')).toBeNull();
  });

  it('is inert for an add-on that is not there, a table that is not its own, and an app\'s link once it is switched off for that app', async () => {
    const { addOn, resolve } = await world();
    expect(resolve('offers', 'items', 'public.shop_lines')).toBeNull();
    expect(resolve('inventory', 'ghosts', 'public.shop_lines')).toBeNull();
    expect(resolve('inventory', 'lines', 'public.shop_lines')).toBeNull();
    await meta.db.updateTable('adminium_manifest_attachments').set({ disabledAt: 5 }).where('manifestId', '=', addOn.row.id).execute();
    expect((await addOnTablesFor(meta, CONN, MODEL))('inventory', 'items', 'public.shop_lines')).toBeNull();
  });

  it('asks no app\'s leave when the link is the owner\'s own, or the add-on\'s', async () => {
    const { resolve } = await world({ attach: false });
    // `notes` was made by nobody; `inventory_moves` by the add-on itself; and a caller that names no table.
    expect(resolve('inventory', 'items', 'public.notes')).toEqual(ITEMS);
    expect(resolve('inventory', 'items', 'public.inventory_moves')).toEqual(ITEMS);
    expect(resolve('inventory', 'items', null)).toEqual(ITEMS);
  });

  it('a kept view is told when what is installed may have changed, from the store itself', async () => {
    const manifests = manifestsRepo(meta, CRYPTO);
    const seen = new Set<string>();
    /** The stamp after a change; a change that leaves it as it was is the failure. */
    const moved = async (what: string) => {
      const stamp = await addOnInstallsStamp(meta);
      expect(seen.has(stamp), what).toBe(false);
      seen.add(stamp);
    };
    await moved('nothing installed');
    const { addOn } = await world({ status: 'installing' });
    await moved('an app and an add-on arrived');
    expect(await addOnInstallsStamp(meta)).toBe([...seen].at(-1));
    await manifests.setStatus(addOn.row.id, 'installed', addOn.row.updatedAt + 5);
    await moved('the install finished');
    await manifests.setAttachmentEnabled(addOn.row.id, 'shop', false);
    await moved('switched off for the app');
    const record = (await appTablesRepo(meta).forInstall(CONN, 'inventory'))[0]!;
    await appTablesRepo(meta).setState(record.id, 'released', record.updatedAt + 5);
    await moved('a table record changed');
    await snapshotsRepo(meta).create({ connectionId: CONN, source: 'introspection', schema: MODEL, checksum: 'c1' } as never);
    await moved('the database was read again');
    await manifests.uninstall(addOn.row.id);
    await moved('the add-on left');
  });
});

describe('the effective schema of a table that links into an add-on', () => {
  const rule = (op: SchemaOverride['op'], columnName: string, value: Record<string, unknown>, tableName = 'public.shop_lines'): SchemaOverride => ({ id: `ovr_${op}_${columnName}`, connectionId: CONN, op, tableName, columnName, value, origin: 'app', llmRunId: null, status: 'active', createdBy: null, createdAt: 0, updatedAt: 0 });
  const RULES = [rule('column.addOnLink', 'item_id', { addOn: 'inventory', table: 'items' }), rule('column.lookup', 'item_name', { via: 'item_id', table: { addOn: 'inventory', table: 'items' }, column: 'name' })];
  const column = (model: ReturnType<typeof applyOverrides>, name: string) => model.tables.find((candidate) => candidate.name === 'shop_lines')!.columns.find((candidate) => candidate.name === name)!;

  it('carries the real table and key, and makes the lookup, where the add-on is found', async () => {
    const { resolve } = await world();
    const model = applyOverrides(MODEL, RULES, { addOnTables: resolve });
    expect(column(model, 'item_id').addOnLink).toEqual({ addOn: 'inventory', table: 'items', tableId: 'public.inventory_items', key: 'id' });
    expect(column(model, 'item_name').lookup).toMatchObject({ table: 'public.inventory_items', column: 'name', via: 'item_id' });
  });

  it('is inert where it is not: the link names no table and no lookup is made', async () => {
    const { resolve } = await world({ attach: false });
    for (const model of [applyOverrides(MODEL, RULES, { addOnTables: resolve }), applyOverrides(MODEL, RULES)]) {
      expect(column(model, 'item_id').addOnLink).toEqual({ addOn: 'inventory', table: 'items', tableId: null, key: null });
      expect(column(model, 'item_name').lookup).toBeUndefined();
      expect(column(model, 'item_name').addOnLookup).toBeDefined();
    }
  });

  /** A typed code that fills the link itself: both rules sit on the linking column. */
  const TYPED = [rule('column.addOnLink', 'item_id', { addOn: 'inventory', table: 'items' }), rule('column.lookup', 'item_id', { from: 'item_name', table: { addOn: 'inventory', table: 'items' }, column: 'name' })];
  const lookups = (model: ReturnType<typeof applyOverrides>) => {
    const view = new SnapshotView(CONN, model);
    return codeLookupsOf(view, view.model.tables.find((candidate) => candidate.name === 'shop_lines'));
  };

  it('a typed code finds a row of the add-on by the key the link resolved to, with no foreign key between them', async () => {
    const { resolve } = await world();
    expect(lookups(applyOverrides(MODEL, TYPED, { addOnTables: resolve }))).toEqual([
      { column: 'item_id', from: 'item_name', table: 'public.inventory_items', key: 'id', code: 'name', spelling: { kept: true }, where: [], scope: [] },
    ]);
    // The link resolves to the add-on's moves; the lookup is into its items: no key says how the two meet.
    const crossed = [rule('column.addOnLink', 'item_id', { addOn: 'inventory', table: 'moves' }), TYPED[1]!];
    const model = applyOverrides(MODEL, crossed, { addOnTables: resolve });
    expect(column(model, 'item_id').addOnLink?.tableId).toBe('public.inventory_moves');
    expect(column(model, 'item_id').lookup?.table).toBe('public.inventory_items');
    expect(lookups(model)).toEqual([]);
  });

  it('a typed code looks nothing up while the link is inert', async () => {
    const { resolve } = await world({ attach: false });
    expect(lookups(applyOverrides(MODEL, TYPED, { addOnTables: resolve }))).toEqual([]);
    expect(lookups(applyOverrides(MODEL, TYPED))).toEqual([]);
  });
});
