// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN APP'S OWN GOODS IN ITS SAMPLE, STOCKED BY INVENTORY ITSELF.
 *
 * An app that suggests Inventory ships a second sample file for it: its own
 * goods, not Inventory's sample of clinic supplies. The file brings things
 * with no history (a supplier, a place, two items and who supplies them, an
 * opening receipt still a draft, an order still a draft, and the app's own
 * row that says which deal waits for which item) and asks Inventory for the
 * rest with `moves`: the receipt is posted and the order sent by saves of
 * their own, so the stock point, the level, the movement, the average cost
 * and what is on order are written by Inventory's own code.
 *
 * Everything Inventory wrote is listed as the app's sample: it leaves with it
 * and comes back with it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createSampleDataService, findSampleApp } from '../../../src/apps/sample-data.js';
import { LEGS } from '../../invoicing-install.helpers.js';
import { builtAddOn, writing, type Installed, type Writing } from '../harness.js';
import { addOnHarness } from '../../app-add-ons.helpers.js';
import { n } from './world.js';

const inventory = builtAddOn('inventory');
const pk = { ref: 'id', type: 'int', role: 'pk' };

function depot(version: string) {
  const manifest = {
    kind: 'app',
    manifestVersion: 1,
    key: 'depot',
    name: 'Depot',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'd', fallback: 'd' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: '0.3.19' },
    pages: [{ ref: 'deals', template: 'page-crud', title: { key: 't', fallback: 'Deals' }, nav: { group: 'manage', icon: 'list', order: 1 }, bindings: { main: 'deals' } }],
    frontends: [{ side: 'staff', kind: 'none' }],
    addOns: { suggests: [{ key: 'inventory', range: `>=${version}`, checked: true, reason: { 'en-US': 'Keeps the stock.' } }] },
    requiredSchema: {
      tables: [
        { ref: 'deals', columns: [pk, { ref: 'name', type: 'text', maxLength: 80 }] },
        { ref: 'needs', columns: [pk, { ref: 'deal_id', type: 'fk', references: 'deals' }, { ref: 'item', type: 'int', nullable: true, rules: { addOnLink: { addOn: 'inventory', table: 'items' } } }, { ref: 'qty', type: 'decimal', scale: 3, nullable: true }] },
      ],
    },
    sampleData: { file: 'seeds/depot.sample.json', addOns: { inventory: { file: 'seeds/depot.inventory.json' } } },
  };
  const section = {
    format: 'adminium.sample/1',
    app: 'depot',
    addOn: 'inventory',
    tables: [
      { ref: 'suppliers', rows: [{ '@label': 'sup', name: 'Halvard Werke', lead_days: 14 }] },
      { ref: 'places', rows: [{ '@label': 'yard', name: 'Meridian depot', for_sale: false }] },
      {
        ref: 'items',
        rows: [
          { '@label': 'desk', name: 'Bench desk runs', sku: 'MER-001', unit_id: { '@ref': 'unit:each' } },
          { '@label': 'booth', name: 'Acoustic booths, single', sku: 'MER-003', unit_id: { '@ref': 'unit:each' } },
        ],
      },
      { ref: 'item_suppliers', rows: [{ item_id: { '@ref': 'desk' }, supplier_id: { '@ref': 'sup' }, pack_size: 1, price: '310.00', rank: 'preferred' }] },
      { ref: 'receipts', rows: [{ '@label': 'opening', place_id: { '@ref': 'yard' }, kind: 'opening' }] },
      { ref: 'receipt_lines', rows: [{ receipt_id: { '@ref': 'opening' }, item_id: { '@ref': 'desk' }, qty_typed: 120, unit_cost: '310.00' }] },
      { ref: 'purchase_orders', rows: [{ '@label': 'po', supplier_id: { '@ref': 'sup' }, place_id: { '@ref': 'yard' }, sent_how: 'none' }] },
      { ref: 'po_lines', rows: [{ po_id: { '@ref': 'po' }, item_id: { '@ref': 'booth' }, packs: 12, pack_size: 1, price: '2900.00' }] },
      { ref: 'needs', own: true, rows: [{ deal_id: { '@ref': 'deal:1' }, item: { '@ref': 'desk' }, qty: 46 }] },
    ],
    moves: [
      { ref: 'opening', to: 'posting' },
      { table: 'receipt_lines', to: 'posted' },
      { ref: 'opening', to: 'posted' },
      { table: 'purchase_orders', to: 'sent' },
    ],
  };
  const files = {
    'seeds/depot.sample.json': JSON.stringify({ format: 'adminium.sample/1', app: 'depot', tables: [{ ref: 'deals', rows: [{ '@label': 'deal:1', name: 'Desk rows for Nordwind' }] }] }),
    'seeds/depot.inventory.json': JSON.stringify(section),
  };
  return { manifest, files };
}

describe.each(LEGS)('an app\'s own goods, stocked by Inventory from its sample — %s', (dialect, available) => {
  const run = available && inventory !== null;
  let w: Writing;
  const service = () => createSampleDataService({ ...w.h.sampleData, writes: () => w.writes });
  const app = async () => (await findSampleApp(w.h.meta, 'depot'))!;
  const opts = () => ({ locale: 'en-US', userId: w.h.owner.id, userLabel: 'owner@test' });
  const t = (ref: string) => w.real(ref);
  const count = async (ref: string, where = '1 = 1') => n((await w.h.rows(`select count(*) as c from ${t(ref)} where ${where}`))[0]!['c']);
  const item = async (sku: string) => (await w.h.rows(`select * from ${t('items')} where sku = '${sku}'`))[0]!;
  /** Every table the file's rows, and Inventory's own answer to them, land in. */
  const HELD = ['suppliers', 'places', 'items', 'item_suppliers', 'receipts', 'receipt_lines', 'purchase_orders', 'po_lines', 'stock_points', 'levels', 'batches', 'movements', 'on_order_moves', 'postings'];
  const held = async () => Object.fromEntries(await Promise.all(HELD.map(async (ref) => [ref, await count(ref)] as const)));

  beforeAll(async () => {
    if (!run) return;
    const h = await addOnHarness(dialect, {});
    await h.stageAddOn(inventory.manifest, { bundled: true, files: inventory.files });
    const made = depot(inventory.version);
    await h.stageApp(made.manifest, made.files);
    const installed = await h.install('depot', '0.1.0', { addOns: [{ key: 'inventory', version: inventory.version }] });
    expect(installed.statusCode, installed.body).toBe(200);
    const real = (ref: string) => `inventory_${ref}`;
    const as: Installed = { h, addOn: inventory, reply: installed.json() as Record<string, unknown>, real, rowsOf: (ref, where) => h.rows(`select * from ${real(ref)}${where === undefined ? '' : ` where ${where}`}`), hosts: [] };
    w = await writing(as);
  }, 600_000);
  afterAll(async () => {
    if (run) await w.h.close();
  });

  it.runIf(run)('the file\'s things arrive, and Inventory itself writes their stock, their cost and what is on order', async () => {
    const added = await service().add(await app(), opts());
    expect(added.counts).toMatchObject({ deals: 1, needs: 1, 'inventory:items': 2, 'inventory:suppliers': 1, 'inventory:receipt_lines': 1, 'inventory:purchase_orders': 1 });
    // Nobody typed these: the opening receipt was posted by a save, and Inventory's code planned the rows.
    const desk = await item('MER-001');
    expect([n(desk['on_hand']), n(desk['cost_avg']), n(desk['value'])]).toEqual([120, 310, 37200]);
    const point = (await w.h.rows(`select * from ${t('stock_points')} where item_id = ${String(desk['id'])}`))[0]!;
    expect([n(point['on_hand']), n(point['available']), n(point['on_order'])]).toEqual([120, 120, 0]);
    expect((await w.h.rows(`select kind, qty, unit_cost from ${t('movements')}`)).map((row) => `${String(row['kind'])} ${String(n(row['qty']))} at ${String(n(row['unit_cost']))}`)).toEqual(['opening 120 at 310']);
    expect(await count('movements', 'receipt_id is null')).toBe(0);
    const receipt = (await w.h.rows(`select status, units, unposted from ${t('receipts')}`))[0]!;
    expect([receipt['status'], n(receipt['units']), n(receipt['unposted'])]).toEqual(['posted', 120, 0]);
    // The order was sent by a save: twelve booths are on their way, and none is in.
    const booth = await item('MER-003');
    const coming = (await w.h.rows(`select * from ${t('stock_points')} where item_id = ${String(booth['id'])}`))[0]!;
    expect([n(booth['on_hand']), n(coming['on_hand']), n(coming['on_order'])]).toEqual([0, 0, 12]);
    const order = (await w.h.rows(`select status, number, sent_on from ${t('purchase_orders')}`))[0]!;
    expect(order['status']).toBe('sent');
    expect(String(order['number'])).toMatch(/^PO-/);
    // The app's own row points at Inventory's item.
    expect(n((await w.h.rows('select item from needs'))[0]!['item'])).toBe(n(desk['id']));
    // Listed as the app's: what the file brought and what Inventory wrote for it.
    const listed = (await service().status(await app())).tables.map((table) => table.ref);
    for (const ref of ['inventory:items', 'inventory:receipts', 'inventory:stock_points', 'inventory:levels', 'inventory:movements', 'inventory:on_order_moves', 'inventory:postings']) expect(listed, ref).toContain(ref);
  }, 300_000);

  it.runIf(run)('all of it leaves with the app\'s sample, and comes back with it', async () => {
    const before = await held();
    expect(before['movements']).toBe(1);
    const removed = await service().remove(await app(), { keepChanged: true, userId: w.h.owner.id, userLabel: 'owner@test' });
    expect(removed.kept).toBe(0);
    expect(await held()).toEqual(Object.fromEntries(HELD.map((ref) => [ref, 0])));
    expect(n((await w.h.rows('select count(*) as c from needs'))[0]!['c'])).toBe(0);
    // Inventory's own starting rows (its units, its reasons) are no sample: they stay.
    expect(await count('units')).toBeGreaterThan(0);
    await service().add(await app(), opts());
    expect(await held()).toEqual(before);
    const desk = await item('MER-001');
    expect([n(desk['on_hand']), n(desk['cost_avg'])]).toEqual([120, 310]);
  }, 300_000);
});
