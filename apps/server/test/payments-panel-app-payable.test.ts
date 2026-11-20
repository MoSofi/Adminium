// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE PAYMENT PANEL OF AN APP'S PAYABLE, on SQLite, Postgres and MySQL.
 *
 * An app whose payments table keeps the moment a payment was paid
 * (`paidAt`) and no day of its own, and the service that took it
 * (`provider`): the record page's panel shows each payment with its day and
 * its service, read from those columns, as it does for an invoice the shape
 * maps. Before, it showed neither.
 *
 * And it tells no money to someone whose read of the record leaves the money
 * out: a packer who reads a quote's number and nothing of its total or what
 * is due sees no panel, no row state in a list, and may not record a payment, make a pay link or take a charge on a card reader.
 */
import { paymentAttemptsRepo, payableProfilesRepo, type PaymentAttempt } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createPayableSources } from '../src/payments/payables.js';
import { recordAttempt } from '../src/payments/record.js';
import { LEGS, wholeServer, type WholeServer } from './whole-server.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.60' }));

const id = { ref: 'id', type: 'int', role: 'pk' };

function quotes(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'quoting',
    name: 'Quoting',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.quoting.desc', fallback: 'Quotes.' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: '0.3.60', engines: ['postgres', 'mysql', 'sqlite'] },
    navGroups: [{ key: 'quoting', label: { 'en-US': 'Quoting' }, order: 1 }],
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'quotes',
          columns: [
            id,
            { ref: 'number', type: 'text', maxLength: 40, nullable: true },
            { ref: 'total', type: 'money', default: 0 },
            { ref: 'paid', type: 'money', nullable: true, rules: { rollup: { from: 'quote_payments', via: 'quote_id', sum: 'amount', balance: { column: 'due', of: 'total' } } } },
            { ref: 'due', type: 'money', nullable: true },
          ],
        },
        {
          ref: 'quote_payments',
          columns: [
            id,
            { ref: 'quote_id', type: 'fk', references: 'quotes' },
            { ref: 'amount', type: 'money', default: 0 },
            // The moment only: no day of its own.
            { ref: 'paid_at', type: 'timestamptz', nullable: true },
            { ref: 'method', type: 'enum', enum: ['cash', 'online'], default: 'cash' },
            { ref: 'payment_ref', type: 'text', maxLength: 64, nullable: true, unique: true },
            { ref: 'provider', type: 'text', maxLength: 40, nullable: true },
          ],
        },
      ],
    },
    roles: [
      { key: 'manager', name: 'Manager', permissions: ['app:@:staff', 'table:@quotes:read', 'table:@quotes:update', 'table:@quote_payments:read', 'table:@quote_payments:create', 'page:@quoting-quotes:view'] },
      // Reads a quote's number and nothing of its money; may change it (its number), and add payments.
      {
        key: 'packer',
        name: 'Packer',
        permissions: ['app:@:staff', 'table:@quotes:read', 'table:@quotes:update', 'table:@quote_payments:read', 'table:@quote_payments:create', 'page:@quoting-quotes:view'],
        limits: { quotes: { readable: ['number'], writable: ['number'] } },
      },
      // Reads the total but not what is due: the due is money too.
      { key: 'half', name: 'Half', permissions: ['app:@:staff', 'table:@quotes:read', 'page:@quoting-quotes:view'], limits: { quotes: { readable: ['number', 'total'] } } },
    ],
    pages: [{ ref: 'quoting-quotes', template: 'page-crud', title: { key: 't.quotes', fallback: 'Quotes' }, nav: { group: 'quoting', icon: 'list', order: 1 }, bindings: { rows: 'quotes' } }],
    payments: {
      payables: [
        {
          table: 'quotes',
          label: 'number',
          amount: { column: 'total' },
          currency: { fixed: 'EUR' },
          due: { column: 'due' },
          payments: { kind: 'table', table: 'quote_payments', link: 'quote_id', amount: 'amount', paidAt: 'paid_at', method: { column: 'method', values: { '*': 'online' } }, reference: 'payment_ref', provider: 'provider' },
        },
      ],
    },
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  };
}

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`the payment panel of an app's payable [${dialect}]`, () => {
    let s: WholeServer;
    const real = (ref: string): string => s.t(ref).slice(s.t(ref).lastIndexOf('.') + 1);

    beforeAll(async () => {
      s = await wholeServer(dialect, quotes(), { people: { manager: ['manager'], packer: ['packer'], half: ['half'] } });
      const [profile] = await payableProfilesRepo(s.meta).list(s.connectionId);
      await payableProfilesRepo(s.meta).update(profile!.id, { enabled: true });
    }, 180_000);
    afterAll(async () => {
      await s?.close();
    });

    it('shows each online payment with the day it was paid and the service that took it', async () => {
      await s.rows(`INSERT INTO ${real('quotes')} (id, number, total, due) VALUES (1, 'Q-1', 40.00, 40.00)`);
      const attempts = paymentAttemptsRepo(s.meta);
      const ref = { kind: 'profile' as const, connectionId: s.connectionId, tableName: s.t('quotes'), rowKey: '1' };
      const attempt: PaymentAttempt = (await attempts.create({ provider: 'payments-stripe', mode: 'live', accountId: 'acct', payable: ref, payableLabel: 'Q-1', amount: '40.00', currency: 'EUR', linkId: null, nonce: `nonce-${dialect}-panel`.padEnd(22, 'x'), createdBy: null }))!;
      await attempts.move(attempt.id, 'open', { providerRef: `cs_${dialect}_panel` });
      await attempts.move(attempt.id, 'succeeded', { takenAmount: '40.00', takenCurrency: 'EUR', paymentRef: `pi_${dialect}_panel`, paidWith: { method: 'card', label: 'Visa', delayed: false } });
      const recorded = await recordAttempt({ meta: s.meta, sources: createPayableSources({ meta: s.meta, manager: s.manager }), app: s.app }, attempt.id);
      expect(recorded).toMatchObject({ state: 'recorded' });
      const written = (await s.rows(`SELECT paid_at, provider FROM ${real('quote_payments')} WHERE quote_id = 1`))[0]!;
      expect(written['paid_at']).not.toBeNull();

      const panel = await s.send('owner', 'POST', '/api/v1/payments/panel', { connectionId: s.connectionId, table: s.t('quotes'), recordId: '1' });
      expect(panel.statusCode, panel.body).toBe(200);
      const [payment] = panel.json().data.payments as { paidOn: string; provider: string | null; attemptId: string | null }[];
      const today = new Date().toISOString().slice(0, 10);
      // The day, from the moment it was paid (read in UTC, as a payment Adminium keeps is).
      expect(payment!.paidOn).toBe(today);
      // The service, as the payment wrote it.
      expect(payment!.provider).toBe(String(written['provider']));
      expect(payment!.provider).not.toBeNull();
      expect(payment!.attemptId).toBe(attempt.id);
    });

    it('tells no money to a reader whose limit hides the total or the due, and the same to an unlimited one as before', async () => {
      await s.rows(`INSERT INTO ${real('quotes')} (id, number, total, due) VALUES (2, 'Q-2', 75.00, 75.00)`);
      const record = { connectionId: s.connectionId, table: s.t('quotes'), recordId: '2' };
      // The manager reads every column: the panel as it always was.
      const full = await s.send('manager', 'POST', '/api/v1/payments/panel', record);
      expect(full.statusCode, full.body).toBe(200);
      expect(full.json().data).toMatchObject({ total: '75.00', due: '75.00', paid: '0.00' });
      const fullRows = await s.send('manager', 'POST', '/api/v1/payments/panel/rows', { connectionId: s.connectionId, table: s.t('quotes'), recordIds: ['2'] });
      expect(fullRows.json().data).toMatchObject([{ recordId: '2', state: 'unpaid', due: '75.00' }]);

      for (const who of ['packer', 'half']) {
        // No panel at all, as for a table that takes no payments: no total, no due, no payments.
        const panel = await s.send(who, 'POST', '/api/v1/payments/panel', record);
        expect(panel.statusCode, panel.body).toBe(200);
        expect(panel.json()).toEqual({ data: null });
        // No row state in a list either.
        const rows = await s.send(who, 'POST', '/api/v1/payments/panel/rows', { connectionId: s.connectionId, table: s.t('quotes'), recordIds: ['1', '2'] });
        expect(rows.statusCode, rows.body).toBe(200);
        expect(rows.json()).toEqual({ data: [] });
      }
      // Recording a payment answers what is still due: refused, and nothing written.
      const recorded = await s.send('packer', 'POST', '/api/v1/payments/record-payment', {
        ...record,
        amount: '5.00',
        way: 'cash',
        paidOn: new Date().toISOString().slice(0, 10),
        note: null,
        approvalCode: null,
        last4: null,
        key: `packer-key-${dialect}-000001`,
      });
      expect(recorded.statusCode, recorded.body).toBe(403);
      expect(await s.rows(`SELECT id FROM ${real('quote_payments')} WHERE quote_id = 2`)).toEqual([]);
      // A pay link's page shows what is due: none is made for the packer.
      const linked = await s.send('packer', 'POST', '/api/v1/payments/links', { kind: 'profile', connectionId: s.connectionId, tableName: s.t('quotes'), rowKey: '2' });
      expect(linked.statusCode, linked.body).toBe(403);
    });
  });
}
