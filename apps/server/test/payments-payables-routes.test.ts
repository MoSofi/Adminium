// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Studio → Payments → What can be paid, over a real SQLite table: a mapping
 * checked with a live preview of three rows, a table marked payable only by
 * someone who may manage payments AND read and update every row of it, and
 * the marks audited.
 */
import BetterSqlite3 from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { Kysely, SqliteDialect } from 'kysely';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseDatabaseModel } from '@adminium/engine';
import {
  connectionsRepo,
  createSqliteMetaDb,
  firstRun,
  permissionsRepo,
  rolesRepo,
  snapshotsRepo,
  usersRepo,
  type MetaDb,
  type PayableMapping,
  type User,
} from '@adminium/meta';

import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { errorEnvelope } from '../src/errors.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { paymentPayablesRoutes } from '../src/routes/payments/payables.js';
import { TEST_SECRET } from './helpers.js';

const MODEL = parseDatabaseModel({
  irVersion: 1,
  dialect: 'sqlite',
  name: 'shop',
  defaultSchema: 'main',
  tables: [
    {
      schema: 'main',
      name: 'orders',
      columns: [
        { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
        { name: 'number', logicalType: 'text', nullable: false },
        { name: 'total', logicalType: 'decimal', numericScale: 2, nullable: false },
        { name: 'currency', logicalType: 'text', nullable: false },
        { name: 'email', logicalType: 'text', semantics: { primary: 'email', flags: { pii: 'email', secret: false, maskedByDefault: true }, confidence: 1 } },
      ],
      primaryKey: ['id'],
    },
  ],
});

const MAPPING: PayableMapping = {
  label: 'number',
  amount: { column: 'total', unit: null },
  currency: { column: 'currency' },
  due: null,
  payments: { kind: 'kept' },
  status: null,
  customerEmail: 'email',
  customerCountry: null,
  pageFields: ['number'],
};

describe('payables routes', () => {
  let meta: MetaDb;
  let source: Kysely<never>;
  let app: FastifyInstance;
  let connectionId: string;
  let owner: User;
  let clerk: User;
  let limited: User;

  const asUser = (user: User) => ({ 'x-test-user-id': user.id });
  const body = (mapping: Partial<PayableMapping> = {}) => ({ connectionId, tableId: 'main.orders', mapping: { ...MAPPING, ...mapping } });

  beforeEach(async () => {
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    const raw = new BetterSqlite3(':memory:');
    raw.exec("CREATE TABLE orders (id INTEGER PRIMARY KEY, number TEXT NOT NULL, total NUMERIC(10,2) NOT NULL, currency TEXT NOT NULL, email TEXT)");
    raw.exec("INSERT INTO orders VALUES (1, 'ORD-1', '120.00', 'EUR', 'lena@example.test'), (2, 'ORD-2', '45.50', 'EUR', null), (3, 'ORD-3', '12000', 'JPY', null), (4, 'ORD-4', '1.00', 'EUR', null)");
    source = new Kysely<never>({ dialect: new SqliteDialect({ database: raw }) });

    const connection = await connectionsRepo(meta, dsnCryptoFromSecret(TEST_SECRET)).create({ name: 'Shop', engine: 'sqlite', introspectDsn: 'sqlite::memory:' });
    connectionId = connection.id;
    await snapshotsRepo(meta).create({ connectionId, source: 'introspection', schema: MODEL, checksum: 'sha-orders-1' });

    const users = usersRepo(meta);
    const roles = rolesRepo(meta);
    const superAdmin = await roles.findBySlug('super-admin');
    if (superAdmin === null) throw new Error('missing built-in roles');
    owner = await users.create({ email: 'mara@adminium.test', name: 'Mara', status: 'active' });
    await roles.assignToUser(owner.id, superAdmin.id);

    // A clerk who may manage payments and read the table, but not update it.
    const clerkRole = await roles.create({ slug: 'clerk', name: 'Clerk' });
    await permissionsRepo(meta).grant(clerkRole.id, 'system', 'payments.manage', { allowed: true });
    await permissionsRepo(meta).grant(clerkRole.id, 'table', `${connectionId}/main.orders`, { read: true, create: false, update: false, delete: false, export: false, import: false });
    clerk = await users.create({ email: 'tom@adminium.test', name: 'Tom', status: 'active' });
    await roles.assignToUser(clerk.id, clerkRole.id);

    // A seller who may manage payments and update, but reads only their own rows.
    const sellerRole = await roles.create({ slug: 'seller', name: 'Seller' });
    await permissionsRepo(meta).grant(sellerRole.id, 'system', 'payments.manage', { allowed: true });
    await permissionsRepo(meta).grant(sellerRole.id, 'table', `${connectionId}/main.orders`, {
      read: true,
      create: false,
      update: true,
      delete: false,
      export: false,
      import: false,
      rowLimit: { read: { reach: 'own' } },
    });
    limited = await users.create({ email: 'ines@adminium.test', name: 'Ines', status: 'active' });
    await roles.assignToUser(limited.id, sellerRole.id);

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
      async (api) => {
        await api.register(paymentPayablesRoutes({ meta, manager: { data: async () => ({ db: source as never, dialect: 'sqlite', engine: null as never }) } }));
      },
      { prefix: '/api/v1' },
    );
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await source.destroy();
    await meta.db.destroy();
  });

  it('checks a mapping and previews three real rows as the pay page would read them', async () => {
    const checked = await app.inject({ method: 'POST', url: '/api/v1/payments/payables/check', headers: asUser(owner), payload: body() });
    expect(checked.statusCode, checked.payload).toBe(200);
    const data = checked.json().data;
    expect(data.issues).toEqual([]);
    expect(data.mayMark).toEqual({ ok: true, reason: null });
    expect(data.preview.map((row: { label: string; due: string; currency: string }) => `${row.label} ${row.due} ${row.currency}`)).toEqual(['ORD-1 120.00 EUR', 'ORD-2 45.50 EUR', 'ORD-3 12000 JPY']);
  });

  it('finds a personal column on the pay page, and previews nothing until it is fixed', async () => {
    const checked = await app.inject({ method: 'POST', url: '/api/v1/payments/payables/check', headers: asUser(owner), payload: body({ pageFields: ['number', 'email'] }) });
    expect(checked.json().data.issues).toEqual([{ code: 'FIELD_PERSONAL', path: 'pageFields', column: 'email' }]);
    expect(checked.json().data.preview).toEqual([]);
  });

  it('marks a table payable once, lists it, and audits it', async () => {
    const made = await app.inject({ method: 'POST', url: '/api/v1/payments/payables', headers: asUser(owner), payload: body() });
    expect(made.statusCode, made.payload).toBe(201);
    expect(made.json().data).toMatchObject({ tableName: 'main.orders', enabled: true, valid: true, payments: 'kept' });
    expect((await app.inject({ method: 'POST', url: '/api/v1/payments/payables', headers: asUser(owner), payload: body() })).statusCode).toBe(409);
    const listed = await app.inject({ method: 'GET', url: '/api/v1/payments/payables', headers: asUser(owner) });
    expect(listed.json().data.profiles).toHaveLength(1);

    const id = made.json().data.id as string;
    expect((await app.inject({ method: 'PATCH', url: `/api/v1/payments/payables/${id}`, headers: asUser(owner), payload: { enabled: false } })).json().data.enabled).toBe(false);
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/payments/payables/${id}`, headers: asUser(owner) })).statusCode).toBe(204);
    const actions = await meta.db.selectFrom('adminium_audit_log').select('action').where('category', '=', 'payments').execute();
    expect(actions.map((row) => row.action)).toEqual(['payments.payable.marked', 'payments.payable.paused', 'payments.payable.stopped']);
  });

  it('refuses a mapping with a problem, naming every one', async () => {
    const refused = await app.inject({ method: 'POST', url: '/api/v1/payments/payables', headers: asUser(owner), payload: body({ pageFields: ['email'], label: 'nope' }) });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error.details.issues.map((one: { code: string }) => one.code)).toEqual(['FIELD_PERSONAL', 'NO_SUCH_COLUMN']);
  });

  it('never lets someone who may not update the table make it payable', async () => {
    const refused = await app.inject({ method: 'POST', url: '/api/v1/payments/payables', headers: asUser(clerk), payload: body() });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.details).toEqual({ reason: 'update' });
  });

  it('never lets someone who reads only some rows make every row payable', async () => {
    const checked = await app.inject({ method: 'POST', url: '/api/v1/payments/payables/check', headers: asUser(limited), payload: body() });
    expect(checked.json().data.mayMark).toEqual({ ok: false, reason: 'row-limit' });
    const refused = await app.inject({ method: 'POST', url: '/api/v1/payments/payables', headers: asUser(limited), payload: body() });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.details).toEqual({ reason: 'row-limit' });
  });
});
