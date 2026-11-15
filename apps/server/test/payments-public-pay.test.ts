// SPDX-License-Identifier: AGPL-3.0-only
/**
 * PAYING FROM AN APP'S OWN SCREENS (`payments/public-pay.ts`).
 *
 * `available` is true only for an app someone switched on, with a live
 * service, a reachable pay address and payments allowed by the operator.
 * `start` gives the pay link of the app's own payable record only: never
 * another app's or a person's own payable table; its refusals say no more than
 * off / nothing due / not now / not payable; the record's current live link is
 * reused, never retired.
 */
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { connectionsRepo, createSqliteMetaDb, firstRun, payableProfilesRepo, paymentCountersRepo, paymentLinksRepo, paymentSettingsRepo, type MetaDb, type PayableMapping, type RecordRef } from '@adminium/meta';

import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { LINK_FAILURES_TO_LOCK, linkFailBucket } from '../src/payments/checkout.js';
import { PAY_ADDRESS_DOC, payAddressSchema } from '../src/payments/links.js';
import { resolvePayable, type PayableSources } from '../src/payments/payables.js';
import { createPublicPay } from '../src/payments/public-pay.js';
import { TEST_SECRET } from './helpers.js';

const MAPPING: PayableMapping = {
  label: 'number',
  amount: { column: 'total', unit: null },
  currency: { fixed: 'EUR' },
  due: { column: 'balance' },
  payments: { kind: 'kept' },
  status: null,
  customerEmail: null,
  customerCountry: null,
  pageFields: [],
  payableWhen: [{ column: 'status', eq: 'paying' }],
};

describe('paying from an app\'s own screens', () => {
  let meta: MetaDb;
  let live = true;
  let allowed = true;
  let row: Record<string, unknown>;
  let conn = '';
  const sources: PayableSources = {
    table: async (_connection, table) => (table === 'main.orders' ? ({ table: { id: 'main.orders', primaryKey: ['id'] } } as never) : null),
    readRow: async () => row,
    shapeOf: async () => null,
    connectionCurrency: async () => 'EUR',
    profile: async (connectionId, tableName) => {
      const found = await payableProfilesRepo(meta).byTable(connectionId, tableName);
      return found === null ? null : { id: found.id, enabled: found.enabled, mapping: found.mapping, shape: found.shape, ownerApp: found.ownerApp };
    },
    keptPaid: async () => '0',
    document: async () => null,
  };
  let paused: number | null = null;
  const pay = () => createPublicPay({ meta, sources, secret: TEST_SECRET, networkFeatures: true, desktop: false, trustProxy: false, liveOn: async () => live, paymentsAllowed: () => allowed, cardTesting: { pausedUntil: async () => paused } });
  const order = (pk: { id: number } = { id: 7 }): RecordRef => ({ connectionId: conn, table: 'main.orders', pk, label: String(pk.id) });

  beforeEach(async () => {
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    await paymentSettingsRepo(meta).set(PAY_ADDRESS_DOC, payAddressSchema, { origin: 'https://pay.crumbandco.de' });
    conn = (await connectionsRepo(meta, dsnCryptoFromSecret(TEST_SECRET)).create({ name: 'Shop', engine: 'sqlite', introspectDsn: 'sqlite::memory:' })).id;
    live = true;
    allowed = true;
    paused = null;
    row = { id: 7, number: 'C-7', total: '12.50', balance: '12.50', status: 'paying' };
  });
  afterEach(async () => {
    await meta.db.destroy();
  });

  it('is available only for an app switched on, with live payments the operator allows', async () => {
    const made = (await payableProfilesRepo(meta).create({ connectionId: conn, tableName: 'main.orders', mapping: MAPPING, ownerApp: 'counter', createdBy: null, enabled: false }))!;
    expect(await pay().available(conn, 'counter')).toEqual({ online: false });
    await payableProfilesRepo(meta).update(made.id, { enabled: true });
    expect(await pay().available(conn, 'counter')).toEqual({ online: true });
    // Another app, a trial, no live service: nothing.
    expect(await pay().available(conn, 'other')).toEqual({ online: false });
    allowed = false;
    expect(await pay().available(conn, 'counter')).toEqual({ online: false });
    allowed = true;
    live = false;
    expect(await pay().available(conn, 'counter')).toEqual({ online: false });
  });

  it("starts a payment for the app's own payable only, and says no more than why not", async () => {
    const made = (await payableProfilesRepo(meta).create({ connectionId: conn, tableName: 'main.orders', mapping: MAPPING, ownerApp: 'counter', createdBy: null, enabled: false }))!;
    expect(await pay().start(order(), 'counter')).toEqual({ ok: false, reason: 'off' });
    await payableProfilesRepo(meta).update(made.id, { enabled: true });
    const started = await pay().start(order(), 'counter');
    expect(started).toMatchObject({ ok: true, payUrl: expect.stringMatching(/^https:\/\/pay\.crumbandco\.de\/pay\/[A-Za-z0-9_-]{22}$/) });
    // The same link again: a customer's call never retires the one already out.
    expect(await pay().start(order(), 'counter')).toEqual(started);
    // Its own public link, beside the one the shop sent: never in its place.
    expect(await paymentLinksRepo(meta).currentFor({ kind: 'profile', connectionId: conn, tableName: 'main.orders', rowKey: '7' }, 'public')).toMatchObject({ mode: 'live', audience: 'public' });
    expect(await paymentLinksRepo(meta).currentFor({ kind: 'profile', connectionId: conn, tableName: 'main.orders', rowKey: '7' })).toBeNull();
    // Another app's key: not its to start.
    expect(await pay().start(order(), 'other')).toEqual({ ok: false, reason: 'not-payable' });
    row = { ...row, status: 'placed' };
    expect(await pay().start(order(), 'counter')).toEqual({ ok: false, reason: 'not-now' });
    row = { ...row, status: 'paying', balance: '0' };
    expect(await pay().start(order(), 'counter')).toEqual({ ok: false, reason: 'nothing-due' });
  });

  it('keeps a public link its declines locked, and takes no payments while card testing paused public starts', async () => {
    await payableProfilesRepo(meta).create({ connectionId: conn, tableName: 'main.orders', mapping: MAPPING, ownerApp: 'counter', createdBy: null, enabled: true });
    const started = await pay().start(order(), 'counter');
    expect(started.ok).toBe(true);
    const link = (await paymentLinksRepo(meta).currentFor({ kind: 'profile', connectionId: conn, tableName: 'main.orders', rowKey: '7' }, 'public'))!;
    for (let n = 0; n < LINK_FAILURES_TO_LOCK; n += 1) await paymentCountersRepo(meta).hit(linkFailBucket(link.id));
    // Starting again buys no fresh link: the record cannot be paid from the app now.
    expect(await pay().start(order(), 'counter')).toEqual({ ok: false, reason: 'not-now' });
    paused = Date.now() + 60_000;
    expect(await pay().available(conn, 'counter')).toEqual({ online: false });
    expect(await pay().start(order({ id: 8 }), 'counter')).toEqual({ ok: false, reason: 'off' });
  });

  it("rehearses an app's own payable in test mode before it is switched on, never a person's switched-off one", async () => {
    await payableProfilesRepo(meta).create({ connectionId: conn, tableName: 'main.orders', mapping: MAPPING, ownerApp: 'counter', createdBy: null, enabled: false });
    const ref = { kind: 'profile' as const, connectionId: conn, tableName: 'main.orders', rowKey: '7' };
    // Every later step reads the payable in the link's mode: off for real money, on for a test payment.
    expect((await resolvePayable(sources, ref))?.refusal?.code).toBe('NOT_PAYABLE');
    expect(await resolvePayable(sources, ref, { mode: 'test' })).toMatchObject({ refusal: null, currency: 'EUR', due: '12.50' });
    expect(await pay().startTest(order(), 'counter', 'https://staff.crumbandco.de', 'user-1')).toMatchObject({ ok: true, payUrl: expect.stringMatching(/^https:\/\/staff\.crumbandco\.de\/pay\//) });
    expect(await pay().start(order(), 'counter')).toEqual({ ok: false, reason: 'off' });
  });

  it("keeps a person's switched-off payable off in test mode too", async () => {
    await payableProfilesRepo(meta).create({ connectionId: conn, tableName: 'main.orders', mapping: MAPPING, ownerApp: null, createdBy: null, enabled: false });
    const ref = { kind: 'profile' as const, connectionId: conn, tableName: 'main.orders', rowKey: '7' };
    expect((await resolvePayable(sources, ref, { mode: 'test' }))?.refusal?.code).toBe('NOT_PAYABLE');
  });

  it('never starts a payment for a table a person made payable', async () => {
    await payableProfilesRepo(meta).create({ connectionId: conn, tableName: 'main.orders', mapping: MAPPING, ownerApp: null, createdBy: null });
    expect(await pay().start(order(), 'counter')).toEqual({ ok: false, reason: 'not-payable' });
    expect(await pay().available(conn, 'counter')).toEqual({ online: false });
  });
});
