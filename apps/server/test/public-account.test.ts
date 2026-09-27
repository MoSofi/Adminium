// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A guest's own account, over the public API of an app installed by the real
 * installer, on every engine: signing out everywhere, deleting their details,
 * the read only a signed-in guest gets (bank details), and the row's own link.
 *
 * Signing out everywhere ends every session of the person — each other device
 * is told why, once, and nothing else is ever told anything — and takes back
 * the sign-in links still open to their address. Deleting their details needs
 * a mailbox proved minutes ago; it empties the person's own columns, keeps
 * every row that points at them (an order keeps its address, name and link),
 * ends their sessions, takes back their links, tells the old address once,
 * and is heard by the rules as a forgetting — with nothing sent to the old
 * address about a change of address, and no values in the audit.
 */
import { auditRepo, publicSessionsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { SESSION_ENDED_HEADER } from '../src/routes/public/index.js';
import { installInvoicing, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { guest, mailOf, mailReady, shopManifest } from './person-fixture.js';
import { ORIGIN, servePublic, type Served } from './public-lane.helpers.js';

describe.each(LEGS)("a guest's own account — %s", (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let shop: Served;
  let link: Served;
  let g: ReturnType<typeof guest>;
  let own: ReturnType<typeof guest>;
  let orders: string;
  let customers: string;

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, shopManifest());
    await mailReady(h.meta);
    orders = h.real('orders');
    customers = h.real('customers');
    // Each test signs its own people in: a person gets three sign-in links in fifteen minutes.
    await h.rows(`insert into ${customers} (email, name, phone) values ('mia@example.com', 'Mia', '+44 7700 900123')`);
    for (const name of ['Kai', 'Ana', 'Ben', 'Cy', 'Dee', 'Eve', 'Fay']) {
      await h.rows(`insert into ${customers} (email, name) values ('${name.toLowerCase()}@example.com', '${name}')`);
    }
    await h.rows(`insert into ${h.real('settings')} (bank_name, account_number) values ('Town Bank', '12345678')`);
    const keys = (h.reply['publicAccess'] as { keys: Record<string, string> }).keys;
    shop = await servePublic(h, keys['customer']!);
    link = await servePublic(h, keys['link']!);
    g = guest(shop, h);
    own = guest(link, h, 50_000);
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await shop.close();
    await link.close();
    await h.close();
    vi.restoreAllMocks();
  });

  const mine = (session: string) => g.request('GET', `/records/${orders}_verified`, { session });
  const order = async (email: string, name: string) => {
    const res = await g.request('POST', `/records/${orders}_verified_2`, { payload: { values: { email, name } }, proof: 'write' });
    expect(res.statusCode, res.body).toBe(201);
    return res.json() as { data: { id: number }; link: { token: string; session: string } };
  };

  it.skipIf(!available)('signs a person out on every device, and tells each other device why', async () => {
    const phone = await g.signIn('kai@example.com');
    const laptop = await g.signIn('kai@example.com');
    const kai = await g.signIn('ana@example.com');
    expect((await mine(phone)).statusCode).toBe(200);
    const out = await g.request('POST', '/session/revoke-all', { session: laptop });
    expect(out.statusCode, out.body).toBe(200);
    expect(out.json()).toEqual({ data: {} });
    for (const session of [phone, laptop]) {
      const after = await mine(session);
      expect(after.statusCode).toBe(404);
      expect(after.headers[SESSION_ENDED_HEADER]).toBe('elsewhere');
      // A page on another origin can read why.
      expect(String(after.headers['access-control-expose-headers'])).toContain(SESSION_ENDED_HEADER);
    }
    // Another person's session is untouched.
    const theirs = await mine(kai);
    expect(theirs.statusCode).toBe(200);
    expect(theirs.headers[SESSION_ENDED_HEADER]).toBeUndefined();
  });

  it.skipIf(!available)('tells nothing to a token that is unknown, lapsed, or ended on another key', async () => {
    const unknown = await mine(`adm_pubs_${'x'.repeat(40)}`);
    expect(unknown.statusCode).toBe(404);
    expect(unknown.headers[SESSION_ENDED_HEADER]).toBeUndefined();
    const lapsed = await g.signIn('ana@example.com');
    await h.meta.db.updateTable('adminium_public_sessions').set({ expiresAt: Date.now() - 1_000, endedAt: Date.now() - 2_000, endedReason: 'elsewhere' }).where('id', '=', (await sessionOf(lapsed))!).execute();
    expect((await mine(lapsed)).headers[SESSION_ENDED_HEADER]).toBeUndefined();
    const ended = await g.signIn('ben@example.com');
    await g.request('POST', '/session/revoke-all', { session: ended });
    // Presented with the link key: the session is not this key's, so it is nobody's business here.
    const elsewhere = await own.request('GET', `/records/${orders}_claimed`, { session: ended });
    expect(elsewhere.headers[SESSION_ENDED_HEADER]).toBeUndefined();
  });

  it.skipIf(!available)('never says it on the staff side', async () => {
    const ended = await g.signIn('cy@example.com');
    await g.request('POST', '/session/revoke-all', { session: ended });
    const staff = await shop.composed.app.inject({ method: 'GET', url: '/api/v1/health', headers: { origin: ORIGIN, 'x-adminium-public-session': ended } });
    expect(staff.headers[SESSION_ENDED_HEADER]).toBeUndefined();
  });

  it.skipIf(!available)('takes back the sign-in links still open to the address', async () => {
    const session = await g.signIn('dee@example.com');
    const asked = await g.request('POST', '/claim/link', { payload: { email: 'dee@example.com' }, proof: 'claim' });
    expect(asked.statusCode).toBe(202);
    await g.drain();
    const sent = (await mailOf(h.meta)).filter((m) => m.template === 'sign-in-link' && m.to === 'dee@example.com').at(-1)!;
    const token = /\/c#([A-Za-z0-9_-]{43})/.exec(sent.text + sent.html)![1]!;
    await g.request('POST', '/session/revoke-all', { session });
    const pressed = await g.request('POST', '/claim/link/verify', { payload: { token } });
    expect(pressed.statusCode).toBe(410);
  });

  it.skipIf(!available)("refuses a row's own link: it opens a row, not a person", async () => {
    const made = await order('lena@example.com', 'Lena');
    const signOut = await own.request('POST', '/session/revoke-all', { session: made.link.session });
    expect(signOut.statusCode).toBe(403);
    expect(link.codeOf(signOut)).toBe('PUBLIC_CLAIM_UNAVAILABLE');
    const forget = await own.request('DELETE', '/account', { session: made.link.session });
    expect(forget.statusCode).toBe(403);
    expect(link.codeOf(forget)).toBe('PUBLIC_CLAIM_UNAVAILABLE');
    // Without any session there is nobody to sign out.
    expect((await g.request('POST', '/session/revoke-all')).statusCode).toBe(404);
  });

  it.skipIf(!available)('reads the bank details for a session holder alone, and never lists them in the config', async () => {
    const anon = await g.request('GET', `/records/${h.real('settings')}_verified`);
    expect(anon.statusCode).toBe(404);
    const session = await g.signIn('eve@example.com');
    const signedIn = await g.request('GET', `/records/${h.real('settings')}_verified`, { session });
    expect(signedIn.statusCode, signedIn.body).toBe(200);
    expect((signedIn.json() as { data: Record<string, unknown>[] }).data).toEqual([{ bank_name: 'Town Bank', account_number: '12345678' }]);
    // The order's own link reads them on its own key.
    const made = await order('bank@example.com', 'Bank');
    const byLink = await own.request('GET', `/records/${h.real('settings')}_verified_2`, { session: made.link.session });
    expect(byLink.statusCode, byLink.body).toBe(200);
    const config = await g.request('GET', '/config');
    expect(Object.keys((config.json() as { data: { refs: Record<string, unknown> } }).data.refs)).not.toContain(`${h.real('settings')}_verified`);
  });

  it.skipIf(!available)('asks for a mailbox proved minutes ago before deleting anything', async () => {
    const session = await g.signIn('fay@example.com');
    await h.meta.db.updateTable('adminium_public_sessions').set({ createdAt: Date.now() - 11 * 60_000 }).where('id', '=', (await sessionOf(session))!).execute();
    const res = await g.request('DELETE', '/account', { session });
    expect(res.statusCode).toBe(403);
    expect(shop.codeOf(res)).toBe('PUBLIC_CODE_STEP_UP');
    expect((await h.rows(`select email from ${customers} where name = 'Fay'`))[0]!['email']).toBe('fay@example.com');
  });

  it.skipIf(!available)('deletes the details, keeps the rows, ends the sessions and the links, and tells the old address once', async () => {
    const made = await order('mia@example.com', 'Mia Okada');
    const heard: { cause?: unknown; table: { id: string } }[] = [];
    const listen = vi.spyOn(shop.composed.app.automations, 'onRecordEvent').mockImplementation(async (event) => {
      heard.push(event as never);
    });
    const other = await g.signIn('mia@example.com');
    const session = await g.signIn('mia@example.com');
    const asked = await g.request('POST', '/claim/link', { payload: { email: 'mia@example.com' }, proof: 'claim' });
    expect(asked.statusCode).toBe(202);
    await g.drain();
    const pending = (await mailOf(h.meta)).filter((m) => m.template === 'sign-in-link' && m.to === 'mia@example.com').at(-1)!;
    const token = /\/c#([A-Za-z0-9_-]{43})/.exec(pending.text + pending.html)![1]!;
    const mailBefore = (await mailOf(h.meta)).length;

    const res = await g.request('DELETE', '/account', { session });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ data: {} });
    listen.mockRestore();

    const person = (await h.rows(`select email, name, phone, forgotten_at from ${customers} where id = 1`))[0]!;
    expect([person['email'], person['name'], person['phone']]).toEqual([null, null, null]);
    expect(person['forgotten_at']).not.toBeNull();
    // The order keeps its own copies and its link.
    const kept = (await h.rows(`select customer_id, email, name, link_token from ${orders} where id = ${made.data.id}`))[0]!;
    expect([Number(kept['customer_id']), kept['email'], kept['name'], kept['link_token']]).toEqual([1, 'mia@example.com', 'Mia Okada', made.link.token]);
    // The order's own link still opens it.
    const opened = await own.request('POST', '/claim/token', { payload: { token: made.link.token } });
    expect(opened.statusCode, opened.body).toBe(200);
    // Every session of hers ended, saying why; her open link is taken back.
    const after = await mine(other);
    expect(after.statusCode).toBe(404);
    expect(after.headers[SESSION_ENDED_HEADER]).toBe('forgotten');
    expect((await g.request('POST', '/claim/link/verify', { payload: { token } })).statusCode).toBe(410);
    // One email, to the old address: what went and what stays. None about a change of address.
    const sent = (await mailOf(h.meta)).slice(mailBefore);
    expect(sent.map((m) => [m.template, m.to])).toEqual([['details-deleted', 'mia@example.com']]);
    expect(sent[0]!.text).toContain('Mia');
    // The rules hear it as a forgetting.
    expect(heard.filter((e) => e.table.id.endsWith(customers)).map((e) => e.cause)).toContain('forget');
    // The audit names the row, never what it held.
    const audit = (await auditRepo(h.meta).list({ limit: 200 })).find((row) => row.action === 'public.identity.forgotten');
    expect(audit).toBeDefined();
    expect(JSON.stringify(audit)).not.toContain('mia@example.com');
    // Signing in again finds nobody: the address is gone.
    const again = await g.request('POST', '/claim/link', { payload: { email: 'mia@example.com' }, proof: 'claim' });
    expect(again.statusCode).toBe(202);
    const before = (await mailOf(h.meta)).length;
    await g.drain();
    expect((await mailOf(h.meta)).slice(before).filter((m) => m.template === 'sign-in-link')).toEqual([]);
    // Mail for her ends: a message about her order finds no address on file, and goes nowhere.
    const messages = h.real('messages');
    await h.rows(`insert into ${messages} (kind, status, customer_id, order_id) values ('order-placed', 'queued', 1, ${String(made.data.id)})`);
    const beforeMail = (await mailOf(h.meta)).length;
    await shop.composed.app.outboxSender.sendApp('shop');
    expect((await mailOf(h.meta)).slice(beforeMail).filter((m) => m.to === 'mia@example.com')).toEqual([]);
    const skipped = await h.rows(`select status, error from ${messages} where customer_id = 1 and order_id = ${String(made.data.id)} and ${dialect === 'mysql' ? '`to`' : '"to"'} is null`);
    expect(skipped.length).toBeGreaterThan(0);
    expect(skipped.map((m) => [m['status'], m['error']])).toEqual(skipped.map(() => ['skipped', 'No email on file']));
    // A later order by the same address makes a new person; the old orders stay with the old one.
    const later = await order('mia@example.com', 'Mia');
    const newer = (await h.rows(`select customer_id from ${orders} where id = ${later.data.id}`))[0]!;
    expect(Number(newer['customer_id'])).not.toBe(1);
  });

  async function sessionOf(token: string): Promise<string | undefined> {
    const { hashPublishableKey } = await import('../src/public-api/keys.js');
    return (await publicSessionsRepo(h.meta).findByTokenHash(hashPublishableKey(token)))?.id;
  }
});

/** The shop where a guest finds themselves by their address and phone, and proves the mailbox by an emailed code. */
const byDetails = () => {
  const manifest = shopManifest({
    entries: () => [
      {
        table: 'customers',
        methods: ['GET'],
        select: ['name'],
        claim: { match: ['email', 'phone'], verify: 'email-code', email: 'email' },
        humanCheck: true,
        forget: { columns: ['email', 'name', 'phone'], stamp: 'forgotten_at' },
      },
      { table: 'orders', methods: ['GET'], level: 'verified', claimedBy: { table: 'customers', column: 'customer_id' }, select: ['id', 'status'] },
    ],
  });
  // No row opens by its own link here.
  delete manifest['publicKeys'];
  return manifest;
};

describe.each(LEGS)('a guest who only found themselves by their details — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let shop: Served;
  let g: ReturnType<typeof guest>;

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, byDetails());
    await mailReady(h.meta);
    await h.rows(`insert into ${h.real('customers')} (email, name, phone) values ('ivy@example.com', 'Ivy', '07700900123')`);
    shop = await servePublic(h, (h.reply['publicAccess'] as { keys: Record<string, string> }).keys['customer']!);
    g = guest(shop, h);
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await shop.close();
    await h.close();
  });

  it.skipIf(!available)('may neither sign the person out everywhere nor delete them', async () => {
    const claimed = await g.request('POST', '/claim', { payload: { match: { email: 'ivy@example.com', phone: '07700900123' } }, proof: 'claim' });
    expect(claimed.statusCode, claimed.body).toBe(200);
    const session = (claimed.json() as { data: { session: string } }).data;
    for (const [method, url] of [['POST', '/session/revoke-all'], ['DELETE', '/account']] as const) {
      const res = await g.request(method, url, { session: session.session, ...(method === 'POST' ? { payload: {} } : {}) });
      expect(res.statusCode, res.body).toBe(403);
      expect(shop.codeOf(res)).toBe('PUBLIC_CLAIM_LEVEL');
    }
    expect((await h.rows(`select email from ${h.real('customers')} where name = 'Ivy'`))[0]!['email']).toBe('ivy@example.com');
  });
});

/** The shop whose person entry shows the phone number first. */
const phoneFirst = () =>
  shopManifest({
    entries: (entries) =>
      entries.map((entry) => (entry['table'] === 'customers' && entry['forget'] !== undefined ? { ...entry, select: ['phone', 'name', 'email'] } : entry)),
  });

describe.each(LEGS)("the last email to a guest who deleted their details — %s", (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let shop: Served;
  let g: ReturnType<typeof guest>;

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, phoneFirst());
    await mailReady(h.meta);
    await h.rows(`insert into ${h.real('customers')} (email, name, phone) values ('nia@example.com', 'Nia', '+44 7700 900456')`);
    shop = await servePublic(h, (h.reply['publicAccess'] as { keys: Record<string, string> }).keys['customer']!);
    g = guest(shop, h);
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await shop.close();
    await h.close();
  });

  it.skipIf(!available)('greets them by the name the app names them by, never by the first column the entry shows', async () => {
    const session = await g.signIn('nia@example.com');
    const before = (await mailOf(h.meta)).length;
    const res = await g.request('DELETE', '/account', { session });
    expect(res.statusCode, res.body).toBe(200);
    const sent = (await mailOf(h.meta)).slice(before);
    expect(sent.map((m) => m.template)).toEqual(['details-deleted']);
    expect(sent[0]!.text).toContain('Nia');
    expect(sent[0]!.text + sent[0]!.html).not.toContain('7700');
  });
});
