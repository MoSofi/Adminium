// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SAVES THAT ARRIVE TOGETHER.
 *
 * A posting reads what is left, asks the add-on, and writes — and twenty of
 * them may do so in the same instant for the same four things. The lock a
 * save takes before its transaction, named after the rows it will take from,
 * is what makes them queue: each plans against what the one before it left.
 * These tests send the saves at once and count what was written.
 *
 *  - Twenty for the last four write four, and the other sixteen are told
 *    there is none — by staff saves (the account's cap says so) and by
 *    customers' (the add-on says so, with what is left).
 *  - Two orders that take the same two things in opposite order both go
 *    through: neither waits on the other for ever.
 *  - A line being changed while its order is being placed: one of the two
 *    comes first, and what is held is what the line says — never the amount
 *    of before with the line of after.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LEGS } from './invoicing-install.helpers.js';
import { DESK, GUEST, ledgerWorld, type LedgerWorld } from './ledger.helpers.js';

const INTO = { addOn: 'ledger-kit', ledger: 'units' };
/** Taken as the row is counted: nothing is held first. */
const TALLY = { id: 'tally', into: { ...INTO, action: 'count' }, map: { account: 'account_id', quantity: 'qty' }, post: { on: { column: 'status', in: ['counted'] } } };
/** A customer's take: the add-on itself says no when there is too little. */
const TAKE = { id: 'take', into: { ...INTO, action: 'use' }, map: { account: 'account_id', quantity: 'qty' }, post: { on: { column: 'status', in: ['taken'] } }, reverse: { on: { column: 'status', in: ['undone'] } } };
/** An order's lines, held once the order is placed. */
const LINE = {
  id: 'line',
  into: { ...INTO, action: 'use' },
  via: 'order_id',
  map: { account: 'account_id', quantity: 'qty' },
  reserve: { on: { column: 'status', in: ['placed'] } },
  post: { on: { column: 'status', in: ['picked_up'] } },
  reverse: { on: { column: 'status', in: ['cancelled'] } },
  heldUntil: { parent: 'hold_until' },
};

type Settled = { ok: true } | { ok: false; code: string; reason: string | undefined; left: unknown };
const settle = async (run: Promise<unknown>): Promise<Settled> => {
  try {
    await run;
    return { ok: true };
  } catch (error) {
    const told = error as { code?: string; details?: { reason?: string; left?: unknown } };
    return { ok: false, code: String(told.code), reason: told.details?.reason, left: told.details?.left };
  }
};

describe.each(LEGS)('saves that arrive together — %s', (dialect, available) => {
  let w: LedgerWorld;
  const moment = dialect === 'postgres' ? 'TIMESTAMPTZ' : dialect === 'mysql' ? 'DATETIME' : 'TEXT';
  const account = async (id: number) => {
    const [row] = await w.h.rows(`SELECT taken, balance, held FROM ledger_kit_accounts WHERE id = ${String(id)}`);
    return { taken: Number(row!['taken']), balance: Number(row!['balance']), held: Number(row!['held']) };
  };
  const open = (id: number, opening: number) => w.h.rows(`INSERT INTO ledger_kit_accounts (id, name, opening, taken, balance, allow_below, reorder_at) VALUES (${String(id)}, 'Account ${String(id)}', ${String(opening)}, 0, ${String(opening)}, ${w.flag(false)}, 0)`);
  const order = (lines: { account: number; qty: string }[], status = 'placed') =>
    w.writes.createTree({
      root: {
        name: 'orders',
        target: w.target('orders'),
        values: { status },
        at: [],
        children: lines.map((entry, index) => ({ name: 'order_lines', target: w.target('order_lines'), values: { account_id: entry.account, qty: entry.qty }, via: { column: 'order_id', parentKey: 'id' }, at: ['order_lines', index], children: [] })),
      },
      context: DESK,
      mode: 'save',
      announce: async () => undefined,
      mapError: (error) => {
        throw error;
      },
    });

  beforeAll(async () => {
    if (!available) return;
    const columns = 'account_id INT NULL, qty DECIMAL(12,3) NULL, status VARCHAR(20) NULL';
    w = await ledgerWorld(dialect, {
      tallies: { columns, postings: [TALLY] },
      takes: { columns, postings: [TAKE] },
      orders: { columns: `status VARCHAR(20) NULL, hold_until ${moment} NULL`, postings: [] },
      order_lines: { columns: 'order_id INT NULL, account_id INT NULL, qty DECIMAL(12,3) NULL, FOREIGN KEY (order_id) REFERENCES orders(id)', postings: [LINE] },
    });
  }, 180_000);
  afterAll(async () => {
    if (available) await w.close();
  });

  it.skipIf(!available)('twenty saves for the last four units write four', async () => {
    await open(1, 4);
    const sent = await Promise.all(Array.from({ length: 20 }, () => settle(w.create('tallies', { account_id: 1, qty: '1', status: 'counted' }))));
    expect(sent.filter((one) => one.ok)).toHaveLength(4);
    // Every other was told there is none left: never a fault, never a save to try again.
    expect(sent.filter((one) => !one.ok).map((one) => (one.ok ? '' : `${one.code}:${String(one.reason)}`))).toEqual(Array.from({ length: 16 }, () => 'POSTING_REFUSED:out-of-stock'));
    expect(await account(1)).toMatchObject({ taken: 4, balance: 0 });
    expect(await w.count('ledger_kit_entries', 'account_id = 1')).toBe(4);
    expect(await w.count('tallies', 'account_id = 1')).toBe(4);
    expect(await w.count('ledger_kit_postings', `posting = 'tally'`)).toBe(4);
  }, 120_000);

  it.skipIf(!available)('twenty customers\' saves for four units write four, and each of the others is told by the add-on what is left', async () => {
    await open(2, 4);
    const sent = await Promise.all(Array.from({ length: 20 }, () => settle(w.create('takes', { account_id: 2, qty: '1', status: 'taken' }, GUEST))));
    expect(sent.filter((one) => one.ok)).toHaveLength(4);
    const refused = sent.filter((one): one is Extract<Settled, { ok: false }> => !one.ok);
    expect(refused.map((one) => `${one.code}:${String(one.reason)}`)).toEqual(Array.from({ length: 16 }, () => 'POSTING_REFUSED:out-of-stock'));
    // The add-on's own answer, read under the lock: nothing was left when each was asked — not the account's cap catching what the add-on let through.
    expect(refused.map((one) => String(one.left))).toEqual(Array.from({ length: 16 }, () => '0.000'));
    expect(await account(2)).toMatchObject({ taken: 4, balance: 0 });
    expect(await w.count('takes', 'account_id = 2')).toBe(4);
  }, 120_000);

  it.skipIf(!available)('two orders that take the same two accounts in opposite order both go through, every time', async () => {
    await open(3, 1000);
    await open(4, 1000);
    for (let round = 0; round < 8; round += 1) {
      const sent = await Promise.all([
        settle(order([{ account: 3, qty: '1' }, { account: 4, qty: '1' }])),
        settle(order([{ account: 4, qty: '1' }, { account: 3, qty: '1' }])),
      ]);
      expect(sent, `round ${String(round)}`).toEqual([{ ok: true }, { ok: true }]);
    }
    expect((await account(3)).held).toBe(16);
    expect((await account(4)).held).toBe(16);
  }, 180_000);

  it.skipIf(!available)('a line changed while its order is placed: what is held is what the line says, whichever came first', async () => {
    await open(5, 100_000);
    for (let round = 0; round < 12; round += 1) {
      const made = await order([{ account: 5, qty: '1' }], 'draft');
      const orderId = made.root['id'];
      const lineId = (await w.h.rows(`SELECT id FROM order_lines WHERE order_id = ${String(orderId)}`))[0]!['id'];
      const [edit, place] = await Promise.all([settle(w.update('order_lines', lineId, { qty: '5' })), settle(w.update('orders', orderId, { status: 'placed' }))]);
      // The order is placed either way; the line's change either came first, or is told to put the hold back first.
      expect(place, `round ${String(round)}`).toEqual({ ok: true });
      if (!edit.ok) expect(`${edit.code}:${String(edit.reason)}`, `round ${String(round)}`).toBe('POSTING_REFUSED:mapped-changed');
      const qty = Number((await w.h.rows(`SELECT qty FROM order_lines WHERE id = ${String(lineId)}`))[0]!['qty']);
      const held = (await w.h.rows(`SELECT amount FROM ledger_kit_holds WHERE receipt_id IN (SELECT id FROM ledger_kit_postings WHERE source_row = '${String(orderId)}' AND posting = 'line')`)).map((row) => Number(row['amount']));
      expect(qty, `round ${String(round)}`).toBe(edit.ok ? 5 : 1);
      expect(held, `round ${String(round)}: the line says ${String(qty)}`).toEqual([qty]);
    }
  }, 180_000);
});
