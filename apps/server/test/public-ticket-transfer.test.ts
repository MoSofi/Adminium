// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A ticket sent to a friend, end to end over the public API of the box
 * office fixture, installed by the real installer, on every engine:
 *
 *  - the buyer sends it (pending until accepted; the old code still works),
 *    and the friend is emailed the ticket's own link — only that ticket's;
 *  - the friend opens it by that link and accepts: they are found or made by
 *    the address it went to and become its holder, it gets a new code, and
 *    it shows in their own tickets once they sign in;
 *  - from then on the buyer reads it without its code or the friend's
 *    address, through their tickets and through the order's own link;
 *  - one live offer per ticket; an offer nobody takes comes back at its time;
 *  - so many sends a day to one address, and a name that is only a name.
 */
import { readFileSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runTimedMoves } from '../src/states/timed-moves.js';
import { installInvoicing, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { guest, mailOf, mailReady } from './person-fixture.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Doc = Record<string, unknown>;
const FIXTURE = new URL('../../../packages/manifest/test/fixtures/ticket-transfer.manifest.json', import.meta.url);

/** The box office, with two sends a day allowed to one address (five in the fixture) so the limit is reached quickly. */
function boxOffice(): Doc {
  const manifest = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Doc;
  for (const entry of manifest['publicAccess'] as Doc[]) {
    const limits = entry['limits'] as { perValue?: { n: number } } | undefined;
    if (limits?.perValue !== undefined) limits.perValue.n = 2;
  }
  return manifest;
}

describe.each(LEGS)('a ticket sent to a friend — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let shop: Served;
  let link: Served;
  let ticket: Served;
  let buyer: ReturnType<typeof guest>;
  let byLink: ReturnType<typeof guest>;
  let byTicket: ReturnType<typeof guest>;
  const t = (ref: string) => `boxoffice_${ref}`;
  let order: { id: number; tickets: { id: number; code: string }[]; linkSession: string };
  let mia: string;

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, boxOffice());
    await mailReady(h.meta);
    await h.rows(`insert into ${t('settings')} (offer_hours) values (48)`);
    await h.rows(`insert into ${t('events')} (id, name, starts_at) values (1, 'Night Tide', '2026-12-01 19:00:00')`);
    await h.rows(`insert into ${t('ticket_types')} (id, event_id, name, price) values (1, 1, 'Standard', 45)`);
    const keys = (h.reply['publicAccess'] as { keys: Record<string, string> }).keys;
    shop = await servePublic(h, keys['customer']!);
    link = await servePublic(h, keys['link']!);
    ticket = await servePublic(h, keys['ticket']!);
    buyer = guest(shop, h);
    byLink = guest(link, h, 30_000);
    byTicket = guest(ticket, h, 60_000);
    // Mia buys four tickets as a guest, then signs in by the link emailed to her.
    const made = await buyer.request('POST', `/records/${t('orders')}_verified_2`, {
      payload: { values: { event_id: 1, email: 'mia@example.com', name: 'Mia' }, children: { tickets: [1, 2, 3, 4].map(() => ({ values: { ticket_type_id: 1 } })) } },
      proof: 'write',
    });
    expect(made.statusCode, made.body).toBe(201);
    const body = made.json() as { data: { id: number }; children: { tickets: { data: { id: number; code: string } }[] }; link: { session: string } };
    order = { id: body.data.id, tickets: body.children.tickets.map((c) => c.data), linkSession: body.link.session };
    mia = await buyer.signIn('mia@example.com');
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await shop.close();
    await link.close();
    await ticket.close();
    await h.close();
  });

  const ticketRow = async (id: number) => (await h.rows(`select status, code, holder_customer_id, holder_email, holder_name, pending_email, link_token from ${t('tickets')} where id = ${id}`))[0]!;
  const mine = async (session: string) =>
    (((await buyer.request('GET', `/records/${t('tickets')}_verified`, { session })).json() as { data: Doc[] }).data ?? []).sort((a, b) => Number(a['id']) - Number(b['id']));
  /** Every open offer's time run out, and the minute job run: an offer nobody took goes back to the buyer. */
  const pastOffers = async () => {
    const past = dialect === 'sqlite' ? `'2020-01-01T00:00:00.000Z'` : dialect === 'postgres' ? `'2020-01-01 00:00:00+00'` : `'2020-01-01 00:00:00'`;
    await h.rows(`update ${t('tickets')} set offer_until = ${past} where status = 'offered'`);
    return runTimedMoves({ meta: h.meta, manager: h.manager }, h.connectionId, {}, new Date());
  };
  const send = (id: number, email: string, name: string) =>
    buyer.request('PATCH', `/records/${t('tickets')}_verified/${id}`, { payload: { values: { status: 'offered', pending_email: email, pending_name: name } }, session: mia });

  it.skipIf(!available)('sends a ticket, emails the friend its own link, and lets the friend accept it by that link', async () => {
    const [first] = order.tickets;
    const sent = await send(first!.id, 'kai@friends.org', 'Kai');
    expect(sent.statusCode, sent.body).toBe(200);
    // Pending: the old code still works, the buyer still reads it.
    expect((await ticketRow(first!.id))['code']).toBe(first!.code);
    // The friend's email: the ticket's own link, and no other row's code.
    await shop.composed.app.outboxSender.sendApp('boxoffice');
    const mail = (await mailOf(h.meta)).filter((m) => m.to === 'kai@friends.org');
    expect(mail).toHaveLength(1);
    const token = String((await ticketRow(first!.id))['link_token']);
    expect(mail[0]!.text).toContain(token);
    expect(mail[0]!.text).toContain('Kai');
    const orderToken = String((await h.rows(`select link_token from ${t('orders')} where id = ${order.id}`))[0]!['link_token']);
    expect(mail[0]!.text).not.toContain(orderToken);

    // The friend opens the ticket's link: a verified session on that one ticket.
    const opened = await byTicket.request('POST', '/claim/token', { payload: { token } });
    expect(opened.statusCode, opened.body).toBe(200);
    const kaiTicket = (opened.json() as { data: { session: string; level: string } }).data;
    expect(kaiTicket.level).toBe('verified');
    const seen = await byTicket.request('GET', `/records/${t('tickets')}_claimed`, { session: kaiTicket.session });
    expect((seen.json() as { data: Doc[] }).data).toMatchObject([{ id: first!.id, status: 'offered', pending_name: 'Kai' }]);

    // Accepting: the friend becomes the holder, found (or made) by the address the link went to; a new code.
    const accepted = await byTicket.request('PATCH', `/records/${t('tickets')}_claimed/${first!.id}`, { payload: { values: { status: 'valid' } }, session: kaiTicket.session });
    expect(accepted.statusCode, accepted.body).toBe(200);
    const row = await ticketRow(first!.id);
    const kai = (await h.rows(`select id, email from ${t('customers')} where email = 'kai@friends.org'`))[0]!;
    expect(Number(row['holder_customer_id'])).toBe(Number(kai['id']));
    expect([row['status'], row['holder_email'], row['holder_name']]).toEqual(['valid', 'kai@friends.org', 'Kai']);
    expect(row['code']).not.toBe(first!.code);
    // The change's answer never carries the new code.
    expect(JSON.stringify(accepted.json())).not.toContain(String(row['code']));

    // The friend signs in: the ticket is among their own, with its new code.
    const kaiSession = await buyer.signIn('kai@friends.org');
    const theirs = await buyer.request('GET', `/records/${t('tickets')}_verified_2`, { session: kaiSession });
    expect((theirs.json() as { data: Doc[] }).data).toMatchObject([{ id: first!.id, code: row['code'] }]);
  });

  it.skipIf(!available)("keeps the friend's code and address from the buyer, wherever the buyer reads it", async () => {
    const [first, second] = order.tickets;
    const row = await ticketRow(first!.id);
    const listed = await mine(mia);
    expect(listed.find((r) => r['id'] === first!.id)).toMatchObject({ code: null, holder_email: null, holder_name: 'Kai' });
    // A ticket of theirs nobody else holds keeps its code.
    expect(listed.find((r) => r['id'] === second!.id)).toMatchObject({ code: second!.code });
    const one = await buyer.request('GET', `/records/${t('tickets')}_verified/${first!.id}`, { session: mia });
    expect((one.json() as { data: Doc }).data).toMatchObject({ code: null, holder_email: null });
    // Through the order's own link too.
    const viaLink = await byLink.request('GET', `/records/${t('tickets')}_verified_3`, { session: order.linkSession });
    expect(viaLink.statusCode, viaLink.body).toBe(200);
    const linked = (viaLink.json() as { data: Doc[] }).data;
    expect(linked.find((r) => r['id'] === first!.id)).toMatchObject({ code: null, holder_email: null });
    expect(JSON.stringify(linked)).not.toContain(String(row['code']));
    expect(JSON.stringify(listed)).not.toContain(String(row['code']));
    // A handed-on ticket is not offered again by the buyer.
    expect((await send(first!.id, 'someone@friends.org', 'Someone')).statusCode).toBe(404);
  });

  it.skipIf(!available)('keeps one live offer per ticket, and gives an offer nobody takes back at its time', async () => {
    const [, second] = order.tickets;
    expect((await send(second!.id, 'lee@friends.org', 'Lee')).statusCode).toBe(200);
    // Already offered: not offered twice.
    expect((await send(second!.id, 'other@friends.org', 'Other')).statusCode).toBe(404);
    await pastOffers();
    const row = await ticketRow(second!.id);
    expect([row['status'], row['holder_customer_id'], row['code']]).toEqual(['valid', null, second!.code]);
    expect((await mine(mia)).find((r) => r['id'] === second!.id)).toMatchObject({ code: second!.code });
  });

  it.skipIf(!available)('sends to one address so many times a day, and a name that is only a name', async () => {
    const [, , third, fourth] = order.tickets;
    const plain = await send(third!.id, 'noa@friends.org', 'visit www.example.com');
    expect(plain.statusCode).toBe(400);
    expect(shop.codeOf(plain)).toBe('PUBLIC_WRITE_REFUSED');
    expect((plain.json() as { error: { params?: Doc } }).error.params).toEqual({ column: 'pending_name' });
    // Two a day to one mailbox (in this copy of the app), however its address is dressed up.
    expect((await send(third!.id, 'noa@friends.org', 'Noa')).statusCode).toBe(200);
    expect((await send(fourth!.id, 'Noa+tickets@Friends.org', 'Noa')).statusCode).toBe(200);
    await pastOffers();
    const again = await send(third!.id, 'noa@friends.org', 'Noa');
    expect(again.statusCode).toBe(409);
    expect(shop.codeOf(again)).toBe('PUBLIC_LIMIT_REACHED');
    // A refused send is not counted, and changed nothing.
    expect((await ticketRow(third!.id))['status']).toBe('valid');
  });
});
