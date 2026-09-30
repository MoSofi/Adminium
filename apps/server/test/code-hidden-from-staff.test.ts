// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An order's link code no desk hands out (`code.hiddenFromStaff`), on every
 * engine: left out of every staff read, Super Admin's too, and still printed
 * in the order's own email to its own address — never to another — and still
 * opening the order through its link.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { readViewOf } from '../src/crud/read-view.js';
import { loadSnapshotView } from '../src/data-io/snapshot-view.js';
import { installInvoicing, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { guest, mailOf, mailReady, shopManifest } from './person-fixture.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Doc = Record<string, unknown>;

/** The shop, its orders' link code kept from staff and printed only by the outbox. */
function kitchenShop(): Doc {
  const manifest = shopManifest();
  const orders = ((manifest['requiredSchema'] as Doc)['tables'] as Doc[]).find((table) => table['ref'] === 'orders')!;
  const link = (orders['columns'] as Doc[]).find((column) => column['ref'] === 'link_token')!;
  const rules = link['rules'] as Doc;
  link['rules'] = { ...rules, code: { ...(rules['code'] as Doc), hiddenFromStaff: true } };
  return manifest;
}

describe.each(LEGS)("an order's code kept from staff, printed in its own email — %s", (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let shop: Served;
  let g: ReturnType<typeof guest>;
  const t = (ref: string) => `shop_${ref}`;

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, kitchenShop());
    await mailReady(h.meta);
    shop = await servePublic(h, (h.reply['publicAccess'] as { keys: Record<string, string> }).keys['customer']!);
    g = guest(shop, h);
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await shop.close();
    await h.close();
  });

  const order = async (email: string) => {
    const res = await g.request('POST', `/records/${t('orders')}_verified_2`, { payload: { values: { email, name: 'Nova' } }, proof: 'write' });
    expect(res.statusCode, res.body).toBe(201);
    return res.json() as { data: { id: number }; link: { token: string } };
  };

  it.skipIf(!available)('keeps the code from every staff read, Super Admin\'s too', async () => {
    const view = await loadSnapshotView(h.meta, h.connectionId);
    const id = view.model.tables.find((table) => table.name === t('orders'))!.id;
    for (const permissions of [{ superAdmin: true }, {}]) {
      expect(readViewOf(view, permissions).linkTable(id)?.columns.get('link_token')?.unreadable).toBe(true);
    }
    // The rules read the connection whole: the code is no secret there.
    expect(view.linkTable(id)?.columns.get('link_token')?.unreadable).toBeUndefined();
  });

  it.skipIf(!available)("sends the code to the order's own address, and to no other", async () => {
    const made = await order('nova@deliverable.net');
    await h.rows(`update ${t('orders')} set customer_id = null where id = ${made.data.id}`);
    await h.rows(`delete from ${t('messages')}`);
    await h.rows(`insert into ${t('messages')} (kind, status, order_id) values ('order-placed', 'queued', ${made.data.id})`);
    let before = (await mailOf(h.meta)).length;
    await shop.composed.app.outboxSender.sendApp('shop');
    const sent = (await mailOf(h.meta)).slice(before);
    expect(sent.map((m) => m.to)).toEqual(['nova@deliverable.net']);
    expect(sent[0]!.text).toContain(made.link.token);

    const other = await order('ora@deliverable.net');
    await h.rows(`update ${t('orders')} set customer_id = null where id = ${other.data.id}`);
    await h.rows(`insert into ${t('messages')} (kind, status, order_id, ${dialect === 'mysql' ? '`to`' : '"to"'}) values ('order-placed', 'queued', ${other.data.id}, 'someone@elsewhere.net')`);
    before = (await mailOf(h.meta)).length;
    await shop.composed.app.outboxSender.sendApp('shop');
    expect((await mailOf(h.meta)).slice(before).filter((m) => m.to === 'someone@elsewhere.net')).toEqual([]);
  });
});
