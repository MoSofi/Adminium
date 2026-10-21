// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Studio → Payments, setting up a service: who may read and change it, a
 * wrong paste refused before anything is saved, a key saved into the
 * encrypted envelope while only its hint is readable, the Check that runs as
 * soon as a mode's key is in, and the alarm when a key now belongs to another
 * account.
 */
import BetterSqlite3 from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { providerError, type PaymentProvider, type PaymentProviderContext } from '@adminium/add-on-contracts';
import {
  createSqliteMetaDb,
  firstRun,
  manifestsRepo,
  paymentCountersRepo,
  paymentSettingsRepo,
  rolesRepo,
  usersRepo,
  type ManifestsRepo,
  type MetaDb,
  type User,
} from '@adminium/meta';

import { addOnCredentialCryptoFromSecret } from '../src/add-ons/credential-crypto.js';
import type { AddOnRuntimeState } from '../src/add-ons/runtime.js';
import { errorEnvelope } from '../src/errors.js';
import { modeCredentials } from '../src/payments/credentials.js';
import { serviceDocName, serviceStateSchema } from '../src/payments/services.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { paymentsRoutes } from '../src/routes/payments/index.js';

const KEY = 'rk_test_51Habcdefghijklmnopa1B2';

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
    network: { allow: ['api.stripe.com', 'checkout.stripe.com'] },
    publicSettings: [],
  },
  settings: [
    { key: 'secret_key', type: 'string', secret: true, label: { key: 'k', fallback: 'Restricted key' } },
    { key: 'webhook_secret', type: 'string', secret: true, label: { key: 'w', fallback: 'Webhook signing secret' } },
  ],
};

/** A provider whose account is named by the key's last four, so a new key can belong to a new account. */
function fakeProvider(context: PaymentProviderContext): PaymentProvider {
  const key = context.credentials['secret_key'] ?? '';
  const refuse = async () => providerError('UNAVAILABLE', 'not in this test');
  return {
    key: 'payments-stripe',
    mode: context.mode,
    checkCredentials: async () =>
      key.endsWith('dead') ? providerError('CREDENTIALS_REFUSED', 'Stripe refused the key.') : { ok: true, accountId: `acct_${key.slice(-4)}`, livemode: context.mode === 'live', missing: key.endsWith('miss') ? ['Events: read'] : [] },
    createCheckout: refuse,
    status: refuse,
    complete: refuse,
    expire: refuse,
    refund: refuse,
    refundStatus: refuse,
    verifyWebhook: refuse,
    listMissedEvents: refuse,
    methodsFor: refuse,
    toMinor: () => providerError('UNAVAILABLE', 'not in this test'),
    fromMinor: () => providerError('UNAVAILABLE', 'not in this test'),
  };
}

const runtime: AddOnRuntimeState = {
  providers: new Map([['payment-provider@1', [{ addOnKey: 'payments-stripe', contract: 'payment-provider', version: 1, module: { createPaymentProvider: fakeProvider, webhookEvents: ['checkout.session.completed', 'refund.failed', 42] } }]]]),
  slots: new Map(),
  conflicts: [],
  problems: [],
  deciders: new Map(),
};

describe('payments setup routes', () => {
  let meta: MetaDb;
  let manifests: ManifestsRepo;
  let app: FastifyInstance;
  let owner: User;
  let viewer: User;
  let networkFeatures = true;

  const asUser = (user: User, extra: Record<string, string> = {}) => ({ 'x-test-user-id': user.id, ...extra });
  const field = (mode: string, name: string) => `/api/v1/payments/services/payments-stripe/modes/${mode}/fields/${name}`;

  beforeEach(async () => {
    networkFeatures = true;
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    manifests = manifestsRepo(meta, addOnCredentialCryptoFromSecret('a-test-secret-that-is-long-enough-000'));
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
      if (typeof id === 'string') {
        const user = await users.findById(id);
        if (user !== null) (request as unknown as { user: object }).user = { id: user.id, name: user.name, email: user.email };
      }
      if (request.headers['x-test-api-key'] !== undefined) (request as unknown as { apiKeyPrincipal: object }).apiKeyPrincipal = { id: 'key_1' };
    });
    await app.register(rbacPlugin, { meta });
    await app.register(
      async (api) => {
        await api.register(
          paymentsRoutes({
            meta,
            manifests,
            runtime: () => runtime,
            get networkFeatures() {
              return networkFeatures;
            },
            desktop: false,
            trustProxy: false,
          }),
        );
      },
      { prefix: '/api/v1' },
    );
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await meta.db.destroy();
  });

  it('shows the service and the reachability to a manager, and nothing to a viewer', async () => {
    const seen = await app.inject({ method: 'GET', url: '/api/v1/payments/setup', headers: asUser(owner) });
    expect(seen.statusCode).toBe(200);
    const data = seen.json().data;
    expect(data.canManage).toBe(true);
    expect(data.reachability.state).toBe('not-set');
    expect(data.services).toHaveLength(1);
    expect(data.services[0]).toMatchObject({ key: 'payments-stripe', name: 'Card payments', loaded: true, hasPaths: true });
    // The list its server half exports, with anything that is not an event name left out.
    expect(data.services[0].webhookEvents).toEqual(['checkout.session.completed', 'refund.failed']);
    expect(data.services[0].test.fields.map((one: { key: string; webhook: boolean; set: boolean }) => [one.key, one.webhook, one.set])).toEqual([
      ['secret_key', false, false],
      ['webhook_secret', true, false],
    ]);
    expect((await app.inject({ method: 'GET', url: '/api/v1/payments/setup', headers: asUser(viewer) })).statusCode).toBe(403);
  });

  it("reports the webhook's health per mode: refused deliveries this hour", async () => {
    await paymentCountersRepo(meta).hit('webhook-bad:payments-stripe:test');
    const data = (await app.inject({ method: 'GET', url: '/api/v1/payments/setup', headers: asUser(owner) })).json().data;
    expect(data.services[0].test.health).toEqual({ lastEventAt: null, lastBadAt: null, badThisHour: 1, caughtAt: null, slowed: false });
    expect(data.services[0].live.health.badThisHour).toBe(0);
  });

  it('refuses a wrong paste with its reason and saves nothing', async () => {
    const refused = await app.inject({ method: 'PUT', url: field('test', 'secret_key'), headers: asUser(owner), payload: { value: 'sk_test_51abcdefghijklmnop' } });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error.details).toEqual({ reason: 'SECRET_KEY', field: 'secret_key' });
    expect(await manifests.getCredential((await manifests.findByKey('payments-stripe'))!.row.id)).toBeNull();
  });

  it('saves a key encrypted, keeps only its hint readable, and checks it at once', async () => {
    const saved = await app.inject({ method: 'PUT', url: field('test', 'secret_key'), headers: asUser(owner), payload: { value: `  ${KEY}\n` } });
    expect(saved.statusCode).toBe(200);
    const view = saved.json().data;
    expect(view.test.fields[0]).toMatchObject({ key: 'secret_key', set: true, hint: 'rk_test_…a1B2' });
    expect(view.test.check).toMatchObject({ ok: true, missing: [] });
    expect(view.test.accountId).toBe('acct_a1B2');
    expect(view.checklist.find((one: { step: string }) => one.step === 'test-key').done).toBe(true);

    const envelope = await manifests.getCredential((await manifests.findByKey('payments-stripe'))!.row.id);
    expect(modeCredentials(envelope, 'test')).toEqual({ secret_key: KEY });
    const doc = await paymentSettingsRepo(meta).get(serviceDocName('payments-stripe'), serviceStateSchema);
    expect(JSON.stringify(doc)).not.toContain(KEY);
    expect(JSON.stringify(saved.json())).not.toContain(KEY);
  });

  it('names what a key is missing and keeps the step open', async () => {
    const saved = await app.inject({ method: 'PUT', url: field('test', 'secret_key'), headers: asUser(owner), payload: { value: 'rk_test_51Habcdefghijklmnopmiss' } });
    expect(saved.json().data.test.check.missing).toEqual(['Events: read']);
    expect(saved.json().data.checklist.find((one: { step: string }) => one.step === 'test-key').done).toBe(false);
  });

  it('audits a key that now belongs to another account', async () => {
    await app.inject({ method: 'PUT', url: field('live', 'secret_key'), headers: asUser(owner), payload: { value: 'rk_live_51Habcdefghijklmnop9xQ4' } });
    await app.inject({ method: 'PUT', url: field('live', 'secret_key'), headers: asUser(owner), payload: { value: 'rk_live_51Habcdefghijklmnop7wE6' } });
    const rows = await meta.db.selectFrom('adminium_audit_log').select(['action', 'category']).where('category', '=', 'payments').execute();
    expect(rows.map((row) => row.action)).toEqual([
      'payments.service.field.saved',
      'payments.service.field.replaced',
      'payments.account.changed',
    ]);
  });

  it('tells every payment manager when a key now belongs to another account, and keeps it on the setup page', async () => {
    await app.inject({ method: 'PUT', url: field('live', 'secret_key'), headers: asUser(owner), payload: { value: 'rk_live_51Habcdefghijklmnop9xQ4' } });
    await app.inject({ method: 'PUT', url: field('live', 'secret_key'), headers: asUser(owner), payload: { value: 'rk_live_51Habcdefghijklmnop7wE6' } });
    const notices = await meta.db.selectFrom('adminium_notifications').select(['userId', 'kind']).where('kind', '=', 'payments.money-redirect').execute();
    // The owner is the one Super Admin; the viewer may not manage payments and is not told.
    expect(notices.map((row) => row.userId)).toEqual([owner.id]);
    const alarms = (await app.inject({ method: 'GET', url: '/api/v1/payments/setup', headers: asUser(owner) })).json().data.alarms;
    expect(alarms).toEqual([expect.objectContaining({ what: 'account', service: 'payments-stripe', from: 'acct_9xQ4', to: 'acct_7wE6' })]);
  });

  it('keeps the field saved but records the refusal when the provider refuses the key', async () => {
    const saved = await app.inject({ method: 'PUT', url: field('test', 'secret_key'), headers: asUser(owner), payload: { value: 'rk_test_51Habcdefghijklmnopdead' } });
    expect(saved.json().data.test.check).toMatchObject({ ok: false, code: 'CREDENTIALS_REFUSED', message: 'Stripe refused the key.' });
  });

  it('never takes a change from an API key, or from someone without payments.manage', async () => {
    const byKey = await app.inject({ method: 'PUT', url: field('test', 'secret_key'), headers: asUser(owner, { 'x-test-api-key': '1' }), payload: { value: KEY } });
    // Refused either by the permission check (this key holds no grant) or,
    // for a key that does, by the signed-in-person rule behind it.
    expect(byKey.statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: field('test', 'secret_key'), headers: asUser(viewer), payload: { value: KEY } })).statusCode).toBe(403);
  });

  it('connects nothing while network features are off', async () => {
    networkFeatures = false;
    const refused = await app.inject({ method: 'PUT', url: field('test', 'secret_key'), headers: asUser(owner), payload: { value: KEY } });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error.details).toEqual({ reason: 'network-off' });
  });

  it('refuses a field the manifest does not declare', async () => {
    expect((await app.inject({ method: 'PUT', url: field('test', 'api_key'), headers: asUser(owner), payload: { value: KEY } })).statusCode).toBe(422);
  });

  it('removes a field from the envelope and the hint together', async () => {
    await app.inject({ method: 'PUT', url: field('test', 'secret_key'), headers: asUser(owner), payload: { value: KEY } });
    const removed = await app.inject({ method: 'DELETE', url: field('test', 'secret_key'), headers: asUser(owner) });
    expect(removed.json().data.test.fields[0]).toMatchObject({ set: false, hint: null });
    expect(modeCredentials(await manifests.getCredential((await manifests.findByKey('payments-stripe'))!.row.id), 'test')).toBeNull();
  });

  it('keeps the chosen path and the stop switch', async () => {
    const path = await app.inject({ method: 'PUT', url: '/api/v1/payments/services/payments-stripe/path', headers: asUser(owner), payload: { path: 'by-hand' } });
    expect(path.json().data).toMatchObject({ path: 'by-hand' });
    expect(path.json().data.checklist[0]).toEqual({ step: 'path', done: true });
    const stopped = await app.inject({ method: 'PUT', url: '/api/v1/payments/services/payments-stripe/stopped', headers: asUser(owner), payload: { stopped: true } });
    expect(stopped.json().data).toMatchObject({ stopped: true, path: 'by-hand' });
  });

  it('answers 404 for an add-on that is not a payment service', async () => {
    expect((await app.inject({ method: 'PUT', url: '/api/v1/payments/services/shipping-dhl/path', headers: asUser(owner), payload: { path: 'app' } })).statusCode).toBe(404);
  });
});
