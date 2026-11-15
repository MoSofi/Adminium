// SPDX-License-Identifier: AGPL-3.0-only
/**
 * CHARGES ON A CARD READER (E6), on SQLite, Postgres and MySQL, against the
 * demo reader standing in for a live service: the amount read again from the
 * record, the reader held for one charge, the card tapped with a tip and
 * written into the app's payments table (what was asked beside the tip, the
 * last four and approval code); a lost send sent again with the same key, a
 * card tapped before the cashier's cancel recorded, a reader off the network
 * never given up blind, a decline freeing the reader.
 */
import { createDemoTerminalBackend, providerError, type DemoTerminalBackend } from '@adminium/add-on-contracts';
import { payableProfilesRepo, paymentAttemptsRepo, paymentReadersRepo, type PayableRef, type PaymentReader } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createPayableSources, type PayableSources } from '../src/payments/payables.js';
import { cancelReaderCharge, chargeView, pollReaderCharge, READER_OFFLINE_MS, startReaderCharge, type ReaderChargeDeps } from '../src/payments/reader-charges.js';
import { recordAttempt } from '../src/payments/record.js';
import { refundEvent, requestRefund } from '../src/payments/refunds.js';
import { guardTerminal } from '../src/payments/terminals.js';
import { installInvoicing, invoicingManifest, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.60' }));

type Doc = Record<string, unknown>;
const id = { ref: 'id', type: 'int', role: 'pk' };
const money = (ref: string) => ({ ref, type: 'decimal', scale: 2, default: 0 });

function till(): Doc {
  const m = invoicingManifest([
    { ref: 'tickets', columns: [id, { ref: 'number', type: 'text', maxLength: 40, nullable: true }, money('total'), money('balance')] },
    {
      ref: 'ticket_payments',
      columns: [
        id,
        { ref: 'ticket_id', type: 'fk', references: 'tickets' },
        money('amount'),
        money('tip'),
        { ref: 'method', type: 'enum', enum: ['cash', 'card'], default: 'cash' },
        { ref: 'payment_ref', type: 'text', maxLength: 64, nullable: true, unique: true },
        { ref: 'approval_code', type: 'text', maxLength: 32, nullable: true },
        { ref: 'last4', type: 'text', maxLength: 4, nullable: true },
        { ref: 'paid_at', type: 'timestamptz', nullable: true },
      ],
    },
  ]);
  m['key'] = 'till';
  m['compatibility'] = { minAdminiumVersion: '0.3.60' };
  (m['pages'] as { bindings: Record<string, string> }[])[0]!.bindings = { rows: 'tickets' };
  m['payments'] = {
    payables: [
      {
        table: 'tickets',
        label: 'number',
        amount: { column: 'total' },
        currency: { fixed: 'EUR' },
        due: { column: 'balance' },
        payments: { kind: 'table', table: 'ticket_payments', link: 'ticket_id', amount: 'amount', paidAt: 'paid_at', method: { column: 'method', values: { card: 'card', '*': 'card' } }, reference: 'payment_ref', approvalCode: 'approval_code', last4: 'last4', tip: 'tip' },
      },
    ],
  };
  return m;
}

describe.each(LEGS)('charges on a card reader — %s', (dialect, available) => {
  let h: InvoicingHarness;
  let w: Awaited<ReturnType<typeof writerFor>>;
  let backend: DemoTerminalBackend;
  let sources: PayableSources;
  let deps: ReaderChargeDeps;
  let reader: PaymentReader;
  let readerRef: string;
  let at = Date.UTC(2026, 10, 15, 12);
  let n = 0;
  /** A service that loses the next send's answer (the reader still got it). */
  let loseNextAnswer = false;

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, till());
    w = await writerFor(h);
    // Someone who manages payments switched the till on (its payables arrive off).
    for (const profile of await payableProfilesRepo(h.meta).list(h.connectionId)) await payableProfilesRepo(h.meta).update(profile.id, { enabled: true });
    sources = createPayableSources({ meta: h.meta, manager: h.manager });
    backend = createDemoTerminalBackend();
    const inner = backend.terminal('test');
    // The demo reader stands in for a live service, so the payment is written into the till's own table.
    const live = guardTerminal({
      ...inner,
      mode: 'live',
      sendToReader: async (input) => {
        const sent = await inner.sendToReader(input);
        if (!loseNextAnswer) return sent;
        loseNextAnswer = false;
        return providerError('UNAVAILABLE', 'The answer was lost.', true);
      },
    });
    deps = { meta: h.meta, sources, terminalFor: async () => ({ ok: true, key: 'demo-reader', mode: 'live', terminal: live }), enqueue: async () => undefined, now: () => at };
    const started = await inner.startPairing({ label: 'Counter', locationId: null });
    if (!('pairing' in started)) throw new Error('no pairing');
    const finished = await inner.finishPairing({ pairing: started.pairing, code: backend.codeOn(started.pairing) });
    if (!('state' in finished) || finished.state !== 'paired') throw new Error('not paired');
    readerRef = finished.reader.id;
    reader = await paymentReadersRepo(h.meta).pair({ provider: 'demo-reader', mode: 'live', readerRef, label: 'Counter', locationId: null, locationName: null, model: 'Demo reader', online: true, lastSeenAt: at, createdBy: null });
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await h.close();
  });

  async function ticket(total: string): Promise<PayableRef> {
    n += 1;
    await h.rows(`insert into ${h.real('tickets')} (id, number, total, balance) values (${String(n)}, 'T-${String(n)}', ${total}, ${total})`);
    return { kind: 'profile', connectionId: h.connectionId, tableName: w.targetOf('tickets').table.id, rowKey: String(n) };
  }

  it.skipIf(!available)('takes the card with a tip, and writes what was asked beside the tip, the last four and the approval code', async () => {
    const ref = await ticket('12.50');
    const started = await startReaderCharge(deps, { ref, readerId: reader.id, tipping: true, by: 'usr_cara' });
    if (!started.ok) throw new Error(started.message);
    expect(chargeView(started.attempt)).toMatchObject({ state: 'on_reader', amount: '12.50' });
    // Another charge on the same reader, from another till: refused while this one is on it.
    const other = await startReaderCharge(deps, { ref: await ticket('3.00'), readerId: reader.id, tipping: false, by: 'usr_dan' });
    expect(other).toMatchObject({ ok: false, reason: 'reader-busy' });
    backend.tap(readerRef, 'succeeds', '2.00');
    expect(await pollReaderCharge(deps, started.attempt.id)).toBe('succeeded');
    expect(await recordAttempt({ meta: h.meta, sources }, started.attempt.id)).toMatchObject({ state: 'recorded' });
    const [row] = await h.rows(`select amount, tip, method, approval_code, last4 from ${h.real('ticket_payments')} where payment_ref = '${started.attempt.id}'`);
    expect([Number(row!['amount']), Number(row!['tip']), row!['method'], row!['approval_code'], row!['last4']]).toEqual([12.5, 2, 'card', 'DEMO01', '4242']);
    expect(chargeView((await paymentAttemptsRepo(h.meta).byId(started.attempt.id))!)).toMatchObject({ state: 'paid', tip: '2.00', last4: '4242' });
  });

  it.skipIf(!available)('sends a lost send again with the same key, and never gives the charge up blind', async () => {
    const ref = await ticket('5.00');
    loseNextAnswer = true;
    const started = await startReaderCharge(deps, { ref, readerId: reader.id, tipping: false, by: null });
    if (!started.ok) throw new Error(started.message);
    expect(started.attempt.state).toBe('creating');
    // The sweep gives up stale attempts: never one on a reader.
    expect(await paymentAttemptsRepo(h.meta).abandonStale(at + 60 * 60_000, at)).toBe(0);
    expect(await pollReaderCharge(deps, started.attempt.id)).toBe('open');
    // One charge at the reader for the one key.
    expect(backend.chargesFor(`${started.attempt.id}:send`)).toBe(1);
    // The card was tapped a moment before the cashier pressed Cancel: that is a payment.
    backend.tap(readerRef, 'succeeds');
    expect((await cancelReaderCharge(deps, started.attempt.id))?.state).toBe('succeeded');
  });

  it.skipIf(!available)('takes an amount off a reader gone two minutes, but ends nothing while it stays away; a decline frees the reader', async () => {
    const ref = await ticket('7.00');
    const started = await startReaderCharge(deps, { ref, readerId: reader.id, tipping: false, by: null });
    if (!started.ok) throw new Error(started.message);
    backend.setOnline(readerRef, false);
    expect(await pollReaderCharge(deps, started.attempt.id)).toBe('open');
    at += READER_OFFLINE_MS + 1;
    // Still away: asked to cancel, and still on it — kept, asked again later.
    expect(await pollReaderCharge(deps, started.attempt.id)).toBe('open');
    backend.setOnline(readerRef, true);
    expect((await cancelReaderCharge(deps, started.attempt.id))?.state).toBe('cancelled');
    // The reader is free again: a card declined there frees it too.
    const next = await startReaderCharge(deps, { ref: await ticket('4.00'), readerId: reader.id, tipping: false, by: null });
    if (!next.ok) throw new Error(next.message);
    backend.tap(readerRef, 'declined');
    expect(await pollReaderCharge(deps, next.attempt.id)).toBe('failed');
    expect(chargeView((await paymentAttemptsRepo(h.meta).byId(next.attempt.id))!)).toMatchObject({ state: 'declined', message: 'The card was declined.' });
    const freed = await startReaderCharge(deps, { ref: await ticket('1.00'), readerId: reader.id, tipping: false, by: null });
    if (!freed.ok) throw new Error(freed.message);
    expect((await cancelReaderCharge(deps, freed.attempt.id))?.state).toBe('cancelled');
  });

  it.skipIf(!available)('gives a reader payment back through its card reader service, at most what was asked, and never an Interac one online', async () => {
    const ref = await ticket('10.00');
    const started = await startReaderCharge(deps, { ref, readerId: reader.id, tipping: true, by: null });
    if (!started.ok) throw new Error(started.message);
    backend.tap(readerRef, 'succeeds', '1.50');
    await pollReaderCharge(deps, started.attempt.id);
    expect(await recordAttempt({ meta: h.meta, sources }, started.attempt.id)).toMatchObject({ state: 'recorded' });
    const refundDeps = { meta: h.meta, sources, providerFor: async () => ({ ok: false, code: 'NOT_INSTALLED', message: 'no pay page here' }) as never, terminalFor: deps.terminalFor };
    // The tip was the staff's: at most what was asked goes back.
    expect(await requestRefund(refundDeps, { attemptId: started.attempt.id, amount: '11.50', reason: 'requested_by_customer', note: null, key: `rk-reader-${dialect}`.padEnd(20, 'x'), requestedBy: 'usr_mara' })).toMatchObject({ ok: false, refusal: { code: 'MORE_THAN_REFUNDABLE' } });
    const answer = await requestRefund(refundDeps, { attemptId: started.attempt.id, amount: '10.00', reason: 'requested_by_customer', note: null, key: `rk-reader2-${dialect}`.padEnd(20, 'x'), requestedBy: 'usr_mara' });
    expect(answer).toMatchObject({ ok: true, refund: { state: 'succeeded', amount: '10.00' } });
    // An Interac card is refunded on the reader alone.
    await h.meta.db.updateTable('adminium_payment_attempts').set({ interac: h.meta.dialect === 'postgres' ? true : 1, refundCommitted: '0' } as never).where('id', '=', started.attempt.id).execute();
    expect(await requestRefund(refundDeps, { attemptId: started.attempt.id, amount: '1.00', reason: 'requested_by_customer', note: null, key: `rk-interac-${dialect}`.padEnd(20, 'x'), requestedBy: 'usr_mara' })).toMatchObject({ ok: false, refusal: { code: 'NOT_ONLINE' } });
  });

  it.skipIf(!available)('records a refund made at a card reader service with no pay page, read through the service itself', async () => {
    const ref = await ticket('8.00');
    const started = await startReaderCharge(deps, { ref, readerId: reader.id, tipping: false, by: null });
    if (!started.ok) throw new Error(started.message);
    backend.tap(readerRef, 'succeeds');
    await pollReaderCharge(deps, started.attempt.id);
    expect(await recordAttempt({ meta: h.meta, sources }, started.attempt.id)).toMatchObject({ state: 'recorded' });
    const taken = (await paymentAttemptsRepo(h.meta).byId(started.attempt.id))!;
    // Given back in the service's own dashboard: Adminium never asked for it.
    const lookup = await deps.terminalFor('demo-reader', 'live');
    if (!lookup.ok) throw new Error('no terminal');
    const there = await lookup.terminal.refund({ paymentRef: taken.paymentRef!, amount: '3.00', currency: taken.currency, reason: 'other', idempotencyKey: `there-${dialect}` });
    if (!there.ok) throw new Error(there.providerMessage);
    const refundDeps = { meta: h.meta, sources, providerFor: async () => ({ ok: false, code: 'NOT_INSTALLED', message: 'no pay page here' }) as never, terminalFor: deps.terminalFor };
    const made = await refundEvent(refundDeps, { provider: 'demo-reader', mode: 'live', refundRef: there.ref });
    expect(made).toMatchObject({ attemptId: started.attempt.id, source: 'provider', amount: '3.00', providerRefundId: there.ref });
  });

  it.skipIf(!available)('asks at most what is due now, and refuses a reader that is not paired', async () => {
    const ref = await ticket('9.00');
    expect(await startReaderCharge(deps, { ref, readerId: reader.id, amount: '9.50', tipping: false, by: null })).toMatchObject({ ok: false, reason: 'amount' });
    expect(await startReaderCharge(deps, { ref, readerId: 'prd_nope', tipping: false, by: null })).toMatchObject({ ok: false, reason: 'reader-unknown' });
  });
});
