// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An invoice made on the Invoices page takes payments: it carries an ISO
 * currency code, its Payment panel reads the payments Adminium keeps for it,
 * and its Paid status follows the balance both ways — set when nothing is
 * left to pay, cleared when a refund opens the balance again — while Draft,
 * Live, Sent and Overdue stay the person's to pick. On every meta engine.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { invoiceDocumentsRepo, keptPaymentsRepo, paymentAttemptsRepo, refundsRepo, rolesRepo, usersRepo, type MetaDb, type PayableRef, type User } from '@adminium/meta';

import { acceptInvoiceBody, currencyCodeForSymbol, normalizeInvoiceBody } from '../src/invoices/document.js';
import { documentRef, followDocumentStatus, statusAfter } from '../src/payments/document-status.js';
import { createPayableSources, type PayableSources } from '../src/payments/payables.js';
import { recordAttempt } from '../src/payments/record.js';
import { followRecord } from '../src/payments/refunds.js';
import { TEST_PAYABLE_PREFIX } from '../src/payments/test-payables.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { invoicesRoutes } from '../src/routes/invoices/index.js';
import { paymentPanelRoutes } from '../src/routes/payments/panel.js';
import { buildBareApp, type BareApp } from './jobs-helpers.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

describe('the status the balance puts down', () => {
  const none = { follows: false, settled: false, paidIn: null };
  const open = { follows: true, settled: false, paidIn: 'EUR' };
  const settled = { follows: true, settled: true, paidIn: 'EUR' };

  it('never takes Paid by hand, and keeps every other pick until a payment is in charge', () => {
    expect(statusAfter('sent', 'paid', none)).toBe('sent');
    expect(statusAfter('sent', 'overdue', none)).toBe('overdue');
    // An invoice marked Paid before payments were recorded keeps it, and may be moved off it.
    expect(statusAfter('paid', 'paid', none)).toBe('paid');
    expect(statusAfter('paid', 'sent', none)).toBe('sent');
  });

  it('sets Paid at a zero balance whatever was asked, and clears it when the balance opens', () => {
    expect(statusAfter('sent', 'sent', settled)).toBe('paid');
    expect(statusAfter('paid', 'overdue', settled)).toBe('paid');
    expect(statusAfter('paid', 'paid', open)).toBe('sent');
    expect(statusAfter('overdue', 'overdue', open)).toBe('overdue');
    expect(statusAfter('sent', 'paid', open)).toBe('sent');
  });

  it('reads a code only from a symbol that can mean one currency', () => {
    expect(currencyCodeForSymbol('€')).toBe('EUR');
    expect(currencyCodeForSymbol('£')).toBe('GBP');
    expect(currencyCodeForSymbol('$')).toBeNull();
    expect(currencyCodeForSymbol('¥')).toBeNull();
    expect(acceptInvoiceBody({ currency: '€' }).currencyCode).toBe('EUR');
    expect(acceptInvoiceBody({ currency: '$' }).currencyCode).toBeNull();
    expect(acceptInvoiceBody({ currency: '$', currencyCode: 'cad' }).currencyCode).toBe('CAD');
    expect(acceptInvoiceBody({ currency: '$', currencyCode: 'dollars' }).currencyCode).toBeNull();
    // A stored body is never given a code by reading it.
    expect(normalizeInvoiceBody({ currency: '€' }).currencyCode).toBeNull();
  });
});

describe.each(META_ENGINES.map((engine) => [engine.name, engine] as const))('a designer invoice takes payments — %s', (name, engine) => {
  let handle: MetaHandle;
  let meta: MetaDb;
  let app: BareApp;
  let sources: PayableSources;
  let owner: User;
  let viewer: User;
  let n = 0;

  beforeAll(async () => {
    if (!engine.available) return;
    handle = await engine.make();
    meta = handle.meta;
    const users = usersRepo(meta);
    const roles = rolesRepo(meta);
    owner = await users.create({ email: `ava-${name}@adminium.test`, name: 'Ava Stone', status: 'active' });
    await roles.assignToUser(owner.id, (await roles.findBySlug('super-admin'))!.id);
    viewer = await users.create({ email: `liam-${name}@adminium.test`, name: 'Liam', status: 'active' });
    await roles.assignToUser(viewer.id, (await roles.findBySlug('viewer'))!.id);
    sources = createPayableSources({ meta, manager: {} as never });
    app = buildBareApp();
    app.addHook('onRequest', async (request) => {
      const id = request.headers['x-test-user-id'];
      if (typeof id !== 'string') return;
      const user = await users.findById(id);
      if (user !== null) (request as unknown as { user: object }).user = { id: user.id, name: user.name, email: user.email };
    });
    await app.register(rbacPlugin, { meta });
    await app.register(invoicesRoutes({ meta, paymentSources: sources }));
    await app.register(paymentPanelRoutes({ meta, manager: {} as never, sources, networkFeatures: true, desktop: false, trustProxy: false }));
    await app.ready();
  }, 120_000);

  afterAll(async () => {
    if (!engine.available) return;
    await app.close();
    await handle.destroy();
  });

  const as = (user: User) => ({ 'x-test-user-id': user.id });

  /** A sent invoice of one €120.00 line, saved with the symbol only (the code is read from it). */
  async function sentInvoice(symbol = '€'): Promise<string> {
    const made = await app.inject({ method: 'POST', url: '/invoices', headers: as(owner), payload: { kind: 'invoice', name: 'Bakery order' } });
    expect(made.statusCode, made.body).toBe(201);
    const id = (made.json() as { id: string }).id;
    n += 1;
    const saved = await save(id, 'sent', { currency: symbol, number: `INV-${name}-${String(n)}`, items: [{ id: 'l1', desc: 'Cake', qty: '1', rate: '120' }], taxRate: '0' });
    expect(saved.statusCode, saved.body).toBe(200);
    return id;
  }

  function save(id: string, status: string, body: Record<string, unknown>) {
    return app.inject({ method: 'PUT', url: `/invoices/${id}`, headers: as(owner), payload: { name: 'Bakery order', status, topic: 'other', lang: 'en', body } });
  }

  async function stored(id: string) {
    return (await invoiceDocumentsRepo(meta).findById(id))!;
  }

  const panel = (user: User, documentId: string) => app.inject({ method: 'POST', url: '/payments/panel', headers: as(user), payload: { documentId } });
  const key = () => {
    n += 1;
    return `dk-${name}-${String(n).padStart(4, '0')}-abcdefgh`;
  };
  const record = (user: User, documentId: string, amount: string) =>
    app.inject({ method: 'POST', url: '/payments/record-payment', headers: as(user), payload: { documentId, amount, way: 'bank-transfer', paidOn: '2026-10-20', note: null, approvalCode: null, last4: null, key: key() } });

  /** An online payment the provider took and the record job wrote down. */
  async function paidOnline(ref: PayableRef, amount: string, mode: 'live' | 'test' = 'live'): Promise<string> {
    const attempts = paymentAttemptsRepo(meta);
    n += 1;
    const attempt = (await attempts.create({ provider: 'payments-stripe', mode, accountId: 'acct', payable: ref, payableLabel: 'INV', amount, currency: 'EUR', linkId: null, nonce: `dn-${name}-${String(n)}`, createdBy: null }))!;
    await attempts.move(attempt.id, 'open', { providerRef: `cs_d_${name}_${String(n)}` });
    await attempts.move(attempt.id, 'succeeded', { takenAmount: amount, takenCurrency: 'EUR', paymentRef: `pi_d_${name}_${String(n)}`, paidWith: { method: 'card', label: 'Visa ••4242', delayed: false } });
    expect(await recordAttempt({ meta, sources }, attempt.id)).toMatchObject({ state: 'recorded' });
    return attempt.id;
  }

  it.runIf(engine.available)('keeps the ISO code on the invoice, and the stored one when an older editor sends none', async () => {
    const id = await sentInvoice();
    expect((await stored(id)).body['currencyCode']).toBe('EUR');
    const older = await save(id, 'sent', { currency: '€', items: [{ id: 'l1', desc: 'Cake', qty: '1', rate: '120' }], taxRate: '0' });
    expect(older.statusCode, older.body).toBe(200);
    expect((older.json() as { body: { currencyCode: string | null } }).body.currencyCode).toBe('EUR');
    // A `$` says no one currency: the invoice cannot be paid until a code is chosen.
    const dollars = await sentInvoice('$');
    const unclear = (await panel(owner, dollars)).json() as { data: { refusal: { code: string }; mayRecord: boolean } };
    expect(unclear.data).toMatchObject({ refusal: { code: 'NO_CURRENCY' }, mayRecord: false });
    expect((await save(dollars, 'sent', { currency: '$', currencyCode: 'USD', items: [{ id: 'l1', desc: 'Cake', qty: '1', rate: '120' }], taxRate: '0' })).statusCode).toBe(200);
    expect(((await panel(owner, dollars)).json() as { data: { currency: string; due: string } }).data).toMatchObject({ currency: 'USD', due: '120.00' });
  });

  it.runIf(engine.available)('shows the panel to anyone signed in, the actions to who may change documents, and none to a stranger', async () => {
    const id = await sentInvoice();
    const mine = (await panel(owner, id)).json() as { data: Record<string, unknown> };
    expect(mine.data).toMatchObject({ payable: { kind: 'document', connectionId: null, tableName: null, rowKey: id }, currency: 'EUR', total: '120.00', due: '120.00', paid: '0.00', mayChange: true, mayRecord: true, payments: [] });
    const theirs = (await panel(viewer, id)).json() as { data: Record<string, unknown> };
    expect(theirs.data).toMatchObject({ mayChange: false, mayRecord: false });
    expect((await record(viewer, id, '10.00')).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/payments/panel', payload: { documentId: id } })).statusCode).toBe(401);
    // A template, a test payable's id and an id that is not there have no panel.
    const template = (await app.inject({ method: 'POST', url: '/invoices', headers: as(owner), payload: { kind: 'template' } })).json() as { id: string };
    for (const other of [template.id, `${TEST_PAYABLE_PREFIX}abc`, 'inv_gone']) {
      expect(((await panel(owner, other)).json() as { data: unknown }).data).toBeNull();
    }
    expect((await record(owner, `${TEST_PAYABLE_PREFIX}abc`, '1.00')).statusCode).toBe(404);
  });

  it.runIf(engine.available)('turns Paid at a zero balance by hand payments, and holds it against a save that asks otherwise', async () => {
    const id = await sentInvoice();
    expect((await record(owner, id, '50.00')).json()).toMatchObject({ data: { already: false, due: '70.00' } });
    expect((await stored(id)).status).toBe('sent');
    expect((await record(owner, id, '70.00')).json()).toMatchObject({ data: { due: '0' } });
    expect((await stored(id)).status).toBe('paid');
    const view = ((await panel(owner, id)).json() as { data: { payments: { amount: string; recordedBy: string; way: string }[]; paid: string; mayRecord: boolean } }).data;
    expect(view).toMatchObject({ paid: '120.00', mayRecord: false });
    expect(view.payments.map((payment) => [payment.amount, payment.way, payment.recordedBy])).toEqual([
      ['50.00', 'bank-transfer', 'Ava Stone'],
      ['70.00', 'bank-transfer', 'Ava Stone'],
    ]);
    // An editor still showing Sent saves: the balance has the last word.
    const stale = await save(id, 'sent', { currency: '€', currencyCode: 'EUR', items: [{ id: 'l1', desc: 'Cake', qty: '1', rate: '120' }], taxRate: '0' });
    expect(stale.statusCode, stale.body).toBe(200);
    expect(stale.json()).toMatchObject({ status: 'paid' });
    // Paid in euros: the currency stays.
    const moved = await save(id, 'paid', { currency: '$', currencyCode: 'USD', items: [{ id: 'l1', desc: 'Cake', qty: '1', rate: '120' }], taxRate: '0' });
    expect(moved.statusCode).toBe(422);
    expect(moved.json()).toMatchObject({ error: { details: { code: 'CURRENCY_HAS_PAYMENTS', currency: 'EUR' } } });
    // A larger total opens the balance again: Paid is cleared.
    const grown = await save(id, 'paid', { currency: '€', currencyCode: 'EUR', items: [{ id: 'l1', desc: 'Cake', qty: '1', rate: '150' }], taxRate: '0' });
    expect(grown.json()).toMatchObject({ status: 'sent' });
  });

  it.runIf(engine.available)('never lets Paid be picked by hand, and keeps one marked Paid before any payment', async () => {
    const id = await sentInvoice();
    expect((await save(id, 'paid', { currency: '€', items: [{ id: 'l1', desc: 'Cake', qty: '1', rate: '120' }], taxRate: '0' })).json()).toMatchObject({ status: 'sent' });
    expect((await save(id, 'overdue', { currency: '€', items: [{ id: 'l1', desc: 'Cake', qty: '1', rate: '120' }], taxRate: '0' })).json()).toMatchObject({ status: 'overdue' });
    // One marked Paid before payments were recorded (a receipt starter, an older install): it stays Paid.
    await invoiceDocumentsRepo(meta).patch(id, { status: 'paid' }, Date.now());
    expect((await save(id, 'paid', { currency: '€', items: [{ id: 'l1', desc: 'Cake', qty: '1', rate: '120' }], taxRate: '0' })).json()).toMatchObject({ status: 'paid' });
    expect(await followDocumentStatus({ meta, sources }, documentRef(id))).toBe('paid');
  });

  it.runIf(engine.available)('follows an online payment and its refunds both ways; a test payment changes nothing', async () => {
    const id = await sentInvoice();
    const ref = documentRef(id);
    await paidOnline(ref, '120.00', 'test');
    expect((await stored(id)).status).toBe('sent');
    const attemptId = await paidOnline(ref, '120.00');
    expect((await stored(id)).status).toBe('paid');

    const refunds = refundsRepo(meta);
    const kept = (await keptPaymentsRepo(meta).byAttempt(attemptId))!;
    const { refund } = await refunds.create({ attemptId, paymentId: kept.id, provider: 'payments-stripe', mode: 'live', paymentRef: `pi_ref_${name}`, amount: '40.00', currency: 'EUR', reason: 'requested_by_customer', note: null, idempotencyKey: `idem-${name}`, source: 'staff', requestedBy: null, state: 'succeeded', providerRefundId: `re_${name}` });
    expect(await followRecord({ meta, sources }, attemptId)).toBe('written');
    expect((await stored(id)).status).toBe('sent');
    expect(((await panel(owner, id)).json() as { data: { due: string } }).data.due).toBe('40.00');

    // The refund failed after all: the balance closes and Paid comes back.
    await refunds.move(refund.id, 'failed', { failureMessage: 'The card was closed.' });
    expect(await followRecord({ meta, sources }, attemptId)).toBe('written');
    expect((await stored(id)).status).toBe('paid');
  });
});
