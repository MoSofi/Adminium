// SPDX-License-Identifier: AGPL-3.0-only
/**
 * REORDER: a request for a stock point that is low becomes a line on a draft
 * order to the item's preferred supplier, in whole packs — and a second
 * request for the same supplier and place goes onto the same draft.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LEGS } from '../../invoicing-install.helpers.js';
import { builtAddOn, installBuilt, writing, type Writing } from '../harness.js';
import { item, n, opening, place, pointOf, said } from './world.js';

const inventory = builtAddOn('inventory');

describe.each(LEGS)('reorder requests — %s', (dialect, available) => {
  const run = available && inventory !== null;
  let w: Writing;
  let floor: number;
  let shirt: number;
  let tote: number;
  let loose: number;
  beforeAll(async () => {
    if (!run) return;
    w = await writing(await installBuilt(dialect, inventory));
    floor = await place(w, 'Shop floor');
    shirt = await item(w, 'T-shirt, blue, M');
    tote = await item(w, 'Canvas tote, natural');
    loose = await item(w, 'Sticker sheet');
    const northgate = n((await w.create('suppliers', { name: 'Northgate Wholesale' })).row['id']);
    await w.create('item_suppliers', { item_id: shirt, supplier_id: northgate, pack_name: 'pack', pack_size: 6, price: 44.4, rank: 'preferred' });
    await w.create('item_suppliers', { item_id: tote, supplier_id: northgate, pack_name: 'pack', pack_size: 10, price: 31, rank: 'preferred' });
    await opening(w, floor, [
      { item_id: shirt, qty_typed: 1, unit_cost: 7.4 },
      { item_id: tote, qty_typed: 4, unit_cost: 3.1 },
      { item_id: loose, qty_typed: 1, unit_cost: 0.5 },
    ]);
    await w.update('stock_points', (await pointOf(w, shirt, floor))['id'], { reorder_level: 8, reorder_qty: 12 });
    await w.update('stock_points', (await pointOf(w, tote, floor))['id'], { reorder_level: 10, reorder_qty: 20 });
    await w.update('stock_points', (await pointOf(w, loose, floor))['id'], { reorder_level: 5, reorder_qty: 10 });
  }, 240_000);
  afterAll(async () => {
    if (run) await w.h.close();
  });

  it.skipIf(!run)('two requests draft one order of two lines', async () => {
    const first = await w.create('reorder_requests', { stock_point_id: (await pointOf(w, shirt, floor))['id'] });
    expect(first.posted.map(said)).toEqual(['stock reorder post planned']);
    await w.create('reorder_requests', { stock_point_id: (await pointOf(w, tote, floor))['id'] });
    const drafts = await w.rowsOf('purchase_orders', "status = 'draft'");
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.['supplier_name']).toBe('Northgate Wholesale');
    const lines = await w.rowsOf('po_lines', `po_id = ${String(drafts[0]?.['id'])} order by id`);
    expect(lines.map((line) => [line['item_name'], n(line['packs']), n(line['pack_size']), n(line['amount'])])).toEqual([
      ['T-shirt, blue, M', 2, 6, 88.8],
      ['Canvas tote, natural', 2, 10, 62],
    ]);
    expect(n((await w.one('purchase_orders', drafts[0]?.['id']))['total'])).toBe(150.8);
    for (const one of [shirt, tote]) {
      const at = await pointOf(w, one, floor);
      expect([at['request_note'], at['request_supplier']]).toEqual(['drafted', 'Northgate Wholesale']);
    }
    const requests = await w.rowsOf('reorder_requests', 'id > 0 order by id');
    expect(requests.map((request) => [request['status'], n(request['qty'])])).toEqual([
      ['drafted', 12],
      ['drafted', 20],
    ]);
  });

  it.skipIf(!run)('pressed twice, the same line is not ordered twice', async () => {
    await w.create('reorder_requests', { stock_point_id: (await pointOf(w, tote, floor))['id'] });
    const lines = await w.rowsOf('po_lines', `item_id = ${String(tote)}`);
    expect(lines.map((line) => n(line['packs']))).toEqual([2]);
  });

  it.skipIf(!run)('an item with no preferred supplier is told so, and nothing is drafted', async () => {
    await w.create('reorder_requests', { stock_point_id: (await pointOf(w, loose, floor))['id'] });
    expect((await pointOf(w, loose, floor))['request_note']).toBe('needs_supplier');
    expect((await w.rowsOf('po_lines', `item_id = ${String(loose)}`))).toEqual([]);
    expect((await w.rowsOf('reorder_requests', 'id > 0 order by id')).at(-1)?.['status']).toBe('needs_supplier');
  });
});
