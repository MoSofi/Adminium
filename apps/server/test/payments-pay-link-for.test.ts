// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A printed invoice's pay link: the `pay-link` slot default fills a text slot
 * with the record's live link, a QR slot with the same link when it is short
 * enough, and a date slot with the day that link stops opening; the link is
 * the record's current one, made only when there is none, and only when the
 * record can be paid online right now.
 */
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createSqliteMetaDb, firstRun, paymentLinksRepo, paymentSettingsRepo, type MetaDb, type RecordRef } from '@adminium/meta';

import { buildSubject, type SubjectSlot } from '../src/documents/subject.js';
import { PAY_ADDRESS_DOC, payAddressSchema } from '../src/payments/links.js';
import type { PayableSources } from '../src/payments/payables.js';
import { createPayLinkFor, createPayLinkWithExpiryFor } from '../src/payments/pay-link-for.js';
import { TEST_SECRET } from './helpers.js';

const SLOTS: SubjectSlot[] = [
  { id: 'payUrl', type: 'text', required: false, default: 'pay-link' },
  { id: 'payQr', type: 'qr', required: false, default: 'pay-link' },
];

function subjectWith(payLink: string | null) {
  return buildSubject({ slots: SLOTS, mapping: {}, row: {}, payLink, now: { iso: '2026-10-21T10:00:00.000Z', timezone: 'UTC' }, locale: 'en-US', currency: 'EUR', business: { name: 'Crumb & Co.', lines: [] }, entity: null, number: null });
}

describe('the pay-link slot default', () => {
  it('prints the link, and the same link as a code when it is short enough', () => {
    const short = 'https://pay.crumbandco.de/pay/AAAAAAAAAAAAAAAAAAAAAA';
    const built = subjectWith(short).subject.fields;
    expect(built['payUrl']).toBe(short);
    expect(built['payQr']).toMatchObject({ text: short });
    const long = `https://pay.a-very-long-customer-domain-name.example.com/pay/AAAAAAAAAAAAAAAAAAAAAA`;
    const longBuilt = subjectWith(long).subject.fields;
    expect(longBuilt['payUrl']).toBe(long);
    expect(longBuilt['payQr']).toBeUndefined();
  });

  it('leaves both empty when the record cannot be paid online', () => {
    const built = subjectWith(null).subject.fields;
    expect(built['payUrl']).toBeUndefined();
    expect(built['payQr']).toBeUndefined();
  });

  it('prints the day the link stops opening in a date slot, on the venue\'s clock, and only beside a link', () => {
    const slots: SubjectSlot[] = [...SLOTS, { id: 'payUntil', type: 'date', required: false, default: 'pay-link' }];
    const short = 'https://pay.crumbandco.de/pay/AAAAAAAAAAAAAAAAAAAAAA';
    // 23:30 UTC on 20 November is already the 21st in Berlin.
    const until = Date.parse('2026-11-20T23:30:00.000Z');
    const at = (timezone: string, payLink: string | null, payLinkExpiresAt: number | null) =>
      buildSubject({ slots, mapping: {}, row: {}, payLink, payLinkExpiresAt, now: { iso: '2026-10-21T10:00:00.000Z', timezone }, locale: 'en-US', currency: 'EUR', business: { name: 'Crumb & Co.', lines: [] }, entity: null, number: null }).subject.fields;
    expect(at('UTC', short, until)['payUntil']).toBe('2026-11-20');
    expect(at('Europe/Berlin', short, until)['payUntil']).toBe('2026-11-21');
    expect(at('Europe/Berlin', short, until)['payUrl']).toBe(short);
    // No link, no day; and a link whose end nobody said prints no day.
    expect(at('UTC', null, until)['payUntil']).toBeUndefined();
    expect(at('UTC', short, null)['payUntil']).toBeUndefined();
  });
});

describe('a record\'s live pay link for a document', () => {
  let meta: MetaDb;
  let due = '120.00';
  let status = 'sent';
  let live = true;
  const sources: PayableSources = {
    table: async (_connection, table) => (table === 'main.invoices' ? ({ table: { id: 'main.invoices' } } as never) : null),
    readRow: async () => ({ id: 42, number: 'INV-0042', status, currency: 'EUR', total: '120.00', balance: due }),
    shapeOf: async () => ({ version: 2, paymentsTable: 'main.payments' }),
    connectionCurrency: async () => 'EUR',
    // The app's invoices, switched on for online payments in Payments.
    profile: async () => ({ id: 'ppf_s', enabled: true, mapping: null, shape: { kind: 'shape' } }),
    keptPaid: async () => '0',
    document: async () => null,
  };
  const entity: RecordRef = { connectionId: 'conn_1', table: 'main.invoices', pk: { id: 42 }, label: 'INV-0042' };

  beforeEach(async () => {
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    await paymentSettingsRepo(meta).set(PAY_ADDRESS_DOC, payAddressSchema, { origin: 'https://pay.crumbandco.de' });
    due = '120.00';
    status = 'sent';
    live = true;
  });

  afterEach(async () => {
    await meta.db.destroy();
  });

  const linkFor = () => createPayLinkFor({ meta, sources, secret: TEST_SECRET, networkFeatures: true, desktop: false, trustProxy: false, liveOn: async () => live })(entity);

  it('makes a live link once, and prints the same one every time after', async () => {
    const first = await linkFor();
    expect(first).toMatch(/^https:\/\/pay\.crumbandco\.de\/pay\/[A-Za-z0-9_-]{22}$/);
    expect(await linkFor()).toBe(first);
    const current = await paymentLinksRepo(meta).currentFor({ kind: 'shape', connectionId: 'conn_1', tableName: 'main.invoices', rowKey: '42' });
    expect(current?.mode).toBe('live');
  });

  it('says when the printed link stops opening: its own expiry, not a fresh one for each print', async () => {
    let now = Date.parse('2026-11-16T09:00:00.000Z');
    const withExpiry = () => createPayLinkWithExpiryFor({ meta, sources, secret: TEST_SECRET, networkFeatures: true, desktop: false, trustProxy: false, liveOn: async () => live, now: () => now })(entity);
    const first = await withExpiry();
    expect(first).not.toBeNull();
    const current = await paymentLinksRepo(meta).currentFor({ kind: 'shape', connectionId: 'conn_1', tableName: 'main.invoices', rowKey: '42' });
    expect(first).toEqual({ url: expect.stringMatching(/^https:\/\/pay\.crumbandco\.de\/pay\//), expiresAt: current!.expiresAt });
    // A link lasts 30 days.
    expect(first!.expiresAt - Date.parse('2026-11-16T09:00:00.000Z')).toBe(30 * 86_400_000);
    // Printed again a week later: the same link, the same day.
    now += 7 * 86_400_000;
    expect(await withExpiry()).toEqual(first);
    status = 'draft';
    expect(await withExpiry()).toBeNull();
  });

  it('prints none for a paid or draft invoice, before live payments, or while customers cannot reach the pay address', async () => {
    due = '0.00';
    expect(await linkFor()).toBeNull();
    due = '120.00';
    status = 'draft';
    expect(await linkFor()).toBeNull();
    status = 'sent';
    live = false;
    expect(await linkFor()).toBeNull();
    live = true;
    await paymentSettingsRepo(meta).set(PAY_ADDRESS_DOC, payAddressSchema, { origin: 'http://192.168.1.20:4600' });
    expect(await linkFor()).toBeNull();
    expect(await paymentLinksRepo(meta).currentFor({ kind: 'shape', connectionId: 'conn_1', tableName: 'main.invoices', rowKey: '42' })).toBeNull();
  });
});
