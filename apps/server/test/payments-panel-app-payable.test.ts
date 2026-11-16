// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE PAYMENT PANEL OF AN APP'S PAYABLE, on SQLite, Postgres and MySQL.
 *
 * An app whose payments table keeps the moment a payment was paid
 * (`paidAt`) and no day of its own, and the service that took it
 * (`provider`): the record page's panel shows each payment with its day and
 * its service, read from those columns, as it does for an invoice the shape
 * maps. Before, it showed neither.
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
    roles: [{ key: 'manager', name: 'Manager', permissions: ['app:@:staff', 'table:@quotes:read', 'table:@quote_payments:read', 'page:@quoting-quotes:view'] }],
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
      s = await wholeServer(dialect, quotes());
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
  });
}
