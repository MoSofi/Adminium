// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT AN APP'S PAYMENTS SAY TO ITS OWN RULES, on SQLite, Postgres and MySQL.
 *
 *  - A move that waits for no payment on its way (`requires.noPaymentInFlight`)
 *    is refused to staff while one is, and goes once it is not; the payment's
 *    own move to paid, the same move, is never refused by it.
 *  - The paid move an online payment makes writes the payable's further
 *    columns (`status.set`) in the same write, through the record's lock; a
 *    payment recorded by hand writes none of them.
 *  - A mail queued only while payments are on (`payments: "on"`), and its
 *    twin only while they are off: one of the two goes, by how the shop is set
 *    when the order is made.
 *  - An app's refund row, stamped `done` by Adminium, is announced: a mail on
 *    it goes out, once, however often the stamp is written again.
 *  - The refunds a record's panel lists say who asked and why, to someone who
 *    may see payments or refund them, and to nobody else.
 */
import { payableProfilesRepo, paymentAttemptsRepo, paymentSettingsRepo, refundsRepo, type PaymentAttempt } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createWriteService, type WriteContext, type WriteTarget } from '../src/crud/write-service.js';
import { writeStores } from '../src/crud/write-stores.js';
import { askAppRefund } from '../src/payments/app-refunds.js';
import { PAY_ADDRESS_DOC, payAddressSchema } from '../src/payments/links.js';
import { createPayableSources } from '../src/payments/payables.js';
import { recordAttempt } from '../src/payments/record.js';
import type { RefundDeps } from '../src/payments/refunds.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { LEGS, said, wholeServer, type WholeServer } from './whole-server.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.62' }));
// A live payment service, without a payment add-on: what "payments on" reads as live.
const service = vi.hoisted(() => ({ live: false }));
vi.mock('../src/payments/ready.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/payments/ready.js')>()), anyLiveOn: async () => service.live }));

const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength = 120) => ({ ref, type: 'text', maxLength, nullable: true });
const KINDS = ['order-paid', 'order-unpaid', 'order-received', 'refund-sent'];

function counter(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'counter',
    name: 'Counter',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.counter.desc', fallback: 'A counter.' },
    categories: ['commerce'],
    compatibility: { minAdminiumVersion: '0.3.62', engines: ['postgres', 'mysql', 'sqlite'] },
    navGroups: [{ key: 'counter', label: { 'en-US': 'Counter' }, order: 1 }],
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'settings', columns: [id, text('name', 80), text('email', 200)] },
        {
          ref: 'orders',
          columns: [
            id,
            text('number', 40),
            text('email', 200),
            { ref: 'total', type: 'money', default: 0 },
            { ref: 'paid', type: 'money', nullable: true, rules: { rollup: { from: 'order_payments', via: 'order_id', sum: 'amount', balance: { column: 'balance', of: 'total' } } } },
            { ref: 'balance', type: 'money', nullable: true },
            { ref: 'status', type: 'enum', enum: ['paying', 'placed', 'cancelled'], default: 'placed' },
            { ref: 'paid_method', type: 'enum', enum: ['counter', 'online'], nullable: true },
          ],
          states: {
            column: 'status',
            initial: 'placed',
            starts: ['paying'],
            // "Pay when you pick up instead": never while a payment is landing. The payment's own move to paid is the same move.
            moves: { paying: [{ to: 'placed', requires: { noPaymentInFlight: true } }, 'cancelled'], placed: ['cancelled'] },
            // A paying order is locked: what the paid move writes beside its state is its own.
            lock: { when: ['paying'], except: ['email'] },
          },
        },
        {
          ref: 'order_payments',
          columns: [
            id,
            { ref: 'order_id', type: 'fk', references: 'orders' },
            { ref: 'amount', type: 'money', default: 0 },
            { ref: 'paid_on', type: 'date', nullable: true },
            { ref: 'method', type: 'enum', enum: ['cash', 'online'], default: 'cash' },
            { ref: 'payment_ref', type: 'text', maxLength: 64, nullable: true, unique: true },
          ],
        },
        {
          ref: 'order_refunds',
          columns: [id, { ref: 'payment_id', type: 'fk', references: 'order_payments' }, { ref: 'amount', type: 'money', default: 0 }, { ref: 'method', type: 'enum', enum: ['cash', 'online'], default: 'cash' }, text('provider_ref', 255), text('refund_state', 16)],
        },
        {
          ref: 'messages',
          columns: [
            id,
            { ref: 'kind', type: 'enum', enum: KINDS },
            { ref: 'status', type: 'enum', enum: ['held', 'queued', 'sent', 'failed', 'skipped'], default: 'queued' },
            text('to_address', 254),
            { ref: 'order_id', type: 'fk', references: 'orders', nullable: true },
            { ref: 'refund_id', type: 'fk', references: 'order_refunds', nullable: true },
            text('error', 200),
            text('skip_reason', 40),
            { ref: 'sent_at', type: 'timestamptz', nullable: true },
          ],
        },
      ],
    },
    roles: [{ key: 'kitchen', name: 'Kitchen', permissions: ['app:@:staff', 'table:@orders:read', 'table:@orders:update', 'table:@order_payments:read', 'page:@counter-orders:view'] }],
    pages: [{ ref: 'counter-orders', template: 'page-crud', title: { key: 't.orders', fallback: 'Orders' }, nav: { group: 'counter', icon: 'list', order: 1 }, bindings: { rows: 'orders' } }],
    outbox: {
      table: 'messages',
      columns: { kind: 'kind', status: 'status', to: 'to_address', error: 'error', skipReason: 'skip_reason', sentAt: 'sent_at' },
      links: { order: 'order_id', refund: 'refund_id' },
      recipient: { via: 'order_id', table: 'orders', email: 'email', name: 'number' },
      settings: { table: 'settings', name: 'name' },
      kinds: { 'order-paid': 'counter-order-paid', 'order-unpaid': 'counter-order-unpaid', 'order-received': 'counter-order-received', 'refund-sent': 'counter-refund-sent' },
      classes: { 'order-paid': 'service', 'order-unpaid': 'service', 'order-received': 'service', 'refund-sent': 'service' },
      producers: [
        { kind: 'order-paid', link: 'order_id', onChange: { table: 'orders', column: 'status', to: 'placed' } },
        // One of two mails of a new order, by how the shop takes payments when it is made.
        { kind: 'order-unpaid', link: 'order_id', onCreate: { table: 'orders' }, payments: 'on' },
        { kind: 'order-received', link: 'order_id', onCreate: { table: 'orders' }, payments: 'off' },
        // The shop is told each refund sent.
        { kind: 'refund-sent', link: 'refund_id', onChange: { table: 'order_refunds', column: 'refund_state', to: 'done' }, recipient: { setting: { table: 'settings', column: 'email' } } },
      ],
    },
    emailTemplates: [
      { key: 'counter-order-paid', name: 'counter-order-paid', locales: { 'en-US': { subject: 'Order {{order.number}} is paid', blocks: [{ block: 'email.text', data: { text: 'Thank you.' } }] } } },
      { key: 'counter-order-unpaid', name: 'counter-order-unpaid', locales: { 'en-US': { subject: 'Pay for order {{order.number}}', preheader: 'You owe {{order.total}}', blocks: [{ block: 'email.text', data: { text: 'Pay online.' } }] } } },
      { key: 'counter-order-received', name: 'counter-order-received', locales: { 'en-US': { subject: 'Order {{order.number}} received', preheader: 'Pay when you pick it up', blocks: [{ block: 'email.text', data: { text: 'See you soon.' } }] } } },
      { key: 'counter-refund-sent', name: 'counter-refund-sent', locales: { 'en-US': { subject: 'A refund was sent', blocks: [{ block: 'email.text', data: { text: 'Sent.' } }] } } },
    ],
    payments: {
      payables: [
        {
          table: 'orders',
          label: 'number',
          amount: { column: 'total' },
          currency: { fixed: 'EUR' },
          due: { column: 'balance' },
          payments: { kind: 'table', table: 'order_payments', link: 'order_id', amount: 'amount', date: 'paid_on', method: { column: 'method', values: { '*': 'online' } }, reference: 'payment_ref' },
          status: { column: 'status', paid: 'placed', from: ['paying'], set: { paid_method: 'online' } },
          customerEmail: 'email',
          payableWhen: [{ column: 'status', eq: 'paying' }],
          refunds: { model: 'rows', table: 'order_refunds', payment: 'payment_id', amount: 'amount', when: [{ column: 'method', eq: 'online' }], providerRef: 'provider_ref', state: 'refund_state' },
        },
      ],
    },
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  };
}

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`an app's payments and its own rules [${dialect}]`, () => {
    let s: WholeServer;
    let n = 0;
    const real = (ref: string): string => s.t(ref).slice(s.t(ref).lastIndexOf('.') + 1);
    const order = async (key: number) => (await s.rows(`SELECT status, paid_method FROM ${real('orders')} WHERE id = ${String(key)}`))[0];
    const target = async (ref: string): Promise<WriteTarget> => {
      const view = (await createPublicViews(s.meta).viewFor(s.connectionId))!;
      const handle = await s.manager.data(s.connectionId);
      return { connectionId: s.connectionId, view, table: view.table(s.t(ref)), db: handle.db, dialect: handle.dialect, timezone: 'UTC' };
    };
    const staff: WriteContext = { origin: 'dashboard', hops: 0, actor: { kind: 'user', id: 'usr_owner', label: 'Owner' }, request: null };
    const announce = async () => {};
    const sources = () => createPayableSources({ meta: s.meta, manager: s.manager });

    /** A payment the service took (or is taking) for an order: live, by card. */
    const payment = async (key: number, amount: string, state: 'processing' | 'succeeded'): Promise<PaymentAttempt> => {
      n += 1;
      const attempts = paymentAttemptsRepo(s.meta);
      const ref = { kind: 'profile' as const, connectionId: s.connectionId, tableName: s.t('orders'), rowKey: String(key) };
      const attempt = (await attempts.create({ provider: 'payments-stripe', mode: 'live', accountId: 'acct', payable: ref, payableLabel: `C-${String(key)}`, amount, currency: 'EUR', linkId: null, nonce: `nonce-${dialect}-w${String(n)}`.padEnd(22, 'x'), createdBy: null }))!;
      await attempts.move(attempt.id, 'open', { providerRef: `cs_${dialect}_w${String(n)}` });
      if (state === 'processing') await attempts.move(attempt.id, 'processing', {});
      else await attempts.move(attempt.id, 'succeeded', { takenAmount: amount, takenCurrency: 'EUR', paymentRef: `pi_${dialect}_w${String(n)}`, paidWith: { method: 'card', label: 'Visa', delayed: false } });
      return (await attempts.byId(attempt.id))!;
    };
    const record = (attempt: PaymentAttempt) => recordAttempt({ meta: s.meta, sources: sources(), app: s.app }, attempt.id);
    const kindsSent = async () => (await s.emails()).map((mail) => [mail.to, mail.subject]);

    beforeAll(async () => {
      s = await wholeServer(dialect, counter(), { smtp: true, people: { kit: ['kitchen'] } });
      await s.rows(`INSERT INTO ${real('settings')} (id, name, email) VALUES (1, 'Counter', 'desk@crumbandco.de')`);
      await paymentSettingsRepo(s.meta).set(PAY_ADDRESS_DOC, payAddressSchema, { origin: 'https://pay.crumbandco.de' });
      const [profile] = await payableProfilesRepo(s.meta).list(s.connectionId);
      await payableProfilesRepo(s.meta).update(profile!.id, { enabled: true });
    }, 180_000);
    afterAll(async () => {
      service.live = false;
      await s?.close();
    });

    it('sends the new order\'s mail by how the shop takes payments when it is made', async () => {
      service.live = false;
      await s.rows(`DELETE FROM ${real('messages')}`);
      expect(said(await s.make('owner', 'orders', { id: 1, number: 'C-1', email: 'ada@crumbandco.de', total: '12.50', status: 'placed' }))).toBe('ok');
      await s.jobs();
      expect(await kindsSent()).toEqual([['ada@crumbandco.de', 'Order C-1 received']]);
      service.live = true;
      expect(said(await s.make('owner', 'orders', { id: 2, number: 'C-2', email: 'bea@crumbandco.de', total: '8.00', status: 'paying' }))).toBe('ok');
      await s.jobs();
      expect(await kindsSent()).toEqual([['bea@crumbandco.de', 'Pay for order C-2']]);
    });

    it('refuses "pay when you pick up instead" while a payment is on its way, and lets the payment\'s own move through', async () => {
      service.live = true;
      await s.rows(`INSERT INTO ${real('orders')} (id, number, email, total, balance, status) VALUES (3, 'C-3', 'cy@crumbandco.de', 9.00, 9.00, 'paying'), (4, 'C-4', 'dee@crumbandco.de', 9.00, 9.00, 'paying')`);
      const writes = createWriteService(writeStores(s.meta));
      const orders = await target('orders');
      // The bank is confirming order 3's payment: nobody moves it, whatever their rights.
      const landing = await payment(3, '9.00', 'processing');
      await expect(writes.update({ target: orders, pk: { id: 3 }, values: { status: 'placed' }, context: staff, announce })).rejects.toMatchObject({ code: 'PAYMENT_IN_FLIGHT' });
      const viaRoute = await s.change('owner', 'orders', 3, { status: 'placed' });
      expect(said(viaRoute), viaRoute.body).toBe('409 PAYMENT_IN_FLIGHT');
      expect((await order(3))!['status']).toBe('paying');
      // It lands: the payment's own move to placed is made, and writes how it was paid.
      await paymentAttemptsRepo(s.meta).move(landing.id, 'succeeded', { takenAmount: '9.00', takenCurrency: 'EUR', paymentRef: `pi_${dialect}_landed`, paidWith: { method: 'card', label: 'Visa', delayed: false } });
      expect(await record((await paymentAttemptsRepo(s.meta).byId(landing.id))!)).toMatchObject({ state: 'recorded' });
      expect(await order(3)).toMatchObject({ status: 'placed', paid_method: 'online' });
      // Order 4 has nothing on its way: the diner may pay at the counter, and nothing says it was paid online.
      await writes.update({ target: orders, pk: { id: 4 }, values: { status: 'placed' }, context: staff, announce });
      expect(await order(4)).toMatchObject({ status: 'placed', paid_method: null });
    });

    it('writes nothing more for a payment recorded by hand', async () => {
      await s.rows(`INSERT INTO ${real('orders')} (id, number, email, total, balance, status) VALUES (5, 'C-5', 'eve@crumbandco.de', 4.00, 4.00, 'paying')`);
      const paid = await s.send('owner', 'POST', '/api/v1/payments/record-payment', { connectionId: s.connectionId, table: s.t('orders'), recordId: '5', amount: '4.00', way: 'cash', paidOn: '2026-11-17', note: null, approvalCode: null, last4: null, key: `hand-${dialect}-0123456789` });
      expect(said(paid), paid.body).toBe('ok');
      expect(await order(5)).toMatchObject({ status: 'placed', paid_method: null });
    });

    it('announces a refund row Adminium stamped done: its mail goes out once', async () => {
      await s.jobs();
      await s.emails();
      const attempt = await payment(6, '20.00', 'succeeded');
      await s.rows(`INSERT INTO ${real('orders')} (id, number, email, total, balance, status) VALUES (6, 'C-6', 'fay@crumbandco.de', 20.00, 0.00, 'placed')`);
      await s.rows(`INSERT INTO ${real('order_payments')} (id, order_id, amount, method, payment_ref) VALUES (6, 6, 20.00, 'online', '${attempt.id}')`);
      await s.rows(`INSERT INTO ${real('order_refunds')} (id, payment_id, amount, method) VALUES (6, 6, 5.00, 'online')`);
      const provider = { refund: async (input: { paymentRef: string; amount: string; currency: string }) => ({ ok: true as const, ref: 're_6', paymentRef: input.paymentRef, status: 'succeeded' as const, amount: input.amount, currency: input.currency, failureMessage: null }) };
      const deps: RefundDeps = { meta: s.meta, sources: sources(), providerFor: async () => ({ ok: true, provider }) as never, enqueue: async () => undefined, app: s.app };
      const row = { connectionId: s.connectionId, table: s.t('order_refunds'), rowKey: '6' };
      expect(await askAppRefund(deps, row, 'usr_owner')).toBe('asked');
      expect((await s.rows(`SELECT refund_state FROM ${real('order_refunds')} WHERE id = 6`))[0]).toMatchObject({ refund_state: 'done' });
      // Asked again (a retry, the sweep): stamped again as it stands, said once.
      expect(await askAppRefund(deps, row)).toBe('stamped');
      await s.jobs();
      expect(await kindsSent()).toEqual([['desk@crumbandco.de', 'A refund was sent']]);
      expect(await s.rows(`SELECT kind FROM ${real('messages')} WHERE refund_id = 6`)).toHaveLength(1);
    });

    it('says who refunded and why, only to someone who may see payments or refund them', async () => {
      const attempt = await payment(7, '30.00', 'succeeded');
      await s.rows(`INSERT INTO ${real('orders')} (id, number, email, total, balance, status) VALUES (7, 'C-7', 'gus@crumbandco.de', 30.00, 0.00, 'placed')`);
      // A refund the owner asked for in Adminium, with a reason and a note.
      await refundsRepo(s.meta).create({ attemptId: attempt.id, paymentId: null, provider: 'payments-stripe', mode: 'live', paymentRef: attempt.paymentRef!, amount: '10.00', currency: 'EUR', reason: 'duplicate', note: 'Charged twice', idempotencyKey: `rk-who-${dialect}`.padEnd(20, 'x'), source: 'staff', requestedBy: s.ids['owner']!, state: 'succeeded', failureMessage: null, appRow: null }, Date.now());
      await s.rows(`INSERT INTO ${real('order_payments')} (id, order_id, amount, method, payment_ref) VALUES (7, 7, 30.00, 'online', '${attempt.id}')`);
      const panel = (who: string) => s.send(who, 'POST', '/api/v1/payments/panel', { connectionId: s.connectionId, table: s.t('orders'), recordId: '7' });
      const refundsOf = (res: { json: () => unknown }) => ((res.json() as { data: { payments: { refunds: Record<string, unknown>[] }[] } }).data.payments.flatMap((one) => one.refunds));
      const told = await panel('owner');
      expect(said(told), told.body).toBe('ok');
      expect(refundsOf(told)).toEqual([expect.objectContaining({ amount: '10.00', by: expect.any(String), reason: 'duplicate', note: 'Charged twice' })]);
      // The kitchen reads the order, and may neither see payments nor refund: the refund, and nothing of who or why.
      const kitchen = await panel('kit');
      expect(said(kitchen), kitchen.body).toBe('ok');
      const [plain] = refundsOf(kitchen);
      expect(plain).toMatchObject({ amount: '10.00' });
      expect(plain).not.toHaveProperty('by');
      expect(plain).not.toHaveProperty('reason');
      expect(plain).not.toHaveProperty('note');
    });
  });
}
