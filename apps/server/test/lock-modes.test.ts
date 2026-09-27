// SPDX-License-Identifier: AGPL-3.0-only
/**
 * On Postgres a write holds every row it keeps — a parent whose totals and
 * formulas it settles, a row it changes, the row its move moves too — FOR NO
 * KEY UPDATE, one mode per row: never first one mode and then a stronger one
 * over it (a writer that went in between with a row pointing at it would wait
 * for the second, which waits for it). So while such a write is under way a
 * new row pointing at those rows goes in, as the engine lets it beside a
 * change of their other columns:
 *
 *  - a line's change settles its order's subtotal, then the tax and total
 *    worked out from it: another line added to the order meanwhile goes in;
 *  - an order's money taken at the door pays it (an effect): another ticket
 *    added to the order meanwhile goes in.
 *
 * (MySQL has one lock for a row a write changes, and a new row's key check
 * waits for it; SQLite writes one transaction at a time.)
 */
import { sql } from 'kysely';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Row } from '../src/crud/mask.js';
import { door } from './effects-fixture.js';
import { installInvoicing, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { MENU, orderManifest, orderTree, writeTree } from './order-tree-fixture.js';

const postgres = LEGS.find(([dialect]) => dialect === 'postgres')![1];

/**
 * Whether `statement` goes in on its own connection within two seconds, rolled back after: 'in', or the engine's code.
 * The connection is from a pool of its own, so a pool of one stays the write's under way.
 */
async function goesIn(h: InvoicingHarness, statement: string): Promise<string> {
  const { db } = await (await h.twin()).manager.data(h.connectionId);
  try {
    await db.transaction().execute(async (trx) => {
      await sql`set local lock_timeout = '2s'`.execute(trx);
      await sql.raw(statement).execute(trx);
      throw new Error('rolled back');
    });
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    return code === undefined ? 'in' : String(code);
  }
  return 'in';
}

describe.runIf(postgres)('one lock mode for every row a write keeps — postgres', () => {
  afterEach(() => vi.useRealTimers());

  it("a line's change settles its order, and a line added meanwhile goes in", async () => {
    const h = await installInvoicing('postgres', orderManifest(false));
    try {
      for (const statement of MENU) await h.rows(statement);
      const w = await writerFor(h);
      const made = await writeTree(w, orderTree(w, [{ item: 4, qty: 1 }]));
      const line = made.rows.find((row) => row.node.at.length === 2)!.record;
      let meanwhile = '';
      const changed = await w.writes.update({
        target: w.targetOf('order_items'),
        pk: { id: line['id'] },
        values: { qty: 3 },
        context: w.desk,
        // Inside the change, its order settled (subtotal, tax, total): another line pointing at the order.
        inside: async () => {
          meanwhile = await goesIn(h, `insert into ${h.real('order_items')} (order_id, menu_item_id, qty) values (${String(made.root['id'])}, 4, 1)`);
        },
        announce: async () => {},
      });
      expect(changed.count).toBe(1);
      expect(meanwhile).toBe('in');
      expect(Number((await h.rows(`select total from ${h.real('orders')} where id = ${String(made.root['id'])}`))[0]!['total'])).toBeGreaterThan(6);
    } finally {
      await h.close();
    }
  }, 120_000);

  it("an order's money taken at the door pays it, and a ticket added meanwhile goes in", async () => {
    const h = await installInvoicing('postgres', door());
    try {
      const w = await writerFor(h, 'Europe/London');
      await w.create('settings', {});
      const event = await w.create('events', { name: 'Show' });
      const type = await w.create('ticket_types', { event_id: event['id'], capacity: 9 });
      const order = await w.create('orders', { event_id: event['id'] });
      await w.create('tickets', { order_id: order['id'], ticket_type_id: type['id'], price: 10 });
      await w.update('orders', order['id'], { status: 'door' });
      const money = await w.create('collections', { order_id: order['id'], amount: 10 });
      let meanwhile = '';
      const collected = await w.writes.update({
        target: w.targetOf('collections'),
        pk: { id: money['id'] },
        values: { status: 'taken' },
        context: w.desk,
        inside: async () => {
          meanwhile = await goesIn(h, `insert into ${h.real('tickets')} (order_id, ticket_type_id, price, status) values (${String(order['id'])}, ${String(type['id'])}, 5, 'valid')`);
        },
        announce: async () => {},
      });
      expect((collected.effects ?? []).map((effect) => (effect.after as Row | null)?.['status'])).toEqual(['paid']);
      expect(meanwhile).toBe('in');
    } finally {
      await h.close();
    }
  }, 120_000);
});
