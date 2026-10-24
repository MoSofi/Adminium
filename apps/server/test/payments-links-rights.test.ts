// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Who may make a pay link, at its edges: a record whose row limits cannot be
 * worked out is refused rather than read whole, and a link is refused while
 * requests come through a proxy whose word the server does not trust (every
 * customer would share the proxy's address, and one could lock out all).
 */
import BetterSqlite3 from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createSqliteMetaDb, firstRun, paymentSettingsRepo, rolesRepo, settingsRepo, usersRepo, type MetaDb, type User } from '@adminium/meta';

import { errorEnvelope } from '../src/errors.js';
import { recentAlarms } from '../src/payments/alarms.js';
import { PAY_ADDRESS_DOC, payAddressSchema } from '../src/payments/links.js';
import type { PayableSources } from '../src/payments/payables.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { paymentLinksRoutes } from '../src/routes/payments/links.js';
import { TEST_SECRET } from './helpers.js';

const PAY = 'https://pay.crumbandco.test';

describe('who may make a pay link', () => {
  /** Whether live payments are on: a live link needs an address customers reach, a test link does not. */
  let live = true;
  let meta: MetaDb;
  let app: FastifyInstance;
  let owner: User;
  let rowsRead: number;

  beforeEach(async () => {
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    await paymentSettingsRepo(meta).set(PAY_ADDRESS_DOC, payAddressSchema, { origin: PAY });
    rowsRead = 0;
    const users = usersRepo(meta);
    owner = await users.create({ email: 'mara@adminium.test', name: 'Mara', status: 'active' });
    await rolesRepo(meta).assignToUser(owner.id, (await rolesRepo(meta).findBySlug('super-admin'))!.id);
    const db = {
      selectFrom: () => {
        rowsRead += 1;
        throw new Error('the row must not be read');
      },
    };
    const sources = {
      table: async () => ({ table: { id: 'public.orders', primaryKey: ['id'], columns: new Map() }, target: { db } }),
      document: async () => ({ status: 'sent', number: 'INV-0042', currency: 'EUR', totalMinor: 12000 }),
      keptPaid: async () => '0',
    } as unknown as PayableSources;

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
    await app.register(
      async (api) =>
        api.register(
          paymentLinksRoutes({ meta, manager: { data: async () => { throw new Error('no table here'); } } as never, sources, secret: TEST_SECRET, networkFeatures: true, desktop: false, trustProxy: false, liveOn: async () => live }),
        ),
      { prefix: '/api/v1' },
    );
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await meta.db.destroy();
  });

  const post = (payload: object, headers: Record<string, string> = {}) =>
    app.inject({ method: 'POST', url: '/api/v1/payments/links', headers: { 'x-test-user-id': owner.id, origin: PAY, ...headers }, payload });

  it("refuses a table's record when the connection's view cannot be built, and never reads the row whole", async () => {
    const answer = await post({ kind: 'profile', connectionId: 'conn_gone', tableName: 'public.orders', rowKey: '7' });
    expect(answer.statusCode).toBe(403);
    expect(answer.json().error.code).toBe('TABLE_FORBIDDEN');
    expect(answer.json().error.message).toMatch(/cannot be worked out/);
    expect(rowsRead).toBe(0);
  });

  it('refuses a live link while requests come through a proxy the server does not trust; a test link is staff\'s own', async () => {
    const answer = await post({ kind: 'document', connectionId: null, tableName: null, rowKey: 'doc_1' }, { 'x-forwarded-for': '203.0.113.9' });
    expect(answer.statusCode).toBe(422);
    expect(answer.json().error.details.reason).toBe('proxy-hidden');
    expect((await post({ kind: 'document', connectionId: null, tableName: null, rowKey: 'doc_1' })).statusCode).toBe(200);
    live = false;
    expect((await post({ kind: 'document', connectionId: null, tableName: null, rowKey: 'doc_1' }, { 'x-forwarded-for': '203.0.113.9' })).statusCode).toBe(200);
    live = true;
  });

  it('raises no alarm for a first pay address saved as the one already in use', async () => {
    await settingsRepo(meta).set('system.publicOrigin', 'https://admin.crumbandco.test');
    await meta.db.deleteFrom('adminium_payment_settings').where('name', '=', 'pay-address').execute();
    const saved = await app.inject({ method: 'PUT', url: '/api/v1/payments/pay-address', headers: { 'x-test-user-id': owner.id, origin: PAY }, payload: { origin: 'https://admin.crumbandco.test' } });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(await recentAlarms(meta, Date.now() + 1000)).toEqual([]);
    expect(await meta.db.selectFrom('adminium_notifications').select('id').where('kind', '=', 'payments.money-redirect').execute()).toEqual([]);
  });

  it('names which pay address is the staff one', async () => {
    await settingsRepo(meta).set('system.publicOrigin', 'https://admin.crumbandco.test');
    const read = (await app.inject({ method: 'GET', url: '/api/v1/payments/pay-address', headers: { 'x-test-user-id': owner.id } })).json().data;
    expect(read.staffOrigin).toBe('https://admin.crumbandco.test');
    expect(read.choices).toContain('https://admin.crumbandco.test');
    const saved = await app.inject({ method: 'PUT', url: '/api/v1/payments/pay-address', headers: { 'x-test-user-id': owner.id, origin: PAY }, payload: { origin: 'https://admin.crumbandco.test' } });
    expect(saved.json().data.staffOrigin).toBe('https://admin.crumbandco.test');
  });
});
