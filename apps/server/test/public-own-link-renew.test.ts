// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A person's own links, made again by the person — over the public API of a
 * shop installed by the real installer, on every engine:
 *
 *  - "Make a new link": a signed-in person's order gets a new code; the old
 *    link stops opening it, and so does every session it opened; the new link
 *    is emailed to them as the app's message, once per code; the reply never
 *    carries it; another person's order and one that is not there answer the
 *    same; a row's own link cannot ask; two asks at once make one new link;
 *    so many a day for one order;
 *  - "Delete my details" on an app that says so (`forget.links`) stops every
 *    one of the person's links and ends their sessions, saying why — and
 *    another person's links are untouched.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SESSION_ENDED_HEADER } from '../src/routes/public/index.js';
import { installInvoicing, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { guest, mailOf, mailReady, shopManifest } from './person-fixture.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Doc = Record<string, unknown>;

/** The shop with "Make a new link" on a person's orders, and a forgetting that stops their links. */
function linkShop(): Doc {
  const manifest = shopManifest({
    entries: (entries) =>
      entries.map((entry) => {
        if (entry['table'] === 'customers') return { ...entry, forget: { ...(entry['forget'] as Doc), links: true } };
        if (entry['table'] === 'orders' && entry['key'] === undefined && entry['claimedBy'] !== undefined && (entry['methods'] as string[]).join() === 'GET') {
          return { ...entry, newLink: { column: 'link_token', kind: 'order-new-link' } };
        }
        return entry;
      }),
  });
  const messages = (manifest['requiredSchema'] as { tables: Doc[] }).tables.find((t) => t['ref'] === 'messages')!;
  const columns = messages['columns'] as Doc[];
  columns.find((c) => c['ref'] === 'kind')!['enum'] = ['order-placed', 'order-new-link'];
  columns.push({ ref: 'repeat_key', type: 'text', maxLength: 64, nullable: true });
  const outbox = manifest['outbox'] as { kinds: Record<string, string>; columns: Record<string, string> };
  outbox.kinds['order-new-link'] = 'shop-order-new-link';
  outbox.columns['repeatKey'] = 'repeat_key';
  (manifest['emailTemplates'] as Doc[]).push({
    key: 'shop-order-new-link',
    name: 'New link',
    locales: { 'en-US': { subject: 'Your new link', blocks: [{ block: 'email.text', data: { text: 'Your new link: {{manage_url}}#{{order.link_token}}' } }] } },
  });
  return manifest;
}

describe.each(LEGS)("a person's own links, made again — %s", (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let shop: Served;
  let link: Served;
  let g: ReturnType<typeof guest>;
  let own: ReturnType<typeof guest>;
  let orders: string;
  const t = (ref: string) => `shop_${ref}`;

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, linkShop());
    await mailReady(h.meta);
    const keys = (h.reply['publicAccess'] as { keys: Record<string, string> }).keys;
    shop = await servePublic(h, keys['customer']!);
    link = await servePublic(h, keys['link']!);
    g = guest(shop, h);
    own = guest(link, h, 40_000);
    orders = h.real('orders');
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await shop.close();
    await link.close();
    await h.close();
  });

  const order = async (email: string, name: string) => {
    const res = await g.request('POST', `/records/${orders}_verified_2`, { payload: { values: { email, name }, children: { order_items: [{ values: { dish: 'Soup', qty: 1 } }] } }, proof: 'write' });
    expect(res.statusCode, res.body).toBe(201);
    return res.json() as { data: { id: number }; link: { token: string; session: string } };
  };
  const tokenOf = async (id: number) => String((await h.rows(`select link_token from ${orders} where id = ${id}`))[0]!['link_token']);
  const readOwn = (session: string) => own.request('GET', `/records/${t('orders')}_claimed`, { session });
  const newLink = (id: number | string, session?: string) => g.request('POST', `/records/${t('orders')}_verified/${String(id)}/new-link`, session === undefined ? {} : { session });
  const sendMail = async () => shop.composed.app.outboxSender.sendApp('shop');

  it.skipIf(!available)('makes a new link: the old link and its sessions stop, and the new one is emailed, never answered', async () => {
    const made = await order('ana@fieldmail.io', 'Ana');
    const old = made.link.token;
    const opened = await own.request('POST', '/claim/token', { payload: { token: old } });
    expect(opened.statusCode, opened.body).toBe(200);
    const byOldLink = (opened.json() as { data: { session: string } }).data.session;
    expect((await readOwn(byOldLink)).statusCode).toBe(200);
    const ana = await g.signIn('ana@fieldmail.io');

    const res = await newLink(made.data.id, ana);
    expect(res.statusCode, res.body).toBe(202);
    expect(res.json()).toEqual({ data: {} });
    const fresh = await tokenOf(made.data.id);
    expect(fresh).not.toBe(old);
    expect(fresh).toMatch(/^[0-9A-Z]{16}$/);
    // The old link opens nothing, and neither does any session it opened: the page's own either.
    expect((await own.request('POST', '/claim/token', { payload: { token: old } })).statusCode).toBe(404);
    const closed = await readOwn(byOldLink);
    expect(closed.statusCode === 404 || closed.statusCode === 401, closed.body).toBe(true);
    expect(closed.body).not.toContain('Ana');
    expect((await readOwn(made.link.session)).body).not.toContain('Ana');
    // The new link is emailed to her, once, as the app's message; the new link opens the order.
    await sendMail();
    const mail = (await mailOf(h.meta)).filter((m) => m.template === 'shop-order-new-link');
    expect(mail.map((m) => m.to)).toEqual(['ana@fieldmail.io']);
    expect(mail[0]!.text).toContain(`#${fresh}`);
    expect((await own.request('POST', '/claim/token', { payload: { token: fresh } })).statusCode).toBe(200);
    // The audit names the row, never the code.
    const audit = await h.meta.db.selectFrom('adminium_audit_log').selectAll().where('action', '=', 'public.link.renewed').execute();
    expect(audit.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit)).not.toContain(fresh);
    expect(JSON.stringify(audit)).not.toContain(old);
  });

  it.skipIf(!available)("answers another person's order as one that is not there, and never through a row's own link", async () => {
    const theirs = await order('ben@fieldmail.io', 'Ben');
    const before = await tokenOf(theirs.data.id);
    await order('cara@fieldmail.io', 'Cara');
    const cara = await g.signIn('cara@fieldmail.io');
    const other = await newLink(theirs.data.id, cara);
    const missing = await newLink(999_999, cara);
    expect([other.statusCode, missing.statusCode]).toEqual([404, 404]);
    expect(JSON.parse(other.body)).toEqual(JSON.parse(missing.body));
    expect((await newLink('not-a-key', cara)).statusCode).toBe(404);
    // Signed out: the same.
    expect((await newLink(theirs.data.id)).statusCode).toBe(404);
    // The order's own link session is no person, on no key that makes links.
    const byLink = await own.request('POST', `/records/${t('orders')}_claimed/${String(theirs.data.id)}/new-link`, { session: theirs.link.session });
    expect(byLink.statusCode).toBe(404);
    const onCustomerKey = await newLink(theirs.data.id, theirs.link.session);
    expect(onCustomerKey.statusCode).toBe(404);
    expect(await tokenOf(theirs.data.id)).toBe(before);
  });

  /** Every new link asked for so far made two minutes earlier: past the moments in which a second ask makes no other. */
  const earlier = async () => {
    const rows = await h.meta.db.selectFrom('adminium_public_challenges').select(['id', 'createdAt']).where('purpose', '=', 'new-link').execute();
    for (const row of rows) await h.meta.db.updateTable('adminium_public_challenges').set({ createdAt: Number(row.createdAt) - 120_000 }).where('id', '=', row.id).execute();
  };
  const renewals = async (id: number) =>
    (await h.meta.db.selectFrom('adminium_audit_log').select('id').where('action', '=', 'public.link.renewed').execute()).length - (await priorRenewals(id));
  const counted = new Map<number, number>();
  const priorRenewals = async (id: number) => counted.get(id) ?? 0;

  it.skipIf(!available)('makes one new link when two are asked for at once, or twice in a moment, and so many a day', async () => {
    const made = await order('dan@fieldmail.io', 'Dan');
    const dan = await g.signIn('dan@fieldmail.io');
    counted.set(made.data.id, (await h.meta.db.selectFrom('adminium_audit_log').select('id').where('action', '=', 'public.link.renewed').execute()).length);
    const before = (await mailOf(h.meta)).length;
    const both = await Promise.all([newLink(made.data.id, dan), newLink(made.data.id, dan), newLink(made.data.id, dan)]);
    expect(both.map((r) => r.statusCode)).toEqual([202, 202, 202]);
    // Pressed again a moment later: the same new link.
    expect((await newLink(made.data.id, dan)).statusCode).toBe(202);
    expect(await renewals(made.data.id)).toBe(1);
    await sendMail();
    const sent = (await mailOf(h.meta)).slice(before).filter((m) => m.template === 'shop-order-new-link');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain(`#${await tokenOf(made.data.id)}`);
    // Later asks make four more: five in the day. A sixth is refused and changes nothing.
    for (let i = 0; i < 4; i += 1) {
      await earlier();
      expect((await newLink(made.data.id, dan)).statusCode).toBe(202);
    }
    expect(await renewals(made.data.id)).toBe(5);
    await earlier();
    const kept = await tokenOf(made.data.id);
    const sixth = await newLink(made.data.id, dan);
    expect(sixth.statusCode).toBe(409);
    expect(sixth.json()).toMatchObject({ error: { code: 'PUBLIC_LIMIT_REACHED' } });
    expect(await tokenOf(made.data.id)).toBe(kept);
    // Each new link was emailed once, and the last one sent opens the order.
    await sendMail();
    const all = (await mailOf(h.meta)).slice(before).filter((m) => m.template === 'shop-order-new-link');
    expect(all).toHaveLength(5);
    expect(all.at(-1)!.text).toContain(`#${kept}`);
  });

  it.skipIf(!available)("stops every one of a forgotten person's links and ends their sessions, and no one else's", async () => {
    const first = await order('eve@fieldmail.io', 'Eve');
    const second = await order('eve@fieldmail.io', 'Eve');
    const someone = await order('finn@fieldmail.io', 'Finn');
    const sessions = await Promise.all([first, second].map(async (made) => ((await own.request('POST', '/claim/token', { payload: { token: made.link.token } })).json() as { data: { session: string } }).data.session));
    const finnSession = ((await own.request('POST', '/claim/token', { payload: { token: someone.link.token } })).json() as { data: { session: string } }).data.session;
    const eve = await g.signIn('eve@fieldmail.io');
    const gone = await g.request('DELETE', '/account', { session: eve });
    expect(gone.statusCode, gone.body).toBe(200);
    for (const [made, session] of [[first, sessions[0]!], [second, sessions[1]!]] as const) {
      expect(await tokenOf(made.data.id)).not.toBe(made.link.token);
      expect((await own.request('POST', '/claim/token', { payload: { token: made.link.token } })).statusCode).toBe(404);
      const ended = await readOwn(session);
      expect(ended.statusCode).toBe(404);
      expect(ended.headers[SESSION_ENDED_HEADER]).toBe('forgotten');
      expect(ended.body).not.toContain('Eve');
    }
    // The page's own session the create handed over ends too.
    expect((await readOwn(first.link.session)).body).not.toContain('Eve');
    // Another person's link and session are as they were.
    expect(await tokenOf(someone.data.id)).toBe(someone.link.token);
    expect((await readOwn(finnSession)).body).toContain('Finn');
    // Nothing about a new link is emailed to an address that asked to be forgotten.
    await sendMail();
    expect((await mailOf(h.meta)).filter((m) => m.template === 'shop-order-new-link' && m.to === 'eve@fieldmail.io')).toEqual([]);
  });
});
