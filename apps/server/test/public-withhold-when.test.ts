// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Columns held back while a condition holds (`withhold.when`), on every door
 * a row reaches its reader by — over the box office fixture, installed by the
 * real installer, on every engine:
 *
 *  - a ticket of an order not paid yet shows the buyer no code: not in a list,
 *    one row, the order's own link, a retry of the create, nor an email (a
 *    value, a list, a QR code) — and every code once the order is paid;
 *  - a ticket sent to a friend and not taken yet shows the friend no code
 *    through its own link (the sender's code still works at the door), and
 *    its new code once taken; the buyer's reads of their other tickets are the
 *    buyer's as ever;
 *  - a withheld column is never filtered or sorted by.
 */
import { readFileSync } from 'node:fs';

import { validateManifest } from '@adminium/manifest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { decryptSecret } from '../src/config/secrets.js';
import { emailEnvelopeKey } from '../src/email/send.js';
import { TEST_SECRET } from './helpers.js';
import { installInvoicing, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { guest, mailReady } from './person-fixture.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Doc = Record<string, unknown>;
const FIXTURE = new URL('../../../packages/manifest/test/fixtures/ticket-transfer.manifest.json', import.meta.url);
const UNPAID = { linked: [{ via: 'order_id', where: [{ column: 'status', eq: 'held' }] }] };

/** The box office with orders that are held until paid, their tickets' codes held back till then, and two emails to the buyer. */
function boxOffice(): Doc {
  const manifest = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Doc;
  const tables = (manifest['requiredSchema'] as { tables: Doc[] }).tables;
  (tables.find((table) => table['ref'] === 'orders')!['columns'] as Doc[]).push(
    { ref: 'status', type: 'enum', enum: ['held', 'paid'], default: 'held' },
    // A second address on the order no link goes to (an assistant's): read by no key.
    { ref: 'copy_email', type: 'text', maxLength: 254, nullable: true, rules: { validation: { format: 'email' } } },
  );
  for (const entry of manifest['publicAccess'] as Doc[]) {
    if (entry['table'] === 'tickets' && entry['visibleWith'] !== undefined) entry['withhold'] = { ...(entry['withhold'] as Doc), when: UNPAID };
  }
  // A signed-in buyer adds a ticket to their order, one row at a time: a create of one, answered as it was made.
  (manifest['publicAccess'] as Doc[]).push({ table: 'tickets', methods: ['POST'], level: 'verified', visibleWith: { table: 'orders', via: 'order_id' }, select: ['id', 'code'], writable: ['order_id', 'ticket_type_id'] });
  const messages = tables.find((table) => table['ref'] === 'messages')!;
  const columns = messages['columns'] as Doc[];
  columns.find((column) => column['ref'] === 'kind')!['enum'] = ['ticket-offered', 'your-tickets', 'ticket-note', 'order-mail', 'friend-note', 'order-copy'];
  columns.push({ ref: 'order_id', type: 'fk', references: 'orders', nullable: true });
  const outbox = manifest['outbox'] as { kinds: Record<string, string>; links: Record<string, string> };
  outbox.links['order'] = 'order_id';
  outbox.kinds['your-tickets'] = 'boxoffice-your-tickets';
  outbox.kinds['ticket-note'] = 'boxoffice-ticket-note';
  // The order's tickets, mailed to the address on the order: the address the order's own link goes to.
  outbox.kinds['order-mail'] = 'boxoffice-your-tickets';
  (manifest['outbox'] as { producers: Doc[] }).producers.push({ kind: 'order-mail', link: 'order_id', recipient: { column: 'email', name: 'name' }, onChange: { table: 'orders', column: 'status', to: 'paid' } });
  outbox.kinds['order-copy'] = 'boxoffice-your-tickets';
  (manifest['outbox'] as { producers: Doc[] }).producers.push({ kind: 'order-copy', link: 'order_id', recipient: { column: 'copy_email' }, onChange: { table: 'orders', column: 'status', to: 'paid' } });
  // A note about a ticket, to the friend it is offered to: the address the ticket's own link goes to.
  outbox.kinds['friend-note'] = 'boxoffice-ticket-note';
  (manifest['outbox'] as { producers: Doc[] }).producers.push({ kind: 'friend-note', link: 'ticket_id', recipient: { column: 'pending_email', name: 'pending_name' }, onChange: { table: 'tickets', column: 'status', to: 'checked_in' } });
  (manifest['emailTemplates'] as Doc[]).push(
    {
      key: 'boxoffice-your-tickets',
      name: 'Your tickets',
      locales: {
        'en-US': {
          subject: 'Your tickets',
          blocks: [{ id: 'tickets', block: 'email.rows', data: { from: { link: 'order', table: 'tickets', via: 'order_id' }, row: { title: 'Ticket {{row.id}}', meta: 'Code [{{row.code}}]', image: '{{row.code.qr}}' } } }],
        },
      },
    },
    {
      key: 'boxoffice-ticket-note',
      name: 'Ticket note',
      locales: { 'en-US': { subject: 'Your ticket', blocks: [{ block: 'email.text', data: { text: 'Ticket {{ticket.id}}, code [{{ticket.code}}]' } }, { block: 'email.image', data: { qr: '{{ticket.code.qr}}' } }] } },
    },
  );
  return manifest;
}

async function sealedOf(h: InvoicingHarness): Promise<{ to: string; text: string; qr: string[] }[]> {
  const jobs = await h.meta.db.selectFrom('adminium_jobs').selectAll().where('kind', '=', 'email.send').orderBy('createdAt').execute();
  return jobs.map((job) => {
    const payload = JSON.parse(typeof job.payload === 'string' ? job.payload : JSON.stringify(job.payload)) as { envelope: string };
    const envelope = JSON.parse(decryptSecret(payload.envelope, emailEnvelopeKey(TEST_SECRET))) as { to: string; text: string; html?: string; qr?: { text: string }[] };
    return { to: envelope.to, text: `${envelope.text}\n${envelope.html ?? ''}`, qr: (envelope.qr ?? []).map((code) => code.text) };
  });
}

describe('the box office that holds codes back', () => {
  it('validates', () => {
    const result = validateManifest(boxOffice());
    expect(result.ok ? [] : result.issues).toEqual([]);
  });
});

describe.each(LEGS)('columns held back while a condition holds — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let shop: Served;
  let link: Served;
  let ticket: Served;
  let buyer: ReturnType<typeof guest>;
  let byLink: ReturnType<typeof guest>;
  let byTicket: ReturnType<typeof guest>;
  const t = (ref: string) => `boxoffice_${ref}`;
  let mia: string;
  let order: number;
  let linkSession: string;
  let tickets: { id: number }[];
  let firstReply: string;
  const payload = {
    values: { event_id: 1, email: 'mia@buyers.org', name: 'Mia', client_key: 'ck-withhold-when-000000000000001' },
    children: { tickets: [1, 2].map(() => ({ values: { ticket_type_id: 1 } })) },
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
    link = await servePublic(h, keys['link']!);
    ticket = await servePublic(h, keys['ticket']!);
    buyer = guest(shop, h);
    byLink = guest(link, h, 30_000);
    byTicket = guest(ticket, h, 60_000);
    const made = await buyer.request('POST', `/records/${t('orders')}_verified_2`, { payload, proof: 'write' });
    expect(made.statusCode, made.body).toBe(201);
    firstReply = made.body;
    const body = made.json() as { data: { id: number }; children: { tickets: { data: { id: number } }[] }; link: { session: string } };
    order = body.data.id;
    linkSession = body.link.session;
    tickets = body.children.tickets.map((c) => c.data);
    mia = await buyer.signIn('mia@buyers.org');
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await shop.close();
    await link.close();
    await ticket.close();
    await h.close();
  });

  const codeOf = async (id: number) => String((await h.rows(`select code from ${t('tickets')} where id = ${String(id)}`))[0]!['code']);
  const quoted = dialect === 'mysql' ? '`to`' : '"to"';
  const queue = async (kind: string, links: { customer: unknown; ticket?: unknown; order?: unknown }) =>
    h.rows(`insert into ${t('messages')} (kind, status, customer_id, ticket_id, order_id, ${quoted}) values ('${kind}', 'queued', ${String(links.customer)}, ${String(links.ticket ?? 'null')}, ${String(links.order ?? 'null')}, null)`);
  /** Everything the buyer is shown of the order's tickets, door by door, as text. */
  const everything = async () => {
    const out: string[] = [];
    out.push((await buyer.request('GET', `/records/${t('tickets')}_verified`, { session: mia })).body);
    for (const { id } of tickets) out.push((await buyer.request('GET', `/records/${t('tickets')}_verified/${String(id)}`, { session: mia })).body);
    out.push((await byLink.request('GET', `/records/${t('tickets')}_verified_3`, { session: linkSession })).body);
    const replay = await buyer.request('POST', `/records/${t('orders')}_verified_2`, { payload, proof: 'write' });
    expect(replay.statusCode, replay.body).toBe(200);
    out.push(replay.body);
    const miaId = (await h.rows(`select id from ${t('customers')} where email = 'mia@buyers.org'`))[0]!['id'];
    const before = (await sealedOf(h)).length;
    await queue('your-tickets', { customer: miaId, order });
    await queue('ticket-note', { customer: miaId, ticket: tickets[0]!.id });
    await shop.composed.app.outboxSender.sendApp('boxoffice');
    const mail = (await sealedOf(h)).slice(before).filter((m) => m.to === 'mia@buyers.org');
    expect(mail).toHaveLength(2);
    for (const m of mail) out.push(`${m.text}\n${m.qr.join('\n')}`);
    return out;
  };

  it.skipIf(!available)('answers a create of an order not paid yet without its codes, a tree or one row', async () => {
    const codes = await Promise.all(tickets.map(({ id }) => codeOf(id)));
    for (const code of codes) expect(firstReply).not.toContain(code);
    expect((JSON.parse(firstReply) as { children: { tickets: { data: Doc }[] } }).children.tickets.map((c) => c.data['code'])).toEqual([null, null]);
    const config = (await buyer.request('GET', '/config')).json() as { data: { refs: Record<string, { actions: string[] }> } };
    const addRef = Object.entries(config.data.refs).find(([ref, r]) => ref.startsWith(t('tickets')) && r.actions.includes('create'))![0];
    const added = await buyer.request('POST', `/records/${addRef}`, { payload: { values: { order_id: order, ticket_type_id: 1 } }, session: mia });
    expect(added.statusCode, added.body).toBe(201);
    const id = (added.json() as { data: { id: number; code: unknown } }).data;
    expect(id.code).toBeNull();
    expect(added.body).not.toContain(await codeOf(id.id));
    tickets.push({ id: id.id });
  });

  it.skipIf(!available)('shows the buyer no code of an order not paid yet, through any door, and every code once it is paid', async () => {
    const codes = await Promise.all(tickets.map(({ id }) => codeOf(id)));
    const unpaid = await everything();
    for (const door of unpaid) for (const code of codes) expect(door).not.toContain(code);
    expect(unpaid.join('\n')).toContain('"code":null');
    expect(unpaid.join('\n')).toContain('code []');
    // Every message still went: held back is printed empty, never a failure.
    expect((await h.rows(`select status from ${t('messages')} where kind in ('your-tickets', 'ticket-note')`)).map((m) => m['status'])).toEqual(['sent', 'sent']);

    await h.rows(`update ${t('orders')} set status = 'paid' where id = ${String(order)}`);
    const paid = await everything();
    // Door by door: the list, each row, the order's link, the retry, each email.
    const doors = ['list', 'row 1', 'row 2', 'row 3', "order's link", 'retry', 'email', 'email'];
    paid.forEach((door, i) => {
      // The retry answers the rows the create made; the third was added after.
      const shown = i === 1 ? [codes[0]!] : i === 2 ? [codes[1]!] : i === 3 ? [codes[2]!] : i === 5 ? codes.slice(0, 2) : i === 7 ? [] : codes;
      for (const code of shown) expect(door, doors[i]).toContain(code);
    });
    // The one-ticket note carries its ticket's code, as text and QR.
    expect(paid.slice(6).join('\n')).toContain(codes[0]!);
  });

  it.skipIf(!available)("mails the order's own address as its own link reads it: no code unpaid, every code paid", async () => {
    const codes = await Promise.all(tickets.map(({ id }) => codeOf(id)));
    await h.rows(`update ${t('orders')} set copy_email = 'desk@assist.org' where id = ${String(order)}`);
    const mailed = async (kind = 'order-mail', to = 'mia@buyers.org') => {
      const before = (await sealedOf(h)).length;
      await queue(kind, { customer: 'null', order });
      await shop.composed.app.outboxSender.sendApp('boxoffice');
      const mail = (await sealedOf(h)).slice(before);
      expect(mail.map((m) => m.to)).toEqual([to]);
      return `${mail[0]!.text}\n${mail[0]!.qr.join('\n')}`;
    };
    await h.rows(`update ${t('orders')} set status = 'held' where id = ${String(order)}`);
    const unpaid = await mailed();
    for (const code of codes) expect(unpaid).not.toContain(code);
    // An address no link goes to reads as nobody's key: the order's state holds there too.
    const copyUnpaid = await mailed('order-copy', 'desk@assist.org');
    for (const code of codes) expect(copyUnpaid).not.toContain(code);
    // Paid, the buyer's tickets nobody holds are theirs: the pending-friend rule of a ticket's own link is not this mail's.
    await h.rows(`update ${t('orders')} set status = 'paid' where id = ${String(order)}`);
    const paid = await mailed();
    for (const code of codes) expect(paid).toContain(code);
    // …and no rule said of whoever holds a ticket's own link does.
    const copyPaid = await mailed('order-copy', 'desk@assist.org');
    for (const code of codes) expect(copyPaid).toContain(code);
  });

  it.skipIf(!available)('never filters or sorts by a column held back', async () => {
    const where = encodeURIComponent(JSON.stringify({ column: 'code', op: 'eq', value: 'X' }));
    const filtered = await buyer.request('GET', `/records/${t('tickets')}_verified?where=${where}`, { session: mia });
    expect(filtered.statusCode).toBe(400);
    const sorted = await buyer.request('GET', `/records/${t('tickets')}_verified?order=code.asc`, { session: mia });
    expect(sorted.statusCode).toBe(400);
  });

  it.skipIf(!available)("shows a friend no code by a ticket's own link until they take it, then its new one", async () => {
    const [first, second] = tickets;
    const sent = await buyer.request('PATCH', `/records/${t('tickets')}_verified/${String(first!.id)}`, { payload: { values: { status: 'offered', pending_email: 'kai@friends.org', pending_name: 'Kai' } }, session: mia });
    expect(sent.statusCode, sent.body).toBe(200);
    const senderCode = await codeOf(first!.id);
    const token = String((await h.rows(`select link_token from ${t('tickets')} where id = ${String(first!.id)}`))[0]!['link_token']);
    const opened = await byTicket.request('POST', '/claim/token', { payload: { token } });
    expect(opened.statusCode, opened.body).toBe(200);
    const kai = (opened.json() as { data: { session: string } }).data.session;
    const pending = await byTicket.request('GET', `/records/${t('tickets')}_claimed`, { session: kai });
    expect(pending.statusCode, pending.body).toBe(200);
    expect((pending.json() as { data: Doc[] }).data).toMatchObject([{ id: first!.id, status: 'offered', code: null }]);
    expect(pending.body).not.toContain(senderCode);
    const one = await byTicket.request('GET', `/records/${t('tickets')}_claimed/${String(first!.id)}`, { session: kai });
    expect(one.body).not.toContain(senderCode);
    // The buyer still reads it, pending, with the code that still works at the door.
    // Mailed to the friend's address, as the ticket's own link reads it: no code while pending.
    await shop.composed.app.outboxSender.sendApp('boxoffice');
    const beforeNote = (await sealedOf(h)).length;
    await queue('friend-note', { customer: 'null', ticket: first!.id });
    await shop.composed.app.outboxSender.sendApp('boxoffice');
    const note = (await sealedOf(h)).slice(beforeNote).filter((m) => m.to === 'kai@friends.org');
    expect(note).toHaveLength(1);
    expect(`${note[0]!.text}${note[0]!.qr.join('')}`).not.toContain(senderCode);
    const buyers = (await buyer.request('GET', `/records/${t('tickets')}_verified`, { session: mia })).json() as { data: Doc[] };
    expect(buyers.data.find((r) => r['id'] === first!.id)).toMatchObject({ code: senderCode });
    // Taken: the friend reads the new code; the buyer does not; the buyer's other ticket is theirs as ever.
    const accepted = await byTicket.request('PATCH', `/records/${t('tickets')}_claimed/${String(first!.id)}`, { payload: { values: { status: 'valid' } }, session: kai });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.body).not.toContain(senderCode);
    const newCode = await codeOf(first!.id);
    expect(newCode).not.toBe(senderCode);
    const taken = await byTicket.request('GET', `/records/${t('tickets')}_claimed`, { session: kai });
    expect((taken.json() as { data: Doc[] }).data).toMatchObject([{ id: first!.id, code: newCode }]);
    const after = (await buyer.request('GET', `/records/${t('tickets')}_verified`, { session: mia })).json() as { data: Doc[] };
    expect(after.data.find((r) => r['id'] === first!.id)).toMatchObject({ code: null });
    expect(after.data.find((r) => r['id'] === second!.id)).toMatchObject({ code: await codeOf(second!.id) });
  });
});
