// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Would a plan fit — the sum a save's cap works out after its rows are in,
 * worked out here from what was read, for a quote that writes nothing.
 */
import { describe, expect, it } from 'vitest';

import type { RollupInto } from '../src/crud/column-rules.js';
import { judgePlanned, type JudgeModel } from '../src/crud/ledger-judge.js';

const TAKEN = {
  parent: 'accounts',
  parentKey: 'id',
  column: 'taken',
  child: 'entries',
  via: 'account_id',
  sum: 'amount',
  scale: 3,
  balances: [{ column: 'balance', of: 'opening', minus: [], total: 'taken', scale: 3, cappedBy: ['taken'] }],
  formulas: [],
  derived: [],
} as unknown as RollupInto;
const HELD = { ...TAKEN, column: 'held', child: 'holds', where: { column: 'state', eq: 'held' }, balances: [] } as unknown as RollupInto;

const model = (accounts: Record<string, unknown>[], over: Partial<JudgeModel> = {}): JudgeModel => ({
  rollups: (table) => (table === 'entries' ? [TAKEN] : table === 'holds' ? [HELD] : []),
  rows: (tableId) => (tableId === 'accounts' ? (accounts as never) : []),
  ...over,
});
const entry = (account: unknown, amount: string, line = '', more: Record<string, unknown> = {}) => ({ table: 'entries', line, values: { account_id: account, amount, ...more } });

describe('would a plan fit', () => {
  it('fits while the balance stays at zero or above; the first row over names its line and what is left', () => {
    const accounts = [{ id: 1, balance: '4.500' }, { id: 2, balance: '1.000' }];
    expect(judgePlanned([entry(1, '4.5'), entry(2, '1')], model(accounts))).toEqual({ ok: true });
    expect(judgePlanned([entry(1, '2', 'a'), entry(2, '1.001', 'b')], model(accounts))).toEqual({ ok: false, line: 'b', left: '1', table: 'accounts' });
    // Several rows for one account add up; the line named is the first that took from it.
    expect(judgePlanned([entry(1, '3', 'a'), entry(1, '2', 'c')], model(accounts))).toEqual({ ok: false, line: 'a', left: '4.5', table: 'accounts' });
  });

  it('a row that gives back, or leaves a balance no lower than it stands, is never refused', () => {
    expect(judgePlanned([entry(1, '-2')], model([{ id: 1, balance: '-5.000' }]))).toEqual({ ok: true });
    // Already below zero and taken lower: refused, with nothing left to tell.
    expect(judgePlanned([entry(1, '1')], model([{ id: 1, balance: '-5.000' }]))).toEqual({ ok: false, line: '', left: '0', table: 'accounts' });
  });

  it('an account that allows it goes below zero; a total with no capped balance is not judged; a parent nobody read is not either', () => {
    const allowed = model([{ id: 1, balance: '1.000', allow_below: true }], { capUnless: () => 'allow_below' });
    expect(judgePlanned([entry(1, '9')], allowed)).toEqual({ ok: true });
    expect(judgePlanned([entry(1, '9')], model([{ id: 1, balance: '1.000', allow_below: false }], { capUnless: () => 'allow_below' }))).toMatchObject({ ok: false });
    expect(judgePlanned([{ table: 'holds', line: '', values: { account_id: 1, amount: '9', state: 'held' } }], model([{ id: 1, balance: '1.000' }]))).toEqual({ ok: true });
    expect(judgePlanned([entry(7, '9')], model([{ id: 1, balance: '1.000' }]))).toEqual({ ok: true });
  });

  it('reads a total as its rule does: a row its condition leaves out, a row left out when set, an amount by its multiplier, a count', () => {
    const accounts = [{ id: 1, balance: '2.000' }];
    const where = { ...TAKEN, where: { column: 'kind', eq: 'use' } } as unknown as RollupInto;
    expect(judgePlanned([entry(1, '9', '', { kind: 'note' })], model(accounts, { rollups: () => [where] }))).toEqual({ ok: true });
    expect(judgePlanned([entry(1, '9', '', { kind: 'use' })], model(accounts, { rollups: () => [where] }))).toMatchObject({ ok: false });
    const unless = { ...TAKEN, unlessSet: 'voided_at' } as unknown as RollupInto;
    expect(judgePlanned([entry(1, '9', '', { voided_at: 'now' })], model(accounts, { rollups: () => [unless] }))).toEqual({ ok: true });
    const times = { ...TAKEN, times: 'pack' } as unknown as RollupInto;
    expect(judgePlanned([entry(1, '1', '', { pack: 2 })], model(accounts, { rollups: () => [times] }))).toEqual({ ok: true });
    expect(judgePlanned([entry(1, '1', '', { pack: 3 })], model(accounts, { rollups: () => [times] }))).toMatchObject({ ok: false });
    const count = { ...TAKEN, sum: '', count: true } as unknown as RollupInto;
    expect(judgePlanned([entry(1, 'x'), entry(1, 'y')], model(accounts, { rollups: () => [count] }))).toEqual({ ok: true });
    expect(judgePlanned([entry(1, 'x'), entry(1, 'y'), entry(1, 'z')], model(accounts, { rollups: () => [count] }))).toMatchObject({ ok: false });
  });
});
