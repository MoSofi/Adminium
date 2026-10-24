// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The record page's Payment panel, on every engine, over an invoicing app
 * installed for real: its invoices payable into their own payments table (a
 * unique reference), and a deposits table whose payments Adminium keeps.
 *
 * As the roles: the owner and a clerk who may change invoices (and holds no
 * payment permission) both record by hand; a reader sees the panel and no
 * action, and is refused a write. A payment recorded by hand goes into the
 * invoice's own payments as the person, once per key, never past the due and
 * never with a card number in its text.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { keptPaymentsRepo, payableProfilesRepo, permissionsRepo, rolesRepo, settingsRepo, usersRepo, type PayableMapping, type User } from '@adminium/meta';

import { errorEnvelope } from '../src/errors.js';
import { holdsCardNumber, passesLuhn } from '../src/payments/card-number.js';
import { createPayableSources } from '../src/payments/payables.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { paymentPanelRoutes } from '../src/routes/payments/panel.js';
import { installInvoicing, invoicingManifest, invoicingTables, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';

type Writer = Awaited<ReturnType<typeof writerFor>>;

function tables(): Record<string, unknown>[] {
  const all = invoicingTables().map((table) =>
    (table as { ref: string }).ref === 'payments'
      ? {
          ...table,
          columns: [
            ...((table as { columns: unknown[] }).columns),
            { ref: 'payment_ref', type: 'text', maxLength: 64, nullable: true, unique: true },
            { ref: 'method', type: 'text', maxLength: 40, nullable: true },
            { ref: 'method_note', type: 'text', maxLength: 120, nullable: true },
            { ref: 'paid_on', type: 'date', nullable: true },
          ],
        }
      : table,
  );
  all.push({
    ref: 'deposits',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'label', type: 'text', maxLength: 40, nullable: true },
      { ref: 'amount', type: 'decimal', scale: 2 },
      { ref: 'currency', type: 'text', maxLength: 3, nullable: true },
      { ref: 'status', type: 'enum', enum: ['open', 'paid', 'refunded'], default: 'open' },
    ],
  });
  return all;
}

describe('the luhn check behind every payment text', () => {
  it('finds a full card number however it is spaced, and nothing that only looks long', () => {
    expect(passesLuhn('4242424242424242')).toBe(true);
    expect(holdsCardNumber('Paid with card 4242 4242 4242 4242')).toBe(true);
    expect(holdsCardNumber('4242-4242-4242-4242')).toBe(true);
    expect(holdsCardNumber('Amex 378282246310005 at the till')).toBe(true);
    // An IBAN's digits run past 19; a phone number fails the check; the last four alone is fine.
    expect(holdsCardNumber('DE89 3704 0044 0532 0130 00')).toBe(false);
    expect(holdsCardNumber('Call +49 30 1234 5678 9013')).toBe(false);
    expect(holdsCardNumber('Visa ending 4242, approval A7K29Q')).toBe(false);
    expect(holdsCardNumber('4242424242424241')).toBe(false);
    expect(holdsCardNumber(null)).toBe(false);
    // A number followed by more digits in the same run, or printed with dots, is still found.
    expect(holdsCardNumber('4242424242424242 12/27')).toBe(true);
    expect(holdsCardNumber('paid 4242 4242 4242 4242 1227')).toBe(true);
    expect(holdsCardNumber('4242.4242.4242.4242')).toBe(true);
  });
});

describe.each(LEGS)('the Payment panel — %s', (dialect, available) => {
  let h: InvoicingHarness;
  let w: Writer;
  let app: FastifyInstance;
  let owner: User;
  let clerk: User;
  let reader: User;
  let client: Record<string, unknown>;
  let invoicesId: string;
  let depositsId: string;
  let n = 0;

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, invoicingManifest(tables()));
    await h.meta.db.updateTable('adminium_connections').set({ currency: 'EUR' } as never).where('id', '=', h.connectionId).execute();
    w = await writerFor(h);
    await w.create('settings', { tax_rate: 0 });
    client = await w.create('clients', { email: 'lena@example.com', name: 'Lena Fischer' });
    invoicesId = w.targetOf('invoices').table.id;
    depositsId = w.targetOf('deposits').table.id;
    const invoiceMapping: PayableMapping = {
      label: 'number',
      amount: { column: 'total', unit: null },
      currency: { column: 'currency' },
      due: { column: 'balance' },
      payments: {
        kind: 'table',
        table: w.targetOf('payments').table.id,
        link: 'invoice_id',
        amount: 'amount',
        date: 'paid_on',
        method: { column: 'method', values: { card: 'card', '*': 'online' } },
        note: 'method_note',
        voided: 'voided',
        reference: 'payment_ref',
      },
      status: null,
      customerEmail: null,
      customerCountry: null,
      pageFields: ['number'],
    };
    await payableProfilesRepo(h.meta).create({ connectionId: h.connectionId, tableName: invoicesId, mapping: invoiceMapping, ownerApp: null, createdBy: null });
    await payableProfilesRepo(h.meta).create({
      connectionId: h.connectionId,
      tableName: depositsId,
      mapping: {
        label: 'label',
        amount: { column: 'amount', unit: null },
        currency: { column: 'currency' },
        due: null,
        payments: { kind: 'kept' },
        status: { column: 'status', paid: 'paid', refunded: 'refunded' },
        customerEmail: null,
        customerCountry: null,
        pageFields: ['label'],
      },
      ownerApp: null,
      createdBy: null,
    });

    const users = usersRepo(h.meta);
    const roles = rolesRepo(h.meta);
    owner = await users.create({ email: `mara-${dialect}@adminium.test`, name: 'Mara Lind', status: 'active' });
    await roles.assignToUser(owner.id, (await roles.findBySlug('super-admin'))!.id);
    const grant = async (slug: string, update: boolean): Promise<User> => {
      const role = await roles.create({ slug: `${slug}-${dialect}`, name: slug });
      for (const id of [invoicesId, depositsId, w.targetOf('payments').table.id]) {
        await permissionsRepo(h.meta).grant(role.id, 'table', `${h.connectionId}/${id}`, { read: true, create: false, update, delete: false, export: false, import: false } as never);
      }
      const user = await users.create({ email: `${slug}-${dialect}@adminium.test`, name: slug === 'clerk' ? 'Tom Becker' : 'Ida Reader', status: 'active' });
      await roles.assignToUser(user.id, role.id);
      return user;
    };
    clerk = await grant('clerk', true);
    reader = await grant('reader', false);

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
    await app.register(rbacPlugin, { meta: h.meta });
    const sources = createPayableSources({ meta: h.meta, manager: h.manager });
    await app.register(async (api) => api.register(paymentPanelRoutes({ meta: h.meta, manager: h.manager, sources, networkFeatures: true, desktop: false, trustProxy: false })), { prefix: '/api/v1' });
    await app.ready();
  }, 180_000);

  afterAll(async () => {
    if (!available) return;
    await app.close();
    await h.close();
  });

  async function sentInvoice(amount: string): Promise<Record<string, unknown>> {
    const invoice = await w.create('invoices', { client_id: client['id'] });
    await w.create('invoice_lines', { invoice_id: invoice['id'], qty: 1, rate: amount });
    await w.update('invoices', invoice['id'], { status: 'sent' });
    return invoice;
  }

  const as = (user: User) => ({ 'x-test-user-id': user.id });
  const panel = (user: User, table: string, recordId: unknown) =>
    app.inject({ method: 'POST', url: '/api/v1/payments/panel', headers: as(user), payload: { connectionId: h.connectionId, table, recordId: String(recordId) } });
  const key = () => {
    n += 1;
    return `key-${dialect}-${String(n).padStart(4, '0')}-abcdefgh`;
  };
  const record = (user: User, table: string, recordId: unknown, over: Record<string, unknown> = {}) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/payments/record-payment',
      headers: as(user),
      payload: { connectionId: h.connectionId, table, recordId: String(recordId), amount: '50.00', way: 'cash', paidOn: '2026-10-20', note: null, approvalCode: null, last4: null, key: key(), ...over },
    });
  const paymentsOf = (invoice: Record<string, unknown>) => h.rows(`select * from ${h.real('payments')} where invoice_id = ${String(invoice['id'])}`);

  it.runIf(available)('has no panel on a table that takes no payments', async () => {
    const answer = await panel(owner, w.targetOf('clients').table.id, client['id']);
    expect(answer.statusCode, answer.payload).toBe(200);
    expect(answer.json().data).toBeNull();
  });

  it.runIf(available)('answers a record page from meta while the schema is read again: no panel, never an error', async () => {
    let opened = 0;
    const real = createPayableSources({ meta: h.meta, manager: h.manager });
    const refreshing = { ...real, table: async () => {
      opened += 1;
      throw new Error('The schema is not ready.');
    } };
    const other = Fastify({ logger: false });
    other.setValidatorCompiler(validatorCompiler);
    other.setSerializerCompiler(serializerCompiler);
    other.addHook('onRequest', async (request) => {
      const user = await usersRepo(h.meta).findById(String(request.headers['x-test-user-id']));
      if (user !== null) (request as unknown as { user: object }).user = { id: user.id, name: user.name, email: user.email };
    });
    await other.register(rbacPlugin, { meta: h.meta });
    await other.register(async (api) => api.register(paymentPanelRoutes({ meta: h.meta, manager: h.manager, sources: refreshing, networkFeatures: true, desktop: false, trustProxy: false })), { prefix: '/api/v1' });
    await other.ready();
    const ask = (connectionId: string, table: string) =>
      other.inject({ method: 'POST', url: '/api/v1/payments/panel', headers: as(owner), payload: { connectionId, table, recordId: '1' } });
    try {
      // A connection with no payable table: decided from meta, the source is never opened.
      const none = await ask('cnx_takes_no_payments', 'public.anything');
      expect(none.statusCode, none.payload).toBe(200);
      expect(none.json().data).toBeNull();
      expect(opened).toBe(0);
      // A payable table, and one that is not, while the schema is read again: no panel, no 500.
      for (const table of [invoicesId, w.targetOf('clients').table.id]) {
        const answer = await ask(h.connectionId, table);
        expect(answer.statusCode, answer.payload).toBe(200);
        expect(answer.json().data).toBeNull();
      }
    } finally {
      await other.close();
    }
  });

  it.runIf(available)('turns pay links on with the public address when no pay address was chosen, as Setup reads it', async () => {
    const invoice = await sentInvoice('12.00');
    expect((await panel(owner, invoicesId, invoice['id'])).json().data.links).toEqual({ on: false, reason: 'not-set' });
    await settingsRepo(h.meta).set('system.publicOrigin', 'https://admin.crumbandco.test');
    try {
      expect((await panel(owner, invoicesId, invoice['id'])).json().data.links).toEqual({ on: true, reason: null });
    } finally {
      await settingsRepo(h.meta).set('system.publicOrigin', null);
    }
  });

  it.runIf(available)('records a payment by hand into the invoice\'s own payments, once per key, as the person', async () => {
    const invoice = await sentInvoice('120.00');
    const before = (await panel(owner, invoicesId, invoice['id'])).json().data;
    expect(before).toMatchObject({ currency: 'EUR', total: '120.00', due: '120.00', paid: '0.00', refusal: null, mayChange: true, mayRecord: true, waiting: [], payments: [] });

    const same = key();
    const first = await record(owner, invoicesId, invoice['id'], { key: same, note: 'Paid at the counter' });
    expect(first.statusCode, first.payload).toBe(200);
    expect(first.json().data).toMatchObject({ already: false, due: '70.00' });
    const again = await record(owner, invoicesId, invoice['id'], { key: same, note: 'Paid at the counter' });
    expect(again.json().data).toMatchObject({ already: true });
    const rows = await paymentsOf(invoice);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ method: 'cash', method_note: 'Paid at the counter', payment_ref: `hand_${same}` });

    const after = (await panel(owner, invoicesId, invoice['id'])).json().data;
    expect(after).toMatchObject({ due: '70.00', paid: '50.00' });
    expect(after.payments).toEqual([expect.objectContaining({ amount: '50.00', way: 'cash', wayLabel: 'Paid at the counter', provider: null, test: false, paidOn: '2026-10-20' })]);
  });

  it.runIf(available)('records a card taken on the shop\'s own terminal, with its approval code and last four', async () => {
    const invoice = await sentInvoice('80.00');
    const refusedFour = await record(owner, invoicesId, invoice['id'], { way: 'card', approvalCode: 'A7K29Q', last4: '4242 1881' });
    expect(refusedFour.statusCode).toBe(422);
    expect(refusedFour.json().error.details).toMatchObject({ field: 'last4', reason: 'LAST_FOUR' });
    const refusedCode = await record(owner, invoicesId, invoice['id'], { way: 'card', approvalCode: 'A7K-29Q', last4: '4242' });
    expect(refusedCode.json().error.details).toMatchObject({ field: 'approvalCode', reason: 'APPROVAL_CODE' });
    const notCard = await record(owner, invoicesId, invoice['id'], { way: 'cash', last4: '4242' });
    expect(notCard.json().error.details).toMatchObject({ reason: 'NOT_A_CARD' });
    const ok = await record(owner, invoicesId, invoice['id'], { way: 'card', approvalCode: 'A7K29Q', last4: '4242', amount: '80.00' });
    expect(ok.statusCode, ok.payload).toBe(200);
    expect(ok.json().data.due).toBe('0');
    expect((await paymentsOf(invoice))[0]).toMatchObject({ method: 'card' });
    // Nothing is left to record.
    expect((await panel(owner, invoicesId, invoice['id'])).json().data).toMatchObject({ due: '0.00', mayRecord: false });
  });

  it.runIf(available)('never takes more than is due, nor a card number in any text', async () => {
    const invoice = await sentInvoice('30.00');
    const over = await record(owner, invoicesId, invoice['id'], { amount: '30.01' });
    expect(over.statusCode).toBe(422);
    expect(over.json().error.details).toMatchObject({ field: 'amount', reason: 'BALANCE_EXCEEDED', due: '30.00' });
    const zero = await record(owner, invoicesId, invoice['id'], { amount: '0' });
    expect(zero.json().error.details).toMatchObject({ reason: 'AMOUNT' });
    const card = await record(owner, invoicesId, invoice['id'], { amount: '10.00', note: 'Paid with card 4242 4242 4242 4242' });
    expect(card.statusCode).toBe(422);
    expect(card.json().error.details).toMatchObject({ field: 'note', reason: 'CARD_NUMBER' });
    const iban = await record(owner, invoicesId, invoice['id'], { amount: '10.00', way: 'bank-transfer', note: 'From DE89 3704 0044 0532 0130 00' });
    expect(iban.statusCode, iban.payload).toBe(200);
    expect((await paymentsOf(invoice))).toHaveLength(1);
  });

  it.runIf(available)('lets a clerk who may change invoices record, and a reader only look', async () => {
    const invoice = await sentInvoice('60.00');
    const asClerk = (await panel(clerk, invoicesId, invoice['id'])).json().data;
    expect(asClerk).toMatchObject({ mayChange: true, mayRecord: true });
    const recorded = await record(clerk, invoicesId, invoice['id'], { amount: '20.00' });
    expect(recorded.statusCode, recorded.payload).toBe(200);

    const asReader = (await panel(reader, invoicesId, invoice['id'])).json().data;
    expect(asReader).toMatchObject({ mayChange: false, mayRecord: false, due: '40.00' });
    expect(asReader.payments).toHaveLength(1);
    const refused = await record(reader, invoicesId, invoice['id'], { amount: '10.00' });
    expect(refused.statusCode).toBe(403);
    expect(await paymentsOf(invoice)).toHaveLength(1);
  });

  it.runIf(available)('records one payment when the same key arrives twice at once, and a key used on another record is that record\'s own', async () => {
    const deposit = await w.create('deposits', { label: 'DEP-9', amount: '30.00', currency: 'EUR' });
    const once = key();
    const [a, b] = await Promise.all([record(owner, depositsId, deposit['id'], { amount: '10.00', key: once }), record(owner, depositsId, deposit['id'], { amount: '10.00', key: once })]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    expect([a.json().data.already, b.json().data.already].sort()).toEqual([false, true]);
    const ref = { kind: 'profile' as const, connectionId: h.connectionId, tableName: depositsId, rowKey: String(deposit['id']) };
    expect(await keptPaymentsRepo(h.meta).forPayable(ref)).toHaveLength(1);
    // The same key on another record is not "already on file" there.
    const other = await w.create('deposits', { label: 'DEP-10', amount: '30.00', currency: 'EUR' });
    const there = await record(owner, depositsId, other['id'], { amount: '10.00', key: once });
    expect(there.json().data, there.payload).toMatchObject({ already: false, due: '20.00' });
  });

  it.runIf(available)('shows the payments table\'s rows only to someone who may read that table', async () => {
    const invoice = await sentInvoice('60.00');
    expect((await record(owner, invoicesId, invoice['id'], { amount: '20.00' })).statusCode).toBe(200);
    const roles = rolesRepo(h.meta);
    const role = await roles.create({ slug: `invoices-only-${dialect}`, name: 'invoices only' });
    await permissionsRepo(h.meta).grant(role.id, 'table', `${h.connectionId}/${invoicesId}`, { read: true, create: false, update: false, delete: false, export: false, import: false } as never);
    const outsider = await usersRepo(h.meta).create({ email: `outsider-${dialect}@adminium.test`, name: 'Ola', status: 'active' });
    await roles.assignToUser(outsider.id, role.id);
    const read = (await panel(outsider, invoicesId, invoice['id'])).json().data;
    expect(read).toMatchObject({ due: '40.00', mayChange: false });
    expect(read.payments).toEqual([]);
  });

  it.runIf(available)('counts a payment under the row\'s own key, however its id was written', async () => {
    const deposit = await w.create('deposits', { label: 'DEP-11', amount: '30.00', currency: 'EUR' });
    const padded = `00${String(deposit['id'])}`;
    const recorded = await record(owner, depositsId, padded, { amount: '10.00' });
    expect(recorded.statusCode, recorded.payload).toBe(200);
    const kept = await keptPaymentsRepo(h.meta).forPayable({ kind: 'profile', connectionId: h.connectionId, tableName: depositsId, rowKey: String(deposit['id']) });
    expect(kept).toHaveLength(1);
    expect((await panel(owner, depositsId, deposit['id'])).json().data).toMatchObject({ due: '20.00' });
  });

  it.runIf(available)('keeps one payment for one key, even when another process gets the retry', async () => {
    const deposit = await w.create('deposits', { label: 'DEP-8', amount: '30.00', currency: 'EUR' });
    const once = key();
    const first = await record(owner, depositsId, deposit['id'], { amount: '10.00', key: once });
    expect(first.json().data).toMatchObject({ already: false, due: '20.00' });
    // A second server process: none of the first one's memory, the same meta store.
    const other = Fastify({ logger: false });
    other.setValidatorCompiler(validatorCompiler);
    other.setSerializerCompiler(serializerCompiler);
    other.addHook('onRequest', async (request) => {
      const user = await usersRepo(h.meta).findById(String(request.headers['x-test-user-id']));
      if (user !== null) (request as unknown as { user: object }).user = { id: user.id, name: user.name, email: user.email };
    });
    await other.register(rbacPlugin, { meta: h.meta });
    await other.register(async (api) => api.register(paymentPanelRoutes({ meta: h.meta, manager: h.manager, sources: createPayableSources({ meta: h.meta, manager: h.manager }), networkFeatures: true, desktop: false, trustProxy: false })), { prefix: '/api/v1' });
    await other.ready();
    try {
      const again = await other.inject({
        method: 'POST',
        url: '/api/v1/payments/record-payment',
        headers: as(owner),
        payload: { connectionId: h.connectionId, table: depositsId, recordId: String(deposit['id']), amount: '10.00', way: 'cash', paidOn: '2026-10-20', note: null, approvalCode: null, last4: null, key: once },
      });
      expect(again.statusCode, again.payload).toBe(200);
      expect(again.json().data).toMatchObject({ already: true, due: '20.00' });
    } finally {
      await other.close();
    }
    const kept = await keptPaymentsRepo(h.meta).forPayable({ kind: 'profile', connectionId: h.connectionId, tableName: depositsId, rowKey: String(deposit['id']) });
    expect(kept).toHaveLength(1);
  });

  it.runIf(available)('keeps a deposit\'s payment in Adminium, and marks it paid once nothing is due', async () => {
    const deposit = await w.create('deposits', { label: 'DEP-7', amount: '25.00', currency: 'EUR' });
    const recorded = await record(owner, depositsId, deposit['id'], { amount: '25.00', way: 'bank-transfer' });
    expect(recorded.statusCode, recorded.payload).toBe(200);
    expect(recorded.json().data.due).toBe('0');
    const kept = await keptPaymentsRepo(h.meta).forPayable({ kind: 'profile', connectionId: h.connectionId, tableName: depositsId, rowKey: String(deposit['id']) });
    expect(kept).toEqual([expect.objectContaining({ amount: '25.00', method: 'bank-transfer', recordedBy: 'Mara Lind', recordedByUser: owner.id, mode: 'live' })]);
    const status = (await h.rows(`select status from ${h.real('deposits')} where id = ${String(deposit['id'])}`))[0]!['status'];
    expect(status).toBe('paid');
    const read = (await panel(owner, depositsId, deposit['id'])).json().data;
    expect(read).toMatchObject({ paid: '25.00', mayRecord: false });
    expect(read.payments[0]).toMatchObject({ recordedBy: 'Mara Lind', way: 'bank-transfer' });
  });
});
