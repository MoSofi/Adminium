// SPDX-License-Identifier: AGPL-3.0-only
/**
 * INVENTORY'S STOCK, THROUGH REAL SAVES.
 *
 * Nothing here calls the add-on's code directly. Rows are saved through the
 * write service as a person saves them; the table's own rules decide what
 * posts; Adminium reads what the ledger asks for, runs the add-on's built
 * file, checks its answer and writes it; the totals climb from a movement to
 * its level, its stock point and its item. What is asserted is what the
 * database holds afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LEGS } from '../../invoicing-install.helpers.js';
import { builtAddOn, installBuilt, writing, type Writing } from '../harness.js';

const inventory = builtAddOn('inventory');
const n = (value: unknown) => Number(value);
/** What a save says it posted: the ledger, the action, the phase, and that the add-on's answer was written. */
const said = (one: { ledger: string; action: string; phase: string; state: string }) => `${one.ledger} ${one.action} ${one.phase} ${one.state}`;

describe.each(LEGS)('stock received, used and given back — %s', (dialect, available) => {
  const run = available && inventory !== null;
  let w: Writing;
  let place: number;
  let item: number;
  beforeAll(async () => {
    if (!run) return;
    w = await writing(await installBuilt(dialect, inventory));
    place = n((await w.create('places', { name: 'Shop floor' })).row['id']);
    item = n((await w.create('items', { name: 'Pen, black' })).row['id']);
  }, 240_000);
  afterAll(async () => {
    if (run) await w.h.close();
  });
  const point = async () => (await w.rowsOf('stock_points', `item_id = ${String(item)}`))[0];
  const movements = async () => (await w.rowsOf('movements', `item_id = ${String(item)} order by id`)).map((row) => `${String(row['kind'])} ${String(n(row['qty']))}`);

  it.skipIf(!run)('a new item starts in the default unit of the settings, with nothing on hand', async () => {
    const row = await w.one('items', item);
    const [each] = await w.rowsOf('units', "code = 'each'");
    expect(row).toMatchObject({ when_out: 'default' });
    expect(String(row['unit_id'])).toBe(String(each?.['id']));
    // The unit came from the settings, and what is copied through it came with it in the same save.
    expect([row['unit'], n(row['decimals'])]).toEqual(['each', 0]);
    expect(n(row['allow_short'])).toBe(1);
    expect(n(row['on_hand'])).toBe(0);
  });

  it.skipIf(!run)('opening stock is received line by line: ten pens at two each', async () => {
    const receipt = n((await w.create('receipts', { place_id: place, kind: 'opening' })).row['id']);
    const line = n((await w.create('receipt_lines', { receipt_id: receipt, item_id: item, qty_typed: 10, unit_cost: 2 })).row['id']);
    // The line carries its receipt's place and kind, and has worked out what it will post.
    expect(await w.one('receipt_lines', line)).toMatchObject({ kind: 'opening', status: 'draft' });
    expect(n((await w.one('receipt_lines', line))['qty'])).toBe(10);
    // A line cannot post while its receipt is a draft.
    await expect(w.update('receipt_lines', line, { status: 'posted' })).rejects.toMatchObject({ code: 'STATE_MOVE_REFUSED' });
    await w.update('receipts', receipt, { status: 'posting' });
    const posted = await w.update('receipt_lines', line, { status: 'posted' });
    expect(posted.posted.map(said)).toEqual(['stock receive post planned']);
    await w.update('receipts', receipt, { status: 'posted' });

    expect(await movements()).toEqual(['opening 10']);
    const at = await point();
    expect(n(at?.['on_hand'])).toBe(10);
    expect(n(at?.['available'])).toBe(10);
    expect(n(at?.['value'])).toBe(20);
    expect(n(at?.['cost_avg'])).toBe(2);
    const stocked = await w.one('items', item);
    expect(n(stocked['on_hand'])).toBe(10);
    expect(n(stocked['cost_avg'])).toBe(2);
    expect(n(stocked['value'])).toBe(20);
    // The receipt's own totals settled with its line.
    const header = await w.one('receipts', receipt);
    expect(header['number']).toBe('RC-0001');
    expect([n(header['lines']), n(header['units']), n(header['total']), n(header['unposted'])]).toEqual([1, 10, 20, 0]);
  });

  it.skipIf(!run)('a use takes from stock in the same save', async () => {
    const used = await w.create('uses', { item_id: item, qty: 3, place_id: place });
    expect(used.posted.map(said)).toEqual(['stock use-item post planned']);
    expect(await movements()).toEqual(['opening 10', 'used -3']);
    expect(n((await point())?.['on_hand'])).toBe(7);
    expect(n((await w.one('items', item))['on_hand'])).toBe(7);
  });

  it.skipIf(!run)('staff are never refused for stock: what the books did not hold is written, and the place is to be counted', async () => {
    const used = await w.create('uses', { item_id: item, qty: 10, place_id: place, kind: 'sold' });
    expect(used.posted.map(said)).toEqual(['stock use-item post planned']);
    expect((used.posted[0]?.notes ?? []).map((note) => note.note)).toContain('short');
    const at = await point();
    expect(n(at?.['on_hand'])).toBe(-3);
    expect(at?.['needs_count'] === true || n(at?.['needs_count']) === 1).toBe(true);
  });

  it.skipIf(!run)('a use is undone by its opposite, and the row stays', async () => {
    const used = await w.create('uses', { item_id: item, qty: 2, place_id: place });
    const before = n((await point())?.['on_hand']);
    const undone = await w.update('uses', used.row['id'], { voided_at: '2026-10-01T10:00:00.000Z' });
    expect(undone.posted.map(said)).toEqual(['stock use-item reverse planned']);
    expect(n((await point())?.['on_hand'])).toBe(before + 2);
    expect((await movements()).slice(-2)).toEqual(['used -2', 'used 2']);
  });
});
