// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A key that answers "is this pickup time free?" and also shows a signed-in
 * diner their orders, each order's lines and each line's options: the
 * availability entry answers free or full and never a row, so the install
 * reads the lines through the orders entry — wherever the availability entry
 * stands in the list — and the diner reaches their own lines and options, and
 * no one else's. On every engine.
 */
import { publicEndpointsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parseDefinition } from '../src/public-api/endpoint.js';
import { installInvoicing, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { guest, mailReady, shopManifest } from './person-fixture.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Doc = Record<string, unknown>;
const t = (ref: string) => `shop_${ref}`;

function kitchen(availabilityFirst: boolean): Doc {
  const manifest = shopManifest({
    orders: { columns: [{ ref: 'pickup_at', type: 'timestamptz', nullable: true }] },
    entries: (entries) => {
      const availability: Doc = { table: 'orders', kind: 'availability', methods: ['GET'] };
      const children: Doc[] = [
        { table: 'order_items', methods: ['GET'], level: 'verified', visibleWith: { table: 'orders', via: 'order_id' }, select: ['id', 'dish', 'qty'] },
        { table: 'order_item_options', methods: ['GET'], level: 'verified', visibleWith: { table: 'order_items', via: 'order_item_id' }, select: ['id', 'name'] },
      ];
      return availabilityFirst ? [availability, ...entries, ...children] : [...entries, ...children, availability];
    },
  });
  const tables = (manifest['requiredSchema'] as { tables: Doc[] }).tables;
  tables.find((table) => table['ref'] === 'orders')!['capacity'] = {
    kind: 'slot',
    slot: 'pickup_at',
    amount: 1,
    perSlot: 6,
    countWhere: { column: 'status', values: ['placed', 'ready'] },
    slotMinutes: 15,
    windowDays: 1,
    opens: '11:00',
    closes: '21:00',
  };
  tables.push({
    ref: 'order_item_options',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'order_item_id', type: 'fk', references: 'order_items' },
      { ref: 'name', type: 'text', maxLength: 60 },
    ],
  });
  return manifest;
}

describe.each(LEGS)('an availability entry is never the parent a child is read with — %s', (dialect, available) => {
  for (const availabilityFirst of [false, true]) {
    describe(availabilityFirst ? 'availability listed first' : 'availability listed last', () => {
      let h: InvoicingHarness & { reply: Record<string, unknown> };
      let shop: Served;
      let g: ReturnType<typeof guest>;
      let refs: Record<string, { kind?: string }>;

      beforeAll(async () => {
        if (!available) return;
        h = await installInvoicing(dialect, kitchen(availabilityFirst));
        await mailReady(h.meta);
        await h.rows(`insert into ${t('customers')} (email, name) values ('ana@example.com', 'Ana'), ('ben@example.com', 'Ben')`);
        await h.rows(`insert into ${t('orders')} (customer_id, email, name) values (1, 'ana@example.com', 'Ana'), (2, 'ben@example.com', 'Ben')`);
        await h.rows(`insert into ${t('order_items')} (order_id, dish, qty) values (1, 'Ana soup', 1), (2, 'Ben stew', 2)`);
        await h.rows(`insert into ${t('order_item_options')} (order_item_id, name) values (1, 'Ana croutons'), (2, 'Ben dumplings')`);
        const keys = (h.reply['publicAccess'] as { keys: Record<string, string> }).keys;
        shop = await servePublic(h, keys['customer']!);
        g = guest(shop, h);
        refs = ((await g.request('GET', '/config')).json() as { data: { refs: Record<string, { kind?: string }> } }).data.refs;
      }, 180_000);
      afterAll(async () => {
        if (!available) return;
        await shop.close();
        await h.close();
      });

      it.skipIf(!available)('installs every entry, the lines read through the orders entry', async () => {
        const reply = h.reply as { publicAccess: { endpoints: string[] }; pending?: unknown };
        expect(reply.publicAccess.endpoints).toContain(`${t('orders')}_availability`);
        const endpoints = await publicEndpointsRepo(h.meta).listByConnection(h.connectionId);
        // The key's refs, from its own config: a person's orders, their lines, each line's options.
        const ref = (table: string, kind?: 'create') =>
          Object.entries(refs).find(([r, d]) => r.startsWith(`${t(table)}_verified`) && (d as { actions?: string[] }).actions?.includes(kind ?? 'read') === true)![0];
        const parentOf = (at: string) => {
          const row = endpoints.find((e) => e.ref === at)!;
          const parsed = parseDefinition(row.definition);
          if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
          return (parsed.definition as { visible_with?: { ref: string } }).visible_with?.ref;
        };
        expect(parentOf(ref('order_items'))).toBe(ref('orders'));
        expect(parentOf(ref('order_item_options'))).toBe(ref('order_items'));
        expect(ref('orders')).not.toBe(ref('orders', 'create'));
        expect(refs[`${t('orders')}_availability`]?.kind).toBe('availability');
      });

      it.skipIf(!available)("reaches the diner's own lines and options, and no one else's", async () => {
        const ana = await g.signIn('ana@example.com');
        const lines = Object.keys(refs).find((r) => r.startsWith(`${t('order_items')}_verified`))!;
        const options = Object.keys(refs).find((r) => r.startsWith(`${t('order_item_options')}_verified`))!;
        const read = await g.request('GET', `/records/${lines}`, { session: ana });
        expect(read.statusCode, read.body).toBe(200);
        expect(read.body).toContain('Ana soup');
        expect(read.body).not.toContain('Ben stew');
        const opts = await g.request('GET', `/records/${options}`, { session: ana });
        expect(opts.statusCode, opts.body).toBe(200);
        expect(opts.body).toContain('Ana croutons');
        expect(opts.body).not.toContain('Ben dumplings');
        // Another diner's line by id answers as a line that is not there.
        expect((await g.request('GET', `/records/${lines}/2`, { session: ana })).statusCode).toBe(404);
        expect((await g.request('GET', `/records/${lines}/999`, { session: ana })).statusCode).toBe(404);
      });
    });
  }
});
