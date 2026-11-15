// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The card reader routes, as the roles, on SQLite, Postgres and MySQL: the
 * owner pairs the demo reader in Studio (the code the reader shows, typed
 * in), names and unpairs it; a cashier who may add a payment on the till's
 * payments table puts a ticket's amount on the reader, follows it and takes
 * it off again; someone who may only read tickets is refused the charge;
 * Studio's pairing is the payment managers' alone.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createDemoTerminalBackend, type DemoTerminalBackend } from '@adminium/add-on-contracts';
import { permissionsRepo, rolesRepo, usersRepo, type User } from '@adminium/meta';

import { errorEnvelope } from '../src/errors.js';
import { createPayableSources } from '../src/payments/payables.js';
import { cardTerminalFor } from '../src/payments/terminals.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { DEMO_READER_SERVICE, paymentTerminalRoutes } from '../src/routes/payments/terminal.js';
import { installInvoicing, invoicingManifest, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.60' }));

type Doc = Record<string, unknown>;
const id = { ref: 'id', type: 'int', role: 'pk' };
const money = (ref: string) => ({ ref, type: 'decimal', scale: 2, default: 0 });

function till(): Doc {
  const m = invoicingManifest([
    { ref: 'tickets', columns: [id, { ref: 'number', type: 'text', maxLength: 40, nullable: true }, money('total'), money('balance')] },
    {
      ref: 'ticket_payments',
      columns: [
        id,
        { ref: 'ticket_id', type: 'fk', references: 'tickets' },
        money('amount'),
        money('tip'),
        { ref: 'method', type: 'enum', enum: ['cash', 'card'], default: 'cash' },
        { ref: 'payment_ref', type: 'text', maxLength: 64, nullable: true, unique: true },
        { ref: 'approval_code', type: 'text', maxLength: 32, nullable: true },
        { ref: 'last4', type: 'text', maxLength: 4, nullable: true },
        { ref: 'paid_at', type: 'timestamptz', nullable: true },
      ],
    },
  ]);
  m['key'] = 'till';
  m['compatibility'] = { minAdminiumVersion: '0.3.60' };
  (m['pages'] as { bindings: Record<string, string> }[])[0]!.bindings = { rows: 'tickets' };
  m['payments'] = {
    payables: [
      {
        table: 'tickets',
        label: 'number',
        amount: { column: 'total' },
        currency: { fixed: 'EUR' },
        due: { column: 'balance' },
        payments: { kind: 'table', table: 'ticket_payments', link: 'ticket_id', amount: 'amount', paidAt: 'paid_at', method: { column: 'method', values: { card: 'card', '*': 'card' } }, reference: 'payment_ref', approvalCode: 'approval_code', last4: 'last4', tip: 'tip' },
      },
    ],
  };
  return m;
}

describe.each(LEGS)('the card reader routes — %s', (dialect, available) => {
  let h: InvoicingHarness;
  let app: FastifyInstance;
  let backend: DemoTerminalBackend;
  let owner: User;
  let cashier: User;
  let viewer: User;
  let ticketsId: string;

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, till());
    const w = await writerFor(h);
    ticketsId = w.targetOf('tickets').table.id;
    const paymentsId = w.targetOf('ticket_payments').table.id;
    await h.rows(`insert into ${h.real('tickets')} (id, number, total, balance) values (1, 'T-1', 8.00, 8.00)`);
    const users = usersRepo(h.meta);
    const roles = rolesRepo(h.meta);
    owner = await users.create({ email: `mara-${dialect}@adminium.test`, name: 'Mara', status: 'active' });
    await roles.assignToUser(owner.id, (await roles.findBySlug('super-admin'))!.id);
    const role = async (slug: string, create: boolean): Promise<User> => {
      const made = await roles.create({ slug: `${slug}-${dialect}`, name: slug });
      await permissionsRepo(h.meta).grant(made.id, 'table', `${h.connectionId}/${ticketsId}`, { read: true, create: false, update: false, delete: false, export: false, import: false } as never);
      await permissionsRepo(h.meta).grant(made.id, 'table', `${h.connectionId}/${paymentsId}`, { read: true, create, update: false, delete: false, export: false, import: false } as never);
      const user = await users.create({ email: `${slug}-${dialect}@adminium.test`, name: slug, status: 'active' });
      await roles.assignToUser(user.id, made.id);
      return user;
    };
    cashier = await role('cashier', true);
    viewer = await role('viewer', false);
    backend = createDemoTerminalBackend();
    const sources = createPayableSources({ meta: h.meta, manager: h.manager });
    const none = { findInScope: async () => null, listByKey: async () => [], getCredential: async () => null };
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.setErrorHandler((error: { statusCode?: number; code?: string; message: string; details?: unknown }, request, reply) => {
      void reply.status(error.statusCode ?? 500).send(errorEnvelope(error.code ?? 'INTERNAL', error.message, request.id, error.details));
    });
    app.addHook('onRequest', async (request) => {
      const userId = request.headers['x-test-user-id'];
      if (typeof userId !== 'string') return;
      const user = await users.findById(userId);
      if (user !== null) (request as unknown as { user: object }).user = { id: user.id, name: user.name, email: user.email };
    });
    await app.register(rbacPlugin, { meta: h.meta });
    await app.register(
      async (api) =>
        api.register(
          paymentTerminalRoutes({
            meta: h.meta,
            sources,
            terminalFor: (key, mode) => cardTerminalFor({ runtime: () => null, manifests: none, httpFor: () => (async () => ({ status: 500, headers: {}, body: '' })) as never, demoTerminal: backend }, key, mode),
            enqueue: async () => undefined,
            services: async () => [DEMO_READER_SERVICE],
            networkFeatures: true,
          }),
        ),
      { prefix: '/api/v1' },
    );
    await app.ready();
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await app.close();
    await h.close();
  });

  const as = (user: User, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
    app.inject({ method, url: `/api/v1${url}`, headers: { 'x-test-user-id': user.id }, ...(payload === undefined ? {} : { payload: payload as never }) });

  it.skipIf(!available)('pairs, names and unpairs a reader in Studio, for payment managers alone; a cashier charges, follows and cancels', async () => {
    expect((await as(cashier, 'GET', '/payments/readers')).statusCode).toBe(403);
    const services = await as(owner, 'GET', '/payments/readers');
    expect(services.json().data).toEqual({ readers: [], services: [DEMO_READER_SERVICE] });
    // The locations a reader may be paired at, for payment managers alone.
    expect((await as(cashier, 'GET', '/payments/readers/locations?provider=demo-reader&mode=test')).statusCode).toBe(403);
    const locations = await as(owner, 'GET', '/payments/readers/locations?provider=demo-reader&mode=test');
    expect(locations.statusCode, locations.body).toBe(200);
    expect(Array.isArray(locations.json().data)).toBe(true);
    expect((await as(owner, 'GET', '/payments/readers/locations?provider=payments-nope&mode=test')).statusCode).toBe(422);
    const started = await as(owner, 'POST', '/payments/readers/pairing', { provider: 'demo-reader', mode: 'test', label: 'Counter' });
    expect(started.statusCode, started.body).toBe(200);
    expect(started.json().data).toMatchObject({ way: 'enter', code: null });
    const pairing = started.json().data.pairing as string;
    const finished = await as(owner, 'POST', '/payments/readers/pairing/finish', { provider: 'demo-reader', mode: 'test', label: 'Counter', pairing, code: backend.codeOn(pairing) });
    expect(finished.statusCode, finished.body).toBe(200);
    const reader = finished.json().data.reader as { id: string; label: string };
    expect(reader.label).toBe('Counter');
    expect((await as(owner, 'PATCH', `/payments/readers/${reader.id}`, { label: 'Front counter' })).json().data.label).toBe('Front counter');
    // The tills read the paired readers.
    expect((await as(cashier, 'GET', '/payments/terminal/readers')).json().data.map((one: { label: string }) => one.label)).toEqual(['Front counter']);

    // Someone who may only read tickets takes no payment.
    const refused = await as(viewer, 'POST', '/payments/terminal/charge', { connectionId: h.connectionId, table: ticketsId, recordId: '1', readerId: reader.id });
    expect(refused.statusCode, refused.body).toBe(403);
    const charged = await as(cashier, 'POST', '/payments/terminal/charge', { connectionId: h.connectionId, table: ticketsId, recordId: '1', readerId: reader.id });
    expect(charged.statusCode, charged.body).toBe(200);
    expect(charged.json().data).toMatchObject({ state: 'on_reader', amount: '8.00', currency: 'EUR' });
    const attemptId = charged.json().data.attemptId as string;
    expect((await as(cashier, 'GET', `/payments/terminal/charges/${attemptId}`)).json().data.state).toBe('on_reader');
    expect((await as(viewer, 'GET', `/payments/terminal/charges/${attemptId}`)).statusCode).toBe(200);
    const cancelled = await as(cashier, 'POST', `/payments/terminal/charges/${attemptId}/cancel`);
    expect(cancelled.json().data.state).toBe('cancelled');

    expect((await as(owner, 'DELETE', `/payments/readers/${reader.id}`)).statusCode).toBe(204);
    expect((await as(owner, 'GET', '/payments/readers')).json().data.readers).toEqual([]);
  });
});
