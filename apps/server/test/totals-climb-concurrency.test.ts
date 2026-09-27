// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Totals that climb, under writers that race: options added and removed on
 * the lines of five orders, lines added to them, and whole orders written for
 * the same customer at once — each write either lands or is told to try again
 * (409 `WRITE_CONFLICT`), never a server error and never a lost total. Every
 * stored total then equals what its rows add up to. Postgres and MySQL (run
 * once more with one pooled connection, and against Postgres 18).
 */
import { rollupValue } from '@adminium/manifest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppError } from '../src/errors.js';
import { isWriteConflict } from '../src/crud/db-errors.js';
import { installInvoicing, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { cents, MENU, orderManifest, orderTree, writeTree } from './order-tree-fixture.js';

/** A write, tried again while it is told the rows moved under it. */
async function retried<T>(write: () => Promise<T>, conflicts: { n: number }): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await write();
    } catch (error) {
      const retry = isWriteConflict(error) || (error instanceof AppError && ['WRITE_CONFLICT', 'NUMBER_BUSY', 'CAPACITY_BUSY'].includes(error.code));
      if (!retry || attempt >= 8) throw error;
      conflicts.n += 1;
    }
  }
}

describe.each(LEGS.filter(([dialect]) => dialect !== 'sqlite'))('totals that climb, raced — %s', (dialect, available) => {
  let h: InvoicingHarness | undefined;
  let w: Awaited<ReturnType<typeof writerFor>>;
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, orderManifest());
    for (const statement of MENU) await h.rows(statement);
    await h.rows(`INSERT INTO ${h.real('customers')} (id, email) VALUES (2, 'bo@example.com')`);
    w = await writerFor(h);
  }, 180_000);
  afterAll(async () => h?.close());

  /** Every stored total against what its rows add up to. */
  const consistent = async () => {
    const options = await h!.rows(`select order_item_id, price from ${h!.real('order_item_modifiers')}`);
    for (const line of await h!.rows(`select * from ${h!.real('order_items')}`)) {
      const mine = options.filter((option) => String(option['order_item_id']) === String(line['id']));
      expect(cents(line['options_total'])).toBe(rollupValue(mine, { sum: 'price' }, 2));
      expect(cents(line['line_total'])).toBe(((Number(line['unit_price']) + Number(line['options_total'])) * Number(line['qty'])).toFixed(2));
    }
    const lines = await h!.rows(`select order_id, line_total, removed from ${h!.real('order_items')}`);
    for (const order of await h!.rows(`select * from ${h!.real('orders')}`)) {
      const mine = lines.filter((line) => String(line['order_id']) === String(order['id']) && !(line['removed'] === true || Number(line['removed']) === 1));
      expect(cents(order['subtotal'])).toBe(rollupValue(mine, { sum: 'line_total' }, 2));
      expect(Number(order['item_count'])).toBe(mine.length);
    }
    const orders = await h!.rows(`select customer_id, total from ${h!.real('orders')}`);
    for (const person of await h!.rows(`select * from ${h!.real('customers')}`)) {
      const mine = orders.filter((order) => String(order['customer_id']) === String(person['id']));
      expect(cents(person['lifetime'] ?? 0)).toBe(rollupValue(mine, { sum: 'total' }, 2));
    }
  };

  it.runIf(available)('twenty option writes and ten new lines across five orders: every one lands or is retried, and every total adds up', async () => {
    const orders = [];
    for (let i = 0; i < 5; i += 1) orders.push(await writeTree(w, orderTree(w, [{ item: 1, mods: [1] }, { item: 2 }], { email: 'ada@example.com', name: 'Ada', customer_id: (i % 2) + 1 })));
    const lines = orders.flatMap((order) => order.rows.filter((row) => row.node.name === 'order_items').map((row) => row.record));
    const conflicts = { n: 0 };
    const writes: Promise<unknown>[] = [];
    for (let i = 0; i < 20; i += 1) {
      const line = lines[i % lines.length]!;
      const modifier = String(line['menu_item_id']) === '1' ? 2 : 3 + (i % 3);
      writes.push(retried(() => w.create('order_item_modifiers', { order_item_id: line['id'], modifier_id: modifier }), conflicts));
    }
    for (let i = 0; i < 10; i += 1) {
      writes.push(retried(() => w.create('order_items', { order_id: orders[i % 5]!.root['id'], menu_item_id: 4, qty: 1 + (i % 3) }), conflicts));
    }
    const results = await Promise.allSettled(writes);
    expect(results.filter((result) => result.status === 'rejected').map((result) => String((result as PromiseRejectedResult).reason))).toEqual([]);
    await consistent();
  }, 120_000);

  it.runIf(available)("orders written at once for one customer, while a line of that customer's other order changes: each lands, and the lifetime adds up", async () => {
    const standing = await writeTree(w, orderTree(w, [{ item: 2, mods: [3] }], { email: 'bo@example.com', name: 'Bo', customer_id: 2 }));
    const line = standing.rows[1]!.record;
    const conflicts = { n: 0 };
    const writes: Promise<unknown>[] = [];
    for (let i = 0; i < 10; i += 1) {
      writes.push(retried(() => writeTree(w, orderTree(w, [{ item: 1, mods: [i % 2 === 0 ? 1 : 2] }, { item: 4, qty: 1 + (i % 4) }], { email: 'bo@example.com', name: 'Bo', customer_id: 2 })), conflicts));
      writes.push(retried(() => w.update('order_items', line['id'], { qty: 1 + (i % 5) }), conflicts));
    }
    const results = await Promise.allSettled(writes);
    expect(results.filter((result) => result.status === 'rejected').map((result) => String((result as PromiseRejectedResult).reason))).toEqual([]);
    await consistent();
  }, 120_000);
});
