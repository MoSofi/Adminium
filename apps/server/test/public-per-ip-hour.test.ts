// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An entry's own hourly cap per visitor (`anonymous.perIpHour`), through the
 * real installer and the public route, on every engine: the eleventh create
 * of the hour from one address is refused while another address passes; an
 * IPv6 subscriber's /64 is one visitor; a create refused after the whole
 * write ran (sold out) stays counted, while one refused for the guest's own
 * value is handed back; the installed endpoint keeps the cap as written.
 */
import { publicEndpointsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { installInvoicing, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { guest, mailReady, shopManifest } from './person-fixture.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Doc = Record<string, unknown>;
const CAP = 3;

function cappedShop(): Doc {
  const manifest = shopManifest({
    entries: (entries) => [
      { table: 'dishes', methods: ['GET'], select: ['id', 'name'] },
      ...entries.map((entry) => {
        if (!((entry['methods'] as string[]).includes('POST') && entry['table'] === 'orders')) return entry;
        const children = entry['children'] as { order_items: Doc };
        return {
          ...entry,
          anonymous: { ...(entry['anonymous'] as Doc), perIpHour: CAP },
          children: { order_items: { ...children.order_items, writable: [...(children.order_items['writable'] as string[]), 'dish_id'] } },
        };
      }),
    ],
  });
  const tables = (manifest['requiredSchema'] as { tables: Doc[] }).tables;
  tables.push({ ref: 'dishes', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'name', type: 'text', maxLength: 60 }, { ref: 'stock', type: 'int', default: 0 }] });
  const items = tables.find((t) => t['ref'] === 'order_items')!;
  (items['columns'] as Doc[]).push({ ref: 'dish_id', type: 'fk', references: 'dishes', nullable: true });
  items['capacity'] = { kind: 'parent', via: 'dish_id', size: { column: 'stock' }, amount: 'qty' };
  return manifest;
}

describe.each(LEGS)("an entry's own hour per visitor — %s", (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let shop: Served;
  let g: ReturnType<typeof guest>;
  let orders: string;
  let n = 0;

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, cappedShop());
    await mailReady(h.meta);
    await h.rows(`insert into ${h.real('dishes')} (name, stock) values ('Last pie', 1)`);
    const keys = (h.reply['publicAccess'] as { keys: Record<string, string> }).keys;
    shop = await servePublic(h, keys['customer']!);
    g = guest(shop, h);
    orders = h.real('orders');
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await shop.close();
    await h.close();
  });

  const create = (address: string, line: Doc = { dish: 'Soup', qty: 1 }) => {
    n += 1;
    return g.request('POST', `/records/${orders}_verified_2`, {
      payload: { values: { email: `guest${String(n)}@mail.test`, name: 'Guest' }, children: { order_items: [{ values: line }] } },
      proof: 'write',
      address,
    });
  };

  it.skipIf(!available)('keeps the cap on the installed endpoint as written', async () => {
    const endpoints = await publicEndpointsRepo(h.meta).listByConnection(h.connectionId);
    const create = endpoints.find((e) => e.ref === `${orders}_verified_2`)!;
    expect((JSON.parse(create.definition) as { anonymous: Doc }).anonymous).toMatchObject({ per_ip_hour: CAP });
  });

  it.skipIf(!available)('refuses the visitor past the cap, counts a sold-out create, hands back a refused value, and lets another visitor in', async () => {
    const a = '203.0.113.21';
    expect((await create(a)).statusCode).toBe(201);
    // Sold out after the whole write ran: counted.
    const sold = await create(a, { dish: 'Pie', qty: 2, dish_id: 1 });
    expect(sold.statusCode, sold.body).toBe(409);
    expect(sold.json()).toMatchObject({ error: { code: 'PUBLIC_SOLD_OUT' } });
    // The guest's own value refused: handed back.
    const bad = await create(a, { dish: 'Soup', qty: 50 });
    expect(bad.statusCode, bad.body).toBe(400);
    expect((await create(a)).statusCode).toBe(201);
    const over = await create(a);
    expect(over.statusCode, over.body).toBe(409);
    expect(over.json()).toMatchObject({ error: { code: 'PUBLIC_LIMIT_REACHED' } });
    expect((await create('203.0.113.22')).statusCode).toBe(201);
    expect(Number((await h.rows(`select count(*) as c from ${orders}`))[0]!['c'])).toBe(3);
  });

  it.skipIf(!available)('holds an IPv6 subscriber to one cap across their /64', async () => {
    for (let i = 1; i <= CAP; i += 1) expect((await create(`2001:db8:5:5::${String(i)}`)).statusCode).toBe(201);
    const over = await create('2001:db8:5:5:ffff:ffff:ffff:ffff');
    expect(over.statusCode, over.body).toBe(409);
    expect((await create('2001:db8:5:6::1')).statusCode).toBe(201);
  });
});
