// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A PURCHASE ORDER'S WAYS FORWARD AND BACK.
 *
 * Closing an order takes off what is still on order; reopening puts it back.
 * A receipt against an order that reads received is undone only after the
 * order is reopened. The two steps out of "sent" that a delivery makes are
 * the posting's own: no person can make them.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LEGS } from '../../invoicing-install.helpers.js';
import { builtAddOn, installBuilt, writing, type Writing } from '../harness.js';
import { item, n, place, pointOf, receive } from './world.js';

const inventory = builtAddOn('inventory');

describe.each(LEGS)('purchase orders — %s', (dialect, available) => {
  const run = available && inventory !== null;
  let w: Writing;
  let floor: number;
  let tote: number;
  let shirt: number;
  let supplier: number;
  const order = async () => {
    const po = n((await w.create('purchase_orders', { supplier_id: supplier, place_id: floor })).row['id']);
    const toteLine = n((await w.create('po_lines', { po_id: po, item_id: tote, packs: 2, pack_size: 10, price: 31 })).row['id']);
    const shirtLine = n((await w.create('po_lines', { po_id: po, item_id: shirt, packs: 2, pack_size: 6, price: 44.4 })).row['id']);
    return { po, toteLine, shirtLine };
  };
  const onOrder = async () => [n((await pointOf(w, tote, floor))['on_order']), n((await pointOf(w, shirt, floor))['on_order'])];
  beforeAll(async () => {
    if (!run) return;
    w = await writing(await installBuilt(dialect, inventory));
    floor = await place(w, 'Shop floor');
    tote = await item(w, 'Canvas tote, natural');
    shirt = await item(w, 'T-shirt, blue, M');
    supplier = n((await w.create('suppliers', { name: 'Northgate Wholesale' })).row['id']);
  }, 240_000);
  afterAll(async () => {
    if (run) await w.h.close();
  });

  it.skipIf(!run)('an order with no line cannot be sent, and a draft puts nothing on order', async () => {
    const empty = n((await w.create('purchase_orders', { supplier_id: supplier, place_id: floor })).row['id']);
    await expect(w.update('purchase_orders', empty, { status: 'sent', sent_how: 'none' })).rejects.toMatchObject({ code: 'STATE_MOVE_REFUSED' });
    const { po } = await order();
    expect((await w.rowsOf('stock_points', `item_id = ${String(tote)}`)).map((row) => n(row['on_order']))).toEqual([]);
    await w.update('purchase_orders', po, { status: 'cancelled' });
  });

  it.skipIf(!run)('the planner\'s steps are declared moves no person can make', async () => {
    const { po } = await order();
    await w.update('purchase_orders', po, { status: 'sent', sent_how: 'none' });
    for (const to of ['part_received', 'received']) await expect(w.update('purchase_orders', po, { status: to }), to).rejects.toMatchObject({ code: 'STATE_MOVE_REFUSED' });
    expect((await w.one('purchase_orders', po))['status']).toBe('sent');
    await w.update('purchase_orders', po, { status: 'cancelled' });
    expect(await onOrder()).toEqual([0, 0]);
  });

  it.skipIf(!run)('close, reopen, undo a receipt, close again', async () => {
    const { po, toteLine } = await order();
    await w.update('purchase_orders', po, { status: 'sent', sent_how: 'none' });
    expect(await onOrder()).toEqual([20, 12]);
    // The totes arrive; the shirts do not.
    const got = await receive(w, { po_id: po, place_id: floor }, [{ po_line_id: toteLine, item_id: tote, packs: 2, pack_size: 10 }]);
    expect((await w.one('purchase_orders', po))['status']).toBe('part_received');
    expect(await onOrder()).toEqual([0, 12]);
    // Close: the rest will not come.
    await w.update('purchase_orders', po, { status: 'received' });
    expect(await onOrder()).toEqual([0, 0]);
    // A receipt whose order reads received is not undone until the order is reopened.
    await expect(w.update('receipts', got.receipt, { status: 'reversing' })).rejects.toMatchObject({ code: 'STATE_MOVE_REFUSED' });
    await w.update('purchase_orders', po, { status: 'part_received' });
    expect(await onOrder()).toEqual([0, 12]);
    await w.update('receipts', got.receipt, { status: 'reversing' });
    await w.update('receipt_lines', got.lines[0], { status: 'reversed' });
    await w.update('receipts', got.receipt, { status: 'reversed' });
    expect(n((await pointOf(w, tote, floor))['on_hand'])).toBe(0);
    // What was received and taken back counts as on order again.
    expect(await onOrder()).toEqual([20, 12]);
    await w.update('purchase_orders', po, { status: 'received' });
    expect(await onOrder()).toEqual([0, 0]);
  });

  it.skipIf(!run)('a line sent back leaves at its cost and counts as on order again', async () => {
    const { po, toteLine } = await order();
    await w.update('purchase_orders', po, { status: 'sent', sent_how: 'none' });
    const got = await receive(w, { po_id: po, place_id: floor }, [{ po_line_id: toteLine, item_id: tote, packs: 2, pack_size: 10 }]);
    const before = n((await pointOf(w, tote, floor))['on_hand']);
    await w.update('receipt_lines', got.lines[0], { status: 'sent_back' });
    const at = await pointOf(w, tote, floor);
    expect([n(at['on_hand']), n(at['on_order'])]).toEqual([before - 20, 20]);
    const last = (await w.rowsOf('movements', `item_id = ${String(tote)} order by id`)).at(-1);
    expect([last?.['kind'], n(last?.['qty']), n(last?.['unit_cost'])]).toEqual(['sent_back', -20, 3.1]);
  });

  it.skipIf(!run)('a receipt with no order is undone with nothing to wait for', async () => {
    const got = await receive(w, { place_id: floor }, [{ item_id: shirt, qty_typed: 3, unit_cost: 7.4 }]);
    const before = n((await pointOf(w, shirt, floor))['on_hand']);
    await w.update('receipts', got.receipt, { status: 'reversing' });
    await w.update('receipt_lines', got.lines[0], { status: 'reversed' });
    await w.update('receipts', got.receipt, { status: 'reversed' });
    expect(n((await pointOf(w, shirt, floor))['on_hand'])).toBe(before - 3);
  });

  it.skipIf(!run)('a fifty-first line is refused', async () => {
    const po = n((await w.create('purchase_orders', { supplier_id: supplier, place_id: floor })).row['id']);
    for (let i = 0; i < 50; i += 1) {
      const one = await item(w, `Filler ${String(i)}`);
      await w.create('po_lines', { po_id: po, item_id: one, packs: 1, pack_size: 1, price: 1 });
    }
    await expect(w.create('po_lines', { po_id: po, item_id: tote, packs: 1, pack_size: 1, price: 1 })).rejects.toMatchObject({ code: 'CAPACITY_FULL' });
  });
});
