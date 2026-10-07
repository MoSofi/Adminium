// SPDX-License-Identifier: AGPL-3.0-only
/**
 * LOW, TO REORDER AND STATE — the three figures a list filters by and a rule
 * hears. Each is a whole number on every database, worked out from yes/no
 * columns among others: a yes that one engine stores as 1 and another as
 * true must read the same.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LEGS } from '../../invoicing-install.helpers.js';
import { builtAddOn, installBuilt, writing, type Writing } from '../harness.js';
import { item, n, opening, place, pointOf } from './world.js';

const inventory = builtAddOn('inventory');

describe.each(LEGS)('the flags of a stock point — %s', (dialect, available) => {
  const run = available && inventory !== null;
  let w: Writing;
  let floor: number;
  let tote: number;
  const flags = async () => {
    const at = await pointOf(w, tote, floor);
    return [at['low'], at['to_reorder'], at['state']].map((value) => (typeof value === 'boolean' ? `boolean ${String(value)}` : n(value)));
  };
  beforeAll(async () => {
    if (!run) return;
    w = await writing(await installBuilt(dialect, inventory));
    floor = await place(w, 'Shop floor');
    tote = await item(w, 'Canvas tote, natural');
    await opening(w, floor, [{ item_id: tote, qty_typed: 12, unit_cost: 3.1 }]);
  }, 240_000);
  afterAll(async () => {
    if (run) await w.h.close();
  });

  it.skipIf(!run)('low, to reorder and state agree on three engines', async () => {
    const point = (await pointOf(w, tote, floor))['id'];
    // No level set: never low.
    expect(await flags()).toEqual([0, 0, 0]);
    await w.update('stock_points', point, { reorder_level: 10 });
    expect(await flags()).toEqual([0, 0, 0]);
    await w.create('uses', { item_id: tote, qty: 8, place_id: floor, kind: 'sold' });
    expect(await flags()).toEqual([1, 1, 1]);
    // Paused: still low, nothing to reorder.
    await w.update('stock_points', point, { reorder_paused: true });
    expect(await flags()).toEqual([1, 0, 1]);
    await w.update('stock_points', point, { reorder_paused: false });
    expect(await flags()).toEqual([1, 1, 1]);
    // An item no longer active is not reordered.
    await w.update('items', tote, { active: false });
    expect(await flags()).toEqual([1, 0, 1]);
    await w.update('items', tote, { active: true });
    expect(await flags()).toEqual([1, 1, 1]);
    await w.create('uses', { item_id: tote, qty: 4, place_id: floor, kind: 'sold' });
    expect(await flags()).toEqual([1, 1, 3]);
  });
});
