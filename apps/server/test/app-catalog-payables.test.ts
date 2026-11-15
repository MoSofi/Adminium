// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A CATALOG APP SAYS WHICH OF ITS TABLES ARE PAYABLE, on SQLite, Postgres and MySQL.
 *
 * An app from the catalog may carry `payments.payables` (never the ways to pay
 * or the pay page, which are the shop's). Installing it asks for no payments
 * right: its payables arrive switched off, for someone who manages payments to
 * switch on. Each is checked against the tables the install made, as the
 * payments screen checks a person's mapping, and one that fails is not made.
 * An update that changes how its money lands switches the app off again and
 * tells the payment managers; one that changes nothing leaves the switch alone.
 */
import { appAfterInstallRepo, notificationsRepo, payableProfilesRepo, permissionsRepo, rolesRepo, usersRepo } from '@adminium/meta';
import type { Manifest } from '@adminium/manifest';
import { afterEach, describe, expect, it } from 'vitest';

import { savedPartsRefusal } from '../src/apps/saved-parts.js';
import { grantsFromMatrixRows, isGranted } from '../src/rbac/permissions.js';
import { addOnHarness, appManifest, ENGINES, type Harness } from './app-add-ons.helpers.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a manifest read and changed freely
type Doc = Record<string, any>;

const money = (ref: string) => ({ ref, type: 'decimal', scale: 2, default: 0 });

function counter(version = '1.0.0', methodValues: Record<string, string> = { card: 'online' }): Doc {
  return appManifest('counter', {
    name: 'Counter',
    version,
    compatibility: { minAdminiumVersion: '0.3.60', engines: ['postgres', 'mysql', 'sqlite'] },
    requiredSchema: {
      tables: [
        {
          ref: 'orders',
          columns: [
            { ref: 'id', type: 'int', role: 'pk' },
            { ref: 'number', type: 'text', maxLength: 40 },
            { ref: 'email', type: 'text', maxLength: 200, nullable: true },
            money('total'),
            money('balance'),
            { ref: 'status', type: 'enum', enum: ['paying', 'placed', 'cancelled'], default: 'placed' },
          ],
        },
        {
          ref: 'order_payments',
          columns: [
            { ref: 'id', type: 'int', role: 'pk' },
            { ref: 'order_id', type: 'fk', references: 'orders' },
            money('amount'),
            { ref: 'paid_on', type: 'date', nullable: true },
            { ref: 'method', type: 'enum', enum: ['cash', 'online'], default: 'cash' },
            { ref: 'payment_ref', type: 'text', maxLength: 64, nullable: true, unique: true },
            { ref: 'provider', type: 'text', maxLength: 64, nullable: true },
          ],
        },
      ],
    },
    pages: [{ ref: 'counter-orders', template: 'page-crud', title: { key: 'c.orders', fallback: 'Orders' }, nav: { group: 'manifest:counter', icon: 'list', order: 1 }, bindings: { main: 'orders' } }],
    payments: {
      payables: [
        {
          table: 'orders',
          label: 'number',
          amount: { column: 'total' },
          currency: { fixed: 'EUR' },
          due: { column: 'balance' },
          payments: { kind: 'table', table: 'order_payments', link: 'order_id', amount: 'amount', date: 'paid_on', method: { column: 'method', values: methodValues }, reference: 'payment_ref', provider: 'provider' },
          status: { column: 'status', paid: 'placed', from: ['paying'] },
          customerEmail: 'email',
          pageFields: ['number', 'total'],
          payableWhen: [{ column: 'status', eq: 'paying' }],
          returnTo: '/orders',
          receipt: 'app',
          instantOnly: true,
        },
      ],
    },
  });
}

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`a catalog app's payables [${dialect}]`, () => {
    let h: Harness | null = null;
    afterEach(async () => {
      await h?.close();
      h = null;
    });
    const profile = async () => (await payableProfilesRepo(h!.meta).list(h!.connectionId)).filter((one) => one.ownerApp === 'counter');

    it('arrive switched off, with what the app says beyond the mapping', async () => {
      h = await addOnHarness(dialect, { unbuiltWords: {} });
      await h.stageApp(counter());
      const installed = await h.install('counter', '1.0.0');
      expect(installed.statusCode, installed.body).toBe(200);
      const [made] = await profile();
      expect(made).toMatchObject({ ownerApp: 'counter', enabled: false });
      expect(made!.mapping).toMatchObject({
        status: { column: 'status', paid: 'placed', from: ['paying'] },
        payments: { kind: 'table', reference: 'payment_ref', provider: 'provider', date: 'paid_on' },
        payableWhen: [{ column: 'status', eq: 'paying' }],
        returnTo: '/orders',
        receipt: 'app',
        instantOnly: true,
      });
      // The install's list says what is left: someone who manages payments switches the app on.
      const install = await h.meta.db.selectFrom('adminium_manifests').select('id').where('manifestKey', '=', 'counter').executeTakeFirstOrThrow();
      expect((await appAfterInstallRepo(h.meta).list(install.id)).map((row) => [row.kind, row.item])).toContainEqual(['payments-switch', 'counter']);
    });

    it('keep refunds as the app\'s own rows, and the moves that refund by themselves, by their tables here', async () => {
      h = await addOnHarness(dialect, { unbuiltWords: {} });
      const doc = counter();
      const tables = (doc['requiredSchema'] as { tables: Doc[] }).tables;
      (tables[0]!['columns'] as Doc[]).push({ ref: 'pickup_at', type: 'timestamptz', nullable: true });
      tables.push(
        { ref: 'settings', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'auto_refund', type: 'bool', default: true }, { ref: 'late_hours', type: 'int', default: 2 }] },
        {
          ref: 'order_refunds',
          columns: [
            { ref: 'id', type: 'int', role: 'pk' },
            { ref: 'payment_id', type: 'fk', references: 'order_payments' },
            money('amount'),
            { ref: 'method', type: 'enum', enum: ['cash', 'online'], default: 'cash' },
            { ref: 'provider_ref', type: 'text', maxLength: 255, nullable: true },
            { ref: 'refund_state', type: 'text', maxLength: 16, nullable: true },
          ],
        },
      );
      const payable = ((doc['payments'] as Doc)['payables'] as Doc[])[0]!;
      payable['refunds'] = { model: 'rows', table: 'order_refunds', payment: 'payment_id', amount: 'amount', when: [{ column: 'method', eq: 'online' }], providerRef: 'provider_ref', state: 'refund_state', openIn: '/orders', auto: { values: { method: 'online' } } };
      payable['refundOn'] = { moves: [{ from: ['placed'], to: 'cancelled', by: ['customer', 'system'] }], switch: { table: 'settings', column: 'auto_refund' }, before: { column: 'pickup_at', hours: { table: 'settings', column: 'late_hours' } } };
      await h.stageApp(doc);
      const installed = await h.install('counter', '1.0.0');
      expect(installed.statusCode, installed.body).toBe(200);
      const [made] = await profile();
      expect(made!.mapping).toMatchObject({
        refunds: { model: 'rows', table: expect.stringMatching(/order_refunds$/), payment: 'payment_id', providerRef: 'provider_ref', state: 'refund_state', openIn: '/orders', auto: { values: { method: 'online' } } },
        refundOn: { moves: [{ from: ['placed'], to: 'cancelled', by: ['customer', 'system'] }], switch: { table: expect.stringMatching(/settings$/), column: 'auto_refund' }, before: { column: 'pickup_at', hours: { table: expect.stringMatching(/settings$/), column: 'late_hours' } } },
      });
    });

    it("give the app's refund right to the roles it names, each ticked on the check; an unticked one is never given it, nor on update", async () => {
      h = await addOnHarness(dialect, { unbuiltWords: {} });
      const doc = counter();
      doc['roles'] = [
        { key: 'manager', name: 'Manager', permissions: ['table:@orders:read', 'payments:@:refund'] },
        { key: 'cashier', name: 'Cashier', permissions: ['table:@orders:read'] },
        { key: 'deputy', name: 'Deputy', permissions: ['table:@orders:read', 'payments:@:refund'] },
      ];
      const planned = await h.plan(doc);
      expect(planned.statusCode, planned.body).toBe(200);
      expect((planned.json() as { plan: Record<string, unknown> }).plan['refundGrants']).toEqual([
        { role: 'counter-manager', roleName: 'Manager' },
        { role: 'counter-deputy', roleName: 'Deputy' },
      ]);
      const installed = await h.install('counter', '1.0.0', { refundsUnticked: ['counter-deputy'] });
      expect(installed.statusCode, installed.body).toBe(200);
      const grantsOf = async (slug: string) => {
        const role = (await rolesRepo(h!.meta).findBySlug(slug))!;
        return grantsFromMatrixRows(await permissionsRepo(h!.meta).listForRole(role.id));
      };
      expect(await grantsOf('counter-manager')).toContain('payments:counter:refund');
      expect(await grantsOf('counter-deputy')).not.toContain('payments:counter:refund');
      expect(await grantsOf('counter-cashier')).not.toContain('payments:counter:refund');
      // The app's right refunds the app's own payments only.
      expect(isGranted(new Set(await grantsOf('counter-manager')), 'payments:counter:refund')).toBe(true);
      expect(isGranted(new Set(await grantsOf('counter-manager')), 'payments:other:refund')).toBe(false);
      expect(isGranted(new Set(await grantsOf('counter-manager')), 'system:payments:refund')).toBe(false);
      // An update of the same roles gives the unticked role nothing.
      await h.stageApp({ ...counter('1.1.0'), roles: doc['roles'] });
      const updated = await h.inject({ method: 'POST', url: '/apps/counter/update', payload: {} });
      expect(updated.statusCode, updated.body).toBe(200);
      expect(await grantsOf('counter-deputy')).not.toContain('payments:counter:refund');
    });

    it('a payable the payments screen would refuse is not made', async () => {
      h = await addOnHarness(dialect, { unbuiltWords: {} });
      // An online payment would be written as "card", which the method column does not hold.
      await h.stageApp(counter('1.0.0', { card: 'card' }));
      expect((await h.install('counter', '1.0.0')).statusCode).toBe(200);
      expect(await profile()).toEqual([]);
    });

    it('an update that moves the money switches the app off and tells the payment managers; one that does not leaves it', async () => {
      h = await addOnHarness(dialect, { unbuiltWords: {} });
      await h.stageApp(counter());
      expect((await h.install('counter', '1.0.0')).statusCode).toBe(200);
      const [made] = await profile();
      await payableProfilesRepo(h.meta).update(made!.id, { enabled: true });

      // The same mapping again: the owner's switch stays on.
      await h.stageApp(counter('1.0.1'));
      expect((await h.inject({ method: 'POST', url: '/apps/counter/update', payload: {} })).statusCode).toBe(200);
      expect((await profile())[0]).toMatchObject({ id: made!.id, enabled: true });

      // Money now marks the order paid from a second state: off until someone looks.
      const moved = counter('1.0.2');
      moved['payments'].payables[0].status.from = ['paying', 'cancelled'];
      await h.stageApp(moved);
      const updated = await h.inject({ method: 'POST', url: '/apps/counter/update', payload: {} });
      expect(updated.statusCode, updated.body).toBe(200);
      const [after] = await profile();
      expect(after).toMatchObject({ id: made!.id, enabled: false });
      expect(after!.mapping!.status).toMatchObject({ from: ['paying', 'cancelled'] });
      const owner = (await usersRepo(h.meta).list())[0]!;
      const told = await notificationsRepo(h.meta).listForUser(owner.id);
      expect(told.map((one) => one.title)).toContain('Counter was switched off for payments');

      // A version whose payable no longer checks out: the table stays guarded, and its switch goes off.
      await payableProfilesRepo(h.meta).update(made!.id, { enabled: true });
      await h.stageApp(counter('1.0.3', { card: 'card' }));
      expect((await h.inject({ method: 'POST', url: '/apps/counter/update', payload: {} })).statusCode).toBe(200);
      expect((await profile())[0]).toMatchObject({ id: made!.id, enabled: false });
    });
  });
}

describe('who may install them', () => {
  it("a catalog app's payables ask for no payments right; a file made here still does", async () => {
    const holding = (held: string[]) => async (permission: string) => held.includes(permission);
    expect(await savedPartsRefusal(counter() as unknown as Manifest, holding([]))).toBeNull();
    const local = { ...counter(), publisher: { id: 'local', name: 'This Adminium' } } as unknown as Manifest;
    expect((await savedPartsRefusal(local, holding([])))?.message).toContain('payments');
  });
});
