// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT A PUBLIC CALLER CAN MAKE WHILE PAYMENTS ARE ON OR OFF, through the
 * public door, on SQLite, Postgres and MySQL.
 *
 * A hotel that asks guests to pay as they book: with "required" and payments
 * on, the only booking a stranger can make is one that waits for its payment
 * (`pending_payment`); with payments off (no live service, the app switched
 * off) the hotel takes bookings as it always did. The entries say so with
 * `requirePayments`, beside the setting they already read: no caller can
 * book unpaid while paying is required and possible, nor be held to pay
 * while it is not. The state column is no caller's to write.
 *
 * An order counter whose diner may pay when they pick up instead
 * (`paying → placed`): refused while a payment for the order is on its way
 * (`requires.noPaymentInFlight`), told as `PUBLIC_WRITE_REFUSED` with
 * `reason: "payment-in-flight"`; allowed once it is not.
 */
import { payableProfilesRepo, paymentAttemptsRepo, paymentSettingsRepo } from '@adminium/meta';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { PAY_ADDRESS_DOC, payAddressSchema } from '../src/payments/links.js';
import { SWITCH_TTL_MS } from '../src/public-api/switches.js';
import { installInvoicing, invoicingManifest, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { guest } from './person-fixture.js';
import { servePublic, type Served } from './public-lane.helpers.js';

// The words tried here are read from the release to come.
vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.62' }));
// A live payment service, without a payment add-on: what `available` reads as "live".
const service = vi.hoisted(() => ({ live: false }));
vi.mock('../src/payments/ready.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/payments/ready.js')>()), anyLiveOn: async () => service.live }));

type Doc = Record<string, unknown>;
const id = { ref: 'id', type: 'int', role: 'pk' };
const money = (ref: string) => ({ ref, type: 'decimal', scale: 2, default: 0 });

function app(key: string, tables: Doc[], publicAccess: Doc[], payable: Doc): Doc {
  const m = invoicingManifest(tables);
  m['key'] = key;
  m['compatibility'] = { minAdminiumVersion: '0.3.62' };
  (m['pages'] as { bindings: Record<string, string> }[])[0]!.bindings = { rows: tables[tables.length - 1]!['ref'] as string };
  m['frontends'] = [
    { side: 'staff', kind: 'spa', entry: 'index.html' },
    { side: 'customer', kind: 'spa', entry: 'index.html' },
  ];
  m['publicAccess'] = publicAccess;
  m['payments'] = { payables: [payable] };
  return m;
}

/** A hotel: "When guests book" nothing / optional / required. */
function hotel(): Doc {
  const booking = (extra: Doc): Doc => ({ table: 'stays', methods: ['POST'], select: ['id', 'status'], writable: ['name'], humanCheck: true, ...extra });
  return app(
    'wren',
    [
      { ref: 'settings', columns: [id, { ref: 'pay_at_booking', type: 'enum', enum: ['nothing', 'optional', 'required'], default: 'nothing' }] },
      {
        ref: 'stays',
        columns: [id, { ref: 'name', type: 'text', maxLength: 60, nullable: true }, money('total'), money('balance'), { ref: 'status', type: 'enum', enum: ['pending_payment', 'booked', 'cancelled'], default: 'booked' }],
        states: { column: 'status', initial: 'booked', starts: ['pending_payment'], moves: { pending_payment: ['booked', 'cancelled'], booked: ['cancelled'] } },
      },
    ],
    [
      // Unpaid, as always: while the hotel asks nothing, or leaves it to the guest.
      booking({ requireSetting: [{ table: 'settings', column: 'pay_at_booking', in: ['nothing', 'optional'] }] }),
      // Unpaid while paying is required but the hotel cannot take payments online now.
      booking({ requireSetting: [{ table: 'settings', column: 'pay_at_booking', in: ['required'] }], requirePayments: 'off' }),
      // Waiting for its payment while paying is required and possible.
      booking({ defaults: { status: 'pending_payment' }, pay: true, requireSetting: [{ table: 'settings', column: 'pay_at_booking', in: ['required'] }], requirePayments: 'on' }),
    ],
    { table: 'stays', amount: { column: 'total' }, currency: { fixed: 'EUR' }, due: { column: 'balance' }, payments: { kind: 'kept' }, status: { column: 'status', paid: 'booked', from: ['pending_payment'] }, payableWhen: [{ column: 'status', in: ['pending_payment', 'booked'] }] },
  );
}

/** An order counter: pay now, or pay when you pick up instead. */
function counter(): Doc {
  return app(
    'crumb',
    [
      {
        ref: 'orders',
        columns: [id, { ref: 'code', type: 'text', maxLength: 16, nullable: true }, money('total'), money('balance'), { ref: 'status', type: 'enum', enum: ['paying', 'placed', 'cancelled'], default: 'placed' }],
        states: { column: 'status', initial: 'placed', starts: ['paying'], moves: { paying: [{ to: 'placed', requires: { noPaymentInFlight: true } }, 'cancelled'], placed: ['cancelled'] } },
      },
    ],
    [
      // The diner's own order, opened by its number and code: "Pay when you pick up instead".
      { table: 'orders', methods: ['GET', 'PATCH'], claim: { match: ['id', 'code'] }, select: ['id', 'status'], writable: ['status'] },
    ],
    { table: 'orders', amount: { column: 'total' }, currency: { fixed: 'EUR' }, due: { column: 'balance' }, payments: { kind: 'kept' }, status: { column: 'status', paid: 'placed', from: ['paying'] }, payableWhen: [{ column: 'status', eq: 'paying' }] },
  );
}

const codeOf = (res: { json: () => unknown }) => (res.json() as { error?: { code?: string } }).error?.code;

describe.each(LEGS)('a booking a stranger can make while payments are on or off — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let door: Served;
  let g: ReturnType<typeof guest>;
  let stays: string;
  let clock = Date.parse('2026-11-17T09:00:00.000Z');

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, hotel());
    await h.rows(`insert into ${h.real('settings')} (id, pay_at_booking) values (1, 'required')`);
    await paymentSettingsRepo(h.meta).set(PAY_ADDRESS_DOC, payAddressSchema, { origin: 'https://pay.wrenhouse.de' });
    const keys = (h.reply['publicAccess'] as { keys: Record<string, string> }).keys;
    door = await servePublic(h, keys['customer']!);
    g = guest(door, h);
    stays = h.real('stays');
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    service.live = false;
    await door.close();
    await h.close();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** The hotel's setting, with time moved past how long its answer is trusted. */
  const asks = async (mode: 'nothing' | 'optional' | 'required') => {
    await h.rows(`update ${h.real('settings')} set pay_at_booking = '${mode}'`);
    clock += SWITCH_TTL_MS + 1_000;
    vi.useFakeTimers({ now: clock, toFake: ['Date'] });
  };
  /** Payments on for the hotel: a live service and its app switched on — or off again. */
  const payments = async (on: boolean) => {
    service.live = on;
    const [profile] = await payableProfilesRepo(h.meta).list(h.connectionId);
    await payableProfilesRepo(h.meta).update(profile!.id, { enabled: on });
  };
  const book = (entry: '' | '_2' | '_3', name: string, values: Doc = {}) => g.request('POST', `/records/${stays}${entry}`, { payload: { values: { name, ...values } }, proof: 'write' });
  const statusOf = async (name: string) => (await h.rows(`select status from ${stays} where name = '${name}'`)).map((row) => row['status']);

  it.skipIf(!available)('with paying required and payments off, books as it always did, and holds nobody to pay', async () => {
    await payments(false);
    await asks('required');
    const asAlways = await book('_2', 'Ada');
    expect(asAlways.statusCode, asAlways.body).toBe(201);
    const held = await book('_3', 'Bea');
    expect(held.statusCode, held.body).toBe(403);
    expect(codeOf(held)).toBe('PUBLIC_SWITCHED_OFF');
    expect(codeOf(await book('', 'Cy'))).toBe('PUBLIC_SWITCHED_OFF');
    expect([await statusOf('Ada'), await statusOf('Bea'), await statusOf('Cy')]).toEqual([['booked'], [], []]);
  });

  it.skipIf(!available)('with paying required and payments on, a booking always waits for its payment', async () => {
    await payments(true);
    await asks('required');
    const paying = await book('_3', 'Dee');
    expect(paying.statusCode, paying.body).toBe(201);
    // The unpaid doors are shut: nobody gets the rooms without paying.
    for (const entry of ['', '_2'] as const) {
      const unpaid = await book(entry, `Eve${entry}`);
      expect(unpaid.statusCode, unpaid.body).toBe(403);
      expect(codeOf(unpaid)).toBe('PUBLIC_SWITCHED_OFF');
    }
    expect(await statusOf('Dee')).toEqual(['pending_payment']);
    expect(await statusOf('Eve')).toEqual([]);
  });

  it.skipIf(!available)('never lets a caller choose the state its booking starts in', async () => {
    await payments(true);
    await asks('required');
    const forced = await book('_3', 'Fay', { status: 'booked' });
    expect(forced.statusCode, forced.body).toBe(400);
    expect(await statusOf('Fay')).toEqual([]);
  });

  it.skipIf(!available)('switched off, or no service live: the paying door shuts and the hotel books unpaid again', async () => {
    await payments(true);
    service.live = false;
    await asks('required');
    expect(codeOf(await book('_3', 'Gus'))).toBe('PUBLIC_SWITCHED_OFF');
    expect((await book('_2', 'Hal')).statusCode).toBe(201);
    // A hotel that asks nothing is not touched by payments at all.
    await payments(true);
    await asks('nothing');
    expect((await book('', 'Ivy')).statusCode).toBe(201);
    expect([await statusOf('Gus'), await statusOf('Hal'), await statusOf('Ivy')]).toEqual([[], ['booked'], ['booked']]);
  });
});

describe.each(LEGS)('pay when you pick up instead, never under a payment on its way — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let door: Served;
  let g: ReturnType<typeof guest>;
  let orders: string;
  let n = 0;

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, counter());
    const keys = (h.reply['publicAccess'] as { keys: Record<string, string> }).keys;
    door = await servePublic(h, keys['customer']!);
    g = guest(door, h);
    orders = h.real('orders');
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await door.close();
    await h.close();
  });

  /** An order waiting for its payment, and a payment for it in the state given. */
  const order = async (key: number, state: 'processing' | 'recording' | 'failed' | null) => {
    await h.rows(`insert into ${orders} (id, code, total, balance, status) values (${String(key)}, 'K${String(key)}', 9.00, 9.00, 'paying')`);
    if (state === null) return;
    n += 1;
    const attempts = paymentAttemptsRepo(h.meta);
    const tableName = (await payableProfilesRepo(h.meta).list(h.connectionId))[0]!.tableName;
    const made = (await attempts.create({ provider: 'payments-stripe', mode: 'live', accountId: 'acct', payable: { kind: 'profile', connectionId: h.connectionId, tableName, rowKey: String(key) }, payableLabel: `K${String(key)}`, amount: '9.00', currency: 'EUR', linkId: null, nonce: `nonce-${dialect}-${String(n)}`.padEnd(22, 'x'), createdBy: null }))!;
    await attempts.move(made.id, 'open', { providerRef: `cs_${dialect}_${String(n)}` });
    if (state === 'failed') await attempts.move(made.id, 'failed', {});
    else if (state === 'processing') await attempts.move(made.id, 'processing', {});
    else {
      // Taken, and being written into the order now.
      await attempts.move(made.id, 'succeeded', { takenAmount: '9.00', takenCurrency: 'EUR', paymentRef: `pi_${dialect}_${String(n)}`, paidWith: { method: 'card', label: 'Visa', delayed: false } });
      await attempts.move(made.id, 'recording', {});
    }
  };
  /** The diner opens their order by its number and code, and asks to pay when they pick it up. */
  const payAtPickup = async (key: number) => {
    const claim = await g.request('POST', '/claim', { payload: { match: { id: key, code: `K${String(key)}` } } });
    expect(claim.statusCode, claim.body).toBe(200);
    const session = (claim.json() as { data: { session: string } }).data.session;
    return g.request('PATCH', `/records/${orders}_claimed/${String(key)}`, { payload: { values: { status: 'placed' } }, session });
  };
  const statusOf = async (key: number) => (await h.rows(`select status from ${orders} where id = ${String(key)}`))[0]?.['status'];

  it.skipIf(!available)('is refused while the bank is confirming, or the payment is being written down', async () => {
    for (const [key, state] of [[1, 'processing'], [2, 'recording']] as const) {
      await order(key, state);
      const res = await payAtPickup(key);
      expect(res.statusCode, res.body).toBe(400);
      expect(res.json()).toMatchObject({ error: { code: 'PUBLIC_WRITE_REFUSED', params: { reason: 'payment-in-flight' } } });
      expect(await statusOf(key)).toBe('paying');
    }
  });

  it.skipIf(!available)('goes through once nothing is on its way: no payment, or one that did not finish', async () => {
    for (const [key, state] of [[3, null], [4, 'failed']] as const) {
      await order(key, state);
      const res = await payAtPickup(key);
      expect(res.statusCode, res.body).toBe(200);
      expect(await statusOf(key)).toBe('placed');
    }
  });
});
