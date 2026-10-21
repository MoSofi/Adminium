// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Ways to pay and the pay page settings: a manual way with its bank accounts
 * (a change of them audited as its own alarm), a provider's ways offered in
 * the preview only once that provider can take a checkout, and a logo that
 * may not be an SVG.
 */
import BetterSqlite3 from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { providerError } from '@adminium/add-on-contracts';
import {
  NO_RULES,
  createSqliteMetaDb,
  filesRepo,
  firstRun,
  manifestsRepo,
  paymentSettingsRepo,
  rolesRepo,
  usersRepo,
  type MetaDb,
  type User,
} from '@adminium/meta';

import { addOnCredentialCryptoFromSecret } from '../src/add-ons/credential-crypto.js';
import type { AddOnRuntimeState } from '../src/add-ons/runtime.js';
import { errorEnvelope } from '../src/errors.js';
import { emptyServiceState, serviceDocName, serviceStateSchema } from '../src/payments/services.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { paymentWaysRoutes } from '../src/routes/payments/ways.js';

const MANIFEST = {
  kind: 'add-on',
  manifestVersion: 1,
  key: 'payments-stripe',
  name: 'Card payments',
  version: '1.0.12',
  publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
  license: 'AGPL-3.0-only',
  description: { key: 'addon.payments-stripe.line', fallback: 'Connects to Stripe.' },
  categories: ['payments'],
  compatibility: { minAdminiumVersion: '0.3.30', requires: ['outbound-http'] },
  capabilities: ['outbound-http'],
  addOn: {
    attaches: [{ app: '*' }],
    provides: [{ contract: 'payment-provider', version: 1, server: 'dist/server.js' }],
    connect: { kind: 'api-key' },
    network: { allow: ['api.stripe.com'] },
    publicSettings: [],
  },
  settings: [{ key: 'secret_key', type: 'string', secret: true }],
};

const runtime: AddOnRuntimeState = {
  providers: new Map([['payment-provider@1', [{ addOnKey: 'payments-stripe', contract: 'payment-provider', version: 1, module: { createPaymentProvider: () => ({ methodsFor: async () => providerError('UNAVAILABLE', 'x') }) } }]]]),
  slots: new Map(),
  conflicts: [],
  problems: [],
  deciders: new Map(),
};

const way = (enabled = true, details: unknown = null) => ({ enabled, rules: NO_RULES, label: null, details, position: 0 });
const EUR = { currency: 'EUR', holder: 'Crumb & Co. GmbH', iban: 'DE89370400440532013000', accountNumber: null, bic: 'COBADEFFXXX', sortCode: null, bank: null };

describe('ways to pay and pay page routes', () => {
  let meta: MetaDb;
  let app: FastifyInstance;
  let owner: User;
  let viewer: User;
  const asUser = (user: User) => ({ 'x-test-user-id': user.id });

  beforeEach(async () => {
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    const manifests = manifestsRepo(meta, addOnCredentialCryptoFromSecret('a-test-secret-that-is-long-enough-000'));
    await manifests.install({ manifestKey: 'payments-stripe', version: '1.0.12', kind: 'add-on', source: 'file', document: MANIFEST });
    const users = usersRepo(meta);
    const roles = rolesRepo(meta);
    const superAdmin = await roles.findBySlug('super-admin');
    const viewerRole = await roles.findBySlug('viewer');
    if (superAdmin === null || viewerRole === null) throw new Error('missing built-in roles');
    owner = await users.create({ email: 'mara@adminium.test', name: 'Mara', status: 'active' });
    viewer = await users.create({ email: 'tom@adminium.test', name: 'Tom', status: 'active' });
    await roles.assignToUser(owner.id, superAdmin.id);
    await roles.assignToUser(viewer.id, viewerRole.id);

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
    await app.register(async (api) => api.register(paymentWaysRoutes({ meta, manifests, runtime: () => runtime })), { prefix: '/api/v1' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await meta.db.destroy();
  });

  const put = (source: string, method: string, body: object) => app.inject({ method: 'PUT', url: `/api/v1/payments/ways/${source}/${method}`, headers: asUser(owner), payload: body });
  const actions = async () => (await meta.db.selectFrom('adminium_audit_log').select('action').where('category', '=', 'payments').execute()).map((row) => row.action);

  it('keeps a bank transfer with its accounts, and audits a change of them as its own alarm', async () => {
    expect((await put('manual', 'bank-transfer', way(true, { accounts: [EUR], note: null }))).statusCode).toBe(200);
    expect((await put('manual', 'bank-transfer', way(false, { accounts: [EUR], note: null }))).statusCode).toBe(200);
    expect((await put('manual', 'bank-transfer', way(true, { accounts: [{ ...EUR, iban: 'DE02120300000000202051' }], note: null }))).statusCode).toBe(200);
    expect(await actions()).toEqual(['payments.way.changed', 'payments.bank.changed', 'payments.way.changed', 'payments.way.changed', 'payments.bank.changed']);
  });

  it('refuses a manual way it does not know, details on a provider way, and an uninstalled service', async () => {
    expect((await put('manual', 'crypto', way())).statusCode).toBe(422);
    expect((await put('payments-stripe', 'card', way(true, { note: 'x' }))).statusCode).toBe(422);
    expect((await put('payments-paypal', 'paypal', way())).statusCode).toBe(404);
    expect((await put('manual', 'cash-on-delivery', way(true, { accounts: [EUR] }))).statusCode).toBe(422);
  });

  it("previews a provider's ways only once that provider can take a checkout", async () => {
    await put('payments-stripe', 'card', way());
    await put('manual', 'bank-transfer', way(true, { accounts: [EUR], note: null }));
    const preview = async () =>
      (await app.inject({ method: 'POST', url: '/api/v1/payments/ways/preview', headers: asUser(owner), payload: { country: 'DE', currency: 'EUR', amount: '120.00', kind: 'shape', profileId: null } })).json().data.map((one: { source: string; method: string }) => `${one.source}:${one.method}`);
    expect(await preview()).toEqual(['payments-stripe:card', 'manual:bank-transfer'].filter((one) => one.startsWith('manual')));
    const ready = { ...emptyServiceState(), test: { ...emptyServiceState().test, check: { at: 1, ok: true, code: null, message: null, missing: [] } } };
    await paymentSettingsRepo(meta).set(serviceDocName('payments-stripe'), serviceStateSchema, ready);
    expect((await preview()).sort()).toEqual(['manual:bank-transfer', 'payments-stripe:card']);
  });

  it('keeps the pay page settings, refusing an SVG logo', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/payments/pay-page', headers: asUser(owner) })).json().data).toMatchObject({ shopName: 'Adminium', showLines: false });
    const files = filesRepo(meta);
    const svg = await files.create({ filename: 'logo.svg', mime: 'image/svg+xml', sizeBytes: 10, kind: 'upload', sha256: 'a'.repeat(64) });
    const png = await files.create({ filename: 'logo.png', mime: 'image/png', sizeBytes: 10, kind: 'upload', sha256: 'b'.repeat(64) });
    const page = { shopName: 'Crumb & Co.', logoFileId: svg.id, contactEmail: 'hello@crumbandco.de', contactPhone: null, shopCountry: 'DE', showLines: true };
    const refused = await app.inject({ method: 'PUT', url: '/api/v1/payments/pay-page', headers: asUser(owner), payload: page });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error.details).toEqual({ field: 'logoFileId', reason: 'logo-type' });
    expect((await app.inject({ method: 'PUT', url: '/api/v1/payments/pay-page', headers: asUser(owner), payload: { ...page, logoFileId: png.id } })).statusCode).toBe(200);
  });

  it('shows nothing to someone without a payments key', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/payments/ways', headers: asUser(viewer) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/v1/payments/pay-page', headers: asUser(viewer) })).statusCode).toBe(403);
  });
});
