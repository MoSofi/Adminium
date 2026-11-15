// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A PAYMENT TAKEN ONLINE IS WRITTEN BY THE PAYMENT ALONE, on SQLite, Postgres and MySQL.
 *
 * A payable's payments table holds two kinds of row: a payment a person
 * recorded by hand (cash, a card on the counter's own terminal), which stays
 * theirs to correct and remove; and a payment taken online, which Adminium
 * wrote once with the attempt id in the reference column and which only a
 * refund changes (`crud/payment-rows.ts`, the write service's `paymentRows`).
 *
 * Here a till's clerk holds every right on the payments table, as the apps'
 * roles do, and the Super Admin holds everything; neither may forge an online
 * row, edit one, void one or delete one, through a save, a multi-row change,
 * or the owner's code. The payment itself may, and an invoice shape's payments
 * part is guarded the same way with no profile at all.
 */
import { appTablesRepo, payableProfilesRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createWriteService, type WriteContext, type WriteTarget } from '../src/crud/write-service.js';
import { writeStores } from '../src/crud/write-stores.js';
import { createProjectDb } from '../src/project/code/db.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { LEGS, said, wholeServer, type WholeServer } from './whole-server.helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };
const money = (ref: string) => ({ ref, type: 'decimal', scale: 2, nullable: true });

function till(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'till',
    name: 'Till',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.till.desc', fallback: 'Till.' },
    categories: ['commerce'],
    compatibility: { minAdminiumVersion: '0.3.28', engines: ['postgres', 'mysql', 'sqlite'] },
    navGroups: [{ key: 'till', label: { 'en-US': 'Till' }, order: 1 }],
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'sales', columns: [id, money('total'), money('balance'), { ref: 'status', type: 'enum', enum: ['open', 'paid'], default: 'open' }] },
        {
          ref: 'sale_payments',
          columns: [
            id,
            { ref: 'sale_id', type: 'fk', references: 'sales' },
            money('amount'),
            { ref: 'paid_on', type: 'date', nullable: true },
            { ref: 'method', type: 'enum', enum: ['cash', 'card', 'online'], default: 'cash' },
            { ref: 'payment_ref', type: 'text', maxLength: 64, nullable: true, unique: true },
            { ref: 'provider', type: 'text', maxLength: 64, nullable: true },
            money('refunded'),
          ],
        },
      ],
    },
    roles: [
      {
        key: 'clerk',
        name: 'Clerk',
        permissions: ['table:@sales:read', 'table:@sales:update', 'table:@sale_payments:read', 'table:@sale_payments:create', 'table:@sale_payments:update', 'table:@sale_payments:delete', 'page:@till-sales:view'],
      },
    ],
    pages: [{ ref: 'till-sales', template: 'page-crud', title: { key: 't.sales', fallback: 'Sales' }, nav: { group: 'till', icon: 'list', order: 1 }, bindings: { rows: 'sales' } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  };
}

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`a payment taken online is written by the payment alone [${dialect}]`, () => {
    let s: WholeServer;
    const real = (ref: string): string => s.t(ref).slice(s.t(ref).lastIndexOf('.') + 1);
    const payment = async (key: number): Promise<Record<string, unknown> | undefined> =>
      (await s.rows(`SELECT amount, method, payment_ref, refunded FROM ${real('sale_payments')} WHERE id = ${String(key)}`))[0];
    const reason = (res: { body: string }): unknown => (JSON.parse(res.body) as { error?: { details?: { reason?: unknown } } }).error?.details?.reason;
    const target = async (): Promise<WriteTarget> => {
      const view = (await createPublicViews(s.meta).viewFor(s.connectionId))!;
      const handle = await s.manager.data(s.connectionId);
      return { connectionId: s.connectionId, view, table: view.table(s.t('sale_payments')), db: handle.db, dialect: handle.dialect, timezone: 'UTC' };
    };
    const person: WriteContext = { origin: 'dashboard', hops: 0, actor: { kind: 'user', id: 'usr_owner', label: 'Owner' }, request: null };

    beforeAll(async () => {
      s = await wholeServer(dialect, till(), { people: { cleo: ['clerk'] } });
      await s.rows(`INSERT INTO ${real('sales')} (id, total, balance, status) VALUES (1, 40.00, 40.00, 'open')`);
      await payableProfilesRepo(s.meta).create({
        connectionId: s.connectionId,
        tableName: s.t('sales'),
        mapping: {
          label: null,
          amount: { column: 'total', unit: null },
          currency: { fixed: 'EUR' },
          due: { column: 'balance' },
          payments: { kind: 'table', table: s.t('sale_payments'), link: 'sale_id', amount: 'amount', date: 'paid_on', method: { column: 'method', values: { card: 'online' } }, note: null, voided: null, reference: 'payment_ref', refunded: 'refunded' },
          status: { column: 'status', paid: 'paid', refunded: null },
          customerEmail: null,
          customerCountry: null,
          pageFields: [],
        },
        ownerApp: 'till',
        createdBy: null,
      });
      // A payment taken online, as the record job writes it.
      await s.rows(`INSERT INTO ${real('sale_payments')} (id, sale_id, amount, method, payment_ref, provider) VALUES (9, 1, 25.00, 'online', 'PAT01ONLINE', 'payments-stripe')`);
    }, 180_000);
    afterAll(async () => {
      await s?.close();
    });

    it('a payment a person records by hand stays theirs: made, corrected, removed', async () => {
      expect(said(await s.make('cleo', 'sale_payments', { id: 1, sale_id: 1, amount: '10.00', method: 'cash' }))).toBe('ok');
      expect(said(await s.change('cleo', 'sale_payments', 1, { amount: '12.00', refunded: '2.00' }))).toBe('ok');
      expect(await payment(1)).toMatchObject({ method: 'cash', payment_ref: null });
      expect(said(await s.send('cleo', 'DELETE', `/api/v1/data/${s.connectionId}/${s.t('sale_payments')}/1`))).toBe('ok');
      expect(await payment(1)).toBeUndefined();
      // One recorded by hand in Payments carries its retry key as its reference, and stays a person's.
      await s.rows(`INSERT INTO ${real('sale_payments')} (id, sale_id, amount, method, payment_ref) VALUES (8, 1, 3.00, 'cash', 'hand_k_0123456789abcdef')`);
      expect(said(await s.change('cleo', 'sale_payments', 8, { amount: '4.00' }))).toBe('ok');
      expect(said(await s.send('cleo', 'DELETE', `/api/v1/data/${s.connectionId}/${s.t('sale_payments')}/8`))).toBe('ok');
    });

    it('nobody forges one: the reference is filled by the payment alone', async () => {
      for (const who of ['cleo', 'owner']) {
        const forged = await s.make(who, 'sale_payments', { id: 2, sale_id: 1, amount: '40.00', method: 'online', payment_ref: 'PAT01FORGED' });
        expect(said(forged), forged.body).toBe('403 TABLE_FORBIDDEN');
        expect(reason(forged)).toBe('payment-column');
      }
      expect(await payment(2)).toBeUndefined();
      // Nor is a reference written onto a payment recorded by hand.
      expect(said(await s.make('cleo', 'sale_payments', { id: 3, sale_id: 1, amount: '5.00', method: 'cash' }))).toBe('ok');
      expect(said(await s.change('cleo', 'sale_payments', 3, { payment_ref: 'PAT01LATER' }))).toBe('403 TABLE_FORBIDDEN');
      expect(await payment(3)).toMatchObject({ payment_ref: null });
      await s.rows(`DELETE FROM ${real('sale_payments')} WHERE id = 3`);
    });

    it('nobody edits, voids or deletes one, whatever rights they hold', async () => {
      for (const who of ['cleo', 'owner']) {
        const edited = await s.change(who, 'sale_payments', 9, { amount: '1.00' });
        expect(said(edited), edited.body).toBe('403 TABLE_FORBIDDEN');
        expect(reason(edited)).toBe('online-payment');
        expect(said(await s.change(who, 'sale_payments', 9, { refunded: '25.00' }))).toBe('403 TABLE_FORBIDDEN');
        const removed = await s.send(who, 'DELETE', `/api/v1/data/${s.connectionId}/${s.t('sale_payments')}/9`);
        expect(said(removed), removed.body).toBe('403 TABLE_FORBIDDEN');
      }
      expect(await payment(9)).toMatchObject({ method: 'online', payment_ref: 'PAT01ONLINE' });
    });

    it('nor through a multi-row change, nor the owner\'s code', async () => {
      const writes = createWriteService(writeStores(s.meta));
      const at = await target();
      await expect(writes.beforeEach('update', at, person, [{ match: { id: 9 }, values: { amount: '1.00' } }])).rejects.toThrow('Only a refund changes it.');
      await expect(writes.beforeEach('delete', at, person, [{ match: { id: 9 }, values: {} }])).rejects.toThrow('Only a refund changes it.');
      await expect(writes.check('create', at, person, [{ id: 4, sale_id: 1, amount: '1.00', payment_ref: 'PAT01CHECK' }])).rejects.toThrow('Only Adminium fills payment_ref');
      await expect(writes.check('update', at, person, [{ id: 9, amount: '1.00' }])).rejects.toThrow('Only a refund changes it.');

      await s.meta.db.updateTable('adminium_connections').set({ projectKey: 'main' } as never).where('id', '=', s.connectionId).execute();
      const handle = await s.manager.data(s.connectionId);
      const db = createProjectDb({ app: s.app, meta: s.meta, manager: s.manager, writes: () => writes }, { database: 'main', raw: handle.db, dialect: handle.dialect, context: { ...person, origin: 'action' } });
      const rows = db.table(real('sale_payments'));
      await expect(rows.update(9, { amount: '1.00' })).rejects.toThrow('Only a refund changes it.');
      await expect(rows.insert({ id: 5, sale_id: 1, amount: '1.00', payment_ref: 'PAT01CODE' })).rejects.toThrow('Only Adminium fills payment_ref');
      expect(await payment(9)).toMatchObject({ amount: expect.anything(), payment_ref: 'PAT01ONLINE' });
      expect(Number((await payment(9))!['amount'])).toBe(25);
    });

    it('the payment itself writes it, and a refund changes it', async () => {
      const writes = createWriteService(writeStores(s.meta));
      const at = await target();
      const paying: WriteContext = { origin: 'payment', hops: 0, actor: { kind: 'system', id: null, label: 'Payments' }, request: null };
      await writes.create({ target: at, values: { id: 6, sale_id: 1, amount: '15.00', method: 'online', payment_ref: 'PAT01SECOND', provider: 'payments-paypal' }, context: paying, announce: async () => {} });
      await writes.update({ target: at, pk: { id: 9 }, values: { refunded: '5.00' }, context: paying, announce: async () => {} });
      expect(await payment(6)).toMatchObject({ method: 'online', payment_ref: 'PAT01SECOND' });
      expect(Number((await payment(9))!['refunded'])).toBe(5);
    });

    it("an invoice shape's payments part is guarded with no profile at all", async () => {
      await s.meta.db.deleteFrom('adminium_payable_profiles').execute();
      // With no payable naming it, the table is anybody's again…
      expect(said(await s.change('owner', 'sale_payments', 9, { amount: '25.00' }))).toBe('ok');
      // …until it is an invoice's payments part, whose `payment_ref` and `provider` are the payment's.
      const record = (await appTablesRepo(s.meta).byTable(s.connectionId, real('sale_payments')))[0]!;
      await s.meta.db.updateTable('adminium_app_tables').set({ builtOn: 'invoices/invoice@2#payments' } as never).where('id', '=', record.id).execute();
      expect(said(await s.change('owner', 'sale_payments', 9, { amount: '1.00' }))).toBe('403 TABLE_FORBIDDEN');
      expect(said(await s.make('owner', 'sale_payments', { id: 7, sale_id: 1, amount: '1.00', provider: 'payments-stripe' }))).toBe('403 TABLE_FORBIDDEN');
      expect(said(await s.make('owner', 'sale_payments', { id: 7, sale_id: 1, amount: '1.00', method: 'cash' }))).toBe('ok');
    });
  });
}
