// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An order's own link in its email, when nobody is on file for it (an
 * address that only looked like a customer's, an order the desk made): the
 * order is the holder of its own code, so its email to the order's own
 * address carries it — and an email to any other address still does not.
 * On every engine, through the app's own outbox.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { installInvoicing, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { guest, mailOf, mailReady, shopManifest } from './person-fixture.js';
import { servePublic, type Served } from './public-lane.helpers.js';

describe.each(LEGS)("an order's own code in its email, with nobody on file — %s", (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let shop: Served;
  let g: ReturnType<typeof guest>;
  const t = (ref: string) => `shop_${ref}`;

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, shopManifest());
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

  it.skipIf(!available)("sends an unlinked order's own link to the order's own address", async () => {
    const made = await order('nova@deliverable.net');
    // As if nobody had been found: the order stands alone.
    await h.rows(`update ${t('orders')} set customer_id = null where id = ${made.data.id}`);
    await h.rows(`delete from ${t('messages')}`);
    await h.rows(`insert into ${t('messages')} (kind, status, order_id) values ('order-placed', 'queued', ${made.data.id})`);
    const before = (await mailOf(h.meta)).length;
    await shop.composed.app.outboxSender.sendApp('shop');
    const sent = (await mailOf(h.meta)).slice(before);
    expect(sent.map((m) => m.to)).toEqual(['nova@deliverable.net']);
    expect(sent[0]!.text).toContain(made.link.token);
  });

  it.skipIf(!available)('keeps it from any other address', async () => {
    const made = await order('ora@deliverable.net');
    await h.rows(`update ${t('orders')} set customer_id = null where id = ${made.data.id}`);
    await h.rows(`insert into ${t('messages')} (kind, status, order_id, ${dialect === 'mysql' ? '`to`' : '"to"'}) values ('order-placed', 'queued', ${made.data.id}, 'someone@elsewhere.net')`);
    const before = (await mailOf(h.meta)).length;
    await shop.composed.app.outboxSender.sendApp('shop');
    expect((await mailOf(h.meta)).slice(before).filter((m) => m.to === 'someone@elsewhere.net')).toEqual([]);
    const row = (await h.rows(`select status, error from ${t('messages')} where order_id = ${made.data.id} and status <> 'sent'`)).at(-1)!;
    expect(row['status']).toBe('failed');
    expect(String(row['error'])).toMatch(/order\.link_token/);
  });
});
