// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A create with its child rows, through the write service: an order, its
 * lines and each line's options written as one — every row or none — with
 * their totals settled bottom-up, climbing into the customer three rows
 * above the options; and a quote of it, which writes nothing, holds nothing
 * and takes no number. On every engine.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { TreeOutcome } from '../src/crud/write-tree.js';
import { installInvoicing, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { cents, MENU, orderManifest, orderTree, writeTree, type Writer } from './order-tree-fixture.js';

/** Rows in every table the tree writes, and the order numbers taken. */
async function counts(h: InvoicingHarness): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const ref of ['orders', 'order_items', 'order_item_modifiers']) {
    out[ref] = Number((await h.rows(`select count(*) as n from ${h.real(ref)}`))[0]!['n']);
  }
  out['top'] = Number((await h.rows(`select coalesce(max(number), 0) as n from ${h.real('orders')}`))[0]!['n']);
  return out;
}

describe.each(LEGS)('a create with its child rows — %s', (dialect, available) => {
  let h: InvoicingHarness | undefined;
  let w: Writer;
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, orderManifest());
    for (const statement of MENU) await h.rows(statement);
    w = await writerFor(h);
  }, 180_000);
  afterAll(async () => h?.close());

  it.runIf(available)('writes an order of three lines and five options as one, settled bottom-up and climbing to the customer', async () => {
    const lifetime = cents((await h!.rows(`select lifetime from ${h!.real('customers')} where id = 1`))[0]!['lifetime']) ?? '0.00';
    const outcome = await writeTree(w, orderTree(w, [{ item: 1, mods: [2] }, { item: 2, qty: 2, mods: [3, 4, 5] }, { item: 1, mods: [1] }]));
    expect(outcome.replayed).toBe(false);
    expect(outcome.rows.map((row) => row.node.at)).toEqual([
      [],
      ['order_items', 0],
      ['order_items', 1],
      ['order_items', 2],
      ['order_items', 0, 'order_item_modifiers', 0],
      ['order_items', 1, 'order_item_modifiers', 0],
      ['order_items', 1, 'order_item_modifiers', 1],
      ['order_items', 1, 'order_item_modifiers', 2],
      ['order_items', 2, 'order_item_modifiers', 0],
    ]);
    const orderId = outcome.root['id'];
    const lines = await h!.rows(`select position, unit_price, options_total, line_total from ${h!.real('order_items')} where order_id = ${String(orderId)} order by position`);
    expect(lines.map((line) => [Number(line['position']), cents(line['unit_price']), cents(line['options_total']), cents(line['line_total'])])).toEqual([
      [1, '12.00', '4.00', '16.00'],
      [2, '9.00', '4.50', '27.00'],
      [3, '12.00', '0.00', '12.00'],
    ]);
    const [order] = await h!.rows(`select subtotal, item_count, tax, total, number from ${h!.real('orders')} where id = ${String(orderId)}`);
    // 16 + 27 + 12 = 55.00; 8.25 % of it is 4.5375, rounded once: 4.54.
    expect([cents(order!['subtotal']), Number(order!['item_count']), cents(order!['tax']), cents(order!['total'])]).toEqual(['55.00', 3, '4.54', '59.54']);
    expect(Number(order!['number'])).toBeGreaterThan(0);
    // What the reply hands back is the row as its totals left it.
    expect(cents(outcome.root['total'])).toBe('59.54');
    expect(cents(outcome.rows[2]!.record['line_total'])).toBe('27.00');
    // Three rows up from each option: the customer's lifetime took the order's total.
    const after = cents((await h!.rows(`select lifetime from ${h!.real('customers')} where id = 1`))[0]!['lifetime']);
    expect(Number(after) - Number(lifetime)).toBeCloseTo(59.54, 2);
  });

  it.runIf(available)('works tax out once from the subtotal: $62.00, $66.00 and $146.00', async () => {
    const figures: string[][] = [];
    for (const lines of [
      [{ item: 1, qty: 2, mods: [2] }, { item: 2, qty: 2, mods: [3, 4] }, { item: 4, qty: 3 }],
      [{ item: 1, qty: 2, mods: [2] }, { item: 2, qty: 2, mods: [3, 4] }, { item: 4, qty: 5 }],
      [{ item: 1, qty: 5, mods: [2] }, { item: 2, qty: 4, mods: [3, 4] }, { item: 4, qty: 9 }],
    ]) {
      const { root } = await writeTree(w, orderTree(w, lines));
      figures.push([cents(root['subtotal'])!, cents(root['tax'])!, cents(root['total'])!]);
    }
    expect(figures).toEqual([
      ['62.00', '5.12', '67.12'],
      ['66.00', '5.45', '71.45'],
      ['146.00', '12.05', '158.05'],
    ]);
  });

  it.runIf(available)('a tree refused at its third line writes nothing, and takes no number', async () => {
    const before = await counts(h!);
    // A line for a dish that is not there: the third row's INSERT fails, after the root and two lines went in.
    const refused = await writeTree(w, orderTree(w, [{ item: 1, mods: [2] }, { item: 2 }, { item: 999 }])).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(Error);
    expect(await counts(h!)).toEqual(before);
    // A refusal of a grandchild, too.
    const deep = await writeTree(w, orderTree(w, [{ item: 1, mods: [2] }, { item: 2, mods: [3, 999] }])).catch((error: unknown) => error);
    expect(deep).toBeInstanceOf(Error);
    expect(await counts(h!)).toEqual(before);
  });

  it.runIf(available)('names the refused row by its place in the tree', async () => {
    const paths: unknown[] = [];
    await w.writes
      .createTree({
        root: orderTree(w, [{ item: 1 }, { item: 2, qty: 50 }]),
        context: w.desk,
        mode: 'save',
        announce: async () => {},
        mapError: (error, at) => {
          paths.push(at);
          throw error;
        },
      })
      .catch(() => undefined);
    expect(paths).toEqual([['order_items', 1]]);
  });

  it.runIf(available)('a quote works out every figure a save would, and leaves nothing behind', async () => {
    const lines = [{ item: 1, qty: 2, mods: [2] }, { item: 2, qty: 2, mods: [3, 4] }, { item: 4, qty: 3 }];
    const before = await counts(h!);
    const quote = await writeTree(w, orderTree(w, lines), 'dry');
    expect(quote.mode).toBe('dry');
    expect(await counts(h!)).toEqual(before);
    const saved = await writeTree(w, orderTree(w, lines));
    const figures = (outcome: TreeOutcome) =>
      outcome.rows.map((row) => [row.node.at.join('.'), cents(row.record['line_total'] ?? row.record['total'] ?? row.record['price']), cents(row.record['options_total'])]);
    expect(figures(quote)).toEqual(figures(saved));
    expect([cents(quote.root['subtotal']), cents(quote.root['tax']), cents(quote.root['total'])]).toEqual(['62.00', '5.12', '67.12']);
    // A quote takes no number: the saved order took the next one after the last save's.
    expect(quote.root['number'] ?? null).toBeNull();
    expect(Number(saved.root['number'])).toBe(before['top']! + 1);
  });

  it.runIf(available)('a quote runs no before hook and announces nothing; a save announces root first, then each level', async () => {
    const announced: string[] = [];
    await writeTree(w, orderTree(w, [{ item: 1, mods: [1] }, { item: 4 }]), 'dry', w.desk, { announce: async (row) => void announced.push(row.node.at.join('.')) });
    expect(announced).toEqual([]);
    await writeTree(w, orderTree(w, [{ item: 1, mods: [1] }, { item: 4 }]), 'save', w.desk, { announce: async (row) => void announced.push(row.node.at.join('.')) });
    expect(announced).toEqual(['', 'order_items.0', 'order_items.1', 'order_items.0.order_item_modifiers.0']);
  });

  it.runIf(available)('judges each child list once written, an empty one too', async () => {
    const seen: string[] = [];
    await writeTree(w, orderTree(w, [{ item: 1, mods: [2] }, { item: 4 }]), 'save', w.desk, {
      siblings: async (_db, parent, name, rows) => void seen.push(`${parent.node.at.join('.') || 'root'}:${name}:${String(rows.length)}`),
    });
    expect(seen).toEqual(['root:order_items:2', 'order_items.0:order_item_modifiers:1', 'order_items.1:order_item_modifiers:0']);
  });

  it.runIf(available)('a price the caller did not expect refuses the save and writes nothing', async () => {
    const before = await counts(h!);
    const refused = await writeTree(w, orderTree(w, [{ item: 1, qty: 2, mods: [2] }]), 'save', w.desk, {
      expect: async (_db, root) => {
        if (cents(root['total']) !== '30.00') throw new Error(`price changed: ${String(cents(root['total']))}`);
      },
    }).catch((error: unknown) => error);
    expect(String(refused)).toContain('price changed: 34.64');
    expect(await counts(h!)).toEqual(before);
  });
});
