// SPDX-License-Identifier: AGPL-3.0-only
/**
 * STOCK MOVED BETWEEN TWO PLACES.
 *
 * A transfer line posts an out and an in that belong together: one place
 * goes down, the other up, and the item's total does not move. Undone, the
 * pair is written again the other way round.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LEGS } from '../../invoicing-install.helpers.js';
import { builtAddOn, installBuilt, writing, type Writing } from '../harness.js';
import { item, movementsOf, n, notes, opening, place, pointOf, said } from './world.js';

const inventory = builtAddOn('inventory');

describe.each(LEGS)('transfers — %s', (dialect, available) => {
  const run = available && inventory !== null;
  let w: Writing;
  let laundry: number;
  let store: number;
  let towel: number;
  beforeAll(async () => {
    if (!run) return;
    w = await writing(await installBuilt(dialect, inventory));
    laundry = await place(w, 'At the laundry', { for_sale: false });
    store = await place(w, 'Linen store', { for_sale: false });
    towel = await item(w, 'Bath towel');
    await opening(w, laundry, [{ item_id: towel, qty_typed: 24, unit_cost: 6 }]);
    await opening(w, store, [{ item_id: towel, qty_typed: 236, unit_cost: 6 }]);
  }, 240_000);
  afterAll(async () => {
    if (run) await w.h.close();
  });

  it.skipIf(!run)('24 bath towels come back and the item\'s total does not move', async () => {
    const transfer = n((await w.create('transfers', { from_place_id: laundry, to_place_id: store })).row['id']);
    const line = n((await w.create('transfer_lines', { transfer_id: transfer, item_id: towel, qty: 24 })).row['id']);
    await w.update('transfers', transfer, { status: 'posting' });
    const moved = await w.update('transfer_lines', line, { status: 'posted' });
    expect(moved.posted.map(said)).toEqual(['stock transfer post planned']);
    await w.update('transfers', transfer, { status: 'done' });
    expect([n((await pointOf(w, towel, laundry))['on_hand']), n((await pointOf(w, towel, store))['on_hand'])]).toEqual([0, 260]);
    expect(n((await w.one('items', towel))['on_hand'])).toBe(260);
    // The two halves belong together: the in names the out.
    const rows = await w.rowsOf('movements', `item_id = ${String(towel)} and kind in ('moved_out', 'moved_in') order by id`);
    expect(rows.map((row) => `${String(row['kind'])} ${String(n(row['qty']))}`)).toEqual(['moved_out -24', 'moved_in 24']);
    expect(String(rows[1]?.['pair_id'])).toBe(String(rows[0]?.['id']));

    // Undone by a stock manager: the pair is written again the other way round.
    await w.update('transfers', transfer, { status: 'reversing' });
    const back = await w.update('transfer_lines', line, { status: 'reversed' });
    expect(back.posted.map(said)).toEqual(['stock transfer reverse planned']);
    await w.update('transfers', transfer, { status: 'reversed' });
    expect([n((await pointOf(w, towel, laundry))['on_hand']), n((await pointOf(w, towel, store))['on_hand'])]).toEqual([24, 236]);
    expect(n((await w.one('items', towel))['on_hand'])).toBe(260);
    expect((await movementsOf(w, towel)).slice(-2).sort()).toEqual(['moved_in -24', 'moved_out 24'].sort());
  });

  it.skipIf(!run)('more than the books hold is moved and told, never refused', async () => {
    const transfer = n((await w.create('transfers', { from_place_id: laundry, to_place_id: store })).row['id']);
    const line = n((await w.create('transfer_lines', { transfer_id: transfer, item_id: towel, qty: 30 })).row['id']);
    await w.update('transfers', transfer, { status: 'posting' });
    const moved = await w.update('transfer_lines', line, { status: 'posted' });
    expect(notes(moved)).toContain('short');
    expect([n((await pointOf(w, towel, laundry))['on_hand']), n((await pointOf(w, towel, store))['on_hand'])]).toEqual([-6, 266]);
  });

  it.skipIf(!run)('one place twice is refused', async () => {
    const made = w.create('transfers', { from_place_id: store, to_place_id: store }).then(async (saved) => {
      const transfer = n(saved.row['id']);
      const line = n((await w.create('transfer_lines', { transfer_id: transfer, item_id: towel, qty: 1 })).row['id']);
      await w.update('transfers', transfer, { status: 'posting' });
      return w.update('transfer_lines', line, { status: 'posted' });
    });
    await expect(made).rejects.toMatchObject({ code: 'POSTING_REFUSED', details: { reason: 'not-allowed' } });
  });
});
