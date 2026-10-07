// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A SHOP'S OWN TABLE, AND THE LAST FOUR ON THE SHELF.
 *
 * An owner's table takes from stock by a rule: each sale's row names what was
 * sold through a link Inventory keeps. A buyer on a public page is refused
 * what is not there — twenty buying one each of the last four get four —
 * while staff are never refused for stock. A refund puts one back.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LEGS } from '../../invoicing-install.helpers.js';
import { BUYER, builtAddOn, installBuilt, writing, type Writing } from '../harness.js';
import { item, movementsOf, n, notes, opening, place, pointOf } from './world.js';

const inventory = builtAddOn('inventory');
const into = (action: string) => ({ addOn: 'inventory', ledger: 'stock', action });
// A sale and a refund point at what was sold by a real link: that is what tells the rule which row it means.
// (A key written on its own line: MySQL 8.4 reads one written beside the column and keeps nothing of it.)
const HOSTS = {
  shop_products: { columns: 'name VARCHAR(80) NOT NULL', postings: [] },
  shop_sales: { columns: 'product_id INT NOT NULL, qty INT NOT NULL, FOREIGN KEY (product_id) REFERENCES shop_products(id)', postings: [{ id: 'stock-1', into: into('use'), post: { on: { create: true } }, map: { what: 'product_id', quantity: 'qty' } }] },
  shop_refunds: { columns: 'product_id INT NOT NULL, qty INT NOT NULL, FOREIGN KEY (product_id) REFERENCES shop_products(id)', postings: [{ id: 'stock-1', into: into('return'), post: { on: { create: true } }, map: { what: 'product_id', quantity: 'qty', to: { value: 'shelf' } } }] },
};

describe.each(LEGS)('an owner\'s table taking from stock — %s', (dialect, available) => {
  const run = available && inventory !== null;
  let w: Writing;
  let floor: number;
  let tote: number;
  let product: number;
  beforeAll(async () => {
    if (!run) return;
    w = await writing(await installBuilt(dialect, inventory, {}, HOSTS));
    floor = await place(w, 'Shop floor');
    tote = await item(w, 'Canvas tote, natural');
    await opening(w, floor, [{ item_id: tote, qty_typed: 4, unit_cost: 3.1 }]);
    await w.h.rows("INSERT INTO shop_products (name) VALUES ('Tote')");
    product = n((await w.h.rows('select id from shop_products'))[0]?.['id']);
    // What the Stock tab writes when an owner ties a row to an item: the row's table by its stored name, and its key.
    await w.create('links', { source_table: w.storedName('shop_products'), source_row: String(product), kind: 'item', item_id: tote, qty: 1 });
  }, 240_000);
  afterAll(async () => {
    if (run) await w.h.close();
  });

  it.skipIf(!run)('twenty public saves for the last four give four', async () => {
    const tried = await Promise.allSettled(Array.from({ length: 20 }, () => w.create('shop_sales', { product_id: product, qty: 1 }, BUYER)));
    const sold = tried.filter((one) => one.status === 'fulfilled');
    const refused = tried.filter((one): one is PromiseRejectedResult => one.status === 'rejected');
    expect(sold).toHaveLength(4);
    for (const one of refused) expect(one.reason).toMatchObject({ code: 'POSTING_REFUSED', details: { reason: 'out-of-stock' } });
    expect(n((await pointOf(w, tote, floor))['on_hand'])).toBe(0);
    expect((await w.h.rows('select count(*) as c from shop_sales'))[0]?.['c']).toSatisfy((count: unknown) => Number(count) === 4);
    expect((await movementsOf(w, tote)).filter((row) => row === 'sold -1' || row === 'used -1')).toHaveLength(4);
  });

  it.skipIf(!run)('a staff post goes through at zero and marks the point', async () => {
    const sold = await w.create('shop_sales', { product_id: product, qty: 1 });
    expect(notes(sold)).toContain('short');
    const at = await pointOf(w, tote, floor);
    expect(n(at['on_hand'])).toBe(-1);
    expect(at['needs_count'] === true || n(at['needs_count']) === 1).toBe(true);
  });

  it.skipIf(!run)('a refund line puts one back on the shelf', async () => {
    const before = n((await pointOf(w, tote, floor))['on_hand']);
    await w.create('shop_refunds', { product_id: product, qty: 1 });
    expect(n((await pointOf(w, tote, floor))['on_hand'])).toBe(before + 1);
    expect((await movementsOf(w, tote)).at(-1)).toBe('returned 1');
  });

  it.skipIf(!run)('a row with no link takes nothing, and says so', async () => {
    await w.h.rows("INSERT INTO shop_products (name) VALUES ('Sticker')");
    const other = n((await w.h.rows("select id from shop_products where name = 'Sticker'"))[0]?.['id']);
    const before = (await movementsOf(w, tote)).length;
    const sold = await w.create('shop_sales', { product_id: other, qty: 1 });
    expect(notes(sold)).toContain('not-linked');
    expect((await movementsOf(w, tote)).length).toBe(before);
  });
});
