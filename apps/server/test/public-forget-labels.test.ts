// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Delete my details" takes the person's stored labels and customs invoices,
 * on every engine, as the staff erasure does: on every order linked to them,
 * with or without a declared copy on it, kept by law or not, and on one already
 * removed. An order that merely holds the same typed address is not theirs.
 */
import { removedRowsRepo, shippingBookingsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { installInvoicing, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { guest, mailReady, shopManifest } from './person-fixture.js';
import { servePublic } from './public-lane.helpers.js';

type Doc = Record<string, unknown>;

/** No `forget.copies`: the labels go whether or not the app asks for its copies to. */
function shop(): Doc {
  const manifest = shopManifest({ entries: (entries) => entries.map((entry) => (entry['table'] === 'customers' && entry['forget'] !== undefined ? { ...entry, forget: { columns: ['email', 'name', 'phone'], stamp: 'forgotten_at' } } : entry)) });
  const tables = (manifest['requiredSchema'] as { tables: Doc[] }).tables;
  tables.push({
    ref: 'receipts',
    keep: { law: 'tax' },
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'customer_id', type: 'fk', references: 'customers', nullable: true },
      { ref: 'buyer_email', type: 'text', maxLength: 254, nullable: true },
    ],
  });
  (manifest['compatibility'] as Doc)['minAdminiumVersion'] = '0.3.74';
  (manifest['outbox'] as Doc)['classes'] = { 'order-placed': 'service' };
  manifest['people'] = [{ table: 'customers', kind: 'people', email: 'email', name: 'name', copies: [{ table: 'receipts', column: 'buyer_email', holds: 'email', via: 'customer_id' }] }];
  return manifest;
}

describe.each(LEGS)('"delete my details" and the parcels — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let customer: Awaited<ReturnType<typeof servePublic>>;
  let g: ReturnType<typeof guest>;
  const bookings: Record<string, string> = {};
  let serial = 0;
  let idOf: (ref: string) => string;

  const book = async (name: string, table: string, rowKey: string) => {
    serial += 1;
    const repo = shippingBookingsRepo(h.meta);
    const made = await repo.reserve(
      {
        installId: 'inst',
        carrierInstallId: 'carrier',
        carrierKey: 'shipping-shippo',
        connectionId: h.connectionId,
        tableRef: table,
        tableName: idOf(table),
        rowKey,
        purpose: 'outbound',
        parcelNumber: serial,
        reference: `ORD-${String(serial)}`,
        mode: 'live',
        accountFingerprint: 'f'.repeat(64),
        detailsHash: 'd'.repeat(64),
        service: 'Evri 48',
        rateCode: 'evri-48',
        handleSealed: null,
        quotedAmount: '3.10',
        quotedCurrency: 'GBP',
        createdBy: 'user',
        labelSize: 'a4',
      },
      1,
    );
    if (!made.ok) throw new Error('no slot');
    await repo.move(made.booking.id, ['reserved'], 'booked', { carrierShipmentId: `tx_${String(serial)}`, tracking: `TRK-${String(serial)}`, answeredAt: 1 }, 1);
    bookings[name] = made.booking.id;
  };
  const gone = async (name: string) => (await shippingBookingsRepo(h.meta).byId(bookings[name]!))!.labelGoneWhy;

  const order = async (email: string, name: string) => {
    const res = await g.request('POST', `/records/${h.real('orders')}_verified_2`, { payload: { values: { email, name, note: 'n' }, children: { order_items: [{ values: { dish: 'Soup', qty: 1 } }] } }, proof: 'write' });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: { id: number } }).data.id;
  };

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, shop());
    await mailReady(h.meta);
    customer = await servePublic(h, (h.reply['publicAccess'] as { keys: Record<string, string> }).keys['customer']!);
    g = guest(customer, h);
    const { targetOf } = await writerFor(h);
    idOf = (ref) => targetOf(ref).table.id;
    const mine = await order('lea@fieldmail.io', 'Lea Stone');
    const other = await order('max@fieldmail.io', 'Max Bell');
    const [lea] = await h.rows(`select id from ${h.real('customers')} where email = 'lea@fieldmail.io'`);
    const leaId = Number(lea!['id']);
    await h.rows(`insert into ${h.real('orders')} (email, name, note, status) values ('lea@fieldmail.io', 'Someone Else', 'Not hers', 'placed')`);
    const [unlinked] = await h.rows(`select id from ${h.real('orders')} where name = 'Someone Else'`);
    await h.rows(`insert into ${h.real('receipts')} (customer_id, buyer_email) values (${String(leaId)}, 'lea@fieldmail.io')`);
    const [receipt] = await h.rows(`select id from ${h.real('receipts')} where customer_id = ${String(leaId)}`);
    await book('mine', 'orders', String(mine));
    await book('other', 'orders', String(other));
    await book('unlinked', 'orders', String(Number(unlinked!['id'])));
    await book('kept', 'receipts', String(Number(receipt!['id'])));
    await book('removed', 'orders', '9001');
    await removedRowsRepo(h.meta).add({
      connectionId: h.connectionId,
      entityTable: idOf('orders'),
      entityId: '9001',
      pk: { id: 9001 },
      links: [{ via: 'customer_id', parentTable: idOf('customers'), parentValue: String(leaId) }],
      removedAt: 1,
      actorKind: 'user',
      actorId: 'usr',
      actorLabel: 'Staff',
      reason: null,
      image: { id: 9001 },
    });
    const session = await g.signIn('lea@fieldmail.io');
    const res = await g.request('DELETE', '/account', { session });
    expect(res.statusCode, res.body).toBe(200);
  }, 240_000);

  afterAll(async () => {
    if (!available) return;
    await customer.close();
    await h.close();
  });

  it.skipIf(!available)('takes the label of an order linked to them', async () => {
    expect(await gone('mine')).toBe('erased');
  });

  it.skipIf(!available)('takes it from a row the law keeps, and from an order already removed', async () => {
    expect(await gone('kept')).toBe('erased');
    expect(await gone('removed')).toBe('erased');
  });

  it.skipIf(!available)('leaves another customer\'s, and an order that only holds the same typed address', async () => {
    expect(await gone('other')).toBeNull();
    expect(await gone('unlinked')).toBeNull();
  });
});
