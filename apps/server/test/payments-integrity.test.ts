// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The daily integrity check over a table that keeps its own payments, on every
 * engine, through an invoicing app installed for real: a live payment the
 * record job wrote is found by the key it wrote, not by today's set-up.
 *
 * It flags a payment whose row went (a restore to an older point) and one
 * whose amount changed; it leaves one a person voided, one written in the
 * smallest unit where the set-up now says whole units, and one whose table
 * was set up again since; and a table it cannot read now is skipped, never
 * flagged.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { payableProfilesRepo, paymentAttemptsRepo, type PayableMapping } from '@adminium/meta';

import { createPayableSources, type PayableSources } from '../src/payments/payables.js';
import { recordAttempt } from '../src/payments/record.js';
import { runPaymentIntegrity, stillThere } from '../src/payments/watch.js';
import { installInvoicing, invoicingManifest, invoicingTables, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';

const T0 = Date.parse('2026-10-20T10:00:00Z');

function tables(): Record<string, unknown>[] {
  return invoicingTables().map((table) =>
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
}

describe.each(LEGS)('the integrity check over a table\'s own payments — %s', (dialect, available) => {
  let h: InvoicingHarness;
  let w: Awaited<ReturnType<typeof writerFor>>;
  let sources: PayableSources;
  let invoicesId: string;
  let paymentsId: string;
  let client: Record<string, unknown>;
  let mapping: PayableMapping;
  let seq = 0;

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, invoicingManifest(tables()));
    await h.meta.db.updateTable('adminium_connections').set({ currency: 'EUR' } as never).where('id', '=', h.connectionId).execute();
    w = await writerFor(h);
    await w.create('settings', { tax_rate: 0 });
    client = await w.create('clients', { email: 'lena@example.com', name: 'Lena Fischer' });
    invoicesId = w.targetOf('invoices').table.id;
    paymentsId = w.targetOf('payments').table.id;
    mapping = {
      label: 'number',
      amount: { column: 'total', unit: null },
      currency: { column: 'currency' },
      due: { column: 'balance' },
      payments: { kind: 'table', table: paymentsId, link: 'invoice_id', amount: 'amount', date: 'paid_on', method: { column: 'method', values: { card: 'card', '*': 'online' } }, note: 'method_note', voided: 'voided', reference: 'payment_ref' },
      status: null,
      customerEmail: null,
      customerCountry: null,
      pageFields: ['number'],
    };
    await payableProfilesRepo(h.meta).create({ connectionId: h.connectionId, tableName: invoicesId, mapping, ownerApp: null, createdBy: null }, T0 - 86_400_000);
    sources = createPayableSources({ meta: h.meta, manager: h.manager });
  }, 180_000);

  afterAll(async () => {
    if (!available) return;
    await h.close();
  });

  /** A sent invoice of `amount`, paid online in full and recorded by the record job. */
  async function paidInvoice(amount: string): Promise<{ attemptId: string; rowId: unknown }> {
    seq += 1;
    const invoice = await w.create('invoices', { client_id: client['id'] });
    await w.create('invoice_lines', { invoice_id: invoice['id'], qty: 1, rate: amount });
    await w.update('invoices', invoice['id'], { status: 'sent' });
    const attempts = paymentAttemptsRepo(h.meta);
    const made = (await attempts.create(
      { provider: 'payments-stripe', mode: 'live', accountId: 'acct_1', payable: { kind: 'profile', connectionId: h.connectionId, tableName: invoicesId, rowKey: String(invoice['id']) }, payableLabel: `INV-${String(seq)}`, amount, currency: 'EUR', linkId: null, nonce: `i${String(seq)}`.padEnd(22, 'x'), createdBy: null },
      T0,
    ))!;
    await attempts.move(made.id, 'open', { providerRef: `cs_${String(seq)}` }, T0);
    await attempts.move(made.id, 'succeeded', { takenAmount: amount, takenCurrency: 'EUR', paymentRef: `pi_${String(seq)}`, settledAt: T0 }, T0);
    expect(await recordAttempt({ meta: h.meta, sources, now: () => T0 }, made.id)).toMatchObject({ state: 'recorded' });
    const [row] = await h.rows(`SELECT id FROM ${h.real('payments')} WHERE payment_ref = '${made.id}'`);
    return { attemptId: made.id, rowId: row!['id'] };
  }

  const integrity = (at: number) => runPaymentIntegrity({ meta: h.meta, sources, serviceKeys: async () => [], now: () => at });
  const attemptOf = async (id: string) => (await paymentAttemptsRepo(h.meta).byId(id))!;

  it.runIf(available)('finds a written payment by the key it wrote, and flags it once its row is gone or its amount changed', async () => {
    const kept = await paidInvoice('50.00');
    const gone = await paidInvoice('60.00');
    const changed = await paidInvoice('70.00');
    await h.rows(`DELETE FROM ${h.real('payments')} WHERE id = ${String(gone.rowId)}`);
    await h.rows(`UPDATE ${h.real('payments')} SET amount = 7 WHERE id = ${String(changed.rowId)}`);
    const result = await integrity(T0 + 60_000);
    expect(result.missing).toBe(2);
    expect((await attemptOf(kept.attemptId)).problem).toBeNull();
    expect((await attemptOf(gone.attemptId)).problem?.code).toBe('RECORD_MISSING');
    expect((await attemptOf(changed.attemptId)).problem?.code).toBe('RECORD_MISSING');
  });

  it.runIf(available)('leaves a payment a person voided, and one written in the smallest unit, alone', async () => {
    const voided = await paidInvoice('20.00');
    const minor = await paidInvoice('30.00');
    await h.rows(`UPDATE ${h.real('payments')} SET voided = ${dialect === 'postgres' ? 'true' : '1'} WHERE id = ${String(voided.rowId)}`);
    await h.rows(`UPDATE ${h.real('payments')} SET amount = 3000 WHERE id = ${String(minor.rowId)}`);
    expect(await stillThere({ meta: h.meta, sources }, await attemptOf(voided.attemptId))).toBe(true);
    expect(await stillThere({ meta: h.meta, sources }, await attemptOf(minor.attemptId))).toBe(true);
  });

  it.runIf(available)('skips a table it cannot read now, and reads no amount through a set-up changed since the payment', async () => {
    const paid = await paidInvoice('40.00');
    // The table hidden or renamed in the view: nothing to read, nothing flagged.
    const blind: PayableSources = { ...sources, table: async () => null };
    expect(await stillThere({ meta: h.meta, sources: blind }, await attemptOf(paid.attemptId))).toBeNull();
    const before = await runPaymentIntegrity({ meta: h.meta, sources: blind, serviceKeys: async () => [], now: () => T0 + 120_000 });
    expect(before.missing).toBe(0);
    // Set up again after the payment (another amount column named): the row is there, and that is enough.
    await h.rows(`UPDATE ${h.real('payments')} SET amount = 1 WHERE id = ${String(paid.rowId)}`);
    await h.meta.db.updateTable('adminium_payable_profiles').set({ updatedAt: T0 + 1 }).where('tableName', '=', invoicesId).execute();
    expect(await stillThere({ meta: h.meta, sources }, await attemptOf(paid.attemptId))).toBe(true);
    await h.meta.db.updateTable('adminium_payable_profiles').set({ updatedAt: T0 - 86_400_000 }).where('tableName', '=', invoicesId).execute();
  });
});
