// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A pay link, end to end, against the demo payment service: made by staff,
 * opened by whoever holds it, paid after the human check, and read back from
 * the provider when the customer returns. Every way a link cannot open looks
 * the same; nothing opens while customers cannot reach the pay address.
 */
import BetterSqlite3 from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDemoPaymentBackend, type DemoPaymentBackend } from '@adminium/add-on-contracts';
import {
  NO_RULES,
  createSqliteMetaDb,
  firstRun,
  keptPaymentsRepo,
  paymentAttemptsRepo,
  paymentMethodsRepo,
  paymentSettingsRepo,
  rolesRepo,
  usersRepo,
  type MetaDb,
  type User,
} from '@adminium/meta';

import { errorEnvelope } from '../src/errors.js';
import { createCheckoutService } from '../src/payments/checkout.js';
import { PAY_ADDRESS_DOC, linkSealFromSecret, mintLink, payAddressSchema } from '../src/payments/links.js';
import type { PayableSources } from '../src/payments/payables.js';
import { paymentProviderFor } from '../src/payments/providers.js';
import { recordAttempt } from '../src/payments/record.js';
import { payPageSchema } from '../src/routes/payments/ways.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { solveProof } from '../src/public-api/proof.js';
import { createPayPageReader, paidSoFar, payRoutes } from '../src/routes/pay/index.js';
import { paymentLinksRoutes } from '../src/routes/payments/links.js';
import { TEST_SECRET } from './helpers.js';

const PAY = 'https://pay.crumbandco.test';

describe('a pay link, end to end', () => {
  let meta: MetaDb;
  let app: FastifyInstance;
  let backend: DemoPaymentBackend;
  let owner: User;
  let jobs: string[];
  let locales: (string | null)[];
  const sources: PayableSources = {
    table: async () => null,
    readRow: async () => null,
    shapeOf: async () => null,
    connectionCurrency: async () => null,
    profile: async () => null,
    keptPaid: (ref, currency) => keptPaymentsRepo(meta).paid(ref, currency, 'live'),
    document: async (id) => (id === 'doc_inv0042' ? { status: 'sent', number: 'INV-0042', currency: 'EUR', totalMinor: 12000, due: '2026-11-02' } : null),
  };
  const staff = () => ({ 'x-test-user-id': owner.id, origin: PAY });

  beforeEach(async () => {
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    await paymentSettingsRepo(meta).set(PAY_ADDRESS_DOC, payAddressSchema, { origin: PAY });
    await paymentMethodsRepo(meta).put({ source: 'demo', method: 'card', label: null, enabled: true, rules: NO_RULES, details: null, position: 0 });
    // As the server wires it: the demo's page opens on the host the customer comes back to.
    backend = createDemoPaymentBackend({ pageUrl: (checkout) => `${new URL(checkout.successUrl ?? PAY).origin}/pay/demo/${checkout.attemptId}` });
    jobs = [];
    locales = [];
    const users = usersRepo(meta);
    const superAdmin = await rolesRepo(meta).findBySlug('super-admin');
    owner = await users.create({ email: 'mara@adminium.test', name: 'Mara', status: 'active' });
    await rolesRepo(meta).assignToUser(owner.id, superAdmin!.id);

    const checkout = createCheckoutService({
      meta,
      sources,
      providerFor: (key, mode) => paymentProviderFor({ runtime: () => null, manifests: { findByKey: async () => null, getCredential: async () => null }, httpFor: () => backend.http, demo: backend }, key, mode),
      enqueue: async (job) => {
        jobs.push(String(job.payload['attemptId']));
      },
    });
    const facts = { networkFeatures: true, desktop: false, trustProxy: false };

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
    await app.register(async (api) => api.register(paymentLinksRoutes({ meta, manager: { data: async () => { throw new Error('no table here'); } }, sources, secret: TEST_SECRET, ...facts, liveOn: async () => false })), { prefix: '/api/v1' });
    // Notes the language each checkout is started in.
    const noting = { ...checkout, start: async (input: Parameters<typeof checkout.start>[0]) => (locales.push(input.locale), checkout.start(input)) };
    // What a browser with JavaScript off gets for a link, read the way the HTML route reads it.
    const reader = createPayPageReader({ meta, sources, checkout, readyProviders: async (mode) => (mode === 'test' ? ['demo'] : []), secret: TEST_SECRET, ...facts });
    app.get<{ Params: { token: string } }>('/noscript/:token', async (request) => reader.noscript(request, request.params.token));
    await app.register(payRoutes({ meta, sources, checkout: noting, readyProviders: async (mode) => (mode === 'test' ? ['demo'] : []), secret: TEST_SECRET, ...facts }));
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await meta.db.destroy();
  });

  async function mint(): Promise<{ url: string; token: string; id: string }> {
    const made = await app.inject({ method: 'POST', url: '/api/v1/payments/links', headers: staff(), payload: { kind: 'document', connectionId: null, tableName: null, rowKey: 'doc_inv0042' } });
    expect(made.statusCode, made.payload).toBe(200);
    const url = made.json().data.link.url as string;
    return { url, token: url.slice(`${PAY}/pay/`.length), id: made.json().data.link.id as string };
  }

  async function proof(token: string, headers: Record<string, string> = staff()): Promise<string> {
    const challenge = (await app.inject({ method: 'GET', url: `/pay/api/${token}/challenge`, headers })).json();
    return `${challenge.id}.${solveProof(challenge.salt, challenge.difficulty)}`;
  }

  it('makes a link on the pay address, a new one replacing the last', async () => {
    const first = await mint();
    expect(first.url.startsWith(`${PAY}/pay/`)).toBe(true);
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const again = await app.inject({ method: 'POST', url: '/api/v1/payments/links', headers: staff(), payload: { kind: 'document', connectionId: null, tableName: null, rowKey: 'doc_inv0042' } });
    expect(again.json().data.replaced).toBe(true);
    expect((await app.inject({ method: 'GET', url: `/pay/api/${first.token}`, headers: staff() })).json().state).toBe('unknown');
  });

  it('opens a test link only for staff who may manage payments', async () => {
    const { token } = await mint();
    expect((await app.inject({ method: 'GET', url: `/pay/api/${token}` })).json()).toMatchObject({ state: 'test-staff-only', payable: null });
    const page = (await app.inject({ method: 'GET', url: `/pay/api/${token}`, headers: staff() })).json();
    expect(page).toMatchObject({ state: 'ready', test: true, payable: { label: 'INV-0042', currency: 'EUR', due: '120.00', dueDate: '2026-11-02', alreadyPaid: null, lines: null } });
    expect(page.ways.map((one: { source: string; method: string }) => `${one.source}:${one.method}`)).toEqual(['demo:card']);
  });

  it('pays after the human check, and reads the result from the provider on the way back', async () => {
    const { token } = await mint();
    expect((await app.inject({ method: 'POST', url: `/pay/api/${token}/checkout`, headers: staff(), payload: { source: 'demo' } })).statusCode).toBe(403);
    const started = await app.inject({ method: 'POST', url: `/pay/api/${token}/checkout`, headers: { ...staff(), 'x-adminium-proof': await proof(token) }, payload: { source: 'demo', locale: 'de-DE' } });
    expect(started.statusCode, started.payload).toBe(200);
    // The page's language is handed to the service's page.
    expect(locales).toEqual(['de-DE']);
    // A test payment comes back to the host the signed-in staff opened it on.
    expect(started.json().url).toMatch(/^http:\/\/localhost(:80)?\/pay\/demo\//);

    const [attempt] = await paymentAttemptsRepo(meta).forPayable({ kind: 'document', connectionId: null, tableName: null, rowKey: 'doc_inv0042' });
    const before = (await app.inject({ method: 'GET', url: `/pay/api/back/${attempt!.nonce}`, headers: staff() })).json();
    expect(before.state).toBe('checking');
    await backend.pay(backend.checkoutForAttempt(attempt!.id)!.id, 'succeeds');
    const back = (await app.inject({ method: 'GET', url: `/pay/api/back/${attempt!.nonce}`, headers: staff() })).json();
    expect(back).toMatchObject({ state: 'paid', test: true, attempt: { provider: 'demo', amount: '120.00', currency: 'EUR', receiptSent: false } });
    expect(jobs).toEqual([attempt!.id]);
    expect(await recordAttempt({ meta, sources }, attempt!.id)).toMatchObject({ state: 'recorded' });
  });

  it('says a link has expired, and still tells a revoked link how its own payment went, without the record', async () => {
    const { token, id } = await mint();
    const started = await app.inject({ method: 'POST', url: `/pay/api/${token}/checkout`, headers: { ...staff(), 'x-adminium-proof': await proof(token) }, payload: { source: 'demo' } });
    expect(started.statusCode, started.payload).toBe(200);
    const [attempt] = await paymentAttemptsRepo(meta).forPayable({ kind: 'document', connectionId: null, tableName: null, rowKey: 'doc_inv0042' });
    await backend.pay(backend.checkoutForAttempt(attempt!.id)!.id, 'succeeds');

    expect((await app.inject({ method: 'POST', url: `/api/v1/payments/links/${id}/revoke`, headers: staff() })).statusCode).toBe(204);
    const back = (await app.inject({ method: 'GET', url: `/pay/api/back/${attempt!.nonce}`, headers: staff() })).json();
    expect(back).toMatchObject({ state: 'paid', payable: null, attempt: { amount: '120.00', currency: 'EUR' } });

    const fresh = await mint();
    await meta.db.updateTable('adminium_payment_links').set({ expiresAt: 1 }).where('id', '=', fresh.id).execute();
    const expired = (await app.inject({ method: 'GET', url: `/pay/api/${fresh.token}`, headers: staff() })).json();
    expect(expired).toMatchObject({ state: 'expired', payable: null, ways: [] });
  });

  it('writes the bank details for a browser with JavaScript off, in its language, escaped', async () => {
    await paymentMethodsRepo(meta).put({
      source: 'manual',
      method: 'bank-transfer',
      label: null,
      enabled: true,
      rules: NO_RULES,
      details: { accounts: [{ currency: 'EUR', holder: 'Crumb & Co. <GmbH>', iban: 'DE89370400440532013000', bic: 'COBADEFFXXX' }] },
      position: 1,
    });
    const { token } = await mint();
    const english = (await app.inject({ method: 'GET', url: `/noscript/${token}`, headers: { ...staff(), 'accept-language': 'en-GB,en;q=0.8' } })).payload;
    expect(english).toContain('This page needs JavaScript to pay online.');
    expect(english).toContain('DE89 3704 0044 0532 0130 00');
    expect(english).toContain('Crumb &amp; Co. &lt;GmbH&gt;');
    expect(english).toContain('€120.00');
    expect(english).not.toContain('<GmbH>');
    const german = (await app.inject({ method: 'GET', url: `/noscript/${token}`, headers: { ...staff(), 'accept-language': 'de-DE' } })).payload;
    expect(german).toContain('Diese Seite braucht JavaScript, um online zu bezahlen.');
    expect(german).toContain('lang="de-DE"');
    // A link that does not open shows no bank details at all.
    const dead = (await app.inject({ method: 'GET', url: '/noscript/AAAAAAAAAAAAAAAAAAAAAA' })).payload;
    expect(dead).not.toContain('DE89');
  });

  it('lists the invoice\'s lines only when the shop shows them', async () => {
    const withLines: PayableSources = { ...sources, lines: async () => [{ label: 'Sourdough loaves × 24', amount: '96.00' }, { label: 'Delivery', amount: '24.00' }] };
    const reader = createPayPageReader({ meta, sources: withLines, checkout: {} as never, readyProviders: async () => ['demo'], secret: TEST_SECRET, networkFeatures: true, desktop: false, trustProxy: false });
    const { token } = await mint();
    const page = (request: object) => reader.page(request as never, token);
    const fakeStaff = { apiKeyPrincipal: null, can: async () => true, headers: {} };
    expect((await page(fakeStaff)).payable?.lines).toBeNull();
    await paymentSettingsRepo(meta).set('pay-page', payPageSchema, { shopName: 'Crumb & Co.', logoFileId: null, contactEmail: null, contactPhone: null, shopCountry: 'DE', showLines: true });
    expect((await page(fakeStaff)).payable?.lines).toEqual([{ label: 'Sourdough loaves × 24', amount: '96.00' }, { label: 'Delivery', amount: '24.00' }]);
  });

  it('never spends one proof twice', async () => {
    const { token } = await mint();
    const header = await proof(token);
    expect((await app.inject({ method: 'POST', url: `/pay/api/${token}/checkout`, headers: { ...staff(), 'x-adminium-proof': header }, payload: { source: 'demo' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/pay/api/${token}/checkout`, headers: { ...staff(), 'x-adminium-proof': header }, payload: { source: 'demo' } })).statusCode).toBe(403);
  });

  it('answers an unknown and a revoked link the same', async () => {
    const { token, id } = await mint();
    const unknown = (await app.inject({ method: 'GET', url: '/pay/api/AAAAAAAAAAAAAAAAAAAAAA', headers: staff() })).json();
    expect((await app.inject({ method: 'POST', url: `/api/v1/payments/links/${id}/revoke`, headers: staff() })).statusCode).toBe(204);
    const revoked = (await app.inject({ method: 'GET', url: `/pay/api/${token}`, headers: staff() })).json();
    expect(revoked).toEqual(unknown);
    expect(revoked.state).toBe('unknown');
  });

  it('opens no live link and makes none while customers cannot reach the pay address; a test link still opens for staff', async () => {
    const { token } = await mint();
    const live = await mintLink(meta, linkSealFromSecret(TEST_SECRET), { payable: { kind: 'document', connectionId: null, tableName: null, rowKey: 'doc_inv0043' }, mode: 'live', createdBy: owner.id });
    await paymentSettingsRepo(meta).set(PAY_ADDRESS_DOC, payAddressSchema, { origin: 'http://192.168.1.20:4600' });
    expect((await app.inject({ method: 'GET', url: `/pay/api/${live.token}` })).json().state).toBe('unavailable');
    // A test link is staff's own: it needs no address customers can reach.
    expect((await app.inject({ method: 'GET', url: `/pay/api/${token}`, headers: staff() })).json().state).toBe('ready');
    const refused = await app.inject({ method: 'POST', url: '/api/v1/payments/links', headers: staff(), payload: { kind: 'document', connectionId: null, tableName: null, rowKey: 'doc_inv0042' } });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error.details).toEqual({ reason: 'private-network' });
  });
});

describe('what the pay page says is already paid', () => {
  it('is exact in the currency\'s own decimals, and says nothing when nothing or everything is paid', () => {
    expect(paidSoFar({ total: '120.00', due: '70.00', currency: 'EUR' })).toBe('50.00');
    expect(paidSoFar({ total: '0.30', due: '0.10', currency: 'EUR' })).toBe('0.20');
    expect(paidSoFar({ total: '45.250', due: '45.000', currency: 'KWD' })).toBe('0.250');
    expect(paidSoFar({ total: '12000', due: '2000', currency: 'JPY' })).toBe('10000');
    expect(paidSoFar({ total: '120.00', due: '120.00', currency: 'EUR' })).toBeNull();
    expect(paidSoFar({ total: '120.00', due: '0.00', currency: 'EUR' })).toBeNull();
  });
});
