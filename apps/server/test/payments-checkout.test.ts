// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A customer presses Pay, against the demo payment service: one attempt per
 * payable, reused while it fits, ended at the provider before another is
 * made, settled from the provider's own status only, and recorded once.
 */
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDemoPaymentBackend, sameAmount, type DemoPaymentBackend } from '@adminium/add-on-contracts';
import { createSqliteMetaDb, firstRun, keptPaymentsRepo, paymentAttemptsRepo, paymentLinksRepo, type MetaDb, type PaymentLink } from '@adminium/meta';

import { createCheckoutService, type CheckoutService } from '../src/payments/checkout.js';
import type { PayableSources, ResolvedPayable } from '../src/payments/payables.js';
import { paymentProviderFor } from '../src/payments/providers.js';
import { recordAttempt } from '../src/payments/record.js';

const PAY = 'https://pay.crumbandco.test';
const REF = { kind: 'document' as const, connectionId: null, tableName: null, rowKey: 'doc_inv0042' };

function payable(due = '120.00'): ResolvedPayable {
  return { ref: REF, label: 'INV-0042', currency: 'EUR', total: '120.00', due, refusal: null, manualOnly: false, customerEmail: null, customerCountry: 'DE', status: null, recordInto: { kind: 'kept' } };
}

describe('starting and settling a checkout', () => {
  let meta: MetaDb;
  let backend: DemoPaymentBackend;
  let service: CheckoutService;
  let link: PaymentLink;
  let jobs: { kind: string; payload: Record<string, unknown> }[];
  const sources = {} as PayableSources;

  beforeEach(async () => {
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    backend = createDemoPaymentBackend({ pageUrl: (checkout) => `${PAY}/pay/demo/${checkout.attemptId}` });
    jobs = [];
    service = createCheckoutService({
      meta,
      sources,
      providerFor: (key, mode) =>
        paymentProviderFor({ runtime: () => null, manifests: { findByKey: async () => null, getCredential: async () => null }, httpFor: () => backend.http, demo: backend }, key, mode),
      enqueue: async (job) => {
        jobs.push(job);
      },
    });
    link = (await paymentLinksRepo(meta).mint({ tokenHash: 'h1', tokenSealed: 's1', payable: REF, mode: 'test', expiresAt: Date.now() + 86_400_000, createdBy: null })).link;
  });

  afterEach(async () => {
    await meta.db.destroy();
  });

  const press = (due = '120.00') => service.start({ link, payable: payable(due), provider: 'demo', methods: ['card'], payAddress: PAY, locale: 'de-DE' });

  it('makes one checkout, sends the customer to its page, and reuses it while it fits', async () => {
    const first = await press();
    expect(first).toMatchObject({ kind: 'redirect', reused: false });
    if (first.kind !== 'redirect') throw new Error('no redirect');
    expect(first.url.startsWith(`${PAY}/pay/demo/`)).toBe(true);
    const again = await press();
    expect(again).toMatchObject({ kind: 'redirect', reused: true, url: first.url, attemptId: first.attemptId });
    expect(await paymentAttemptsRepo(meta).forPayable(REF)).toHaveLength(1);
  });

  it('settles a payment from the provider, queues the record, and records it once', async () => {
    const started = await press();
    if (started.kind !== 'redirect') throw new Error('no redirect');
    const checkout = backend.checkoutForAttempt(started.attemptId)!;
    await backend.pay(checkout.id, 'succeeds');
    const settled = await service.settle(started.attemptId);
    expect(settled).toMatchObject({ state: 'succeeded', takenAmount: '120.00', takenCurrency: 'EUR' });
    expect(jobs.map((job) => job.payload['attemptId'])).toEqual([started.attemptId]);
    expect(await recordAttempt({ meta, sources }, started.attemptId)).toMatchObject({ state: 'recorded' });
    expect(sameAmount(await keptPaymentsRepo(meta).paid(REF, 'EUR', 'test'), '120.00')).toBe(true);
    // A second settle (the webhook after the return page) changes nothing.
    await service.settle(started.attemptId);
    expect(jobs).toHaveLength(1);
  });

  it('starts nothing new while a payment is on its way', async () => {
    const started = await press();
    if (started.kind !== 'redirect') throw new Error('no redirect');
    await backend.pay(backend.checkoutForAttempt(started.attemptId)!.id, 'settles-late');
    await service.settle(started.attemptId);
    expect(await press()).toEqual({ kind: 'in-progress', attemptId: started.attemptId });
  });

  it('ends the old checkout at the provider when the amount due changed', async () => {
    const first = await press('120.00');
    if (first.kind !== 'redirect') throw new Error('no redirect');
    const second = await press('80.00');
    expect(second).toMatchObject({ kind: 'redirect', reused: false });
    expect(backend.checkoutForAttempt(first.attemptId)!.status).toBe('expired');
    expect((await paymentAttemptsRepo(meta).byId(first.attemptId))!.state).toBe('expired');
  });

  it('never opens a second page while a declined one may still take the money', async () => {
    const first = await press();
    if (first.kind !== 'redirect') throw new Error('no redirect');
    const checkout = backend.checkoutForAttempt(first.attemptId)!;
    await backend.pay(checkout.id, 'fails');
    expect(await service.settle(first.attemptId)).toMatchObject({ state: 'failed' });
    const second = await press();
    expect(second).toMatchObject({ kind: 'redirect', reused: false });
    // The declined attempt's checkout was ended before the new one was made.
    expect(backend.checkoutForAttempt(first.attemptId)!.status).not.toBe('pending');
  });

  it('makes nothing new when the old checkout completed at the provider meanwhile', async () => {
    const first = await press('120.00');
    if (first.kind !== 'redirect') throw new Error('no redirect');
    await backend.pay(backend.checkoutForAttempt(first.attemptId)!.id, 'succeeds');
    // The amount moved before anyone settled the payment: it cannot be ended now.
    expect(await press('80.00')).toEqual({ kind: 'in-progress', attemptId: first.attemptId });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await paymentAttemptsRepo(meta).byId(first.attemptId))!.state).toBe('succeeded');
  });

  it('refuses a service it cannot use, and makes no attempt', async () => {
    const live = { ...link, mode: 'live' as const };
    expect(await service.start({ link: live, payable: payable(), provider: 'demo', methods: ['card'], payAddress: PAY, locale: null })).toMatchObject({ kind: 'refused', code: 'DEMO_IS_TEST_ONLY' });
    expect(await paymentAttemptsRepo(meta).forPayable(REF)).toEqual([]);
  });
});
