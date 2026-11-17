// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A REHEARSAL'S MAIL, on SQLite, Postgres and MySQL.
 *
 * A payments manager rehearses a shop's checkout: the orders they make are
 * sample rows, and the shop's mail about them goes to them alone, marked
 * TEST. That mail may carry what a customer's would — the order's own link
 * and a pay link — or the rehearsal shows nothing: the link is the order's
 * code, sent to them because the order is their rehearsal's own, and the pay
 * link is a TEST link (a rehearsal never has a live one).
 *
 * A REAL row's mail stays ordinary while someone rehearses: a note made on a
 * real order, or a message queued by hand about one, goes to the real
 * customer, unmarked, judged with payments as they really are — never to the
 * person rehearsing. Only a row of THEIR rehearsal (made in it, and a sample
 * row still) makes a mail theirs.
 *
 * Never anyone else's code: the code of a real customer's row is never mailed
 * to the person rehearsing, whether the message is addressed to them by hand,
 * or is about a row whose note outlived it; nor a row another person
 * rehearsed. A real customer's mail never carries a test link: with no live
 * payment service it has no pay button, as before.
 */
import { paymentLinksRepo, settingsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest';

import { noteRehearsalRow } from '../src/payments/rehearsal-state.js';
import { codeWithheldSentence } from '../src/outbox/sender.js';
import { LEGS, said, wholeServer, type QueuedEmail, type WholeServer } from './whole-server.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.63' }));

const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength = 120) => ({ ref, type: 'text', maxLength, nullable: true });
const code = (ref: string) => ({ ref, type: 'text', maxLength: 16, nullable: true, rules: { code: { length: 16 } } });
const template = (key: string, subject: string, lines: string[]) => ({
  key,
  name: key,
  locales: { 'en-US': { subject, blocks: lines.map((line) => ({ block: 'email.text', data: { text: line } })) } },
});

function shop(): Record<string, unknown> {
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
        { ref: 'settings', columns: [id, text('name', 80)] },
        // A customer's account: its own link signs them in.
        { ref: 'customers', columns: [id, text('name', 80), text('email', 200), code('portal_token')] },
        {
          ref: 'orders',
          columns: [
            id,
            text('number', 40),
            text('email', 200),
            { ref: 'customer_id', type: 'fk', references: 'customers', nullable: true },
            // The order's own link: the customer's way back to it.
            code('link_token'),
            { ref: 'total', type: 'money', default: 0 },
            { ref: 'paid', type: 'money', nullable: true, rules: { rollup: { from: 'order_payments', via: 'order_id', sum: 'amount', balance: { column: 'balance', of: 'total' } } } },
            { ref: 'balance', type: 'money', nullable: true },
            { ref: 'status', type: 'enum', enum: ['paying', 'placed'], default: 'paying' },
          ],
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
        // A note the desk writes on an order.
        { ref: 'order_notes', columns: [id, { ref: 'order_id', type: 'fk', references: 'orders' }, text('body', 200)] },
        {
          ref: 'messages',
          columns: [
            id,
            { ref: 'kind', type: 'enum', enum: ['order-placed', 'order-account', 'order-noted', 'order-noted-online'] },
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
      kinds: { 'order-placed': 'counter-order-placed', 'order-account': 'counter-order-account', 'order-noted': 'counter-order-noted', 'order-noted-online': 'counter-order-noted-online' },
      classes: { 'order-placed': 'service', 'order-account': 'service', 'order-noted': 'service', 'order-noted-online': 'service' },
      producers: [
        { kind: 'order-placed', link: 'order_id', onCreate: { table: 'orders' } },
        { kind: 'order-account', link: 'order_id', onCreate: { table: 'orders' } },
        { kind: 'order-noted', link: 'order_id', onCreate: { table: 'order_notes', via: 'order_id' } },
        // Only while the shop takes payments online: off here, except for a rehearsal's row.
        { kind: 'order-noted-online', link: 'order_id', onCreate: { table: 'order_notes', via: 'order_id' }, payments: 'on' },
      ],
    },
    emailTemplates: [
      template('counter-order-placed', 'Order {{order.number}}', ['Your order: {{order.link_token}}', 'Pay: {{pay_url}}']),
      template('counter-order-account', 'Your account', ['Sign in: {{customer.portal_token}}']),
      template('counter-order-noted', 'A note on {{order.number}}', ['Open {{order.link_token}}', 'Pay: {{pay_url}}']),
      template('counter-order-noted-online', 'Pay {{order.number}} online', ['Pay: {{pay_url}}']),
    ],
    // Each link opens its own row: an order by its link, an account by its own.
    publicKeys: { door: {}, account: {} },
    publicAccess: [
      { table: 'orders', methods: ['GET'], select: ['number'], claim: { by: 'token', column: 'link_token' }, key: 'door' },
      { table: 'customers', methods: ['GET'], select: ['name'], claim: { by: 'token', column: 'portal_token' }, key: 'account' },
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

const ORIGIN = 'https://shop.crumbandco.de';
const REHEARSER = 'rehearsal-owner@crumbandco.de';
const PAY = /https:\/\/shop\.crumbandco\.de\/pay\/[A-Za-z0-9_-]{22}/;

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`a rehearsal's mail [${dialect}]`, () => {
    let s: WholeServer;
    const real = (ref: string): string => s.t(ref).slice(s.t(ref).lastIndexOf('.') + 1);
    const ref = (key: unknown) => ({ kind: 'profile' as const, connectionId: s.connectionId, tableName: s.t('orders'), rowKey: String(key) });
    const tokenOf = async (table: string, key: unknown, column: string): Promise<string> =>
      String((await s.rows(`SELECT ${column} FROM ${real(table)} WHERE id = ${String(key)}`))[0]![column]);
    const messages = async (order: unknown) =>
      (await s.rows(`SELECT kind, status, to_address, error FROM ${real('messages')} WHERE order_id = ${String(order)} ORDER BY id`)).map((row) => ({
        kind: row['kind'],
        status: row['status'],
        to: row['to_address'],
        error: row['error'] ?? null,
      }));
    const made = async (who: string, table: string, values: Record<string, unknown>): Promise<number> => {
      const reply = await s.make(who, table, values);
      expect(said(reply), reply.body).toBe('ok');
      return Number((reply.json() as { data: { id: unknown } }).data.id);
    };
    const rehearse = async (on: boolean) => expect(said(await s.send('owner', 'PUT', '/api/v1/payments/rehearsal', { on }))).toBe('ok');
    /** Every message waiting goes now; the mail that went, by subject. */
    const sent = async (): Promise<QueuedEmail[]> => {
      await s.jobs();
      return s.emails();
    };
    let ownerId = '';

    beforeAll(async () => {
      s = await wholeServer(dialect, shop(), { smtp: true });
      await s.rows(`INSERT INTO ${real('settings')} (id, name) VALUES (1, 'Counter')`);
      await settingsRepo(s.meta).set('system.publicOrigin', ORIGIN);
      // The person rehearsing is mailed at an address the sender would really mail.
      ownerId = s.ids['owner']!;
      await s.meta.db.updateTable('adminium_users').set({ email: REHEARSER }).where('id', '=', ownerId).execute();
      // A real customer, on file before anyone rehearsed.
      await s.rows(`INSERT INTO ${real('customers')} (id, name, email, portal_token) VALUES (1, 'Ruth Okafor', 'ruth@okafor-studio.de', 'RUTHPORTALCODE01')`);
    }, 180_000);
    afterAll(async () => {
      await s?.close();
    });

    it("mails a real customer's order with its own link, and no pay button while no service is live", async () => {
      const order = await made('owner', 'orders', { number: 'C-1', email: 'ruth@okafor-studio.de', customer_id: 1, total: '12.00', balance: '12.00' });
      const mail = await sent();
      const link = await tokenOf('orders', order, 'link_token');
      const placed = mail.find((one) => one.subject === 'Order C-1')!;
      expect(placed.to).toBe('ruth@okafor-studio.de');
      expect(placed.text).toContain(`Your order: ${link}`);
      // Only a test service could take it: no live link, and never a test one for a real customer.
      expect(placed.text).not.toContain('/pay/');
      expect(await paymentLinksRepo(s.meta).currentFor(ref(order), 'public')).toBeNull();
      expect(await paymentLinksRepo(s.meta).currentFor(ref(order))).toBeNull();
    });

    it("mails the person rehearsing their rehearsal's order, marked TEST, with its own link and a TEST pay link", async () => {
      await rehearse(true);
      onTestFinished(() => rehearse(false));
      // A customer made in the rehearsal, and the order for them.
      const customer = await made('owner', 'customers', { name: 'Rehearsal Customer', email: 'mo@crumbandco.de' });
      const order = await made('owner', 'orders', { number: 'R-1', email: 'mo@crumbandco.de', customer_id: customer, total: '7.00', balance: '7.00' });
      const mail = await sent();
      expect(mail.map((one) => [one.to, one.subject]).sort()).toEqual([
        [REHEARSER, '[TEST] Order R-1'],
        [REHEARSER, '[TEST] Your account'],
      ]);
      const placed = mail.find((one) => one.subject === '[TEST] Order R-1')!;
      expect(placed.text).toContain(`Your order: ${await tokenOf('orders', order, 'link_token')}`);
      // The pay link is a test link the shop's own start would make: public, for an hour, the rehearsing person's.
      const url = PAY.exec(placed.text)?.[0];
      expect(url, placed.text).toBeDefined();
      const link = (await paymentLinksRepo(s.meta).currentFor(ref(order), 'public'))!;
      expect(link).toMatchObject({ mode: 'test', createdBy: ownerId, audience: 'public' });
      expect(link.expiresAt - link.createdAt).toBe(60 * 60_000);
      // The customer the rehearsal made: their account's link goes too.
      expect(mail.find((one) => one.subject === '[TEST] Your account')!.text).toContain(`Sign in: ${await tokenOf('customers', customer, 'portal_token')}`);
      expect(await messages(order)).toEqual([
        { kind: 'order-placed', status: 'sent', to: REHEARSER, error: null },
        { kind: 'order-account', status: 'sent', to: REHEARSER, error: null },
      ]);

      // Mailed again while that link still opens: the same link, so a pay page already open keeps working.
      expect(said(await s.make('owner', 'messages', { kind: 'order-placed', order_id: order, to_address: REHEARSER }))).toBe('ok');
      const again = (await sent()).find((one) => one.subject === '[TEST] Order R-1')!;
      expect(PAY.exec(again.text)?.[0]).toBe(url);

      // A note on the rehearsal's order: its mail is theirs too, and reads payments as on.
      await made('owner', 'order_notes', { order_id: order, body: 'Packed.' });
      const noted = await sent();
      expect(noted.map((one) => [one.to, one.subject]).sort()).toEqual([
        [REHEARSER, '[TEST] A note on R-1'],
        [REHEARSER, '[TEST] Pay R-1 online'],
      ]);
      expect(noted.find((one) => one.subject === '[TEST] A note on R-1')!.text).toContain(`Open ${await tokenOf('orders', order, 'link_token')}`);
      expect(PAY.exec(noted.find((one) => one.subject === '[TEST] Pay R-1 online')!.text)?.[0]).toBe(url);
    });

    it("keeps a real order's mail ordinary while rehearsing, and never mails the person rehearsing its code", async () => {
      await rehearse(true);
      onTestFinished(() => rehearse(false));
      const realOrder = Number((await s.rows(`SELECT id FROM ${real('orders')} WHERE number = 'C-1'`))[0]!['id']);
      const before = await messages(realOrder);
      const withheld = codeWithheldSentence(['order.link_token']);

      // A rehearsal's order for the real customer: its own link goes, the customer's account link never.
      const order = await made('owner', 'orders', { number: 'R-2', email: 'ruth@okafor-studio.de', customer_id: 1, total: '5.00', balance: '5.00' });
      await sent();
      expect(await messages(order)).toEqual([
        { kind: 'order-placed', status: 'sent', to: REHEARSER, error: null },
        { kind: 'order-account', status: 'failed', to: REHEARSER, error: codeWithheldSentence(['customer.portal_token']) },
      ]);

      // A note they make on the real order while rehearsing: the real order's ordinary mail, to its customer, unmarked,
      // with its own link — and none of what payments on would send, since they are off for real.
      await made('owner', 'order_notes', { order_id: realOrder, body: 'Called the customer.' });
      const noted = await sent();
      expect(noted.map((one) => [one.to, one.subject])).toEqual([['ruth@okafor-studio.de', 'A note on C-1']]);
      expect(noted[0]!.text).toContain(`Open ${await tokenOf('orders', realOrder, 'link_token')}`);
      expect(noted[0]!.text).not.toContain('/pay/');
      expect((await messages(realOrder)).slice(before.length)).toEqual([{ kind: 'order-noted', status: 'sent', to: 'ruth@okafor-studio.de', error: null }]);

      // A message about the real order they queue by hand, to nobody in particular: to the real customer, as always.
      expect(said(await s.make('owner', 'messages', { kind: 'order-placed', order_id: realOrder }))).toBe('ok');
      const queued = await sent();
      expect(queued.map((one) => [one.to, one.subject])).toEqual([['ruth@okafor-studio.de', 'Order C-1']]);
      expect(queued[0]!.text).toContain(`Your order: ${await tokenOf('orders', realOrder, 'link_token')}`);
      // …and to their own address by hand: an ordinary message to an address not on file, so its code is held back. Never TEST.
      expect(said(await s.make('owner', 'messages', { kind: 'order-placed', order_id: realOrder, to_address: REHEARSER }))).toBe('ok');
      expect(await sent()).toEqual([]);
      expect((await messages(realOrder)).slice(before.length + 1)).toEqual([
        { kind: 'order-placed', status: 'sent', to: 'ruth@okafor-studio.de', error: null },
        { kind: 'order-placed', status: 'failed', to: REHEARSER, error: withheld },
      ]);

      // A note that names the real order as theirs (one that outlived its sample row, its key used again): it is no sample row, so nothing.
      await noteRehearsalRow(s.meta, s.connectionId, s.t('orders'), { id: realOrder }, ownerId);
      await s.rows(`INSERT INTO ${real('orders')} (id, number, email, customer_id, link_token, total, balance, status) VALUES (90, 'C-90', 'ruth@okafor-studio.de', 1, 'RUTHORDERCODE090', 3.00, 3.00, 'paying')`);
      await noteRehearsalRow(s.meta, s.connectionId, s.t('orders'), { id: 90 }, ownerId);
      await made('owner', 'order_notes', { order_id: 90, body: 'Called again.' });
      const stale = await sent();
      expect(stale.map((one) => [one.to, one.subject])).toEqual([['ruth@okafor-studio.de', 'A note on C-90']]);
      expect(stale[0]!.text).toContain('Open RUTHORDERCODE090');
      expect(said(await s.make('owner', 'messages', { kind: 'order-placed', order_id: realOrder, to_address: REHEARSER }))).toBe('ok');
      await sent();
      expect((await messages(realOrder)).at(-1)).toEqual({ kind: 'order-placed', status: 'failed', to: REHEARSER, error: withheld });

      // A rehearsal's order that is another person's rehearsal: never this person's to be mailed.
      const theirs = await made('owner', 'orders', { number: 'R-3', email: 'mo@crumbandco.de', total: '4.00', balance: '4.00' });
      await sent();
      await noteRehearsalRow(s.meta, s.connectionId, s.t('orders'), { id: theirs }, 'usr_someone_else');
      expect(said(await s.make('owner', 'messages', { kind: 'order-placed', order_id: theirs, to_address: REHEARSER }))).toBe('ok');
      await sent();
      expect((await messages(theirs)).at(-1)).toEqual({ kind: 'order-placed', status: 'failed', to: REHEARSER, error: withheld });

      // No pay link of any kind was made for the real order.
      expect(await paymentLinksRepo(s.meta).currentFor(ref(realOrder), 'public')).toBeNull();
      expect(await paymentLinksRepo(s.meta).currentFor(ref(realOrder))).toBeNull();
    });

    it("mails a real order's own link only to its customer, rehearsal or not", async () => {
      const realOrder = Number((await s.rows(`SELECT id FROM ${real('orders')} WHERE number = 'C-1'`))[0]!['id']);
      const count = (await messages(realOrder)).length;
      // Addressed by hand to the person who would be rehearsing, with rehearsal off: not their code.
      expect(said(await s.make('owner', 'messages', { kind: 'order-placed', order_id: realOrder, to_address: REHEARSER }))).toBe('ok');
      // …and to the customer's own address: it goes, as always.
      expect(said(await s.make('owner', 'messages', { kind: 'order-placed', order_id: realOrder, to_address: 'ruth@okafor-studio.de' }))).toBe('ok');
      const mail = await sent();
      expect((await messages(realOrder)).slice(count)).toEqual([
        { kind: 'order-placed', status: 'failed', to: REHEARSER, error: codeWithheldSentence(['order.link_token']) },
        { kind: 'order-placed', status: 'sent', to: 'ruth@okafor-studio.de', error: null },
      ]);
      expect(mail.map((one) => [one.to, one.subject])).toEqual([['ruth@okafor-studio.de', 'Order C-1']]);
      expect(mail[0]!.text).not.toContain('/pay/');
    });
  });
}
