// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Recording a payment, exactly once across two databases, on every engine:
 * an invoicing app installed for real, its invoices marked payable into their
 * own payments table (a unique `payment_ref`, the shape `invoice@2` will
 * carry), and a deposits table whose payments Adminium keeps. A crash between
 * each pair of steps never records twice and never loses the payment; a
 * changed invoice is refused, not overpaid; test mode writes no shop row.
 */
import { keptPaymentsRepo, payableProfilesRepo, paymentAttemptsRepo, type PayableMapping, type PayableRef } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPayableSources, resolvePayable, type PayableSources } from '../src/payments/payables.js';
import { pickUpRecordings, recordAttempt, recordedByOf, type RecordDeps } from '../src/payments/record.js';
import { installInvoicing, invoicingManifest, invoicingTables, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';

type Writer = Awaited<ReturnType<typeof writerFor>>;

/** The studio's tables, its payments carrying a unique reference, and a deposits table of its own. */
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

describe.each(LEGS)('recording a payment — %s', (dialect, available) => {
  let h: InvoicingHarness;
  let w: Writer;
  let sources: PayableSources;
  let deps: RecordDeps;
  let invoicesId: string;
  let depositsId: string;
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
    sources = createPayableSources({ meta: h.meta, manager: h.manager });
    deps = { meta: h.meta, sources };
    const invoiceMapping: PayableMapping = {
      label: 'number',
      amount: { column: 'total', unit: null },
      currency: { column: 'currency' },
      due: { column: 'balance' },
      payments: {
        kind: 'table',
        table: w.targetOf('payments').table.id,
        link: 'invoice_id',
        amount: 'amount',
        date: 'paid_on',
        method: { column: 'method', values: { card: 'card', '*': 'online' } },
        note: 'method_note',
        voided: 'voided',
        reference: 'payment_ref',
      },
      status: null,
      customerEmail: null,
      customerCountry: null,
      pageFields: ['number'],
    };
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
  }, 180_000);
  afterAll(async () => {
    if (available) await h.close();
  });

  /** A sent invoice for `amount`, its due as the server computes it. */
  async function sentInvoice(amount: string): Promise<Record<string, unknown>> {
    const invoice = await w.create('invoices', { client_id: client['id'] });
    await w.create('invoice_lines', { invoice_id: invoice['id'], qty: 1, rate: amount });
    await w.update('invoices', invoice['id'], { status: 'sent' });
    return invoice;
  }

  /** An attempt the provider says succeeded, taking `taken` (default: what was asked). */
  async function paidAttempt(payable: PayableRef, amount: string, over: { taken?: string; mode?: 'test' | 'live' } = {}) {
    n += 1;
    const attempts = paymentAttemptsRepo(h.meta);
    const attempt = await attempts.create({
      provider: 'demo',
      mode: over.mode ?? 'live',
      accountId: 'demo_account',
      payable,
      payableLabel: 'x',
      amount,
      currency: 'EUR',
      linkId: null,
      nonce: `nonce-${dialect}-${n}`,
      createdBy: null,
    });
    if (attempt === null) throw new Error('the payable already has an open attempt');
    await attempts.move(attempt.id, 'open', { providerRef: `cs_${dialect}_${n}` });
    await attempts.move(attempt.id, 'succeeded', {
      takenAmount: over.taken ?? amount,
      takenCurrency: 'EUR',
      paymentRef: `pi_${dialect}_${n}`,
      paidWith: { method: 'card', label: 'Visa ••4242', delayed: false },
      settledAt: Date.UTC(2026, 9, 20, 10, 3),
    });
    return attempt;
  }

  const invoiceRef = (invoice: Record<string, unknown>): PayableRef => ({ kind: 'profile', connectionId: h.connectionId, tableName: invoicesId, rowKey: String(invoice['id']) });
  const paymentsOf = (invoice: Record<string, unknown>) => h.rows(`select * from ${h.real('payments')} where invoice_id = ${String(invoice['id'])}`);
  const balanceOf = async (invoice: Record<string, unknown>) => Number((await h.rows(`select balance from ${h.real('invoices')} where id = ${String(invoice['id'])}`))[0]!['balance']);

  it.runIf(available)('reads the due from the database, not from anyone who asks', async () => {
    const invoice = await sentInvoice('120.00');
    const payable = await resolvePayable(sources, invoiceRef(invoice));
    expect(payable).toMatchObject({ currency: 'EUR', due: '120.00', total: '120.00', refusal: null });
    expect(payable?.label).toMatch(/^INV-/);
  });

  it.runIf(available)('records once, into the invoice\'s payments, as a payment write', async () => {
    const invoice = await sentInvoice('120.00');
    const attempt = await paidAttempt(invoiceRef(invoice), '120.00');
    const first = await recordAttempt(deps, attempt.id);
    expect(first).toMatchObject({ state: 'recorded', already: false });
    const again = await recordAttempt(deps, attempt.id);
    expect(again).toMatchObject({ state: 'recorded', already: true });
    const rows = await paymentsOf(invoice);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ payment_ref: attempt.id, method: 'card', method_note: 'Visa ••4242' });
    expect(await balanceOf(invoice)).toBe(0);
    const read = await paymentAttemptsRepo(h.meta).byId(attempt.id);
    expect(read).toMatchObject({ state: 'recorded', openKey: null });
    expect(read?.recordedKey).toMatch(/^row:/);
    expect(recordedByOf('payments-stripe')).toBe('Online payment (Stripe)');
    expect(recordedByOf('payments-paypal')).toBe('Online payment (PayPal)');
  });

  it.runIf(available)('never records twice and never loses it, whichever step a crash lands between', async () => {
    for (const step of ['afterClaim', 'afterWrite'] as const) {
      const invoice = await sentInvoice('50.00');
      const attempt = await paidAttempt(invoiceRef(invoice), '50.00');
      await expect(recordAttempt({ ...deps, faults: { [step]: () => { throw new Error(`crash ${step}`); } } }, attempt.id)).rejects.toThrow(`crash ${step}`);
      expect((await paymentAttemptsRepo(h.meta).byId(attempt.id))?.state).toBe('recording');
      const resumed = await recordAttempt(deps, attempt.id);
      expect(resumed.state, step).toBe('recorded');
      expect(await paymentsOf(invoice), step).toHaveLength(1);
      expect(await balanceOf(invoice), step).toBe(0);
    }
  });

  it.runIf(available)('records once when two runs race', async () => {
    const invoice = await sentInvoice('30.00');
    const attempt = await paidAttempt(invoiceRef(invoice), '30.00');
    const outcomes = await Promise.all([recordAttempt(deps, attempt.id), recordAttempt(deps, attempt.id)]);
    expect(outcomes.every((outcome) => outcome.state === 'recorded')).toBe(true);
    expect(await paymentsOf(invoice)).toHaveLength(1);
  });

  it.runIf(available)('refuses, writing nothing, when the invoice was paid by hand meanwhile', async () => {
    const invoice = await sentInvoice('80.00');
    const attempt = await paidAttempt(invoiceRef(invoice), '80.00');
    await w.create('payments', { invoice_id: invoice['id'], amount: '80.00' });
    const outcome = await recordAttempt(deps, attempt.id);
    expect(outcome).toMatchObject({ state: 'record_refused', problem: { code: 'ALREADY_PAID' } });
    expect(await paymentsOf(invoice)).toHaveLength(1);
    const read = await paymentAttemptsRepo(h.meta).byId(attempt.id);
    expect(read).toMatchObject({ state: 'record_refused', openKey: null, problem: { code: 'ALREADY_PAID' } });
  });

  it.runIf(available)('refuses a voided invoice, an amount that differs, and a row that is gone', async () => {
    const voided = await sentInvoice('20.00');
    const late = await paidAttempt(invoiceRef(voided), '20.00');
    await w.update('invoices', voided['id'], { status: 'void' });
    // A marked table's own rules decide (payments only while sent): the write is refused, nothing lands.
    expect(await recordAttempt(deps, late.id)).toMatchObject({ state: 'record_refused', problem: { code: 'RECORD_LOCKED' } });
    expect(await paymentsOf(voided)).toHaveLength(0);

    const short = await sentInvoice('120.00');
    const shortAttempt = await paidAttempt(invoiceRef(short), '120.00', { taken: '100.00' });
    expect(await recordAttempt(deps, shortAttempt.id)).toMatchObject({ state: 'record_refused', problem: { code: 'AMOUNT_DIFFERS' } });
    expect(await paymentsOf(short)).toHaveLength(0);

    const gone: PayableRef = { kind: 'profile', connectionId: h.connectionId, tableName: invoicesId, rowKey: '987654' };
    const ghost = await paidAttempt(gone, '10.00');
    expect(await recordAttempt(deps, ghost.id)).toMatchObject({ state: 'record_refused', problem: { code: 'GONE' } });
  });

  it.runIf(available)('keeps a test-mode payment in meta only: no shop row', async () => {
    const invoice = await sentInvoice('15.00');
    const attempt = await paidAttempt(invoiceRef(invoice), '15.00', { mode: 'test' });
    const outcome = await recordAttempt(deps, attempt.id);
    expect(outcome.state).toBe('recorded');
    expect(await paymentsOf(invoice)).toHaveLength(0);
    expect(await balanceOf(invoice)).toBe(15);
    expect(await keptPaymentsRepo(h.meta).byAttempt(attempt.id)).toMatchObject({ mode: 'test', amount: '15.00' });
  });

  it.runIf(available)('keeps a deposit\'s payment itself, and sets the deposit paid when nothing is due', async () => {
    const deposit = await w.create('deposits', { label: 'D-7', amount: '45.50', currency: 'EUR' });
    const ref: PayableRef = { kind: 'profile', connectionId: h.connectionId, tableName: depositsId, rowKey: String(deposit['id']) };
    expect(await resolvePayable(sources, ref)).toMatchObject({ due: '45.50', refusal: null, label: 'D-7' });
    const attempt = await paidAttempt(ref, '45.50');
    expect(await recordAttempt(deps, attempt.id)).toMatchObject({ state: 'recorded' });
    expect(await recordAttempt(deps, attempt.id)).toMatchObject({ state: 'recorded', already: true });
    expect(await keptPaymentsRepo(h.meta).forPayable(ref)).toHaveLength(1);
    expect(await resolvePayable(sources, ref)).toMatchObject({ due: '0.00', refusal: { code: 'NOTHING_DUE' } });
    expect((await h.rows(`select status from ${h.real('deposits')} where id = ${String(deposit['id'])}`))[0]!['status']).toBe('paid');
  });

  it.runIf(available)('picks up an attempt a dead job left behind', async () => {
    const invoice = await sentInvoice('12.00');
    const attempt = await paidAttempt(invoiceRef(invoice), '12.00');
    const queued: unknown[] = [];
    const enqueue = async (input: unknown) => {
      queued.push(input);
    };
    expect(await pickUpRecordings(h.meta, enqueue, Date.now())).toBe(0);
    expect(await pickUpRecordings(h.meta, enqueue, Date.now() + 11 * 60 * 1000)).toBeGreaterThanOrEqual(1);
    expect(queued).toContainEqual({ kind: 'payments.record', payload: { attemptId: attempt.id }, dedupeKey: `payment-record:${attempt.id}`, maxAttempts: 40 });
    await recordAttempt(deps, attempt.id);
  });
});
