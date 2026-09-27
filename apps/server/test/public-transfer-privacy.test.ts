// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A ticket handed to a friend never shows its new code to the one who sent
 * it — not through a door that is not a read of the entry that withholds it:
 *
 *  - a retry of the create that made the order answers the order's rows as
 *    they are now, read as the buyer who made it: a ticket the friend took
 *    comes back without its new code;
 *  - an email to the buyer — a value of the ticket, a list of the order's
 *    tickets, a QR code of either — prints the friend's ticket without its
 *    code; the friend's own email still carries it;
 *  - a ticket's own link is bound to the address it was sent to: an offer that
 *    lapsed and went to someone else gives the link a new code, and a session
 *    the first friend opened while it was theirs opens nothing once the ticket
 *    is someone else's — they read nothing of the new offer and accept nothing.
 */
import { readFileSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { decryptSecret } from '../src/config/secrets.js';
import { emailEnvelopeKey } from '../src/email/send.js';
import { runTimedMoves } from '../src/states/timed-moves.js';
import { TEST_SECRET } from './helpers.js';
import { installInvoicing, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { guest, mailOf, mailReady } from './person-fixture.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Doc = Record<string, unknown>;
const FIXTURE = new URL('../../../packages/manifest/test/fixtures/ticket-transfer.manifest.json', import.meta.url);

/**
 * The box office, and two more emails a desk may queue to anyone: the order's
 * tickets listed with their codes and QR codes, and one ticket's code (as text
 * and as a QR code).
 */
function boxOffice(): Doc {
  const manifest = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Doc;
  // The order's own link reads its tickets with no `withhold` of its own: what the buyer's entry withholds holds there too.
  const byLink = (manifest['publicAccess'] as Doc[]).find((entry) => entry['table'] === 'tickets' && entry['key'] === 'link')!;
  delete byLink['withhold'];
  const messages = (manifest['requiredSchema'] as { tables: Doc[] }).tables.find((table) => table['ref'] === 'messages')!;
  const columns = messages['columns'] as Doc[];
  columns.find((column) => column['ref'] === 'kind')!['enum'] = ['ticket-offered', 'your-tickets', 'ticket-note'];
  columns.push({ ref: 'order_id', type: 'fk', references: 'orders', nullable: true });
  const outbox = manifest['outbox'] as { kinds: Record<string, string>; links: Record<string, string> };
  outbox.links['order'] = 'order_id';
  outbox.kinds['your-tickets'] = 'boxoffice-your-tickets';
  outbox.kinds['ticket-note'] = 'boxoffice-ticket-note';
  const templates = manifest['emailTemplates'] as Doc[];
  templates.push(
    {
      key: 'boxoffice-your-tickets',
      name: 'Your tickets',
      locales: {
        'en-US': {
          subject: 'Your tickets',
          blocks: [
            { block: 'email.text', data: { text: '{{recipient.first_name}}, your tickets:' } },
            { id: 'tickets', block: 'email.rows', data: { from: { link: 'order', table: 'tickets', via: 'order_id' }, row: { title: 'Ticket {{row.id}}', meta: 'Code {{row.code}}', image: '{{row.code.qr}}' } } },
          ],
        },
      },
    },
    {
      key: 'boxoffice-ticket-note',
      name: 'Ticket note',
      locales: {
        'en-US': {
          subject: 'Your ticket',
          blocks: [
            { block: 'email.text', data: { text: 'Ticket {{ticket.id}}, code [{{ticket.code}}]' } },
            { block: 'email.image', data: { qr: '{{ticket.code.qr}}' } },
          ],
        },
      },
    },
  );
  return manifest;
}

/** Every email queued so far as sealed: who it went to, its text, and its QR codes' texts. */
async function sealedOf(h: InvoicingHarness): Promise<{ template: string; to: string; text: string; qr: string[] }[]> {
  const jobs = await h.meta.db.selectFrom('adminium_jobs').selectAll().where('kind', '=', 'email.send').orderBy('createdAt').execute();
  return jobs.map((job) => {
    const payload = JSON.parse(typeof job.payload === 'string' ? job.payload : JSON.stringify(job.payload)) as { templateKey: string; envelope: string };
    const envelope = JSON.parse(decryptSecret(payload.envelope, emailEnvelopeKey(TEST_SECRET))) as { to: string; text: string; html?: string; qr?: { text: string }[] };
    return { template: payload.templateKey, to: envelope.to, text: `${envelope.text}\n${envelope.html ?? ''}`, qr: (envelope.qr ?? []).map((code) => code.text) };
  });
}

describe.each(LEGS)('a ticket handed on shows its sender nothing of its new holder — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let shop: Served;
  let link: Served;
  let ticket: Served;
  let linkSession: string;
  let buyer: ReturnType<typeof guest>;
  let byTicket: ReturnType<typeof guest>;
  const t = (ref: string) => `boxoffice_${ref}`;
  let mia: string;
  let order: number;
  let tickets: { id: number; code: string }[];
  const payload = {
    values: { event_id: 1, email: 'mia@buyers.org', name: 'Mia', client_key: 'ck-transfer-privacy-00000000000001' },
    children: { tickets: [1, 2, 3].map(() => ({ values: { ticket_type_id: 1 } })) },
  };

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, boxOffice());
    await mailReady(h.meta);
    await h.rows(`insert into ${t('settings')} (offer_hours) values (48)`);
    await h.rows(`insert into ${t('events')} (id, name, starts_at) values (1, 'Night Tide', '2026-12-01 19:00:00')`);
    await h.rows(`insert into ${t('ticket_types')} (id, event_id, name, price) values (1, 1, 'Standard', 45)`);
    const keys = (h.reply['publicAccess'] as { keys: Record<string, string> }).keys;
    shop = await servePublic(h, keys['customer']!);
    ticket = await servePublic(h, keys['ticket']!);
    link = await servePublic(h, keys['link']!);
    buyer = guest(shop, h);
    byTicket = guest(ticket, h, 60_000);
    const made = await buyer.request('POST', `/records/${t('orders')}_verified_2`, { payload, proof: 'write' });
    expect(made.statusCode, made.body).toBe(201);
    const body = made.json() as { data: { id: number }; children: { tickets: { data: { id: number; code: string } }[] }; link: { session: string } };
    order = body.data.id;
    linkSession = body.link.session;
    tickets = body.children.tickets.map((c) => c.data);
    mia = await buyer.signIn('mia@buyers.org');
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await shop.close();
    await ticket.close();
    await link.close();
    await h.close();
  });

  const row = async (id: number) => (await h.rows(`select status, code, holder_customer_id, pending_email, link_token from ${t('tickets')} where id = ${String(id)}`))[0]!;
  const send = (id: number, email: string, name: string) =>
    buyer.request('PATCH', `/records/${t('tickets')}_verified/${String(id)}`, { payload: { values: { status: 'offered', pending_email: email, pending_name: name } }, session: mia });
  const openLink = async (token: string) => {
    const opened = await byTicket.request('POST', '/claim/token', { payload: { token } });
    return { status: opened.statusCode, session: (opened.json() as { data?: { session: string } }).data?.session ?? '' };
  };
  const lapse = async () => {
    const past = dialect === 'sqlite' ? `'2020-01-01T00:00:00.000Z'` : dialect === 'postgres' ? `'2020-01-01 00:00:00+00'` : `'2020-01-01 00:00:00'`;
    await h.rows(`update ${t('tickets')} set offer_until = ${past} where status = 'offered'`);
    return runTimedMoves({ meta: h.meta, manager: h.manager }, h.connectionId, {}, new Date());
  };
  const quoted = dialect === 'mysql' ? '`to`' : '"to"';
  const queue = async (kind: string, links: { customer?: unknown; ticket?: unknown; order?: unknown }) =>
    h.rows(
      `insert into ${t('messages')} (kind, status, customer_id, ticket_id, order_id, ${quoted}) values ('${kind}', 'queued', ${String(links.customer ?? 'null')}, ${String(links.ticket ?? 'null')}, ${String(links.order ?? 'null')}, null)`,
    );

  it.skipIf(!available)("answers a retry of the create without the new code of a ticket the friend took", async () => {
    const [first, second] = tickets;
    expect((await send(first!.id, 'kai@friends.org', 'Kai')).statusCode).toBe(200);
    const kai = await openLink(String((await row(first!.id))['link_token']));
    expect(kai.status).toBe(200);
    const accepted = await byTicket.request('PATCH', `/records/${t('tickets')}_claimed/${String(first!.id)}`, { payload: { values: { status: 'valid' } }, session: kai.session });
    expect(accepted.statusCode, accepted.body).toBe(200);
    const newCode = String((await row(first!.id))['code']);
    expect(newCode).not.toBe(first!.code);

    const replay = await buyer.request('POST', `/records/${t('orders')}_verified_2`, { payload, proof: 'write' });
    expect(replay.statusCode, replay.body).toBe(200);
    const body = replay.json() as { replayed: boolean; children: { tickets: { data: Doc }[] } };
    expect(body.replayed).toBe(true);
    expect(replay.body).not.toContain(newCode);
    const shown = body.children.tickets.map((c) => c.data);
    expect(shown.find((c) => c['id'] === first!.id)).toMatchObject({ code: null });
    // A ticket still the buyer's keeps its code.
    expect(shown.find((c) => c['id'] === second!.id)).toMatchObject({ code: second!.code });
    // Read through the order's own link, by an entry that declares no withhold of its own: the same.
    const viaLink = await guest(link, h, 90_000).request('GET', `/records/${t('tickets')}_verified_3`, { session: linkSession });
    expect(viaLink.statusCode, viaLink.body).toBe(200);
    const linked = (viaLink.json() as { data: Doc[] }).data;
    expect(linked.find((r) => r['id'] === first!.id)).toMatchObject({ code: null, holder_email: null });
    expect(linked.find((r) => r['id'] === second!.id)).toMatchObject({ code: second!.code });
    expect(viaLink.body).not.toContain(newCode);
  });

  it.skipIf(!available)("emails the buyer the friend's ticket without its code, as a list, a value or a QR code; the friend's own email carries it", async () => {
    const [first, second] = tickets;
    const newCode = String((await row(first!.id))['code']);
    const kai = (await h.rows(`select id from ${t('customers')} where email = 'kai@friends.org'`))[0]!['id'];
    const miaId = (await h.rows(`select id from ${t('customers')} where email = 'mia@buyers.org'`))[0]!['id'];
    const before = (await sealedOf(h)).length;
    await queue('your-tickets', { customer: miaId, order });
    await queue('ticket-note', { customer: miaId, ticket: first!.id });
    await queue('ticket-note', { customer: kai, ticket: first!.id });
    await shop.composed.app.outboxSender.sendApp('boxoffice');
    const sent = (await sealedOf(h)).slice(before);
    const toMia = sent.filter((m) => m.to === 'mia@buyers.org');
    expect(toMia.map((m) => m.template).sort()).toEqual(['boxoffice-ticket-note', 'boxoffice-your-tickets']);
    for (const mail of toMia) {
      expect(mail.text).not.toContain(newCode);
      expect(mail.qr).not.toContain(newCode);
    }
    // Her own ticket is listed with its code and its QR code.
    const list = toMia.find((m) => m.template === 'boxoffice-your-tickets')!;
    expect(list.text).toContain(second!.code);
    expect(list.qr).toContain(second!.code);
    expect(toMia.find((m) => m.template === 'boxoffice-ticket-note')!.text).toContain('code []');
    // Kai's: his ticket's code, as text and as a QR code.
    const toKai = sent.filter((m) => m.to === 'kai@friends.org' && m.template === 'boxoffice-ticket-note');
    expect(toKai.map((m) => [m.template, m.qr])).toEqual([['boxoffice-ticket-note', [newCode]]]);
    expect(toKai[0]!.text).toContain(`code [${newCode}]`);
    // Nothing failed or went unsent for the withholding.
    const statuses = await h.rows(`select status from ${t('messages')} where kind in ('your-tickets', 'ticket-note')`);
    expect(statuses.map((s) => s['status'])).toEqual(['sent', 'sent', 'sent']);
    void (await mailOf(h.meta));
  });

  it.skipIf(!available)("lists no friend's code or address one level down, even in a list an operator wrote into the email", async () => {
    const [first, second, third] = tickets;
    const newCode = String((await row(first!.id))['code']);
    const miaId = (await h.rows(`select id from ${t('customers')} where email = 'mia@buyers.org'`))[0]!['id'];
    // Mia's orders, each with its tickets' codes and holders' addresses joined in: a list one level below the rows.
    const listed = { from: { link: 'customer', table: t('orders'), via: 'customer_id' }, joins: { codes: { table: t('tickets'), via: 'order_id', column: 'code' }, mails: { table: t('tickets'), via: 'order_id', column: 'holder_email' } }, row: { title: 'Order {{row.id}}', meta: 'Codes [{{row.codes}}] held by [{{row.mails}}]' } };
    await h.meta.db
      .updateTable('adminium_email_templates')
      .set({ blocks: JSON.stringify([{ block: 'email.text', data: { text: 'Your orders' } }, { id: 'orders', block: 'email.rows', data: listed }]) as never })
      .where('key', '=', 'boxoffice-your-tickets')
      .execute();
    const before = (await sealedOf(h)).length;
    await queue('your-tickets', { customer: miaId, order });
    await shop.composed.app.outboxSender.sendApp('boxoffice');
    const toMia = (await sealedOf(h)).slice(before).filter((m) => m.to === 'mia@buyers.org');
    expect(toMia).toHaveLength(1);
    expect(toMia[0]!.text).not.toContain(newCode);
    expect(toMia[0]!.text).not.toContain('kai@friends.org');
    // Her own tickets' codes are listed.
    expect(toMia[0]!.text).toContain(second!.code);
    expect(toMia[0]!.text).toContain(third!.code);
  });

  it.skipIf(!available)('gives a lapsed offer that goes to someone else a new link: the first friend opens, reads and accepts nothing', async () => {
    const [, second] = tickets;
    expect((await send(second!.id, 'lee@friends.org', 'Lee')).statusCode).toBe(200);
    await shop.composed.app.outboxSender.sendApp('boxoffice');
    const leeToken = String((await row(second!.id))['link_token']);
    const lee = await openLink(leeToken);
    expect(lee.status).toBe(200);
    await lapse();
    expect((await row(second!.id))['status']).toBe('valid');
    expect((await send(second!.id, 'zoe@friends.org', 'Zoe Private')).statusCode).toBe(200);
    const now = await row(second!.id);
    // A new link for the new address.
    expect(String(now['link_token'])).not.toBe(leeToken);
    // The old link opens nothing now…
    expect((await openLink(leeToken)).status).toBe(404);
    // …and the session opened with it while the offer was Lee's reads nothing and accepts nothing.
    const seen = await byTicket.request('GET', `/records/${t('tickets')}_claimed`, { session: lee.session });
    expect(seen.body).not.toContain('Zoe Private');
    const accept = await byTicket.request('PATCH', `/records/${t('tickets')}_claimed/${String(second!.id)}`, { payload: { values: { status: 'valid' } }, session: lee.session });
    expect(accept.statusCode).not.toBe(200);
    const after = await row(second!.id);
    expect([after['status'], after['holder_customer_id'], after['pending_email']]).toEqual(['offered', null, 'zoe@friends.org']);
    expect(await h.rows(`select id from ${t('customers')} where email = 'zoe@friends.org'`)).toEqual([]);
    // Each offer is emailed: Lee his link, Zoe hers.
    await shop.composed.app.outboxSender.sendApp('boxoffice');
    const zoeToken = String(now['link_token']);
    const carries = (to: string, token: string) => sealedOf(h).then((all) => all.filter((m) => m.to === to && (m.text.includes(token) || m.qr.includes(token))).length);
    expect(await carries('lee@friends.org', leeToken)).toBe(1);
    expect(await carries('zoe@friends.org', zoeToken)).toBe(1);
    // Offered to Lee again once Zoe's lapses: a new link, and a new email carrying it.
    await lapse();
    expect((await send(second!.id, 'lee@friends.org', 'Lee')).statusCode).toBe(200);
    const again = String((await row(second!.id))['link_token']);
    expect(again).not.toBe(leeToken);
    await shop.composed.app.outboxSender.sendApp('boxoffice');
    expect(await carries('lee@friends.org', again)).toBe(1);
    // Sent once each: nothing sent twice for one offer.
    await shop.composed.app.outboxSender.sendApp('boxoffice');
    expect((await sealedOf(h)).filter((m) => m.to === 'lee@friends.org' || m.to === 'zoe@friends.org')).toHaveLength(3);
    // An offer that lapsed before its email went, offered on since, is never emailed: the new offer is.
    await lapse();
    expect((await send(second!.id, 'ivy@friends.org', 'Ivy')).statusCode).toBe(200);
    await lapse();
    expect((await send(second!.id, 'lee@friends.org', 'Lee')).statusCode).toBe(200);
    const last = String((await row(second!.id))['link_token']);
    await shop.composed.app.outboxSender.sendApp('boxoffice');
    expect((await sealedOf(h)).filter((m) => m.to === 'ivy@friends.org')).toEqual([]);
    expect(await carries('lee@friends.org', last)).toBe(1);
  });

  it.skipIf(!available)("binds a friend's session to the address the link went to, whatever else changes on the row", async () => {
    const [, , third] = tickets;
    expect((await send(third!.id, 'noa@friends.org', 'Noa')).statusCode).toBe(200);
    const noa = await openLink(String((await row(third!.id))['link_token']));
    expect(noa.status).toBe(200);
    // The desk puts another address on the offer by hand, leaving the link as it was.
    await h.rows(`update ${t('tickets')} set pending_email = 'uma@friends.org', pending_name = 'Uma Private' where id = ${String(third!.id)}`);
    const seen = await byTicket.request('GET', `/records/${t('tickets')}_claimed`, { session: noa.session });
    expect(seen.body).not.toContain('Uma Private');
    const accept = await byTicket.request('PATCH', `/records/${t('tickets')}_claimed/${String(third!.id)}`, { payload: { values: { status: 'valid' } }, session: noa.session });
    expect(accept.statusCode).not.toBe(200);
    expect(await h.rows(`select id from ${t('customers')} where email = 'uma@friends.org'`)).toEqual([]);
    expect((await row(third!.id))['holder_customer_id']).toBeNull();
  });

  it.skipIf(!available)("makes and links nobody by an address the friend's session was not opened for, even while another of the row's addresses is theirs", async () => {
    const [, , third] = tickets;
    await h.rows(`update ${t('tickets')} set pending_email = 'ora@friends.org', pending_name = 'Ora', holder_email = null where id = ${String(third!.id)}`);
    const ora = await openLink(String((await row(third!.id))['link_token']));
    expect(ora.status).toBe(200);
    // The row still holds Ora's address (as its holder copy), and the offer now names another.
    await h.rows(`update ${t('tickets')} set holder_email = 'ora@friends.org', pending_email = 'pia@friends.org' where id = ${String(third!.id)}`);
    const accept = await byTicket.request('PATCH', `/records/${t('tickets')}_claimed/${String(third!.id)}`, { payload: { values: { status: 'valid' } }, session: ora.session });
    expect(accept.statusCode, accept.body).toBe(400);
    expect(ticket.codeOf(accept)).toBe('PUBLIC_WRITE_REFUSED');
    expect(await h.rows(`select id from ${t('customers')} where email = 'pia@friends.org'`)).toEqual([]);
    const after = await row(third!.id);
    expect([after['status'], after['holder_customer_id']]).toEqual(['offered', null]);
  });
});
