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
import { z } from 'zod';

import { providerError, type PaymentProvider, type PaymentProviderContext } from '@adminium/add-on-contracts';
import {
  createSqliteMetaDb,
  firstRun,
  manifestsRepo,
  notificationsRepo,
  paymentAttemptsRepo,
  paymentLinksRepo,
  paymentCountersRepo,
  paymentSettingsRepo,
  rolesRepo,
  settingsRepo,
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
import { sweepDocName, sweepStateSchema } from '../src/payments/sweep.js';
import { webhookDocName, webhookHealthSchema } from '../src/payments/webhook.js';
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
  const other = key.endsWith('mode');
  return {
    key: 'payments-stripe',
    mode: context.mode,
    checkCredentials: async () => {
      if (key.endsWith('slow')) await slowCheck;
      if (other) return { ok: true as const, accountId: 'acct_mode', livemode: context.mode !== 'live', missing: [] };
      return key.endsWith('dead') ? providerError('CREDENTIALS_REFUSED', 'Stripe refused the key.') : { ok: true, accountId: `acct_${key.slice(-4)}`, livemode: context.mode === 'live', missing: key.endsWith('miss') ? ['Events: read'] : [] };
    },
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

let releaseSlow: () => void = () => undefined;
let slowCheck: Promise<void> = Promise.resolve();

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
    expect(data.services[0].test.health).toEqual({ lastEventAt: null, lastBadAt: null, badThisHour: 1, caughtAt: null, slowed: false, eventOrigin: null });
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

  it('hides an alarm for the person who says "Got it", and only for them', async () => {
    const other = await usersRepo(meta).create({ email: 'pia@adminium.test', name: 'Pia', status: 'active' });
    await rolesRepo(meta).assignToUser(other.id, (await rolesRepo(meta).findBySlug('super-admin'))!.id);
    await app.inject({ method: 'PUT', url: field('live', 'secret_key'), headers: asUser(owner), payload: { value: 'rk_live_51Habcdefghijklmnop9xQ4' } });
    await app.inject({ method: 'PUT', url: field('live', 'secret_key'), headers: asUser(owner), payload: { value: 'rk_live_51Habcdefghijklmnop7wE6' } });
    const alarms = async (user: User) => (await app.inject({ method: 'GET', url: '/api/v1/payments/setup', headers: asUser(user) })).json().data.alarms as { id: string }[];
    const [alarm] = await alarms(owner);
    expect(alarm!.id).toEqual(expect.any(String));
    const dismiss = (user: User, id: string, extra: Record<string, string> = {}) => app.inject({ method: 'POST', url: `/api/v1/payments/alarms/${id}/dismiss`, headers: asUser(user, extra) });
    expect((await dismiss(viewer, alarm!.id)).statusCode).toBe(403);
    expect((await dismiss(owner, alarm!.id, { 'x-test-api-key': '1' })).statusCode).toBe(403);
    expect((await dismiss(owner, 'aud_nothing')).statusCode).toBe(404);
    expect((await dismiss(owner, alarm!.id)).statusCode).toBe(204);
    expect(await alarms(owner)).toEqual([]);
    expect(await alarms(other)).toHaveLength(1);
  });

  it('reads one pay address everywhere: the one chosen, else the public address', async () => {
    const setup = async () => (await app.inject({ method: 'GET', url: '/api/v1/payments/setup', headers: asUser(owner) })).json().data;
    await settingsRepo(meta).set('system.publicOrigin', 'https://admin.crumbandco.test');
    let data = await setup();
    expect(data.reachability).toMatchObject({ state: 'reachable', origin: 'https://admin.crumbandco.test' });
    expect(data.services[0].test.webhookUrl).toBe('https://admin.crumbandco.test/api/v1/payments/webhook/payments-stripe/test');
    // A pay address chosen in Studio: the card reads it, and the webhooks point there.
    await paymentSettingsRepo(meta).set('pay-address', z.object({ origin: z.string() }).strict(), { origin: 'http://192.168.1.50:4600' });
    data = await setup();
    expect(data.reachability).toMatchObject({ state: 'private-network', origin: 'http://192.168.1.50:4600', notPort443: true });
    expect(data.services[0].test.webhookUrl).toBe('http://192.168.1.50:4600/api/v1/payments/webhook/payments-stripe/test');
  });

  it('clears "the webhook is not reaching this server" once an event arrives after the sweep caught a payment', async () => {
    const at = Date.now();
    await paymentSettingsRepo(meta).set(sweepDocName('payments-stripe', 'test'), sweepStateSchema, { cursor: null, lastRunAt: at, month: new Date(at).toISOString().slice(0, 7), reads: 1, caughtAt: at - 60_000, slowed: false, lastLookupAt: null });
    await paymentSettingsRepo(meta).set(webhookDocName('payments-stripe', 'test'), webhookHealthSchema, { firstAt: at - 120_000, lastAt: at - 120_000, lastBadAt: null, origin: null });
    const health = async () => (await app.inject({ method: 'GET', url: '/api/v1/payments/setup', headers: asUser(owner) })).json().data.services[0].test.health;
    expect((await health()).caughtAt).toBe(at - 60_000);
    await paymentSettingsRepo(meta).set(webhookDocName('payments-stripe', 'test'), webhookHealthSchema, { firstAt: at - 120_000, lastAt: at, lastBadAt: null, origin: null });
    expect(await health()).toMatchObject({ caughtAt: null, lastEventAt: at });
  });

  it('refuses a key that answers for the other mode', async () => {
    const saved = await app.inject({ method: 'PUT', url: field('test', 'secret_key'), headers: asUser(owner), payload: { value: 'rk_test_51Habcdefghijklmnopmode' } });
    expect(saved.json().data.test.check).toMatchObject({ ok: false, code: 'MODE_MISMATCH' });
    expect(saved.json().data.checklist.find((one: { step: string }) => one.step === 'test-key').done).toBe(false);
  });

  it('never writes back an old state over a Stop pressed while a Check runs', async () => {
    slowCheck = new Promise((resolve) => {
      releaseSlow = resolve;
    });
    const saving = app.inject({ method: 'PUT', url: field('test', 'secret_key'), headers: asUser(owner), payload: { value: 'rk_test_51Habcdefghijklmnopslow' } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const stop = await app.inject({ method: 'PUT', url: '/api/v1/payments/services/payments-stripe/stopped', headers: asUser(owner), payload: { stopped: true } });
    expect(stop.json().data.stopped).toBe(true);
    releaseSlow();
    const saved = await saving;
    expect(saved.json().data).toMatchObject({ stopped: true, test: { check: { ok: true } } });
    const read = (await app.inject({ method: 'GET', url: '/api/v1/payments/setup', headers: asUser(owner) })).json().data.services[0];
    expect(read.stopped).toBe(true);
    slowCheck = Promise.resolve();
  });

  it('gives the webhook address on the pay address once one is saved', async () => {
    await meta.db.insertInto('adminium_payment_settings').values({ name: 'pay-address', value: JSON.stringify({ origin: 'https://pay.crumbandco.test' }), updatedAt: 1 }).execute();
    const service = (await app.inject({ method: 'GET', url: '/api/v1/payments/setup', headers: asUser(owner) })).json().data.services[0];
    expect(service.test.webhookUrl).toBe('https://pay.crumbandco.test/api/v1/payments/webhook/payments-stripe/test');
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

  it('turns live payments on only with a live key that passed its Check, and ends the test links then', async () => {
    const live = '/api/v1/payments/services/payments-stripe/live';
    const refused = await app.inject({ method: 'PUT', url: live, headers: asUser(owner), payload: { on: true } });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error.details).toEqual({ reason: 'live-key' });
    await paymentLinksRepo(meta).mint({ tokenHash: 'h1', tokenSealed: 's1', payable: { kind: 'document', connectionId: null, tableName: null, rowKey: 'doc_1' }, mode: 'test', expiresAt: Date.now() + 9e6, createdBy: null });
    await app.inject({ method: 'PUT', url: field('live', 'secret_key'), headers: asUser(owner), payload: { value: 'rk_live_51Habcdefghijklmnop9xQ4' } });
    const on = await app.inject({ method: 'PUT', url: live, headers: asUser(owner), payload: { on: true } });
    expect(on.statusCode, on.payload).toBe(200);
    expect(on.json().data).toMatchObject({ liveOn: true });
    expect(await paymentLinksRepo(meta).currentFor({ kind: 'document', connectionId: null, tableName: null, rowKey: 'doc_1' })).toBeNull();
    const audited = await meta.db.selectFrom('adminium_audit_log').select(['action', 'changes']).where('action', '=', 'payments.service.live.on').execute();
    expect(audited).toHaveLength(1);
    expect((await app.inject({ method: 'PUT', url: live, headers: asUser(viewer), payload: { on: false } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: live, headers: asUser(owner), payload: { on: false } })).json().data.liveOn).toBe(false);
  });

  it('stops new payments, or removes the keys of both modes once waiting payments are owned up to, and tells the managers', async () => {
    const disconnect = '/api/v1/payments/services/payments-stripe/disconnect';
    await app.inject({ method: 'PUT', url: field('test', 'secret_key'), headers: asUser(owner), payload: { value: KEY } });
    await app.inject({ method: 'PUT', url: field('live', 'secret_key'), headers: asUser(owner), payload: { value: 'rk_live_51Habcdefghijklmnop9xQ4' } });
    const stop = await app.inject({ method: 'POST', url: disconnect, headers: asUser(owner), payload: { action: 'stop' } });
    expect(stop.json().data).toMatchObject({ stopped: true, waiting: 0 });
    const made = await paymentAttemptsRepo(meta).create({ provider: 'payments-stripe', mode: 'live', accountId: null, payable: { kind: 'document', connectionId: null, tableName: null, rowKey: 'doc_9' }, payableLabel: 'INV-9', amount: '1.00', currency: 'EUR', linkId: null, nonce: 'n'.repeat(22), createdBy: null });
    await paymentAttemptsRepo(meta).move(made!.id, 'open', {});
    const atBank = await paymentAttemptsRepo(meta).create({ provider: 'payments-stripe', mode: 'live', accountId: null, payable: { kind: 'document', connectionId: null, tableName: null, rowKey: 'doc_10' }, payableLabel: 'INV-10', amount: '2.00', currency: 'EUR', linkId: null, nonce: 'm'.repeat(22), createdBy: null });
    await paymentAttemptsRepo(meta).move(atBank!.id, 'open', {});
    await paymentAttemptsRepo(meta).move(atBank!.id, 'processing', {});
    // A checkout still open is ended first; one already at the bank is owned up to.
    const refused = await app.inject({ method: 'POST', url: disconnect, headers: asUser(owner), payload: { action: 'remove' } });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error.details).toEqual({ reason: 'waiting', waiting: 1 });
    expect((await paymentAttemptsRepo(meta).byId(made!.id))?.state).toBe('expired');
    const removed = await app.inject({ method: 'POST', url: disconnect, headers: asUser(owner), payload: { action: 'remove', settleByHand: true } });
    expect(removed.statusCode, removed.payload).toBe(200);
    expect(await paymentAttemptsRepo(meta).byId(atBank!.id)).toMatchObject({ state: 'expired', problem: { code: 'SETTLE_BY_HAND' } });
    expect(removed.json().data.test.fields.every((one: { set: boolean }) => !one.set)).toBe(true);
    expect(removed.json().data.live.fields.every((one: { set: boolean }) => !one.set)).toBe(true);
    expect(removed.json().data.live.accountId).toBe('acct_9xQ4');
    expect(await manifests.getCredential((await manifests.findByKey('payments-stripe'))!.row.id)).toBeNull();
    const notices = await notificationsRepo(meta).listForUser(owner.id, { limit: 10 });
    expect(notices.map((one) => [one.kind, one.title])).toContainEqual(['payments.keys-removed', 'The Stripe keys were removed']);
    expect((await app.inject({ method: 'POST', url: disconnect, headers: asUser(owner, { 'x-test-api-key': '1' }), payload: { action: 'stop' } })).statusCode).toBe(403);
  });
});
