// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A CANCEL BY THE STUDIO IS REFUNDED IN FULL BY ITSELF, whoever at the studio
 * pressed it and however late (MON-9, cQ28), on SQLite, Postgres and MySQL. A
 * customer's own cancel inside the window keeps the deposit, as before.
 */
import { paymentAttemptsRepo, type PaymentAttempt } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createPayableSources } from '../src/payments/payables.js';
import { createRefundMoveWatch, moverOf, REFUND_OWED } from '../src/payments/refund-moves.js';
import type { RefundDeps } from '../src/payments/refunds.js';
import { installInvoicing, invoicingManifest, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.71' }));

type Doc = Record<string, unknown>;
const id = { ref: 'id', type: 'int', role: 'pk' };
const money = (ref: string) => ({ ref, type: 'decimal', precision: 12, scale: 2, default: 0 });

function studio(): Doc {
  const m = invoicingManifest([
    { ref: 'settings', columns: [id, { ref: 'cancel_hours', type: 'int', default: 24 }] },
    { ref: 'orders', columns: [id, { ref: 'number', type: 'text', maxLength: 40, nullable: true }, money('total'), money('balance'), { ref: 'status', type: 'enum', enum: ['paying', 'placed', 'done', 'cancelled'], default: 'placed' }, { ref: 'starts_at', type: 'timestamptz', nullable: true }] },
    { ref: 'order_payments', columns: [id, { ref: 'order_id', type: 'fk', references: 'orders' }, money('amount'), { ref: 'method', type: 'enum', enum: ['cash', 'online'], default: 'cash' }, { ref: 'payment_ref', type: 'text', maxLength: 64, nullable: true, unique: true }, { ref: 'paid_on', type: 'date', nullable: true }, money('refunded_elsewhere')] },
    { ref: 'order_refunds', columns: [id, { ref: 'payment_id', type: 'fk', references: 'order_payments' }, money('amount'), { ref: 'method', type: 'enum', enum: ['cash', 'online'], default: 'cash' }, { ref: 'provider_ref', type: 'text', maxLength: 255, nullable: true }, { ref: 'refund_state', type: 'text', maxLength: 16, nullable: true }] },
  ]);
  m['key'] = 'counter';
  m['compatibility'] = { minAdminiumVersion: '0.3.71' };
  (m['pages'] as { bindings: Record<string, string> }[])[0]!.bindings = { rows: 'orders' };
  m['payments'] = {
    payables: [
      {
        table: 'orders',
        label: 'number',
        amount: { column: 'total' },
        currency: { fixed: 'EUR' },
        due: { column: 'balance' },
        status: { column: 'status', paid: 'placed', from: ['paying'] },
        payments: { kind: 'table', table: 'order_payments', link: 'order_id', amount: 'amount', date: 'paid_on', method: { column: 'method', values: { '*': 'online' } }, reference: 'payment_ref', refundedElsewhere: 'refunded_elsewhere' },
        refunds: { model: 'rows', table: 'order_refunds', payment: 'payment_id', amount: 'amount', when: [{ column: 'method', eq: 'online' }], providerRef: 'provider_ref', state: 'refund_state', auto: { values: { method: 'online' } } },
        refundOn: {
          moves: [{ from: ['placed'], to: 'cancelled', by: ['customer', 'system', 'staff'] }],
          before: { column: 'starts_at', hours: { table: 'settings', column: 'cancel_hours' }, binds: ['customer'] },
        },
      },
    ],
  };
  return m;
}

describe('who a move is by', () => {
  const person = (refunds: boolean, origin: string) => ({ origin, request: { user: { id: 'u' }, can: async () => refunds } }) as never;
  it('a person at the studio is staff, on a screen or a bulk action; a rule inside their request is not', async () => {
    expect(await moverOf(person(false, 'dashboard'), 'counter')).toBe('staff');
    expect(await moverOf(person(false, 'bulk'), 'counter')).toBe('staff');
    expect(await moverOf(person(false, 'automation'), 'counter')).toBe('other');
    expect(await moverOf(person(false, 'hook'), 'counter')).toBe('other');
    expect(await moverOf(person(true, 'dashboard'), 'counter')).toBe('refund-right');
  });
  it('a key with no person behind it is nobody at the studio', async () => {
    expect(await moverOf({ origin: 'dashboard', request: { user: null, can: async () => true } } as never, 'counter')).toBe('other');
  });
});

describe.each(LEGS)('a cancel by the studio — %s', (dialect, available) => {
  let h: InvoicingHarness;
  let w: Awaited<ReturnType<typeof writerFor>>;
  let deps: RefundDeps;
  let queued: string[];
  let n = 0;
  const HOUR = 3_600_000;

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, studio());
    w = await writerFor(h);
    queued = [];
    deps = {
      meta: h.meta,
      sources: createPayableSources({ meta: h.meta, manager: h.manager }),
      providerFor: async () => ({ ok: false }) as never,
      enqueue: async (input) => void queued.push(String(input.payload['attemptId'])),
    };
    await h.rows(`insert into ${h.real('settings')} (id, cancel_hours) values (1, 24)`);
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await h.close();
  });

  async function paid(): Promise<{ orderId: number; attempt: PaymentAttempt }> {
    n += 1;
    const orderId = 100 + n;
    const attempts = paymentAttemptsRepo(h.meta);
    const made = (await attempts.create({ provider: 'fakepay', mode: 'live', accountId: 'acct', payable: { kind: 'profile', connectionId: h.connectionId, tableName: w.targetOf('orders').table.id, rowKey: String(orderId) }, payableLabel: `C-${String(orderId)}`, amount: '40.00', currency: 'EUR', linkId: null, nonce: `studio-${dialect}-${String(n)}`.padEnd(22, 'x'), createdBy: null }))!;
    await attempts.move(made.id, 'open', { providerRef: `cs_${String(n)}` });
    await attempts.move(made.id, 'succeeded', { takenAmount: '40.00', takenCurrency: 'EUR', paymentRef: `pi_${String(n)}`, paidWith: { method: 'card', label: 'Visa', delayed: false } });
    await attempts.move(made.id, 'recording', {});
    await attempts.move(made.id, 'recorded', { recordedKey: `row:${w.targetOf('order_payments').table.id}:${String(orderId)}`, recordedAt: Date.now() });
    await h.rows(`insert into ${h.real('orders')} (id, number, total, balance, status) values (${String(orderId)}, 'C-${String(orderId)}', 40.00, 0.00, 'placed')`);
    await h.rows(`insert into ${h.real('order_payments')} (id, order_id, amount, method, payment_ref) values (${String(orderId)}, ${String(orderId)}, 40.00, 'online', '${made.id}')`);
    return { orderId, attempt: (await attempts.byId(made.id))! };
  }

  const moved = (orderId: number, startsIn: number, by: { origin: 'public' | 'dashboard' | 'automation'; refunds?: boolean; person?: boolean }) =>
    ({
      connectionId: h.connectionId,
      table: w.targetOf('orders').table,
      action: 'update',
      entity: { connectionId: h.connectionId, table: w.targetOf('orders').table.id, pk: { id: orderId }, label: String(orderId) },
      before: { id: orderId, status: 'placed' },
      after: { id: orderId, status: 'cancelled', starts_at: new Date(Date.now() + startsIn).toISOString() },
      origin: by.origin,
      ...(by.person === false ? { request: null } : by.origin === 'dashboard' ? { request: { user: { id: 'usr_jun' }, can: async () => by.refunds === true } } : {}),
    }) as never;
  const watch = () => createRefundMoveWatch({ ...deps, setting: (connectionId, table, column) => deps.sources.setting!(connectionId, table, column) });
  const problem = async (attempt: PaymentAttempt) => (await paymentAttemptsRepo(h.meta).byId(attempt.id))!.problem;

  it.skipIf(!available)('the front desk, with no refund right, cancels a visit tomorrow morning: refunded by itself', async () => {
    queued.length = 0;
    const { orderId, attempt } = await paid();
    await watch().onRecordEvent(moved(orderId, 3 * HOUR, { origin: 'dashboard', refunds: false }));
    expect(queued).toEqual([attempt.id]);
    expect(await problem(attempt)).toBeNull();
  });

  it.skipIf(!available)('an owner who holds the refund right, inside the window: refunded too', async () => {
    queued.length = 0;
    const { orderId, attempt } = await paid();
    await watch().onRecordEvent(moved(orderId, HOUR, { origin: 'dashboard', refunds: true }));
    expect(queued).toEqual([attempt.id]);
  });

  it.skipIf(!available)('a customer inside the window keeps nothing back: no refund, nothing owed', async () => {
    queued.length = 0;
    const { orderId, attempt } = await paid();
    await watch().onRecordEvent(moved(orderId, 3 * HOUR, { origin: 'public' }));
    expect(queued).toEqual([]);
    expect(await problem(attempt)).toBeNull();
  });

  it.skipIf(!available)('a customer in good time is refunded', async () => {
    queued.length = 0;
    const { orderId, attempt } = await paid();
    await watch().onRecordEvent(moved(orderId, 48 * HOUR, { origin: 'public' }));
    expect(queued).toEqual([attempt.id]);
  });

  it.skipIf(!available)('a move by nobody at the studio is not refunded by itself: it is flagged for a person', async () => {
    queued.length = 0;
    const { orderId, attempt } = await paid();
    await watch().onRecordEvent(moved(orderId, 3 * HOUR, { origin: 'dashboard', person: false }));
    expect(queued).toEqual([]);
    expect(await problem(attempt)).toMatchObject({ code: REFUND_OWED });
  });
});
