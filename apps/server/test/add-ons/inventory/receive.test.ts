// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A DELIVERY AGAINST AN ORDER, END TO END.
 *
 * An order is sent, and what it asks for counts as on order. Its delivery is
 * typed as a receipt and posted line by line: each line's move writes the
 * batch, the movement and the new average, and takes what arrived off what
 * is on order. The order reads part received while a line of it is still to
 * come. Nothing here calls the add-on's code: every step is a save.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LEGS } from '../../invoicing-install.helpers.js';
import { builtAddOn, installBuilt, writing, type Writing } from '../harness.js';
import { inDays, item, levelOf, movementsOf, n, opening, place, pointOf, said } from './world.js';

const inventory = builtAddOn('inventory');

describe.each(LEGS)('receiving against a purchase order — %s', (dialect, available) => {
  const run = available && inventory !== null;
  let w: Writing;
  let room: number;
  let lidocaine: number;
  let gloves: number;
  let order: number;
  let lidocaineLine: number;
  beforeAll(async () => {
    if (!run) return;
    w = await writing(await installBuilt(dialect, inventory));
    room = await place(w, 'Treatment room');
    lidocaine = await item(w, 'Lidocaine 1% ampoule', { sku: 'AMP-LID', tracks_batches: true });
    gloves = await item(w, 'Gloves, nitrile, L', { sku: 'GLV-L' });
    // Fourteen ampoules on the shelf at 1.10, in one batch, with a level to reorder at.
    await opening(w, room, [{ item_id: lidocaine, qty_typed: 14, unit_cost: 1.1, batch_code: 'LD118', expires_on: inDays(13) }]);
    await w.update('stock_points', (await pointOf(w, lidocaine, room))['id'], { reorder_level: 20 });
    const supplier = n((await w.create('suppliers', { name: 'Medisupply Direct', email: 'orders@medisupply.example' })).row['id']);
    order = n((await w.create('purchase_orders', { supplier_id: supplier, place_id: room })).row['id']);
    lidocaineLine = n((await w.create('po_lines', { po_id: order, item_id: lidocaine, packs: 5, pack_size: 10, price: 11 })).row['id']);
    await w.create('po_lines', { po_id: order, item_id: gloves, packs: 2, pack_size: 100, price: 9 });
  }, 240_000);
  afterAll(async () => {
    if (run) await w.h.close();
  });

  it.skipIf(!run)('an order line works out its units, its unit cost and its amount', async () => {
    const line = await w.one('po_lines', lidocaineLine);
    expect([n(line['qty']), n(line['unit_cost']), n(line['amount']), n(line['open_qty'])]).toEqual([50, 1.1, 55, 50]);
    const header = await w.one('purchase_orders', order);
    expect([n(header['lines']), n(header['total'])]).toEqual([2, 73]);
  });

  it.skipIf(!run)('sending the order puts its lines on order, and the low item reads "on order"', async () => {
    const before = await pointOf(w, lidocaine, room);
    expect([n(before['low']), n(before['state']), n(before['to_reorder'])]).toEqual([1, 1, 1]);
    const sent = await w.update('purchase_orders', order, { status: 'sent', sent_how: 'none' });
    // One call for the order's lines together.
    expect(sent.posted.map(said)).toEqual(['stock on-order post planned']);
    const at = await pointOf(w, lidocaine, room);
    expect(n(at['on_order'])).toBe(50);
    // Low, and something is coming: nothing more to reorder.
    expect([n(at['low']), n(at['state']), n(at['to_reorder'])]).toEqual([1, 2, 0]);
    expect(n((await pointOf(w, gloves, room))['on_order'])).toBe(200);
  });

  it.skipIf(!run)('five packs take lidocaine from 14 to 64', async () => {
    const receipt = n((await w.create('receipts', { po_id: order, place_id: room })).row['id']);
    const line = n((await w.create('receipt_lines', { receipt_id: receipt, po_line_id: lidocaineLine, item_id: lidocaine, packs: 5, pack_size: 10, batch_code: 'LD201', expires_on: inDays(200) })).row['id']);
    // The line took its cost from the order's line: nobody typed one.
    const typed = await w.one('receipt_lines', line);
    expect([n(typed['qty']), n(typed['cost_used']), n(typed['amount'])]).toEqual([50, 1.1, 55]);
    // Moving the receipt alone posts nothing: the lines do.
    const header = await w.update('receipts', receipt, { status: 'posting' });
    expect(header.posted).toEqual([]);
    expect(n((await pointOf(w, lidocaine, room))['on_hand'])).toBe(14);
    const posted = await w.update('receipt_lines', line, { status: 'posted' });
    expect(posted.posted.map(said)).toEqual(['stock receive post planned']);
    // The order moves on once, when the whole receipt is posted.
    expect((await w.one('purchase_orders', order))['status']).toBe('sent');
    const whole = await w.update('receipts', receipt, { status: 'posted' });
    expect(whole.posted.map(said)).toEqual(['stock order-progress post planned']);

    const at = await pointOf(w, lidocaine, room);
    expect([n(at['on_hand']), n(at['on_order']), n(at['cost_avg'])]).toEqual([64, 0, 1.1]);
    // Off the low list.
    expect([n(at['low']), n(at['state'])]).toEqual([0, 0]);
    expect(await movementsOf(w, lidocaine)).toEqual(['opening 14', 'received 50']);
    const batch = await levelOf(w, lidocaine, room, 'LD201');
    expect(n(batch?.['qty'])).toBe(50);
    expect(String(batch?.['batch_code'])).toBe('LD201');
    // The order's line is in; the gloves are still to come, so the order is part received.
    const ordered = await w.one('po_lines', lidocaineLine);
    expect([n(ordered['received']), n(ordered['open_qty'])]).toEqual([50, 0]);
    expect((await w.one('purchase_orders', order))['status']).toBe('part_received');
    expect(n((await pointOf(w, gloves, room))['on_order'])).toBe(200);
    const done = await w.one('receipts', receipt);
    expect([done['status'], n(done['lines']), n(done['units']), n(done['total']), n(done['unposted']), n(done['unreversed'])]).toEqual(['posted', 1, 50, 55, 0, 1]);
  });

  it.skipIf(!run)('a dearer delivery moves the average: (64 × 1.10 + 36 × 1.60) ÷ 100', async () => {
    await opening(w, room, [{ item_id: lidocaine, qty_typed: 36, unit_cost: 1.6, batch_code: 'LD300', expires_on: inDays(260) }]);
    const at = await pointOf(w, lidocaine, room);
    expect([n(at['on_hand']), n(at['cost_avg'])]).toEqual([100, 1.28]);
    expect(n((await w.one('items', lidocaine))['cost_avg'])).toBe(1.28);
    expect(n(at['value'])).toBe(128);
  });

  it.skipIf(!run)('a tracked item with no batch is refused, by name, and nothing is written', async () => {
    const receipt = n((await w.create('receipts', { place_id: room })).row['id']);
    const line = n((await w.create('receipt_lines', { receipt_id: receipt, item_id: lidocaine, qty_typed: 5, unit_cost: 1 })).row['id']);
    await w.update('receipts', receipt, { status: 'posting' });
    await expect(w.update('receipt_lines', line, { status: 'posted' })).rejects.toMatchObject({ code: 'POSTING_REFUSED', details: { reason: 'needs-batch' } });
    expect((await w.one('receipt_lines', line))['status']).toBe('draft');
    expect(n((await pointOf(w, lidocaine, room))['on_hand'])).toBe(100);
    // The receipt cannot be called posted while a line is out.
    await expect(w.update('receipts', receipt, { status: 'posted' })).rejects.toMatchObject({ code: 'STATE_MOVE_REFUSED' });
  });

  it.skipIf(!run)('the last line of the order closes it', async () => {
    const [glovesLine] = await w.rowsOf('po_lines', `po_id = ${String(order)} and item_id = ${String(gloves)}`);
    const receipt = n((await w.create('receipts', { po_id: order, place_id: room })).row['id']);
    const line = n((await w.create('receipt_lines', { receipt_id: receipt, po_line_id: glovesLine?.['id'], item_id: gloves, packs: 2, pack_size: 100 })).row['id']);
    await w.update('receipts', receipt, { status: 'posting' });
    await w.update('receipt_lines', line, { status: 'posted' });
    await w.update('receipts', receipt, { status: 'posted' });
    expect((await w.one('purchase_orders', order))['status']).toBe('received');
    expect(n((await pointOf(w, gloves, room))['on_order'])).toBe(0);
    expect(n((await pointOf(w, gloves, room))['on_hand'])).toBe(200);
  });
});
