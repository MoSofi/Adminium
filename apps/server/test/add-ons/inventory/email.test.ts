// SPDX-License-Identifier: AGPL-3.0-only
/**
 * INVENTORY'S EMAIL TO A SUPPLIER.
 *
 * Sending a purchase order queues one message for the supplier: to the
 * address on the order, in the order's language, listing its lines — with no
 * amount in it while prices are off. "Mark as sent, no email" writes to
 * nobody and says so in the log; "Send again" writes a second time; and an
 * order of the sample data, whose suppliers do not exist, never writes to
 * anybody. With Invoices & Receipts not installed the mail goes without a PDF
 * and without the line that promises one.
 */
import { documentSequencesRepo, settingsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createSampleDataService, findSampleOwner } from '../../../src/apps/sample-data.js';
import { decryptSecret, encryptSecret } from '../../../src/config/secrets.js';
import { createWriteService } from '../../../src/crud/write-service.js';
import { emailSecretKey } from '../../../src/email/config.js';
import { emailEnvelopeKey } from '../../../src/email/send.js';
import { createOutboxProducers } from '../../../src/outbox/producers.js';
import { createOutboxSender, type OutboxSender } from '../../../src/outbox/sender.js';
import { createPublicViews } from '../../../src/public-api/runtime.js';
import { TEST_SECRET } from '../../helpers.js';
import { LEGS } from '../../invoicing-install.helpers.js';
import { builtAddOn, installBuilt, writing, type Writing } from '../harness.js';
import { n } from './world.js';

const inventory = builtAddOn('inventory');
type Mail = { to: string; subject: string; text: string; attachments?: unknown[] };

describe.each(LEGS)('Inventory\'s email to a supplier — %s', (dialect, available) => {
  const run = available && inventory !== null;
  let w: Writing;
  let producers: ReturnType<typeof createOutboxProducers>;
  let sender: OutboxSender;
  let clock = Date.now();
  let supplier: number;
  let room: number;
  let gloves: number;

  const t = (ref: string) => w.real(ref);
  const one = async (sql: string) => (await w.h.rows(sql))[0]!;
  const mail = async (): Promise<Mail[]> =>
    (await w.h.meta.db.selectFrom('adminium_jobs').selectAll().where('kind', '=', 'email.send').orderBy('createdAt').orderBy('id').execute()).map((job) => {
      const payload = (typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload) as { envelope: string };
      return JSON.parse(decryptSecret(payload.envelope, emailEnvelopeKey(TEST_SECRET))) as Mail;
    });
  const messagesOf = async (order: unknown) => (await w.h.rows(`select kind, status, skip_reason, language, error from ${t('messages')} where po_id = ${String(order)} order by id`)).map((row) => `${String(row['kind'])} ${String(row['status'])}${row['error'] === null || row['error'] === undefined ? '' : ` [${String(row['error'])}]`}${row['skip_reason'] === null || row['skip_reason'] === undefined ? '' : ` (${String(row['skip_reason'])})`}`);
  /** A change of an order, told to the outbox as the server's own listener tells it, then everything due is sent. */
  const change = async (order: unknown, values: Record<string, unknown>) => {
    const views = createPublicViews(w.h.meta);
    const table = (await views.viewFor(w.h.connectionId))!.table(t('purchase_orders'));
    const before = await one(`select * from ${t('purchase_orders')} where id = ${String(order)}`);
    await w.update('purchase_orders', order, values);
    const after = await one(`select * from ${t('purchase_orders')} where id = ${String(order)}`);
    await producers.onRecordEvent({ connectionId: w.h.connectionId, table, action: 'update', entity: { connectionId: w.h.connectionId, table: table.id, pk: { id: order }, label: '' }, before, after } as never);
    clock += 60_000;
    await sender.sendApp('inventory', clock);
  };
  const order = async (values: Record<string, unknown> = {}) => {
    const made = (await w.create('purchase_orders', { supplier_id: supplier, place_id: room, ...values })).row;
    await w.create('po_lines', { po_id: made['id'], item_id: gloves, packs: 2, pack_size: 100, price: '9.00' });
    return made['id'];
  };

  beforeAll(async () => {
    if (!run) return;
    // A server that can draw documents, with nothing installed that draws a purchase order: Invoices & Receipts is absent.
    const nothingDraws = { providers: new Map<string, unknown[]>(), slots: new Map(), conflicts: [], problems: [], deciders: new Map() };
    w = await writing(await installBuilt(dialect, inventory, { documents: { runtime: () => nothingDraws as never } }));
    await createSampleDataService(w.h.sampleData).add((await findSampleOwner(w.h.meta, 'inventory', 'add-on'))!, { locale: 'en-US', userId: w.h.owner.id, userLabel: 'owner@test' });
    await settingsRepo(w.h.meta).set('email.smtp', { host: 'localhost', port: 587, user: 'postmaster', passEncrypted: encryptSecret('hunter2', emailSecretKey(TEST_SECRET)), from: 'Alder Street Clinic <no-reply@alder.example>', secure: false } as never);
    const views = createPublicViews(w.h.meta);
    const writes = createWriteService({ sequences: documentSequencesRepo(w.h.meta) });
    producers = createOutboxProducers({ meta: w.h.meta, manager: w.h.manager, viewFor: views.viewFor, writes });
    sender = createOutboxSender({ meta: w.h.meta, manager: w.h.manager, viewFor: views.viewFor, writes, live: () => producers.live(), secret: TEST_SECRET, hostFor: async () => 'alder.example', documents: () => w.h.pipeline! });
    // A supplier of the owner's own, with an address that is a real one's shape; the item and the place are the sample's.
    supplier = n((await w.create('suppliers', { name: 'Calla Wholesale', email: 'orders@calla-wholesale.dev', lead_days: 2 })).row['id']);
    room = n((await one(`select id from ${t('places')} where name = 'Treatment room'`))['id']);
    gloves = n((await one(`select id from ${t('items')} where sku = 'GLV-L'`))['id']);
  }, 600_000);
  afterAll(async () => {
    if (run) await w.h.close();
  });

  it.skipIf(!run)('sending an order queues one message to the order\'s address, listing its lines, with no amount while prices are off — and no PDF line with Invoices absent', async () => {
    const id = await order();
    const before = (await mail()).length;
    await change(id, { status: 'sent', sent_how: 'email' });
    expect(await messagesOf(id)).toEqual(['po-sent sent']);
    const sent = (await mail()).slice(before);
    expect(sent).toHaveLength(1);
    const number = String((await one(`select number from ${t('purchase_orders')} where id = ${String(id)}`))['number']);
    expect(sent[0]!.to).toContain('orders@calla-wholesale.dev');
    expect(sent[0]!.subject).toBe(`Purchase order ${number}`);
    expect(sent[0]!.text).toContain('Hello Calla Wholesale, please supply the items below.');
    expect(sent[0]!.text).toContain('Gloves, nitrile, L');
    expect(sent[0]!.text).toContain('Please deliver to: Treatment room');
    // Prices are off: neither the pack's cost, nor the line's amount, nor a total.
    for (const amount of ['9.00', '18.00', 'Total']) expect(sent[0]!.text, amount).not.toContain(amount);
    // Nothing draws a purchase order here, so nothing promises one.
    expect(sent[0]!.text).not.toContain('PDF');
    expect(sent[0]!.text).not.toContain('{{');
  });

  it.skipIf(!run)('the message is written in the order\'s language, and shows amounts when the order shows prices', async () => {
    const id = await order({ language: 'de_DE', show_prices: true });
    const before = (await mail()).length;
    await change(id, { status: 'sent', sent_how: 'email' });
    expect(await messagesOf(id)).toEqual(['po-sent-priced sent']);
    const [sent] = (await mail()).slice(before);
    const number = String((await one(`select number from ${t('purchase_orders')} where id = ${String(id)}`))['number']);
    expect(sent!.subject).toBe(`Bestellung ${number}`);
    expect(sent!.text).toContain('Calla Wholesale');
    expect(sent!.text).not.toContain('please supply');
    expect(sent!.text).toContain('18');
  });

  it.skipIf(!run)('mark as sent with no email writes to nobody and logs one skipped row; the order still counts as on order', async () => {
    const id = await order();
    const before = (await mail()).length;
    await change(id, { status: 'sent', sent_how: 'none' });
    expect(await mail()).toHaveLength(before);
    expect(await messagesOf(id)).toEqual(['po-sent skipped (no-longer-needed)']);
    const point = await one(`select p.on_order from ${t('stock_points')} p where p.item_id = ${String(gloves)} and p.place_id = ${String(room)}`);
    expect(n(point['on_order'])).toBeGreaterThanOrEqual(200);
  });

  it.skipIf(!run)('an order with no address cannot be sent by email, and can be marked as sent', async () => {
    const quiet = n((await w.create('suppliers', { name: 'Market stall', lead_days: 1 })).row['id']);
    const made = (await w.create('purchase_orders', { supplier_id: quiet, place_id: room })).row;
    await w.create('po_lines', { po_id: made['id'], item_id: gloves, packs: 1, pack_size: 100, price: '9.00' });
    const before = (await mail()).length;
    await expect(w.update('purchase_orders', made['id'], { status: 'sent', sent_how: 'email' })).rejects.toThrow();
    expect((await one(`select status from ${t('purchase_orders')} where id = ${String(made['id'])}`))['status']).toBe('draft');
    await change(made['id'], { status: 'sent', sent_how: 'none' });
    expect((await one(`select status from ${t('purchase_orders')} where id = ${String(made['id'])}`))['status']).toBe('sent');
    expect(await mail()).toHaveLength(before);
  });

  it.skipIf(!run)('send again writes a second message', async () => {
    const id = await order();
    await change(id, { status: 'sent', sent_how: 'email' });
    const before = (await mail()).length;
    await change(id, { resent_at: new Date(clock).toISOString() });
    expect(await messagesOf(id)).toEqual(['po-sent sent', 'po-again sent']);
    expect(await mail()).toHaveLength(before + 1);
  });

  it.skipIf(!run)('an order of the sample data is never sent to anybody: its supplier does not exist', async () => {
    const drafted = (await one(`select id from ${t('purchase_orders')} where number = 'PO-1003'`))['id'];
    const before = (await mail()).length;
    await change(drafted, { status: 'sent', sent_how: 'email' });
    expect(await mail()).toHaveLength(before);
    expect((await mail()).some((message) => message.to.includes('.example'))).toBe(false);
    expect((await one(`select status from ${t('purchase_orders')} where id = ${String(drafted)}`))['status']).toBe('sent');
  });
});
