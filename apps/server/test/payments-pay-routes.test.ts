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
import { PAY_ADDRESS_DOC, payAddressSchema } from '../src/payments/links.js';
import type { PayableSources } from '../src/payments/payables.js';
import { paymentProviderFor } from '../src/payments/providers.js';
import { recordAttempt } from '../src/payments/record.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { solveProof } from '../src/public-api/proof.js';
import { payRoutes } from '../src/routes/pay/index.js';
import { paymentLinksRoutes } from '../src/routes/payments/links.js';
import { TEST_SECRET } from './helpers.js';

const PAY = 'https://pay.crumbandco.test';

describe('a pay link, end to end', () => {
  let meta: MetaDb;
  let app: FastifyInstance;
  let backend: DemoPaymentBackend;
  let owner: User;
  let jobs: string[];
  const sources: PayableSources = {
    table: async () => null,
    readRow: async () => null,
    shapeOf: async () => null,
    connectionCurrency: async () => null,
    profile: async () => null,
    keptPaid: (ref, currency) => keptPaymentsRepo(meta).paid(ref, currency, 'live'),
    document: async (id) => (id === 'doc_inv0042' ? { status: 'sent', number: 'INV-0042', currency: 'EUR', totalMinor: 12000 } : null),
  };
  const staff = () => ({ 'x-test-user-id': owner.id, origin: PAY });

  beforeEach(async () => {
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    await paymentSettingsRepo(meta).set(PAY_ADDRESS_DOC, payAddressSchema, { origin: PAY });
    await paymentMethodsRepo(meta).put({ source: 'demo', method: 'card', label: null, enabled: true, rules: NO_RULES, details: null, position: 0 });
    backend = createDemoPaymentBackend({ pageUrl: (checkout) => `${PAY}/pay/demo/${checkout.attemptId}` });
    jobs = [];
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
    await app.register(payRoutes({ meta, sources, checkout, readyProviders: async (mode) => (mode === 'test' ? ['demo'] : []), secret: TEST_SECRET, ...facts }));
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
    expect(page).toMatchObject({ state: 'ready', test: true, payable: { label: 'INV-0042', currency: 'EUR', due: '120.00' } });
    expect(page.ways.map((one: { source: string; method: string }) => `${one.source}:${one.method}`)).toEqual(['demo:card']);
  });

  it('pays after the human check, and reads the result from the provider on the way back', async () => {
    const { token } = await mint();
    expect((await app.inject({ method: 'POST', url: `/pay/api/${token}/checkout`, headers: staff(), payload: { source: 'demo' } })).statusCode).toBe(403);
    const started = await app.inject({ method: 'POST', url: `/pay/api/${token}/checkout`, headers: { ...staff(), 'x-adminium-proof': await proof(token) }, payload: { source: 'demo' } });
    expect(started.statusCode, started.payload).toBe(200);
    expect(started.json().url.startsWith(`${PAY}/pay/demo/`)).toBe(true);

    const [attempt] = await paymentAttemptsRepo(meta).forPayable({ kind: 'document', connectionId: null, tableName: null, rowKey: 'doc_inv0042' });
    const before = (await app.inject({ method: 'GET', url: `/pay/api/back/${attempt!.nonce}`, headers: staff() })).json();
    expect(before.state).toBe('checking');
    await backend.pay(backend.checkoutForAttempt(attempt!.id)!.id, 'succeeds');
    const back = (await app.inject({ method: 'GET', url: `/pay/api/back/${attempt!.nonce}`, headers: staff() })).json();
    expect(back).toMatchObject({ state: 'paid', test: true });
    expect(jobs).toEqual([attempt!.id]);
    expect(await recordAttempt({ meta, sources }, attempt!.id)).toMatchObject({ state: 'recorded' });
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

  it('opens no link and makes none while customers cannot reach the pay address', async () => {
    const { token } = await mint();
    await paymentSettingsRepo(meta).set(PAY_ADDRESS_DOC, payAddressSchema, { origin: 'http://192.168.1.20:4600' });
    expect((await app.inject({ method: 'GET', url: `/pay/api/${token}`, headers: staff() })).json().state).toBe('unavailable');
    const refused = await app.inject({ method: 'POST', url: '/api/v1/payments/links', headers: staff(), payload: { kind: 'document', connectionId: null, tableName: null, rowKey: 'doc_inv0042' } });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error.details).toEqual({ reason: 'private-network' });
  });
});
