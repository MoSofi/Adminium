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
 */
import { payableProfilesRepo } from '@adminium/meta';
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
