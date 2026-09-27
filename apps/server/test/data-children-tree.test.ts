// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A staff form's record with its child rows and their rows — a phone order:
 * the order, its lines, each line's options — written as one through the data
 * routes, held to the agreements and counts the app declares for its guests,
 * quoted first when the desk asks, and undone as a whole. A table numbered
 * without gaps is never undone. On every engine.
 */
import { publicEndpointsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { installInvoicing, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { dataRoutesOver, type DataRoutes } from './invoicing-routes.helpers.js';
import { cents, MENU, orderPublicManifest } from './order-tree-fixture.js';

interface Line {
  item: number;
  qty?: number;
  mods?: number[];
}

describe.each(LEGS)('a staff form with its rows two levels down — %s', (dialect, available) => {
  for (const numbered of [false, true]) {
    describe(numbered ? 'orders numbered without gaps' : 'orders without a running number', () => {
      let h: InvoicingHarness | undefined;
      let r: DataRoutes;
      beforeAll(async () => {
        if (!available) return;
        h = await installInvoicing(dialect, orderPublicManifest(numbered));
        for (const statement of MENU) await h.rows(statement);
        r = await dataRoutesOver(h, dialect);
        // The app's guest entries, as this Adminium keeps them: a desk is held to what they declare.
        for (const row of await publicEndpointsRepo(h.meta).listByConnection(h.connectionId)) {
          await publicEndpointsRepo(r.t.meta).create({ connectionId: r.connectionId, ref: row.ref, origin: row.origin, definition: row.definition, managedBy: row.managedBy });
        }
      }, 180_000);
      afterAll(async () => {
        await r?.close();
        await h?.close();
      });

      /** The relation from a child table to its parent, by the child's link column. */
      const relation = (child: string, via: string, parent: string) => `fk:${r.table(child)}(${via})->${r.table(parent)}(id)`;
      const lineList = () => relation('order_items', 'order_id', 'orders');
      const options = () => relation('order_item_modifiers', 'order_item_id', 'order_items');
      const phoneOrder = (lines: readonly Line[]) => ({
        values: { email: 'ada@example.com', name: 'Ada' },
        children: {
          [relation('order_items', 'order_id', 'orders')]: lines.map((line) => ({
            values: { menu_item_id: line.item, qty: line.qty ?? 1 },
            ...(line.mods === undefined ? {} : { children: { [options()]: line.mods.map((modifier) => ({ values: { modifier_id: modifier } })) } }),
          })),
        },
      });
      const counts = async () => {
        const out: number[] = [];
        for (const ref of ['orders', 'order_items', 'order_item_modifiers']) out.push(Number((await h!.rows(`select count(*) as n from ${h!.real(ref)}`))[0]!['n']));
        return out;
      };

      it.runIf(available)('writes the order, its lines and their options in one save, settled', async () => {
        const res = await r.post('orders', phoneOrder([{ item: 1, qty: 2, mods: [2] }, { item: 2, qty: 2, mods: [3, 4] }, { item: 4, qty: 3 }]));
        expect(res.statusCode, res.body).toBe(201);
        const order = res.json<{ data: Record<string, unknown> }>().data;
        expect([cents(order['subtotal']), Number(order['item_count']), cents(order['tax']), cents(order['total'])]).toEqual(['62.00', 3, '5.12', '67.12']);
        const options = await h!.rows(
          `select o.price from ${h!.real('order_item_modifiers')} o join ${h!.real('order_items')} l on l.id = o.order_item_id where l.order_id = ${String(order['id'])} order by o.id`,
        );
        expect(options.map((option) => cents(option['price']))).toEqual(['4.00', '1.50', '1.50']);
      });

      it.runIf(available)("is held to the app's own agreements: an option of another dish, a size left out", async () => {
        const before = await counts();
        const other = await r.post('orders', phoneOrder([{ item: 1, mods: [3] }]));
        expect(other.statusCode, other.body).toBe(422);
        expect(other.json<{ error: { details: Record<string, unknown> } }>().error.details).toMatchObject({
          fields: { modifier_id: { code: 'not-offered' } },
          relation: options(),
          row: 0,
          under: { relation: lineList(), row: 0 },
        });
        const bare = await r.post('orders', phoneOrder([{ item: 4 }, { item: 1 }]));
        expect(bare.statusCode, bare.body).toBe(422);
        expect(bare.json<{ error: { details: Record<string, unknown> } }>().error.details).toMatchObject({ reason: 'too-few', group: 1, relation: lineList(), row: 1 });
        expect(await counts()).toEqual(before);
      });

      it.runIf(available)('a quote for the desk: every figure, nothing kept', async () => {
        const before = await counts();
        const res = await r.t.app.inject({
          method: 'POST',
          url: `/api/v1/data/${r.connectionId}/${r.table('orders')}/dry-run`,
          headers: (await import('./connections-helpers.js')).asUser(r.t.users.admin),
          payload: phoneOrder([{ item: 1, qty: 2, mods: [2] }, { item: 4, qty: 3 }]),
        });
        expect(res.statusCode, res.body).toBe(200);
        const quote = res.json<{ data: Record<string, unknown>; children: Record<string, { data: Record<string, unknown>; children?: Record<string, { data: Record<string, unknown> }[]> }[]> }>();
        expect(cents(quote.data['total'])).toBe('41.14');
        const lines = quote.children[lineList()]!;
        expect(lines.map((line) => cents(line.data['line_total']))).toEqual(['32.00', '6.00']);
        expect(lines[0]!.children?.[options()]?.map((option) => cents(option.data['price']))).toEqual(['4.00']);
        expect(await counts()).toEqual(before);
      });

      if (numbered) {
        it.runIf(available)('gives no undo for an order numbered without gaps: an undo would delete its number', async () => {
          const res = await r.post('orders', phoneOrder([{ item: 4 }]));
          expect(res.statusCode, res.body).toBe(201);
          expect(res.json<{ undoToken: string | null }>().undoToken).toBeNull();
        });
      } else {
        it.runIf(available)('an undo takes the whole order away: its options, its lines, then the order', async () => {
          const before = await counts();
          const res = await r.post('orders', phoneOrder([{ item: 1, mods: [2] }, { item: 2, mods: [3, 4] }]));
          expect(res.statusCode, res.body).toBe(201);
          const token = res.json<{ undoToken: string | null }>().undoToken;
          expect(token).not.toBeNull();
          expect(await counts()).toEqual([before[0]! + 1, before[1]! + 2, before[2]! + 3]);
          const undone = await r.undo(token!);
          expect(undone.statusCode, undone.body).toBe(200);
          expect(await counts()).toEqual(before);
        });
      }
    });
  }
});
