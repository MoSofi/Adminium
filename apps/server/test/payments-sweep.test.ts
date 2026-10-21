// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The safety sweep, against the demo payment service: a payment whose webhook
 * never arrived is found and settled, an attempt left waiting is asked about,
 * one that never got a checkout is let go, an unprocessed event is queued
 * again, and runs come only as often as something waits.
 */
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDemoPaymentBackend, type DemoPaymentBackend } from '@adminium/add-on-contracts';
import { createSqliteMetaDb, firstRun, paymentAttemptsRepo, paymentEventsRepo, paymentLinksRepo, paymentSettingsRepo, type MetaDb } from '@adminium/meta';

import { createCheckoutService, type CheckoutService } from '../src/payments/checkout.js';
import type { PayableSources, ResolvedPayable } from '../src/payments/payables.js';
import { paymentProviderFor } from '../src/payments/providers.js';
import { planSweeps, runSweep, sweepDocName, sweepDue, sweepStateSchema, type SweepDeps } from '../src/payments/sweep.js';

const PAY = 'https://pay.crumbandco.test';
const REF = { kind: 'document' as const, connectionId: null, tableName: null, rowKey: 'doc_inv0042' };
const payable: ResolvedPayable = { ref: REF, label: 'INV-0042', dueDate: null, currency: 'EUR', total: '120.00', due: '120.00', refusal: null, manualOnly: false, customerEmail: null, customerCountry: null, status: null, recordInto: { kind: 'kept' } };
const MIN = 60_000;

describe('the safety sweep', () => {
  let meta: MetaDb;
  let backend: DemoPaymentBackend;
  let checkout: CheckoutService;
  let clock: number;
  let queued: { kind: string; payload: Record<string, unknown> }[];
  let deps: SweepDeps;

  beforeEach(async () => {
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    clock = Date.now();
    backend = createDemoPaymentBackend({ pageUrl: (one) => `${PAY}/pay/demo/${one.attemptId}` });
    queued = [];
    const providerFor: SweepDeps['providerFor'] = (key, mode) =>
      paymentProviderFor({ runtime: () => null, manifests: { findByKey: async () => null, getCredential: async () => null }, httpFor: () => backend.http, demo: backend }, key, mode);
    const enqueue: SweepDeps['enqueue'] = async (job) => {
      queued.push(job);
    };
    const sources = {
      document: async () => ({ status: 'sent', number: 'INV-0042', currency: 'EUR', totalMinor: 12000 }),
      keptPaid: async () => '0',
    } as unknown as PayableSources;
    checkout = createCheckoutService({ meta, sources, providerFor, enqueue, now: () => clock });
    deps = { meta, checkout, providerFor, enqueue, now: () => clock };
  });

  afterEach(async () => {
    await meta.db.destroy();
  });

  async function started(): Promise<string> {
    const link = (await paymentLinksRepo(meta).mint({ tokenHash: `h${clock}`, tokenSealed: 's', payable: REF, mode: 'test', expiresAt: clock + 1e9, createdBy: null })).link;
    const made = await checkout.start({ link, payable, provider: 'demo', methods: ['card'], payAddress: PAY, locale: null });
    if (made.kind !== 'redirect') throw new Error('no checkout');
    return made.attemptId;
  }

  it('finds a payment whose webhook never arrived, settles it, and says the webhook is not reaching us', async () => {
    const attemptId = await started();
    await backend.pay(backend.checkoutForAttempt(attemptId)!.id, 'succeeds');
    const result = await runSweep(deps, 'demo', 'test');
    expect(result.events).toBeGreaterThan(0);
    expect(queued.filter((job) => job.kind === 'payments.settle').map((job) => job.payload['attemptId'])).toContain(attemptId);
    const stored = await paymentEventsRepo(meta).unprocessed(clock + 1);
    expect(stored.every((one) => one.source === 'sweep' && one.attemptId === attemptId)).toBe(true);
    const state = await paymentSettingsRepo(meta).get(sweepDocName('demo', 'test'), sweepStateSchema);
    expect(state?.caughtAt).toBe(clock);
    expect(state?.reads).toBeGreaterThan(0);
  });

  it('asks the provider about an attempt left waiting, and only once it has waited a while', async () => {
    const attemptId = await started();
    await backend.pay(backend.checkoutForAttempt(attemptId)!.id, 'fails');
    expect((await runSweep(deps, 'demo', 'test')).lookedUp).toBe(0);
    clock += 11 * MIN;
    expect((await runSweep(deps, 'demo', 'test')).lookedUp).toBe(1);
    expect((await paymentAttemptsRepo(meta).byId(attemptId))!.state).toBe('failed');
  });

  it('lets go of an attempt that never got a checkout', async () => {
    const attempt = await paymentAttemptsRepo(meta).create({ provider: 'demo', mode: 'test', accountId: null, payable: REF, payableLabel: 'INV-0042', amount: '120.00', currency: 'EUR', linkId: null, nonce: 'n'.repeat(22), createdBy: null }, clock);
    clock += 16 * MIN;
    expect((await runSweep(deps, 'demo', 'test')).abandoned).toBe(1);
    expect((await paymentAttemptsRepo(meta).byId(attempt!.id))!.state).toBe('abandoned');
  });

  it('queues the settle again for an event nobody processed', async () => {
    const attemptId = await started();
    await paymentEventsRepo(meta).record({ provider: 'demo', mode: 'test', eventId: 'evt_lost', type: 'checkout.succeeded', kind: 'checkout', checkoutRef: null, paymentRef: null, refundRef: null, attemptId, source: 'webhook', body: null }, clock);
    clock += 11 * MIN;
    expect((await runSweep(deps, 'demo', 'test')).redriven).toBe(1);
  });

  it('runs every 15 minutes while something is open, and not at all when nothing waits', async () => {
    expect(await sweepDue(meta, 'demo', 'test', clock)).toBe(false);
    await started();
    expect(await sweepDue(meta, 'demo', 'test', clock)).toBe(true);
    await runSweep(deps, 'demo', 'test');
    expect(await sweepDue(meta, 'demo', 'test', clock + 14 * MIN)).toBe(false);
    expect(await sweepDue(meta, 'demo', 'test', clock + 15 * MIN)).toBe(true);
    expect(await planSweeps(deps, [{ key: 'demo', mode: 'test' }])).toBe(0);
    clock += 15 * MIN;
    expect(await planSweeps(deps, [{ key: 'demo', mode: 'test' }])).toBe(1);
  });

  it('counts its reads per month, starting again each month', async () => {
    await started();
    await runSweep(deps, 'demo', 'test');
    const first = (await paymentSettingsRepo(meta).get(sweepDocName('demo', 'test'), sweepStateSchema))!;
    clock += 40 * 24 * 60 * MIN;
    await runSweep(deps, 'demo', 'test');
    const next = (await paymentSettingsRepo(meta).get(sweepDocName('demo', 'test'), sweepStateSchema))!;
    expect(next.month).not.toBe(first.month);
    expect(next.reads).toBeLessThanOrEqual(first.reads + 5);
  });
});
