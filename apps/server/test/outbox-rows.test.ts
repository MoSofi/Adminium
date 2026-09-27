// SPDX-License-Identifier: AGPL-3.0-only
/**
 * EMAILS THAT LIST ROWS, on every engine this run can reach, through an app
 * installed by the real installer and its outbox's own sender.
 *
 * An order's tickets each with its QR code, in their order, leaving out one
 * handed on; a kitchen order's dishes with their options and prices in the
 * reader's money; a stay's nights and extras; a list's filter and limit; a
 * time on the night the clocks go back; a column kept from emails that no
 * row fills; a ticket's code to an address typed by hand, held back; a
 * person's wording that may print neither a list nor a code; the value forms
 * the same on every engine; the language of the order, not of the person;
 * and a message queued only while its feature is on.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { documentSequencesRepo, emailTemplatesRepo, manifestsRepo, settingsRepo, type MetaDb } from '@adminium/meta';

import { decryptSecret } from '../src/config/secrets.js';
import { createWriteService } from '../src/crud/write-service.js';
import { emailEnvelopeKey } from '../src/email/send.js';
import { createOutboxProducers } from '../src/outbox/producers.js';
import { codeWithheldSentence, createOutboxSender, LIST_UNREADABLE, qrTooLongSentence, unfilledSentence, type OutboxSender } from '../src/outbox/sender.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { addOnManifest } from './app-add-ons.helpers.js';
import { TEST_SECRET } from './helpers.js';
import { LEGS, installInvoicing, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { eventsManifest, SMTP } from './outbox-rows-fixture.js';

interface Sent {
  to: string;
  subject: string;
  text: string;
  html: string;
  qr?: { cid: string; text: string }[];
}

describe.each(LEGS)('emails that list rows — %s', (dialect, available) => {
  let h: InvoicingHarness;
  let meta: MetaDb;
  let sender: OutboxSender;
  let producers: ReturnType<typeof createOutboxProducers>;
  let w: Awaited<ReturnType<typeof writerFor>>;
  const now = Date.parse('2026-10-20T12:00:00Z');

  const jobs = async () => (await meta.db.selectFrom('adminium_jobs').selectAll().where('kind', '=', 'email.send').orderBy('createdAt').orderBy('id').execute()) as { payload: unknown }[];
  const mail = async (): Promise<Sent[]> =>
    (await jobs()).map((job) => {
      const payload = (typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload) as { envelope: string };
      return JSON.parse(decryptSecret(payload.envelope, emailEnvelopeKey(TEST_SECRET))) as Sent;
    });
  const queue = async (kind: string, values: { order?: number; stay?: number; to?: string | null; customer?: number; language?: string; body?: string }) => {
    const cell = (value: unknown) => (value === undefined || value === null ? 'NULL' : typeof value === 'number' ? String(value) : `'${String(value).replaceAll("'", "''")}'`);
    await h.rows(
      `INSERT INTO ${h.real('messages')} (kind, status, to_address, customer_id, order_id, stay_id, language, body_override) VALUES ` +
        `(${cell(kind)}, 'queued', ${cell(values.to === undefined ? 'mia@waveform.dev' : values.to)}, ${cell(values.customer ?? 1)}, ${cell(values.order)}, ${cell(values.stay)}, ${cell(values.language)}, ${cell(values.body)})`,
    );
    return Number((await h.rows(`SELECT max(id) AS id FROM ${h.real('messages')}`))[0]!['id']);
  };
  const message = async (mid: number) => {
    const [row] = await h.rows(`SELECT status, error FROM ${h.real('messages')} WHERE id = ${String(mid)}`);
    return { status: row!['status'], error: row!['error'] ?? null };
  };
  /** Send one message now, and hand back what went. */
  const send = async (mid: number): Promise<Sent | null> => {
    const before = (await mail()).length;
    await sender.sendApp('events', now);
    const state = await message(mid);
    if (state.status !== 'sent') return null;
    return (await mail()).slice(before)[0] ?? null;
  };

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, eventsManifest());
    meta = h.meta;
    await settingsRepo(meta).set('email.smtp', SMTP as never);
    await meta.db.updateTable('adminium_connections').set({ timezone: 'Europe/London', currency: 'USD' }).where('id', '=', h.connectionId).execute();
    const views = createPublicViews(meta);
    const writes = createWriteService({ sequences: documentSequencesRepo(meta) });
    producers = createOutboxProducers({ meta, manager: h.manager, viewFor: views.viewFor, writes });
    sender = createOutboxSender({ meta, manager: h.manager, viewFor: views.viewFor, writes, live: () => producers.live(), secret: TEST_SECRET });
    w = await writerFor(h, 'Europe/London');
    const history = { ...w.desk, origin: 'import' as const };
    await h.rows(`INSERT INTO ${h.real('customers')} (email, name, language) VALUES ('mia@waveform.dev', 'Mia Okada', 'en-US'), ('kai@waveform.dev', 'Kai Renner', 'de-DE')`);
    await h.rows(`INSERT INTO ${h.real('ticket_types')} (name, price) VALUES ('Standard', 42), ('Balcony', 55)`);
    await h.rows(`INSERT INTO ${h.real('orders')} (ref, customer_id, language, paid_method, tax_rate, total, pickup) VALUES ('WV-8815', 1, NULL, 'card', 8.25, 84, '15:00'), ('WV-8816', 2, 'de-DE', 'card', 8.25, 18, NULL)`);
    // WV-8815's tickets, written out of order: Kai's, then Mia's, then one handed on, then one of another order.
    await w.create('tickets', { order_id: 1, ticket_type_id: 1, holder_customer_id: 1, holder_name: 'Kai Renner', holder_email: 'kai@waveform.dev', code: 'R4FN-7HCW', link_token: 'KAILINKTOKEN0002', position: 2, price: 42, valid_from: '2026-10-25T01:30:00Z' }, history);
    await w.create('tickets', { order_id: 1, ticket_type_id: 1, holder_customer_id: 1, holder_name: 'Mia Okada', holder_email: 'mia@waveform.dev', code: 'K7QX-M2PD', link_token: 'MIALINKTOKEN0001', position: 1, price: 42, valid_from: '2026-10-25T00:30:00Z' }, history);
    await w.create('tickets', { order_id: 1, ticket_type_id: 2, holder_customer_id: 1, holder_name: 'Zed Handed', code: 'ZZZZ-ZZZZ', position: 3, price: 55, transferred: true }, history);
    await w.create('tickets', { order_id: 2, ticket_type_id: 1, holder_customer_id: 2, holder_name: 'Kai Renner', code: 'Q9ZR-T2MK', position: 1, price: 42, status: 'void' }, history);
    await h.rows(`INSERT INTO ${h.real('order_items')} (order_id, name, qty, line_total, position) VALUES (2, 'Signature grain bowl', 1, 18, 1)`);
    await h.rows(`INSERT INTO ${h.real('order_item_options')} (order_item_id, name, position) VALUES (1, 'Avocado', 3), (1, 'Farro', 1), (1, 'Grilled chicken', 2)`);
    await h.rows(`INSERT INTO ${h.real('stays')} (customer_id, nights) VALUES (1, 2)`);
    await h.rows(`INSERT INTO ${h.real('stay_extras')} (stay_id, label, amount) VALUES (1, 'Breakfast', 64)`);
  }, 180_000);

  afterAll(async () => {
    if (!available) return;
    await h.close();
  });

  it.skipIf(!available)("lists WV-8815's tickets in their order, each with its QR code, leaving out the one handed on", async () => {
    const sent = await send(await queue('e1', { order: 1, language: 'en-GB' }));
    expect(sent).not.toBeNull();
    expect(sent!.subject).toBe('Your tickets for WV-8815');
    expect(sent!.text).toContain('• Mia Okada — Standard · K7QX-M2PD\n  Doors 01:30');
    expect(sent!.text).toContain('• Kai Renner — Standard · R4FN-7HCW\n  Doors 01:30');
    expect(sent!.text.indexOf('Mia Okada')).toBeLessThan(sent!.text.indexOf('Kai Renner'));
    expect(sent!.text).not.toContain('Zed Handed');
    expect(sent!.html).toContain('<img src="cid:qr-1" width="116" height="116" alt="K7QX-M2PD"');
    expect(sent!.html).toContain('<img src="cid:qr-2" width="116" height="116" alt="R4FN-7HCW"');
    // The codes travel sealed: the plain payload names neither.
    expect(sent!.qr).toEqual([
      { cid: 'qr-1', text: 'K7QX-M2PD' },
      { cid: 'qr-2', text: 'R4FN-7HCW' },
    ]);
    const plain = JSON.stringify((await jobs()).map((job) => (typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload)).map(({ envelope: _e, ...rest }) => rest));
    expect(plain).not.toContain('K7QX');
    expect(plain).not.toContain('R4FN');
  });

  it.skipIf(!available)("lists a dish with its options and prices it in the reader's money", async () => {
    const us = await send(await queue('order', { order: 2, customer: 2, to: 'kai@waveform.dev', language: 'en-US' }));
    expect(us!.text).toContain('• Signature grain bowl × 1 — Farro, Grilled chicken, Avocado — $18.00');
    const gb = await send(await queue('order', { order: 2, customer: 2, to: 'kai@waveform.dev', language: 'en-GB' }));
    expect(gb!.text).toContain('Signature grain bowl × 1 — Farro, Grilled chicken, Avocado — US$18.00');
  });

  it.skipIf(!available)('writes a number, a percentage, a label and a time of day alike on every engine', async () => {
    const sent = await send(await queue('order', { order: 1, language: 'en-US' }));
    expect(sent!.text).toContain('Tax 8.25% (8.25), paid by Card, pick up 3:00 PM');
    const gb = await send(await queue('order', { order: 1, language: 'en-GB' }));
    expect(gb!.text).toContain('pick up 15:00');
  });

  it.skipIf(!available)("lists a stay's extras beside its nights", async () => {
    const sent = await send(await queue('stay', { stay: 1, language: 'en-US' }));
    expect(sent!.text).toContain('2 nights');
    expect(sent!.text).toContain('• Breakfast — $64.00');
  });

  it.skipIf(!available)('keeps to its filter and its limit, and says its empty words with none', async () => {
    const one = await send(await queue('list', { order: 1 }));
    // Valid tickets of WV-8815 not handed on — all three are valid; the limit is two, in order.
    expect(one!.text).toContain('• Mia Okada\n• Kai Renner');
    expect(one!.text).not.toContain('Zed Handed');
    const none = await send(await queue('list', { order: 2, customer: 2, to: 'kai@waveform.dev' }));
    expect(none!.text).toContain('No tickets');
  });

  it.skipIf(!available)('never sends an email without its list: a list whose table or link is not there fails it; an empty one goes', async () => {
    const stored = (await emailTemplatesRepo(meta).findByKeyLocale('events-stay', 'en_US'))!;
    const withRows = async (from: Record<string, unknown>, joins?: Record<string, unknown>) =>
      emailTemplatesRepo(meta).upsert('events-stay', 'en_US', {
        name: stored.name,
        subject: stored.subject,
        blocks: (stored.blocks as { block: string; data?: Record<string, unknown> }[]).map((block) =>
          block.block === 'email.rows' ? { ...block, data: { ...block.data, from: { ...(block.data!['from'] as Record<string, unknown>), ...from }, ...(joins === undefined ? {} : { joins }) } } : block,
        ),
        enabled: true,
      });
    const extras = w.targetOf('stay_extras').table.id;
    try {
      // The table renamed since the email was written: the id it keeps names nothing.
      await withRows({ table: `${extras}_renamed` });
      const renamed = await queue('stay', { stay: 1, language: 'en-US' });
      await sender.sendApp('events', now);
      expect(await message(renamed)).toEqual({ status: 'failed', error: LIST_UNREADABLE });
      // A link the outbox does not have, a column the table lacks, a list one level down from a table that is not there.
      for (const [from, joins] of [[{ table: extras, link: 'nope' }], [{ table: extras, via: 'no_such_column' }], [{ table: extras }, { names: { table: `${extras}_gone`, via: 'stay_id', column: 'label' } }]] as const) {
        await withRows(from, joins);
        const mid = await queue('stay', { stay: 1, language: 'en-US' });
        await sender.sendApp('events', now);
        expect(await message(mid)).toEqual({ status: 'failed', error: LIST_UNREADABLE });
      }
    } finally {
      await emailTemplatesRepo(meta).upsert('events-stay', 'en_US', { name: stored.name, subject: stored.subject, blocks: stored.blocks, enabled: true });
    }
    // A stay there with no extras: its list is empty, and the email goes.
    await h.rows(`INSERT INTO ${h.real('stays')} (customer_id, nights) VALUES (1, 1)`);
    const bare = Number((await h.rows(`SELECT max(id) AS id FROM ${h.real('stays')}`))[0]!['id']);
    const sent = await send(await queue('stay', { stay: bare, language: 'en-US' }));
    expect(sent!.text).toContain('1 nights');
    expect(sent!.text).not.toContain('•');
  });

  it.skipIf(!available)("queues an order's message without the order's language when no message is written in it, or it is too long for the outbox", async () => {
    const writes = createWriteService({ sequences: documentSequencesRepo(meta) });
    const place = async (ref: string, language: string) => {
      const made = await writes.create({
        target: w.targetOf('orders'),
        values: { ref, customer_id: 2, language, paid_method: 'cash', tax_rate: '8.25', total: '18' },
        context: w.desk,
        announce: async (row) => {
          await producers.onRecordEvent({
            connectionId: h.connectionId,
            table: w.targetOf('orders').table,
            action: 'create',
            entity: { connectionId: h.connectionId, table: w.targetOf('orders').table.id, pk: { id: row['id'] as number }, label: '' },
            before: null,
            after: row,
            origin: 'dashboard',
          });
        },
      });
      return (await h.rows(`SELECT language, status FROM ${h.real('messages')} WHERE order_id = ${String(made['id'])} AND kind = 'order'`))[0];
    };
    // This outbox reads its language from the order alone: without one, the message is written in the workspace's.
    expect(await place('WV-8818', 'xx')).toMatchObject({ language: null, status: 'queued' });
    expect(await place('WV-8819', 'de, en;q=0.5')).toMatchObject({ language: null, status: 'queued' });
    // 16 characters is the outbox's column: a longer tag is never written there (the write would be refused, and nothing queued).
    expect(await place('WV-8820', 'en-Latn-US-posix')).toMatchObject({ language: 'en-Latn-US-posix', status: 'queued' });
    expect(await place('WV-8821', 'en-Latn-US-posixx')).toMatchObject({ language: null, status: 'queued' });
  });

  // Only SQLite keeps a code longer than its column: elsewhere the database refuses it first.
  it.skipIf(!available || dialect !== 'sqlite')('fails, naming it, a message whose QR code would hold more than a QR code carries', async () => {
    await h.rows(`INSERT INTO ${h.real('orders')} (ref, customer_id, total) VALUES ('WV-8899', 1, 42)`);
    const order = Number((await h.rows(`SELECT max(id) AS id FROM ${h.real('orders')}`))[0]!['id']);
    // 22 characters, 66 bytes.
    await h.rows(`INSERT INTO ${h.real('tickets')} (order_id, ticket_type_id, holder_customer_id, holder_name, code, position, price, status, transferred) VALUES (${String(order)}, 1, 1, 'Mia Okada', '${'€'.repeat(22)}', 1, 42, 'valid', 0)`);
    const mid = await queue('e1', { order, language: 'en-US' });
    await sender.sendApp('events', now);
    expect(await message(mid)).toEqual({ status: 'failed', error: qrTooLongSentence(['row.code.qr']) });
  });

  it.skipIf(!available)('fails, naming it, a message whose rows read a column kept from emails', async () => {
    const mid = await queue('leak', { order: 1 });
    await sender.sendApp('events', now);
    expect(await message(mid)).toEqual({ status: 'failed', error: unfilledSentence(['row.holder_email']) });
  });

  it.skipIf(!available)("holds a ticket's link back from an address typed by hand, and sends it, with its QR code, to its holder", async () => {
    const mid = await queue('link', { order: 1, to: 'someone@else.dev' });
    await sender.sendApp('events', now);
    expect(await message(mid)).toEqual({ status: 'failed', error: codeWithheldSentence(['row.link_token', 'row.link_token.qr']) });
    const sent = await send(await queue('link', { order: 1 }));
    expect(sent!.text).toContain('• Mia Okada — MIALINKTOKEN0001');
    expect(sent!.qr).toEqual([
      { cid: 'qr-1', text: 'MIALINKTOKEN0001' },
      { cid: 'qr-2', text: 'KAILINKTOKEN0002' },
    ]);
    // A ticket's number opens nothing: it goes to anyone the message goes to.
    const typed = await send(await queue('e1', { order: 1, to: 'box.office@waveform.dev' }));
    expect(typed!.text).toContain('K7QX-M2PD');
  });

  it.skipIf(!available)("prints neither a list nor a QR code in a person's own wording", async () => {
    const sent = await send(await queue('override', { order: 1, body: 'Your codes: {{row.code}} {{row.code.qr}} for {{order.ref}}' }));
    expect(sent!.text).toContain('Your codes:');
    expect(sent!.text).not.toContain('K7QX');
    expect(sent!.qr ?? []).toEqual([]);
  });

  it.skipIf(!available)('writes to a signed-in diner in the language of the order, not of their own row', async () => {
    // Kai's own row says German; order WV-8815's row says nothing, WV-8816's says German.
    const writes = createWriteService({ sequences: documentSequencesRepo(meta) });
    const made = await writes.create({
      target: w.targetOf('orders'),
      values: { ref: 'WV-8817', customer_id: 1, language: 'de-DE', paid_method: 'cash', tax_rate: '8.25', total: '18' },
      context: w.desk,
      announce: async (row) => {
        await producers.onRecordEvent({
          connectionId: h.connectionId,
          table: w.targetOf('orders').table,
          action: 'create',
          entity: { connectionId: h.connectionId, table: w.targetOf('orders').table.id, pk: { id: row['id'] as number }, label: '' },
          before: null,
          after: row,
          origin: 'dashboard',
        });
      },
    });
    const [queued] = await h.rows(`SELECT id, language FROM ${h.real('messages')} WHERE order_id = ${String(made['id'])} AND kind = 'order'`);
    expect(queued!['language']).toBe('de-DE');
    const sent = await send(Number(queued!['id']));
    expect(sent!.subject).toBe('Bestellung WV-8817');
    // German spaces the sign with a no-break space.
    expect(sent!.text).toMatch(/Steuer 8,25\s%, bezahlt mit Cash/);
  });

  it.skipIf(!available)('queues a receipt only while its feature is on', async () => {
    const orders = w.targetOf('orders');
    const pay = async (id: number) => {
      const before = (await h.rows(`SELECT * FROM ${h.real('orders')} WHERE id = ${String(id)}`))[0]!;
      await h.rows(`UPDATE ${h.real('orders')} SET paid_method = 'cash' WHERE id = ${String(id)}`);
      const after = (await h.rows(`SELECT * FROM ${h.real('orders')} WHERE id = ${String(id)}`))[0]!;
      await producers.onRecordEvent({ connectionId: h.connectionId, table: orders.table, action: 'update', entity: { connectionId: h.connectionId, table: orders.table.id, pk: { id }, label: '' }, before: { ...before, paid_method: null }, after, origin: 'dashboard' });
      return (await h.rows(`SELECT count(*) AS n FROM ${h.real('messages')} WHERE order_id = ${String(id)} AND kind = 'receipt'`))[0]!['n'];
    };
    // No Invoices & Receipts: no receipt at all, rather than a failed one.
    expect(Number(await pay(1))).toBe(0);
    // Invoices & Receipts attached to the app: the next payment queues its receipt.
    await manifestsRepo(meta, { encrypt: (v) => v, decrypt: (v) => v }).install({
      manifestKey: 'invoices',
      version: '1.0.0',
      kind: 'add-on',
      source: 'file',
      document: addOnManifest('invoices', { addOn: { attaches: [{ app: 'events' }], slots: [] } }),
      attachTo: ['events'],
    });
    expect(Number(await pay(2))).toBe(1);
  });
});
