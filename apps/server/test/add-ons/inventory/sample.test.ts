// SPDX-License-Identifier: AGPL-3.0-only
/**
 * INVENTORY'S SAMPLE DATA, ADDED BY THE REAL LOADER.
 *
 * The sample is a month of history: 2,454 rows written as they stand, with
 * nothing posted. Every figure a fresh install shows is then a total
 * Adminium adds up — movements into levels, levels into stock points, points
 * into items, lines into their documents. This suite adds the sample on each
 * database and reads those figures from the stored columns; then it works
 * with the sample as an owner would (a use undone, a delivery received, a new
 * order numbered) and takes it out and puts it in again.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createSampleDataService, findSampleOwner } from '../../../src/apps/sample-data.js';
import { LEGS } from '../../invoicing-install.helpers.js';
import { builtAddOn, installBuilt, writing, type Writing } from '../harness.js';
import { n, yes } from './world.js';

const inventory = builtAddOn('inventory');
const sampleFile = (inventory?.manifest['sampleData'] as { file?: string } | undefined)?.file;
const money = (value: unknown): string => n(value).toFixed(2);

describe.skipIf(inventory === null)('Inventory, as it is built', () => {
  it('ships the sample file its manifest names', () => {
    expect(sampleFile).toBe('seeds/inventory.sample.json');
    expect(Object.keys(inventory?.files ?? {})).toContain(sampleFile);
  });
});

describe.each(LEGS)('Inventory\'s sample data — %s', (dialect, available) => {
  const run = available && inventory !== null && sampleFile !== undefined;
  let w: Writing;
  let counts: Record<string, number>;
  const service = () => createSampleDataService(w.h.sampleData);
  const owner = async () => (await findSampleOwner(w.h.meta, 'inventory', 'add-on'))!;
  const add = async () => service().add(await owner(), { locale: 'en-US', userId: w.h.owner.id, userLabel: 'owner@test' });
  const one = async (sql: string): Promise<Record<string, unknown>> => (await w.h.rows(sql))[0]!;
  const t = (ref: string) => w.real(ref);
  const pointOf = async (sku: string, place: string) =>
    one(`select p.* from ${t('stock_points')} p join ${t('items')} i on i.id = p.item_id join ${t('places')} l on l.id = p.place_id where i.sku = '${sku}' and l.name = '${place}'`);

  beforeAll(async () => {
    if (!run) return;
    w = await writing(await installBuilt(dialect, inventory));
    counts = (await add()).counts;
  }, 600_000);
  afterAll(async () => {
    if (run) await w.h.close();
  });

  it.skipIf(!run)('writes every row but the settings row, which the install already made', async () => {
    expect(counts).toEqual({
      categories: 8,
      places: 6,
      suppliers: 3,
      items: 40,
      item_suppliers: 40,
      batches: 50,
      stock_points: 44,
      levels: 46,
      kits: 3,
      kit_lines: 16,
      purchase_orders: 3,
      po_lines: 8,
      receipts: 5,
      receipt_lines: 43,
      transfers: 2,
      transfer_lines: 6,
      counts: 1,
      count_lines: 14,
      count_marks: 14,
      uses: 649,
      reorder_requests: 2,
      postings: 734,
      movements: 707,
      on_order_moves: 9,
    });
    expect(Object.values(counts).reduce((sum, count) => sum + count, 0)).toBe(2453);
    // The units and reasons are the install's own rows: named by the sample, never added again.
    expect([n((await one(`select count(*) as c from ${t('units')}`))['c']), n((await one(`select count(*) as c from ${t('reasons')}`))['c']), n((await one(`select count(*) as c from ${t('settings')}`))['c'])]).toEqual([12, 7, 1]);
    const units = await w.h.rows(`select i.unit as unit, count(*) as c from ${t('items')} i group by i.unit order by i.unit`);
    expect(units.map((row) => [row['unit'], n(row['c'])])).toEqual([['each', 34], ['pair', 3], ['roll', 1], ['set', 1], ['sheet', 1]]);
  });

  it.skipIf(!run)('the sample settles to the figures: stock worth $7,490.43, place by place', async () => {
    expect(money((await one(`select sum(value) as v from ${t('stock_points')}`))['v'])).toBe('7490.43');
    const byPlace = await w.h.rows(`select l.name as place, sum(p.value) as v from ${t('stock_points')} p join ${t('places')} l on l.id = p.place_id group by l.name, l.position order by l.position`);
    expect(byPlace.map((row) => [row['place'], money(row['v'])])).toEqual([
      ['Shop floor', '964.55'],
      ['Back room', '108.26'],
      ['Treatment room', '254.00'],
      ['Linen store', '5688.42'],
      ['At the laundry', '475.20'],
      ['Damaged', '0.00'],
    ]);
    // An item's own totals are its points' together.
    expect(money((await one(`select sum(value) as v from ${t('items')}`))['v'])).toBe('7490.43');
    expect(n((await one(`select on_hand from ${t('items')} where sku = 'TWL-BATH'`))['on_hand'])).toBe(260);
    // Every level holds what its movements add up to, and none is below zero.
    const off = await w.h.rows(`select l.id from ${t('levels')} l where l.qty <> (select coalesce(sum(m.qty), 0) from ${t('movements')} m where m.level_id = l.id) or l.qty < 0`);
    expect(off).toEqual([]);
  });

  it.skipIf(!run)('$1,490.62 sold and used, all of it dated last month', async () => {
    expect(money((await one(`select sum(cost_out) as v from ${t('movements')} where kind in ('sold', 'used')`))['v'])).toBe('1490.62');
    const kinds = await w.h.rows(`select kind, count(*) as c from ${t('movements')} group by kind order by kind`);
    expect(Object.fromEntries(kinds.map((row) => [row['kind'], n(row['c'])]))).toEqual({ adjusted: 3, moved_in: 6, moved_out: 6, opening: 40, received: 3, returned: 1, sold: 126, used: 520, written_off: 2 });
    // The times are the sample's own, not the moment it was added: the newest is from the last day of last month.
    const now = new Date();
    const firstOfThisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const stored = (await one(`select max(${dialect === 'mysql' ? '`at`' : '"at"'}) as newest from ${t('movements')}`))['newest'];
    const newest = stored instanceof Date ? stored : new Date(`${String(stored).replace(' ', 'T').replace(/Z$/, '')}Z`);
    expect(newest.getTime()).toBeLessThan(firstOfThisMonth.getTime() + 86_400_000);
    expect(newest.getTime()).toBeGreaterThan(firstOfThisMonth.getTime() - 5 * 86_400_000);
  });

  it.skipIf(!run)('5 points low, 2 to reorder, 1 out of stock; 3 are on their way', async () => {
    const flag = async (where: string) => (await w.h.rows(`select i.sku as sku from ${t('stock_points')} p join ${t('items')} i on i.id = p.item_id where ${where} order by i.id`)).map((row) => row['sku']);
    expect(await flag('p.low = 1')).toEqual(['TS-BLU-M', 'TOTE-NAT', 'AMP-LID', 'VAC-FLU', 'GLV-L']);
    expect(await flag('p.to_reorder = 1')).toEqual(['TS-BLU-M', 'TOTE-NAT']);
    expect(await flag('p.state = 3')).toEqual(['TS-BLU-M']);
    expect(await flag('p.state = 2')).toEqual(['AMP-LID', 'VAC-FLU', 'GLV-L']);
    const tote = await pointOf('TOTE-NAT', 'Shop floor');
    expect([n(tote['on_hand']), n(tote['available']), n(tote['reorder_level']), tote['request_note'], tote['request_supplier']]).toEqual([4, 4, 10, 'drafted', 'Northgate Wholesale']);
    expect([n((await pointOf('GLV-L', 'Treatment room'))['on_order']), n((await pointOf('AMP-LID', 'Treatment room'))['on_order']), n((await pointOf('VAC-FLU', 'Treatment room'))['on_order'])]).toEqual([200, 50, 40]);
    // What order 1001 put on order came off when it was received.
    expect(n((await pointOf('SWAB-ALC', 'Treatment room'))['on_order'])).toBe(0);
  });

  it.skipIf(!run)('2 batches run out within 30 days, with 14 and 8 left', async () => {
    const soon = new Date(Date.now() + 31 * 86_400_000).toISOString().slice(0, 10);
    const rows = await w.h.rows(`select batch_code, qty from ${t('levels')} where expires_on is not null and expires_on <= '${soon}' and qty > 0 order by id`);
    expect(rows.map((row) => [row['batch_code'], n(row['qty'])])).toEqual([['LD118', 14], ['FV26A', 8]]);
  });

  it.skipIf(!run)('the documents add up: three orders, five receipts, two transfers and a count', async () => {
    const orders = await w.h.rows(`select number, status, total, units, line_count, supplier_name, place_name from ${t('purchase_orders')} order by id`);
    expect(orders.map((po) => [po['number'], po['status'], money(po['total']), n(po['units']), n(po['line_count']), po['supplier_name'], po['place_name']])).toEqual([
      ['PO-1001', 'received', '44.00', 700, 3, 'Medisupply Direct', 'Treatment room'],
      ['PO-1002', 'sent', '465.00', 290, 3, 'Medisupply Direct', 'Treatment room'],
      ['PO-1003', 'draft', '150.80', 32, 2, 'Northgate Wholesale', 'Shop floor'],
    ]);
    const lines = await w.h.rows(`select l.qty, l.received, l.open_qty, l.order_status from ${t('po_lines')} l join ${t('purchase_orders')} o on o.id = l.po_id where o.number in ('PO-1001', 'PO-1002') order by l.id`);
    expect(lines.map((line) => [n(line['qty']), n(line['received']), n(line['open_qty']), line['order_status']])).toEqual([
      [400, 400, 0, 'received'],
      [200, 200, 0, 'received'],
      [100, 100, 0, 'received'],
      [200, 0, 200, 'sent'],
      [50, 0, 50, 'sent'],
      [40, 0, 40, 'sent'],
    ]);
    const receipts = await w.h.rows(`select r.number, r.kind, r.status, r.total, r.units, r.lines, r.unposted, r.unreversed, r.can_undo, l.name as place from ${t('receipts')} r join ${t('places')} l on l.id = r.place_id order by r.id`);
    expect(receipts.map((r) => [r['number'], r['kind'], r['place'], n(r['lines']), n(r['units']), money(r['total']), n(r['unposted']), n(r['unreversed']), n(r['can_undo'])])).toEqual([
      ['RC-0001', 'opening', 'Shop floor', 14, 444, '1339.00', 0, 14, 1],
      ['RC-0002', 'opening', 'Back room', 6, 1962, '202.90', 0, 6, 1],
      ['RC-0003', 'opening', 'Treatment room', 12, 2536, '892.50', 0, 12, 1],
      ['RC-0004', 'opening', 'Linen store', 8, 1554, '6520.30', 0, 8, 1],
      ['RC-0005', 'delivery', 'Treatment room', 3, 700, '44.00', 0, 3, 0],
    ]);
    const opened = await one(`select sum(total) as v, sum(units) as u from ${t('receipts')} where kind = 'opening'`);
    expect([money(opened['v']), n(opened['u']), n((await one(`select count(*) as c from ${t('receipt_lines')} where kind = 'opening'`))['c'])]).toEqual(['8954.70', 6496, 40]);
    const transfers = await w.h.rows(`select tr.number, tr.status, tr.lines, tr.unreversed from ${t('transfers')} tr order by tr.id`);
    expect(transfers.map((tr) => [tr['number'], tr['status'], n(tr['lines']), n(tr['unreversed'])])).toEqual([['TR-0001', 'done', 3, 3], ['TR-0002', 'done', 3, 3]]);
    const count = await one(`select c.number, c.status, c.lines, c.counted_lines, c.uncounted, c.differences, c.value from ${t('counts')} c`);
    expect([count['number'], count['status'], n(count['lines']), n(count['counted_lines']), n(count['uncounted']), n(count['differences']), money(count['value'])]).toEqual(['CNT-0001', 'posted', 14, 14, 0, 3, '-0.95']);
    const linen = await w.h.rows(`select i.sku as sku, l.name as place, p.on_hand from ${t('stock_points')} p join ${t('items')} i on i.id = p.item_id join ${t('places')} l on l.id = p.place_id where i.sku in ('TWL-BATH', 'TWL-HAND', 'SHEET-D') order by i.id, l.position`);
    expect(linen.map((row) => `${String(row['sku'])} ${String(row['place'])} ${String(n(row['on_hand']))}`)).toEqual(['TWL-BATH Linen store 236', 'TWL-BATH At the laundry 24', 'TWL-HAND Linen store 236', 'TWL-HAND At the laundry 24', 'SHEET-D Linen store 128', 'SHEET-D At the laundry 12']);
  });

  it.skipIf(!run)('a receipt of posting names its row the way a real one does', async () => {
    const tables = await w.h.rows(`select source_table, line_table, count(*) as c from ${t('postings')} group by source_table, line_table order by source_table`);
    expect(tables.map((row) => [row['source_table'], row['line_table'], n(row['c'])])).toEqual([
      ['inventory:count_lines', '', 14],
      ['inventory:count_marks', '', 14],
      ['inventory:purchase_orders', 'inventory:po_lines', 6],
      ['inventory:receipt_lines', '', 43],
      ['inventory:reorder_requests', '', 2],
      ['inventory:transfer_lines', '', 6],
      ['inventory:uses', '', 649],
    ]);
    // Every use's receipt names a use that is there.
    const named = (await w.h.rows(`select source_row from ${t('postings')} where source_table = 'inventory:uses' order by id`)).map((row) => row['source_row']);
    const uses = (await w.h.rows(`select id from ${t('uses')} order by id`)).map((row) => String(n(row['id'])));
    expect(named).toEqual(uses);
  });

  it.skipIf(!run)('a sample use is undone like a real one: the stained bathrobe goes back on the shelf', async () => {
    const before = n((await pointOf('ROBE', 'Linen store'))['on_hand']);
    expect(before).toBe(35);
    const use = await one(`select u.id from ${t('uses')} u join ${t('items')} i on i.id = u.item_id where i.sku = 'ROBE' and u.kind = 'written_off'`);
    await w.update('uses', use['id'], { voided_at: new Date().toISOString() });
    expect(n((await pointOf('ROBE', 'Linen store'))['on_hand'])).toBe(36);
    const robe = await w.h.rows(`select m.kind, m.qty from ${t('movements')} m join ${t('items')} i on i.id = m.item_id where i.sku = 'ROBE' order by m.id`);
    expect(robe.map((row) => `${String(row['kind'])} ${String(n(row['qty']))}`)).toEqual(['opening 36', 'written_off -1', 'written_off 1']);
  });

  it.skipIf(!run)('the open order is received into the sample\'s stock, and a new order takes the next number', async () => {
    const order = await one(`select id, place_id, supplier_id from ${t('purchase_orders')} where number = 'PO-1002'`);
    const line = await one(`select l.id, l.item_id from ${t('po_lines')} l join ${t('items')} i on i.id = l.item_id where l.po_id = ${String(order['id'])} and i.sku = 'AMP-LID'`);
    const receipt = (await w.create('receipts', { po_id: order['id'], supplier_id: order['supplier_id'], place_id: order['place_id'] })).row;
    const received = (await w.create('receipt_lines', { receipt_id: receipt['id'], po_line_id: line['id'], item_id: line['item_id'], packs: 5, batch_code: 'LD201', expires_on: '2029-04-30' })).row;
    await w.update('receipts', receipt['id'], { status: 'posting' });
    await w.update('receipt_lines', received['id'], { status: 'posted' });
    await w.update('receipts', receipt['id'], { status: 'posted' });
    const point = await pointOf('AMP-LID', 'Treatment room');
    expect([n(point['on_hand']), n(point['on_order']), n(point['low']), n(point['cost_avg'])]).toEqual([64, 0, 0, 1.1]);
    expect((await one(`select number from ${t('receipts')} where id = ${String(receipt['id'])}`))['number']).toBe('RC-0006');
    expect((await one(`select status from ${t('purchase_orders')} where id = ${String(order['id'])}`))['status']).toBe('part_received');
    const made = (await w.create('purchase_orders', { supplier_id: order['supplier_id'], place_id: order['place_id'] })).row;
    expect((await one(`select number from ${t('purchase_orders')} where id = ${String(made['id'])}`))['number']).toBe('PO-1004');
  });
});

describe.each(LEGS)('Inventory\'s sample data, taken out and put in again — %s', (dialect, available) => {
  const run = available && inventory !== null && sampleFile !== undefined;
  let w: Writing;
  beforeAll(async () => {
    if (run) w = await writing(await installBuilt(dialect, inventory));
  }, 240_000);
  afterAll(async () => {
    if (run) await w.h.close();
  });

  it.skipIf(!run)('leaves the tables as an install left them, and adds up the same the second time', async () => {
    const service = createSampleDataService(w.h.sampleData);
    const owner = (await findSampleOwner(w.h.meta, 'inventory', 'add-on'))!;
    const told = { locale: 'en-US', userId: w.h.owner.id, userLabel: 'owner@test' };
    const value = async () => money((await w.h.rows(`select sum(value) as v from ${w.real('stock_points')}`))[0]!['v']);
    const rowsIn = async (ref: string) => n((await w.h.rows(`select count(*) as c from ${w.real(ref)}`))[0]!['c']);
    await service.add(owner, told);
    expect(await value()).toBe('7490.43');
    expect((await service.status(owner)).total).toBe(2453);

    const removed = await service.remove(owner, { keepChanged: true, userId: w.h.owner.id, userLabel: 'owner@test' });
    expect(removed).toMatchObject({ removed: 2453, kept: 0 });
    const tables = (inventory!.manifest['requiredSchema'] as { tables: { ref: string }[] }).tables.map((table) => table.ref);
    const left: Record<string, number> = {};
    for (const ref of tables) {
      const count = await rowsIn(ref);
      if (count > 0) left[ref] = count;
    }
    // Only what the install wrote is left: the units, the reasons and the one settings row.
    expect(left).toEqual({ settings: 1, units: 12, reasons: 7 });

    await service.add(owner, told);
    expect(await value()).toBe('7490.43');
    expect(await rowsIn('movements')).toBe(707);
    expect(yes((await w.h.rows(`select unassigned from ${w.real('batches')} where code = '-' limit 1`))[0]!['unassigned'])).toBe(true);
  }, 600_000);
});
