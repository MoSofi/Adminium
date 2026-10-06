// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A BALANCE THAT MAY NOT GO BELOW ZERO — AND THE ROW THAT MAY.
 *
 * An account's total is capped: nothing takes more than it has. Written
 * straight into the ledger's table that is the table's own refusal; through
 * a posting it is the ledger's ("out of stock"), told about the row that was
 * saved. An account whose own yes/no says so is let below zero — by a direct
 * row, by a posting, and in the answer of a quote — while the account beside
 * it stays capped.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { EffectiveTable } from '../src/connections/effective-schema.js';
import { balancesOf } from '../src/crud/column-rules.js';
import { LEGS } from './invoicing-install.helpers.js';
import { DESK, ledgerWorld, refusal, type LedgerWorld } from './ledger.helpers.js';

/** `count` writes what it is told, and gives it back when the row is undone. */
const TALLY = {
  id: 'tally',
  into: { addOn: 'ledger-kit', ledger: 'units', action: 'count' },
  map: { account: 'account_id', quantity: 'qty' },
  post: { on: { column: 'status', in: ['counted'] } },
  reverse: { on: { column: 'status', in: ['undone'] } },
};

describe('the switch a balance is lifted by', () => {
  const column = (name: string, rollup?: Record<string, unknown>) => ({ name, logicalType: 'decimal', scale: 2, ...(rollup === undefined ? {} : { rollup }) });
  const table = (columns: unknown[]) => ({ columns }) as unknown as EffectiveTable;
  const paid = { from: 'payments', via: 'invoice_id', sum: 'amount', cap: true, balance: { column: 'due', of: 'total', minus: ['waived'] } };
  const waived = { from: 'waivers', via: 'invoice_id', sum: 'amount', cap: true };

  it('is the one every capped total guarding the balance names', () => {
    const lifted = balancesOf(table([column('paid', { ...paid, capUnless: { column: 'overpay' } }), column('waived', { ...waived, capUnless: { column: 'overpay' } }), column('due')]));
    expect(lifted).toMatchObject([{ column: 'due', cappedBy: ['paid', 'waived'], capUnless: 'overpay' }]);
    // A total that is taken off and not capped has no say.
    expect(balancesOf(table([column('paid', { ...paid, capUnless: { column: 'overpay' } }), column('waived', { ...waived, cap: undefined }), column('due')]))).toMatchObject([{ cappedBy: ['paid'], capUnless: 'overpay' }]);
  });

  it('a capped total that names none, or another, keeps the cap for all of them', () => {
    expect(balancesOf(table([column('paid', { ...paid, capUnless: { column: 'overpay' } }), column('waived', waived), column('due')]))[0]).not.toHaveProperty('capUnless');
    expect(balancesOf(table([column('paid', { ...paid, capUnless: { column: 'overpay' } }), column('waived', { ...waived, capUnless: { column: 'lenient' } }), column('due')]))[0]).not.toHaveProperty('capUnless');
    expect(balancesOf(table([column('paid', paid), column('waived', waived), column('due')]))[0]).not.toHaveProperty('capUnless');
  });
});

describe.each(LEGS)('a capped balance and the row that lifts it — %s', (dialect, available) => {
  let w: LedgerWorld;
  const balance = async (id: number) => Number((await w.h.rows(`SELECT balance FROM ledger_kit_accounts WHERE id = ${String(id)}`))[0]!['balance']);
  const allow = (id: number, on: boolean) => w.h.rows(`UPDATE ledger_kit_accounts SET allow_below = ${w.flag(on)} WHERE id = ${String(id)}`);
  const counted = (account: number, qty: string) => w.create('tallies', { account_id: account, qty, status: 'counted' });
  const quote = (account: number, qty: string) =>
    w.writes.createTree({
      root: { name: 'tallies', target: w.target('tallies'), values: { account_id: account, qty, status: 'counted' }, at: [], children: [] },
      context: DESK,
      mode: 'dry',
      announce: async () => undefined,
      mapError: (error) => {
        throw error;
      },
    });

  beforeAll(async () => {
    if (!available) return;
    w = await ledgerWorld(dialect, { tallies: { columns: 'account_id INT NULL, qty DECIMAL(12,3) NULL, status VARCHAR(20) NULL', postings: [TALLY] } });
    await w.h.rows(
      `INSERT INTO ledger_kit_accounts (id, name, opening, taken, balance, allow_below, reorder_at) VALUES (1, 'Flour', 10, 0, 10, ${w.flag(false)}, 2), (2, 'Sugar', 3, 0, 3, ${w.flag(false)}, 1), (3, 'Salt', 5, 0, 5, ${w.flag(false)}, 1)`,
    );
  }, 180_000);
  afterAll(async () => {
    if (available) await w.close();
  });

  it.skipIf(!available)('a direct entry below zero is refused BALANCE_EXCEEDED', async () => {
    const error = await refusal(w.create('ledger_kit_entries', { account_id: 2, amount: '4', kind: 'use' }));
    expect(error).toMatchObject({ code: 'BALANCE_EXCEEDED', details: { column: 'balance', balance: 3 } });
    expect(await w.count('ledger_kit_entries', 'account_id = 2')).toBe(0);
    expect(await balance(2)).toBe(3);
  });

  it.skipIf(!available)('through a posting it is refused as out of stock', async () => {
    const error = await refusal(counted(2, '4'));
    expect(error).toMatchObject({ code: 'POSTING_REFUSED', details: { reason: 'out-of-stock', posting: 'tally' } });
    expect(error.details).not.toHaveProperty('phase');
    expect(await w.count('tallies', 'account_id = 2')).toBe(0);
    expect(await w.count('ledger_kit_entries', 'account_id = 2')).toBe(0);
    expect(await balance(2)).toBe(3);
  });

  it.skipIf(!available)('an account that allows it goes below zero — by a row, by a posting, and in a quote; the account beside it does not', async () => {
    await allow(2, true);
    try {
      expect((await quote(2, '4')).postings).toMatchObject([{ posting: 'tally', quote: { state: 'ok' } }]);
      await counted(2, '4');
      expect(w.posted()).toMatchObject([{ posting: 'tally', phase: 'post', rows: 1, state: 'planned' }]);
      expect(await balance(2)).toBe(-1);
      // Lower still, straight into the table.
      await w.create('ledger_kit_entries', { account_id: 2, amount: '2', kind: 'use' });
      expect(await balance(2)).toBe(-3);
      // Flour says nothing of the kind: capped as ever, in the quote and in the save.
      expect((await quote(1, '11')).postings).toMatchObject([{ posting: 'tally', quote: { state: 'refused', reason: 'out-of-stock' } }]);
      expect(await refusal(counted(1, '11'))).toMatchObject({ code: 'POSTING_REFUSED', details: { reason: 'out-of-stock' } });
      expect(await refusal(w.create('ledger_kit_entries', { account_id: 1, amount: '11', kind: 'use' }))).toMatchObject({ code: 'BALANCE_EXCEEDED' });
    } finally {
      await allow(2, false);
    }
    // The switch off again: what is below zero may come up, and may not go lower.
    await w.create('ledger_kit_entries', { account_id: 2, amount: '-1', kind: 'use' });
    expect(await balance(2)).toBe(-2);
    expect(await refusal(counted(2, '1'))).toMatchObject({ code: 'POSTING_REFUSED', details: { reason: 'out-of-stock' } });
    expect((await quote(2, '1')).postings).toMatchObject([{ posting: 'tally', quote: { state: 'refused', reason: 'out-of-stock' } }]);
  });

  it.skipIf(!available)('a reverse that would take an account below zero is refused as out of stock, phase reverse', async () => {
    // Five came in and were counted; four of the ten then on the books were used.
    const came = Number((await counted(3, '-5'))['id']);
    expect(await balance(3)).toBe(10);
    await counted(3, '8');
    expect(await balance(3)).toBe(2);
    // Undoing the five would leave minus three.
    const error = await refusal(w.update('tallies', came, { status: 'undone' }));
    expect(error).toMatchObject({ code: 'POSTING_REFUSED', details: { reason: 'out-of-stock', posting: 'tally', phase: 'reverse' } });
    expect((await w.h.rows(`SELECT status FROM tallies WHERE id = ${String(came)}`))[0]).toMatchObject({ status: 'counted' });
    expect(await w.receiptsOf('tally', came)).toEqual(['post:1:planned:1']);
    expect(await balance(3)).toBe(2);
    // With the account's leave it is undone, and the books say so.
    await allow(3, true);
    await w.update('tallies', came, { status: 'undone' });
    expect(w.posted()).toMatchObject([{ posting: 'tally', phase: 'reverse', rows: 1 }]);
    expect(await balance(3)).toBe(-3);
  });
});
