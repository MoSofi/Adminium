// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Two public shapes an app installs on every engine, as its validator says:
 *
 *  - a child made through a row's own link (a dish added to the order its
 *    own link opened): the create writes the link to its parent, held to
 *    the row the session reaches — another row named is refused as a row
 *    that is not there;
 *  - "delete my details" emptying a yes/no that is never empty (`bool`, not
 *    nullable), which SQLite keeps as a number: the install takes it, and
 *    the forgetting sets it to no.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { installInvoicing, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { guest, mailReady, shopManifest } from './person-fixture.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Doc = Record<string, unknown>;
/** A yes/no as the engine hands it back: a boolean, or 0/1 (SQLite, MySQL). */
const readBoolean = (value: unknown): boolean => value === true || value === 1 || value === '1';

/** The shop, a dish added to an order through the order's own link, and a customer's news flag forgotten. */
function shop(): Doc {
  const manifest = shopManifest({
    entries: (entries) =>
      entries.map((entry) => {
        if (entry['table'] === 'order_items' && entry['key'] === 'link') {
          return { ...entry, methods: ['GET', 'POST'], select: ['id', 'order_id', 'dish', 'qty'], writable: ['order_id', 'dish', 'qty'] };
        }
        if (entry['table'] === 'customers') return { ...entry, forget: { columns: ['email', 'name', 'phone', 'news'], stamp: 'forgotten_at' } };
        return entry;
      }),
  });
  const customers = (manifest['requiredSchema'] as { tables: Doc[] }).tables.find((t) => t['ref'] === 'customers')!;
  (customers['columns'] as Doc[]).push({ ref: 'news', type: 'bool', default: false });
  return manifest;
}

describe.each(LEGS)('an own-link child create and a forgotten yes/no — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let customer: Served;
  let link: Served;
  let g: ReturnType<typeof guest>;
  let own: ReturnType<typeof guest>;
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, shop());
    await mailReady(h.meta);
    const keys = (h.reply['publicAccess'] as { keys: Record<string, string> }).keys;
    customer = await servePublic(h, keys['customer']!);
    link = await servePublic(h, keys['link']!);
    g = guest(customer, h);
    own = guest(link, h, 40_000);
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await customer.close();
    await link.close();
    await h.close();
  });

  const order = async (email: string, name: string) => {
    const res = await g.request('POST', `/records/${h.real('orders')}_verified_2`, { payload: { values: { email, name }, children: { order_items: [{ values: { dish: 'Soup', qty: 1 } }] } }, proof: 'write' });
    expect(res.statusCode, res.body).toBe(201);
    return res.json() as { data: { id: number }; link: { token: string; session: string } };
  };
  const dishes = async (orderId: number) => (await h.rows(`select dish from ${h.real('order_items')} where order_id = ${String(orderId)} order by id`)).map((row) => row['dish']);

  it.skipIf(!available)("adds a child to the row its own link opened, and to no other", async () => {
    const mine = await order('lea@fieldmail.io', 'Lea');
    const theirs = await order('max@fieldmail.io', 'Max');
    const opened = await own.request('POST', '/claim/token', { payload: { token: mine.link.token } });
    expect(opened.statusCode, opened.body).toBe(200);
    const session = (opened.json() as { data: { session: string } }).data.session;
    const added = await own.request('POST', `/records/${h.real('order_items')}_verified`, { session, payload: { values: { order_id: mine.data.id, dish: 'Bread', qty: 2 } } });
    expect(added.statusCode, added.body).toBe(201);
    expect(await dishes(mine.data.id)).toEqual(['Soup', 'Bread']);
    // Another person's order, and one that is not there: the same refusal, nothing added.
    const other = await own.request('POST', `/records/${h.real('order_items')}_verified`, { session, payload: { values: { order_id: theirs.data.id, dish: 'Cake', qty: 1 } } });
    const missing = await own.request('POST', `/records/${h.real('order_items')}_verified`, { session, payload: { values: { order_id: 999_999, dish: 'Cake', qty: 1 } } });
    expect(other.statusCode, other.body).toBeGreaterThanOrEqual(400);
    expect([other.statusCode, other.json().error.code]).toEqual([missing.statusCode, missing.json().error.code]);
    expect(await dishes(theirs.data.id)).toEqual(['Soup']);
    // Without a session the link opened: refused.
    const signedOut = await own.request('POST', `/records/${h.real('order_items')}_verified`, { payload: { values: { order_id: mine.data.id, dish: 'Tea', qty: 1 } } });
    expect(signedOut.statusCode).toBeGreaterThanOrEqual(400);
    expect(await dishes(mine.data.id)).toEqual(['Soup', 'Bread']);
  });

  it.skipIf(!available)('forgets a yes/no that is never empty by setting it to no', async () => {
    await order('nia@fieldmail.io', 'Nia');
    await h.rows(`update ${h.real('customers')} set news = ${dialect === 'postgres' ? 'true' : '1'} where email = 'nia@fieldmail.io'`);
    const [before] = await h.rows(`select id from ${h.real('customers')} where email = 'nia@fieldmail.io'`);
    const nia = await g.signIn('nia@fieldmail.io');
    const gone = await g.request('DELETE', '/account', { session: nia });
    expect(gone.statusCode, gone.body).toBe(200);
    const [after] = await h.rows(`select email, name, news from ${h.real('customers')} where id = ${String(before!['id'])}`);
    expect(after!['email']).toBeNull();
    expect(after!['name']).toBeNull();
    expect(readBoolean(after!['news'])).toBe(false);
  });
});
