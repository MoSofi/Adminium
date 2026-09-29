// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Send it again" through a row's own link — over the public API of a box
 * office installed by the real installer, on every engine:
 *
 *  - a held order moved on to confirming through its own link gets one
 *    "confirm your order" email; asking for it again through the same link
 *    makes the confirm link again and mails it, once, to the row's own
 *    address — never to one in the request, and never in the reply;
 *  - the first email's confirm link opens nothing once the new one is made,
 *    and the new one confirms; the order's own link that asked stays open;
 *  - asked while the order is not confirming: a bare refusal, nothing queued,
 *    no code made, nothing counted;
 *  - five a day for one order, whichever link session asks; a sixth is
 *    refused and counts nothing;
 *  - an order with no address anywhere: refused, nothing made, nothing queued;
 *  - asks at once: each makes one new link with its email, or is refused —
 *    never two live codes, never a new code without its email.
 */
import { createHash } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { publicEndpointsRepo } from '@adminium/meta';
import { sql } from 'kysely';

import { definitionToResource, parseDefinition, printDefinition } from '../src/public-api/endpoint.js';
import { installInvoicing, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { guest, mailOf, mailReady, shopManifest } from './person-fixture.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Doc = Record<string, unknown>;

/** The shop as a box office: an order is held, confirmed through its own link, and confirmed again by an emailed code. */
export function boxOffice(when: Doc | undefined = { where: [{ column: 'status', eq: 'confirming' }] }): Doc {
  const manifest = shopManifest({
    entries: (entries) => [
      ...entries.map((entry) => {
        if (entry['table'] !== 'orders' || entry['key'] !== 'link') return entry;
        return {
          ...entry,
          writable: ['note', 'status'],
          writableValues: { status: ['confirming'] },
          writableWhen: { status: ['held', 'confirming'] },
          newLink: { column: 'confirm_token', kind: 'transfer-confirm', ...(when === undefined ? {} : { when }) },
        };
      }),
      {
        table: 'orders',
        key: 'confirm',
        methods: ['GET', 'PATCH'],
        claim: { by: 'token', column: 'confirm_token', own: true, address: 'email' },
        select: ['id', 'status'],
        writable: ['status'],
        writableValues: { status: ['awaiting_transfer'] },
        writableWhen: { status: ['confirming'] },
      },
    ],
  });
  manifest['publicKeys'] = { link: {}, confirm: {} };
  const tables = (manifest['requiredSchema'] as { tables: Doc[] }).tables;
  const orders = tables.find((t) => t['ref'] === 'orders')!['columns'] as Doc[];
  orders.find((c) => c['ref'] === 'status')!['enum'] = ['held', 'confirming', 'awaiting_transfer'];
  orders.find((c) => c['ref'] === 'status')!['default'] = 'held';
  orders.push({ ref: 'confirm_token', type: 'text', maxLength: 16, nullable: true, rules: { code: { length: 16 } } });
  const messages = tables.find((t) => t['ref'] === 'messages')!['columns'] as Doc[];
  messages.find((c) => c['ref'] === 'kind')!['enum'] = ['order-placed', 'transfer-confirm'];
  messages.push({ ref: 'repeat_key', type: 'text', maxLength: 64, nullable: true });
  const outbox = manifest['outbox'] as { kinds: Record<string, string>; columns: Record<string, string>; producers: Doc[] };
  outbox.kinds['transfer-confirm'] = 'shop-transfer-confirm';
  outbox.columns['repeatKey'] = 'repeat_key';
  outbox.producers.push({ kind: 'transfer-confirm', link: 'order_id', onChange: { table: 'orders', column: 'status', to: 'confirming' } });
  (manifest['emailTemplates'] as Doc[]).push({
    key: 'shop-transfer-confirm',
    name: 'Confirm your order',
    locales: { 'en-US': { subject: 'Confirm your order', blocks: [{ block: 'email.text', data: { text: 'Confirm it here: {{manage_url}}#{{order.confirm_token}}' } }] } },
  });
  return manifest;
}

describe.each(LEGS)('"send it again" through an order\'s own link — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let shop: Served;
  let link: Served;
  let confirm: Served;
  let g: ReturnType<typeof guest>;
  let own: ReturnType<typeof guest>;
  let byCode: ReturnType<typeof guest>;
  let orders: string;
  let messages: string;
  const ref = 'shop_orders_claimed';
  /** The confirm code's own entry on the same table: the next ref of the same name. */
  const confirmRef = 'shop_orders_claimed_2';

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, boxOffice());
    await mailReady(h.meta);
    const keys = (h.reply['publicAccess'] as { keys: Record<string, string> }).keys;
    shop = await servePublic(h, keys['customer']!);
    link = await servePublic(h, keys['link']!);
    confirm = await servePublic(h, keys['confirm']!);
    g = guest(shop, h);
    own = guest(link, h, 40_000);
    byCode = guest(confirm, h, 80_000);
    orders = h.real('orders');
    messages = h.real('messages');
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await shop.close();
    await link.close();
    await confirm.close();
    await h.close();
  });

  /** A held order, and the session on its own link the create handed back. */
  const order = async (email: string, name: string) => {
    const res = await g.request('POST', `/records/${orders}_verified_2`, { payload: { values: { email, name }, children: { order_items: [{ values: { dish: 'Soup', qty: 1 } }] } }, proof: 'write' });
    expect(res.statusCode, res.body).toBe(201);
    const made = res.json() as { data: { id: number }; link: { token: string; session: string } };
    return { id: made.data.id, session: made.link.session, token: made.link.token };
  };
  const confirmCode = async (id: number) => String((await h.rows(`select confirm_token from ${orders} where id = ${String(id)}`))[0]!['confirm_token']);
  const statusOf = async (id: number) => String((await h.rows(`select status from ${orders} where id = ${String(id)}`))[0]!['status']);
  /** The confirm emails queued for an order: the first (no repeat key), then one per new code. */
  const confirms = async (id: number) =>
    (await h.rows(`select status, repeat_key, ${dialect === 'mysql' ? '`to`' : '"to"'} as address from ${messages} where kind = 'transfer-confirm' and order_id = ${String(id)} order by id`)).map((row) => ({
      status: String(row['status']),
      repeat: row['repeat_key'] === null ? null : String(row['repeat_key']),
      to: row['address'] === null ? null : String(row['address']),
    }));
  /** The repeat key a message about a code carries: the code, hashed with its kind. */
  const keyOf = (code: string) => createHash('sha256').update(JSON.stringify(['transfer-confirm', code])).digest('base64url');
  const toConfirming = async (id: number, session: string) => {
    const res = await own.request('PATCH', `/records/${ref}/${String(id)}`, { session, payload: { values: { status: 'confirming' } } });
    expect(res.statusCode, res.body).toBe(200);
  };
  const again = (id: number | string, session: string, payload?: Doc) => own.request('POST', `/records/${ref}/${String(id)}/new-link`, { session, ...(payload === undefined ? {} : { payload }) });
  /** A session opened by a confirm code (the confirm email's link), or the refusal. */
  const openByCode = (token: string) => byCode.request('POST', '/claim/token', { payload: { token } });
  const sendMail = async () => shop.composed.app.outboxSender.sendApp('shop');
  /** Every new link asked for so far made two minutes earlier: past the moments in which a second ask makes no other. */
  const earlier = async () => {
    const rows = await h.meta.db.selectFrom('adminium_public_challenges').select(['id', 'createdAt']).where('purpose', '=', 'new-link').execute();
    for (const row of rows) await h.meta.db.updateTable('adminium_public_challenges').set({ createdAt: Number(row.createdAt) - 120_000 }).where('id', '=', row.id).execute();
  };
  /** Every ask for a new link counted so far, on any row. */
  const asksCounted = async () => (await h.meta.db.selectFrom('adminium_public_challenges').select('id').where('purpose', '=', 'new-link').execute()).length;
  const renewalsOf = async () => (await h.meta.db.selectFrom('adminium_audit_log').select('id').where('action', '=', 'public.link.renewed').execute()).length;

  it.skipIf(!available)('keeps "send it again" and its when in the stored form, on the order\'s own link alone', async () => {
    const rows = await publicEndpointsRepo(h.meta).listByConnection(h.connectionId);
    const stored = rows.find((row) => row.ref === ref)!;
    const parsed = parseDefinition(stored.definition);
    if (!parsed.ok) throw new Error(stored.definition);
    const expected = { column: 'confirm_token', kind: 'transfer-confirm', when: { where: [{ column: 'status', eq: 'confirming' }] } };
    expect(parsed.definition.new_link).toEqual(expected);
    expect(printDefinition(parsed.definition)).toBe(stored.definition);
    expect(definitionToResource(ref, parsed.definition, parsed.definition.methods, null).newLink).toEqual(expected);
    expect(rows.filter((row) => row.ref !== ref && JSON.parse(row.definition).new_link !== undefined)).toEqual([]);
  });

  it.skipIf(!available)('mails the confirm link again to the order\'s own address: the old one opens nothing, the new one confirms', async () => {
    // Someone with two orders first: Ana's order and her person are numbered apart, so a mail to the wrong one shows.
    await order('zoe@fieldmail.io', 'Zoe');
    await order('zoe@fieldmail.io', 'Zoe');
    await order('yan@fieldmail.io', 'Yan');
    const made = await order('ana@fieldmail.io', 'Ana');
    const person = (await h.rows(`select customer_id from ${orders} where id = ${String(made.id)}`))[0]!['customer_id'];
    expect(Number(person)).not.toBe(made.id);
    await toConfirming(made.id, made.session);
    expect(await confirms(made.id)).toEqual([{ status: 'queued', repeat: null, to: 'ana@fieldmail.io' }]);
    const first = await confirmCode(made.id);
    // The first email's link opens the order, and that session is closed by the new link.
    const opened = await openByCode(first);
    expect(opened.statusCode, opened.body).toBe(200);
    const byFirst = (opened.json() as { data: { session: string } }).data.session;
    const readByFirst = await byCode.request('GET', `/records/${confirmRef}/${String(made.id)}`, { session: byFirst });
    expect(readByFirst.statusCode, readByFirst.body).toBe(200);

    // Asked again, naming another address: the reply is empty, and the mail goes to the order's own.
    const res = await again(made.id, made.session, { email: 'mallory@elsewhere.io', to: 'mallory@elsewhere.io' });
    expect(res.statusCode, res.body).toBe(202);
    expect(res.json()).toEqual({ data: {} });
    const fresh = await confirmCode(made.id);
    expect(fresh).not.toBe(first);
    expect(fresh).toMatch(/^[0-9A-Z]{16}$/);
    expect(res.body).not.toContain(fresh);
    expect(await confirms(made.id)).toEqual([
      { status: 'queued', repeat: null, to: 'ana@fieldmail.io' },
      { status: 'queued', repeat: keyOf(fresh), to: 'ana@fieldmail.io' },
    ]);
    await sendMail();
    const mail = (await mailOf(h.meta)).filter((m) => m.template === 'shop-transfer-confirm' && m.to === 'ana@fieldmail.io');
    expect(mail).toHaveLength(2);
    expect(mail[1]!.text).toContain(`#${fresh}`);
    expect((await mailOf(h.meta)).some((m) => m.to.includes('mallory'))).toBe(false);

    // The first email's link opens nothing now, as any unknown code; the session it opened is closed.
    const stale = await openByCode(first);
    const unknown = await openByCode('ZZZZZZZZZZZZZZZZ');
    expect([stale.statusCode, unknown.statusCode]).toEqual([404, 404]);
    expect(JSON.parse(stale.body)).toEqual(JSON.parse(unknown.body));
    const closed = await byCode.request('GET', `/records/${confirmRef}/${String(made.id)}`, { session: byFirst });
    expect(closed.statusCode === 404 || closed.statusCode === 401, closed.body).toBe(true);
    // The order's own link that asked is still open.
    const still = await own.request('GET', `/records/${ref}/${String(made.id)}`, { session: made.session });
    expect(still.statusCode, still.body).toBe(200);
    expect(still.body).not.toContain(fresh);

    // The new link confirms the order.
    const byNew = await openByCode(fresh);
    expect(byNew.statusCode, byNew.body).toBe(200);
    const session = (byNew.json() as { data: { session: string } }).data.session;
    const confirmed = await byCode.request('PATCH', `/records/${confirmRef}/${String(made.id)}`, { session, payload: { values: { status: 'awaiting_transfer' } } });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(await statusOf(made.id)).toBe('awaiting_transfer');
    // The audit names the row, never a code.
    const audit = JSON.stringify(await h.meta.db.selectFrom('adminium_audit_log').selectAll().where('action', '=', 'public.link.renewed').execute());
    expect(audit).not.toContain(fresh);
    expect(audit).not.toContain(first);
  });

  it.skipIf(!available)('refuses, barely, while the order is not confirming: nothing queued, no code made, nothing counted', async () => {
    const held = await order('ben@fieldmail.io', 'Ben');
    const code = await confirmCode(held.id);
    const counted = await asksCounted();
    const refused = await again(held.id, held.session);
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json()).toEqual({ error: { code: 'PUBLIC_WRITE_REFUSED', message: 'That write was refused.' } });
    // Confirmed already: the same.
    await toConfirming(held.id, held.session);
    const session = ((await openByCode(code)).json() as { data: { session: string } }).data.session;
    expect((await byCode.request('PATCH', `/records/${confirmRef}/${String(held.id)}`, { session, payload: { values: { status: 'awaiting_transfer' } } })).statusCode).toBe(200);
    const after = await again(held.id, held.session);
    expect(after.statusCode).toBe(409);
    expect(JSON.parse(after.body)).toEqual(JSON.parse(refused.body));
    expect(await confirmCode(held.id)).toBe(code);
    expect((await confirms(held.id)).filter((m) => m.repeat !== null)).toEqual([]);
    expect(await asksCounted()).toBe(counted);
  });

  it.skipIf(!available)("answers another order's id as one that is not there, and never through a confirm code", async () => {
    const mine = await order('cara@fieldmail.io', 'Cara');
    const theirs = await order('dev@fieldmail.io', 'Dev');
    await toConfirming(mine.id, mine.session);
    await toConfirming(theirs.id, theirs.session);
    const code = await confirmCode(theirs.id);
    const other = await again(theirs.id, mine.session);
    const missing = await again(999_999, mine.session);
    expect([other.statusCode, missing.statusCode]).toEqual([404, 404]);
    expect(JSON.parse(other.body)).toEqual(JSON.parse(missing.body));
    // The confirm code's own session makes no new link: that key has none to make.
    const session = ((await openByCode(code)).json() as { data: { session: string } }).data.session;
    expect((await byCode.request('POST', `/records/${confirmRef}/${String(theirs.id)}/new-link`, { session })).statusCode).toBe(404);
    // Signed in by email on the customer key: that entry makes no confirm link.
    expect((await g.request('POST', `/records/${ref}/${String(theirs.id)}/new-link`, { session: theirs.session })).statusCode).toBe(404);
    expect(await confirmCode(theirs.id)).toBe(code);
  });

  it.skipIf(!available)('makes five a day for one order, whichever of its link sessions asks; a sixth is refused and counts nothing', async () => {
    const made = await order('eve@fieldmail.io', 'Eve');
    await toConfirming(made.id, made.session);
    await sendMail();
    // A second session on the same order's own link, opened from its code.
    const second = ((await own.request('POST', '/claim/token', { payload: { token: made.token } })).json() as { data: { session: string } }).data.session;
    const sessions = [made.session, second];
    for (let i = 0; i < 5; i += 1) {
      await earlier();
      const res = await again(made.id, sessions[i % 2]!);
      expect(res.statusCode, res.body).toBe(202);
      // Sent as it comes: an email carries the order's code as it is when it goes.
      await sendMail();
    }
    const kept = await confirmCode(made.id);
    await earlier();
    const counted = await asksCounted();
    const sixth = await again(made.id, second);
    expect(sixth.statusCode).toBe(409);
    expect(sixth.json()).toMatchObject({ error: { code: 'PUBLIC_LIMIT_REACHED' } });
    expect(await confirmCode(made.id)).toBe(kept);
    expect(await asksCounted()).toBe(counted);
    // One message per new code, each to the order's own address; the last one carries the live code.
    const sent = (await confirms(made.id)).filter((m) => m.repeat !== null);
    expect(sent).toHaveLength(5);
    expect(new Set(sent.map((m) => m.repeat)).size).toBe(5);
    expect(sent.at(-1)!.repeat).toBe(keyOf(kept));
    expect(sent.every((m) => m.to === 'eve@fieldmail.io')).toBe(true);
    // Each email carried its own code, and only the live one opens the order.
    const codes = (await mailOf(h.meta)).filter((m) => m.template === 'shop-transfer-confirm' && m.to === 'eve@fieldmail.io').map((m) => /#([0-9A-Z]{16})/.exec(m.text)![1]!);
    expect(codes).toHaveLength(6);
    expect(codes.slice(1).map(keyOf)).toEqual(sent.map((m) => m.repeat));
    for (const code of codes.slice(0, -1)) expect((await openByCode(code)).statusCode).toBe(404);
    expect((await openByCode(kept)).statusCode).toBe(200);
  });

  it.skipIf(!available)('refuses an order with no address to mail: nothing made, nothing queued', async () => {
    const made = await order('finn@fieldmail.io', 'Finn');
    await toConfirming(made.id, made.session);
    const code = await confirmCode(made.id);
    // The order's person has no address any more (the desk emptied it): the outbox has nowhere to send it.
    const customer = (await h.rows(`select customer_id from ${orders} where id = ${String(made.id)}`))[0]!['customer_id'];
    await h.rows(`update ${h.real('customers')} set email = null where id = ${String(customer)}`);
    const res = await again(made.id, made.session);
    expect(res.statusCode, res.body).toBe(503);
    expect(res.json()).toMatchObject({ error: { code: 'PUBLIC_CODE_UNAVAILABLE' } });
    expect(await confirmCode(made.id)).toBe(code);
    expect((await confirms(made.id)).filter((m) => m.repeat !== null)).toEqual([]);
  });

  it.skipIf(!available)('makes one new link with its email for asks at once, or refuses: never two live codes', async () => {
    const made = await order('gil@fieldmail.io', 'Gil');
    await toConfirming(made.id, made.session);
    const first = await confirmCode(made.id);
    const before = await renewalsOf();
    for (let round = 0; round < 2; round += 1) {
      await earlier();
      const asks = await Promise.all([again(made.id, made.session), again(made.id, made.session), again(made.id, made.session), again(made.id, made.session)]);
      for (const res of asks) expect([202, 409, 503], res.body).toContain(res.statusCode);
      expect(asks.filter((res) => res.statusCode === 202).length).toBeGreaterThan(0);
    }
    // Each round made one new code, each with its one email; only the last one opens the order.
    const made2 = (await renewalsOf()) - before;
    const sent = (await confirms(made.id)).filter((m) => m.repeat !== null);
    expect(made2).toBe(2);
    expect(sent).toHaveLength(2);
    const live = await confirmCode(made.id);
    expect(sent.at(-1)!.repeat).toBe(keyOf(live));
    expect(sent[0]!.repeat).not.toBe(keyOf(live));
    expect((await openByCode(first)).statusCode).toBe(404);
    expect((await openByCode(live)).statusCode).toBe(200);
  });

  it.skipIf(!available || dialect === 'sqlite')('refuses an ask whose order is confirmed while it waits for the row: no new code, no email, nothing counted', async () => {
    const made = await order('ivy@fieldmail.io', 'Ivy');
    await toConfirming(made.id, made.session);
    const code = await confirmCode(made.id);
    await earlier();
    const counted = await asksCounted();
    // Another writer holds the order, over a pool of its own: the ask reads it, is counted, and waits to renew.
    const other = await h.twin();
    const { db } = await other.manager.data(h.connectionId);
    let ask: ReturnType<typeof again> | undefined;
    try {
      await db.transaction().execute(async (trx) => {
        await sql.raw(`select id from ${orders} where id = ${String(made.id)} for update`).execute(trx);
        ask = again(made.id, made.session);
        for (let i = 0; i < 400 && (await asksCounted()) === counted; i += 1) await new Promise((resolve) => setTimeout(resolve, 25));
        expect(await asksCounted()).toBe(counted + 1);
        await new Promise((resolve) => setTimeout(resolve, 300));
        // The buyer's confirm lands first.
        await sql.raw(`update ${orders} set status = 'awaiting_transfer' where id = ${String(made.id)}`).execute(trx);
      });
    } finally {
      await other.close();
    }
    const res = await ask!;
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json()).toEqual({ error: { code: 'PUBLIC_WRITE_REFUSED', message: 'That write was refused.' } });
    expect(await confirmCode(made.id)).toBe(code);
    expect((await confirms(made.id)).filter((m) => m.repeat !== null)).toEqual([]);
    expect(await asksCounted()).toBe(counted);
  });

  it.skipIf(!available)('an ask racing the confirm: a new code only while still confirming, and never one without its email', async () => {
    const made = await order('hal@fieldmail.io', 'Hal');
    await toConfirming(made.id, made.session);
    const code = await confirmCode(made.id);
    const session = ((await openByCode(code)).json() as { data: { session: string } }).data.session;
    await earlier();
    const [ask, confirmed] = await Promise.all([again(made.id, made.session), byCode.request('PATCH', `/records/${confirmRef}/${String(made.id)}`, { session, payload: { values: { status: 'awaiting_transfer' } } })]);
    expect([202, 409, 503]).toContain(ask.statusCode);
    expect([200, 404, 401, 409]).toContain(confirmed.statusCode);
    const sent = (await confirms(made.id)).filter((m) => m.repeat !== null);
    const live = await confirmCode(made.id);
    if (live === code) expect(sent).toEqual([]);
    else {
      expect(sent).toHaveLength(1);
      expect(sent[0]!.repeat).toBe(keyOf(live));
    }
  });
});
