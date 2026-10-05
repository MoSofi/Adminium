// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What is installed where, as a save asks it: answers held in memory, loaded
 * again only when the store says something moved — in this process or another.
 */
import { appTablesRepo, connectionsRepo, createSqliteMetaDb, firstRun, manifestsRepo, type MetaDb } from '@adminium/meta';
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { keepAddOnInstalls, loadAddOnInstalls } from '../src/apps/table-ref.js';
import { stockKitManifest } from './fixtures/stock-kit/index.js';

const CRYPTO = { encrypt: (v: string) => v, decrypt: (v: string) => v };
const TABLES = ['shop_orders', 'menu_items', 'notes', 'kit_items', 'kit_moves', 'kit_old'].map((name) => ({ id: `public.${name}`, name }));
const models = async () => ({ tables: TABLES });
/** A manifest the validator reads whole: the stock kit, as it ships. */
const KIT = stockKitManifest();

let meta: MetaDb;
let CONN = '';
let OTHER = '';
beforeEach(async () => {
  meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  const connections = connectionsRepo(meta, CRYPTO);
  CONN = (await connections.create({ name: 'Shop', engine: 'sqlite', introspectDsn: 'sqlite::memory:', dataDsn: 'sqlite::memory:' })).id;
  OTHER = (await connections.create({ name: 'Other', engine: 'sqlite', introspectDsn: 'sqlite::memory:', dataDsn: 'sqlite::memory:' })).id;
});
afterEach(async () => meta.db.destroy());

/** Two apps that share a menu, an owner's table, and the stock kit attached to the shop. */
async function world(document: unknown = KIT) {
  const manifests = manifestsRepo(meta, CRYPTO);
  const records = appTablesRepo(meta);
  const features = [
    { id: 'stock', label: 'Stock', requires: ['stock-kit'] },
    { id: 'both', label: 'Both', requires: ['stock-kit', 'absent'] },
  ];
  const shop = await manifests.install({ manifestKey: 'shop', version: '0.3.0', kind: 'app', source: 'file', document: { kind: 'app', key: 'shop', addOns: { features } }, connectionId: CONN });
  const till = await manifests.install({ manifestKey: 'till', version: '0.3.0', kind: 'app', source: 'file', document: { kind: 'app', key: 'till', addOns: { features } }, connectionId: CONN });
  await records.record({ appKey: 'shop', manifestId: shop.row.id, connectionId: CONN, ref: 'orders', tableName: 'shop_orders', owned: true, state: 'created', prefix: 'shop_' });
  await records.record({ appKey: 'till', manifestId: till.row.id, connectionId: CONN, ref: 'menu_items', tableName: 'menu_items', owned: true, state: 'created', prefix: null });
  await records.record({ appKey: 'shop', manifestId: shop.row.id, connectionId: CONN, ref: 'menu_items', tableName: 'menu_items', owned: false, state: 'shared', prefix: null });
  const kit = await manifests.install({ manifestKey: 'stock-kit', version: '1.0.0', kind: 'add-on', source: 'file', document, connectionId: CONN, status: 'installed', attachTo: ['shop'] });
  await records.record({ appKey: 'stock-kit', manifestId: kit.row.id, connectionId: CONN, ref: 'items', tableName: 'kit_items', owned: true, state: 'created', prefix: 'kit_' });
  await records.record({ appKey: 'stock-kit', manifestId: kit.row.id, connectionId: CONN, ref: 'moves', tableName: 'kit_moves', owned: false, state: 'adopted', prefix: 'kit_' });
  await records.record({ appKey: 'stock-kit', manifestId: kit.row.id, connectionId: CONN, ref: 'old', tableName: 'kit_old', owned: true, state: 'released', prefix: 'kit_' });
  await records.record({ appKey: 'stock-kit', manifestId: kit.row.id, connectionId: CONN, ref: 'later', tableName: 'kit_later', owned: true, state: 'pending', prefix: 'kit_' });
  return { manifests, records, kit };
}

describe('what is installed, asked from inside a save', () => {
  it('refOf and tableOfRef are each other\'s inverse for an app\'s, a shared and an owner\'s table', async () => {
    await world();
    const installs = await loadAddOnInstalls(meta, models);
    expect(installs.refOf(CONN, 'public.shop_orders')).toBe('shop:orders');
    expect(installs.refOf(CONN, 'public.menu_items')).toBe('till:menu_items');
    expect(installs.refOf(CONN, 'public.notes')).toBe('public.notes');
    for (const table of ['public.shop_orders', 'public.menu_items', 'public.notes', 'public.kit_items']) expect(installs.tableOfRef(CONN, installs.refOf(CONN, table))).toBe(table);
    expect(installs.tableOfRef(CONN, 'shop:menu_items')).toBeNull();
    expect(installs.tableOfRef(CONN, 'gone:orders')).toBeNull();
    // A database nothing is installed on names a table by its id and resolves nothing.
    expect(installs.refOf(OTHER, 'public.shop_orders')).toBe('public.shop_orders');
    expect(installs.tableOfRef(OTHER, 'shop:orders')).toBeNull();
  });

  it('tableOf answers a table the add-on made or took, and nothing for a released or a pending record', async () => {
    await world();
    const installs = await loadAddOnInstalls(meta, models);
    expect(installs.tableOf(CONN, 'stock-kit', 'items')).toBe('public.kit_items');
    expect(installs.tableOf(CONN, 'stock-kit', 'moves')).toBe('public.kit_moves');
    expect(installs.tableOf(CONN, 'stock-kit', 'old')).toBeNull();
    expect(installs.tableOf(CONN, 'stock-kit', 'later')).toBeNull();
    expect(installs.tableOf(CONN, 'stock-kit', 'nothing')).toBeNull();
    expect(installs.tableOf(OTHER, 'stock-kit', 'items')).toBeNull();
    // An app's table is not an add-on's.
    expect(installs.tableOf(CONN, 'shop', 'orders')).toBeNull();
  });

  it('tells not attached from switched off, and answers a row in any status', async () => {
    const { manifests, kit } = await world();
    await manifests.attach(kit.row.id, 'till');
    await manifests.setAttachmentEnabled(kit.row.id, 'till', false);
    await manifests.setStatus(kit.row.id, 'updating');
    const installs = await loadAddOnInstalls(meta, models);
    const found = installs.installed(CONN, 'stock-kit');
    expect(found?.status).toBe('updating');
    expect(found?.version).toBe('1.0.0');
    expect(found?.manifest.key).toBe('stock-kit');
    expect([found?.hosts.get('shop'), found?.hosts.get('till'), found?.hosts.has('desk')]).toEqual([true, false, false]);
    expect(installs.installed(OTHER, 'stock-kit')).toBeNull();
    expect(installs.installed(CONN, 'shop')).toBeNull();
  });

  it('a stored manifest that no longer reads is an add-on that cannot answer, never one that is not there', async () => {
    await world({ kind: 'add-on', key: 'stock-kit', nonsense: true });
    const found = (await loadAddOnInstalls(meta, models)).installed(CONN, 'stock-kit');
    expect(found?.status).toBe('error');
    expect(found?.hosts.get('shop')).toBe(true);
  });

  it('featureOn turns off with the per-app switch, and is off for an app the add-on is not attached to', async () => {
    const { manifests, kit } = await world();
    let installs = await loadAddOnInstalls(meta, models);
    expect(installs.featureOn(CONN, 'shop', 'stock')).toBe(true);
    // One of its two add-ons is not installed.
    expect(installs.featureOn(CONN, 'shop', 'both')).toBe(false);
    expect(installs.featureOn(CONN, 'shop', 'unknown')).toBe(false);
    expect(installs.featureOn(CONN, 'till', 'stock')).toBe(false);
    expect(installs.featureOn(OTHER, 'shop', 'stock')).toBe(false);
    await manifests.setAttachmentEnabled(kit.row.id, 'shop', false);
    installs = await loadAddOnInstalls(meta, models);
    expect(installs.featureOn(CONN, 'shop', 'stock')).toBe(false);
    await manifests.setAttachmentEnabled(kit.row.id, 'shop', true);
    await manifests.setStatus(kit.row.id, 'disabled');
    installs = await loadAddOnInstalls(meta, models);
    expect(installs.featureOn(CONN, 'shop', 'stock')).toBe(false);
  });

  it('a second process sees an install once it asks again, and loads nothing while nothing moved', async () => {
    let loads = 0;
    const counted = async () => {
      loads += 1;
      return { tables: TABLES };
    };
    const here = keepAddOnInstalls(meta, models);
    const there = keepAddOnInstalls(meta, counted);
    // Before anything is asked there is an answer, and it is "nothing".
    expect(there.current().installed(CONN, 'stock-kit')).toBeNull();
    expect(there.current().refOf(CONN, 'public.notes')).toBe('public.notes');
    expect((await there.fresh()).installed(CONN, 'stock-kit')).toBeNull();
    const { manifests, kit } = await world();
    await here.fresh();
    // The other process still holds what it loaded, until it asks.
    expect(there.current().installed(CONN, 'stock-kit')).toBeNull();
    expect((await there.fresh()).installed(CONN, 'stock-kit')?.status).toBe('installed');
    expect(there.current().tableOf(CONN, 'stock-kit', 'items')).toBe('public.kit_items');
    const before = loads;
    const same = await there.fresh();
    expect(await there.fresh()).toBe(same);
    expect(loads).toBe(before);
    await manifests.setAttachmentEnabled(kit.row.id, 'shop', false);
    expect((await there.fresh()).installed(CONN, 'stock-kit')?.hosts.get('shop')).toBe(false);
    expect(loads).toBeGreaterThan(before);
  });
});
