// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Refunds, on every engine this run can reach, against a stand-in provider:
 * what may be refunded and why not, one refund per confirmation key, two at
 * once never promising back more than was taken, the record following into
 * its own payments table (or the payment Adminium keeps) and its status rule,
 * a refund done and then failed taken back out, a refund made in the
 * provider's dashboard recorded as made there, and a dispute refusing refunds
 * until it closes.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PaymentProvider, RefundInput, RefundState } from '@adminium/add-on-contracts';
import { keptPaymentsRepo, payableProfilesRepo, paymentAttemptsRepo, permissionsRepo, refundsRepo, rolesRepo, usersRepo, type PayableMapping, type PayableRef, type User } from '@adminium/meta';

import { errorEnvelope } from '../src/errors.js';

import { createPayableSources, resolvePayable, type PayableSources } from '../src/payments/payables.js';
import { recordAttempt } from '../src/payments/record.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { paymentRefundRoutes } from '../src/routes/payments/refunds.js';
import { disputeEvent, followRecord, refundableOf, refundEvent, refundRefusalOf, requestRefund, settleRefund, type RefundDeps } from '../src/payments/refunds.js';
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
  return all;
}

/** A stand-in provider: refunds settle as `next` says, keyed like the real ones. */
function fakeProvider() {
  const byKey = new Map<string, RefundState>();
  const byRef = new Map<string, RefundState>();
  let next: RefundState['status'] = 'succeeded';
  let refused: string | null = null;
  let count = 0;
  const provider = {
    key: PROVIDER,
    mode: 'live',
    async refund(input: RefundInput) {
      if (refused !== null) return { ok: false, code: 'REFUND_REFUSED', providerMessage: refused, retryable: false } as const;
      const known = byKey.get(input.idempotencyKey);
      if (known !== undefined) return known;
      count += 1;
      const state: RefundState = { ok: true, ref: `re_${String(count)}`, paymentRef: input.paymentRef, status: next, amount: input.amount, currency: input.currency, failureMessage: next === 'failed' ? 'The card was closed.' : null };
      byKey.set(input.idempotencyKey, state);
      byRef.set(state.ref, state);
      return state;
    },
    async refundStatus(ref: string) {
      return byRef.get(ref) ?? ({ ok: false, code: 'NOT_FOUND', providerMessage: 'No such refund.', retryable: false } as const);
    },
  } as unknown as PaymentProvider;
  return {
    provider,
    calls: () => count,
    setNext: (status: RefundState['status']) => (next = status),
    refuseWith: (message: string | null) => (refused = message),
    /** The provider changes a refund's status on its side (a closed card). */
    move: (ref: string, status: RefundState['status']) => {
      const state = byRef.get(ref)!;
      byRef.set(ref, { ...state, status, failureMessage: status === 'failed' ? 'The card was closed.' : null });
    },
    /** A refund made in the provider's dashboard. */
    madeThere: (paymentRef: string, amount: string): string => {
      count += 1;
      const state: RefundState = { ok: true, ref: `re_dash_${String(count)}`, paymentRef, status: 'succeeded', amount, currency: 'EUR', failureMessage: null };
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

  /** A live payment the provider took and the record job wrote down. */
  async function paid(ref: PayableRef, label: string, amount: string): Promise<string> {
    const attempts = paymentAttemptsRepo(h.meta);
    n += 1;
    const attempt = (await attempts.create({ provider: PROVIDER, mode: 'live', accountId: 'acct', payable: ref, payableLabel: label, amount, currency: 'EUR', linkId: null, nonce: `nonce-${dialect}-${String(n)}`, createdBy: null }))!;
    await attempts.move(attempt.id, 'open', { providerRef: `cs_${dialect}_${String(n)}` });
    await attempts.move(attempt.id, 'succeeded', { takenAmount: amount, takenCurrency: 'EUR', paymentRef: `pi_${dialect}_${String(n)}`, paidWith: { method: 'card', label: 'Visa ••4242', delayed: false } });
    expect(await recordAttempt({ meta: h.meta, sources }, attempt.id)).toMatchObject({ state: 'recorded' });
    return attempt.id;
  }

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

  it.runIf(available)('lets only a signed-in person who may refund see the preview and refund, never one who only manages payments', async () => {
    const users = usersRepo(h.meta);
    const roles = rolesRepo(h.meta);
    const roleWith = async (slug: string, actions: string[]): Promise<User> => {
      const role = await roles.create({ slug: `${slug}-${dialect}`, name: slug });
      for (const action of actions) await permissionsRepo(h.meta).grant(role.id, 'system', action, { allowed: true });
      const user = await users.create({ email: `${slug}-${dialect}@adminium.test`, name: slug, status: 'active' });
      await roles.assignToUser(user.id, role.id);
      return user;
    };
    const refunder = await roleWith('refunder', ['payments.view', 'payments.refund']);
    const manager = await roleWith('manager', ['payments.view', 'payments.manage']);
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
    await app.register(async (api) => api.register(paymentRefundRoutes(deps)), { prefix: '/api/v1' });
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
