// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Download the app template": the provider's own function stamps this
 * install's app id (made once, then always the same) and the shop's name, and
 * the answer is a zip of its files — for a signed-in person who may manage
 * payments; a provider without the function answers that it needs no app.
 */
import BetterSqlite3 from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { strFromU8, unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PAYMENT_PROVIDER_CONTRACT, PAYMENT_PROVIDER_VERSION } from '@adminium/add-on-contracts';
import { createSqliteMetaDb, firstRun, paymentSettingsRepo, rolesRepo, usersRepo, type MetaDb, type User } from '@adminium/meta';

import type { AddOnRuntimeState } from '../src/add-ons/runtime.js';
import { errorEnvelope } from '../src/errors.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { keyAppRoutes } from '../src/routes/payments/key-app.js';
import { PAY_PAGE_DOC, payPageSchema } from '../src/routes/payments/ways.js';

describe('the app template download', () => {
  let meta: MetaDb;
  let app: FastifyInstance;
  let owner: User;
  let viewer: User;
  const asked: { shopName: string; installId: string }[] = [];

  const runtime = {
    providers: new Map([
      [
        `${PAYMENT_PROVIDER_CONTRACT}@${String(PAYMENT_PROVIDER_VERSION)}`,
        [
          {
            addOnKey: 'payments-stripe',
            contract: PAYMENT_PROVIDER_CONTRACT,
            version: PAYMENT_PROVIDER_VERSION,
            module: {
              keyAppTemplate: (input: { shopName: string; installId: string }) => {
                asked.push(input);
                return { appId: `com.shop.payments.${input.installId}`, appName: `Payments for ${input.shopName}`, files: { 'stripe-app.json': `{"id":"com.shop.payments.${input.installId}"}`, 'README.md': '# Steps' } };
              },
            },
          },
          { addOnKey: 'payments-paypal', contract: PAYMENT_PROVIDER_CONTRACT, version: PAYMENT_PROVIDER_VERSION, module: {} },
        ],
      ],
    ]),
  } as unknown as AddOnRuntimeState;

  beforeEach(async () => {
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    await paymentSettingsRepo(meta).set(PAY_PAGE_DOC, payPageSchema, { shopName: 'Crumb & Co.', logoFileId: null, contactEmail: null, contactPhone: null, shopCountry: 'DE', showLines: false });
    const users = usersRepo(meta);
    const roles = rolesRepo(meta);
    owner = await users.create({ email: 'mara@adminium.test', name: 'Mara', status: 'active' });
    await roles.assignToUser(owner.id, (await roles.findBySlug('super-admin'))!.id);
    viewer = await users.create({ email: 'vic@adminium.test', name: 'Vic', status: 'active' });
    await roles.assignToUser(viewer.id, (await roles.findBySlug('viewer'))!.id);
    asked.length = 0;
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.setErrorHandler((error: { statusCode?: number; code?: string; message: string }, request, reply) => {
      void reply.status(error.statusCode ?? 500).send(errorEnvelope(error.code ?? 'INTERNAL', error.message, request.id));
    });
    app.addHook('onRequest', async (request) => {
      const id = request.headers['x-test-user-id'];
      if (typeof id !== 'string') return;
      const user = await users.findById(id);
      if (user !== null) (request as unknown as { user: object }).user = { id: user.id, name: user.name, email: user.email };
    });
    await app.register(rbacPlugin, { meta });
    await app.register(async (api) => api.register(keyAppRoutes({ meta, runtime: () => runtime })), { prefix: '/api/v1' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await meta.db.destroy();
  });

  const get = (key: string, user: User | null = owner) => app.inject({ method: 'GET', url: `/api/v1/payments/services/${key}/key-app`, headers: user === null ? {} : { 'x-test-user-id': user.id } });

  it('zips the files the provider stamps with this install\'s own id, the same id every time', async () => {
    const first = await get('payments-stripe');
    expect(first.statusCode, first.payload).toBe(200);
    expect(first.headers['content-type']).toBe('application/zip');
    const files = unzipSync(new Uint8Array(first.rawPayload));
    expect(Object.keys(files).sort()).toEqual(['README.md', 'stripe-app.json']);
    expect(asked[0]).toMatchObject({ shopName: 'Crumb & Co.' });
    expect(asked[0]!.installId).toMatch(/^[a-z0-9]{12}$/);
    expect(strFromU8(files['stripe-app.json']!)).toContain(asked[0]!.installId);
    expect(first.headers['content-disposition']).toBe(`attachment; filename="com.shop.payments.${asked[0]!.installId}.zip"`);
    await get('payments-stripe');
    expect(asked[1]!.installId).toBe(asked[0]!.installId);
  });

  it('answers that a service without an app makes its key without one, and refuses anyone who may not manage payments', async () => {
    expect((await get('payments-paypal')).statusCode).toBe(404);
    expect((await get('payments-stripe', viewer)).statusCode).toBe(403);
    expect((await get('payments-stripe', null)).statusCode).toBe(401);
  });
});
