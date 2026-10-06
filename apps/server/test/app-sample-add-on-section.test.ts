// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE ROWS AN APP SHIPS FOR AN ADD-ON IT NAMES. An app's sample may carry a
 * second file of rows for an add-on's tables. They are added with the app's
 * sample while that add-on is here for the app, entered in the APP's list of
 * sample rows, and taken out with it. A row that is also one of the add-on's
 * own sample rows is stored once and stays until the last of the two lists
 * lets it go. A file that points at a row of the add-on's own sample waits
 * for that sample. With the add-on absent — or removed, tables and all —
 * the app's sample still adds, counts and removes clean.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { createSampleDataService, findSampleApp, findSampleOwner, type SampleApp } from '../src/apps/sample-data.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { stockKitManifest } from './fixtures/stock-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';

let h: Harness | null = null;
afterEach(async () => {
  await h?.close();
  h = null;
});

const pk = { ref: 'id', type: 'int', role: 'pk' };
const KIT_SAMPLE = {
  format: 'adminium.sample/1',
  app: 'stock-kit',
  tables: [
    { ref: 'items', rows: [{ '@label': 'flour', name: 'Flour', opening: '10.00' }, { '@label': 'salt', name: 'Salt', opening: '4.00' }] },
    { ref: 'takes', rows: [{ item_id: { '@ref': 'flour' }, qty: '2.00' }] },
  ],
};
/** The stock kit, with sample rows of its own. */
const kit = () => ({ manifest: { ...stockKitManifest(), sampleData: { file: 'seeds/stock.sample.json' } }, files: { 'seeds/stock.sample.json': JSON.stringify(KIT_SAMPLE) } });

/** A shop that suggests the kit and ships rows for it. */
function shop(section: { tables: unknown[] }) {
  const manifest = {
    kind: 'app',
    manifestVersion: 1,
    key: 'shop',
    name: 'Shop',
    version: '0.3.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'd', fallback: 'd' },
    categories: ['commerce'],
    compatibility: { minAdminiumVersion: '0.3.18' },
    pages: [{ ref: 'orders', template: 'page-crud', title: { key: 't', fallback: 'Orders' }, nav: { group: 'manage', icon: 'list', order: 1 }, bindings: { main: 'orders' } }],
    frontends: [{ side: 'staff', kind: 'none' }],
    addOns: { suggests: [{ key: 'stock-kit', range: '>=1.0.0', reason: { 'en-US': 'Keeps the stock.' } }] },
    requiredSchema: { tables: [{ ref: 'orders', columns: [pk, { ref: 'note', type: 'text', maxLength: 80, nullable: true }] }] },
    sampleData: { file: 'seeds/shop.sample.json', addOns: { 'stock-kit': { file: 'seeds/shop.stock-kit.sample.json' } } },
  };
  const files = {
    'seeds/shop.sample.json': JSON.stringify({ format: 'adminium.sample/1', app: 'shop', tables: [{ ref: 'orders', rows: [{ '@label': 'first', note: 'First order' }, { note: 'Second order' }] }] }),
    'seeds/shop.stock-kit.sample.json': JSON.stringify({ format: 'adminium.sample/1', app: 'shop', addOn: 'stock-kit', ...section }),
  };
  return { manifest, files };
}
/** Rows of the shop's own for the kit: an item, and a take of it. */
const OWN_ROWS = { tables: [{ ref: 'items', rows: [{ '@label': 'shop-sugar', name: 'Sugar', opening: '6.00' }] }, { ref: 'takes', rows: [{ item_id: { '@ref': 'shop-sugar' }, qty: '1.50' }] }] };

const post = (harness: Harness, url: string, payload: Record<string, unknown> = {}) => harness.inject({ method: 'POST', url, payload });
const service = (harness: Harness) => createSampleDataService(harness.sampleData);
const OPTS = { locale: 'en-US', userId: null, userLabel: 'test' };
const names = async (harness: Harness, table: string) => (await harness.rows(`SELECT name FROM ${table} ORDER BY id`)).map((row) => row['name']);
const count = async (harness: Harness, table: string) => Number((await harness.rows(`SELECT COUNT(*) AS n FROM ${table}`))[0]!['n']);

describe.each(LEGS)('an app\'s sample rows for an add-on — %s', (dialect, available) => {
  /** The kit installed (or not), then the shop — with the kit attached to it when it is there. */
  async function world(section: { tables: unknown[] }, withKit = true): Promise<{ harness: Harness; app: SampleApp; addOn: SampleApp | null }> {
    const harness = await addOnHarness(dialect, { unbuiltWords: {} });
    const made = shop(section);
    const theKit = kit();
    await harness.stageAddOn(theKit.manifest, { files: theKit.files, bundled: true });
    await harness.stageApp(made.manifest, made.files);
    const installed = await harness.install('shop', '0.3.0', withKit ? { addOns: [{ key: 'stock-kit', version: '1.0.0' }] } : {});
    expect(installed.statusCode, installed.body).toBe(200);
    return { harness, app: (await findSampleApp(harness.meta, 'shop'))!, addOn: withKit ? await findSampleOwner(harness.meta, 'stock-kit', 'add-on') : null };
  }

  it.runIf(available)('are added with the app\'s sample, listed as the app\'s under the add-on\'s name, and removed with it', async () => {
    const w = await world(OWN_ROWS);
    h = w.harness;
    const added = await service(h).add(w.app, OPTS);
    expect(added.counts).toEqual({ orders: 2, 'stock-kit:items': 1, 'stock-kit:takes': 1 });
    expect(await names(h, 'stock_kit_items')).toEqual(['Sugar']);
    // Written as any sample row is: the total the take feeds is settled.
    expect(Number((await h.rows('SELECT taken FROM stock_kit_items'))[0]!['taken'])).toBe(1.5);
    const status = await service(h).status(w.app);
    expect(status.total).toBe(4);
    expect(status.tables.map((table) => table.ref).sort()).toEqual(['orders', 'stock-kit:items', 'stock-kit:takes']);
    // The add-on's own list of sample rows holds none of them.
    expect((await service(h).status(w.addOn!)).total).toBe(0);

    const removed = await service(h).remove(w.app, { keepChanged: true, userId: null, userLabel: 'test' });
    expect(removed).toMatchObject({ removed: 4, kept: 0 });
    expect(await count(h, 'stock_kit_items')).toBe(0);
    expect(await count(h, 'stock_kit_takes')).toBe(0);
    expect(await count(h, 'orders')).toBe(0);
  });

  it.runIf(available)('with the add-on absent the app\'s sample loads, lists no section and removes clean', async () => {
    const w = await world(OWN_ROWS, false);
    h = w.harness;
    const added = await service(h).add(w.app, OPTS);
    expect(added.counts).toEqual({ orders: 2 });
    expect((await service(h).status(w.app)).total).toBe(2);
    expect((await h.tableNames()).filter((name) => name.startsWith('stock_kit_'))).toEqual([]);
    expect(await service(h).remove(w.app, { keepChanged: true, userId: null, userLabel: 'test' })).toMatchObject({ removed: 2 });
  });

  it.runIf(available)('a row that is also one of the add-on\'s own sample rows is stored once, and leaves with the last list that names it', async () => {
    // The shop's file carries the kit's own "salt", as the kit's sample writes it, and a row of its own.
    const w = await world({ tables: [{ ref: 'items', rows: [{ '@label': 'salt', name: 'Salt', opening: '4.00' }, { '@label': 'shop-sugar', name: 'Sugar', opening: '6.00' }] }] });
    h = w.harness;
    await service(h).add(w.addOn!, OPTS);
    const added = await service(h).add(w.app, OPTS);
    // Taken, not written again: one Salt, listed by both.
    expect(added.counts).toEqual({ orders: 2, 'stock-kit:items': 2 });
    expect(await names(h, 'stock_kit_items')).toEqual(['Flour', 'Salt', 'Sugar']);
    expect((await service(h).status(w.app)).total).toBe(4);
    expect((await service(h).status(w.addOn!)).total).toBe(3);

    // The app's sample leaves: its own row goes, the shared one stays as the add-on's.
    await service(h).remove(w.app, { keepChanged: true, userId: null, userLabel: 'test' });
    expect(await names(h, 'stock_kit_items')).toEqual(['Flour', 'Salt']);
    expect((await service(h).status(w.addOn!)).total).toBe(3);
    // The add-on's sample leaves: the last list lets it go.
    await service(h).remove(w.addOn!, { keepChanged: true, userId: null, userLabel: 'test' });
    expect(await count(h, 'stock_kit_items')).toBe(0);
  });

  it.runIf(available)('the same, in the other order: the add-on\'s own sample takes the row the app\'s file already wrote', async () => {
    const w = await world({ tables: [{ ref: 'items', rows: [{ '@label': 'salt', name: 'Salt', opening: '4.00' }] }] });
    h = w.harness;
    await service(h).add(w.app, OPTS);
    expect(await names(h, 'stock_kit_items')).toEqual(['Salt']);
    await service(h).add(w.addOn!, OPTS);
    expect((await names(h, 'stock_kit_items')).sort()).toEqual(['Flour', 'Salt']);
    // The add-on's sample leaves first: Salt stays, as the app's.
    await service(h).remove(w.addOn!, { keepChanged: true, userId: null, userLabel: 'test' });
    expect(await names(h, 'stock_kit_items')).toEqual(['Salt']);
    await service(h).remove(w.app, { keepChanged: true, userId: null, userLabel: 'test' });
    expect(await count(h, 'stock_kit_items')).toBe(0);
  });

  it.runIf(available)('a file that points at a row of the add-on\'s own sample waits for it, loads when it arrives, and leaves before it', async () => {
    // A take of the kit's own "flour": there is nothing to take from until the kit's sample is in.
    const w = await world({ tables: [{ ref: 'takes', rows: [{ item_id: { '@ref': 'flour' }, qty: '3.00' }] }] });
    h = w.harness;
    const first = await service(h).add(w.app, OPTS);
    expect(first.counts).toEqual({ orders: 2 });
    expect(await count(h, 'stock_kit_takes')).toBe(0);
    // The kit's sample arrives: the shop's waiting rows come in with it.
    await service(h).add(w.addOn!, OPTS);
    expect(await count(h, 'stock_kit_takes')).toBe(2);
    expect((await service(h).status(w.app)).total).toBe(3);
    expect(Number((await h.rows(`SELECT taken FROM stock_kit_items WHERE name = 'Flour'`))[0]!['taken'])).toBe(5);
    // The kit's own flour now carries a total the shop's row moved: it still reads as a sample row, not one somebody changed.
    expect((await service(h).removePreview(w.addOn!)).changed).toEqual([]);
    // The kit's sample leaves: the shop's take of its flour goes first, so nothing of the kit's is held back as in use.
    const removed = await service(h).remove(w.addOn!, { keepChanged: true, userId: null, userLabel: 'test' });
    expect(removed.kept).toBe(0);
    expect(await count(h, 'stock_kit_items')).toBe(0);
    expect(await count(h, 'stock_kit_takes')).toBe(0);
    // The shop's own rows are still its sample.
    expect((await service(h).status(w.app)).total).toBe(2);
    expect(await count(h, 'orders')).toBe(2);
  });

  it.runIf(available)('a file that waits, waits whole: its other rows do not go in ahead of the ones that point at the add-on\'s sample', async () => {
    const w = await world({ tables: [{ ref: 'items', rows: [{ '@label': 'shop-sugar', name: 'Sugar', opening: '6.00' }] }, { ref: 'takes', rows: [{ item_id: { '@ref': 'flour' }, qty: '3.00' }] }] });
    h = w.harness;
    await service(h).add(w.app, OPTS);
    expect(await count(h, 'stock_kit_items')).toBe(0);
    await service(h).add(w.addOn!, OPTS);
    expect((await names(h, 'stock_kit_items')).sort()).toEqual(['Flour', 'Salt', 'Sugar']);
    expect(await count(h, 'stock_kit_takes')).toBe(2);
  });

  it.runIf(available)('with the add-on installed here but not connected to the app, nothing of the section is added', async () => {
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    const made = shop(OWN_ROWS);
    const theKit = kit();
    await h.stageAddOn(theKit.manifest, { files: theKit.files, bundled: true });
    // The kit on its own, then the shop without it.
    expect((await post(h, '/add-ons', { key: 'stock-kit', version: '1.0.0', attachTo: [] })).statusCode).toBe(200);
    await h.stageApp(made.manifest, made.files);
    expect((await h.install('shop', '0.3.0')).statusCode).toBe(200);
    const added = await service(h).add((await findSampleApp(h.meta, 'shop'))!, OPTS);
    expect(added.counts).toEqual({ orders: 2 });
    expect(await count(h, 'stock_kit_items')).toBe(0);
  });

  it.runIf(available)('rows that fed one of the add-on\'s totals leave with the app\'s sample, and the total goes back', async () => {
    const w = await world({ tables: [{ ref: 'takes', rows: [{ item_id: { '@ref': 'flour' }, qty: '3.00' }] }] });
    h = w.harness;
    await service(h).add(w.addOn!, OPTS);
    await service(h).add(w.app, OPTS);
    const taken = async () => Number((await h!.rows(`SELECT taken FROM stock_kit_items WHERE name = 'Flour'`))[0]!['taken']);
    expect(await taken()).toBe(5);
    // The app's sample leaves; the add-on's stays, with its total as its own rows make it.
    await service(h).remove(w.app, { keepChanged: true, userId: null, userLabel: 'test' });
    expect(await count(h, 'stock_kit_takes')).toBe(1);
    expect(await taken()).toBe(2);
    // And the add-on's item still reads as a sample row, not one somebody changed: its removal keeps nothing.
    const preview = await service(h).removePreview(w.addOn!);
    expect(preview.changed).toEqual([]);
    expect(await service(h).remove(w.addOn!, { keepChanged: true, userId: null, userLabel: 'test' })).toMatchObject({ kept: 0 });
    expect(await count(h, 'stock_kit_items')).toBe(0);
  });

  it.runIf(available)('the add-on removed with its tables leaves no entry that counts; the app\'s status and removal still answer', async () => {
    const w = await world(OWN_ROWS);
    h = w.harness;
    await service(h).add(w.app, OPTS);
    expect((await service(h).status(w.app)).total).toBe(4);
    const gone = await h.inject({ method: 'DELETE', url: '/add-ons/stock-kit', payload: { dropTables: true, confirmKey: 'stock-kit' } });
    expect(gone.statusCode, gone.body).toBe(200);
    expect((await h.tableNames()).filter((name) => name === 'stock_kit_items')).toEqual([]);
    // Its rows went with its tables: they are not sample rows any more, and nothing trips over them.
    expect((await service(h).status(w.app)).total).toBe(2);
    expect((await service(h).removePreview(w.app)).total).toBe(2);
    expect(await service(h).remove(w.app, { keepChanged: true, userId: null, userLabel: 'test' })).toMatchObject({ removed: 2 });
    expect((await service(h).status(w.app)).loaded).toBe(false);
  });

  it.runIf(available)('the add-on removed and its tables kept: the entries still resolve, and the app\'s removal takes them', async () => {
    const w = await world(OWN_ROWS);
    h = w.harness;
    await service(h).add(w.app, OPTS);
    expect((await h.inject({ method: 'DELETE', url: '/add-ons/stock-kit' })).statusCode).toBe(200);
    expect((await service(h).status(w.app)).total).toBe(4);
    expect(await service(h).remove(w.app, { keepChanged: true, userId: null, userLabel: 'test' })).toMatchObject({ removed: 4 });
    expect(await count(h, 'stock_kit_items')).toBe(0);
  });
});
