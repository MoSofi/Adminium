// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE WHOLE KEY IS NO SWITCH A STRANGER CAN PULL. A browser key's reads and
 * writes count on the key as a whole, every visitor together — and a few
 * addresses used to be able to spend that for everyone: sixty writes to a
 * ref that is not there, from three addresses with no session and no proof,
 * and a signed-in person cancelling their own order was told "too many".
 *
 * Now a request refused before it did anything (an unknown ref, a missing
 * row) hands its place on the key back, and no one visitor spends more than
 * their share of the key, however many refs they spread over: a signed-in
 * person by their session, anyone else by their address. On every engine,
 * through the whole server, with the shop's real install.
 */
import net from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createPublicRateLimiter,
  PUBLIC_KEY_LIMITS,
  PUBLIC_KEY_SHARES,
  PUBLIC_LIMITS,
  type PublicRateLimiter,
} from '../src/public-api/limiter.js';
import { installInvoicing, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { guest, mailReady, shopManifest } from './person-fixture.js';
import { servePublic, type Served } from './public-lane.helpers.js';

const t = (ref: string) => `shop_${ref}`;

describe.each(LEGS)('the whole key, spent by a few — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let shop: Served;
  let g: ReturnType<typeof guest>;
  let ana: string;
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

  it.skipIf(!available)('gives each signed-in person behind one address a share of their own', async () => {
    const one = '198.51.100.7';
    const refs = [`${t('customers')}_claimed`, `${t('orders')}_verified`, `${t('settings')}_verified`];
    const statuses: Record<number, number> = {};
    // Two signed-in people behind one address (a venue's Wi-Fi), each well inside every limit of their own
    // (fresh sign-ins: the change above counted on the first ones): between them more than one address's share,
    // and every read answers.
    for (const session of [await g.signIn('ana@example.com'), await g.signIn('ben@example.com')]) {
      for (const ref of refs) {
        for (let i = 0; i < 60; i += 1) {
          const res = await g.request('GET', `/records/${ref}`, { session, address: one });
          statuses[res.statusCode] = (statuses[res.statusCode] ?? 0) + 1;
        }
      }
    }
    expect(2 * refs.length * 60).toBeGreaterThan(PUBLIC_KEY_SHARES.read);
    expect(statuses).toEqual({ 200: 2 * refs.length * 60 });
  });
});

/*
 * A client that goes before its reply: the request is settled by the status it
 * was going to send. Through a listening server, since an injected request
 * cannot go away. The limiter is the real one, watched: each place held on the
 * whole key, and each handed back. The server's end of the connection is cut
 * the moment the place is held, so every request below is mid-handler when
 * its client is gone.
 */
describe.each(LEGS)('the whole key, when the client goes before the reply — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let shop: Served;
  let g: ReturnType<typeof guest>;
  let ana: string;
  let anaId: number;
  let port: number;
  let current: net.Socket | null = null;
  let cut = false;
  const counts = { held: 0, given: 0 };

  const watched = (): PublicRateLimiter => {
    const real = createPublicRateLimiter();
    return {
      ...real,
      holdKey(keyId, side, visitor) {
        const held = real.holdKey(keyId, side, visitor);
        if (!('ticket' in held)) return held;
        counts.held += 1;
        if (cut) current?.destroy();
        return {
          ticket: {
            giveBack: () => {
              counts.given += 1;
              held.ticket.giveBack();
            },
          },
        };
      },
    };
  };

  /** One request on a connection of its own, which the server cuts once the request holds its place. */
  const goneBeforeTheReply = (method: string, url: string, body: Record<string, unknown>, session?: string) =>
    new Promise<string>((resolve) => {
      const headers = shop.headers(session);
      const text = JSON.stringify(body);
      const raw =
        `${method} /api/v1/public${url} HTTP/1.1\r\nHost: 127.0.0.1\r\n` +
        Object.entries({ ...headers, 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(text)) })
          .map(([name, value]) => `${name}: ${value}\r\n`)
          .join('') +
        `\r\n${text}`;
      const socket = net.connect(port, '127.0.0.1', () => socket.write(raw));
      let answered = '';
      socket.on('data', (chunk) => (answered += chunk.toString()));
      socket.on('error', () => undefined);
      socket.on('close', () => resolve(answered));
    });

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, shopManifest());
    await mailReady(h.meta);
    await h.rows(`insert into ${t('customers')} (email, name) values ('ana@example.com', 'Ana')`);
    anaId = Number((await h.rows(`select id from ${t('customers')} where email = 'ana@example.com'`))[0]!['id']);
    const keys = (h.reply['publicAccess'] as { keys: Record<string, string> }).keys;
    shop = await servePublic(h, keys['customer']!, {}, { limiter: watched() });
    g = guest(shop, h, 90_000);
    ana = await g.signIn('ana@example.com');
    shop.composed.app.server.on('connection', (socket: net.Socket) => {
      current = socket;
    });
    await shop.composed.app.listen({ port: 0, host: '127.0.0.1' });
    port = (shop.composed.app.server.address() as net.AddressInfo).port;
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await shop.close();
    await h.close();
  });

  it.skipIf(!available)('hands back a refusal’s place, and keeps an aborted change charged', async () => {
    cut = true;
    const before = { ...counts };
    const refusals = 10;
    const answered: string[] = [];
    for (let i = 0; i < refusals; i += 1) answered.push(await goneBeforeTheReply('PATCH', `/records/nothing_here/${String(i)}`, { values: {} }));
    answered.push(await goneBeforeTheReply('PATCH', `/records/${t('customers')}_claimed/${String(anaId)}`, { values: { name: 'Ana B' } }, ana));
    cut = false;
    // No client heard back: each was gone before its reply.
    expect(answered.filter((text) => text !== '')).toEqual([]);
    // The handlers finish after their clients have gone.
    for (let wait = 0; wait < 50 && counts.given - before.given < refusals; wait += 1) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 300));
    expect(counts.held - before.held).toBe(refusals + 1);
    // Every refusal handed its place back; the change, which happened, did not.
    expect(counts.given - before.given).toBe(refusals);
    expect((await h.rows(`select name from ${t('customers')} where id = ${String(anaId)}`))[0]?.['name']).toBe('Ana B');
  });
});
