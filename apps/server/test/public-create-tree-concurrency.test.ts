// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A create with its child rows under writers that race: twin retries of one
 * order made once, a quote that never holds a save back, the one transaction
 * a guarded write opens on MySQL, and — once the limit judge runs — twenty
 * checkouts for the last places selling exactly what is there. Postgres and
 * MySQL.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Row } from '../src/crud/mask.js';
import type { TreeNode } from '../src/crud/write-tree.js';
import { installInvoicing, invoicingManifest, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { cents, MENU, orderManifest, orderTree, writeTree } from './order-tree-fixture.js';

describe.each(LEGS.filter(([dialect]) => dialect !== 'sqlite'))('a create with its child rows, raced — %s', (dialect, available) => {
  let h: InvoicingHarness | undefined;
  let w: Awaited<ReturnType<typeof writerFor>>;
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, orderManifest());
    for (const statement of MENU) await h.rows(statement);
    w = await writerFor(h);
  }, 180_000);
  afterAll(async () => h?.close());

  it.runIf(available)('two saves with one retry key at once make one order, and both answer it', async () => {
    const key = `twin-${dialect}-0123456789abcdef`;
    const replay = async (db: Parameters<NonNullable<Parameters<typeof w.writes.createTree>[0]['replay']>>[0]) => {
      const found = (await db.selectFrom(w.targetOf('orders').table.id).selectAll().where(db.dynamic.ref('client_key'), '=', key as never).executeTakeFirst()) as Row | undefined;
      return found === undefined ? null : { root: found, rows: [] };
    };
    const both = await Promise.all(
      [0, 1].map(() => writeTree(w, orderTree(w, [{ item: 4, qty: 2 }], { email: 'ada@example.com', name: 'Ada', customer_id: 1, client_key: key }), 'save', w.desk, { replay })),
    );
    expect(both[0]!.root['id']).toBe(both[1]!.root['id']);
    expect(both.map((outcome) => outcome.replayed).sort()).toEqual([false, true]);
    expect(await h!.rows(`select id from ${h!.real('orders')} where client_key = '${key}'`)).toHaveLength(1);
  });

  it.runIf(available)('a quote held open never holds a save back', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const inside = new Promise<void>((resolve) => {
      entered = resolve;
    });
    // A quote that waits, inside its transaction, until the save is done: a guest's, as a public
    // quote is (for no one on file — a quote's foreign key would hold a customer's row shared, a
    // few milliseconds in real life, until it ends).
    const guest = { email: 'ada@example.com', name: 'Ada' };
    const quote = writeTree(w, orderTree(w, [{ item: 1, mods: [2] }, { item: 4 }], guest), 'dry', w.desk, {
      siblings: async () => {
        entered();
        await held;
      },
    });
    await inside;
    const started = Date.now();
    const saved = await writeTree(w, orderTree(w, [{ item: 1, mods: [2] }, { item: 4 }]));
    const took = Date.now() - started;
    release();
    const quoted = await quote;
    expect(took).toBeLessThan(1_000);
    expect(cents(quoted.root['total'])).toBe(cents(saved.root['total']));
  });

  it.runIf(available && dialect === 'mysql')("on MySQL a numbered tree opens its own transaction: inside a caller's it is refused", async () => {
    const { db } = await h!.manager.data(h!.connectionId);
    const refused = await db
      .transaction()
      .execute(async (trx) => {
        const root = orderTree(w, [{ item: 4 }]);
        const inside = (node: typeof root): typeof root => ({ ...node, target: { ...node.target, db: trx }, children: node.children.map(inside) });
        return writeTree(w, inside(root));
      })
      .catch((error: unknown) => error);
    expect(String(refused)).toContain('opens its own transaction');
  });

});

/** A box office: ticket types with a number of places, an order of tickets, each ticket taking one place of its type. */
function boxOfficeManifest(): Record<string, unknown> {
  const id = { ref: 'id', type: 'int', role: 'pk' };
  const manifest = invoicingManifest([
    { ref: 'ticket_types', columns: [id, { ref: 'name', type: 'text', maxLength: 60 }, { ref: 'price', type: 'decimal', scale: 2, default: 0 }, { ref: 'capacity', type: 'int', nullable: true }] },
    {
      ref: 'orders',
      columns: [
        id,
        { ref: 'email', type: 'text', maxLength: 254 },
        { ref: 'total', type: 'decimal', scale: 2, nullable: true, rules: { rollup: { from: 'tickets', via: 'order_id', sum: 'price' } } },
        { ref: 'ticket_count', type: 'int', nullable: true, rules: { rollup: { from: 'tickets', via: 'order_id', count: true } } },
      ],
    },
    {
      ref: 'tickets',
      columns: [
        id,
        { ref: 'order_id', type: 'fk', references: 'orders', index: true },
        { ref: 'ticket_type_id', type: 'fk', references: 'ticket_types', index: true },
        { ref: 'price', type: 'decimal', scale: 2, nullable: true, rules: { copy: { via: 'ticket_type_id', from: 'price' } } },
      ],
      capacity: { kind: 'parent', via: 'ticket_type_id', size: { column: 'capacity' } },
    },
  ]);
  manifest['key'] = 'box';
  (manifest['pages'] as { bindings: Record<string, string> }[])[0]!.bindings = { rows: 'orders' };
  return manifest;
}

describe.each(LEGS.filter(([dialect]) => dialect !== 'sqlite'))('the last places of a ticket type, raced — %s', (dialect, available) => {
  let h: InvoicingHarness | undefined;
  let w: Awaited<ReturnType<typeof writerFor>>;
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, boxOfficeManifest());
    await h.rows(`INSERT INTO ${h.real('ticket_types')} (id, name, price, capacity) VALUES (1, 'Standard', 45, 14)`);
    w = await writerFor(h);
  }, 180_000);
  afterAll(async () => h?.close());

  const checkout = (email: string): TreeNode => ({
    name: 'orders',
    target: w.targetOf('orders'),
    values: { email },
    at: [],
    lists: ['tickets'],
    children: [0, 1].map((index) => ({
      name: 'tickets',
      target: w.targetOf('tickets'),
      values: { ticket_type_id: 1 },
      via: { column: 'order_id', parentKey: 'id' },
      at: ['tickets', index],
      children: [],
    })),
  });

  it.runIf(available)('twenty checkouts of two tickets for the last fourteen places: exactly seven are sold, the rest told sold out', async () => {
    const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => writeTree(w, checkout(`buyer${String(i)}@example.com`))));
    const sold = results.filter((result) => result.status === 'fulfilled');
    const refused = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(sold).toHaveLength(7);
    expect(refused.map((result) => (result.reason as { code?: string }).code)).toEqual(Array.from({ length: 13 }, () => 'CAPACITY_FULL'));
    expect(Number((await h!.rows(`select count(*) as n from ${h!.real('tickets')}`))[0]!['n'])).toBe(14);
    // Each order counted its own two tickets once.
    for (const order of await h!.rows(`select ticket_count, total from ${h!.real('orders')}`)) {
      expect([Number(order['ticket_count']), cents(order['total'])]).toEqual([2, '90.00']);
    }
  }, 120_000);
});
