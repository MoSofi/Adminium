// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A payment service calls back: the exact bytes verified, the event stored
 * once, a settle queued for the attempt it is about, everything else dropped
 * with a 2xx, a bad signature refused and counted.
 */
import BetterSqlite3 from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDemoPaymentBackend, type DemoPaymentBackend } from '@adminium/add-on-contracts';
import { createSqliteMetaDb, firstRun, paymentAttemptsRepo, paymentCountersRepo, paymentEventsRepo, paymentLinksRepo, paymentSettingsRepo, type MetaDb } from '@adminium/meta';

import { createCheckoutService, type CheckoutService } from '../src/payments/checkout.js';
import type { PayableSources, ResolvedPayable } from '../src/payments/payables.js';
import { DEMO_CREDENTIALS, paymentProviderFor } from '../src/payments/providers.js';
import { webhookDocName, webhookHealthSchema, type WebhookDeps } from '../src/payments/webhook.js';
import { paymentWebhookRoutes } from '../src/routes/payments/webhook.js';

const PAY = 'https://pay.crumbandco.test';
const REF = { kind: 'document' as const, connectionId: null, tableName: null, rowKey: 'doc_inv0042' };
const payable: ResolvedPayable = { ref: REF, label: 'INV-0042', dueDate: null, currency: 'EUR', total: '120.00', due: '120.00', refusal: null, manualOnly: false, customerEmail: null, customerCountry: null, status: null, recordInto: { kind: 'kept' } };

describe('the payment webhook', () => {
  let meta: MetaDb;
  let backend: DemoPaymentBackend;
  let checkout: CheckoutService;
  let app: FastifyInstance;
  let settles: { attemptId: string; eventId?: string }[];

  beforeEach(async () => {
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    backend = createDemoPaymentBackend({ pageUrl: (one) => `${PAY}/pay/demo/${one.attemptId}` });
    settles = [];
    const providerFor: WebhookDeps['providerFor'] = (key, mode) =>
      paymentProviderFor({ runtime: () => null, manifests: { findByKey: async () => null, getCredential: async () => null }, httpFor: () => backend.http, demo: backend }, key, mode);
    const enqueue: WebhookDeps['enqueue'] = async (job) => {
      if (job.kind === 'payments.settle') settles.push(job.payload as { attemptId: string; eventId?: string });
    };
    const sources = {
      document: async () => ({ status: 'sent', number: 'INV-0042', currency: 'EUR', totalMinor: 12000 }),
      keptPaid: async () => '0',
    } as unknown as PayableSources;
    checkout = createCheckoutService({ meta, sources, providerFor, enqueue });
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(paymentWebhookRoutes({ meta, providerFor, enqueue }), { prefix: '/api/v1' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await meta.db.destroy();
  });

  async function paidAttempt(): Promise<{ attemptId: string; checkoutId: string }> {
    const link = (await paymentLinksRepo(meta).mint({ tokenHash: 'h', tokenSealed: 's', payable: REF, mode: 'test', expiresAt: Date.now() + 1e9, createdBy: null })).link;
    const started = await checkout.start({ link, payable, provider: 'demo', methods: ['card'], payAddress: PAY, locale: null });
    if (started.kind !== 'redirect') throw new Error('no checkout');
    const checkoutId = backend.checkoutForAttempt(started.attemptId)!.id;
    await backend.pay(checkoutId, 'succeeds');
    return { attemptId: started.attemptId, checkoutId };
  }

  const post = (delivery: { rawBody: string; headers: Record<string, string | undefined> }, path = '/api/v1/payments/webhook/demo/test') =>
    app.inject({ method: 'POST', url: path, payload: delivery.rawBody, headers: { 'content-type': 'application/json', ...(delivery.headers as Record<string, string>) } });

  it('verifies a delivery, stores it once, and queues a settle for its attempt', async () => {
    const { attemptId, checkoutId } = await paidAttempt();
    const event = [...backend.events()].reverse().find((one) => one.checkoutRef === checkoutId)!;
    const delivery = await backend.deliveryFor(event.id, DEMO_CREDENTIALS.webhookSecret);
    expect((await post(delivery)).statusCode).toBe(200);
    expect(settles).toHaveLength(1);
    expect(settles[0]!.attemptId).toBe(attemptId);
    // The provider retries the same event: nothing more happens.
    expect((await post(delivery)).statusCode).toBe(200);
    expect(settles).toHaveLength(1);
    // The settle job asks the provider, and the payment moves on its word.
    expect(await checkout.settle(attemptId)).toMatchObject({ state: 'succeeded' });
    const health = await paymentSettingsRepo(meta).get(webhookDocName('demo', 'test'), webhookHealthSchema);
    expect(health?.lastAt).not.toBeNull();
  });

  it('refuses a forged or altered delivery and counts it', async () => {
    const { checkoutId } = await paidAttempt();
    const event = [...backend.events()].reverse().find((one) => one.checkoutRef === checkoutId)!;
    const delivery = await backend.deliveryFor(event.id, DEMO_CREDENTIALS.webhookSecret);
    expect((await post({ ...delivery, rawBody: delivery.rawBody.replace('succeeded', 'cancelled') })).statusCode).toBe(400);
    expect((await post({ rawBody: delivery.rawBody, headers: {} })).statusCode).toBe(400);
    expect(await paymentCountersRepo(meta).read('webhook-bad:demo:test')).toBe(2);
    expect(settles).toEqual([]);
  });

  it('drops an event about nothing Adminium made, with a 2xx', async () => {
    await paidAttempt();
    const other = createDemoPaymentBackend();
    // An event from the account about a checkout some other software made
    // (its ids run past ours, as two systems' ids on one account would).
    for (let i = 0; i < 5; i += 1) {
      await other.http('https://demo-payments.invalid/checkouts', {
        method: 'POST',
        headers: { authorization: `Bearer ${DEMO_CREDENTIALS.secretKey}`, 'idempotency-key': `theirs-${i}` },
        body: JSON.stringify({ attemptId: `theirs-${i}`, amount: '5.00', currency: 'EUR', methods: [] }),
      });
    }
    const foreign = await other.deliveryFor(other.events().at(-1)!.id, DEMO_CREDENTIALS.webhookSecret);
    expect((await post(foreign)).statusCode).toBe(200);
    expect(settles).toEqual([]);
    expect(await paymentEventsRepo(meta).unprocessed(Date.now() + 1)).toEqual([]);
  });

  it('answers 404 for a service or mode it does not know', async () => {
    expect((await post({ rawBody: '{}', headers: {} }, '/api/v1/payments/webhook/nope/test')).statusCode).toBe(404);
    expect((await post({ rawBody: '{}', headers: {} }, '/api/v1/payments/webhook/demo/sandbox')).statusCode).toBe(404);
  });

  it('answers 503 when it cannot check a signature now, so the provider keeps the event', async () => {
    expect((await post({ rawBody: '{}', headers: {} }, '/api/v1/payments/webhook/demo/live')).statusCode).toBe(503);
  });

  it('never leaves a stored event unprocessed once its settle ran', async () => {
    const { attemptId, checkoutId } = await paidAttempt();
    const event = [...backend.events()].reverse().find((one) => one.checkoutRef === checkoutId)!;
    await post(await backend.deliveryFor(event.id, DEMO_CREDENTIALS.webhookSecret));
    const [stored] = await paymentEventsRepo(meta).unprocessed(Date.now() + 1);
    expect(stored?.attemptId).toBe(attemptId);
    await paymentEventsRepo(meta).markProcessed(settles[0]!.eventId!);
    expect(await paymentEventsRepo(meta).unprocessed(Date.now() + 1)).toEqual([]);
    expect((await paymentAttemptsRepo(meta).byId(attemptId))!.state).toBe('open');
  });
});
