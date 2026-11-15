// SPDX-License-Identifier: AGPL-3.0-only
/**
 * REFUNDS AN APP KEEPS AS ROWS OF ITS OWN (E4), on SQLite, Postgres and MySQL.
 *
 * A cashier who may write the refund table but not refund cannot make a row
 * that sends money back; someone who may refund can, and the engine sends the
 * money back for that row, once, with the amount it read once, and stamps the
 * row with the provider's reference and where the refund stands. A refund
 * that cannot be sent (cash taken by hand) is stamped "not sent" and kept for
 * a person; the sweep finds a row nothing queued; nobody else may stamp.
 */
import { paymentAttemptsRepo, refundsRepo, type PaymentAttempt } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { WriteContext } from '../src/crud/write-context.js';
import { askAppRefund, pickUpAppRefunds } from '../src/payments/app-refunds.js';
import { createRefundMoveWatch, giveAutoRefund, REFUND_OWED } from '../src/payments/refund-moves.js';
import { createPayableSources } from '../src/payments/payables.js';
import { mayRefundPayment, refundsKeptInApp } from '../src/payments/app-refund-queue.js';
import { followRecord, requestRefund, type RefundDeps } from '../src/payments/refunds.js';
import { installInvoicing, invoicingManifest, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.59' }));

type Doc = Record<string, unknown>;
const id = { ref: 'id', type: 'int', role: 'pk' };
const money = (ref: string) => ({ ref, type: 'decimal', scale: 2, default: 0 });

function counter(): Doc {
  const m = invoicingManifest([
    { ref: 'orders', columns: [id, { ref: 'number', type: 'text', maxLength: 40, nullable: true }, money('total'), money('balance'), { ref: 'status', type: 'enum', enum: ['paying', 'placed', 'cancelled'], default: 'placed' }] },
    {
      ref: 'order_payments',
      columns: [id, { ref: 'order_id', type: 'fk', references: 'orders' }, money('amount'), { ref: 'method', type: 'enum', enum: ['cash', 'online'], default: 'cash' }, { ref: 'payment_ref', type: 'text', maxLength: 64, nullable: true, unique: true }, { ref: 'paid_on', type: 'date', nullable: true }, money('refunded_elsewhere')],
    },
    {
      ref: 'order_refunds',
      columns: [id, { ref: 'payment_id', type: 'fk', references: 'order_payments' }, money('amount'), { ref: 'method', type: 'enum', enum: ['cash', 'online'], default: 'cash' }, { ref: 'provider_ref', type: 'text', maxLength: 255, nullable: true }, { ref: 'refund_state', type: 'text', maxLength: 16, nullable: true }],
    },
  ]);
  m['key'] = 'counter';
  m['compatibility'] = { minAdminiumVersion: '0.3.59' };
  (m['pages'] as { bindings: Record<string, string> }[])[0]!.bindings = { rows: 'orders' };
  m['payments'] = {
    payables: [
      {
        table: 'orders',
        label: 'number',
        amount: { column: 'total' },
        currency: { fixed: 'EUR' },
        due: { column: 'balance' },
        payments: { kind: 'table', table: 'order_payments', link: 'order_id', amount: 'amount', date: 'paid_on', method: { column: 'method', values: { '*': 'online' } }, reference: 'payment_ref', refundedElsewhere: 'refunded_elsewhere' },
        refunds: { model: 'rows', table: 'order_refunds', payment: 'payment_id', amount: 'amount', when: [{ column: 'method', eq: 'online' }], providerRef: 'provider_ref', state: 'refund_state' },
      },
    ],
  };
  return m;
}

/** A person's write, who may or may not refund. */
const asPerson = (refunds: boolean): WriteContext => ({
  origin: 'dashboard',
  hops: 0,
  actor: { kind: 'user', id: 'usr_cara', label: 'Cara' },
  request: { can: async (permission: string) => refunds && permission === 'system:payments:refund' } as unknown as FastifyRequest,
});

describe.each(LEGS)('refunds an app keeps as rows of its own — %s', (dialect, available) => {
  let h: InvoicingHarness;
  let w: Awaited<ReturnType<typeof writerFor>>;
  let deps: RefundDeps;
  let asked: { paymentRef: string; amount: string; idempotencyKey: string }[];
  let attempt: PaymentAttempt;
  const refundsTable = () => w.targetOf('order_refunds').table.id;

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, counter());
    w = await writerFor(h);
    asked = [];
    const provider = {
      refund: async (input: { paymentRef: string; amount: string; currency: string; idempotencyKey: string }) => {
        asked.push({ paymentRef: input.paymentRef, amount: input.amount, idempotencyKey: input.idempotencyKey });
        return { ok: true as const, ref: `re_${String(asked.length)}`, paymentRef: input.paymentRef, status: 'succeeded' as const, amount: input.amount, currency: input.currency, failureMessage: null };
      },
    };
    deps = { meta: h.meta, sources: createPayableSources({ meta: h.meta, manager: h.manager }), providerFor: async () => ({ ok: true, provider } as never), enqueue: async () => undefined };
    // A payment taken online, and its row in the app's payments table.
    const attempts = paymentAttemptsRepo(h.meta);
    const made = (await attempts.create({ provider: 'fakepay', mode: 'live', accountId: 'acct', payable: { kind: 'profile', connectionId: h.connectionId, tableName: w.targetOf('orders').table.id, rowKey: '1' }, payableLabel: 'C-1', amount: '20.00', currency: 'EUR', linkId: null, nonce: `nonce-${dialect}`.padEnd(22, 'x'), createdBy: null }))!;
    await attempts.move(made.id, 'open', { providerRef: 'cs_1' });
    await attempts.move(made.id, 'succeeded', { takenAmount: '20.00', takenCurrency: 'EUR', paymentRef: 'pi_1', paidWith: { method: 'card', label: 'Visa', delayed: false } });
    attempt = (await attempts.byId(made.id))!;
    await h.rows(`insert into ${h.real('orders')} (id, number, total, balance, status) values (1, 'C-1', 20.00, 0.00, 'placed')`);
    await h.rows(`insert into ${h.real('order_payments')} (id, order_id, amount, method, payment_ref) values (1, 1, 20.00, 'online', '${made.id}'), (2, 1, 5.00, 'cash', null)`);
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await h.close();
  });

  it.skipIf(!available)('never lets someone who may not refund make a row that sends money back; cash is theirs as before', async () => {
    await expect(w.create('order_refunds', { id: 1, payment_id: 1, amount: '5.00', method: 'online' }, asPerson(false))).rejects.toMatchObject({ code: 'PAYMENT_REFUND_NOT_ALLOWED' });
    // Nor turn a cash refund into one.
    await w.create('order_refunds', { id: 2, payment_id: 2, amount: '2.00', method: 'cash' }, asPerson(false));
    await expect(w.update('order_refunds', 2, { method: 'online' }, asPerson(false))).rejects.toMatchObject({ code: 'PAYMENT_REFUND_NOT_ALLOWED' });
    // Nobody but Adminium stamps a refund.
    await expect(w.create('order_refunds', { id: 3, payment_id: 1, amount: '1.00', method: 'cash', refund_state: 'done' }, asPerson(true))).rejects.toMatchObject({ code: 'TABLE_FORBIDDEN' });
  });

  it.skipIf(!available)('sends the money back for the row once, with the amount read once, and stamps the row', async () => {
    await w.create('order_refunds', { id: 10, payment_id: 1, amount: '7.50', method: 'online' }, asPerson(true));
    const row = { connectionId: h.connectionId, table: refundsTable(), rowKey: '10' };
    expect(await askAppRefund(deps, row, 'usr_cara')).toBe('asked');
    expect(asked).toEqual([{ paymentRef: 'pi_1', amount: '7.50', idempotencyKey: expect.stringMatching(/^app:/) }]);
    const [stamped] = await h.rows(`select provider_ref, refund_state from ${h.real('order_refunds')} where id = 10`);
    expect(stamped).toMatchObject({ provider_ref: 're_1', refund_state: 'done' });
    expect(await refundsRepo(h.meta).forAppRow(row)).toMatchObject({ source: 'app', state: 'succeeded', amount: '7.50', requestedBy: 'usr_cara' });
    // Asked again (a retry, the sweep, a second worker): nothing new is sent; a changed amount is never sent again.
    await h.rows(`update ${h.real('order_refunds')} set amount = 9.00 where id = 10`);
    expect(await askAppRefund(deps, row)).toBe('stamped');
    expect(asked).toHaveLength(1);
    expect((await paymentAttemptsRepo(h.meta).byId(attempt.id))!.refundCommitted).toBe('7.50');
  });

  it.skipIf(!available)('stamps a row it cannot send "not sent", and keeps it for a person', async () => {
    // A refund row naming the payment taken by hand, written as the app's own seed would be.
    await h.rows(`insert into ${h.real('order_refunds')} (id, payment_id, amount, method) values (20, 2, 1.00, 'online')`);
    const row = { connectionId: h.connectionId, table: refundsTable(), rowKey: '20' };
    expect(await askAppRefund(deps, row)).toBe('not-sent');
    const [stamped] = await h.rows(`select refund_state from ${h.real('order_refunds')} where id = 20`);
    expect(stamped).toMatchObject({ refund_state: 'not-sent' });
    expect(await refundsRepo(h.meta).forAppRow(row)).toMatchObject({ state: 'failed', failureMessage: expect.stringContaining('not taken online') });
  });

  it.skipIf(!available)("refuses a refund asked from Adminium beside the app's own rows: it is made in the app", async () => {
    const answer = await requestRefund(deps, { attemptId: attempt.id, amount: '1.00', reason: 'requested_by_customer', note: null, key: `rk-in-app-${dialect}`.padEnd(20, 'x'), requestedBy: 'usr_mara' });
    expect(answer).toMatchObject({ ok: false, refusal: { code: 'IN_APP' } });
    expect(await refundsKeptInApp(h.meta, attempt.payable)).toEqual({ app: 'counter', openIn: null });
  });

  it.skipIf(!available)('takes money given back with no row of the app\'s (made at the provider) into its own column, never the app\'s own rows', async () => {
    const attempts = paymentAttemptsRepo(h.meta);
    await attempts.move(attempt.id, 'recording', {});
    await attempts.move(attempt.id, 'recorded', { recordedKey: `row:${w.targetOf('order_payments').table.id}:1`, recordedAt: Date.now() });
    await refundsRepo(h.meta).create({ attemptId: attempt.id, paymentId: null, provider: 'fakepay', mode: 'live', paymentRef: 'pi_1', amount: '3.00', currency: 'EUR', reason: 'other', note: null, idempotencyKey: `prov-${dialect}`.padEnd(20, 'x'), source: 'provider', requestedBy: null, state: 'succeeded', providerRefundId: 're_dash' });
    expect(await followRecord(deps, attempt.id)).toBe('written');
    const [payment] = await h.rows(`select refunded_elsewhere from ${h.real('order_payments')} where id = 1`);
    // 3.00 from the dashboard; the 7.50 the app's own row says is the app's to count.
    expect(Number(payment!['refunded_elsewhere'])).toBe(3);
  });

  it.skipIf(!available)("lets the app's own refund right refund the app's payments, and no other", async () => {
    const holding = (...held: string[]) => ({ apiKeyPrincipal: null, can: async (permission: string) => held.includes(permission) });
    expect(await mayRefundPayment(h.meta, holding('payments:counter:refund'), attempt.payable)).toBe(true);
    expect(await mayRefundPayment(h.meta, holding('payments:other:refund'), attempt.payable)).toBe(false);
    expect(await mayRefundPayment(h.meta, holding('system:payments:refund'), attempt.payable)).toBe(true);
    // An invoice of the Invoices page is no app's: only the install's right refunds it.
    expect(await mayRefundPayment(h.meta, holding('payments:counter:refund'), { kind: 'document', connectionId: null, tableName: null, rowKey: 'idoc_1' })).toBe(false);
    expect(await mayRefundPayment(h.meta, { apiKeyPrincipal: { id: 'k' }, can: async () => true }, attempt.payable)).toBe(false);
  });

  it.skipIf(!available)('the sweep finds an online refund row nothing queued', async () => {
    await h.rows(`insert into ${h.real('order_refunds')} (id, payment_id, amount, method) values (30, 1, 1.00, 'online'), (31, 2, 1.00, 'cash')`);
    const queued: string[] = [];
    expect(await pickUpAppRefunds({ ...deps, enqueue: async (input) => void queued.push(String(input.payload['rowKey'])) })).toBe(1);
    expect(queued).toEqual(['30']);
  });
});

/** The counter with free cancellations: placed → cancelled refunds by itself, behind the app's own switch. */
function cancelling(): Doc {
  const m = counter();
  const tables = (m['requiredSchema'] as { tables: Doc[] }).tables;
  tables.push({ ref: 'settings', columns: [id, { ref: 'auto_refund', type: 'bool', default: true }] });
  const orders = tables.find((one) => one['ref'] === 'orders')!;
  (orders['columns'] as Doc[]).splice(4, 1, { ref: 'status', type: 'enum', enum: ['paying', 'placed', 'ready', 'cancelled'], default: 'placed' });
  const payable = ((m['payments'] as Doc)['payables'] as Doc[])[0]!;
  payable['status'] = { column: 'status', paid: 'placed', from: ['paying'] };
  (payable['refunds'] as Doc)['auto'] = { values: { method: 'online' } };
  payable['refundOn'] = { moves: [{ from: ['placed'], to: 'cancelled', by: ['customer', 'system', 'refund-right'] }], switch: { table: 'settings', column: 'auto_refund' } };
  return m;
}

describe.each(LEGS)('refunds that start by themselves after a move — %s', (dialect, available) => {
  let h: InvoicingHarness;
  let w: Awaited<ReturnType<typeof writerFor>>;
  let deps: RefundDeps;
  let queued: string[];
  let n = 0;

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, cancelling());
    w = await writerFor(h);
    queued = [];
    const provider = {
      refund: async (input: { paymentRef: string; amount: string; currency: string }) => ({ ok: true as const, ref: `re_auto_${input.paymentRef}`, paymentRef: input.paymentRef, status: 'succeeded' as const, amount: input.amount, currency: input.currency, failureMessage: null }),
    };
    deps = {
      meta: h.meta,
      sources: createPayableSources({ meta: h.meta, manager: h.manager }),
      providerFor: async () => ({ ok: true, provider } as never),
      enqueue: async (input) => void queued.push(String(input.payload['attemptId'])),
    };
    await h.rows(`insert into ${h.real('settings')} (id, auto_refund) values (1, ${dialect === 'postgres' ? 'true' : '1'})`);
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await h.close();
  });

  /** An order paid online, recorded into the app's payments table. */
  async function paidOrder(): Promise<{ orderId: number; attempt: PaymentAttempt }> {
    n += 1;
    const orderId = 100 + n;
    const attempts = paymentAttemptsRepo(h.meta);
    const made = (await attempts.create({ provider: 'fakepay', mode: 'live', accountId: 'acct', payable: { kind: 'profile', connectionId: h.connectionId, tableName: w.targetOf('orders').table.id, rowKey: String(orderId) }, payableLabel: `C-${String(orderId)}`, amount: '12.00', currency: 'EUR', linkId: null, nonce: `auto-${dialect}-${String(n)}`.padEnd(22, 'x'), createdBy: null }))!;
    await attempts.move(made.id, 'open', { providerRef: `cs_${String(n)}` });
    await attempts.move(made.id, 'succeeded', { takenAmount: '12.00', takenCurrency: 'EUR', paymentRef: `pi_auto_${String(n)}`, paidWith: { method: 'card', label: 'Visa', delayed: false } });
    await attempts.move(made.id, 'recording', {});
    await attempts.move(made.id, 'recorded', { recordedKey: `row:${w.targetOf('order_payments').table.id}:${String(orderId)}`, recordedAt: Date.now() });
    await h.rows(`insert into ${h.real('orders')} (id, number, total, balance, status) values (${String(orderId)}, 'C-${String(orderId)}', 12.00, 0.00, 'placed')`);
    await h.rows(`insert into ${h.real('order_payments')} (id, order_id, amount, method, payment_ref) values (${String(orderId)}, ${String(orderId)}, 12.00, 'online', '${made.id}')`);
    return { orderId, attempt: (await attempts.byId(made.id))! };
  }

  /** The order's move, as the event the write announces says it, by whoever made it. */
  const moved = (orderId: number, from: string, to: string, by: { origin: 'public' | 'dashboard' | 'automation'; refunds?: boolean; system?: boolean }) =>
    ({
      connectionId: h.connectionId,
      table: w.targetOf('orders').table,
      action: 'update',
      entity: { connectionId: h.connectionId, table: w.targetOf('orders').table.id, pk: { id: orderId }, label: String(orderId) },
      before: { id: orderId, status: from },
      after: { id: orderId, status: to },
      origin: by.origin,
      ...(by.origin === 'dashboard' ? { request: { user: { id: 'usr_kim' }, can: async (permission: string) => by.refunds === true && permission === 'system:payments:refund' } } : {}),
      ...(by.system === true ? { request: null, actor: { kind: 'system', id: null, label: 'Timed move' } } : {}),
    }) as never;

  it.skipIf(!available)("refunds the customer's own free cancellation by itself: the app's refund row, written once, its money sent", async () => {
    const watch = createRefundMoveWatch({ ...deps, setting: (connectionId, table, column) => deps.sources.setting!(connectionId, table, column) });
    const { orderId, attempt } = await paidOrder();
    await watch.onRecordEvent(moved(orderId, 'placed', 'cancelled', { origin: 'public' }));
    expect(queued).toEqual([attempt.id]);
    expect(await giveAutoRefund(deps, attempt.id)).toBe('refunded');
    const rows = await h.rows(`select payment_id, amount, method, provider_ref, refund_state from ${h.real('order_refunds')} where payment_id = ${String(orderId)}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ method: 'online', provider_ref: `re_auto_pi_auto_${String(n)}`, refund_state: 'done' });
    expect(Number(rows[0]!['amount'])).toBe(12);
    expect((await refundsRepo(h.meta).forAttempt(attempt.id)).map((one) => [one.source, one.amount, one.state])).toEqual([['auto', '12.00', 'succeeded']]);
    // Once per payment: run again, nothing more.
    expect(await giveAutoRefund(deps, attempt.id)).toBe('nothing');
    expect(await h.rows(`select id from ${h.real('order_refunds')} where payment_id = ${String(orderId)}`)).toHaveLength(1);
  });

  it.skipIf(!available)('a timed move refunds by itself too; a move the app does not name never does', async () => {
    const watch = createRefundMoveWatch({ ...deps, setting: (connectionId, table, column) => deps.sources.setting!(connectionId, table, column) });
    queued.length = 0;
    const lapsed = await paidOrder();
    await watch.onRecordEvent(moved(lapsed.orderId, 'placed', 'cancelled', { origin: 'automation', system: true }));
    expect(queued).toEqual([lapsed.attempt.id]);
    const ready = await paidOrder();
    await watch.onRecordEvent(moved(ready.orderId, 'ready', 'cancelled', { origin: 'public' }));
    expect(queued).toEqual([lapsed.attempt.id]);
    expect((await paymentAttemptsRepo(h.meta).byId(ready.attempt.id))!.problem).toBeNull();
  });

  it.skipIf(!available)("leaves 'Refund owed' when staff without the refund right cancel, or the app's switch is off", async () => {
    const watch = createRefundMoveWatch({ ...deps, setting: (connectionId, table, column) => deps.sources.setting!(connectionId, table, column) });
    queued.length = 0;
    const kitchen = await paidOrder();
    await watch.onRecordEvent(moved(kitchen.orderId, 'placed', 'cancelled', { origin: 'dashboard', refunds: false }));
    expect(queued).toEqual([]);
    expect((await paymentAttemptsRepo(h.meta).byId(kitchen.attempt.id))!.problem).toMatchObject({ code: REFUND_OWED });
    // A manager who may refund: refunded.
    const manager = await paidOrder();
    await watch.onRecordEvent(moved(manager.orderId, 'placed', 'cancelled', { origin: 'dashboard', refunds: true }));
    expect(queued).toEqual([manager.attempt.id]);
    // The switch off: the customer's own cancel is owed, not refunded.
    await h.rows(`update ${h.real('settings')} set auto_refund = ${dialect === 'postgres' ? 'false' : '0'} where id = 1`);
    const off = await paidOrder();
    await watch.onRecordEvent(moved(off.orderId, 'placed', 'cancelled', { origin: 'public' }));
    expect(queued).toEqual([manager.attempt.id]);
    expect((await paymentAttemptsRepo(h.meta).byId(off.attempt.id))!.problem).toMatchObject({ code: REFUND_OWED });
    // Refunded in full by a person (in the app), the payment owes nothing more.
    await refundsRepo(h.meta).create({ attemptId: kitchen.attempt.id, paymentId: null, provider: 'fakepay', mode: 'live', paymentRef: kitchen.attempt.paymentRef!, amount: '12.00', currency: 'EUR', reason: 'other', note: null, idempotencyKey: `owed-${dialect}`.padEnd(20, 'x'), source: 'app', requestedBy: 'usr_mara', state: 'succeeded', providerRefundId: `re_owed_${dialect}`, appRow: { connectionId: h.connectionId, table: 'x', rowKey: '1' } });
    await followRecord(deps, kitchen.attempt.id);
    expect((await paymentAttemptsRepo(h.meta).byId(kitchen.attempt.id))!.problem).toBeNull();
    await h.rows(`update ${h.real('settings')} set auto_refund = ${dialect === 'postgres' ? 'true' : '1'} where id = 1`);
  });
});

/** The column model: no refund rows; Adminium's own refund, its total written onto the payment row. */
function columnModel(): Doc {
  const m = cancelling();
  const tables = (m['requiredSchema'] as { tables: Doc[] }).tables;
  ((tables.find((one) => one['ref'] === 'order_payments')!)['columns'] as Doc[]).push(money('refunded'));
  const payable = ((m['payments'] as Doc)['payables'] as Doc[])[0]!;
  payable['refunds'] = { model: 'column' };
  (payable['payments'] as Doc)['refunded'] = 'refunded';
  delete (payable['payments'] as Doc)['refundedElsewhere'];
  return m;
}

describe.each(LEGS)('a free cancellation refunded under the column model — %s', (dialect, available) => {
  let h: InvoicingHarness;
  let w: Awaited<ReturnType<typeof writerFor>>;
  let deps: RefundDeps;
  const queued: string[] = [];

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, columnModel());
    w = await writerFor(h);
    const provider = {
      refund: async (input: { paymentRef: string; amount: string; currency: string }) => ({ ok: true as const, ref: `re_col_${input.paymentRef}`, paymentRef: input.paymentRef, status: 'succeeded' as const, amount: input.amount, currency: input.currency, failureMessage: null }),
    };
    deps = { meta: h.meta, sources: createPayableSources({ meta: h.meta, manager: h.manager }), providerFor: async () => ({ ok: true, provider } as never), enqueue: async (input) => void queued.push(String(input.payload['attemptId'])) };
    await h.rows(`insert into ${h.real('settings')} (id, auto_refund) values (1, ${dialect === 'postgres' ? 'true' : '1'})`);
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await h.close();
  });

  it.skipIf(!available)("gives the money back by Adminium's own refund and writes it onto the payment row", async () => {
    const attempts = paymentAttemptsRepo(h.meta);
    const made = (await attempts.create({ provider: 'fakepay', mode: 'live', accountId: 'acct', payable: { kind: 'profile', connectionId: h.connectionId, tableName: w.targetOf('orders').table.id, rowKey: '7' }, payableLabel: 'C-7', amount: '15.00', currency: 'EUR', linkId: null, nonce: `col-${dialect}`.padEnd(22, 'x'), createdBy: null }))!;
    await attempts.move(made.id, 'open', { providerRef: 'cs_col' });
    await attempts.move(made.id, 'succeeded', { takenAmount: '15.00', takenCurrency: 'EUR', paymentRef: 'pi_col', paidWith: { method: 'card', label: 'Visa', delayed: false } });
    await attempts.move(made.id, 'recording', {});
    await attempts.move(made.id, 'recorded', { recordedKey: `row:${w.targetOf('order_payments').table.id}:7`, recordedAt: Date.now() });
    await h.rows(`insert into ${h.real('orders')} (id, number, total, balance, status) values (7, 'C-7', 15.00, 0.00, 'placed')`);
    await h.rows(`insert into ${h.real('order_payments')} (id, order_id, amount, method, payment_ref) values (7, 7, 15.00, 'online', '${made.id}')`);
    const watch = createRefundMoveWatch({ ...deps, setting: (connectionId, table, column) => deps.sources.setting!(connectionId, table, column) });
    await watch.onRecordEvent({
      connectionId: h.connectionId,
      table: w.targetOf('orders').table,
      action: 'update',
      entity: { connectionId: h.connectionId, table: w.targetOf('orders').table.id, pk: { id: 7 }, label: '7' },
      before: { id: 7, status: 'placed' },
      after: { id: 7, status: 'cancelled' },
      origin: 'public',
    } as never);
    expect(queued).toEqual([made.id]);
    expect(await giveAutoRefund(deps, made.id)).toBe('refunded');
    expect((await refundsRepo(h.meta).forAttempt(made.id)).map((one) => [one.source, one.amount, one.state, one.appRow])).toEqual([['auto', '15.00', 'succeeded', null]]);
    await followRecord(deps, made.id);
    const [payment] = await h.rows(`select refunded from ${h.real('order_payments')} where id = 7`);
    expect(Number(payment!['refunded'])).toBe(15);
    expect(await giveAutoRefund(deps, made.id)).toBe('nothing');
  });
});
