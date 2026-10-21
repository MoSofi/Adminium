// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The payments repos (0061) on all three engines: the open slot, the
 * compare-and-set moves, insert-first recording, exact sums, the refund cap,
 * idempotent refunds, one current link, and the counters.
 */
import { describe, expect, it } from 'vitest';

import {
  ATTEMPT_MOVES,
  amountLeft,
  connectionsRepo,
  keptPaymentsRepo,
  openKeyOf,
  payableKeyOf,
  payableNameOf,
  payableProfilesRepo,
  paymentAttemptsRepo,
  paymentCountersRepo,
  paymentEventsRepo,
  paymentLinksRepo,
  paymentMethodsRepo,
  paymentSettingsRepo,
  refundsRepo,
  sumAmounts,
  NO_RULES,
  type CreateAttemptInput,
  type DsnCrypto,
  type PayableRef,
} from '../src/index.js';
import { TEST_DIALECTS, migrateOnly, useMetaDb } from './helpers/db.js';
import { z } from 'zod';

const T0 = 1_760_000_000_000;
const testCrypto: DsnCrypto = {
  encrypt: (plaintext) => `enc:test:${Buffer.from(plaintext, 'utf8').toString('base64')}`,
  decrypt: (token) => Buffer.from(token.slice('enc:test:'.length), 'base64').toString('utf8'),
};

const INVOICE: PayableRef = { kind: 'shape', connectionId: 'conn_X', tableName: 'public.invoices', rowKey: '42' };
const DOCUMENT: PayableRef = { kind: 'document', connectionId: null, tableName: null, rowKey: 'idoc_1' };

function attempt(payable: PayableRef = INVOICE, over: Partial<CreateAttemptInput> = {}): CreateAttemptInput {
  return {
    provider: 'demo',
    mode: 'test',
    accountId: 'demo_account',
    payable,
    payableLabel: 'INV-0042',
    amount: '120.00',
    currency: 'EUR',
    linkId: null,
    nonce: `nonce-${Math.random().toString(36).slice(2)}`,
    createdBy: null,
    ...over,
  };
}

describe('exact sums', () => {
  it('adds what a float gets wrong', () => {
    expect(sumAmounts(['0.1', '0.2'])).toBe('0.3');
    expect(sumAmounts(['45.250', '0.750'])).toBe('46');
    expect(amountLeft('120.00', '50')).toBe('70');
    expect(amountLeft('50', '120.00')).toBeNull();
  });

  it('keys a payable the same way whoever asks, as a hash every engine compares exactly', () => {
    expect(payableNameOf(INVOICE)).toBe('conn_X:public.invoices:42');
    expect(payableNameOf(DOCUMENT)).toBe('document:idoc_1');
    expect(payableKeyOf(INVOICE)).toMatch(/^pk1:[0-9a-f]{64}$/);
    expect(payableKeyOf({ ...INVOICE })).toBe(payableKeyOf(INVOICE));
    expect(payableKeyOf({ ...INVOICE, rowKey: 'ab' })).not.toBe(payableKeyOf({ ...INVOICE, rowKey: 'AB' }));
    expect(openKeyOf(INVOICE, 'test')).not.toBe(openKeyOf(INVOICE, 'live'));
  });

  it('never lets an attempt move back into creating', () => {
    expect(ATTEMPT_MOVES.creating).toEqual([]);
    for (const [to, from] of Object.entries(ATTEMPT_MOVES)) {
      if (to !== 'creating') expect(from.length, to).toBeGreaterThan(0);
    }
  });
});

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`payments repos [${dialect.name}]`, () => {
    const meta = useMetaDb(dialect, migrateOnly);

    describe('attempts', () => {
      it('holds one open slot per payable, and frees it on leaving the open states', async () => {
        const attempts = paymentAttemptsRepo(meta());
        const first = await attempts.create(attempt(), T0);
        expect(first?.state).toBe('creating');
        expect(await attempts.create(attempt(), T0 + 1)).toBeNull();
        // Another payable is not held up.
        expect(await attempts.create(attempt(DOCUMENT), T0 + 1)).not.toBeNull();

        expect(await attempts.move(first!.id, 'open', { providerRef: 'cs_1', checkoutUrl: 'https://x.test/p' }, T0 + 2)).toBe(true);
        expect((await attempts.openFor(INVOICE))?.id).toBe(first!.id);
        expect(await attempts.move(first!.id, 'expired', {}, T0 + 3)).toBe(true);
        expect(await attempts.openFor(INVOICE)).toBeNull();
        expect((await attempts.byId(first!.id))?.openKey).toBeNull();
        expect(await attempts.create(attempt(), T0 + 4)).not.toBeNull();
      });

      it('holds the slot until the payment is written down, so nobody can pay twice meanwhile', async () => {
        const attempts = paymentAttemptsRepo(meta());
        const one = (await attempts.create(attempt(), T0))!;
        await attempts.move(one.id, 'open', { providerRef: 'cs_hold' }, T0 + 1);
        await attempts.move(one.id, 'succeeded', {}, T0 + 2);
        expect(await attempts.create(attempt(), T0 + 3)).toBeNull();
        await attempts.move(one.id, 'recording', {}, T0 + 4);
        expect(await attempts.create(attempt(), T0 + 5)).toBeNull();
        await attempts.move(one.id, 'recorded', { recordedKey: 'row:x:1', recordedAt: T0 + 6 }, T0 + 6);
        expect(await attempts.create(attempt(), T0 + 7)).not.toBeNull();
      });

      it('records a success the provider reports after the attempt was marked expired', async () => {
        const attempts = paymentAttemptsRepo(meta());
        const one = (await attempts.create(attempt(), T0))!;
        await attempts.move(one.id, 'open', { providerRef: 'cs_late' }, T0 + 1);
        await attempts.move(one.id, 'expired', {}, T0 + 2);
        expect(await attempts.move(one.id, 'succeeded', { takenAmount: '120.00', takenCurrency: 'EUR' }, T0 + 3)).toBe(true);
        expect(await attempts.move(one.id, 'recording', {}, T0 + 4)).toBe(true);
      });

      it('moves only from the states its table allows', async () => {
        const attempts = paymentAttemptsRepo(meta());
        const one = (await attempts.create(attempt(), T0))!;
        expect(await attempts.move(one.id, 'succeeded', {}, T0 + 1)).toBe(false);
        expect(await attempts.move(one.id, 'recording', {}, T0 + 1)).toBe(false);
        expect((await attempts.byId(one.id))?.state).toBe('creating');
        await expect(attempts.move(one.id, 'creating')).rejects.toThrow(/never moves/);
      });

      it('lets exactly one of two racing moves win', async () => {
        const attempts = paymentAttemptsRepo(meta());
        const one = (await attempts.create(attempt(), T0))!;
        await attempts.move(one.id, 'open', { providerRef: 'cs_race' }, T0 + 1);
        await attempts.move(one.id, 'succeeded', { takenAmount: '120.00', takenCurrency: 'EUR', paymentRef: 'pay_1' }, T0 + 2);
        const results = await Promise.all([
          attempts.move(one.id, 'recording', {}, T0 + 3),
          attempts.move(one.id, 'recording', {}, T0 + 3),
        ]);
        expect(results.filter(Boolean)).toHaveLength(1);
        const read = await attempts.byId(one.id);
        expect(read).toMatchObject({ state: 'recording', takenAmount: '120.00', paymentRef: 'pay_1' });
      });

      it('finds an attempt by its provider ref, payment ref and nonce, and keeps the ref unique', async () => {
        const attempts = paymentAttemptsRepo(meta());
        const one = (await attempts.create(attempt(INVOICE, { nonce: 'n-1' }), T0))!;
        await attempts.move(one.id, 'open', { providerRef: 'cs_9' }, T0 + 1);
        await attempts.note(one.id, 'open', { paymentRef: 'pi_9', paidWith: { method: 'card', label: 'Visa ••4242', delayed: false } }, T0 + 2);
        expect((await attempts.byProviderRef('demo', 'test', 'cs_9'))?.id).toBe(one.id);
        expect((await attempts.byPaymentRef('demo', 'test', 'pi_9'))?.paidWith).toEqual({ method: 'card', label: 'Visa ••4242', delayed: false });
        expect((await attempts.byNonce('n-1'))?.id).toBe(one.id);
        expect(await attempts.byProviderRef('demo', 'live', 'cs_9')).toBeNull();
        const two = (await attempts.create(attempt(DOCUMENT), T0))!;
        await expect(attempts.move(two.id, 'open', { providerRef: 'cs_9' }, T0 + 3)).rejects.toThrow();
      });

      it('keeps a problem and a flag, and lists what the sweep picks up', async () => {
        const attempts = paymentAttemptsRepo(meta());
        const one = (await attempts.create(attempt(), T0))!;
        await attempts.move(one.id, 'open', { providerRef: 'cs_p' }, T0 + 1);
        await attempts.move(one.id, 'processing', {}, T0 + 2);
        expect(await attempts.flag(one.id, T0 + 3)).toBe(true);
        expect(await attempts.flag(one.id, T0 + 4)).toBe(false);
        expect((await attempts.stale(['processing'], T0 + 10)).map((a) => a.id)).toEqual([one.id]);
        expect(await attempts.stale(['processing'], T0)).toEqual([]);
        await attempts.move(one.id, 'succeeded', {}, T0 + 5);
        await attempts.move(one.id, 'recording', {}, T0 + 6);
        await attempts.move(one.id, 'record_refused', { problem: { code: 'VOIDED', message: 'The invoice was voided.' } }, T0 + 7);
        expect((await attempts.byId(one.id))?.problem).toEqual({ code: 'VOIDED', message: 'The invoice was voided.' });
        expect((await attempts.forPayable(INVOICE)).map((a) => a.id)).toEqual([one.id]);
      });
    });

    describe('attempts, at the edges', () => {
      it('keeps two rows whose keys differ only in case apart, on every engine', async () => {
        const attempts = paymentAttemptsRepo(meta());
        const lower = await attempts.create(attempt({ ...INVOICE, rowKey: 'ab' }, { nonce: 'n-ab' }), T0);
        const upper = await attempts.create(attempt({ ...INVOICE, rowKey: 'AB' }, { nonce: 'n-AB' }), T0);
        expect(lower).not.toBeNull();
        expect(upper).not.toBeNull();
        expect((await attempts.openFor({ ...INVOICE, rowKey: 'AB' }))?.id).toBe(upper!.id);
        expect((await attempts.forPayable({ ...INVOICE, rowKey: 'ab' })).map((one) => one.id)).toEqual([lower!.id]);
        expect((await attempts.byNonce('n-ab'))?.id).toBe(lower!.id);
        expect((await attempts.byNonce('N-AB'))).toBeNull();
      });

      it('holds a test slot and a live slot apart', async () => {
        const attempts = paymentAttemptsRepo(meta());
        const test = await attempts.create(attempt(INVOICE, { mode: 'test' }), T0);
        const live = await attempts.create(attempt(INVOICE, { mode: 'live', nonce: 'n-live' }), T0);
        expect(live).not.toBeNull();
        expect((await attempts.openFor(INVOICE, 'test'))?.id).toBe(test!.id);
        expect((await attempts.openFor(INVOICE, 'live'))?.id).toBe(live!.id);
        expect((await attempts.openFor(INVOICE))?.id).toBe(live!.id);
      });

      it('takes the slot back on a late success, and flags it when another attempt holds the slot', async () => {
        const attempts = paymentAttemptsRepo(meta());
        const one = (await attempts.create(attempt(), T0))!;
        await attempts.move(one.id, 'open', { providerRef: 'cs_l1' }, T0 + 1);
        await attempts.move(one.id, 'failed', {}, T0 + 2);
        expect(await attempts.openFor(INVOICE, 'test')).toBeNull();
        expect(await attempts.move(one.id, 'succeeded', {}, T0 + 3)).toBe(true);
        expect((await attempts.openFor(INVOICE, 'test'))?.id).toBe(one.id);

        const two = (await attempts.create(attempt(DOCUMENT, { nonce: 'n-2' }), T0))!;
        await attempts.move(two.id, 'open', { providerRef: 'cs_l2' }, T0 + 1);
        await attempts.move(two.id, 'expired', {}, T0 + 2);
        const three = (await attempts.create(attempt(DOCUMENT, { nonce: 'n-3' }), T0 + 3))!;
        expect(await attempts.move(two.id, 'succeeded', {}, T0 + 4)).toBe(true);
        const late = (await attempts.byId(two.id))!;
        expect(late).toMatchObject({ state: 'succeeded', openKey: null, problem: { code: 'TWO_AT_ONCE' } });
        expect(late.flaggedAt).toBe(T0 + 4);
        expect((await attempts.openFor(DOCUMENT, 'test'))?.id).toBe(three.id);
        expect((await attempts.needingLook()).map((a) => a.id)).toEqual([two.id]);
        expect(await attempts.countNeedingLook()).toBe(1);
      });

      it('counts each decline once, through events or the move, under concurrency too', async () => {
        const attempts = paymentAttemptsRepo(meta());
        const one = (await attempts.create(attempt(), T0))!;
        expect(await attempts.countFailure(one.id, false)).toBe(1);
        expect(await attempts.countFailure(one.id, false)).toBe(0);
        expect(await attempts.countFailure(one.id, true)).toBe(0);
        const added = await Promise.all([attempts.countFailure(one.id, true), attempts.countFailure(one.id, true)]);
        expect(added.reduce((a, b) => a + b, 0)).toBe(2);
        expect((await attempts.byId(one.id))).toMatchObject({ failEvents: 3, failCounted: 3 });
      });

      it('asks the longest-unasked first, by service and mode in the database, and lets stale creating attempts go', async () => {
        const attempts = paymentAttemptsRepo(meta());
        const a = (await attempts.create(attempt(INVOICE, { nonce: 'w-a' }), T0))!;
        const b = (await attempts.create(attempt(DOCUMENT, { nonce: 'w-b' }), T0))!;
        await attempts.move(a.id, 'open', { providerRef: 'cs_wa' }, T0 + 1);
        await attempts.move(b.id, 'open', { providerRef: 'cs_wb' }, T0 + 2);
        await attempts.looked(a.id, T0 + 50);
        expect((await attempts.waitingOn('demo', 'test', ['open'], T0 + 100)).map((one) => one.id)).toEqual([b.id, a.id]);
        expect(await attempts.waitingOn('demo', 'live', ['open'], T0 + 100)).toEqual([]);
        expect(await attempts.waitingOn('other', 'test', ['open'], T0 + 100)).toEqual([]);
        expect(await attempts.countIn('demo', 'test', ['open'])).toBe(2);
        const stuck = (await attempts.create(attempt({ ...INVOICE, rowKey: 'stuck' }, { nonce: 'w-s', provider: 'gone' }), T0))!;
        expect(await attempts.abandonStale(T0 + 1, T0 + 10)).toBe(1);
        expect((await attempts.byId(stuck.id))).toMatchObject({ state: 'abandoned', openKey: null });
      });

      it('moves a capture to its next try once', async () => {
        const attempts = paymentAttemptsRepo(meta());
        const one = (await attempts.create(attempt(), T0))!;
        expect(await attempts.nextCaptureTry(one.id, 0)).toBe(true);
        expect(await attempts.nextCaptureTry(one.id, 0)).toBe(false);
        expect((await attempts.byId(one.id))!.captureTry).toBe(1);
      });
    });

    describe('events', () => {
      it('stores an event once, re-drives the unprocessed, and sweeps the old', async () => {
        const events = paymentEventsRepo(meta());
        const input = {
          provider: 'demo',
          mode: 'test',
          eventId: 'evt_1',
          type: 'checkout.succeeded',
          kind: 'checkout',
          checkoutRef: 'cs_1',
          paymentRef: null,
          refundRef: null,
          attemptId: 'pat_1',
          source: 'webhook' as const,
          body: { status: 'succeeded' },
        };
        // About no attempt of ours: never work for the sweep.
        await events.record({ ...input, eventId: 'evt_none', attemptId: null }, T0);
        await events.record({ ...input, eventId: 'evt_live', mode: 'live' }, T0);
        const first = await events.record(input, T0);
        const again = await events.record({ ...input, source: 'sweep' }, T0 + 1);
        expect(first.fresh).toBe(true);
        expect(again.fresh).toBe(false);
        expect(again.event.id).toBe(first.event.id);
        expect(again.event.body).toEqual({ status: 'succeeded' });
        expect((await events.unprocessed(T0 + 10, 100, { provider: 'demo', mode: 'test' })).map((e) => e.id)).toEqual([first.event.id]);
        expect((await events.unprocessed(T0 + 10)).map((e) => e.eventId).sort()).toEqual(['evt_1', 'evt_live']);
        expect(await events.markProcessed(first.event.id, T0 + 2)).toBe(true);
        expect(await events.markProcessed(first.event.id, T0 + 3)).toBe(false);
        expect(await events.unprocessed(T0 + 10, 100, { provider: 'demo', mode: 'test' })).toEqual([]);
        expect(await events.gc(T0 + 40 * 86_400_000, 30)).toBe(1);
      });
    });

    describe('payments Adminium keeps', () => {
      it('records an online payment once: the second insert is null', async () => {
        const kept = keptPaymentsRepo(meta());
        const input = {
          payable: DOCUMENT,
          number: 'REC-0012',
          amount: '120.00',
          currency: 'EUR',
          method: 'card',
          methodNote: 'Visa ••4242',
          provider: 'demo',
          mode: 'live' as const,
          attemptId: 'pat_01',
          approvalCode: null,
          cardLast4: null,
          note: null,
          paidOn: T0,
          recordedBy: 'Online payment (Demo)',
          recordedByUser: null,
        };
        const first = await kept.insert(input, T0);
        expect(first).not.toBeNull();
        expect(await kept.insert(input, T0 + 1)).toBeNull();
        expect((await kept.byAttempt('pat_01'))?.id).toBe(first!.id);
        // Manual payments carry no attempt and are never refused as duplicates.
        await kept.insert({ ...input, attemptId: null, amount: '0.1' }, T0 + 2);
        await kept.insert({ ...input, attemptId: null, amount: '0.2' }, T0 + 3);
        expect(await kept.paid(DOCUMENT, 'EUR')).toBe('120.3');
        expect(await kept.paid(DOCUMENT, 'EUR', 'test')).toBe('0');
        expect(await kept.paid(DOCUMENT, 'USD')).toBe('0');
      });

      it('takes refunds by compare-and-set, never past what was paid', async () => {
        const kept = keptPaymentsRepo(meta());
        const payment = (await kept.insert(
          {
            payable: INVOICE,
            number: null,
            amount: '120.00',
            currency: 'EUR',
            method: 'card',
            methodNote: null,
            provider: 'demo',
            mode: 'live',
            attemptId: 'pat_02',
            approvalCode: null,
            cardLast4: null,
            note: null,
            paidOn: T0,
            recordedBy: 'Online payment (Demo)',
            recordedByUser: null,
          },
          T0,
        ))!;
        expect(await kept.addRefunded(payment.id, '0', '40')).toBe(true);
        expect(await kept.addRefunded(payment.id, '0', '40')).toBe(false); // stale previous value
        expect(await kept.addRefunded(payment.id, '40', '80.01')).toBe(false); // past what was paid
        expect(await kept.paid(INVOICE, 'EUR')).toBe('80');
        expect(await kept.subtractRefunded(payment.id, '40', '40')).toBe(true);
        expect(await kept.paid(INVOICE, 'EUR')).toBe('120');
        expect(await kept.void(payment.id, 'Entered twice', T0 + 1)).toBe(true);
        expect(await kept.void(payment.id, 'Entered twice', T0 + 2)).toBe(false);
        expect(await kept.paid(INVOICE, 'EUR')).toBe('0');
        expect((await kept.byId(payment.id))?.voided).toBe(true);
      });
    });

    describe('refunds', () => {
      const base = {
        attemptId: 'pat_1',
        paymentId: null,
        provider: 'demo',
        mode: 'live' as const,
        paymentRef: 'pi_1',
        amount: '40.00',
        currency: 'EUR',
        reason: 'requested_by_customer',
        note: null,
        source: 'staff' as const,
        requestedBy: null,
      };

      it('makes one refund per idempotency key, whatever the double click', async () => {
        const refunds = refundsRepo(meta());
        const [a, b] = await Promise.all([
          refunds.create({ ...base, idempotencyKey: 'rk-1' }, T0),
          refunds.create({ ...base, idempotencyKey: 'rk-1' }, T0),
        ]);
        expect([a.fresh, b.fresh].filter(Boolean)).toHaveLength(1);
        expect(a.refund.id).toBe(b.refund.id);
        expect(await refunds.committed('pi_1')).toBe('40');
      });

      it('moves through its states, fails after success, and is applied and undone once', async () => {
        const refunds = refundsRepo(meta());
        const { refund } = await refunds.create({ ...base, idempotencyKey: 'rk-2' }, T0);
        expect(await refunds.move(refund.id, 'pending', { providerRefundId: 're_1' }, T0 + 1)).toBe(true);
        expect(await refunds.markApplied(refund.id, T0 + 2)).toBe(false); // not succeeded yet
        expect(await refunds.move(refund.id, 'succeeded', {}, T0 + 3)).toBe(true);
        expect(await refunds.markApplied(refund.id, T0 + 4)).toBe(true);
        expect(await refunds.markApplied(refund.id, T0 + 5)).toBe(false);
        expect(await refunds.move(refund.id, 'failed', { failureMessage: 'The card was closed.' }, T0 + 6)).toBe(true);
        expect(await refunds.markUndone(refund.id, T0 + 7)).toBe(true);
        expect(await refunds.markUndone(refund.id, T0 + 8)).toBe(false);
        expect(await refunds.committed('pi_1')).toBe('0');
        expect((await refunds.byProviderId('demo', 'live', 're_1'))?.state).toBe('failed');
        expect(await refunds.move(refund.id, 'pending', {}, T0 + 9)).toBe(false);
      });

      it('records a refund made at the provider as already settled', async () => {
        const refunds = refundsRepo(meta());
        const { refund } = await refunds.create(
          { ...base, idempotencyKey: 'provider:re_9', source: 'provider', state: 'succeeded', providerRefundId: 're_9' },
          T0,
        );
        expect(refund).toMatchObject({ state: 'succeeded', source: 'provider', settledAt: T0 });
      });
    });

    describe('links', () => {
      it('keeps one current link per payable', async () => {
        const links = paymentLinksRepo(meta());
        const first = await links.mint({ tokenHash: 'h1', tokenSealed: 's1', payable: INVOICE, mode: 'live', expiresAt: T0 + 1, createdBy: null }, T0);
        expect(first.replaced).toBe(false);
        const second = await links.mint({ tokenHash: 'h2', tokenSealed: 's2', payable: INVOICE, mode: 'live', expiresAt: T0 + 1, createdBy: null }, T0);
        expect(second.replaced).toBe(true);
        expect((await links.byHash('h1'))?.current).toBe(false);
        expect((await links.currentFor(INVOICE))?.id).toBe(second.link.id);
        expect(await links.revoke(second.link.id, T0 + 2)).toBe(true);
        expect(await links.currentFor(INVOICE)).toBeNull();
        expect((await links.byId(second.link.id))?.revokedAt).toBe(T0 + 2);
        expect((await links.byId(second.link.id))?.revokeReason).toBeNull();
      });

      it('ends every current test link at once, saying why, and leaves live ones', async () => {
        const links = paymentLinksRepo(meta());
        const test = await links.mint({ tokenHash: 't1', tokenSealed: 's1', payable: INVOICE, mode: 'test', expiresAt: T0 + 9, createdBy: null }, T0);
        const live = await links.mint({ tokenHash: 'l1', tokenSealed: 's2', payable: DOCUMENT, mode: 'live', expiresAt: T0 + 9, createdBy: null }, T0);
        expect(await links.revokeTestLinks(T0 + 1)).toBe(1);
        expect(await links.byId(test.link.id)).toMatchObject({ current: false, revokedAt: T0 + 1, revokeReason: 'test-ended' });
        expect(await links.byId(live.link.id)).toMatchObject({ current: true, revokedAt: null });
        expect(await links.revokeTestLinks(T0 + 2)).toBe(0);
      });
    });

    describe('profiles, ways to pay, settings and counters', () => {
      it('marks a table payable once, and reads a broken mapping as not payable', async () => {
        const conn = await connectionsRepo(meta(), testCrypto).create({
          name: 'shop',
          engine: 'postgres',
          introspectDsn: 'postgres://ro:s@db/shop',
          dataDsn: 'postgres://rw:s@db/shop',
        });
        const profiles = payableProfilesRepo(meta());
        const mapping = {
          label: 'order_no',
          amount: { column: 'total', unit: null },
          currency: { column: 'currency' },
          due: null,
          payments: { kind: 'kept' as const },
          status: { column: 'status', paid: 'Paid', refunded: 'Cancelled' },
          customerEmail: 'email',
          customerCountry: 'country',
          pageFields: ['order_no'],
        };
        const profile = await profiles.create({ connectionId: conn.id, tableName: 'public.catering_orders', mapping, ownerApp: null, createdBy: null }, T0);
        expect(profile?.mapping).toEqual(mapping);
        expect(await profiles.create({ connectionId: conn.id, tableName: 'public.catering_orders', mapping, ownerApp: null, createdBy: null })).toBeNull();
        // Paid into the table's own payments, the due must come from the table's balance column.
        const own = { ...mapping, due: null, payments: { kind: 'table' as const, table: 'public.payments', link: 'order_id', amount: 'amount', date: 'paid_on', method: { column: 'method', values: {} }, note: null, voided: null, reference: 'payment_ref' } };
        await expect(profiles.create({ connectionId: conn.id, tableName: 'public.other', mapping: own as never, ownerApp: null, createdBy: null })).rejects.toThrow(/balance column/);
        expect((await profiles.byTable(conn.id, 'public.catering_orders'))?.id).toBe(profile!.id);
        await meta().db.updateTable('adminium_payable_profiles').set({ mapping: JSON.stringify({ amount: 3 }) }).where('id', '=', profile!.id).execute();
        expect((await profiles.byId(profile!.id))?.mapping).toBeNull();
        expect(await profiles.update(profile!.id, { mapping, enabled: false }, T0 + 1)).toBe(true);
        expect(await profiles.byId(profile!.id)).toMatchObject({ mapping, enabled: false });
        expect((await profiles.list(conn.id)).length).toBe(1);
      });

      it('saves a way to pay by source and method', async () => {
        const methods = paymentMethodsRepo(meta());
        await methods.put({ source: 'manual', method: 'cash-on-delivery', label: { 'en-US': 'Cash on delivery' }, enabled: true, rules: NO_RULES, details: null, position: 2 }, T0);
        const saved = await methods.put(
          { source: 'manual', method: 'cash-on-delivery', label: null, enabled: false, rules: { ...NO_RULES, countries: ['DE', 'AT'], max: '150.00' }, details: null, position: 2 },
          T0 + 1,
        );
        expect(saved).toMatchObject({ enabled: false, rules: { countries: ['DE', 'AT'], max: '150.00' } });
        expect(await methods.list()).toHaveLength(1);
        expect(await methods.remove('manual', 'cash-on-delivery')).toBe(true);
      });

      it('keeps small documents by name, parsed with their schema', async () => {
        const settings = paymentSettingsRepo(meta());
        const schema = z.object({ shopName: z.string() });
        expect(await settings.get('page', schema)).toBeNull();
        await settings.set('page', schema, { shopName: 'Crumb & Co.' }, T0);
        await settings.set('page', schema, { shopName: 'Crumb & Co. GmbH' }, T0 + 1);
        expect(await settings.get('page', schema)).toEqual({ shopName: 'Crumb & Co. GmbH' });
        expect(await settings.get('page', z.object({ other: z.number() }))).toBeNull();
      });

      it('claims a document once in every process, and drops old claims by prefix', async () => {
        const settings = paymentSettingsRepo(meta());
        const schema = z.object({ at: z.number() });
        const claims = await Promise.all(Array.from({ length: 4 }, () => settings.claim('notice:landed:pat_1', schema, { at: T0 }, T0)));
        expect(claims.filter(Boolean)).toHaveLength(1);
        expect(await settings.claim('notice:landed:pat_2', schema, { at: T0 + 5 }, T0 + 5)).toBe(true);
        await settings.set('page', z.object({ shopName: z.string() }), { shopName: 'kept' }, T0);
        expect(await settings.gcPrefix('notice:', T0 + 1)).toBe(1);
        expect(await settings.get('notice:landed:pat_2', schema)).toEqual({ at: T0 + 5 });
        expect(await settings.get('page', z.object({ shopName: z.string() }))).toEqual({ shopName: 'kept' });
        await expect(settings.gcPrefix('notice_%', T0)).rejects.toThrow(/plain prefix/);
      });

      it('counts every hit per hour, under concurrency too', async () => {
        const counters = paymentCountersRepo(meta());
        await Promise.all(Array.from({ length: 8 }, () => counters.hit('link:1', T0)));
        expect(await counters.read('link:1', T0)).toBe(8);
        expect(await counters.hit('link:1', T0 + 1)).toBe(9);
        expect(await counters.read('link:1', T0 + 3_600_000)).toBe(0);
        expect(await counters.gc(T0 + 30 * 3_600_000)).toBeGreaterThan(0);
      });
    });
  });
}
