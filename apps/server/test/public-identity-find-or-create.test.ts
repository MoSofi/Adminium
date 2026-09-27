// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A guest's order finds its person by the address typed, or makes one — over
 * the public API of an app installed by the real installer, on every engine.
 *
 * What it holds: a new address makes one person and links the order; a known
 * one links the person already on file and never renames them; the address
 * is compared trimmed and in lower case; the reply is the same shape whichever
 * happened and never shows the link; a value the new person would be refused
 * for is refused the same for a known address; a refused order leaves no
 * person behind; a signed-in guest's order is theirs, with their own address;
 * a quote never touches the person table; the order's own link comes back
 * once, with a session already open on it.
 */
import { validateManifest } from '@adminium/manifest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { installInvoicing, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { guest, mailReady, shopManifest } from './person-fixture.js';
import { servePublic, type Served } from './public-lane.helpers.js';

describe('the shop', () => {
  it('validates', () => {
    const result = validateManifest(shopManifest());
    expect(result.ok ? [] : result.issues).toEqual([]);
  });
});

describe.each(LEGS)('a person found by address on a create — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let shop: Served;
  let link: Served;
  let g: ReturnType<typeof guest>;
  let orders: string;

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, shopManifest());
    await mailReady(h.meta);
    await h.rows(`insert into ${h.real('customers')} (email, name) values ('lena@example.com', 'Lena')`);
    await h.rows(`insert into ${h.real('settings')} (bank_name, account_number) values ('Town Bank', '12345678')`);
    const keys = (h.reply['publicAccess'] as { keys: Record<string, string> }).keys;
    shop = await servePublic(h, keys['customer']!);
    link = await servePublic(h, keys['link']!);
    g = guest(shop, h);
    orders = h.real('orders');
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await shop.close();
    await link.close();
    await h.close();
  });

  const people = async () => (await h.rows(`select id, email, name from ${h.real('customers')} order by id`)).map((r) => ({ id: Number(r['id']), email: r['email'], name: r['name'] }));
  const orderOf = async (id: unknown) => (await h.rows(`select customer_id, email, name from ${orders} where id = ${Number(id)}`))[0]!;
  const create = (values: Record<string, unknown>, more: Record<string, unknown> = {}, session?: string) =>
    g.request('POST', `/records/${orders}_verified_2`, { payload: { values, ...more }, proof: 'write', ...(session === undefined ? {} : { session }) });

  it.skipIf(!available)('makes one person for a new address and links the order, answering its own link once', async () => {
    const before = await people();
    const res = await create({ email: 'nova@example.com', name: 'Nova' }, { children: { order_items: [{ values: { dish: 'Soup', qty: 2 } }] } });
    expect(res.statusCode, res.body).toBe(201);
    const reply = res.json() as { data: Record<string, unknown>; link: { key: string; token: string; session: string; expiresAt: number } };
    expect(Object.keys(reply.data).sort()).toEqual(['id', 'item_count', 'status']);
    expect(reply.link.key).toBe('link');
    expect(reply.link.token).toMatch(/^[0-9A-Z]{16}$/);
    const after = await people();
    expect(after).toHaveLength(before.length + 1);
    const nova = after.find((p) => p.email === 'nova@example.com')!;
    expect(nova.name).toBe('Nova');
    expect(Number((await orderOf(reply.data['id']))['customer_id'])).toBe(nova.id);
    // The session the reply opened reads the order through its own link, at the verified level.
    const own = await link.get(`/records/${orders}_claimed`, reply.link.session);
    expect(own.statusCode, own.body).toBe(200);
    expect((own.json() as { data: Record<string, unknown>[] }).data.map((row) => Number(row['id']))).toEqual([Number(reply.data['id'])]);
  });

  it.skipIf(!available)('links a known address to its person, and never renames them', async () => {
    const before = await people();
    const res = await create({ email: '  Lena@Example.COM ', name: 'Somebody Else' });
    expect(res.statusCode, res.body).toBe(201);
    const id = (res.json() as { data: { id: unknown } }).data.id;
    expect(await people()).toEqual(before);
    const lena = before.find((p) => p.email === 'lena@example.com')!;
    expect(lena.name).toBe('Lena');
    const row = await orderOf(id);
    expect(Number(row['customer_id'])).toBe(lena.id);
    // The row keeps what the guest typed, as its own copy.
    expect(row['name']).toBe('Somebody Else');
  });

  it.skipIf(!available)('answers a known and an unknown address in the same shape', async () => {
    const known = await create({ email: 'lena@example.com', name: 'L' });
    const unknown = await create({ email: 'omar@example.com', name: 'O' });
    expect([known.statusCode, unknown.statusCode]).toEqual([201, 201]);
    const shape = (res: typeof known) => {
      const body = res.json() as Record<string, Record<string, unknown>>;
      return { keys: Object.keys(body).sort(), data: Object.keys(body['data']!).sort(), link: Object.keys(body['link']!).sort(), headers: Object.keys(res.headers).filter((k) => k !== 'date' && k !== 'content-length').sort() };
    };
    expect(shape(unknown)).toEqual(shape(known));
    expect(JSON.stringify(known.json())).not.toContain('customer_id');
  });

  it.skipIf(!available)('refuses a detail a new person could not hold the same way for a known address', async () => {
    const before = await people();
    // customers.name holds 60; the order's name 120.
    const long = 'N'.repeat(80);
    const unknown = await create({ email: 'long@example.com', name: long });
    const known = await create({ email: 'lena@example.com', name: long });
    expect(unknown.statusCode, unknown.body).toBe(400);
    expect(known.statusCode).toBe(400);
    expect(unknown.body).toBe(known.body);
    expect(unknown.json()).toMatchObject({ error: { code: 'PUBLIC_WRITE_REFUSED', params: { column: 'name', reason: 'too-long' } } });
    expect(await people()).toEqual(before);
  });

  it.skipIf(!available)('leaves no person behind when the order is refused', async () => {
    const before = await people();
    const res = await create({ email: 'ghost@example.com', name: 'Ghost' }, { children: { order_items: [{ values: { dish: 'Soup', qty: 99 } }] } });
    expect(res.statusCode, res.body).toBe(400);
    expect(await people()).toEqual(before);
  });

  it.skipIf(!available)('refuses what is not an address before anything is read', async () => {
    const res = await create({ email: 'not-an-address', name: 'N' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'PUBLIC_WRITE_REFUSED', params: { column: 'email', reason: 'format' } } });
  });

  it.skipIf(!available)("links a signed-in guest's order to them, with the address their account keeps", async () => {
    const session = await g.signIn('lena@example.com');
    const before = await people();
    const res = await create({ email: 'typed-elsewhere@example.com', name: '' }, {}, session);
    expect(res.statusCode, res.body).toBe(201);
    const row = await orderOf((res.json() as { data: { id: unknown } }).data.id);
    expect(await people()).toEqual(before);
    expect(Number(row['customer_id'])).toBe(before.find((p) => p.email === 'lena@example.com')!.id);
    expect(row['email']).toBe('lena@example.com');
    expect(row['name']).toBe('Lena');
  });

  it.skipIf(!available)('a quote never finds or makes anybody', async () => {
    const before = await people();
    for (const email of ['lena@example.com', 'quote-only@example.com']) {
      const res = await g.request('POST', `/records/${orders}_verified_2/dry-run`, { payload: { values: { email, name: 'Q' } } });
      expect(res.statusCode, res.body).toBe(200);
      expect(JSON.stringify(res.json())).not.toContain('link');
    }
    expect(await people()).toEqual(before);
  });

  it.skipIf(!available)('answers a retried create with its rows, never its link again', async () => {
    const key = 'k'.repeat(43);
    const first = await create({ email: 'retry@example.com', name: 'R', client_key: key });
    expect(first.statusCode, first.body).toBe(201);
    expect((first.json() as { link?: unknown }).link).toBeDefined();
    const again = await create({ email: 'retry@example.com', name: 'R', client_key: key });
    expect(again.statusCode, again.body).toBe(200);
    expect((again.json() as { replayed?: boolean; link?: unknown })).toMatchObject({ replayed: true });
    expect((again.json() as { link?: unknown }).link).toBeUndefined();
  });
});

/** The shop whose guest create finds nobody by address: it answers the new order's own link and nothing else. */
const linkOnly = () =>
  shopManifest({
    entries: (entries) =>
      entries.map((entry) =>
        entry['identity'] === undefined
          ? entry
          : {
              table: 'orders',
              methods: ['POST'],
              humanCheck: true,
              select: ['id', 'status'],
              writable: ['email', 'name', 'note'],
              requires: ['email', 'name'],
              shareLink: 'link_token',
              anonymous: { perValue: { columns: ['email'], n: 10 } },
            },
      ),
  });

describe('the shop that finds nobody by address', () => {
  it('validates', () => {
    const result = validateManifest(linkOnly());
    expect(result.ok ? [] : result.issues).toEqual([]);
  });
});

describe.each(LEGS)("a row's own link on a create that finds nobody — %s", (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let shop: Served;
  let link: Served;
  let g: ReturnType<typeof guest>;
  let ref: string;

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, linkOnly());
    const keys = (h.reply['publicAccess'] as { keys: Record<string, string> }).keys;
    shop = await servePublic(h, keys['customer']!);
    link = await servePublic(h, keys['link']!);
    g = guest(shop, h);
    const config = (await g.request('GET', '/config')).json() as { data: { refs: Record<string, { actions: string[] }> } };
    ref = Object.entries(config.data.refs).find(([name, r]) => name.startsWith(h.real('orders')) && r.actions.includes('create'))![0];
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await shop.close();
    await link.close();
    await h.close();
  });

  it.skipIf(!available)('answers the new row its own link, with a session open on it, and makes nobody', async () => {
    const res = await g.request('POST', `/records/${ref}`, { payload: { values: { email: 'solo@example.com', name: 'Solo' } }, proof: 'write' });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json() as { data: { id: number }; link?: { key: string; token: string; session?: string } };
    const stored = (await h.rows(`select customer_id, link_token from ${h.real('orders')} where id = ${String(body.data.id)}`))[0]!;
    expect(body.link).toMatchObject({ key: 'link', token: stored['link_token'] });
    expect(stored['customer_id']).toBeNull();
    expect(await h.rows(`select id from ${h.real('customers')}`)).toEqual([]);
    // The session it came with opens that row on the link key, and no other.
    const byLink = guest(link, h, 40_000);
    const linkRefs = ((await byLink.request('GET', '/config')).json() as { data: { refs: Record<string, unknown> } }).data.refs;
    const own = Object.keys(linkRefs).find((name) => name.startsWith(h.real('orders')))!;
    const opened = await byLink.request('GET', `/records/${own}`, { session: body.link!.session! });
    expect(opened.statusCode, opened.body).toBe(200);
    expect((opened.json() as { data: { id: number }[] }).data.map((row) => row.id)).toEqual([body.data.id]);
  });
});
