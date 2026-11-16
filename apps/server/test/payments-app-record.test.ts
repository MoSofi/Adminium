// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN APP'S PAYMENT, WRITTEN DOWN AS THE APP SAYS, on SQLite, Postgres and MySQL.
 *
 * A counter app takes payment as a guest checks out: its order is made
 * `paying`, and a payment taken online moves it to `placed` (`status.from`),
 * by the app's own move, which only its manager may make by hand — Adminium
 * makes it as the app declared it. The payment lands in the app's payments
 * table with the service it was taken by, and the move is announced like any
 * write, so the app's own "paid" mail goes out.
 *
 * Money that arrives for an order no longer `paying` (`payableWhen`) is never
 * written into the app: a person decides. And a record that will not move to
 * paid is written down and flagged for a person, never a log line only.
 */
import { paymentAttemptsRepo, paymentLinksRepo, payableProfilesRepo, settingsRepo, type PaymentAttempt, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest';

import { createPayableSources } from '../src/payments/payables.js';
import { recordAttempt } from '../src/payments/record.js';
import { endLeftPages } from '../src/payments/row-left.js';
import { linkSealFromSecret, mintLink } from '../src/payments/links.js';
import { TEST_SECRET } from './helpers.js';
import { PAYMENT_WAIT_MS, runTimedMoves } from '../src/states/timed-moves.js';
import { attemptFlag } from '../src/routes/payments/activity.js';
import { LEGS, wholeServer, type WholeServer } from './whole-server.helpers.js';

// The server says the version it was built at; the words tried here are read from the release to come.
vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.60' }));

const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength = 120) => ({ ref, type: 'text', maxLength, nullable: true });

function counter(moves: Record<string, unknown>): Record<string, unknown> {
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
    compatibility: { minAdminiumVersion: '0.3.60', engines: ['postgres', 'mysql', 'sqlite'] },
    navGroups: [{ key: 'counter', label: { 'en-US': 'Counter' }, order: 1 }],
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'settings', columns: [id, text('name', 80)] },
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
            { ref: 'held_until', type: 'timestamptz', nullable: true },
          ],
          // An order not paid by the end of its hold lapses — but never under a payment that is landing.
          states: { column: 'status', initial: 'placed', starts: ['paying'], moves, timed: [{ from: 'paying', to: 'cancelled', at: { column: 'held_until' }, waitsForPayment: true }] },
        },
        {
          ref: 'order_payments',
          columns: [
            id,
            { ref: 'order_id', type: 'fk', references: 'orders' },
            { ref: 'amount', type: 'money', default: 0 },
            { ref: 'paid_on', type: 'date', nullable: true },
            { ref: 'paid_at', type: 'timestamptz', nullable: true },
            { ref: 'method', type: 'enum', enum: ['cash', 'online'], default: 'cash' },
            { ref: 'payment_ref', type: 'text', maxLength: 64, nullable: true, unique: true },
            text('provider', 40),
          ],
        },
        {
          ref: 'messages',
          columns: [
            id,
            { ref: 'kind', type: 'enum', enum: ['order-paid'] },
            { ref: 'status', type: 'enum', enum: ['held', 'queued', 'sent', 'failed', 'skipped'], default: 'queued' },
            text('to_address', 254),
            { ref: 'order_id', type: 'fk', references: 'orders', nullable: true },
            text('error', 200),
            text('skip_reason', 40),
            { ref: 'sent_at', type: 'timestamptz', nullable: true },
          ],
        },
      ],
    },
    roles: [{ key: 'manager', name: 'Manager', permissions: ['app:@:staff', 'table:@orders:read', 'table:@orders:update', 'page:@counter-orders:view'] }],
    pages: [{ ref: 'counter-orders', template: 'page-crud', title: { key: 't.orders', fallback: 'Orders' }, nav: { group: 'counter', icon: 'list', order: 1 }, bindings: { rows: 'orders' } }],
    outbox: {
      table: 'messages',
      columns: { kind: 'kind', status: 'status', to: 'to_address', error: 'error', skipReason: 'skip_reason', sentAt: 'sent_at' },
      links: { order: 'order_id' },
      recipient: { via: 'order_id', table: 'orders', email: 'email', name: 'number' },
      settings: { table: 'settings', name: 'name' },
      kinds: { 'order-paid': 'counter-order-paid' },
      classes: { 'order-paid': 'service' },
      producers: [{ kind: 'order-paid', link: 'order_id', onChange: { table: 'orders', column: 'status', to: 'placed' } }],
    },
    emailTemplates: [{ key: 'counter-order-paid', name: 'counter-order-paid', locales: { 'en-US': { subject: 'Order {{order.number}} is paid', blocks: [{ block: 'email.text', data: { text: 'Thank you.' } }] } } }],
    payments: {
      payables: [
        {
          table: 'orders',
          label: 'number',
          amount: { column: 'total' },
          currency: { fixed: 'EUR' },
          due: { column: 'balance' },
          payments: { kind: 'table', table: 'order_payments', link: 'order_id', amount: 'amount', date: 'paid_on', paidAt: 'paid_at', method: { column: 'method', values: { '*': 'online' } }, reference: 'payment_ref', provider: 'provider' },
          status: { column: 'status', paid: 'placed', from: ['paying'] },
          customerEmail: 'email',
          payableWhen: [{ column: 'status', eq: 'paying' }],
          returnTo: '/orders',
          receipt: 'app',
        },
      ],
    },
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  };
}

/** The app's move to placed, which only its manager may make by hand, and only for an order under 100; and the cancellation. */
const MOVES = { paying: [{ to: 'placed', roles: ['manager'], requires: { where: [{ column: 'total', lt: 100 }] } }, 'cancelled'], placed: ['cancelled'] };

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`an app's payment, written down as the app says [${dialect}]`, () => {
    let s: WholeServer;
    let n = 0;
    const real = (ref: string): string => s.t(ref).slice(s.t(ref).lastIndexOf('.') + 1);
    const order = async (key: number) => (await s.rows(`SELECT status, balance FROM ${real('orders')} WHERE id = ${String(key)}`))[0];
    const paymentsOf = async (key: number) => s.rows(`SELECT method, payment_ref, provider, paid_on, paid_at FROM ${real('order_payments')} WHERE order_id = ${String(key)}`);

    /** A payment the service took for an order: live, by card. */
    const paid = async (key: number, amount: string): Promise<PaymentAttempt> => {
      n += 1;
      const attempts = paymentAttemptsRepo(s.meta);
      const ref = { kind: 'profile' as const, connectionId: s.connectionId, tableName: s.t('orders'), rowKey: String(key) };
      const attempt = (await attempts.create({ provider: 'payments-stripe', mode: 'live', accountId: 'acct', payable: ref, payableLabel: `C-${String(key)}`, amount, currency: 'EUR', linkId: null, nonce: `nonce-${dialect}-${String(n)}`.padEnd(22, 'x'), createdBy: null }))!;
      await attempts.move(attempt.id, 'open', { providerRef: `cs_${dialect}_${String(n)}` });
      await attempts.move(attempt.id, 'succeeded', { takenAmount: amount, takenCurrency: 'EUR', paymentRef: `pi_${dialect}_${String(n)}`, paidWith: { method: 'card', label: 'Visa', delayed: false } });
      return attempt;
    };
    const record = (attempt: PaymentAttempt) => recordAttempt({ meta: s.meta, sources: createPayableSources({ meta: s.meta, manager: s.manager }), app: s.app }, attempt.id);

    beforeAll(async () => {
      s = await wholeServer(dialect, counter(MOVES), { smtp: true });
      await s.rows(`INSERT INTO ${real('settings')} (id, name) VALUES (1, 'Counter')`);
      // Switched on for payments by someone who manages them.
      const [profile] = await payableProfilesRepo(s.meta).list(s.connectionId);
      await payableProfilesRepo(s.meta).update(profile!.id, { enabled: true });
    }, 180_000);
    afterAll(async () => {
      await s?.close();
    });

    it("lands in the app's payments table, moves the order by the app's own move, and its paid mail goes out", async () => {
      await s.rows(`INSERT INTO ${real('orders')} (id, number, email, total, balance, status) VALUES (1, 'C-1', 'ada@crumbandco.de', 12.50, 12.50, 'paying')`);
      const attempt = await paid(1, '12.50');
      expect(await record(attempt)).toMatchObject({ state: 'recorded' });
      expect(await paymentsOf(1)).toEqual([expect.objectContaining({ method: 'online', payment_ref: attempt.id, provider: 'Stripe' })]);
      // The moment it was paid, as well as the day.
      expect((await paymentsOf(1))[0]!['paid_at']).not.toBeNull();
      expect((await order(1))!['status']).toBe('placed');
      await s.jobs();
      expect((await s.emails()).map((mail) => [mail.to, mail.subject])).toEqual([['ada@crumbandco.de', 'Order C-1 is paid']]);
      expect(attemptFlag((await paymentAttemptsRepo(s.meta).byId(attempt.id))!)).toBeNull();
    });

    it('never writes money for an order that is no longer paying into the app: a person decides', async () => {
      await s.rows(`INSERT INTO ${real('orders')} (id, number, email, total, balance, status) VALUES (2, 'C-2', 'bea@crumbandco.de', 8.00, 8.00, 'cancelled')`);
      const attempt = await paid(2, '8.00');
      expect(await record(attempt)).toMatchObject({ state: 'record_refused', problem: { code: 'NOT_NOW' } });
      expect(await paymentsOf(2)).toEqual([]);
      expect((await order(2))!['status']).toBe('cancelled');
    });

    it('a record that will not move to paid is written down and flagged for a person', async () => {
      // The app's own rule refuses the move to placed for an order of 100 or more.
      await s.rows(`INSERT INTO ${real('orders')} (id, number, email, total, balance, status) VALUES (3, 'C-3', 'cy@crumbandco.de', 500.00, 500.00, 'paying')`);
      const attempt = await paid(3, '500.00');
      expect(await record(attempt)).toMatchObject({ state: 'recorded' });
      expect(await paymentsOf(3)).toHaveLength(1);
      expect((await order(3))!['status']).toBe('paying');
      const flag = attemptFlag((await paymentAttemptsRepo(s.meta).byId(attempt.id))!);
      expect(flag).toMatchObject({ code: 'status-refused', reason: 'STATUS_REFUSED' });
    });

    it('an unpaid hold waits while its payment is landing, and lapses once it is not', async () => {
      const past = dialect === 'mysql' ? '2026-01-01 08:00:00' : '2026-01-01T08:00:00Z';
      await s.rows(`INSERT INTO ${real('orders')} (id, number, email, total, balance, status, held_until) VALUES (5, 'C-5', 'eve@crumbandco.de', 9.00, 9.00, 'paying', '${past}'), (6, 'C-6', 'fay@crumbandco.de', 9.00, 9.00, 'paying', '${past}')`);
      // Order 5: the bank is still confirming its payment. Order 6: nobody paid.
      const landing = await paid(5, '9.00');
      await paymentAttemptsRepo(s.meta).move(landing.id, 'recording', {});
      const tick = () => runTimedMoves({ meta: s.meta, manager: s.manager, app: s.app }, s.connectionId, {}, new Date(landing.createdAt + 60_000));
      await tick();
      expect([(await order(5))!['status'], (await order(6))!['status']]).toEqual(['paying', 'cancelled']);
      // Hours later the payment has still not settled: the hold lapses, and the money goes to a person.
      await runTimedMoves({ meta: s.meta, manager: s.manager, app: s.app }, s.connectionId, {}, new Date(landing.createdAt + PAYMENT_WAIT_MS + 60_000));
      expect((await order(5))!['status']).toBe('cancelled');
    });

    it('a record that stops being payable ends its open pay page', async () => {
      await s.rows(`INSERT INTO ${real('orders')} (id, number, email, total, balance, status) VALUES (7, 'C-7', 'gus@crumbandco.de', 4.00, 4.00, 'paying')`);
      const ref = { kind: 'profile' as const, connectionId: s.connectionId, tableName: s.t('orders'), rowKey: '7' };
      const attempts = paymentAttemptsRepo(s.meta);
      // A guest on the (demo) service's page.
      const open = (await attempts.create({ provider: 'demo', mode: 'test', accountId: 'demo', payable: ref, payableLabel: 'C-7', amount: '4.00', currency: 'EUR', linkId: null, nonce: `nonce-${dialect}-left`.padEnd(22, 'x'), createdBy: null }))!;
      await attempts.move(open.id, 'open', { providerRef: 'demo_ref' });
      const sources = createPayableSources({ meta: s.meta, manager: s.manager });
      const deps = { meta: s.meta, sources, providerFor: async () => ({ ok: false }) as never };
      // Still paying: nothing ends.
      expect(await endLeftPages(deps, ref)).toBe(0);
      // The kitchen cancels: the write queues the job, and the job ends the page.
      await s.rows(`UPDATE ${real('orders')} SET status = 'cancelled' WHERE id = 7`);
      expect(await endLeftPages(deps, ref)).toBe(1);
      expect((await attempts.byId(open.id))!.state).toBe('expired');
      expect(await paymentLinksRepo(s.meta).currentFor(ref)).toBeNull();
    });

    it('never ends a page that already took the money, nor a checkout still being made', async () => {
      await s.rows(`INSERT INTO ${real('orders')} (id, number, email, total, balance, status) VALUES (10, 'C-10', 'jo@crumbandco.de', 4.00, 4.00, 'cancelled')`);
      const ref = { kind: 'profile' as const, connectionId: s.connectionId, tableName: s.t('orders'), rowKey: '10' };
      const attempts = paymentAttemptsRepo(s.meta);
      const taken = (await attempts.create({ provider: 'payments-stripe', mode: 'live', accountId: 'acct', payable: ref, payableLabel: 'C-10', amount: '4.00', currency: 'EUR', linkId: null, nonce: `nonce-${dialect}-taken`.padEnd(22, 'x'), createdBy: null }))!;
      await attempts.move(taken.id, 'open', { providerRef: 'cs_taken' });
      const completed = { ok: true, provider: { expire: async () => ({ ok: false, code: 'ALREADY_COMPLETED', providerMessage: 'paid', retryable: false }) } } as never;
      const sources = createPayableSources({ meta: s.meta, manager: s.manager });
      expect(await endLeftPages({ meta: s.meta, sources, providerFor: async () => completed }, ref)).toBe(0);
      expect((await attempts.byId(taken.id))!.state).toBe('open');
      // A checkout still being made: its own run ends it or hands its page out.
      await attempts.move(taken.id, 'expired', {});
      const making = (await attempts.create({ provider: 'payments-stripe', mode: 'test', accountId: 'acct', payable: ref, payableLabel: 'C-10', amount: '4.00', currency: 'EUR', linkId: null, nonce: `nonce-${dialect}-making`.padEnd(22, 'x'), createdBy: null }))!;
      expect(await endLeftPages({ meta: s.meta, sources, providerFor: async () => completed }, ref)).toBe(0);
      expect((await attempts.byId(making.id))!.state).toBe('creating');
    });

    it('a write through Adminium that takes a record out of paying queues the job', async () => {
      await s.rows(`INSERT INTO ${real('orders')} (id, number, email, total, balance, status) VALUES (8, 'C-8', 'hal@crumbandco.de', 4.00, 4.00, 'paying')`);
      const ref = { kind: 'profile' as const, connectionId: s.connectionId, tableName: s.t('orders'), rowKey: '8' };
      const attempts = paymentAttemptsRepo(s.meta);
      const open = (await attempts.create({ provider: 'demo', mode: 'test', accountId: 'demo', payable: ref, payableLabel: 'C-8', amount: '4.00', currency: 'EUR', linkId: null, nonce: `nonce-${dialect}-write`.padEnd(22, 'x'), createdBy: null }))!;
      await attempts.move(open.id, 'open', { providerRef: 'demo_ref_8' });
      const cancelled = await s.change('owner', 'orders', 8, { status: 'cancelled' });
      expect(cancelled.statusCode, cancelled.body).toBeLessThan(300);
      const queued = await s.meta.db.selectFrom('adminium_jobs').select(['kind', 'payload']).where('kind', '=', 'payments.row-left').execute();
      expect(queued.map((job) => (typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload) as { rowKey: string }).map((payload) => payload.rowKey)).toContain('8');
      await s.jobs();
      expect((await attempts.byId(open.id))!.state).toBe('expired');
    });

    it('a run that took over from one that died after moving the record says so again: the mail goes once', async () => {
      await s.rows(`INSERT INTO ${real('orders')} (id, number, email, total, balance, status) VALUES (9, 'C-9', 'ivy@crumbandco.de', 3.00, 3.00, 'paying')`);
      const attempt = await paid(9, '3.00');
      await paymentAttemptsRepo(s.meta).move(attempt.id, 'recording', {});
      // The run that died wrote the payment and moved the order, and never announced it.
      await s.rows(`INSERT INTO ${real('order_payments')} (id, order_id, amount, method, payment_ref, provider) VALUES (90, 9, 3.00, 'online', '${attempt.id}', 'Stripe')`);
      await s.rows(`UPDATE ${real('orders')} SET status = 'placed', paid = 3.00, balance = 0 WHERE id = 9`);
      await s.emails();
      expect(await record(attempt)).toMatchObject({ state: 'recorded', already: true });
      await s.jobs();
      expect((await s.emails()).map((mail) => mail.subject)).toEqual(['Order C-9 is paid']);
      // A third run says nothing new.
      await paymentAttemptsRepo(s.meta).move(attempt.id, 'recording', {}).catch(() => false);
      await record(attempt);
      await s.jobs();
      expect(await s.emails()).toEqual([]);
    });

    it("the pay page offers the way back to the app's own customer side, never to an address the request carried", async () => {
      await settingsRepo(s.meta).set('system.publicOrigin', 'https://shop.crumbandco.de');
      await s.rows(`INSERT INTO ${real('orders')} (id, number, email, total, balance, status) VALUES (11, 'C-11', 'kit@crumbandco.de', 2.00, 2.00, 'paying')`);
      const ref = { kind: 'profile' as const, connectionId: s.connectionId, tableName: s.t('orders'), rowKey: '11' };
      const minted = await mintLink(s.meta, linkSealFromSecret(TEST_SECRET), { payable: ref, mode: 'test', createdBy: null }, Date.now());
      const page = await s.app.inject({ method: 'GET', url: `/pay/api/${minted.token}`, headers: { cookie: s.cookie['owner']!, host: 'evil.example' } });
      expect(page.statusCode, page.body).toBe(200);
      expect(page.json()).toMatchObject({ back: { url: 'https://shop.crumbandco.de/apps/counter/customer/orders', app: 'Counter' } });
    });

    it("a rehearsal: the orders a payments manager makes are sample rows, and a test payment on one is written like a real one", async () => {
      // Rehearsed before anyone switches the app on for real money: every step of a test payment reads it as on.
      const [profile] = await payableProfilesRepo(s.meta).list(s.connectionId);
      await payableProfilesRepo(s.meta).update(profile!.id, { enabled: false });
      onTestFinished(async () => {
        await payableProfilesRepo(s.meta).update(profile!.id, { enabled: true });
      });
      // The rehearsing person's mail goes to them: an address the sender would really mail.
      const owner = (await usersRepo(s.meta).findByEmail((await usersRepo(s.meta).list()).find((user) => user.email.startsWith('owner@'))!.email))!;
      await s.meta.db.updateTable('adminium_users').set({ email: 'rehearsal-owner@crumbandco.de' }).where('id', '=', owner.id).execute();
      onTestFinished(async () => {
        await s.meta.db.updateTable('adminium_users').set({ email: owner.email }).where('id', '=', owner.id).execute();
      });
      expect((await s.send('owner', 'PUT', '/api/v1/payments/rehearsal', { on: true })).statusCode).toBe(200);
      // An order made on the staff screen while rehearsing.
      const made = await s.make('owner', 'orders', { id: 20, number: 'R-1', email: 'mo@crumbandco.de', total: '7.00', balance: '7.00', status: 'paying' });
      expect(made.statusCode, made.body).toBeLessThan(300);
      const ledger = `${real('orders').slice(0, real('orders').length - 'orders'.length)}sample_data`;
      const listed = async () => (await s.rows(`SELECT table_ref, pk FROM ${ledger}`)).map((row) => `${String(row['table_ref'])} ${String(row['pk'])}`);
      expect(await listed()).toEqual([expect.stringContaining('orders {"id":20}')]);
      // A test payment on it lands in the app's own tables, and goes in the sample list with it.
      const attempts = paymentAttemptsRepo(s.meta);
      const ref = { kind: 'profile' as const, connectionId: s.connectionId, tableName: s.t('orders'), rowKey: '20' };
      const test = (await attempts.create({ provider: 'demo', mode: 'test', accountId: 'demo', payable: ref, payableLabel: 'R-1', amount: '7.00', currency: 'EUR', linkId: null, nonce: `nonce-${dialect}-rehearse`.padEnd(22, 'x'), createdBy: null }))!;
      await attempts.move(test.id, 'open', { providerRef: 'demo_r' });
      await attempts.move(test.id, 'succeeded', { takenAmount: '7.00', takenCurrency: 'EUR', paymentRef: 'demo_pi_r', paidWith: { method: 'card', label: 'Demo', delayed: false } });
      await s.jobs();
      await s.emails();
      expect(await record(test)).toMatchObject({ state: 'recorded' });
      expect(await paymentsOf(20)).toEqual([expect.objectContaining({ payment_ref: test.id })]);
      expect((await order(20))!['status']).toBe('placed');
      // Its paid mail goes to the person rehearsing, marked TEST: never to the address the order carries.
      await s.jobs();
      expect((await s.emails()).map((mail) => [mail.to, mail.subject])).toEqual([['rehearsal-owner@crumbandco.de', '[TEST] Order R-1 is paid']]);
      expect((await listed()).filter((line) => line.includes('order_payments'))).toHaveLength(1);

      // A real order is never paid in test mode: its test payment stays in Adminium's own records.
      await s.rows(`INSERT INTO ${real('orders')} (id, number, email, total, balance, status) VALUES (21, 'C-21', 'nan@crumbandco.de', 3.00, 3.00, 'paying')`);
      const real21 = { ...ref, rowKey: '21' };
      const other = (await attempts.create({ provider: 'demo', mode: 'test', accountId: 'demo', payable: real21, payableLabel: 'C-21', amount: '3.00', currency: 'EUR', linkId: null, nonce: `nonce-${dialect}-real`.padEnd(22, 'x'), createdBy: null }))!;
      await attempts.move(other.id, 'open', { providerRef: 'demo_x' });
      await attempts.move(other.id, 'succeeded', { takenAmount: '3.00', takenCurrency: 'EUR', paymentRef: 'demo_pi_x', paidWith: { method: 'card', label: 'Demo', delayed: false } });
      expect(await record(other)).toMatchObject({ state: 'recorded', key: expect.stringMatching(/^kept:/) });
      expect(await paymentsOf(21)).toEqual([]);

      // Rehearsal off: what the person makes is theirs again.
      expect((await s.send('owner', 'PUT', '/api/v1/payments/rehearsal', { on: false })).statusCode).toBe(200);
      expect((await s.make('owner', 'orders', { id: 22, number: 'C-22', email: 'oz@crumbandco.de', total: '1.00', balance: '1.00', status: 'paying' })).statusCode).toBeLessThan(300);
      expect((await listed()).some((line) => line.includes('{"id":22}'))).toBe(false);
    });

    it('moves a record to paid only from the states the app names', async () => {
      // A payable that says nothing of when it may be paid: a cancelled order still takes money, and stays cancelled.
      const [profile] = await payableProfilesRepo(s.meta).list(s.connectionId);
      const { payableWhen: _left, ...rest } = profile!.mapping!;
      await payableProfilesRepo(s.meta).update(profile!.id, { mapping: rest });
      await s.rows(`INSERT INTO ${real('orders')} (id, number, email, total, balance, status) VALUES (4, 'C-4', 'dee@crumbandco.de', 6.00, 6.00, 'cancelled')`);
      const attempt = await paid(4, '6.00');
      expect(await record(attempt)).toMatchObject({ state: 'recorded' });
      expect(await paymentsOf(4)).toHaveLength(1);
      expect((await order(4))!['status']).toBe('cancelled');
      expect(attemptFlag((await paymentAttemptsRepo(s.meta).byId(attempt.id))!)).toBeNull();
    });
  });
}
