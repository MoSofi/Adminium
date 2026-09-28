// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE WHOLE KEY IS NO SWITCH A STRANGER CAN PULL. A browser key's reads and
 * writes count on the key as a whole, every visitor together — and a few
 * addresses used to be able to spend that for everyone: sixty writes to a
 * ref that is not there, from three addresses with no session and no proof,
 * and a signed-in person cancelling their own order was told "too many".
 *
 * Now a request refused before it did anything (an unknown ref, a missing
 * row) hands its place on the key back, and no one address spends more than
 * its share of the key, however many refs and sessions it spreads over. On
 * every engine, through the whole server, with the shop's real install.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PUBLIC_KEY_LIMITS, PUBLIC_KEY_SHARES, PUBLIC_LIMITS } from '../src/public-api/limiter.js';
import { installInvoicing, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { guest, mailReady, shopManifest } from './person-fixture.js';
import { servePublic, type Served } from './public-lane.helpers.js';

const t = (ref: string) => `shop_${ref}`;

describe.each(LEGS)('the whole key, spent by a few — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let shop: Served;
  let g: ReturnType<typeof guest>;
  let ana: string;
  let ben: string;
  let anaId: number;

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, shopManifest());
    await mailReady(h.meta);
    await h.rows(`insert into ${t('customers')} (email, name) values ('ana@example.com', 'Ana'), ('ben@example.com', 'Ben')`);
    await h.rows(`insert into ${t('settings')} (bank_name, account_number) values ('Town Bank', '1')`);
    anaId = Number((await h.rows(`select id from ${t('customers')} where email = 'ana@example.com'`))[0]!['id']);
    const keys = (h.reply['publicAccess'] as { keys: Record<string, string> }).keys;
    shop = await servePublic(h, keys['customer']!);
    g = guest(shop, h, 70_000);
    ana = await g.signIn('ana@example.com');
    ben = await g.signIn('ben@example.com');
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await shop.close();
    await h.close();
  });

  it.skipIf(!available)('charges the key nothing for a write to a ref that is not there', async () => {
    const perAddress = PUBLIC_LIMITS['public-write'].max;
    // More refusals than the whole write rung holds, each address inside its own limit.
    const addresses = Math.ceil(PUBLIC_KEY_LIMITS.write.max / perAddress) + 2;
    const statuses: Record<number, number> = {};
    for (let a = 1; a <= addresses; a += 1) {
      for (let i = 0; i < perAddress; i += 1) {
        const res = await g.request('PATCH', `/records/nothing_here/${String(i)}`, { address: `203.0.113.${String(a)}`, payload: { values: {} } });
        statuses[res.statusCode] = (statuses[res.statusCode] ?? 0) + 1;
      }
    }
    expect(statuses).toEqual({ 404: addresses * perAddress });
    // A signed-in person's own change, and a stranger's new order with its proof, go through.
    const mine = await g.request('PATCH', `/records/${t('customers')}_claimed/${String(anaId)}`, { session: ana, payload: { values: { name: 'Ana B' } } });
    expect(mine.statusCode, mine.body).toBe(200);
    const order = await g.request('POST', `/records/${t('orders')}_verified_2`, {
      proof: 'write',
      payload: { values: { email: 'cy@example.com', name: 'Cy' }, children: { order_items: [{ values: { dish: 'Soup', qty: 1 } }] } },
    });
    expect(order.statusCode, order.body).toBe(201);
  });

  it.skipIf(!available)('holds one address to its share of the reads, however many refs and sessions it spreads them over', async () => {
    const one = '198.51.100.7';
    const refs = [`${t('customers')}_claimed`, `${t('orders')}_verified`, `${t('settings')}_verified`];
    const statuses: Record<number, number> = {};
    let retryAfter: unknown;
    // Two signed-in people behind one address, each well inside every limit of their own.
    for (const session of [ana, ben]) {
      for (const ref of refs) {
        for (let i = 0; i < 60; i += 1) {
          const res = await g.request('GET', `/records/${ref}`, { session, address: one });
          statuses[res.statusCode] = (statuses[res.statusCode] ?? 0) + 1;
          if (res.statusCode === 429) retryAfter ??= res.headers['retry-after'];
        }
      }
    }
    expect(statuses).toEqual({ 200: PUBLIC_KEY_SHARES.read, 429: 2 * refs.length * 60 - PUBLIC_KEY_SHARES.read });
    expect(Number(retryAfter)).toBeGreaterThan(0);
    // Everybody else reads on (a fresh sign-in: the two above spent their own limits too).
    const fresh = await g.signIn('ana@example.com');
    const other = await g.request('GET', `/records/${t('orders')}_verified`, { session: fresh, address: '198.51.100.8' });
    expect(other.statusCode, other.body).toBe(200);
  });
});
