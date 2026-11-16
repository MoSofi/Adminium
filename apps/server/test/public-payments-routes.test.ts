// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE PUBLIC PAYMENT ROUTES, through the public door, on SQLite, Postgres and MySQL.
 *
 * `GET /public/payments/available` answers the key's app only, and false
 * while the app is not switched on. `POST /public/payments/start` owes a
 * proof, reads the record through the entry it names first — a record the
 * key cannot read is the same 404 as a missing one — and is refused `off`
 * while the app takes no payments. (Starting for real, with a live service
 * and a reachable pay address, is `payments-public-pay.test.ts`.)
 * `GET /public/payments/state` reads the record the same way, and answers how
 * its newest online payment stands in one word, and nothing else of it.
 */
import { payableProfilesRepo, paymentAttemptsRepo, type AttemptState } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { installInvoicing, invoicingManifest, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { guest } from './person-fixture.js';
import { servePublic, type Served } from './public-lane.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.60' }));

type Doc = Record<string, unknown>;
const id = { ref: 'id', type: 'int', role: 'pk' };
const money = (ref: string) => ({ ref, type: 'decimal', scale: 2, default: 0 });

function counter(checkout = false): Doc {
  const m = invoicingManifest([
    {
      ref: 'orders',
      columns: [id, { ref: 'number', type: 'text', maxLength: 40, nullable: true }, money('total'), money('balance'), { ref: 'status', type: 'enum', enum: ['paying', 'placed'], default: 'placed' }],
      states: { column: 'status', initial: 'placed', starts: ['paying'], moves: { paying: ['placed'] } },
    },
  ]);
  m['key'] = 'counter';
  m['compatibility'] = { minAdminiumVersion: '0.3.60' };
  (m['pages'] as { bindings: Record<string, string> }[])[0]!.bindings = { rows: 'orders' };
  m['frontends'] = [
    { side: 'staff', kind: 'spa', entry: 'index.html' },
    { side: 'customer', kind: 'spa', entry: 'index.html' },
  ];
  m['publicAccess'] = checkout
    ? // The checkout: a create that answers the new order's pay link while the shop takes payments online.
      [{ table: 'orders', methods: ['POST'], select: ['id', 'status'], writable: ['number'], defaults: { status: 'paying' }, humanCheck: true, pay: true }]
    : // A board of open orders anyone may read: only those still being paid for.
      [{ table: 'orders', methods: ['GET'], select: ['id', 'number', 'total', 'status'], filters: [{ column: 'status', op: 'eq', value: 'paying' }] }];
  m['payments'] = {
    payables: [{ table: 'orders', label: 'number', amount: { column: 'total' }, currency: { fixed: 'EUR' }, due: { column: 'balance' }, payments: { kind: 'kept' }, payableWhen: [{ column: 'status', eq: 'paying' }] }],
  };
  return m;
}

describe.each(LEGS)('the public payment routes — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let shop: Served;
  let g: ReturnType<typeof guest>;
  let ref: string;

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, counter());
    await h.rows(`insert into ${h.real('orders')} (id, number, total, balance, status) values (1, 'C-1', 12.50, 12.50, 'paying'), (2, 'C-2', 8.00, 8.00, 'placed')`);
    const keys = (h.reply['publicAccess'] as { keys: Record<string, string> }).keys;
    shop = await servePublic(h, keys['customer']!);
    g = guest(shop, h);
    ref = h.real('orders');
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await shop.close();
    await h.close();
  });

  const startFor = (rowId: string) =>
    shop.composed.app.inject({
      method: 'POST',
      url: '/api/v1/public/payments/start',
      headers: shop.headers(undefined),
      payload: { ref, id: rowId },
    });

  it.skipIf(!available)('says the app takes no payments while nobody switched it on', async () => {
    const res = await g.request('GET', '/payments/available');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ data: { online: false } });
    const [profile] = await payableProfilesRepo(h.meta).list(h.connectionId);
    expect(profile).toMatchObject({ ownerApp: 'counter', enabled: false });
  });

  it.skipIf(!available)('owes a proof, reads the record first, and refuses while the app is off', async () => {
    const unproved = await startFor('1');
    expect(unproved.statusCode, unproved.body).toBe(403);
    expect(unproved.json()).toMatchObject({ error: { code: 'PUBLIC_PROOF_REQUIRED' } });
    // Order 2 is not on the board this key reads: the same 404 as a missing one.
    for (const rowId of ['2', '99']) {
      const hidden = await g.request('POST', '/payments/start', { payload: { ref, id: rowId }, proof: 'pay-start' });
      expect(hidden.statusCode, hidden.body).toBe(404);
      expect(hidden.json()).toMatchObject({ error: { code: 'PUBLIC_REF_NOT_FOUND' } });
    }
    const off = await g.request('POST', '/payments/start', { payload: { ref, id: '1' }, proof: 'pay-start' });
    expect(off.statusCode, off.body).toBe(409);
    expect(off.json()).toMatchObject({ error: { code: 'PUBLIC_PAY_REFUSED', params: { reason: 'off' } } });
  });

  it.skipIf(!available)('answers how a record\'s newest payment stands, in one word, only for a record the key reads', async () => {
    const stateOf = (rowId: string) => g.request('GET', `/payments/state?ref=${encodeURIComponent(ref)}&id=${rowId}`);
    // Order 2 is not on the board this key reads, order 99 is not there: the same 404.
    for (const rowId of ['2', '99']) {
      const hidden = await stateOf(rowId);
      expect(hidden.statusCode, hidden.body).toBe(404);
      expect(hidden.json()).toMatchObject({ error: { code: 'PUBLIC_REF_NOT_FOUND' } });
    }
    const none = await stateOf('1');
    expect(none.statusCode, none.body).toBe(200);
    expect(none.json()).toEqual({ data: { state: 'none' } });
    // It changes as the bank answers: never kept by a browser or a cache.
    expect(none.headers['cache-control']).toBe('no-store');

    // Asked whether or not the app is switched on now: the app is off here.
    const [profile] = await payableProfilesRepo(h.meta).list(h.connectionId);
    const attempts = paymentAttemptsRepo(h.meta);
    let n = 0;
    const attempt = async (rowKey: string, mode: 'live' | 'test' = 'live') => {
      n += 1;
      const made = await attempts.create({
        provider: 'payments-stripe',
        mode,
        accountId: 'acct_1',
        payable: { kind: 'profile', connectionId: h.connectionId, tableName: profile!.tableName, rowKey },
        payableLabel: `C-${rowKey}`,
        amount: '12.50',
        currency: 'EUR',
        linkId: null,
        nonce: `nonce-${dialect}-state-${String(n)}`.padEnd(22, 'x'),
        createdBy: null,
      });
      return made!;
    };
    const told = async (rowId: string) => {
      const res = await stateOf(rowId);
      expect(res.statusCode, res.body).toBe(200);
      return res.json() as { data: Record<string, unknown> };
    };
    const one = await attempt('1');
    expect(await told('1')).toEqual({ data: { state: 'open' } });
    await attempts.move(one.id, 'open', { providerRef: `cs_${dialect}_state` });
    expect(await told('1')).toEqual({ data: { state: 'open' } });
    await attempts.move(one.id, 'processing', {});
    expect(await told('1')).toEqual({ data: { state: 'confirming' } });
    await attempts.move(one.id, 'succeeded', { takenAmount: '12.50', takenCurrency: 'EUR', paymentRef: `pi_${dialect}_state`, paidWith: { method: 'card', label: 'Visa ••4242', delayed: false } });
    // Paid, and nothing of the payment beside the word: no amount, service, card or id.
    const paid = await stateOf('1');
    expect(paid.json()).toEqual({ data: { state: 'paid' } });
    for (const secret of ['12.50', 'stripe', '4242', one.id, 'pi_', 'cs_']) expect(paid.body).not.toContain(secret);

    const ended: [string, AttemptState, string][] = [
      ['3', 'failed', 'failed'],
      ['4', 'cancelled', 'failed'],
      ['5', 'expired', 'expired'],
    ];
    await h.rows(`insert into ${h.real('orders')} (id, number, total, balance, status) values (3, 'C-3', 5, 5, 'paying'), (4, 'C-4', 5, 5, 'paying'), (5, 'C-5', 5, 5, 'paying'), (6, 'C-6', 5, 5, 'paying')`);
    for (const [rowId, to, word] of ended) {
      const made = await attempt(rowId);
      await attempts.move(made.id, 'open', { providerRef: `cs_${dialect}_${rowId}` });
      await attempts.move(made.id, to, {});
      expect(await told(rowId)).toEqual({ data: { state: word } });
    }
    // A rehearsal's test payment says so.
    await attempt('6', 'test');
    expect(await told('6')).toEqual({ data: { state: 'open', test: true } });
  });
});

describe.each(LEGS)('a checkout that answers a pay link — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let shop: Served;
  let g: ReturnType<typeof guest>;

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, counter(true));
    shop = await servePublic(h, (h.reply['publicAccess'] as { keys: Record<string, string> }).keys['customer']!);
    g = guest(shop, h);
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await shop.close();
    await h.close();
  });

  it.skipIf(!available)('still makes the order while the shop takes no payments online, and answers no link', async () => {
    const made = await g.request('POST', `/records/${h.real('orders')}`, { payload: { values: { number: 'C-3' } }, proof: 'write' });
    expect(made.statusCode, made.body).toBe(201);
    expect(made.json()).toMatchObject({ data: { status: 'paying' } });
    expect(made.body).not.toContain('payUrl');
  });
});
