// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A catalog app's payable tables: what it may say, and each refusal one break
 * at a time. The ways to pay and the pay page stay a self-made file's; the
 * payments table's reference is unique text no stranger writes; a payment
 * moves a record to paid only from states the app names; its conditions and
 * its currency from the settings row name real columns; an invoice built on
 * the Invoices shape is declared by the shape.
 */
import { describe, expect, it } from 'vitest';

import { installFloorWords, validateManifest, WORD_FLOORS } from '../src/index.js';

type Doc = Record<string, unknown>;

const money = (ref: string) => ({ ref, type: 'decimal', scale: 2, default: 0 });

function payable(over: Doc = {}): Doc {
  return {
    table: 'orders',
    label: 'number',
    amount: { column: 'total' },
    currency: { fixed: 'EUR' },
    due: { column: 'balance' },
    payments: { kind: 'table', table: 'order_payments', link: 'order_id', amount: 'amount', date: 'paid_on', method: { column: 'method', values: { '*': 'online' } }, reference: 'payment_ref', provider: 'provider' },
    status: { column: 'status', paid: 'placed', from: ['paying'] },
    payableWhen: [{ column: 'status', eq: 'paying' }],
    returnTo: '/orders',
    receipt: 'app',
    ...over,
  };
}

function app(payables: Doc[] = [payable()], over: Doc = {}): Doc {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'counter',
    name: 'Counter',
    version: '1.0.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'AGPL-3.0-only',
    description: { key: 'c.desc', fallback: 'A counter.' },
    categories: ['commerce'],
    compatibility: { minAdminiumVersion: '0.3.59' },
    requiredSchema: {
      tables: [
        { ref: 'settings', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'currency', type: 'text', maxLength: 3, nullable: true }, { ref: 'open', type: 'bool', default: true }] },
        {
          ref: 'orders',
          columns: [
            { ref: 'id', type: 'int', role: 'pk' },
            { ref: 'number', type: 'text', maxLength: 40 },
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
            { ref: 'provider', type: 'text', maxLength: 40, nullable: true },
          ],
        },
      ],
    },
    pages: [{ ref: 'counter-orders', template: 'page-crud', title: { key: 'c.orders', fallback: 'Orders' }, nav: { group: 'manifest:counter', icon: 'list', order: 1 }, bindings: { main: 'orders' } }],
    frontends: [{ side: 'staff', kind: 'none' }],
    payments: { payables },
    ...over,
  };
}

const issues = (doc: Doc): string[] => {
  const result = validateManifest(doc);
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`);
};
const columnsOf = (doc: Doc, table: string): Doc[] => ((doc['requiredSchema'] as { tables: Doc[] }).tables.find((one) => one['ref'] === table)!['columns'] as Doc[]);

describe("a catalog app's payables", () => {
  it('are read from any app, from Adminium 0.3.59', () => {
    expect(issues(app())).toEqual([]);
    expect(installFloorWords(app()).map((found) => found.word)).toEqual(expect.arrayContaining(['payments', 'payments.appPayables', 'payments.payableExtras']));
    expect(WORD_FLOORS['payments.appPayables']).toBe('0.3.59');
    expect(issues({ ...app(), compatibility: { minAdminiumVersion: '0.3.58' } }).join('\n')).toContain('"payments.appPayables" is read by Adminium 0.3.59 and later');
  });

  it('never carry the ways to pay or the pay page', () => {
    const found = issues(app([payable()], { payments: { payables: [payable()], ways: [{ source: 'manual', method: 'cash' }], payPage: { shopName: 'Counter' } } })).join('\n');
    expect(found).toContain('"payments.ways" is read only from a file made on an Adminium');
    expect(found).toContain('"payments.payPage" is read only from a file made on an Adminium');
  });

  it('keep each payment\'s reference in a unique text column no public entry writes', () => {
    const notUnique = app();
    delete columnsOf(notUnique, 'order_payments').find((column) => column['ref'] === 'payment_ref')!['unique'];
    expect(issues(notUnique).join('\n')).toContain('holds each payment\'s reference: a text column marked unique');
    const written = app([payable()], { publicAccess: [{ table: 'order_payments', methods: ['POST'], select: ['id'], writable: ['amount', 'provider'], humanCheck: true }] });
    expect(issues(written).join('\n')).toContain('"order_payments.provider" is written only by a payment, so no public entry may write it');
  });

  it('move a record to paid only from states they name, each a state of the column', () => {
    expect(issues(app([payable({ status: { column: 'status', paid: 'placed' } })])).join('\n')).toContain('name the states a payment moves the record to paid from');
    expect(issues(app([payable({ status: { column: 'status', paid: 'placed', from: ['waiting'] } })])).join('\n')).toContain('"waiting" is not a value of "orders.status"');
  });

  it('move a record to paid only by a move its states list', () => {
    const withStates = (moves: Record<string, string[]>) => {
      const doc = app();
      const orders = (doc['requiredSchema'] as { tables: Doc[] }).tables.find((one) => one['ref'] === 'orders')!;
      orders['states'] = { column: 'status', initial: 'placed', moves };
      return doc;
    };
    expect(issues(withStates({ paying: ['placed', 'cancelled'] }))).toEqual([]);
    expect(issues(withStates({ paying: ['cancelled'] })).join('\n')).toContain('"orders" lists no move from "paying" to "placed" in its states');
  });

  describe('refunds', () => {
    /** An app that keeps refunds as rows of its own, with a switch and a late window in its settings row. */
    const withRefunds = (over: Doc = {}): Doc => {
      const doc = app([
        payable({
          refunds: { model: 'rows', table: 'order_refunds', payment: 'payment_id', amount: 'amount', when: [{ column: 'method', eq: 'online' }], providerRef: 'provider_ref', state: 'refund_state', openIn: '/orders', auto: { values: { method: 'online', reason: 'free cancellation' } } },
          refundOn: { moves: [{ from: ['placed'], to: 'cancelled', by: ['customer', 'system', 'refund-right'] }], switch: { table: 'settings', column: 'open' }, before: { column: 'pickup_at', hours: { table: 'settings', column: 'late_hours' } } },
          ...over,
        }),
      ]);
      const tables = (doc['requiredSchema'] as { tables: Doc[] }).tables;
      (tables.find((one) => one['ref'] === 'settings')!['columns'] as Doc[]).push({ ref: 'late_hours', type: 'int', default: 2 });
      (tables.find((one) => one['ref'] === 'orders')!['columns'] as Doc[]).push({ ref: 'pickup_at', type: 'timestamptz', nullable: true });
      tables.push({
        ref: 'order_refunds',
        columns: [
          { ref: 'id', type: 'int', role: 'pk' },
          { ref: 'payment_id', type: 'fk', references: 'order_payments' },
          money('amount'),
          { ref: 'method', type: 'enum', enum: ['cash', 'online'], default: 'cash' },
          { ref: 'reason', type: 'text', maxLength: 80, nullable: true },
          { ref: 'provider_ref', type: 'text', maxLength: 255, nullable: true },
          { ref: 'refund_state', type: 'text', maxLength: 16, nullable: true },
        ],
      });
      return doc;
    };

    it('keep refund rows that name the payment they refund, with columns only Adminium writes', () => {
      expect(issues(withRefunds())).toEqual([]);
      const said = (doc: Doc) => issues(doc).join('\n');
      expect(said(withRefunds({ refunds: { model: 'rows', table: 'order_refunds', payment: 'amount', amount: 'amount', when: [{ column: 'method', eq: 'online' }], providerRef: 'provider_ref', state: 'refund_state', auto: { values: {} } } }))).toContain('a link to "order_payments"');
      expect(said(withRefunds({ refunds: { model: 'rows', table: 'order_refunds', payment: 'payment_id', amount: 'amount', when: [{ column: 'method', eq: 'card' }], providerRef: 'provider_ref', state: 'nope', auto: { values: { nope: 1 } } } }))).toMatch(/"order_refunds" has no column "nope"[\s\S]*"card" is not a value/);
      const kept = withRefunds({ payments: { kind: 'kept' }, due: undefined });
      expect(said(kept)).toContain('keep payments in a table of the app');
    });

    it('refund by themselves only between states of the status column, behind a yes/no switch and an hours setting', () => {
      const said = (over: Doc) => issues(withRefunds(over)).join('\n');
      expect(said({ refundOn: { moves: [{ to: 'gone', by: ['customer'] }] } })).toContain('"gone" is not a value of "orders.status"');
      expect(said({ refundOn: { moves: [{ to: 'cancelled', by: ['customer'] }], switch: { table: 'settings', column: 'currency' } } })).toContain('"settings.currency" is not a yes/no column');
      expect(said({ refundOn: { moves: [{ to: 'cancelled', by: ['customer'] }], before: { column: 'number', hours: { table: 'settings', column: 'open' } } } })).toMatch(/"orders.number" is not a moment[\s\S]*holds no number of hours/);
      expect(said({ status: undefined })).toContain('name its status column');
      expect(said({ refunds: { model: 'rows', table: 'order_refunds', payment: 'payment_id', amount: 'amount', when: [{ column: 'method', eq: 'online' }], providerRef: 'provider_ref', state: 'refund_state' } })).toContain('say its values (`refunds.auto`)');
      // The column model needs no rows: the full refund is the engine's own.
      expect(said({ refunds: { model: 'column' } })).toBe('');
    });

    it('never let a public entry write what only Adminium writes', () => {
      const doc = withRefunds();
      doc['publicAccess'] = [{ table: 'order_refunds', methods: ['POST'], writable: ['amount', 'provider_ref'], humanCheck: true }];
      expect(issues(doc).join('\n')).toContain('"order_refunds.provider_ref" is written only by Adminium');
    });
  });

  it('say when a record may be paid, and its currency from the settings row, by real columns', () => {
    expect(issues(app([payable({ payableWhen: [{ column: 'nope', eq: 'x' }] })])).join('\n')).toContain('"orders" has no column "nope"');
    expect(issues(app([payable({ payableWhen: [{ column: 'status', eq: 'shipped' }] })])).join('\n')).toContain('"shipped" is not a value of "orders.status"');
    expect(issues(app([payable({ instantOnly: { where: [{ column: 'status', eq: 'paying' }] } })]))).toEqual([]);
    expect(issues(app([payable({ currency: { setting: { table: 'settings', column: 'currency' } } })]))).toEqual([]);
    expect(issues(app([payable({ currency: { setting: { table: 'settings', column: 'open' } } })])).join('\n')).toContain('"settings.open" is not a text column');
  });

  it('send a customer back to a path of their own side, never with a query or a fragment', () => {
    expect(issues(app([payable({ returnTo: '/orders/mine' })]))).toEqual([]);
    for (const returnTo of ['/orders?claim=abc', '/orders#token', 'https://evil.test/', '//evil.test', 'orders']) expect(issues(app([payable({ returnTo })]))).not.toEqual([]);
  });

  it('name the day or the moment a payment was paid', () => {
    const p = payable();
    const { date: _left, ...rest } = p['payments'] as Doc;
    expect(issues(app([{ ...p, payments: rest }])).join('\n')).toContain('a payment names the day or the moment it was paid');
    expect(issues(app([{ ...p, payments: { ...rest, paidAt: 'paid_on' } }]))).toEqual([]);
  });

  it('never take payment in a hold counted by the clock', () => {
    const held = app();
    const orders = (held['requiredSchema'] as { tables: Doc[] }).tables.find((one) => one['ref'] === 'orders')!;
    (orders['columns'] as Doc[]).push({ ref: 'held_until', type: 'timestamptz', nullable: true }, { ref: 'seat_id', type: 'int', nullable: true });
    orders['capacity'] = { kind: 'parent', via: 'seat_id', size: 1, countWhere: { column: 'status', values: ['paying', 'placed'] }, hold: { column: 'held_until', states: ['paying'] } };
    expect(issues(held).join('\n')).toContain('"paying" is a hold counted by the clock');
  });

  it('answer a pay link from a create of a payable table, behind the human check', () => {
    const entry = { table: 'orders', methods: ['POST'], select: ['id'], writable: ['number'], humanCheck: true, pay: true };
    expect(issues(app([payable()], { publicAccess: [entry] }))).toEqual([]);
    expect(issues(app([payable()], { publicAccess: [{ ...entry, humanCheck: undefined }] })).join('\n')).toContain('a create that answers a pay link asks the human check');
    expect(issues(app([payable()], { publicAccess: [{ ...entry, methods: ['GET'], writable: undefined }] })).join('\n')).toContain('a pay link is answered by a create');
    expect(issues(app([], { publicAccess: [entry] })).join('\n')).toContain('"orders" is not one of this app\'s payable tables');
  });

  it('declare an invoice built on the Invoices shape by the shape alone', () => {
    const shaped = app([{ table: 'orders', shape: true, returnTo: '/invoices', receipt: 'app' }]);
    expect(issues(shaped).join('\n')).toContain('is not an invoice built on the Invoices shape at version 2 or later');
  });
});
