// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "MY DETAILS": a person signed in by an emailed link reads their own row of
 * the table they sign in through — its address too, which is personal data
 * and masked from everyone else — by list and by id, and a change answers it
 * as a read does. Nobody else gains a column: another signed-in person, a
 * row's own link, a caller with no session, and (on an identity found by what
 * a person knows) a session that has not yet confirmed the emailed code.
 *
 * An entry that could never show such a column to anyone — none of its
 * readers proves the mailbox — is refused where it is written, not answered
 * as a failure to the first guest. On every engine.
 */
import type { Manifest } from '@adminium/manifest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { planPublicEndpoints } from '../src/apps/manifest-public.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { installInvoicing, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { guest, mailOf, mailReady, shopManifest } from './person-fixture.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Doc = Record<string, unknown>;
const t = (ref: string) => `shop_${ref}`;
const details = t('customers_claimed');

describe.each(LEGS)("a person's own details — %s", (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let shop: Served;
  let link: Served;
  let g: ReturnType<typeof guest>;
  let own: ReturnType<typeof guest>;
  let ana: string;
  let ben: string;
  let anaId: number;
  let benId: number;
  let anaLink: string;

  beforeAll(async () => {
    if (!available) return;
    // And the venue's bank name, for anyone: a read of what everyone sees.
    h = await installInvoicing(dialect, shopManifest({ entries: (entries) => [...entries, { table: 'settings', methods: ['GET'], select: ['bank_name'] }] }));
    await mailReady(h.meta);
    await h.rows(`insert into ${t('customers')} (email, name, phone) values ('ana@example.com', 'Ana', '07700900001'), ('ben@example.com', 'Ben', '07700900002')`);
    await h.rows(`insert into ${t('settings')} (bank_name, account_number) values ('Town Bank', '1')`);
    const ids = await h.rows(`select id, email from ${t('customers')} order by id`);
    anaId = Number(ids.find((row) => row['email'] === 'ana@example.com')!['id']);
    benId = Number(ids.find((row) => row['email'] === 'ben@example.com')!['id']);
    const keys = (h.reply['publicAccess'] as { keys: Record<string, string> }).keys;
    shop = await servePublic(h, keys['customer']!);
    link = await servePublic(h, keys['link']!);
    g = guest(shop, h);
    own = guest(link, h, 40_000);
    const order = await g.request('POST', `/records/${t('orders')}_verified_2`, {
      payload: { values: { email: 'ana@example.com', name: 'Ana' }, children: { order_items: [{ values: { dish: 'Soup', qty: 1 } }] } },
      proof: 'write',
    });
    expect(order.statusCode, order.body).toBe(201);
    anaLink = (order.json() as { link: { session: string } }).link.session;
    ana = await g.signIn('ana@example.com');
    ben = await g.signIn('ben@example.com');
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await shop.close();
    await link.close();
    await h.close();
  });

  it.skipIf(!available)('reads their own details with the address, by list and by id, and a change answers them the same way', async () => {
    const list = await g.request('GET', `/records/${details}`, { session: ana });
    expect(list.statusCode, list.body).toBe(200);
    expect((list.json() as { data: Doc[] }).data).toEqual([{ name: 'Ana', email: 'ana@example.com' }]);
    expect(list.body).not.toContain('ben@example.com');

    const one = await g.request('GET', `/records/${details}/${String(anaId)}`, { session: ana });
    expect(one.statusCode, one.body).toBe(200);
    expect((one.json() as { data: Doc }).data).toEqual({ name: 'Ana', email: 'ana@example.com' });

    const renamed = await g.request('PATCH', `/records/${details}/${String(anaId)}`, { session: ana, payload: { values: { name: 'Ana B' } } });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect((renamed.json() as { data: Doc }).data).toEqual({ name: 'Ana B', email: 'ana@example.com' });

    // None of it is kept by a browser or a cache on a shared machine.
    for (const res of [list, one, renamed]) expect(res.headers['cache-control']).toBe('no-store');

    // Ben reads his, and only his.
    const his = await g.request('GET', `/records/${details}`, { session: ben });
    expect(his.statusCode, his.body).toBe(200);
    expect((his.json() as { data: Doc[] }).data).toEqual([{ name: 'Ben', email: 'ben@example.com' }]);
  });

  it.skipIf(!available)('shows nobody else a column of it: another person, a row’s own link, nobody signed in', async () => {
    // Another signed-in person: the one 404, by id, read or changed.
    expect((await g.request('GET', `/records/${details}/${String(benId)}`, { session: ana })).statusCode).toBe(404);
    const taken = await g.request('PATCH', `/records/${details}/${String(benId)}`, { session: ana, payload: { values: { name: 'Taken' } } });
    expect(taken.statusCode).toBe(404);
    expect((await h.rows(`select name from ${t('customers')} where id = ${String(benId)}`))[0]!['name']).toBe('Ben');
    // Nobody signed in.
    for (const url of [`/records/${details}`, `/records/${details}/${String(anaId)}`]) {
      const res = await g.request('GET', url);
      expect(res.statusCode, url).toBe(404);
      expect(res.body).not.toContain('@example.com');
    }
    // A row's own link: no way into the person, on its own key or on the customer key.
    for (const [served, label] of [[own, 'link key'], [g, 'customer key']] as const) {
      for (const url of [`/records/${details}`, `/records/${details}/${String(anaId)}`]) {
        const res = await served.request('GET', url, { session: anaLink });
        expect(res.statusCode, `${label} ${url}`).toBe(404);
        expect(res.body).not.toContain('ana@example.com');
      }
    }
  });

  it.skipIf(!available)('keeps no reply made with a session, nor any write’s; a read of what everyone sees keeps its caching', async () => {
    const order = await own.request('GET', `/records/${t('orders')}_claimed`, { session: anaLink });
    expect(order.statusCode, order.body).toBe(200);
    expect(order.body).toContain('ana@example.com');
    expect(order.headers['cache-control']).toBe('no-store');
    const bank = await g.request('GET', `/records/${t('settings')}_verified`, { session: ben });
    expect(bank.statusCode, bank.body).toBe(200);
    expect(bank.headers['cache-control']).toBe('no-store');
    // A refusal to a session is kept by nobody either.
    expect((await g.request('GET', `/records/${details}/${String(benId)}`, { session: ana })).headers['cache-control']).toBe('no-store');
    // Everyone's: as it always was.
    const open = await g.request('GET', `/records/${t('settings')}`);
    expect(open.statusCode, open.body).toBe(200);
    expect(open.body).toContain('Town Bank');
    expect(open.headers['cache-control']).toBeUndefined();
  });

  it.skipIf(!available)('refuses, where it is written, an entry that could never show personal data to anyone', async () => {
    const view = (await createPublicViews(h.meta).viewFor(h.connectionId))!;
    const names = { customers: t('customers'), orders: t('orders'), order_items: t('order_items'), settings: t('settings'), messages: t('messages') };
    const plan = (entries: (entries: Doc[]) => Doc[]) => planPublicEndpoints(shopManifest({ entries }) as unknown as Manifest, names, view);
    const notProved = (planned: ReturnType<typeof plan>) => planned.flatMap((p) => p.issues.filter((issue) => issue.includes('proved their mailbox')).map((issue) => `${p.ref}: ${issue}`));

    // The shop as it ships: every address shown is shown to the mailbox's own person.
    expect(notProved(plan((entries) => entries))).toEqual([]);
    // A person's own orders read without a verified level: a found session would never be shown the address.
    const lookupOrders = plan((entries) => entries.map((entry) => (entry['table'] === 'orders' && entry['claimedBy'] !== undefined && (entry['methods'] as string[]).includes('GET') ? { ...entry, level: undefined } : entry)));
    expect(notProved(lookupOrders)).toEqual([expect.stringContaining('"email" is marked personal data')]);
  });
});

/**
 * An identity found by what a person knows (a phone), raised by an emailed
 * code: before the code, the found session reads its row's name and the
 * phone it typed to be found, and none of the person's own rows; after it,
 * those rows as they are. An address on the identity itself, which the found
 * session would read before any code, is refused where the app asks for it.
 *
 * What it reads back is what it typed, and nothing the desk writes there
 * later: a found session whose row no longer holds the phone it typed ends,
 * and so does a confirmed one whose row no longer holds the address its code
 * went to. Asked on every request, whatever wrote the row.
 */
describe.each(LEGS)('details found by a phone, confirmed by an emailed code — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let shop: Served;
  let g: ReturnType<typeof guest>;
  const manifestFor = (select: string[]) => {
    const manifest = shopManifest({
      entries: () => [
        { table: 'customers', methods: ['GET'], select, writable: [], claim: { match: ['phone'], verify: 'email-code', email: 'email' } },
        { table: 'orders', methods: ['GET'], level: 'verified', claimedBy: { table: 'customers', column: 'customer_id' }, select: ['id', 'email', 'name', 'status'] },
      ],
    });
    delete manifest['publicKeys'];
    return manifest;
  };

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, manifestFor(['name', 'phone']));
    await mailReady(h.meta);
    await h.rows(`insert into ${t('customers')} (email, name, phone) values ('ana@example.com', 'Ana', '07700900001'), ('ben@example.com', 'Ben', '07700900002')`);
    const ids = await h.rows(`select id, email from ${t('customers')} order by id`);
    for (const row of ids) {
      await h.rows(`insert into ${t('orders')} (customer_id, email, name) values (${String(row['id'])}, '${String(row['email'])}', 'Order of ${String(row['email'])}')`);
    }
    const keyId = (h.reply['publicAccess'] as { keyId: string }).keyId;
    shop = await servePublic(h, keyId);
    g = guest(shop, h, 60_000);
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await shop?.close();
    await h?.close();
  });

  it.skipIf(!available)('reads back only what it typed before the code, and its own rows as they are after it', async () => {
    const found = await g.request('POST', '/claim', { payload: { match: { phone: '07700900001' } } });
    expect(found.statusCode, found.body).toBe(200);
    const session = (found.json() as { data: { session: string } }).data.session;
    const me = await g.request('GET', `/records/${details}`, { session });
    expect(me.statusCode, me.body).toBe(200);
    // The phone it typed to be found, read back as it gave it; nobody else's.
    expect((me.json() as { data: Doc[] }).data).toEqual([{ name: 'Ana', phone: '07700900001' }]);
    expect(me.body).not.toContain('07700900002');
    const before = await g.request('GET', `/records/${t('orders')}_verified`, { session });
    expect(before.statusCode, before.body).toBe(403);
    expect(before.body).not.toContain('ana@example.com');

    const sent = await g.request('POST', '/claim/code', { session, payload: { purpose: 'verify' } });
    expect(sent.statusCode, sent.body).toBe(200);
    const code = /\b(\d{6})\b/.exec((await mailOf(h.meta)).filter((m) => m.template === 'sign-in-code').at(-1)!.subject)![1]!;
    const confirmed = await g.request('POST', '/claim/verify', { session, payload: { code } });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    const after = await g.request('GET', `/records/${t('orders')}_verified`, { session });
    expect(after.statusCode, after.body).toBe(200);
    expect(after.body).toContain('ana@example.com');
    expect(after.body).not.toContain('ben@example.com');
  });

  it.skipIf(!available)('ends a found session once the desk changes the phone it typed', async () => {
    const found = await g.request('POST', '/claim', { payload: { match: { phone: '07700900001' } } });
    expect(found.statusCode, found.body).toBe(200);
    const session = (found.json() as { data: { session: string } }).data.session;
    const anaId = Number((await h.rows(`select id from ${t('customers')} where email = 'ana@example.com'`))[0]!['id']);
    expect((await g.request('GET', `/records/${details}/${String(anaId)}`, { session })).statusCode).toBe(200);
    // The desk takes a new number for Ana; the found session never typed it.
    await (await writerFor(h)).update('customers', anaId, { phone: '07700900099' });
    const list = await g.request('GET', `/records/${details}`, { session });
    expect(list.statusCode, list.body).toBe(404);
    expect(list.body).not.toContain('07700900099');
    const byId = await g.request('GET', `/records/${details}/${String(anaId)}`, { session });
    expect(byId.statusCode, byId.body).toBe(404);
    expect(byId.body).not.toContain('07700900099');
    // Ended, not paused: the number typed back does not bring it back.
    await (await writerFor(h)).update('customers', anaId, { phone: '07700900001' });
    expect((await g.request('GET', `/records/${details}`, { session })).statusCode).toBe(404);
    expect((await g.request('POST', '/claim/code', { session, payload: { purpose: 'verify' } })).statusCode).toBe(404);
  });

  it.skipIf(!available)('ends a confirmed session once its row no longer holds the address its code went to', async () => {
    const found = await g.request('POST', '/claim', { payload: { match: { phone: '07700900002' } } });
    expect(found.statusCode, found.body).toBe(200);
    const session = (found.json() as { data: { session: string } }).data.session;
    expect((await g.request('POST', '/claim/code', { session, payload: { purpose: 'verify' } })).statusCode).toBe(200);
    const code = /\b(\d{6})\b/.exec((await mailOf(h.meta)).filter((m) => m.template === 'sign-in-code' && m.to === 'ben@example.com').at(-1)!.subject)![1]!;
    expect((await g.request('POST', '/claim/verify', { session, payload: { code } })).statusCode).toBe(200);
    expect((await g.request('GET', `/records/${t('orders')}_verified`, { session })).statusCode).toBe(200);
    // Moved straight in the database (an import, a script): no event, and still asked.
    await h.rows(`update ${t('customers')} set email = 'ben.moved@example.com' where email = 'ben@example.com'`);
    const after = await g.request('GET', `/records/${t('orders')}_verified`, { session });
    expect(after.statusCode, after.body).toBe(404);
    expect(after.body).not.toContain('ben@example.com');
  });

  it.skipIf(!available)('refuses an address on the identity, which a found session would read before any code', async () => {
    const view = (await createPublicViews(h.meta).viewFor(h.connectionId))!;
    const planned = planPublicEndpoints(manifestFor(['name', 'email']) as unknown as Manifest, { customers: t('customers'), orders: t('orders') }, view);
    const personal = (table: string) => planned.find((p) => p.table === table)!.issues.filter((issue) => issue.includes('proved their mailbox'));
    expect(personal('customers')).toEqual([expect.stringContaining('"email" is marked personal data')]);
    expect(personal('orders')).toEqual([]);
  });
});
