// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the G4 sandbox walks found, each held by a test against a payment
 * service whose every answer the test sets:
 *
 *   - a dispute that arrives a moment before the settle job writes down which
 *     money the checkout took is kept, and applied once it is (Stripe's 0259
 *     card disputes at once; Stripe never sends a 200'd event again); the
 *     sweep ties it too, and gives up on one about money nobody here took;
 *   - a dispute the provider says was lost is money gone back to the
 *     customer: a refund of its own, so nothing more can be refunded; a won
 *     one is remembered;
 *   - a checkout whose making throws (a duplicate provider ref, the service
 *     falling over) fails at once instead of holding the record for 15 min;
 *   - the sweep's "the webhook is not reaching this server" clears once one does;
 *   - dispute and refund notices are told in test mode too, marked "Test".
 */
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { providerError, type CheckoutState, type PaymentDispute, type PaymentEvent, type PaymentMode, type PaymentProvider, type ProviderError } from '@adminium/add-on-contracts';
import {
  createSqliteMetaDb,
  firstRun,
  notificationsRepo,
  paymentAttemptsRepo,
  paymentEventsRepo,
  paymentLinksRepo,
  refundsRepo,
  rolesRepo,
  usersRepo,
  type MetaDb,
  type PaymentLink,
  type User,
} from '@adminium/meta';

import { createCheckoutService, type CheckoutService } from '../src/payments/checkout.js';
import { UNATTACHED_GIVE_UP_MS } from '../src/payments/events.js';
import type { PayableSources, ResolvedPayable } from '../src/payments/payables.js';
import type { ProviderLookup } from '../src/payments/providers.js';
import { disputeEvent, refundableOf, refundRefusalOf } from '../src/payments/refunds.js';
import { planSweeps, runSweep } from '../src/payments/sweep.js';
import { receiveWebhook } from '../src/payments/webhook.js';
import { caughtSince } from '../src/routes/payments/index.js';

const KEY = 'payments-fake';
const PAY = 'https://pay.crumbandco.test';
const REF = { kind: 'document' as const, connectionId: null, tableName: null, rowKey: 'doc_inv0042' };
const PAYABLE: ResolvedPayable = { ref: REF, label: 'INV-0042', dueDate: null, currency: 'EUR', total: '120.00', due: '120.00', refusal: null, manualOnly: false, customerEmail: null, customerCountry: null, status: null, recordInto: { kind: 'kept' } };

type Answer<T> = T | ProviderError;

/** A payment service whose answers the test sets: checkouts by ref, and the next webhook it "verifies". */
class FakeService {
  made = 0;
  statusOf = new Map<string, Answer<CheckoutState>>();
  /** What the next `createCheckout` does instead of making one. */
  createThrows: Error | null = null;
  /** The ref the next checkout gets (a service that hands out an id twice). */
  nextRef: string | null = null;
  /** The event the next delivery verifies as. */
  event: PaymentEvent | null = null;
  missed: PaymentEvent[] = [];

  state(ref: string, status: CheckoutState['status']): CheckoutState {
    const taken = status === 'succeeded' || status === 'processing';
    return { ok: true, ref, status, attemptId: null, amount: taken ? '120.00' : null, currency: taken ? 'EUR' : null, livemode: false, paymentRef: taken ? `pi_${ref}` : null, paidWith: null, settledAt: null, failureMessage: null };
  }

  provider(mode: PaymentMode): PaymentProvider {
    const unused = async (): Promise<never> => {
      throw new Error('not in this test');
    };
    return {
      key: KEY,
      mode,
      checkCredentials: unused,
      createCheckout: async () => {
        if (this.createThrows !== null) {
          const error = this.createThrows;
          this.createThrows = null;
          throw error;
        }
        this.made += 1;
        const ref = this.nextRef ?? `cs_${String(this.made)}`;
        this.nextRef = null;
        this.statusOf.set(ref, this.state(ref, 'pending'));
        return { ok: true, ref, url: `https://checkout.fake.test/${ref}`, expiresAt: null };
      },
      status: async (ref) => this.statusOf.get(ref) ?? providerError('NOT_FOUND', 'No such checkout.'),
      complete: async (ref) => this.statusOf.get(ref) ?? providerError('NOT_FOUND', 'No such checkout.'),
      expire: async (ref) => ({ ok: true, ref, status: 'expired' }),
      refund: unused,
      refundStatus: unused,
      verifyWebhook: async () => this.event ?? providerError('SIGNATURE_INVALID', 'No event.'),
      listMissedEvents: async () => ({ ok: true, events: this.missed.splice(0), cursor: null, more: false }),
      methodsFor: unused,
      toMinor: () => providerError('INVALID_REQUEST', 'unused'),
      fromMinor: () => providerError('INVALID_REQUEST', 'unused'),
    };
  }

  lookup(mode: PaymentMode): ProviderLookup {
    return { ok: true, key: KEY, mode, provider: this.provider(mode), redirectHosts: ['checkout.fake.test'] };
  }
}

/** A dispute event about a payment, naming the money only (no checkout), as Stripe's `charge.dispute.*` do. */
function disputeAbout(paymentRef: string, type: string, occurredAt: number, dispute?: PaymentDispute): PaymentEvent {
  return { ok: true, eventId: `evt_${type}_${String(occurredAt)}`, type, kind: 'dispute', checkoutRef: null, paymentRef, refundRef: null, livemode: false, occurredAt, ...(dispute === undefined ? {} : { dispute }) };
}

describe('the walk fixes', () => {
  let meta: MetaDb;
  let fake: FakeService;
  let service: CheckoutService;
  let clock: number;
  let jobs: { kind: string; payload: Record<string, unknown> }[];
  let link: PaymentLink;
  let owner: User;
  const sources = {
    document: async () => ({ status: 'sent', number: 'INV-0042', currency: 'EUR', totalMinor: 12000 }),
    keptPaid: async () => '0',
  } as unknown as PayableSources;
  const enqueue = async (job: { kind: string; payload: Record<string, unknown> }) => {
    jobs.push(job);
  };
  const notices = () => ({ meta, now: () => clock });

  beforeEach(async () => {
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    clock = Date.now();
    fake = new FakeService();
    jobs = [];
    service = createCheckoutService({ meta, sources, providerFor: async (_key, mode) => fake.lookup(mode), enqueue, notices: notices(), now: () => clock });
    link = (await paymentLinksRepo(meta).mint({ tokenHash: 'h-test', tokenSealed: 's', payable: REF, mode: 'test', expiresAt: clock + 86_400_000, createdBy: null })).link;
    owner = await usersRepo(meta).create({ email: 'mara@adminium.test', name: 'Mara', status: 'active' });
    await rolesRepo(meta).assignToUser(owner.id, (await rolesRepo(meta).findBySlug('super-admin'))!.id);
  });

  afterEach(async () => {
    await meta.db.destroy();
  });

  const press = () => service.start({ link, payable: PAYABLE, provider: KEY, methods: ['card'], payAddress: PAY, locale: null });
  const attempt = async (id: string) => (await paymentAttemptsRepo(meta).byId(id))!;
  const deliver = (event: PaymentEvent) => {
    fake.event = event;
    return receiveWebhook({ meta, providerFor: async (_key, mode) => fake.lookup(mode), enqueue, notices: notices(), now: () => clock }, { provider: KEY, mode: 'test', rawBody: '{}', headers: {} });
  };

  async function opened(): Promise<string> {
    const made = await press();
    if (made.kind !== 'redirect') throw new Error(`no checkout: ${made.kind}`);
    return made.attemptId;
  }

  describe('a dispute that outruns its payment', () => {
    it('keeps a dispute that arrives before the settle writes the payment down, and applies it once it does', async () => {
      const id = await opened();
      // The customer paid; checkout.session.completed is in, and its settle is queued but has not run.
      fake.statusOf.set('cs_1', fake.state('cs_1', 'succeeded'));
      // 0.3 s later the dispute: it names the PaymentIntent, which the attempt does not know yet.
      expect(await deliver(disputeAbout('pi_cs_1', 'charge.dispute.created', clock))).toEqual({ status: 200, matched: false });
      const [kept] = await paymentEventsRepo(meta).unattached(KEY, 'test', 'pi_cs_1');
      expect(kept).toMatchObject({ attemptId: null, kind: 'dispute', processedAt: null });
      expect((await attempt(id)).dispute).toBeNull();

      // The settle job runs: the payment is written down, and the dispute with it.
      clock += 300;
      expect((await service.settle(id, { strict: true }))!.state).toBe('succeeded');
      expect((await attempt(id)).dispute).toMatchObject({ state: 'open', outcome: null });
      expect(await paymentEventsRepo(meta).unattached(KEY, 'test', 'pi_cs_1')).toEqual([]);
      const event = await meta.db.selectFrom('adminium_payment_events').selectAll().where('id', '=', kept!.id).executeTakeFirstOrThrow();
      expect(event.attemptId).toBe(id);
      expect(event.processedAt).not.toBeNull();
      // Its payment managers are told, the notice marked as a test.
      const told = await notificationsRepo(meta).listForUser(owner.id, { limit: 10 });
      expect(told.map((one) => one.title)).toContain('Test dispute opened');
    });

    it('applies the dispute straight away once the payment is known, as before', async () => {
      const id = await opened();
      fake.statusOf.set('cs_1', fake.state('cs_1', 'succeeded'));
      await service.settle(id);
      expect(await deliver(disputeAbout('pi_cs_1', 'charge.dispute.created', clock))).toEqual({ status: 200, matched: true });
      expect((await attempt(id)).dispute).toMatchObject({ state: 'open' });
    });

    it('drops anything else about money nobody here took, and still never keeps a checkout event about none', async () => {
      expect(await deliver({ ...disputeAbout('pi_theirs', 'checkout.session.completed', clock), kind: 'checkout' })).toEqual({ status: 200, matched: false });
      expect(await deliver({ ...disputeAbout('pi_theirs', 'charge.dispute.created', clock), paymentRef: null })).toEqual({ status: 200, matched: false });
      expect(await meta.db.selectFrom('adminium_payment_events').selectAll().execute()).toEqual([]);
    });

    it('lets the sweep tie a kept dispute to the payment that took its money', async () => {
      const id = await opened();
      expect(await deliver(disputeAbout('pi_cs_1', 'charge.dispute.created', clock))).toMatchObject({ matched: false });
      // The money was written down some other way (another process, before this fix): nobody followed the event.
      await paymentAttemptsRepo(meta).move(id, 'succeeded', { paymentRef: 'pi_cs_1', takenAmount: '120.00', takenCurrency: 'EUR' }, clock);
      expect((await attempt(id)).dispute).toBeNull();
      clock += 11 * 60_000;
      const swept = await runSweep({ meta, checkout: service, providerFor: async (_key, mode) => fake.lookup(mode), enqueue, now: () => clock }, KEY, 'test');
      expect(swept.redriven).toBe(1);
      expect((await attempt(id)).dispute).toMatchObject({ state: 'open' });
    });

    it('keeps a missed dispute the sweep finds before its payment is known, too', async () => {
      const id = await opened();
      fake.statusOf.set('cs_1', fake.state('cs_1', 'succeeded'));
      fake.missed = [disputeAbout('pi_cs_1', 'charge.dispute.created', clock)];
      // Long enough open that the sweep looks the attempt up itself.
      clock += 11 * 60_000;
      await runSweep({ meta, checkout: service, providerFor: async (_key, mode) => fake.lookup(mode), enqueue, now: () => clock }, KEY, 'test');
      // The sweep's own look-up settled the attempt after it stored the event: the dispute followed.
      expect((await attempt(id)).paymentRef).toBe('pi_cs_1');
      expect((await attempt(id)).dispute).toMatchObject({ state: 'open' });
    });

    it('gives up on a kept event about money no attempt took after 48 hours, and keeps its row', async () => {
      await deliver(disputeAbout('pi_theirs', 'charge.dispute.created', clock));
      await planSweeps({ meta, enqueue, now: () => clock + UNATTACHED_GIVE_UP_MS - 1 }, []);
      expect(await paymentEventsRepo(meta).unattached(KEY, 'test', 'pi_theirs')).toHaveLength(1);
      await planSweeps({ meta, enqueue, now: () => clock + UNATTACHED_GIVE_UP_MS + 1 }, []);
      expect(await paymentEventsRepo(meta).unattached(KEY, 'test', 'pi_theirs')).toEqual([]);
      const rows = await meta.db.selectFrom('adminium_payment_events').selectAll().execute();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.processedAt).not.toBeNull();
    });
  });

  describe('how a dispute ended', () => {
    async function taken(): Promise<string> {
      const id = await opened();
      fake.statusOf.set('cs_1', fake.state('cs_1', 'succeeded'));
      await service.settle(id);
      return id;
    }

    it('records a lost dispute as the money going back: a refund of its own, flagged, and nothing more to refund', async () => {
      const id = await taken();
      await deliver(disputeAbout('pi_cs_1', 'charge.dispute.created', clock, { status: 'open', amount: '120.00', currency: 'EUR' }));
      clock += 60_000;
      await deliver(disputeAbout('pi_cs_1', 'charge.dispute.closed', clock, { status: 'lost', amount: '120.00', currency: 'EUR' }));
      const now = await attempt(id);
      expect(now.dispute).toMatchObject({ state: 'closed', outcome: 'lost' });
      const refunds = await refundsRepo(meta).forAttempt(id);
      expect(refunds).toEqual([expect.objectContaining({ source: 'dispute', state: 'succeeded', amount: '120.00', currency: 'EUR', providerRefundId: null })]);
      expect(refundableOf(now)).toBe('0');
      expect(refundRefusalOf(now)).toEqual({ code: 'FULLY_REFUNDED', message: 'The dispute was lost: the customer already got this money back.' });
      // Flagged for a person, and the record follows through the refund job.
      expect(await refundsRepo(meta).list({ needingLook: true })).toHaveLength(1);
      expect(jobs).toContainEqual(expect.objectContaining({ kind: 'payments.refund', payload: { refundId: refunds[0]!.id } }));
      // The same close again (a resend, the sweep) records nothing more.
      await disputeEvent({ meta, enqueue }, now, { type: 'charge.dispute.closed', occurredAt: clock, dispute: { status: 'lost', amount: '120.00', currency: 'EUR' } });
      expect(await refundsRepo(meta).forAttempt(id)).toHaveLength(1);
    });

    it('takes a lost dispute with no amount said as the whole payment', async () => {
      const id = await taken();
      await disputeEvent({ meta, enqueue }, await attempt(id), { type: 'charge.dispute.closed', occurredAt: clock, dispute: { status: 'lost', amount: null, currency: null } });
      expect(await refundsRepo(meta).forAttempt(id)).toEqual([expect.objectContaining({ amount: '120.00', source: 'dispute' })]);
    });

    it('takes a close that said no outcome, then one that says it was lost', async () => {
      const id = await taken();
      await disputeEvent({ meta, enqueue }, await attempt(id), { type: 'charge.dispute.created', occurredAt: clock });
      await disputeEvent({ meta, enqueue }, await attempt(id), { type: 'charge.dispute.closed', occurredAt: clock + 1 });
      expect((await attempt(id)).dispute).toMatchObject({ state: 'closed', outcome: null });
      expect(await refundsRepo(meta).forAttempt(id)).toEqual([]);
      await disputeEvent({ meta, enqueue }, await attempt(id), { type: 'charge.dispute.closed', occurredAt: clock + 2, dispute: { status: 'lost', amount: '40.00', currency: 'EUR' } });
      expect((await attempt(id)).dispute).toMatchObject({ state: 'closed', outcome: 'lost' });
      expect(await refundsRepo(meta).forAttempt(id)).toEqual([expect.objectContaining({ amount: '40.00' })]);
      expect(refundableOf(await attempt(id))).toBe('80.00');
    });

    it('remembers a won dispute and records nothing', async () => {
      const id = await taken();
      await disputeEvent({ meta, enqueue }, await attempt(id), { type: 'charge.dispute.created', occurredAt: clock });
      await disputeEvent({ meta, enqueue }, await attempt(id), { type: 'charge.dispute.closed', occurredAt: clock + 1, dispute: { status: 'won', amount: '120.00', currency: 'EUR' } });
      expect((await attempt(id)).dispute).toMatchObject({ state: 'closed', outcome: 'won' });
      expect(await refundsRepo(meta).forAttempt(id)).toEqual([]);
      expect(refundableOf(await attempt(id))).toBe('120.00');
    });

    it('opens a dispute on the provider\'s word even when its type says nothing, and a second dispute forgets the first one\'s outcome', async () => {
      const id = await taken();
      await disputeEvent({ meta, enqueue }, await attempt(id), { type: 'charge.dispute.closed', occurredAt: clock, dispute: { status: 'won', amount: null, currency: null } });
      await disputeEvent({ meta, enqueue }, await attempt(id), { type: 'CUSTOMER.DISPUTE.CREATED', occurredAt: clock + 60_000, dispute: { status: 'open', amount: null, currency: null } });
      expect((await attempt(id)).dispute).toMatchObject({ state: 'open', outcome: null, at: clock + 60_000 });
    });

    it('keeps a lost dispute in another currency than was paid, flagged, never held against the payment', async () => {
      const id = await taken();
      await disputeEvent({ meta, enqueue }, await attempt(id), { type: 'charge.dispute.closed', occurredAt: clock, dispute: { status: 'lost', amount: '130.00', currency: 'USD' } });
      expect(await refundsRepo(meta).forAttempt(id)).toEqual([expect.objectContaining({ currency: 'USD', problemCode: 'CURRENCY_DIFFERS' })]);
      expect(refundableOf(await attempt(id))).toBe('120.00');
    });
  });

  describe('a checkout whose making throws', () => {
    it('fails the attempt at once, so the next press makes a new checkout instead of waiting 15 minutes', async () => {
      fake.createThrows = new Error('socket hang up');
      const first = await press();
      expect(first).toMatchObject({ kind: 'refused', code: 'CREATE_FAILED', retryable: true });
      const [failed] = await paymentAttemptsRepo(meta).forPayable(REF);
      expect(failed).toMatchObject({ state: 'failed', openKey: null, problem: { code: 'CREATE_FAILED', message: 'socket hang up' } });
      expect(await press()).toMatchObject({ kind: 'redirect', reused: false });
    });

    it('fails the attempt when writing the answer down throws (a service that handed out a checkout id twice)', async () => {
      const first = await opened();
      await paymentAttemptsRepo(meta).move(first, 'expired', {}, clock);
      // After a restart the service begins its ids again: the same checkout id as an older attempt.
      fake.nextRef = 'cs_1';
      const second = await press();
      expect(second).toMatchObject({ kind: 'refused', code: 'CREATE_FAILED' });
      // The customer reads a sentence, never the database's words.
      expect((second as { message: string }).message).toBe('The payment could not be started. Try again in a moment.');
      const held = await paymentAttemptsRepo(meta).openFor(REF, 'test');
      expect(held).toBeNull();
      expect(await press()).toMatchObject({ kind: 'redirect' });
    });
  });

  describe('the webhook warning', () => {
    it('shows "not reaching this server" only while no webhook arrived since the sweep caught a payment', () => {
      expect(caughtSince(null, null)).toBeNull();
      expect(caughtSince(1_000, null)).toBe(1_000);
      expect(caughtSince(1_000, 900)).toBe(1_000);
      expect(caughtSince(1_000, 1_000)).toBeNull();
      expect(caughtSince(1_000, 2_000)).toBeNull();
    });
  });
});
