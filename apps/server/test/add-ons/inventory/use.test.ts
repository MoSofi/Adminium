// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT IS TAKEN, AND FROM WHICH BATCH.
 *
 * Stock is taken earliest expiry first, never from a batch that has expired,
 * and a batch with a name never goes below zero: what the books do not hold
 * is written on the place's unnamed level, where a count will find it. Staff
 * are not refused for stock; a batch they name by hand is held to what it is.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LEGS } from '../../invoicing-install.helpers.js';
import { builtAddOn, installBuilt, writing, type Writing } from '../harness.js';
import { inDays, item, levelOf, movementsOf, n, notes, opening, place, pointOf, yes } from './world.js';

const inventory = builtAddOn('inventory');

describe.each(LEGS)('taking stock from batches — %s', (dialect, available) => {
  const run = available && inventory !== null;
  let w: Writing;
  let room: number;
  let lidocaine: number;
  const qtyOf = async (batch: string | null) => n((await levelOf(w, lidocaine, room, batch))?.['qty'] ?? 0);
  beforeAll(async () => {
    if (!run) return;
    w = await writing(await installBuilt(dialect, inventory));
    room = await place(w, 'Treatment room');
    lidocaine = await item(w, 'Lidocaine 1% ampoule', { tracks_batches: true });
    await opening(w, room, [
      // Loaded in the other order on purpose: the earlier expiry is the second line.
      { item_id: lidocaine, qty_typed: 50, unit_cost: 1.1, batch_code: 'LD201', expires_on: inDays(200) },
      { item_id: lidocaine, qty_typed: 14, unit_cost: 1.1, batch_code: 'LD118', expires_on: inDays(13) },
    ]);
  }, 240_000);
  afterAll(async () => {
    if (run) await w.h.close();
  });

  it.skipIf(!run)('use 20: 14 from the batch that expires first, 6 from the next', async () => {
    await w.create('uses', { item_id: lidocaine, qty: 20, place_id: room });
    expect([await qtyOf('LD118'), await qtyOf('LD201')]).toEqual([0, 44]);
    expect((await movementsOf(w, lidocaine)).slice(-2)).toEqual(['used -14', 'used -6']);
    expect(n((await pointOf(w, lidocaine, room))['on_hand'])).toBe(44);
  });

  it.skipIf(!run)('a named batch never goes below zero: what it does not hold goes on the unnamed level, and the place is to be counted', async () => {
    const batch = (await w.rowsOf('batches', `item_id = ${String(lidocaine)} and code = 'LD201'`))[0];
    const used = await w.create('uses', { item_id: lidocaine, qty: 50, place_id: room });
    expect(notes(used)).toContain('short');
    expect(await qtyOf('LD201')).toBe(0);
    expect(await qtyOf(null)).toBe(-6);
    const at = await pointOf(w, lidocaine, room);
    expect(n(at['on_hand'])).toBe(-6);
    expect(yes(at['needs_count'])).toBe(true);
    // Named by hand, a batch is taken from as far as it goes; the rest is on the unnamed level, never below zero on the named one.
    const named = await w.create('uses', { item_id: lidocaine, qty: 1, place_id: room, batch_id: batch?.['id'] });
    expect(notes(named)).toEqual(expect.arrayContaining(['short', 'batch-unknown']));
    expect(await qtyOf(null)).toBe(-7);
    expect(await qtyOf('LD201')).toBe(0);
  });

  it.skipIf(!run)('an expired batch is passed over for a use, refused when named, and taken for a write-off', async () => {
    // An opening load takes a batch that has already expired: it is on the shelf, whatever its date.
    await opening(w, room, [
      { item_id: lidocaine, qty_typed: 5, unit_cost: 1.1, batch_code: 'OLD1', expires_on: inDays(-2) },
      { item_id: lidocaine, qty_typed: 5, unit_cost: 1.1, batch_code: 'NEW1', expires_on: inDays(90) },
    ]);
    await w.create('uses', { item_id: lidocaine, qty: 1, place_id: room });
    expect([await qtyOf('OLD1'), await qtyOf('NEW1')]).toEqual([5, 4]);
    const old = (await w.rowsOf('batches', `item_id = ${String(lidocaine)} and code = 'OLD1'`))[0];
    await expect(w.create('uses', { item_id: lidocaine, qty: 1, place_id: room, batch_id: old?.['id'] })).rejects.toMatchObject({ code: 'POSTING_REFUSED', details: { reason: 'expired' } });
    const reason = (await w.rowsOf('reasons')).find((row) => row['for'] === 'write_off');
    await w.create('uses', { item_id: lidocaine, qty: 5, place_id: room, batch_id: old?.['id'], kind: 'written_off', reason_id: reason?.['id'] });
    expect(await qtyOf('OLD1')).toBe(0);
    expect((await movementsOf(w, lidocaine)).at(-1)).toBe('written_off -5');
  });

  it.skipIf(!run)('a delivery of a batch that has already expired is refused', async () => {
    const receipt = n((await w.create('receipts', { place_id: room })).row['id']);
    const line = n((await w.create('receipt_lines', { receipt_id: receipt, item_id: lidocaine, qty_typed: 5, unit_cost: 1.1, batch_code: 'LATE', expires_on: inDays(-1) })).row['id']);
    await w.update('receipts', receipt, { status: 'posting' });
    await expect(w.update('receipt_lines', line, { status: 'posted' })).rejects.toMatchObject({ code: 'POSTING_REFUSED', details: { reason: 'expired' } });
  });
});
