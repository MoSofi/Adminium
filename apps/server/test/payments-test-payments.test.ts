// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Send a test payment" and the pay page's full preview, end to end against
 * the demo payment service: a throwaway payable of one unit, a test link on
 * the staff's own host that opens with no public address, its one service
 * offered whatever the ways' rules say, the round trip read back, nothing
 * written to any table, and never a live link for it.
 */
import BetterSqlite3 from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDemoPaymentBackend, type DemoPaymentBackend, type PaymentProvider } from '@adminium/add-on-contracts';
import { createSqliteMetaDb, firstRun, keptPaymentsRepo, paymentAttemptsRepo, rolesRepo, usersRepo, type MetaDb, type User } from '@adminium/meta';

import { errorEnvelope } from '../src/errors.js';
import { createCheckoutService } from '../src/payments/checkout.js';
import { linkSealFromSecret, mintLink } from '../src/payments/links.js';
import { createPayableSources, resolvePayable } from '../src/payments/payables.js';
import { paymentProviderFor, type ProviderLookup } from '../src/payments/providers.js';
import { recordAttempt } from '../src/payments/record.js';
import { createTestPayable, isTestPayable, oneUnit } from '../src/payments/test-payables.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { solveProof } from '../src/public-api/proof.js';
import { payRoutes } from '../src/routes/pay/index.js';
import { testPaymentsRoutes } from '../src/routes/payments/test-payments.js';
import { TEST_SECRET } from './helpers.js';

describe('a test payment', () => {
  let meta: MetaDb;
  let app: FastifyInstance;
  let backend: DemoPaymentBackend;
  let owner: User;
  let viewer: User;
  let ready: string[];
  let methodsOf: Record<string, string[]>;

  beforeEach(async () => {
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    backend = createDemoPaymentBackend({ pageUrl: (checkout) => `${new URL(checkout.successUrl ?? 'https://x.invalid').origin}/pay/demo/${checkout.attemptId}` });
    ready = [];
    methodsOf = {};
    const users = usersRepo(meta);
    const roles = rolesRepo(meta);
    owner = await users.create({ email: 'mara@adminium.test', name: 'Mara', status: 'active' });
    await roles.assignToUser(owner.id, (await roles.findBySlug('super-admin'))!.id);
    viewer = await users.create({ email: 'vic@adminium.test', name: 'Vic', status: 'active' });
    await roles.assignToUser(viewer.id, (await roles.findBySlug('viewer'))!.id);

    // No public address and no pay address at all: a test payment still works.
    const sources = createPayableSources({ meta, manager: { data: async () => { throw new Error('no table here'); } } as never });
    const checkout = createCheckoutService({
      meta,
      sources,
      providerFor: (key, mode) => paymentProviderFor({ runtime: () => null, manifests: { findByKey: async () => null, getCredential: async () => null }, httpFor: () => backend.http, demo: backend }, key, mode),
      enqueue: async () => undefined,
    });

    app = Fastify({ logger: false });
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
    await app.register(rbacPlugin, { meta });
    await app.register(async (api) => api.register(testPaymentsRoutes({ meta, secret: TEST_SECRET, readyInTest: async () => ready })), { prefix: '/api/v1' });
    // A service's own list of ways, as Ways to pay reads it; a service not in it cannot be asked.
    const providerFor = async (key: string, mode: 'test' | 'live'): Promise<ProviderLookup> => {
      const listed = methodsOf[key];
      if (listed === undefined) return { ok: false, code: 'NOT_INSTALLED', message: 'Not installed.' };
      return { ok: true, key, mode, redirectHosts: [], provider: { methodsFor: async () => ({ ok: true, methods: listed.map((id) => ({ id, label: id, delayed: false })) }) } as unknown as PaymentProvider };
    };
    await app.register(payRoutes({ meta, sources, checkout, readyProviders: async () => ready, secret: TEST_SECRET, networkFeatures: true, desktop: false, trustProxy: false, providerFor }));
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await meta.db.destroy();
  });

  const as = (user: User) => ({ 'x-test-user-id': user.id, host: 'admin.crumbandco.test' });

  it('opens the real pay page on the staff host for a pretend invoice, with the demo service, and reads the round trip back', async () => {
    const started = await app.inject({ method: 'POST', url: '/api/v1/payments/test-payments', headers: as(owner), payload: { service: 'demo' } });
    expect(started.statusCode, started.payload).toBe(200);
    const made = started.json().data as { rowKey: string; label: string; url: string; amount: string; currency: string };
    expect(made).toMatchObject({ amount: '1.00', currency: 'EUR' });
    expect(made.label).toMatch(/^TEST-[A-Z0-9_-]{4}$/);
    expect(made.url).toMatch(/^http:\/\/admin\.crumbandco\.test\/pay\/[A-Za-z0-9_-]{22}$/);
    const token = made.url.split('/pay/')[1]!;

    // Not for anyone signed out: a test link is staff's.
    expect((await app.inject({ method: 'GET', url: `/pay/api/${token}` })).json().state).toBe('test-staff-only');
    const page = (await app.inject({ method: 'GET', url: `/pay/api/${token}`, headers: as(owner) })).json();
    expect(page).toMatchObject({ state: 'ready', test: true, payable: { label: made.label, due: '1.00', currency: 'EUR' } });
    expect(page.ways).toEqual([{ source: 'demo', method: 'card', label: null, details: null }]);

    const challenge = (await app.inject({ method: 'GET', url: `/pay/api/${token}/challenge`, headers: as(owner) })).json();
    const proof = `${challenge.id}.${solveProof(challenge.salt, challenge.difficulty)}`;
    const checkout = await app.inject({ method: 'POST', url: `/pay/api/${token}/checkout`, headers: { ...as(owner), 'x-adminium-proof': proof }, payload: { source: 'demo' } });
    expect(checkout.statusCode, checkout.payload).toBe(200);

    const waiting = (await app.inject({ method: 'GET', url: `/api/v1/payments/test-payments/${made.rowKey}`, headers: as(owner) })).json().data;
    expect(waiting).toMatchObject({ state: 'open', recorded: false, webhookArrived: false, taken: null });

    const ref = { kind: 'document' as const, connectionId: null, tableName: null, rowKey: made.rowKey };
    const [attempt] = await paymentAttemptsRepo(meta).forPayable(ref);
    await backend.pay(backend.checkoutForAttempt(attempt!.id)!.id, 'succeeds');
    expect((await app.inject({ method: 'GET', url: `/pay/api/back/${attempt!.nonce}`, headers: as(owner) })).json().state).toBe('paid');
    expect(await recordAttempt({ meta, sources: createPayableSources({ meta, manager: {} as never }) }, attempt!.id)).toMatchObject({ state: 'recorded' });

    const trip = (await app.inject({ method: 'GET', url: `/api/v1/payments/test-payments/${made.rowKey}`, headers: as(owner) })).json().data;
    expect(trip).toMatchObject({ service: 'demo', state: 'recorded', taken: { amount: '1.00', currency: 'EUR' }, recorded: true });
    // Kept in meta as a test payment, and the pretend invoice now reads as paid.
    expect((await keptPaymentsRepo(meta).forPayable(ref)).map((row) => row.mode)).toEqual(['test']);
    expect((await app.inject({ method: 'GET', url: `/pay/api/${token}`, headers: as(owner) })).json().state).toBe('paid');
  });

  it('starts a test payment of a payment service only once its test key is checked', async () => {
    const refused = await app.inject({ method: 'POST', url: '/api/v1/payments/test-payments', headers: as(owner), payload: { service: 'payments-stripe' } });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error.details).toEqual({ reason: 'not-ready' });
    ready = ['payments-stripe'];
    const started = await app.inject({ method: 'POST', url: '/api/v1/payments/test-payments', headers: as(owner), payload: { service: 'payments-stripe', currency: 'JPY' } });
    expect(started.statusCode, started.payload).toBe(200);
    expect(started.json().data).toMatchObject({ amount: '1', currency: 'JPY' });
    const token = (started.json().data.url as string).split('/pay/')[1]!;
    const page = (await app.inject({ method: 'GET', url: `/pay/api/${token}`, headers: as(owner) })).json();
    expect(page.ways).toEqual([{ source: 'payments-stripe', method: 'card', label: null, details: null }]);
  });

  it('offers a service with no way set up its own first way, never a made-up card PayPal refuses', async () => {
    ready = ['payments-paypal', 'payments-stripe'];
    methodsOf = { 'payments-paypal': ['paypal', 'venmo'] };
    const pageOf = async (service: string) => {
      const started = await app.inject({ method: 'POST', url: '/api/v1/payments/test-payments', headers: as(owner), payload: { service } });
      expect(started.statusCode, started.payload).toBe(200);
      const token = (started.json().data.url as string).split('/pay/')[1]!;
      return (await app.inject({ method: 'GET', url: `/pay/api/${token}`, headers: as(owner) })).json();
    };
    expect((await pageOf('payments-paypal')).ways).toEqual([{ source: 'payments-paypal', method: 'paypal', label: null, details: null }]);
    // A service that cannot be asked (or lists nothing) still gets a card.
    expect((await pageOf('payments-stripe')).ways).toEqual([{ source: 'payments-stripe', method: 'card', label: null, details: null }]);
    methodsOf = { 'payments-stripe': [] };
    expect((await pageOf('payments-stripe')).ways).toEqual([{ source: 'payments-stripe', method: 'card', label: null, details: null }]);
  });

  it('is started by someone who may manage payments, signed in, and read only by someone who may see payments', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/v1/payments/test-payments', headers: as(viewer), payload: { service: 'demo' } })).statusCode).toBe(403);
    const { rowKey } = (await app.inject({ method: 'POST', url: '/api/v1/payments/test-payments', headers: as(owner), payload: { service: 'demo' } })).json().data as { rowKey: string };
    expect((await app.inject({ method: 'GET', url: `/api/v1/payments/test-payments/${rowKey}`, headers: as(viewer) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/v1/payments/test-payments', payload: { service: 'demo' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/v1/payments/test-payments/paytest_nothing', headers: as(owner) })).statusCode).toBe(404);
  });

  it('never opens a live link for a test payable', async () => {
    const { ref } = await createTestPayable(meta, { provider: 'demo', currency: 'EUR', amount: '1.00', createdBy: owner.id });
    expect(isTestPayable(ref)).toBe(true);
    const live = await mintLink(meta, linkSealFromSecret(TEST_SECRET), { payable: ref, mode: 'live', createdBy: owner.id });
    expect((await app.inject({ method: 'GET', url: `/pay/api/${live.token}`, headers: as(owner) })).json().state).not.toBe('ready');
  });

  it('resolves to one unit at the currency’s own decimals, and to nothing once paid', async () => {
    expect([oneUnit(0), oneUnit(2), oneUnit(3)]).toEqual(['1', '1.00', '1.000']);
    const { ref } = await createTestPayable(meta, { provider: 'demo', currency: 'KWD', amount: '1.000', createdBy: null });
    const sources = createPayableSources({ meta, manager: {} as never });
    expect(await resolvePayable(sources, ref)).toMatchObject({ label: expect.stringMatching(/^TEST-/), currency: 'KWD', total: '1.000', due: '1.000', refusal: null, onlyProvider: 'demo', recordInto: { kind: 'kept' } });
    expect(await resolvePayable(sources, { ...ref, rowKey: 'paytest_gone' })).toBeNull();
  });
});
