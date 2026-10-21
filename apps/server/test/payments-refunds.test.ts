// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Refunds, on every engine this run can reach, against a stand-in provider:
 * what may be refunded and why not, one refund per confirmation key, two at
 * once never promising back more than was taken, the record following into
 * its own payments table (or the payment Adminium keeps, or an invoice
 * table built on the invoice shape) and its status rule, a refund done and
 * then failed taken back out, a refund made in the provider's dashboard
 * recorded as made there, and a dispute refusing refunds until it closes.
 *
 * Then what goes wrong: a write to the record that fails after the provider
 * refunded, an answer lost while the provider's event arrives, a test or
 * demo refund, a refund made before its payment was written down, answers
 * that are no refusal, dispute events out of order, a provider's amount in
 * other decimals, another currency or past what was paid, a payment row since
 * deleted, currencies without decimals or with three, and a person whose row
 * limits hide the record.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PaymentProvider, ProviderErrorCode, RefundInput, RefundState } from '@adminium/add-on-contracts';
import { keptPaymentsRepo, payableProfilesRepo, paymentAttemptsRepo, permissionsRepo, refundsRepo, rolesRepo, usersRepo, type PayableMapping, type PayableRef, type User } from '@adminium/meta';

import { createWriteService, type RecordWriteService } from '../src/crud/write-service.js';
import { writeStores } from '../src/crud/write-stores.js';
import { errorEnvelope } from '../src/errors.js';
import type { JobRegistry } from '../src/jobs/registry.js';
import { followEvent } from '../src/payments/webhook.js';

import { createPayableSources, resolvePayable, type PayableSources } from '../src/payments/payables.js';
import { recordAttempt } from '../src/payments/record.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { paymentPanelRoutes } from '../src/routes/payments/panel.js';
import { paymentRefundRoutes } from '../src/routes/payments/refunds.js';
import { disputeEvent, followRecord, pickUpRefunds, refundableOf, refundEvent, refundRefusalOf, registerPaymentsRefundHandler, requestRefund, settleRefund, type RefundDeps } from '../src/payments/refunds.js';
import { installInvoicing, invoicingManifest, invoicingTables, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';

const PROVIDER = 'payments-fake';

function tables(): Record<string, unknown>[] {
  const all = invoicingTables().map((table) =>
    (table as { ref: string }).ref === 'payments'
      ? {
          ...table,
          columns: [
            ...((table as { columns: unknown[] }).columns),
            { ref: 'payment_ref', type: 'text', maxLength: 64, nullable: true, unique: true },
            { ref: 'method', type: 'text', maxLength: 40, nullable: true },
            { ref: 'method_note', type: 'text', maxLength: 120, nullable: true },
            { ref: 'paid_on', type: 'date', nullable: true },
            { ref: 'refunded_amount', type: 'decimal', scale: 2, default: 0 },
          ],
        }
      : table,
  );
  all.push({
    ref: 'deposits',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'label', type: 'text', maxLength: 40, nullable: true },
      { ref: 'amount', type: 'decimal', scale: 2 },
      { ref: 'currency', type: 'text', maxLength: 3, nullable: true },
      { ref: 'status', type: 'enum', enum: ['open', 'paid', 'refunded'], default: 'open' },
    ],
  });
  // What a currency without decimals or with three is paid on: kept by Adminium.
  all.push({
    ref: 'top_ups',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'label', type: 'text', maxLength: 40, nullable: true },
      { ref: 'amount', type: 'decimal', scale: 3 },
      { ref: 'currency', type: 'text', maxLength: 3, nullable: true },
    ],
  });
  // An invoice table built on the invoice shape (`@2`): its payments keep their refunds, and `paid` sums what is left of each.
  all.push({
    ref: 'shape_invoices',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'number', type: 'text', maxLength: 24, nullable: true },
      { ref: 'status', type: 'enum', enum: ['draft', 'sent', 'void'], default: 'draft' },
      { ref: 'currency', type: 'text', maxLength: 3, nullable: true },
      { ref: 'total', type: 'decimal', scale: 2, nullable: true },
      { ref: 'paid', type: 'decimal', scale: 2, nullable: true, rules: { rollup: { from: 'shape_payments', via: 'document_id', sum: 'net_amount', where: { column: 'voided', eq: false }, balance: { column: 'balance', of: 'total' }, cap: true } } },
      { ref: 'balance', type: 'decimal', scale: 2, nullable: true },
    ],
  });
  all.push({
    ref: 'shape_payments',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'document_id', type: 'fk', references: 'shape_invoices' },
      { ref: 'amount', type: 'decimal', scale: 2 },
      { ref: 'currency', type: 'text', maxLength: 3, nullable: true },
      { ref: 'paid_on', type: 'date', nullable: true },
      { ref: 'method', type: 'text', maxLength: 40, nullable: true },
      { ref: 'method_note', type: 'text', maxLength: 120, nullable: true },
      { ref: 'payment_ref', type: 'text', maxLength: 64, nullable: true, unique: true },
      { ref: 'refunded_amount', type: 'decimal', scale: 2, default: 0 },
      { ref: 'net_amount', type: 'decimal', scale: 2, nullable: true, rules: { formula: { sub: ['amount', { coalesce: ['refunded_amount', 0] }] } } },
      { ref: 'voided', type: 'bool', default: false },
    ],
  });
  return all;
}

/** A stand-in provider: refunds settle as `next` says, keyed like the real ones. */
function fakeProvider() {
  const byKey = new Map<string, RefundState>();
  const byRef = new Map<string, RefundState>();
  let next: RefundState['status'] = 'succeeded';
  let refused: string | null = null;
  let lose = false;
  let answerNext: { code: ProviderErrorCode; retryable: boolean } | null = null;
  let count = 0;
  let asks = 0;
  const provider = {
    key: PROVIDER,
    mode: 'live',
    async refund(input: RefundInput) {
      asks += 1;
      // A moment at the provider, so two asks at once would overlap.
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (refused !== null) return { ok: false, code: 'REFUND_REFUSED', providerMessage: refused, retryable: false } as const;
      if (answerNext !== null) {
        const answer = { ok: false, code: answerNext.code, providerMessage: 'Not now.', retryable: answerNext.retryable } as const;
        answerNext = null;
        return answer;
      }
      const known = byKey.get(input.idempotencyKey);
      if (known !== undefined) return known;
      count += 1;
      const state: RefundState = { ok: true, ref: `re_${String(count)}`, paymentRef: input.paymentRef, status: next, amount: input.amount, currency: input.currency, failureMessage: next === 'failed' ? 'The card was closed.' : null };
      byKey.set(input.idempotencyKey, state);
      byRef.set(state.ref, state);
      // Made at the provider, but the answer never comes back.
      if (lose) {
        lose = false;
        return { ok: false, code: 'UNAVAILABLE', providerMessage: 'Timed out.', retryable: true } as const;
      }
      return state;
    },
    async refundStatus(ref: string) {
      return byRef.get(ref) ?? ({ ok: false, code: 'NOT_FOUND', providerMessage: 'No such refund.', retryable: false } as const);
    },
  } as unknown as PaymentProvider;
  return {
    provider,
    calls: () => count,
    asks: () => asks,
    setNext: (status: RefundState['status']) => (next = status),
    refuseWith: (message: string | null) => (refused = message),
    /** The next refund is made, and its answer lost on the way back. */
    loseNext: () => (lose = true),
    /** The next ask is answered with this, and nothing is made. */
    answerNextWith: (code: ProviderErrorCode, retryable: boolean) => (answerNext = { code, retryable }),
    /** The ref the provider made for a key, as its event would name it. */
    refOf: (idempotencyKey: string) => byKey.get(idempotencyKey)?.ref ?? null,
    /** The provider changes a refund's status on its side (a closed card). */
    move: (ref: string, status: RefundState['status']) => {
      const state = byRef.get(ref)!;
      byRef.set(ref, { ...state, status, failureMessage: status === 'failed' ? 'The card was closed.' : null });
    },
    /** A refund made in the provider's dashboard. */
    madeThere: (paymentRef: string, amount: string, currency = 'EUR'): string => {
      count += 1;
      const state: RefundState = { ok: true, ref: `re_dash_${String(count)}`, paymentRef, status: 'succeeded', amount, currency, failureMessage: null };
      byRef.set(state.ref, state);
      return state.ref;
    },
  };
}

describe.each(LEGS)('refunds — %s', (dialect, available) => {
  let h: InvoicingHarness;
  let w: Awaited<ReturnType<typeof writerFor>>;
  let sources: PayableSources;
  let deps: RefundDeps;
  let fake: ReturnType<typeof fakeProvider>;
  let invoicesId: string;
  let depositsId: string;
  let paymentsId: string;
  let shapeInvoicesId: string;
  let topUpsId: string;
  let client: Record<string, unknown>;
  let n = 0;

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, invoicingManifest(tables()));
    await h.meta.db.updateTable('adminium_connections').set({ currency: 'EUR' } as never).where('id', '=', h.connectionId).execute();
    w = await writerFor(h);
    await w.create('settings', { tax_rate: 0 });
    client = await w.create('clients', { email: 'lena@example.com', name: 'Lena Fischer' });
    invoicesId = w.targetOf('invoices').table.id;
    depositsId = w.targetOf('deposits').table.id;
    paymentsId = w.targetOf('payments').table.id;
    shapeInvoicesId = w.targetOf('shape_invoices').table.id;
    topUpsId = w.targetOf('top_ups').table.id;
    // Built on the invoice shape's second version: its document and its payments part.
    for (const [ref, part] of [['shape_invoices', 'document'], ['shape_payments', 'payments']] as const) {
      await h.meta.db.updateTable('adminium_app_tables').set({ builtOn: `invoices/invoice@2#${part}` } as never).where('connectionId', '=', h.connectionId).where('ref', '=', ref).execute();
    }
    const invoiceMapping: PayableMapping = {
      label: 'number',
      amount: { column: 'total', unit: null },
      currency: { column: 'currency' },
      due: { column: 'balance' },
      payments: {
        kind: 'table',
        table: paymentsId,
        link: 'invoice_id',
        amount: 'amount',
        date: 'paid_on',
        method: { column: 'method', values: { card: 'card', '*': 'online' } },
        note: 'method_note',
        voided: 'voided',
        reference: 'payment_ref',
        refunded: 'refunded_amount',
        amountUnit: 'units',
      },
      status: null,
      customerEmail: null,
      customerCountry: null,
      pageFields: ['number'],
    } as PayableMapping;
    await payableProfilesRepo(h.meta).create({ connectionId: h.connectionId, tableName: invoicesId, mapping: invoiceMapping, ownerApp: null, createdBy: null });
    await payableProfilesRepo(h.meta).create({
      connectionId: h.connectionId,
      tableName: depositsId,
      mapping: {
        label: 'label',
        amount: { column: 'amount', unit: null },
        currency: { column: 'currency' },
        due: null,
        payments: { kind: 'kept' },
        status: { column: 'status', paid: 'paid', refunded: 'refunded' },
        customerEmail: null,
        customerCountry: null,
        pageFields: ['label'],
      },
      ownerApp: null,
      createdBy: null,
    });
    await payableProfilesRepo(h.meta).create({
      connectionId: h.connectionId,
      tableName: topUpsId,
      mapping: { label: 'label', amount: { column: 'amount', unit: null }, currency: { column: 'currency' }, due: null, payments: { kind: 'kept' }, status: null, customerEmail: null, customerCountry: null, pageFields: ['label'] },
      ownerApp: null,
      createdBy: null,
    });
    sources = createPayableSources({ meta: h.meta, manager: h.manager });
    fake = fakeProvider();
    deps = { meta: h.meta, sources, providerFor: async () => ({ ok: true, key: PROVIDER, mode: 'live', provider: fake.provider, redirectHosts: [] }) };
  }, 180_000);

  afterAll(async () => {
    if (available) await h.close();
  });

  const key = () => {
    n += 1;
    return `rk-${dialect}-${String(n).padStart(4, '0')}-abcdefgh`;
  };

  /** A payment the provider took (live, unless said otherwise), and the record job wrote down unless `record` is false. */
  async function paid(ref: PayableRef, label: string, amount: string, options: { currency?: string; mode?: 'live' | 'test'; provider?: string; record?: boolean } = {}): Promise<string> {
    const attempts = paymentAttemptsRepo(h.meta);
    const currency = options.currency ?? 'EUR';
    n += 1;
    const attempt = (await attempts.create({ provider: options.provider ?? PROVIDER, mode: options.mode ?? 'live', accountId: 'acct', payable: ref, payableLabel: label, amount, currency, linkId: null, nonce: `nonce-${dialect}-${String(n)}`, createdBy: null }))!;
    await attempts.move(attempt.id, 'open', { providerRef: `cs_${dialect}_${String(n)}` });
    await attempts.move(attempt.id, 'succeeded', { takenAmount: amount, takenCurrency: currency, paymentRef: `pi_${dialect}_${String(n)}`, paidWith: { method: 'card', label: 'Visa ••4242', delayed: false } });
    if (options.record !== false) expect(await recordAttempt({ meta: h.meta, sources }, attempt.id)).toMatchObject({ state: 'recorded' });
    return attempt.id;
  }

  /** The write path, failing the next `times` writes as a database away would. */
  function failingWrites(times: { left: number }): RecordWriteService {
    const real = createWriteService(writeStores(h.meta));
    return new Proxy(real, {
      get(target, property, receiver) {
        if (property !== 'update') return Reflect.get(target, property, receiver) as unknown;
        return async (input: Parameters<RecordWriteService['update']>[0]) => {
          if (times.left > 0) {
            times.left -= 1;
            throw new Error('The database is away.');
          }
          return target.update(input);
        };
      },
    });
  }

  /** The refund job's handler, as the queue would run it. */
  function refundJob(jobDeps: RefundDeps): (payload: Record<string, unknown>) => Promise<unknown> {
    let handler: ((payload: never, ctx: never) => Promise<unknown>) | null = null;
    registerPaymentsRefundHandler({ registerJobHandler: (_kind: string, _schema: unknown, fn: typeof handler) => (handler = fn) } as unknown as JobRegistry, jobDeps);
    return (payload) => handler!(payload as never, { attempt: 1 } as never);
  }

  const invoiceRef = (invoice: Record<string, unknown>): PayableRef => ({ kind: 'profile', connectionId: h.connectionId, tableName: invoicesId, rowKey: String(invoice['id']) });

  async function sentInvoice(amount: string): Promise<Record<string, unknown>> {
    const invoice = await w.create('invoices', { client_id: client['id'] });
    await w.create('invoice_lines', { invoice_id: invoice['id'], qty: 1, rate: amount });
    await w.update('invoices', invoice['id'], { status: 'sent' });
    return invoice;
  }

  const refundedOnRow = async (attemptId: string) => String((await h.rows(`select refunded_amount from ${h.real('payments')} where payment_ref = '${attemptId}'`))[0]!['refunded_amount']);

  it.runIf(available)('refunds part, then the rest, writes what stands refunded into the record’s payments, and refuses past what was taken', async () => {
    const invoice = await sentInvoice('120.00');
    const ref: PayableRef = { kind: 'profile', connectionId: h.connectionId, tableName: invoicesId, rowKey: String(invoice['id']) };
    const attemptId = await paid(ref, String(invoice['number'] ?? 'INV'), '120.00');

    const first = await requestRefund(deps, { attemptId, amount: '40.00', reason: 'requested_by_customer', note: null, key: key(), requestedBy: null });
    expect(first).toMatchObject({ ok: true, fresh: true, refund: { state: 'succeeded', amount: '40.00', source: 'staff' } });
    expect(Number(await refundedOnRow(attemptId))).toBe(40);
    expect(refundableOf((await paymentAttemptsRepo(h.meta).byId(attemptId))!)).toBe('80.00');

    const tooMuch = await requestRefund(deps, { attemptId, amount: '80.01', reason: 'other', note: null, key: key(), requestedBy: null });
    expect(tooMuch).toMatchObject({ ok: false, refusal: { code: 'MORE_THAN_REFUNDABLE' } });

    const rest = await requestRefund(deps, { attemptId, amount: '80', reason: 'other', note: 'rest', key: key(), requestedBy: null });
    expect(rest).toMatchObject({ ok: true, refund: { state: 'succeeded', amount: '80.00' } });
    expect(Number(await refundedOnRow(attemptId))).toBe(120);
    expect(refundRefusalOf((await paymentAttemptsRepo(h.meta).byId(attemptId))!)).toMatchObject({ code: 'FULLY_REFUNDED' });

    // The first refund fails afterwards (a closed card): taken back out, and its amount may be refunded again.
    const firstRefund = (first as { refund: { providerRefundId: string | null; id: string } }).refund;
    fake.move(firstRefund.providerRefundId!, 'failed');
    expect(await settleRefund(deps, firstRefund.id)).toMatchObject({ state: 'failed', failureMessage: 'The card was closed.' });
    expect(Number(await refundedOnRow(attemptId))).toBe(80);
    expect(refundableOf((await paymentAttemptsRepo(h.meta).byId(attemptId))!)).toBe('40.00');
    expect((await refundsRepo(h.meta).byId(firstRefund.id))?.undoneAt).not.toBeNull();
  });

  it.runIf(available)('keeps one refund per confirmation key, and refuses the key for another amount', async () => {
    const invoice = await sentInvoice('50.00');
    const attemptId = await paid({ kind: 'profile', connectionId: h.connectionId, tableName: invoicesId, rowKey: String(invoice['id']) }, 'INV', '50.00');
    const once = key();
    const calls = fake.calls();
    const a = await requestRefund(deps, { attemptId, amount: '10.00', reason: 'duplicate', note: null, key: once, requestedBy: null });
    const b = await requestRefund(deps, { attemptId, amount: '10.00', reason: 'duplicate', note: null, key: once, requestedBy: null });
    expect(a).toMatchObject({ ok: true, fresh: true });
    expect(b).toMatchObject({ ok: true, fresh: false });
    expect((b as { refund: { id: string } }).refund.id).toBe((a as { refund: { id: string } }).refund.id);
    expect(fake.calls()).toBe(calls + 1);
    expect(await requestRefund(deps, { attemptId, amount: '12.00', reason: 'duplicate', note: null, key: once, requestedBy: null })).toMatchObject({ ok: false, refusal: { code: 'KEY_REUSED' } });
  });

  it.runIf(available)('never promises back more than was taken when two refunds ask at once', async () => {
    const invoice = await sentInvoice('30.00');
    const attemptId = await paid({ kind: 'profile', connectionId: h.connectionId, tableName: invoicesId, rowKey: String(invoice['id']) }, 'INV', '30.00');
    const [a, b] = await Promise.all([
      requestRefund(deps, { attemptId, amount: '30.00', reason: 'other', note: null, key: key(), requestedBy: null }),
      requestRefund(deps, { attemptId, amount: '30.00', reason: 'other', note: null, key: key(), requestedBy: null }),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(sumOk([a, b])).toBe(1);
    expect((await refundsRepo(h.meta).forAttempt(attemptId)).filter((row) => row.state === 'succeeded')).toHaveLength(1);
  });

  it.runIf(available)('reopens a payment kept by Adminium, and sets the record’s “refunded” status only when refunded in full', async () => {
    const deposit = await w.create('deposits', { label: 'DEP-1', amount: '25.00', currency: 'EUR' });
    const ref: PayableRef = { kind: 'profile', connectionId: h.connectionId, tableName: depositsId, rowKey: String(deposit['id']) };
    const attemptId = await paid(ref, 'DEP-1', '25.00');
    expect((await resolvePayable(sources, ref))?.due).toBe('0.00');
    await requestRefund(deps, { attemptId, amount: '5.00', reason: 'other', note: null, key: key(), requestedBy: null });
    expect((await resolvePayable(sources, ref))?.due).toBe('5.00');
    const statusOf = async () => (await h.rows(`select status from ${h.real('deposits')} where id = ${String(deposit['id'])}`))[0]!['status'];
    expect(await statusOf()).toBe('paid');
    await requestRefund(deps, { attemptId, amount: '20.00', reason: 'other', note: null, key: key(), requestedBy: null });
    expect((await resolvePayable(sources, ref))?.due).toBe('25.00');
    expect(await statusOf()).toBe('refunded');
    const kept = await keptPaymentsRepo(h.meta).byAttempt(attemptId);
    expect(kept?.refundedAmount).toBe('25.00');
  });

  it.runIf(available)('records a refund made in the provider’s dashboard as made there, once, and the record follows', async () => {
    const invoice = await sentInvoice('60.00');
    const attemptId = await paid({ kind: 'profile', connectionId: h.connectionId, tableName: invoicesId, rowKey: String(invoice['id']) }, 'INV', '60.00');
    const attempt = (await paymentAttemptsRepo(h.meta).byId(attemptId))!;
    const ref = fake.madeThere(attempt.paymentRef!, '20.00');
    const made = await refundEvent(deps, { provider: PROVIDER, mode: 'live', refundRef: ref });
    expect(made).toMatchObject({ source: 'provider', state: 'succeeded', amount: '20.00' });
    // The webhook's retry and the sweep find the same refund.
    const again = await refundEvent(deps, { provider: PROVIDER, mode: 'live', refundRef: ref });
    expect(again?.id).toBe(made?.id);
    expect((await refundsRepo(h.meta).forAttempt(attemptId)).filter((row) => row.source === 'provider')).toHaveLength(1);
    expect(Number(await refundedOnRow(attemptId))).toBe(20);
    expect(refundableOf((await paymentAttemptsRepo(h.meta).byId(attemptId))!)).toBe('40.00');
  });

  it.runIf(available)('refuses a refund while the payment is disputed, and again once the dispute closes it may be', async () => {
    const invoice = await sentInvoice('15.00');
    const attemptId = await paid({ kind: 'profile', connectionId: h.connectionId, tableName: invoicesId, rowKey: String(invoice['id']) }, 'INV', '15.00');
    await disputeEvent(deps, (await paymentAttemptsRepo(h.meta).byId(attemptId))!, { type: 'charge.dispute.created', occurredAt: Date.now() });
    const disputed = (await paymentAttemptsRepo(h.meta).byId(attemptId))!;
    expect(disputed.dispute).toMatchObject({ state: 'open' });
    expect(await requestRefund(deps, { attemptId, amount: '5.00', reason: 'other', note: null, key: key(), requestedBy: null })).toMatchObject({ ok: false, refusal: { code: 'DISPUTED', message: 'This payment is disputed. Answer it in fake first.' } });
    await disputeEvent(deps, disputed, { type: 'charge.dispute.closed', occurredAt: Date.now() });
    expect((await paymentAttemptsRepo(h.meta).byId(attemptId))!.dispute).toMatchObject({ state: 'closed' });
    expect(refundRefusalOf((await paymentAttemptsRepo(h.meta).byId(attemptId))!)).toBeNull();
  });

  it.runIf(available)('says the provider’s refusal in its words and gives back what the refund held', async () => {
    const invoice = await sentInvoice('10.00');
    const attemptId = await paid({ kind: 'profile', connectionId: h.connectionId, tableName: invoicesId, rowKey: String(invoice['id']) }, 'INV', '10.00');
    fake.refuseWith('The time to refund this payment has passed.');
    try {
      const refused = await requestRefund(deps, { attemptId, amount: '10.00', reason: 'other', note: null, key: key(), requestedBy: null });
      expect(refused).toMatchObject({ ok: true, refund: { state: 'failed', failureMessage: 'The time to refund this payment has passed.' } });
      expect(refundableOf((await paymentAttemptsRepo(h.meta).byId(attemptId))!)).toBe('10.00');
      expect(await followRecord(deps, attemptId)).toBe('written');
      expect(Number(await refundedOnRow(attemptId))).toBe(0);
    } finally {
      fake.refuseWith(null);
    }
  });

  it.runIf(available)('keeps a refund the provider made when writing it to the record fails, and writes it once the database is back', async () => {
    const invoice = await sentInvoice('90.00');
    const attemptId = await paid(invoiceRef(invoice), 'INV', '90.00');
    const times = { left: 1 };
    const queued: Record<string, unknown>[] = [];
    const away: RefundDeps = { ...deps, writes: failingWrites(times), enqueue: async (job) => void queued.push(job.payload) };
    const asked = await requestRefund(away, { attemptId, amount: '30.00', reason: 'other', note: null, key: key(), requestedBy: null });
    // The provider refunded: the answer says so, never an error.
    expect(asked).toMatchObject({ ok: true, fresh: true, refund: { state: 'succeeded' } });
    const refundId = (asked as { refund: { id: string } }).refund.id;
    expect(await refundsRepo(h.meta).byId(refundId)).toMatchObject({ problemCode: 'NOT_WRITTEN', appliedAt: null });
    expect(Number(await refundedOnRow(attemptId))).toBe(0);
    expect(queued).toEqual([{ refundId }]);
    // The sweep finds it too.
    const swept: Record<string, unknown>[] = [];
    await pickUpRefunds({ meta: h.meta, enqueue: async (job) => void swept.push(job.payload) });
    expect(swept).toContainEqual({ refundId });
    // The job tries again: still away, it throws (and is tried again); back, it lands and the flag clears.
    times.left = 1;
    await expect(refundJob(away)({ refundId })).rejects.toThrow('The database is away.');
    await refundJob(away)({ refundId });
    expect(Number(await refundedOnRow(attemptId))).toBe(30);
    expect(await refundsRepo(h.meta).byId(refundId)).toMatchObject({ problemCode: null });
    expect((await refundsRepo(h.meta).byId(refundId))?.appliedAt).not.toBeNull();
    expect(await refundsRepo(h.meta).unfollowed()).not.toContainEqual(expect.objectContaining({ id: refundId }));
  });

  it.runIf(available)('takes the provider’s event for a refund whose answer was lost as that refund, never a second one', async () => {
    const invoice = await sentInvoice('80.00');
    const attemptId = await paid(invoiceRef(invoice), 'INV', '80.00');
    const lostKey = key();
    fake.loseNext();
    const asked = await requestRefund(deps, { attemptId, amount: '25', reason: 'other', note: null, key: lostKey, requestedBy: null });
    expect(asked).toMatchObject({ ok: true, refund: { state: 'requested', providerRefundId: null } });
    const staffId = (asked as { refund: { id: string } }).refund.id;
    const made = await refundEvent(deps, { provider: PROVIDER, mode: 'live', refundRef: fake.refOf(lostKey)! });
    expect(made).toMatchObject({ id: staffId, source: 'staff', state: 'succeeded', providerRefundId: fake.refOf(lostKey) });
    // Asked again with the same key: the same refund, nothing new.
    expect(await settleRefund(deps, staffId)).toMatchObject({ id: staffId, state: 'succeeded' });
    expect(await refundsRepo(h.meta).forAttempt(attemptId)).toHaveLength(1);
    expect(Number(await refundedOnRow(attemptId))).toBe(25);
    expect(refundableOf((await paymentAttemptsRepo(h.meta).byId(attemptId))!)).toBe('55.00');
  });

  it.runIf(available)('counts a refund once when two rows came to hold it: the twin is closed as the same refund', async () => {
    const invoice = await sentInvoice('70.00');
    const attemptId = await paid(invoiceRef(invoice), 'INV', '70.00');
    const attempts = paymentAttemptsRepo(h.meta);
    const lostKey = key();
    fake.loseNext();
    const asked = await requestRefund(deps, { attemptId, amount: '10.00', reason: 'other', note: null, key: lostKey, requestedBy: null });
    const twinId = (asked as { refund: { id: string } }).refund.id;
    // A row recorded as made at the provider already holds the same refund (as before the event knew the lost one).
    const attempt = (await attempts.byId(attemptId))!;
    const holder = await refundsRepo(h.meta).create({ attemptId, paymentId: null, provider: PROVIDER, mode: 'live', paymentRef: attempt.paymentRef!, amount: '10.00', currency: 'EUR', reason: 'other', note: null, idempotencyKey: `provider:${dialect}:${lostKey}`, providerRefundId: fake.refOf(lostKey), source: 'provider', requestedBy: null, state: 'succeeded' });
    expect(await attempts.commitRefund(attemptId, attempt.refundCommitted, '20.00', Date.now(), true)).toBe(true);
    await followRecord(deps, attemptId);
    const settled = await settleRefund(deps, twinId);
    expect(settled?.id).toBe(holder.refund.id);
    expect(await refundsRepo(h.meta).byId(twinId)).toMatchObject({ state: 'cancelled', failureMessage: 'The same refund as one already recorded: counted once.' });
    expect(Number(await refundedOnRow(attemptId))).toBe(10);
    expect(refundableOf((await attempts.byId(attemptId))!)).toBe('60.00');
  });

  it.runIf(available)('keeps a test or demo refund in Adminium: the shop’s status never moves', async () => {
    const statusOf = async (id: unknown) => (await h.rows(`select status from ${h.real('deposits')} where id = ${String(id)}`))[0]!['status'];
    for (const options of [{ mode: 'test' as const }, { provider: 'demo' }]) {
      const deposit = await w.create('deposits', { label: 'DEP-T', amount: '25.00', currency: 'EUR' });
      const ref: PayableRef = { kind: 'profile', connectionId: h.connectionId, tableName: depositsId, rowKey: String(deposit['id']) };
      const attemptId = await paid(ref, 'DEP-T', '25.00', options);
      expect(await requestRefund(deps, { attemptId, amount: '25.00', reason: 'other', note: null, key: key(), requestedBy: null })).toMatchObject({ ok: true, refund: { state: 'succeeded' } });
      expect((await keptPaymentsRepo(h.meta).byAttempt(attemptId))?.refundedAmount).toBe('25.00');
      expect(await statusOf(deposit['id'])).toBe('open');
    }
  });

  it.runIf(available)('writes a refund made before its payment was written down once the payment is', async () => {
    const invoice = await sentInvoice('40.00');
    const attemptId = await paid(invoiceRef(invoice), 'INV', '40.00', { record: false });
    const attempt = (await paymentAttemptsRepo(h.meta).byId(attemptId))!;
    const made = await refundEvent(deps, { provider: PROVIDER, mode: 'live', refundRef: fake.madeThere(attempt.paymentRef!, '15.00') });
    expect(made).toMatchObject({ state: 'succeeded', appliedAt: null });
    expect(await recordAttempt({ meta: h.meta, sources }, attemptId)).toMatchObject({ state: 'recorded' });
    expect(Number(await refundedOnRow(attemptId))).toBe(15);
    expect((await refundsRepo(h.meta).byId(made!.id))?.appliedAt).not.toBeNull();
  });

  it.runIf(available)('fails a refund only on a refusal: anything else leaves it asked, and asks again with the same key, once at a time', async () => {
    const invoice = await sentInvoice('35.00');
    const attemptId = await paid(invoiceRef(invoice), 'INV', '35.00');
    for (const code of ['CREDENTIALS_REFUSED', 'UNAVAILABLE', 'NOT_FOUND'] as const) {
      fake.answerNextWith(code, false);
      const once = key();
      const asked = await requestRefund(deps, { attemptId, amount: '5.00', reason: 'other', note: null, key: once, requestedBy: null });
      expect(asked).toMatchObject({ ok: true, refund: { state: 'requested', failureMessage: null } });
      const refundId = (asked as { refund: { id: string } }).refund.id;
      // Two asks at once of the same refund are one ask.
      const before = fake.asks();
      const [a, b] = await Promise.all([settleRefund(deps, refundId), requestRefund(deps, { attemptId, amount: '5.00', reason: 'other', note: null, key: once, requestedBy: null })]);
      expect(fake.asks()).toBe(before + 1);
      expect(a).toMatchObject({ id: refundId, state: 'succeeded' });
      expect(b).toMatchObject({ ok: true, fresh: false, refund: { id: refundId } });
    }
    expect(Number(await refundedOnRow(attemptId))).toBe(15);
    fake.answerNextWith('INVALID_REQUEST', false);
    expect(await requestRefund(deps, { attemptId, amount: '5.00', reason: 'other', note: null, key: key(), requestedBy: null })).toMatchObject({ ok: true, refund: { state: 'failed' } });
    expect(refundableOf((await paymentAttemptsRepo(h.meta).byId(attemptId))!)).toBe('20.00');
  });

  it.runIf(available)('takes dispute events in any order, and an update after the close reopens nothing', async () => {
    const invoice = await sentInvoice('15.00');
    const attemptId = await paid(invoiceRef(invoice), 'INV', '15.00');
    const now = Date.now();
    const read = async () => (await paymentAttemptsRepo(h.meta).byId(attemptId))!;
    // The close arrives first; the open (older) that follows changes nothing.
    await disputeEvent(deps, await read(), { type: 'charge.dispute.closed', occurredAt: now });
    await disputeEvent(deps, await read(), { type: 'charge.dispute.created', occurredAt: now - 60_000 });
    expect((await read()).dispute).toMatchObject({ state: 'closed' });
    await disputeEvent(deps, await read(), { type: 'charge.dispute.updated', occurredAt: now + 1_000 });
    await disputeEvent(deps, await read(), { type: 'charge.dispute.funds_withdrawn', occurredAt: now + 2_000 });
    expect((await read()).dispute).toMatchObject({ state: 'closed' });
    expect(refundRefusalOf(await read())).toBeNull();
    // A second dispute after it opens again.
    await disputeEvent(deps, await read(), { type: 'charge.dispute.created', occurredAt: now + 60_000 });
    expect((await read()).dispute).toMatchObject({ state: 'open', at: now + 60_000 });
  });

  it.runIf(available)('reads a refund made at the provider in the currency’s decimals, and flags one in another currency or past what was paid', async () => {
    const invoice = await sentInvoice('50.00');
    const attemptId = await paid(invoiceRef(invoice), 'INV', '50.00');
    const paymentRef = (await paymentAttemptsRepo(h.meta).byId(attemptId))!.paymentRef!;
    const plain = await refundEvent(deps, { provider: PROVIDER, mode: 'live', refundRef: fake.madeThere(paymentRef, '20') });
    expect(plain).toMatchObject({ amount: '20.00', problemCode: null });
    const other = await refundEvent(deps, { provider: PROVIDER, mode: 'live', refundRef: fake.madeThere(paymentRef, '5.00', 'USD') });
    expect(await refundsRepo(h.meta).byId(other!.id)).toMatchObject({ problemCode: 'CURRENCY_DIFFERS' });
    expect(Number(await refundedOnRow(attemptId))).toBe(20);
    expect(refundableOf((await paymentAttemptsRepo(h.meta).byId(attemptId))!)).toBe('30.00');
    const past = await refundEvent(deps, { provider: PROVIDER, mode: 'live', refundRef: fake.madeThere(paymentRef, '40.00') });
    expect(await refundsRepo(h.meta).byId(past!.id)).toMatchObject({ problemCode: 'MORE_THAN_PAID' });
    expect(Number(await refundedOnRow(attemptId))).toBe(50);
    expect(await refundsRepo(h.meta).countNeedingLook()).toBeGreaterThanOrEqual(2);
  });

  it.runIf(available)('flags a refund whose payment row was deleted, and tries it no more', async () => {
    const invoice = await sentInvoice('20.00');
    const attemptId = await paid(invoiceRef(invoice), 'INV', '20.00');
    await h.rows(`delete from ${h.real('payments')} where payment_ref = '${attemptId}'`);
    const asked = await requestRefund(deps, { attemptId, amount: '20.00', reason: 'other', note: null, key: key(), requestedBy: null });
    expect(asked).toMatchObject({ ok: true, refund: { state: 'succeeded' } });
    const refundId = (asked as { refund: { id: string } }).refund.id;
    expect(await refundsRepo(h.meta).byId(refundId)).toMatchObject({ problemCode: 'RECORD_GONE', appliedAt: null });
    expect(await refundsRepo(h.meta).unfollowed()).not.toContainEqual(expect.objectContaining({ id: refundId }));
  });

  it.runIf(available)('sets the record back to paid when a refund in full fails afterwards', async () => {
    const deposit = await w.create('deposits', { label: 'DEP-F', amount: '30.00', currency: 'EUR' });
    const ref: PayableRef = { kind: 'profile', connectionId: h.connectionId, tableName: depositsId, rowKey: String(deposit['id']) };
    const attemptId = await paid(ref, 'DEP-F', '30.00');
    const statusOf = async () => (await h.rows(`select status from ${h.real('deposits')} where id = ${String(deposit['id'])}`))[0]!['status'];
    const asked = await requestRefund(deps, { attemptId, amount: '30.00', reason: 'other', note: null, key: key(), requestedBy: null });
    expect(await statusOf()).toBe('refunded');
    const refund = (asked as { refund: { id: string; providerRefundId: string } }).refund;
    fake.move(refund.providerRefundId, 'failed');
    expect(await settleRefund(deps, refund.id)).toMatchObject({ state: 'failed' });
    expect(await statusOf()).toBe('paid');
    expect((await keptPaymentsRepo(h.meta).byAttempt(attemptId))?.refundedAmount).toBe('0.00');
  });

  it.runIf(available)('sends a refund event that names no refund to the settle job', async () => {
    const invoice = await sentInvoice('12.00');
    const attemptId = await paid(invoiceRef(invoice), 'INV', '12.00');
    const queued: { kind: string; payload: Record<string, unknown> }[] = [];
    const attempt = (await paymentAttemptsRepo(h.meta).byId(attemptId))!;
    await followEvent({ meta: h.meta, enqueue: async (job) => void queued.push(job) }, { id: 'pev_none', provider: PROVIDER, mode: 'live', kind: 'refund', type: 'charge.refunded', refundRef: null }, attempt, Date.now());
    expect(queued).toEqual([expect.objectContaining({ kind: 'payments.settle', payload: expect.objectContaining({ attemptId }) })]);
  });

  it.runIf(available)('refunds currencies without decimals and with three, in their own decimals', async () => {
    const cases = [
      { currency: 'JPY', taken: '1500', tooFine: '500.5', part: '500', left: '1000', there: '200.0', thereRead: '200', refunded: '700' },
      { currency: 'KWD', taken: '12.345', tooFine: '2.3456', part: '2.345', left: '10.000', there: '1.5', thereRead: '1.500', refunded: '3.845' },
    ];
    for (const one of cases) {
      const topUp = await w.create('top_ups', { label: `TOP-${one.currency}`, amount: one.taken, currency: one.currency });
      const ref: PayableRef = { kind: 'profile', connectionId: h.connectionId, tableName: topUpsId, rowKey: String(topUp['id']) };
      const attemptId = await paid(ref, `TOP-${one.currency}`, one.taken, { currency: one.currency });
      expect(await requestRefund(deps, { attemptId, amount: one.tooFine, reason: 'other', note: null, key: key(), requestedBy: null })).toMatchObject({ ok: false, refusal: { code: 'AMOUNT' } });
      expect(await requestRefund(deps, { attemptId, amount: one.part, reason: 'other', note: null, key: key(), requestedBy: null })).toMatchObject({ ok: true, refund: { state: 'succeeded', amount: one.part, currency: one.currency } });
      expect(refundableOf((await paymentAttemptsRepo(h.meta).byId(attemptId))!)).toBe(one.left);
      const paymentRef = (await paymentAttemptsRepo(h.meta).byId(attemptId))!.paymentRef!;
      expect(await refundEvent(deps, { provider: PROVIDER, mode: 'live', refundRef: fake.madeThere(paymentRef, one.there, one.currency) })).toMatchObject({ amount: one.thereRead, problemCode: null });
      expect((await keptPaymentsRepo(h.meta).byAttempt(attemptId))?.refundedAmount).toBe(one.refunded);
    }
  });

  it.runIf(available)('follows an invoice built on the invoice shape: what is left of the payment counts, and the balance reopens', async () => {
    const invoice = await w.create('shape_invoices', { number: 'SINV-1', currency: 'EUR', total: '100.00' });
    await w.update('shape_invoices', invoice['id'], { status: 'sent' });
    const ref: PayableRef = { kind: 'shape', connectionId: h.connectionId, tableName: shapeInvoicesId, rowKey: String(invoice['id']) };
    expect(await resolvePayable(sources, ref)).toMatchObject({ due: '100.00', refusal: null, recordInto: { kind: 'table', refunded: 'refunded_amount' } });
    const attemptId = await paid(ref, 'SINV-1', '100.00');
    expect((await resolvePayable(sources, ref))?.due).toBe('0.00');
    expect(await requestRefund(deps, { attemptId, amount: '35.00', reason: 'other', note: null, key: key(), requestedBy: null })).toMatchObject({ ok: true, refund: { state: 'succeeded' } });
    const row = (await h.rows(`select refunded_amount, net_amount from ${h.real('shape_payments')} where payment_ref = '${attemptId}'`))[0]!;
    expect([Number(row['refunded_amount']), Number(row['net_amount'])]).toEqual([35, 65]);
    expect((await resolvePayable(sources, ref))?.due).toBe('35.00');
  });

  it.runIf(available)('lets only a signed-in person who may refund see the preview and refund, never one who only manages payments', async () => {
    const users = usersRepo(h.meta);
    const roles = rolesRepo(h.meta);
    const roleWith = async (slug: string, actions: string[]): Promise<User> => {
      const role = await roles.create({ slug: `${slug}-${dialect}`, name: slug });
      for (const action of actions) await permissionsRepo(h.meta).grant(role.id, 'system', action, { allowed: true });
      for (const id of [invoicesId, paymentsId]) {
        await permissionsRepo(h.meta).grant(role.id, 'table', `${h.connectionId}/${id}`, { read: true, create: false, update: false, delete: false, export: false, import: false } as never);
      }
      const user = await users.create({ email: `${slug}-${dialect}@adminium.test`, name: slug, status: 'active' });
      await roles.assignToUser(user.id, role.id);
      return user;
    };
    const refunder = await roleWith('refunder', ['payments.view', 'payments.refund']);
    const manager = await roleWith('manager', ['payments.view', 'payments.manage']);
    // May refund, but reads only their own invoices: an invoice of nobody's is hidden from them.
    const limitedRole = await roles.create({ slug: `own-refunder-${dialect}`, name: 'own-refunder' });
    for (const action of ['payments.view', 'payments.refund']) await permissionsRepo(h.meta).grant(limitedRole.id, 'system', action, { allowed: true });
    await permissionsRepo(h.meta).grant(limitedRole.id, 'table', `${h.connectionId}/${invoicesId}`, { read: true, create: false, update: false, delete: false, export: false, import: false, rowLimit: { read: { reach: 'own' } } } as never);
    const limited = await users.create({ email: `own-refunder-${dialect}@adminium.test`, name: 'own-refunder', status: 'active' });
    await roles.assignToUser(limited.id, limitedRole.id);
    const app: FastifyInstance = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.setErrorHandler((error: { statusCode?: number; code?: string; message: string; details?: unknown }, request, reply) => {
      void reply.status(error.statusCode ?? 500).send(errorEnvelope(error.code ?? 'INTERNAL', error.message, request.id, error.details));
    });
    app.addHook('onRequest', async (request) => {
      const id = request.headers['x-test-user-id'];
      if (typeof id !== 'string') return;
      const user = await users.findById(id);
      if (user !== null) (request as unknown as { user: object }).user = { id: user.id, name: user.name, email: user.email };
    });
    await app.register(rbacPlugin, { meta: h.meta });
    await app.register(
      async (api) => {
        await api.register(paymentRefundRoutes(deps));
        await api.register(paymentPanelRoutes({ meta: h.meta, manager: h.manager, sources, networkFeatures: true, desktop: false, trustProxy: false }));
      },
      { prefix: '/api/v1' },
    );
    await app.ready();
    try {
      const invoice = await sentInvoice('42.00');
      const attemptId = await paid({ kind: 'profile', connectionId: h.connectionId, tableName: invoicesId, rowKey: String(invoice['id']) }, 'INV-R', '42.00');
      const as = (user: User) => ({ 'x-test-user-id': user.id });
      const preview = (user: User) => app.inject({ method: 'GET', url: `/api/v1/payments/attempts/${attemptId}/refund`, headers: as(user) });
      const refund = (user: User, over: Record<string, unknown> = {}) =>
        app.inject({ method: 'POST', url: '/api/v1/payments/refunds', headers: as(user), payload: { attemptId, amount: '12.00', reason: 'requested_by_customer', note: null, key: key(), ...over } });

      expect((await preview(manager)).statusCode).toBe(403);
      expect((await refund(manager)).statusCode).toBe(403);
      // A record their row limits hide: no such payment, and nothing refunded.
      expect((await preview(limited)).statusCode).toBe(404);
      expect((await refund(limited)).statusCode).toBe(404);
      expect(await refundsRepo(h.meta).forAttempt(attemptId)).toEqual([]);
      const seen = await preview(refunder);
      expect(seen.statusCode).toBe(200);
      expect(seen.json().data).toEqual({ label: 'INV-R', provider: PROVIDER, test: false, taken: '42.00', currency: 'EUR', refundable: '42.00', paidWith: 'Visa ••4242', refusal: null });

      const once = key();
      const made = await refund(refunder, { key: once });
      expect(made.statusCode).toBe(200);
      expect(made.json().data).toMatchObject({ fresh: true, refund: { amount: '12.00', state: 'succeeded', source: 'staff' } });
      // The same confirmation again is the same refund; for another amount it is refused.
      expect((await refund(refunder, { key: once })).json().data).toMatchObject({ fresh: false, refund: { id: made.json().data.refund.id } });
      const reused = await refund(refunder, { key: once, amount: '13.00' });
      expect(reused.statusCode).toBe(409);
      expect(reused.json().error.details).toMatchObject({ reason: 'KEY_REUSED' });
      const tooMuch = await refund(refunder, { amount: '30.01' });
      expect(tooMuch.statusCode).toBe(422);
      expect(tooMuch.json().error.details).toMatchObject({ reason: 'MORE_THAN_REFUNDABLE', field: 'amount' });
      expect((await preview(refunder)).json().data).toMatchObject({ refundable: '30.00', refusal: null });

      // The record's Payment panel shows the refund on its payment, and the action only to who may refund.
      const panel = (user: User) => app.inject({ method: 'POST', url: '/api/v1/payments/panel', headers: as(user), payload: { connectionId: h.connectionId, table: invoicesId, recordId: String(invoice['id']) } });
      const shown = (await panel(refunder)).json().data;
      expect(shown.mayRefund).toBe(true);
      expect(shown.payments).toHaveLength(1);
      expect(shown.payments[0]).toMatchObject({ attemptId, amount: '42.00', refunded: '12.00', refundable: '30.00', refundRefusal: null, dispute: null, refunds: [{ amount: '12.00', state: 'succeeded', source: 'staff' }] });
      expect((await panel(manager)).json().data).toMatchObject({ mayRefund: false, payments: [{ attemptId, refundable: '30.00' }] });
      // Nobody signed in: refused before anything is read.
      expect((await app.inject({ method: 'GET', url: `/api/v1/payments/attempts/${attemptId}/refund` })).statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});

function sumOk(answers: { ok: boolean }[]): number {
  return answers.filter((answer) => answer.ok).length;
}
