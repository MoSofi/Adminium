// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A ticket sent to a friend finds (or makes) the friend's person only on the
 * save that accepts it — the move to `valid` — and never on another save the
 * friend makes through the ticket's own link while it is still pending (a
 * name corrected): nobody is made, nothing is linked, and a quote of either
 * finds nobody. On every engine.
 */
import { readFileSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { installInvoicing, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { guest, mailOf, mailReady } from './person-fixture.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Doc = Record<string, unknown>;
const FIXTURE = new URL('../../../packages/manifest/test/fixtures/ticket-transfer.manifest.json', import.meta.url);

/** The box office, whose ticket link may also correct the name it was sent to while it waits. */
function boxOffice(): Doc {
  const manifest = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Doc;
  const accept = (manifest['publicAccess'] as Doc[]).find((entry) => entry['key'] === 'ticket')!;
  accept['writable'] = ['status', 'pending_name'];
  accept['dryRun'] = true;
  return manifest;
}

describe.each(LEGS)("a friend's person, found on the accept alone — %s", (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let shop: Served;
  let ticket: Served;
  let buyer: ReturnType<typeof guest>;
  let byTicket: ReturnType<typeof guest>;
  const t = (ref: string) => `boxoffice_${ref}`;
  let first: number;
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
    ticket = await servePublic(h, keys['ticket']!);
    buyer = guest(shop, h);
    byTicket = guest(ticket, h, 60_000);
    const made = await buyer.request('POST', `/records/${t('orders')}_verified_2`, {
      payload: { values: { event_id: 1, email: 'mia@buyers.org', name: 'Mia' }, children: { tickets: [{ values: { ticket_type_id: 1 } }] } },
      proof: 'write',
    });
    expect(made.statusCode, made.body).toBe(201);
    first = (made.json() as { children: { tickets: { data: { id: number } }[] } }).children.tickets[0]!.data.id;
    mia = await buyer.signIn('mia@buyers.org');
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await shop.close();
    await ticket.close();
    await h.close();
  });

  const row = async () => (await h.rows(`select status, holder_customer_id, pending_name, link_token from ${t('tickets')} where id = ${first}`))[0]!;
  const people = async () => Number((await h.rows(`select count(*) as n from ${t('customers')} where email = 'kai@friends.org'`))[0]!['n']);

  it.skipIf(!available)('makes and links nobody on a pending save, and the friend on the accept', async () => {
    const sent = await buyer.request('PATCH', `/records/${t('tickets')}_verified/${first}`, { payload: { values: { status: 'offered', pending_email: 'kai@friends.org', pending_name: 'Kai' } }, session: mia });
    expect(sent.statusCode, sent.body).toBe(200);
    await shop.composed.app.outboxSender.sendApp('boxoffice');
    expect((await mailOf(h.meta)).filter((m) => m.to === 'kai@friends.org')).toHaveLength(1);
    const opened = await byTicket.request('POST', '/claim/token', { payload: { token: String((await row())['link_token']) } });
    expect(opened.statusCode, opened.body).toBe(200);
    const session = (opened.json() as { data: { session: string } }).data.session;
    const at = `/records/${t('tickets')}_claimed/${first}`;

    // The name corrected while it waits: a change like any other.
    const renamed = await byTicket.request('PATCH', at, { payload: { values: { pending_name: 'Kai Kim' } }, session });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(await row()).toMatchObject({ status: 'offered', holder_customer_id: null, pending_name: 'Kai Kim' });
    expect(await people()).toBe(0);
    // Quotes of both find nobody.
    for (const values of [{ pending_name: 'Kai K' }, { status: 'valid' }]) {
      const quote = await byTicket.request('POST', `${at}/dry-run`, { payload: { values }, session });
      expect(quote.statusCode, quote.body).toBe(200);
    }
    expect(await people()).toBe(0);

    // The accept: the friend is made and becomes the holder.
    const accepted = await byTicket.request('PATCH', at, { payload: { values: { status: 'valid' } }, session });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(await people()).toBe(1);
    const kai = (await h.rows(`select id from ${t('customers')} where email = 'kai@friends.org'`))[0]!;
    expect(Number((await row())['holder_customer_id'])).toBe(Number(kai['id']));
  });
});
