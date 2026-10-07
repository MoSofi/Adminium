// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT A PAYMENT TOOK, AND WHAT IS STILL TO PAY — the reply of a save in
 * which Adminium decided an amount (an account, or a gift card, paying what
 * is due as far as it goes): the amount decided for the request's first such
 * row, what is still due once the save is in, and the balance it left only
 * for somebody who may read the rows the ledger wrote.
 */
import { rolesRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PostedOutcome } from '../src/crud/ledger-write.js';
import { paymentOf } from '../src/ledgers/payment.js';
import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from './auth-helpers.js';
import { ledgerKitDecidesManifest } from './fixtures/ledger-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';
import { ledgerWorld, type LedgerWorld } from './ledger.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Doc = Record<string, unknown>;

/** Paid from an account, the payment's own row saying what is due. */
const PAY = { id: 'pay', into: { addOn: 'ledger-kit', ledger: 'units', action: 'pay' }, map: { account: 'account_id', due: 'due', amount: 'amount' }, post: { on: { create: true } }, reverse: { on: { column: 'status', in: ['void'] } } };
/** A payment of a bill: what is due is the bill's. */
const BILL_PAY = {
  id: 'bill-pay',
  into: { addOn: 'ledger-kit', ledger: 'units', action: 'pay' },
  via: 'bill_id',
  map: { account: 'account_id', due: { parent: 'due' }, amount: 'amount' },
  post: { on: { create: true } },
  reverse: { on: { column: 'voided_at', set: true, own: true } },
  only: { column: 'method', eq: 'account' },
};

describe.each(LEGS)('a save says what a decided payment took — %s', (dialect, available) => {
  let w: LedgerWorld;
  let served: Served;
  let cookie = '';
  const trusted = process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
  const staff = (method: string, url: string, payload?: Doc) =>
    served.composed.app.inject({ method: method as 'POST', url: `/api/v1/data/${w.h.connectionId}/${url}`, headers: { cookie }, ...(payload === undefined ? {} : { payload }) });
  const tableId = (name: string) => encodeURIComponent(w.target(name).table.id);

  beforeAll(async () => {
    if (!available) return;
    w = await ledgerWorld(
      dialect,
      {
        pays: { columns: 'account_id INT NULL, due DECIMAL(12,3) NULL, amount DECIMAL(12,3) NULL, status VARCHAR(20) NULL', postings: [PAY] },
        bills: { columns: 'due DECIMAL(12,3) NULL', postings: [] },
        bill_pays: { columns: 'bill_id INT NULL, account_id INT NULL, amount DECIMAL(12,3) NULL, method VARCHAR(20) NULL, voided_at VARCHAR(40) NULL, FOREIGN KEY (bill_id) REFERENCES bills(id)', postings: [BILL_PAY] },
        plain: { columns: 'note VARCHAR(40) NULL', postings: [] },
      },
      ledgerKitDecidesManifest(),
    );
    await w.h.rows(`INSERT INTO ledger_kit_accounts (id, name, opening, taken, balance, allow_below, reorder_at) VALUES (1, 'Card', 10, 0, 10, ${w.flag(false)}, 0), (2, 'Small card', 2, 0, 2, ${w.flag(false)}, 0)`);
    await w.h.rows('INSERT INTO bills (id, due) VALUES (1, 7.5)');
    process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = 'ledger-kit';
    served = await servePublic(w.h as never, null, { ADMINIUM_DATA_DIR: w.h.dataDir });
    const desk = await usersRepo(w.h.meta).create({ email: 'desk@pay.example', name: 'Desk', passwordHash: await adminPasswordHash(), status: 'active' });
    await rolesRepo(w.h.meta).assignToUser(desk.id, (await rolesRepo(w.h.meta).findBySlug('super-admin'))!.id);
    const login = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'desk@pay.example', password: ADMIN_PASSWORD } });
    cookie = sessionCookie(login.headers['set-cookie']);
  }, 240_000);
  afterAll(async () => {
    if (trusted === undefined) delete process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
    else process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = trusted;
    await served?.close();
    if (available) await w.close();
  });

  it.skipIf(!available)('the amount decided, and what the row itself says is due', async () => {
    const made = await staff('POST', tableId('pays'), { values: { account_id: 1, due: '3' } });
    expect(made.statusCode, made.body).toBe(201);
    const body = made.json() as { data: Doc; payment?: Doc; undoToken: unknown };
    // Three were due and the account had ten: all three are paid.
    expect(Number(body.data['amount'])).toBe(3);
    expect(body.payment).toEqual({ amount: '3.00', due: '3.00' });
    // An account that holds less pays what it holds: the reply says how far it went.
    const short = await staff('POST', tableId('pays'), { values: { account_id: 2, due: '5' } });
    expect(short.statusCode, short.body).toBe(201);
    expect((short.json() as { payment?: Doc }).payment).toEqual({ amount: '2.00', due: '5.00' });
  });

  it.skipIf(!available)('what is due is read from the row above when the rule says it is the bill\'s', async () => {
    const made = await staff('POST', tableId('bill_pays'), { values: { bill_id: 1, account_id: 1, method: 'account' } });
    expect(made.statusCode, made.body).toBe(201);
    expect((made.json() as { payment?: Doc }).payment).toEqual({ amount: '7.00', due: '7.50' });
    // A payment the ledger is not asked about — cash — decides nothing, and says nothing.
    const cash = await staff('POST', tableId('bill_pays'), { values: { bill_id: 1, account_id: 1, method: 'cash', amount: '1' } });
    expect(cash.statusCode, cash.body).toBe(201);
    expect(cash.json()).not.toHaveProperty('payment');
    const other = await staff('POST', tableId('plain'), { values: { note: 'x' } });
    expect(other.json()).not.toHaveProperty('payment');
  });
});

describe('the payment a save decided, read off what it did', () => {
  const table = (id: string, postings: unknown[], primaryKey = ['id']) => ({ id, name: id, primaryKey, columns: new Map(), table: { id, name: id, columns: [], postings } }) as never;
  const view = (relations: unknown[] = [], tables: Record<string, unknown> = {}) => ({ model: { relations, tables: [] }, table: (id: string) => tables[id] }) as never;
  const outcome = (over: Partial<PostedOutcome>): PostedOutcome => ({ addOn: 'kit', ledger: 'cards', action: 'spend', posting: 'card', phase: 'post', round: 1, rows: 1, version: '1', state: 'planned', source: { table: 't', row: '1' }, lines: [], notes: [], written: [], decided: [], ...over });
  const never = async () => null;
  const OWN = { id: 'card', map: { card: 'card_id', due: 'due', amount: 'amount', balance_after: 'balance_after' } };
  const payments = table('payments', [OWN]);

  it('is the first row whose amount was decided, with what its rule maps as due and the balance it left', async () => {
    const rows = [
      { table: payments, row: { id: 4, due: '10', amount: null } },
      { table: payments, row: { id: 5, due: '29.105', amount: '19' } },
      { table: payments, row: { id: 6, due: '0', amount: '5' } },
    ];
    const ledgerRows = table('card_ledger', []);
    const found = await paymentOf({
      view: view(),
      rows,
      parentOf: never,
      outcomes: [
        outcome({ record: { table: payments, pk: { id: 5 } }, decided: [{ line: '', input: 'amount', column: 'amount', value: '19.000' }, { line: '', input: 'balance_after', column: 'balance_after', value: '0' }], written: [{ table: ledgerRows, row: {}, before: null }, { table: ledgerRows, row: {}, before: null }] }),
        outcome({ record: { table: payments, pk: { id: 6 } }, decided: [{ line: '', input: 'amount', column: 'amount', value: '5' }] }),
      ],
    });
    // Money as text at the column's own decimals: 29.105 is 29.11, never a float.
    expect(found).toEqual({ payment: { amount: '19.00', due: '29.11' }, balanceAfter: '0.00', wrote: [ledgerRows] });
  });

  it('reads what is due from the row above — the one the request wrote, else the one it is asked for', async () => {
    const orders = table('orders', []);
    const lines = table('order_payments', [{ id: 'card', via: 'order_id', map: { due: { parent: 'due' }, amount: 'amount' } }]);
    const relations = [{ through: null, from: { tableId: 'order_payments', columns: ['order_id'] }, to: { tableId: 'orders', columns: ['id'] } }];
    const decided = [outcome({ record: { table: orders, pk: { id: 8 } }, decided: [{ line: '31', input: 'amount', column: 'amount', value: '19' }] })];
    const row = { table: lines, row: { id: 31, order_id: 8, amount: '19' } };
    // The order was written with its payment: what the save left on it.
    expect((await paymentOf({ view: view(relations, { orders }), rows: [{ table: orders, row: { id: 8, due: '29.11' } }, row], outcomes: decided, parentOf: never }))?.payment).toEqual({ amount: '19.00', due: '29.11' });
    // The order was there already: read after the save.
    const asked: unknown[] = [];
    const read = await paymentOf({ view: view(relations, { orders }), rows: [row], outcomes: decided, parentOf: async (of, key) => (asked.push([of, key]), { id: 8, due: '4' }) });
    expect(read?.payment).toEqual({ amount: '19.00', due: '4.00' });
    expect(asked).toEqual([[orders, 8]]);
    // Another line's decision is not this row's.
    expect(await paymentOf({ view: view(relations, { orders }), rows: [{ table: lines, row: { id: 32, order_id: 8 } }], outcomes: decided, parentOf: never })).toBeUndefined();
  });

  it('says nothing when nothing was decided, when the rule maps nothing as due, or when what is due cannot be read', async () => {
    const decided = [{ line: '', input: 'amount', column: 'amount', value: '3' }];
    const row = { table: payments, row: { id: 5, due: '3' } };
    expect(await paymentOf({ view: view(), rows: [row], outcomes: undefined, parentOf: never })).toBeUndefined();
    expect(await paymentOf({ view: view(), rows: [row], outcomes: [outcome({ record: { table: payments, pk: { id: 5 } } })], parentOf: never })).toBeUndefined();
    // Another rule's decision, and another row's.
    expect(await paymentOf({ view: view(), rows: [row], outcomes: [outcome({ posting: 'other', record: { table: payments, pk: { id: 5 } }, decided })], parentOf: never })).toBeUndefined();
    expect(await paymentOf({ view: view(), rows: [row], outcomes: [outcome({ record: { table: payments, pk: { id: 6 } }, decided })], parentOf: never })).toBeUndefined();
    const blind = table('payments', [{ id: 'card', map: { amount: 'amount' } }]);
    expect(await paymentOf({ view: view(), rows: [{ table: blind, row: { id: 5 } }], outcomes: [outcome({ record: { table: blind, pk: { id: 5 } }, decided })], parentOf: never })).toBeUndefined();
    expect(await paymentOf({ view: view(), rows: [{ table: payments, row: { id: 5, due: null } }], outcomes: [outcome({ record: { table: payments, pk: { id: 5 } }, decided })], parentOf: never })).toBeUndefined();
    // With a balance decided and nothing written (a quote), nobody is named who could read it.
    const quoted = await paymentOf({ view: view(), rows: [row], outcomes: [outcome({ record: { table: payments, pk: { id: 5 } }, decided: [...decided, { line: '', input: 'balance_after', column: 'balance_after', value: '7' }] })], parentOf: never });
    expect(quoted).toEqual({ payment: { amount: '3.00', due: '3.00' }, balanceAfter: '7.00', wrote: [] });
  });
});
