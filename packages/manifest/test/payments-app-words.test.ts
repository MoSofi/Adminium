// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What an app says about its payments to its own rules, from Adminium 0.3.62:
 *
 *  - an entry open only while payments are on, or only while they are off
 *    (`publicAccess[].requirePayments`), on a create of a payable table;
 *  - a move refused while a payment for the row is on its way
 *    (`requires.noPaymentInFlight`), on a payable table;
 *  - a mail queued only while payments are on or off (`producers[].payments`),
 *    about a payable row, and up to 32 producers (24 before);
 *  - further plain columns the paid move writes (`status.set`), never money,
 *    keys, links or the state itself.
 */
import { describe, expect, it } from 'vitest';

import { installFloorWords, OUTBOX_PRODUCERS_MAX, validateManifest, WORD_FLOORS } from '../src/index.js';

type Doc = Record<string, unknown>;

const id = { ref: 'id', type: 'int', role: 'pk' };
const money = (ref: string) => ({ ref, type: 'decimal', scale: 2, default: 0 });

function app(over: { payable?: Doc; moves?: Doc; producers?: Doc[]; publicAccess?: Doc[] } = {}): Doc {
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
    compatibility: { minAdminiumVersion: '0.3.62' },
    requiredSchema: {
      tables: [
        { ref: 'settings', columns: [id, { ref: 'name', type: 'text', maxLength: 60, nullable: true }] },
        {
          ref: 'orders',
          columns: [
            id,
            { ref: 'number', type: 'text', maxLength: 40 },
            { ref: 'email', type: 'text', maxLength: 200, nullable: true },
            money('total'),
            money('balance'),
            { ref: 'status', type: 'enum', enum: ['paying', 'placed', 'cancelled'], default: 'placed' },
            { ref: 'paid_method', type: 'enum', enum: ['counter', 'online'], nullable: true },
            { ref: 'note', type: 'text', maxLength: 200, nullable: true },
            { ref: 'customer_id', type: 'fk', references: 'customers', nullable: true },
          ],
          states: { column: 'status', initial: 'placed', starts: ['paying'], moves: over.moves ?? { paying: [{ to: 'placed', requires: { noPaymentInFlight: true } }, 'cancelled'], placed: ['cancelled'] } },
        },
        { ref: 'customers', columns: [id, { ref: 'email', type: 'text', maxLength: 200, nullable: true }] },
        {
          ref: 'messages',
          columns: [
            id,
            { ref: 'kind', type: 'enum', enum: ['unpaid', 'received'] },
            { ref: 'status', type: 'enum', enum: ['queued', 'sent', 'failed', 'skipped'], default: 'queued' },
            { ref: 'to_address', type: 'text', maxLength: 254, nullable: true },
            { ref: 'order_id', type: 'fk', references: 'orders', nullable: true },
            { ref: 'customer_id', type: 'fk', references: 'customers', nullable: true },
            { ref: 'error', type: 'text', maxLength: 200, nullable: true },
            { ref: 'sent_at', type: 'timestamptz', nullable: true },
          ],
        },
      ],
    },
    pages: [{ ref: 'counter-orders', template: 'page-crud', title: { key: 'c.orders', fallback: 'Orders' }, nav: { group: 'manifest:counter', icon: 'list', order: 1 }, bindings: { main: 'orders' }}],
    frontends: [{ side: 'staff', kind: 'none' }],
    publicAccess: over.publicAccess ?? [
      { table: 'orders', methods: ['POST'], select: ['id'], writable: ['number'], humanCheck: true, requirePayments: 'off' },
      { table: 'orders', methods: ['POST'], select: ['id'], writable: ['number'], defaults: { status: 'paying' }, humanCheck: true, pay: true, requirePayments: 'on' },
    ],
    outbox: {
      table: 'messages',
      columns: { kind: 'kind', status: 'status', to: 'to_address', error: 'error', sentAt: 'sent_at' },
      links: { order: 'order_id' },
      recipient: { via: 'order_id', table: 'orders', email: 'email', name: 'number' },
      kinds: { unpaid: 'counter-unpaid', received: 'counter-received' },
      classes: { unpaid: 'service', received: 'service' },
      producers: over.producers ?? [
        { kind: 'unpaid', link: 'order_id', onCreate: { table: 'orders' }, payments: 'on' },
        { kind: 'received', link: 'order_id', onCreate: { table: 'orders' }, payments: 'off' },
      ],
    },
    emailTemplates: [
      { key: 'counter-unpaid', name: 'counter-unpaid', locales: { 'en-US': { subject: 'Pay for {{order.number}}', preheader: 'You owe {{order.total}}', blocks: [{ block: 'email.text', data: { text: 'Pay online.' } }] } } },
      { key: 'counter-received', name: 'counter-received', locales: { 'en-US': { subject: 'Order {{order.number}}', preheader: 'Pay when you collect', blocks: [{ block: 'email.text', data: { text: 'Thanks.' } }] } } },
    ],
    payments: {
      payables: [
        {
          table: 'orders',
          label: 'number',
          amount: { column: 'total' },
          currency: { fixed: 'EUR' },
          due: { column: 'balance' },
          payments: { kind: 'kept' },
          status: { column: 'status', paid: 'placed', from: ['paying'], set: { paid_method: 'online' } },
          payableWhen: [{ column: 'status', eq: 'paying' }],
          ...over.payable,
        },
      ],
    },
  };
}

const issues = (doc: Doc): string => {
  const result = validateManifest(doc);
  return result.ok ? '' : result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n');
};

describe("an app's payments, said to its own rules", () => {
  it('are read from Adminium 0.3.62, each word found where it is said', () => {
    expect(issues(app())).toBe('');
    const words = installFloorWords(app()).map((found) => found.word);
    for (const word of ['publicAccess.requirePayments', 'states.noPaymentInFlight', 'outbox.producerPayments', 'payments.statusSet'] as const) {
      expect(words).toContain(word);
      expect(WORD_FLOORS[word]).toBe('0.3.62');
    }
    expect(issues({ ...app(), compatibility: { minAdminiumVersion: '0.3.61' } })).toContain('"states.noPaymentInFlight" is read by Adminium 0.3.62 and later');
  });

  it('open an entry by payments only on a create of a payable table', () => {
    const notACreate = app({ publicAccess: [{ table: 'orders', methods: ['GET'], select: ['id'], requirePayments: 'on' }] });
    expect(issues(notACreate)).toContain('payments being on or off opens a create, and this entry makes none');
    const notPayable = app({ publicAccess: [{ table: 'customers', methods: ['POST'], select: ['id'], writable: ['email'], humanCheck: true, requirePayments: 'off' }] });
    expect(issues(notPayable)).toContain('"customers" is not one of this app\'s payable tables');
  });

  it('refuse a move under a payment on its way only on a payable table', () => {
    const doc = app();
    const customers = (doc['requiredSchema'] as { tables: Doc[] }).tables.find((table) => table['ref'] === 'customers')!;
    customers['columns'] = [...(customers['columns'] as Doc[]), { ref: 'state', type: 'enum', enum: ['new', 'known'], default: 'new' }];
    customers['states'] = { column: 'state', initial: 'new', moves: { new: [{ to: 'known', requires: { noPaymentInFlight: true } }] } };
    expect(issues(doc)).toContain('"customers" is not one of this app\'s payable tables (payments.payables), so no payment is ever on its way for its rows');
  });

  it('queue a mail by payments only about a payable row, and never for a removed one', () => {
    expect(issues(app({ producers: [{ kind: 'unpaid', link: 'customer_id', onCreate: { table: 'customers' }, payments: 'on' }] }))).toContain('"customers" is not one of this app\'s payable tables');
    expect(issues(app({ producers: [{ kind: 'unpaid', link: 'order_id', onDelete: { table: 'orders' }, payments: 'on', was: ['number'] }] }))).toContain('a removed row is paid for no longer');
    expect(issues(app({ producers: [{ kind: 'unpaid', link: 'order_id', onCreate: { table: 'orders' }, payments: 'sometimes' }] }))).not.toBe('');
  });

  it('take up to 32 producers, more than 24 from Adminium 0.3.62', () => {
    expect(OUTBOX_PRODUCERS_MAX).toBe(32);
    const many = (count: number) => Array.from({ length: count }, () => ({ kind: 'received', link: 'order_id', onChange: { table: 'orders', column: 'status', to: 'placed' } }));
    expect(issues(app({ producers: many(32) }))).toBe('');
    expect(installFloorWords(app({ producers: many(25) })).map((found) => found.word)).toContain('outbox.manyProducers');
    expect(installFloorWords(app({ producers: many(24) })).map((found) => found.word)).not.toContain('outbox.manyProducers');
    expect(issues(app({ producers: many(33) }))).not.toBe('');
    expect(issues({ ...app({ producers: many(25) }), compatibility: { minAdminiumVersion: '0.3.61' } })).toContain('"outbox.manyProducers" is read by Adminium 0.3.62 and later');
  });

  it('write beside the paid state only plain columns of the record', () => {
    const set = (values: Doc) => issues(app({ payable: { status: { column: 'status', paid: 'placed', from: ['paying'], set: values } } }));
    expect(set({ paid_method: 'online', note: 'Paid online' })).toBe('');
    expect(set({ status: 'placed' })).toContain('the state column is moved by `paid`, not set');
    expect(set({ total: 0 })).toContain('holds money');
    expect(set({ balance: 0 })).toContain('holds money');
    expect(set({ customer_id: 1 })).toContain('a key, a link or a document');
    expect(set({ id: 1 })).toContain('a key, a link or a document');
    expect(set({ paid_method: 'card' })).toContain('does not fit "orders.paid_method"');
    expect(set({ nope: 'x' })).toContain('"orders" has no column "nope"');
    expect(set({ paid_method: 'online', note: 'a', email: 'b', number: 'c', status_note: 'd' } as Doc)).toContain('at most 4 more columns');
  });
});
