// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The checkout service when the payment service misbehaves, against a fake
 * service whose every answer a test sets: a timeout never lets a taken
 * payment go, a checkout is only "ended" when the service says so, a late
 * success takes the payable back, declines lock the link once each, a
 * declined capture is tried again under a new key, and test and live never
 * hold each other up.
 */
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { providerError, type CheckoutState, type PaymentMode, type PaymentProvider, type ProviderError } from '@adminium/add-on-contracts';
import { createSqliteMetaDb, firstRun, paymentAttemptsRepo, paymentCountersRepo, paymentLinksRepo, paymentSettingsRepo, type MetaDb, type PaymentLink } from '@adminium/meta';

import { LINK_FAILURES_TO_LOCK, SettleUnanswered, createCheckoutService, linkFailBucket, type CheckoutService } from '../src/payments/checkout.js';
import type { PayableSources, ResolvedPayable } from '../src/payments/payables.js';
import type { ProviderLookup } from '../src/payments/providers.js';
import { serviceDocName, serviceStateSchema } from '../src/payments/services.js';

const KEY = 'payments-fake';
const PAY = 'https://pay.crumbandco.test';
const REF = { kind: 'document' as const, connectionId: null, tableName: null, rowKey: 'doc_inv0042' };
const PAYABLE: ResolvedPayable = { ref: REF, label: 'INV-0042', dueDate: null, currency: 'EUR', total: '120.00', due: '120.00', refusal: null, manualOnly: false, customerEmail: null, customerCountry: null, status: null, recordInto: { kind: 'kept' } };

type Answer<T> = T | ProviderError;

/** A payment service whose answers the test sets, ref by ref. */
class FakeService {
  made = 0;
  statusOf = new Map<string, Answer<CheckoutState>>();
  expireAnswer: Answer<{ ok: true; ref: string; status: CheckoutState['status'] }> | null = null;
  expired: string[] = [];
  captureKeys: string[] = [];
  /** What `complete` answers (a two-step service); null = it reads the status. */
  captureAnswer: Answer<CheckoutState> | null = null;
  off = false;

  state(ref: string, status: CheckoutState['status'], extra: Partial<CheckoutState> = {}): CheckoutState {
    const taken = status === 'succeeded' || status === 'processing';
    return { ok: true, ref, status, attemptId: null, amount: taken ? '120.00' : null, currency: taken ? 'EUR' : null, livemode: false, paymentRef: taken ? `pi_${ref}` : null, paidWith: null, settledAt: null, failureMessage: status === 'failed' ? 'Declined.' : null, ...extra };
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
        this.made += 1;
        const ref = `cs_${String(this.made)}`;
        this.statusOf.set(ref, this.state(ref, 'pending'));
        return { ok: true, ref, url: `https://checkout.fake.test/${ref}`, expiresAt: null };
      },
      status: async (ref) => this.statusOf.get(ref) ?? providerError('NOT_FOUND', 'No such checkout.'),
      complete: async (ref, key) => {
        this.captureKeys.push(key);
        return this.captureAnswer ?? this.statusOf.get(ref) ?? providerError('NOT_FOUND', 'No such checkout.');
      },
      expire: async (ref) => {
        this.expired.push(ref);
        return this.expireAnswer ?? { ok: true, ref, status: 'expired' };
      },
      refund: unused,
      refundStatus: unused,
      verifyWebhook: unused,
      listMissedEvents: unused,
      methodsFor: unused,
      toMinor: () => providerError('INVALID_REQUEST', 'unused'),
      fromMinor: () => providerError('INVALID_REQUEST', 'unused'),
    };
  }

  lookup(mode: PaymentMode): ProviderLookup {
    if (this.off) return { ok: false, code: 'SWITCHED_OFF', message: 'Switched off.' };
    return { ok: true, key: KEY, mode, provider: this.provider(mode), redirectHosts: ['checkout.fake.test'] };
  }
}

describe('the checkout service, when the payment service misbehaves', () => {
  let meta: MetaDb;
  let fake: FakeService;
  let service: CheckoutService;
  let clock: number;
  let jobs: { kind: string; payload: Record<string, unknown> }[];
  let links: Record<PaymentMode, PaymentLink>;
  const sources = {
    document: async () => ({ status: 'sent', number: 'INV-0042', currency: 'EUR', totalMinor: 12000 }),
    keptPaid: async () => '0',
  } as unknown as PayableSources;

  beforeEach(async () => {
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    clock = Date.now();
    fake = new FakeService();
    jobs = [];
    service = createCheckoutService({
      meta,
      sources,
      providerFor: async (_key, mode) => fake.lookup(mode),
      enqueue: async (job) => {
        jobs.push(job);
      },
      now: () => clock,
    });
    const mint = async (mode: PaymentMode, hash: string) => (await paymentLinksRepo(meta).mint({ tokenHash: hash, tokenSealed: 's', payable: REF, mode, expiresAt: clock + 86_400_000, createdBy: null })).link;
    links = { test: await mint('test', 'h-test'), live: await mint('live', 'h-live') };
  });

  afterEach(async () => {
    await meta.db.destroy();
  });

  const press = (mode: PaymentMode = 'test', due = '120.00') => service.start({ link: links[mode], payable: { ...PAYABLE, due }, provider: KEY, methods: ['card'], payAddress: PAY, locale: null });
  const attempt = (id: string) => paymentAttemptsRepo(meta).byId(id);

  async function opened(mode: PaymentMode = 'test'): Promise<string> {
    const made = await press(mode);
    if (made.kind !== 'redirect') throw new Error(`no checkout: ${made.kind}`);
    return made.attemptId;
  }

  describe('settling', () => {
    it('fails the settle job on a timeout, so a payment taken after a decline is still recorded', async () => {
      const id = await opened();
      fake.statusOf.set('cs_1', fake.state('cs_1', 'failed'));
      await service.settle(id);
      expect((await attempt(id))!.state).toBe('failed');
      // The customer pays with another card on the same page; the service then times out once.
      fake.statusOf.set('cs_1', providerError('UNAVAILABLE', 'Timed out.', true));
      await expect(service.settle(id, { strict: true, eventId: 'pev_1' })).rejects.toBeInstanceOf(SettleUnanswered);
      // The return page and the sweep read and say nothing.
      expect((await service.settle(id))!.state).toBe('failed');
      // The job's retry gets the answer.
      fake.statusOf.set('cs_1', fake.state('cs_1', 'succeeded'));
      expect((await service.settle(id, { strict: true, eventId: 'pev_1' }))!.state).toBe('succeeded');
      expect(jobs.some((job) => job.kind === 'payments.record' && job.payload['attemptId'] === id)).toBe(true);
    });

    it('fails the settle job when the service is switched off', async () => {
      const id = await opened();
      fake.off = true;
      await expect(service.settle(id, { strict: true })).rejects.toBeInstanceOf(SettleUnanswered);
    });

    it('notes when the service was last asked', async () => {
      const id = await opened();
      clock += 1000;
      await service.settle(id);
      expect((await attempt(id))!.lookedAt).toBe(clock);
    });

    it('takes the payable back when a success comes after a decline, so nothing new starts over it', async () => {
      const id = await opened();
      fake.statusOf.set('cs_1', fake.state('cs_1', 'failed'));
      await service.settle(id);
      fake.statusOf.set('cs_1', fake.state('cs_1', 'succeeded'));
      await service.settle(id);
      expect((await paymentAttemptsRepo(meta).openFor(REF, 'test'))?.id).toBe(id);
      expect(await press()).toEqual({ kind: 'in-progress', attemptId: id });
      expect(fake.made).toBe(1);
    });

    it('still takes a late success when another checkout holds the payable, and flags the two for a person', async () => {
      const first = await opened();
      fake.statusOf.set('cs_1', fake.state('cs_1', 'failed'));
      await service.settle(first);
      const second = await opened();
      expect(second).not.toBe(first);
      fake.statusOf.set('cs_1', fake.state('cs_1', 'succeeded'));
      await service.settle(first);
      const late = (await attempt(first))!;
      expect(late.state).toBe('succeeded');
      expect(late.flaggedAt).not.toBeNull();
      expect(late.problem?.code).toBe('TWO_AT_ONCE');
    });

    it('never believes money in the other mode, on an open or a processing attempt', async () => {
      const id = await opened();
      fake.statusOf.set('cs_1', fake.state('cs_1', 'processing', { livemode: true }));
      await service.settle(id);
      const read = (await attempt(id))!;
      expect(read.state).toBe('open');
      expect(read.problem?.code).toBe('MODE_MISMATCH');
      expect(read.flaggedAt).not.toBeNull();
      expect(jobs.filter((job) => job.kind === 'payments.record')).toHaveLength(0);
    });

    it('tries a declined capture again under a new key, and a timed-out one under the same key', async () => {
      const id = await opened();
      fake.captureAnswer = providerError('UNAVAILABLE', 'Timed out.', true);
      await service.settle(id);
      fake.captureAnswer = fake.state('cs_1', 'failed');
      await service.settle(id);
      fake.captureAnswer = fake.state('cs_1', 'succeeded');
      await service.settle(id);
      expect(fake.captureKeys).toEqual([`${id}:capture:0`, `${id}:capture:0`, `${id}:capture:1`]);
      expect((await attempt(id))!.state).toBe('succeeded');
    });

    it('ticks the setup checklist once, on the first payment in each mode', async () => {
      const id = await opened();
      fake.statusOf.set('cs_1', fake.state('cs_1', 'succeeded'));
      const at = clock;
      await service.settle(id);
      const read = async () => (await paymentSettingsRepo(meta).get(serviceDocName(KEY), serviceStateSchema))!;
      expect((await read()).test.firstPaymentAt).toBe(at);
      expect((await read()).live.firstPaymentAt).toBeNull();
      clock += 5000;
      await paymentAttemptsRepo(meta).move(id, 'recording', {}, clock);
      await paymentAttemptsRepo(meta).move(id, 'recorded', {}, clock);
      const again = await opened();
      fake.statusOf.set('cs_2', fake.state('cs_2', 'succeeded'));
      await service.settle(again);
      expect((await read()).test.firstPaymentAt).toBe(at);
    });

    it('never ticks it for money in the other mode', async () => {
      const id = await opened();
      fake.statusOf.set('cs_1', fake.state('cs_1', 'succeeded', { livemode: true }));
      await service.settle(id);
      expect(await paymentSettingsRepo(meta).get(serviceDocName(KEY), serviceStateSchema)).toBeNull();
    });
  });

  describe('starting', () => {
    it('makes nothing new when an open checkout for another amount cannot be ended now', async () => {
      await opened();
      fake.expireAnswer = providerError('UNAVAILABLE', 'Timed out.', true);
      expect(await press('test', '100.00')).toEqual({ kind: 'busy' });
      fake.off = true;
      expect(await press('test', '100.00')).toEqual({ kind: 'busy' });
      expect(fake.made).toBe(1);
    });

    it('makes nothing new when the service says it still waits on the customer', async () => {
      await opened();
      fake.expireAnswer = { ok: true, ref: 'cs_1', status: 'requires_action' };
      expect(await press('test', '100.00')).toEqual({ kind: 'busy' });
    });

    it('starts again once the service confirms the old checkout ended', async () => {
      const first = await opened();
      const next = await press('test', '100.00');
      expect(next).toMatchObject({ kind: 'redirect', reused: false });
      expect((await attempt(first))!.state).toBe('expired');
    });

    it("ends a declined attempt's page before a new one starts, once, and waits when it cannot", async () => {
      const id = await opened();
      fake.statusOf.set('cs_1', fake.state('cs_1', 'failed'));
      await service.settle(id);
      fake.expireAnswer = providerError('RATE_LIMITED', 'Slow down.', true);
      expect(await press()).toEqual({ kind: 'busy' });
      fake.expireAnswer = null;
      expect(await press()).toMatchObject({ kind: 'redirect', reused: false });
      expect((await attempt(id))!.checkoutUrl).toBeNull();
      const before = fake.expired.length;
      // The new one is open now; pressing again reuses it and asks nothing of the declined one.
      await press();
      expect(fake.expired.length).toBe(before);
    });

    it('makes nothing new while a taken payment waits for a person', async () => {
      const id = await opened();
      fake.statusOf.set('cs_1', fake.state('cs_1', 'succeeded'));
      await service.settle(id);
      await paymentAttemptsRepo(meta).move(id, 'recording', {}, clock);
      await paymentAttemptsRepo(meta).move(id, 'record_refused', { problem: { code: 'VOIDED', message: 'Voided.' } }, clock);
      expect(await press()).toEqual({ kind: 'in-progress', attemptId: id });
      await paymentAttemptsRepo(meta).check(id, 'usr_1', 'Refunded by hand.', clock);
      expect(await press()).toMatchObject({ kind: 'redirect' });
    });

    it("keeps test and live apart: a staff member's test checkout never holds up a customer", async () => {
      const test = await opened('test');
      fake.statusOf.set('cs_1', fake.state('cs_1', 'processing'));
      await service.settle(test);
      const live = await press('live');
      expect(live).toMatchObject({ kind: 'redirect', reused: false });
      expect((await paymentAttemptsRepo(meta).openFor(REF, 'test'))?.id).toBe(test);
    });
  });

  describe("declines and the link's lock", () => {
    const fails = () => paymentCountersRepo(meta).read(linkFailBucket(links.test.id), clock);

    it('counts each decline once, through its event or the move to failed, never per read', async () => {
      const id = await opened();
      fake.statusOf.set('cs_1', fake.state('cs_1', 'failed'));
      await service.settle(id);
      expect(await fails()).toBe(1);
      // The return page read again, and again.
      await service.settle(id);
      await service.settle(id);
      expect(await fails()).toBe(1);
      // The first decline's own event arrives: the same decline.
      await service.settle(id, { eventId: 'pev_1' });
      expect(await fails()).toBe(1);
      // Another card declined on the same open page: its own event.
      await service.settle(id, { eventId: 'pev_2' });
      expect(await fails()).toBe(2);
    });

    it('locks the link after too many declines, and ends every page still open for it', async () => {
      const id = await opened();
      fake.statusOf.set('cs_1', fake.state('cs_1', 'failed'));
      for (let one = 1; one <= LINK_FAILURES_TO_LOCK; one += 1) await service.settle(id, { eventId: `pev_${String(one)}` });
      expect(await fails()).toBe(LINK_FAILURES_TO_LOCK);
      expect(fake.expired).toContain('cs_1');
      expect((await attempt(id))!.checkoutUrl).toBeNull();
    });
  });
});
