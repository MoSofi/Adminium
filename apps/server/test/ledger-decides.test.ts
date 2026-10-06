// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN AMOUNT ADMINIUM DECIDES — how much of what is due an account pays.
 *
 * The row that posts cannot say how much: no door writes that column. The
 * add-on's plan proposes an amount; Adminium takes it only between zero and
 * every ceiling the action declares, each read by Adminium itself (what the
 * row says is due, what the account holds), then writes it to the row with
 * the row's own formulas worked out again.
 */
import { overridesRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { PlanFailed } from '../src/crud/ledger-write.js';
import { ledgerKitDecidesManifest } from './fixtures/ledger-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';
import { ledgerWorld, refusal, type LedgerWorld } from './ledger.helpers.js';

vi.mock('../src/crud/unbuilt-rules.js', async (original) => ({
  ...(await original<typeof import('../src/crud/unbuilt-rules.js')>()),
  refuseUnbuiltTable: () => undefined,
}));

const PAY = { id: 'pay', into: { addOn: 'ledger-kit', ledger: 'units', action: 'pay' }, map: { account: 'account_id', due: 'due', amount: 'amount' }, post: { on: { create: true } }, reverse: { on: { column: 'status', in: ['void'] } } };

/** A payment of a bill, from an account: its own making is the point, its own void gives it back; a cash payment is not the ledger's. */
const BILL_PAY = {
  id: 'bill-pay',
  into: { addOn: 'ledger-kit', ledger: 'units', action: 'pay' },
  via: 'bill_id',
  map: { account: 'account_id', due: { parent: 'due' }, amount: 'amount' },
  post: { on: { create: true } },
  reverse: { on: { column: 'voided_at', set: true, own: true } },
  only: { column: 'method', eq: 'account' },
};

describe.each(LEGS)('an amount Adminium decides — %s', (dialect, available) => {
  let w: LedgerWorld;
  const balance = async (id: number) => Number((await w.h.rows(`SELECT balance FROM ledger_kit_accounts WHERE id = ${String(id)}`))[0]!['balance']);
  const stored = async (id: unknown) => {
    const row = (await w.h.rows(`SELECT amount, still_due FROM pays WHERE id = ${String(id)}`))[0]!;
    return { amount: row['amount'] === null ? null : Number(row['amount']), stillDue: row['still_due'] === null ? null : Number(row['still_due']) };
  };

  beforeAll(async () => {
    if (!available) return;
    w = await ledgerWorld(
      dialect,
      {
        pays: { columns: 'account_id INT NULL, due DECIMAL(12,3) NULL, amount DECIMAL(12,3) NULL, still_due DECIMAL(12,3) NULL, status VARCHAR(20) NULL', postings: [PAY] },
        bills: { columns: 'due DECIMAL(12,3) NULL', postings: [] },
        bill_pays: { columns: 'bill_id INT NULL, account_id INT NULL, amount DECIMAL(12,3) NULL, method VARCHAR(20) NULL, voided_at VARCHAR(40) NULL, FOREIGN KEY (bill_id) REFERENCES bills(id)', postings: [BILL_PAY] },
      },
      ledgerKitDecidesManifest(),
      async (h, idOf) => {
        // What is left to pay, worked out by the owner's own rule from the amount Adminium decides.
        await overridesRepo(h.meta).create({ connectionId: h.connectionId, op: 'column.formula', tableName: idOf('pays'), columnName: 'still_due', value: { formula: { sub: ['due', { coalesce: ['amount', 0] }] } }, origin: 'user' } as never);
      },
    );
    await w.h.rows(`INSERT INTO ledger_kit_accounts (id, name, opening, taken, balance, allow_below, reorder_at) VALUES (1, 'Card', 10, 0, 10, ${w.flag(false)}, 0), (2, 'Other card', 5, 0, 5, ${w.flag(false)}, 0), (3, 'Third card', 50, 0, 50, ${w.flag(false)}, 0)`);
  }, 180_000);
  afterAll(async () => {
    if (available) await w.close();
  });

  it.skipIf(!available)('what is due is paid, written to the row with its formulas worked out again, and taken from the account', async () => {
    const row = await w.create('pays', { account_id: 1, due: '3' });
    // The row the save answers carries the decided amount.
    expect(Number(row['amount'])).toBe(3);
    expect(await stored(row['id'])).toEqual({ amount: 3, stillDue: 0 });
    expect(await balance(1)).toBe(7);
    expect(w.posted()[0]!.decided).toEqual([{ line: '', input: 'amount', column: 'amount', value: '3.000' }]);
    expect(await w.receiptsOf('pay', row['id'])).toEqual(['post:1:planned:1']);
  });

  it.skipIf(!available)('never more than the account holds: the rest stays due', async () => {
    const row = await w.create('pays', { account_id: 2, due: '8' });
    expect(await stored(row['id'])).toEqual({ amount: 5, stillDue: 3 });
    expect(await balance(2)).toBe(0);
    // With nothing left, nothing is taken — and the row says so.
    const next = await w.create('pays', { account_id: 2, due: '2' });
    expect(await stored(next['id'])).toEqual({ amount: 0, stillDue: 2 });
    expect(await w.receiptsOf('pay', next['id'])).toEqual(['post:1:planned:0']);
  });

  it.skipIf(!available)('no door says how much: an amount sent with the row is not what is written', async () => {
    const row = await w.create('pays', { account_id: 1, due: '1', amount: '99' });
    expect(await stored(row['id'])).toMatchObject({ amount: 1 });
  });

  it.skipIf(!available)('a plan that decides below zero, above a ceiling, for another row or for an input it was not asked to decide fails the save', async () => {
    const before = { pays: await w.count('pays'), receipts: await w.count('ledger_kit_postings'), entries: await w.count('ledger_kit_entries'), balance: await balance(1) };
    try {
      for (const how of ['negative', 'over-due', 'decide-other-row', 'decide-undeclared']) {
        await w.misbehave(how);
        const error = await refusal(w.create('pays', { account_id: 1, due: '2' }));
        expect(error, how).toBeInstanceOf(PlanFailed);
        expect(error, how).toMatchObject({ code: 'POSTING_REFUSED', details: { reason: 'planner-failed', posting: 'pay' } });
        expect((error as unknown as PlanFailed).cause, how).toBe('scope-decides');
      }
    } finally {
      await w.misbehave(null);
    }
    expect({ pays: await w.count('pays'), receipts: await w.count('ledger_kit_postings'), entries: await w.count('ledger_kit_entries'), balance: await balance(1) }).toEqual(before);
  });

  it.skipIf(!available)('a payment added to a bill posts alone: held to what the BILL says is due, written to the payment', async () => {
    const bill = Number((await w.create('bills', { due: '6' }))['id']);
    const pay = await w.create('bill_pays', { bill_id: bill, account_id: 3, method: 'account' });
    expect(Number(pay['amount'])).toBe(6);
    expect(w.posted()).toMatchObject([{ posting: 'bill-pay', phase: 'post', source: { row: String(bill) }, lines: [String(pay['id'])], decided: [{ line: String(pay['id']), input: 'amount', column: 'amount', value: '6.000' }] }]);
    expect(await balance(3)).toBe(44);
  });

  it.skipIf(!available)('a payment the rule leaves out is never handed over, and may leave its account empty; one voided by its own column is given back alone', async () => {
    const bill = Number((await w.create('bills', { due: '4' }))['id']);
    const receipts = await w.count('ledger_kit_postings');
    // Cash: no account, and nothing asked of it.
    const cash = await w.create('bill_pays', { bill_id: bill, method: 'cash', amount: '1' });
    expect(w.posted()).toEqual([]);
    expect(await w.count('ledger_kit_postings')).toBe(receipts);
    const first = await w.create('bill_pays', { bill_id: bill, account_id: 3, method: 'account' });
    const second = await w.create('bill_pays', { bill_id: bill, account_id: 3, method: 'account' });
    const before = await balance(3);
    // Voiding the first is the payment's own point: it alone is given back.
    await w.update('bill_pays', Number(first['id']), { voided_at: 'now' });
    expect(w.posted()).toMatchObject([{ posting: 'bill-pay', phase: 'reverse', lines: [String(first['id'])] }]);
    expect(await balance(3)).toBe(before + 4);
    expect(await w.count('ledger_kit_postings', `posting = 'bill-pay' AND phase = 'reverse' AND source_line = '${String(second['id'])}'`)).toBe(0);
    // Voiding the cash payment hands nothing over either.
    await w.update('bill_pays', Number(cash['id']), { voided_at: 'now' });
    expect(w.posted()).toEqual([]);
  });
});
