// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Studio → Payments, setting up a card reader service with no pay page (an
 * add-on providing `card-terminal@1` alone, such as Card readers for Square):
 * it is listed beside the payment services, its token is saved like any key,
 * its Check is the card reader service's own, it has no webhook, no pay page
 * and no live switch (each reader is paired in its mode), and it may be
 * connected on the desktop app, since a reader is asked outbound.
 */
import BetterSqlite3 from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { providerError, type CardTerminal, type PaymentProviderContext } from '@adminium/add-on-contracts';
import { createSqliteMetaDb, firstRun, manifestsRepo, rolesRepo, usersRepo, type ManifestsRepo, type MetaDb, type User } from '@adminium/meta';

import { addOnCredentialCryptoFromSecret } from '../src/add-ons/credential-crypto.js';
import type { AddOnRuntimeState } from '../src/add-ons/runtime.js';
import { errorEnvelope } from '../src/errors.js';
import { modeCredentials } from '../src/payments/credentials.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { paymentsRoutes } from '../src/routes/payments/index.js';

const TOKEN = 'EAAAtestTokenForReadersOnly0001';

const MANIFEST = {
  kind: 'add-on',
  manifestVersion: 1,
  key: 'payments-square',
  name: 'Card readers',
  version: '1.0.28',
  publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
  license: 'AGPL-3.0-only',
  description: { key: 'addon.payments-square.line', fallback: 'Connects to Square.' },
  categories: ['payments'],
  compatibility: { minAdminiumVersion: '0.3.60', requires: ['outbound-http'] },
  capabilities: ['outbound-http'],
  addOn: {
    attaches: [{ app: '*' }],
    provides: [{ contract: 'card-terminal', version: 1, server: 'dist/server.js' }],
    connect: { kind: 'api-key' },
    network: { allow: ['connect.squareupsandbox.com', 'connect.squareup.com'] },
    publicSettings: [],
  },
  settings: [{ key: 'access_token', type: 'string', secret: true, label: { key: 'k', fallback: 'Access token' } }],
};

/** A card reader service whose account is named by the token's last four. */
function fakeTerminal(context: PaymentProviderContext): CardTerminal {
  const token = context.credentials['access_token'] ?? '';
  const refuse = async () => providerError('UNAVAILABLE', 'not in this test');
  return {
    key: 'payments-square',
    mode: context.mode,
    checkCredentials: async () => (token.endsWith('dead') ? providerError('CREDENTIALS_REFUSED', `Square refused ${token}.`) : { ok: true, accountId: `ML${token.slice(-4)}`, livemode: context.mode === 'live', missing: [] }),
    listLocations: refuse,
    listReaders: refuse,
    startPairing: refuse,
    finishPairing: refuse,
    unpairReader: refuse,
    sendToReader: refuse,
    readerStatus: refuse,
    cancelOnReader: refuse,
    refund: refuse,
    refundStatus: refuse,
    listEvents: refuse,
    toMinor: () => providerError('UNAVAILABLE', 'not in this test'),
    fromMinor: () => providerError('UNAVAILABLE', 'not in this test'),
  };
}

const runtime: AddOnRuntimeState = {
  providers: new Map([['card-terminal@1', [{ addOnKey: 'payments-square', contract: 'card-terminal', version: 1, module: { createCardTerminal: fakeTerminal } }]]]),
  slots: new Map(),
  conflicts: [],
  problems: [],
  deciders: new Map(),
};

describe('payments setup routes: a card reader service', () => {
  let meta: MetaDb;
  let manifests: ManifestsRepo;
  let app: FastifyInstance;
  let owner: User;
  let desktop = false;

  const asUser = (user: User) => ({ 'x-test-user-id': user.id });
  const field = (mode: string) => `/api/v1/payments/services/payments-square/modes/${mode}/fields/access_token`;

  async function start(): Promise<void> {
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.setErrorHandler((error: { statusCode?: number; code?: string; message: string; details?: unknown }, request, reply) => {
      void reply.status(error.statusCode ?? 500).send(errorEnvelope(error.code ?? 'INTERNAL', error.message, request.id, error.details));
    });
    const users = usersRepo(meta);
    app.addHook('onRequest', async (request) => {
      const id = request.headers['x-test-user-id'];
      if (typeof id === 'string') {
        const user = await users.findById(id);
        if (user !== null) (request as unknown as { user: object }).user = { id: user.id, name: user.name, email: user.email };
      }
    });
    await app.register(rbacPlugin, { meta });
    await app.register(
      async (api) => {
        await api.register(paymentsRoutes({ meta, manifests, runtime: () => runtime, networkFeatures: true, desktop, trustProxy: false }));
      },
      { prefix: '/api/v1' },
    );
    await app.ready();
  }

  beforeEach(async () => {
    desktop = false;
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    manifests = manifestsRepo(meta, addOnCredentialCryptoFromSecret('a-test-secret-that-is-long-enough-000'));
    await manifests.install({ manifestKey: 'payments-square', version: '1.0.28', kind: 'add-on', source: 'file', document: MANIFEST });
    const roles = rolesRepo(meta);
    const superAdmin = await roles.findBySlug('super-admin');
    if (superAdmin === null) throw new Error('missing built-in roles');
    owner = await usersRepo(meta).create({ email: 'mara@adminium.test', name: 'Mara', status: 'active' });
    await roles.assignToUser(owner.id, superAdmin.id);
    await start();
  });

  afterEach(async () => {
    await app.close();
    await meta.db.destroy();
  });

  it('lists it as a reader service: no webhook, no pay page, two keys to save', async () => {
    const data = (await app.inject({ method: 'GET', url: '/api/v1/payments/setup', headers: asUser(owner) })).json().data;
    expect(data.services).toHaveLength(1);
    const service = data.services[0];
    expect(service).toMatchObject({ key: 'payments-square', name: 'Card readers', loaded: true, readersOnly: true, hasPaths: false, webhookEvents: [] });
    expect(service.test.webhookUrl).toBeNull();
    expect(service.live.webhookUrl).toBeNull();
    expect(service.checklist).toEqual([
      { step: 'test-key', done: false },
      { step: 'live-key', done: false },
    ]);
  });

  it("saves the token encrypted and asks the card reader service's own Check", async () => {
    const saved = await app.inject({ method: 'PUT', url: field('test'), headers: asUser(owner), payload: { value: TOKEN } });
    expect(saved.statusCode).toBe(200);
    const view = saved.json().data;
    expect(view.test.check).toMatchObject({ ok: true, missing: [] });
    expect(view.test.accountId).toBe('ML0001');
    expect(view.checklist).toEqual([
      { step: 'test-key', done: true },
      { step: 'live-key', done: false },
    ]);
    const installed = (await manifests.listByKey('payments-square'))[0]!;
    expect(modeCredentials(await manifests.getCredential(installed.row.id), 'test')).toEqual({ access_token: TOKEN });
    expect(JSON.stringify(saved.json())).not.toContain(TOKEN);
  });

  it('keeps a refused token saved, records the refusal, and never repeats the token in it', async () => {
    const saved = await app.inject({ method: 'PUT', url: field('test'), headers: asUser(owner), payload: { value: 'EAAAtestTokenForReadersOnlydead' } });
    const check = saved.json().data.test.check;
    expect(check).toMatchObject({ ok: false, code: 'CREDENTIALS_REFUSED' });
    expect(JSON.stringify(check)).not.toContain('EAAAtestTokenForReadersOnlydead');
  });

  it('has no live switch: each reader is paired in test or live mode', async () => {
    const refused = await app.inject({ method: 'PUT', url: '/api/v1/payments/services/payments-square/live', headers: asUser(owner), payload: { on: true } });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error.details).toEqual({ reason: 'readers-only' });
  });

  it('may be connected on the desktop app, where a pay page may not', async () => {
    await app.close();
    desktop = true;
    await start();
    const saved = await app.inject({ method: 'PUT', url: field('test'), headers: asUser(owner), payload: { value: TOKEN } });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().data.test.check.ok).toBe(true);
  });
});
