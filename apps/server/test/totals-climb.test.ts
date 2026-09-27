// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Totals over totals: an option's price into its line, the line's amount into
 * the order, the order's total into the customer's lifetime. Every door that
 * writes a row settles the whole chain in the same write — a change, a
 * delete, a line moved to another order, bulk, an import's fast path, an
 * undo — bottom-up; a count of rows; and sums SQLite adds exactly, as
 * Postgres and MySQL do. On every engine.
 */
import { rollupValue } from '@adminium/manifest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ForbiddenError } from '../src/errors.js';
import { createWriteService, deleteRows, insertRows, updateRows } from '../src/crud/write-service.js';
import { writeStores } from '../src/crud/write-stores.js';
import { fetchByPk } from '../src/crud/records.js';
import { installInvoicing, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { cents, MENU, orderManifest, orderTree, writeTree } from './order-tree-fixture.js';

describe.each(LEGS)('totals that climb — %s', (dialect, available) => {
  let h: InvoicingHarness | undefined;
  let w: Awaited<ReturnType<typeof writerFor>>;
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, orderManifest());
    for (const statement of MENU) await h.rows(statement);
    await h.rows(`INSERT INTO ${h.real('customers')} (id, email) VALUES (2, 'bo@example.com'), (3, 'cy@example.com')`);
    w = await writerFor(h);
  }, 180_000);
  afterAll(async () => h?.close());

  /** The stored figures of an order and of its customer, as text. */
  const figures = async (orderId: unknown, customer = 1) => {
    const [order] = await h!.rows(`select subtotal, item_count, tax, total from ${h!.real('orders')} where id = ${String(orderId)}`);
    const [person] = await h!.rows(`select lifetime from ${h!.real('customers')} where id = ${String(customer)}`);
    return { subtotal: cents(order!['subtotal']), count: Number(order!['item_count']), tax: cents(order!['tax']), total: cents(order!['total']), lifetime: cents(person!['lifetime']) };
  };
  /** What the customer's orders really add up to, worked out from the rows. */
  const lifetimeOf = async (customer: number) => rollupValue(await h!.rows(`select total from ${h!.real('orders')} where customer_id = ${String(customer)}`), { sum: 'total' }, 2);

  it.runIf(available)("an option's new choice re-settles its line, the order and the customer in one write", async () => {
    const { root, rows } = await writeTree(w, orderTree(w, [{ item: 1, mods: [1] }, { item: 4, qty: 2 }], { email: 'bo@example.com', name: 'Bo', customer_id: 2 }));
    expect(await figures(root['id'], 2)).toMatchObject({ subtotal: '16.00', total: '17.32', lifetime: '17.32' });
    const option = rows.find((row) => row.node.name === 'order_item_modifiers')!.record;
    // Small → Large: the option's price is copied again from the new choice, $4 more.
    await w.update('order_item_modifiers', option['id'], { modifier_id: 2 });
    expect(await figures(root['id'], 2)).toEqual({ subtotal: '20.00', count: 2, tax: '1.65', total: '21.65', lifetime: '21.65' });
    // And deleting it takes the $4 off all the way up.
    await w.writes.delete({ target: w.targetOf('order_item_modifiers'), pk: { id: option['id'] }, context: w.desk, announce: async () => {} });
    expect(await figures(root['id'], 2)).toEqual({ subtotal: '16.00', count: 2, tax: '1.32', total: '17.32', lifetime: '17.32' });
  });

  it.runIf(available)('a line moved to another order settles both, and both customers', async () => {
    const a = await writeTree(w, orderTree(w, [{ item: 2, mods: [3] }, { item: 4 }], { email: 'bo@example.com', name: 'Bo', customer_id: 2 }));
    const b = await writeTree(w, orderTree(w, [{ item: 4 }], { email: 'cy@example.com', name: 'Cy', customer_id: 3 }));
    const salad = a.rows.find((row) => row.node.at.join('.') === 'order_items.0')!.record;
    await w.update('order_items', salad['id'], { order_id: b.root['id'] });
    expect(await figures(a.root['id'], 2)).toMatchObject({ subtotal: '2.00', count: 1 });
    expect(await figures(b.root['id'], 3)).toMatchObject({ subtotal: '12.50', count: 2 });
    expect((await figures(a.root['id'], 2)).lifetime).toBe(await lifetimeOf(2));
    expect((await figures(b.root['id'], 3)).lifetime).toBe(await lifetimeOf(3));
  });

  it.runIf(available)('counts rows, leaving out the ones marked removed', async () => {
    const { root, rows } = await writeTree(w, orderTree(w, [{ item: 4 }, { item: 4 }, { item: 4 }]));
    expect((await figures(root['id'])).count).toBe(3);
    await w.update('order_items', rows[1]!.record['id'], { removed: true });
    expect(await figures(root['id'])).toMatchObject({ count: 2, subtotal: '4.00' });
  });

  it.runIf(available)('bulk, an import and an undo climb too', async () => {
    const { root, rows } = await writeTree(w, orderTree(w, [{ item: 1, mods: [1] }], { email: 'cy@example.com', name: 'Cy', customer_id: 3 }));
    const line = rows[1]!.record;
    const lineTarget = w.targetOf('order_items');
    // Bulk: rows prepared before the transaction, written in it, settled after it. (A line's quantity
    // takes from its dish's stock, so bulk may not change it; a second line marked removed moves the totals.)
    await w.update('order_items', line['id'], { qty: 3 });
    const extra = await w.create('order_items', { order_id: root['id'], menu_item_id: 4, qty: 1 });
    expect(await figures(root['id'], 3)).toMatchObject({ subtotal: '38.00', total: '41.14' });
    const [prepared] = await w.writes.beforeEach('update', lineTarget, w.desk, [{ match: { id: extra['id'] }, values: { removed: true } }]);
    await w.writes.transaction(lineTarget, [], (db) => updateRows(db, dialect, lineTarget.table, prepared!.values, { id: extra['id'] }));
    const after = (await fetchByPk(lineTarget.db, lineTarget.table, { id: extra['id'] }))!;
    await w.writes.afterEach('update', lineTarget, w.desk, [{ record: after, before: extra }]);
    expect(await figures(root['id'], 3)).toMatchObject({ subtotal: '36.00', total: '38.97' });
    expect((await figures(root['id'], 3)).lifetime).toBe(await lifetimeOf(3));
    // An import's fast path: checked, written in one statement, then settled.
    const optionTarget = w.targetOf('order_item_modifiers');
    const checked = await w.writes.check('create', optionTarget, { ...w.desk, origin: 'import' }, [{ order_item_id: line['id'], modifier_id: 2, price: 4 }]);
    await insertRows(optionTarget.db, dialect, optionTarget.table, checked.rows.map((row) => row!));
    const [option] = await h!.rows(`select * from ${h!.real('order_item_modifiers')} where order_item_id = ${String(line['id'])} and modifier_id = 2`);
    await w.writes.settle('create', optionTarget, [{ record: option!, before: null }]);
    // Three Margheritas, each with a Small and a Large now: (12 + 0 + 4) × 3.
    expect(await figures(root['id'], 3)).toMatchObject({ subtotal: '48.00', total: '51.96' });
    // An undo of that import: the row goes, then what it fed is settled again.
    await deleteRows(optionTarget.db, optionTarget.table, { id: option!['id'] });
    await w.writes.settle('delete', optionTarget, [{ record: option!, before: null }]);
    expect(await figures(root['id'], 3)).toMatchObject({ subtotal: '36.00', total: '38.97' });
    expect((await figures(root['id'], 3)).lifetime).toBe(await lifetimeOf(3));
  });

  it.runIf(available)('adds quantity times rate exactly: 1.500 × 0.33 is 0.50 on every engine', async () => {
    await h!.rows(`INSERT INTO ${h!.real('tallies')} (id) VALUES (1), (2)`);
    await w.create('tally_lines', { tally_id: 1, qty: '1.500', rate: '0.33' });
    const [first] = await h!.rows(`select total from ${h!.real('tallies')} where id = 1`);
    expect(cents(first!['total'])).toBe('0.50');
    // A thousand lines at three places by four, against the exact sum.
    let seed = 7;
    const next = () => (seed = (seed * 48_271) % 2_147_483_647);
    const lines: { qty: string; rate: string }[] = [];
    for (let i = 0; i < 200; i += 1) lines.push({ qty: (next() % 20_000 / 1000).toFixed(3), rate: (next() % 100_000 / 10_000).toFixed(4) });
    const target = w.targetOf('tally_lines');
    const checked = await w.writes.check('create', target, { ...w.desk, origin: 'import' }, lines.map((line) => ({ tally_id: 2, ...line })));
    await insertRows(target.db, dialect, target.table, checked.rows.map((row) => row!));
    await w.writes.settle('create', target, [{ record: { tally_id: 2 }, before: null }]);
    const [second] = await h!.rows(`select total from ${h!.real('tallies')} where id = 2`);
    expect(cents(second!['total'])).toBe(rollupValue(lines, { sum: 'qty', times: 'rate' }, 2));
  });

  it.runIf(available)("refuses, by name, a total the connection's role may not write — before anything is written", async () => {
    const orders = w.targetOf('orders').table.id;
    const writes = createWriteService({
      ...writeStores(h!.meta),
      rights: async (_connection, table) => (table === orders ? { insert: true, update: true, delete: true, columns: { subtotal: { insert: true, update: false } } } : null),
    });
    const { root } = await writeTree(w, orderTree(w, [{ item: 4 }]));
    const before = await h!.rows(`select count(*) as n from ${h!.real('order_items')}`);
    const refused = await writes
      .create({ target: w.targetOf('order_items'), values: { order_id: root['id'], menu_item_id: 4, qty: 1 }, context: w.desk, announce: async () => {} })
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ForbiddenError);
    expect(refused).toMatchObject({ code: 'READ_ONLY_MODE', details: { table: orders, columns: ['subtotal'], reason: 'privileges' } });
    expect(await h!.rows(`select count(*) as n from ${h!.real('order_items')}`)).toEqual(before);
  });
});
