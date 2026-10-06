// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT AN ADD-ON'S PLAN MAY WRITE — the four checks, each with a plan that
 * passes and the plans that must not: a table or column outside what the
 * ledger declares; a row the call was never shown; a column Adminium decides
 * or the receipt's own link; an amount outside its bounds.
 */
import { describe, expect, it } from 'vitest';

import { checkOutput, compareDecimalText, type CheckInput, type PlannedOutput, type PlannedRow } from '../src/crud/ledger-write.js';

const input = (over: Partial<CheckInput> = {}): CheckInput => ({
  writes: {
    entries: { insert: ['account_id', 'amount', 'kind', 'note', 'hold_id'] },
    holds: { insert: ['account_id', 'amount', 'state'], update: { by: ['id'], set: ['state'] } },
  },
  action: {
    inputs: { account: 'link', quantity: 'decimal', due: 'decimal', note: 'text?' },
    reads: [
      { as: 'accounts', table: 'accounts', by: [{ column: 'id', from: 'input.account' }] },
      { as: 'mine', table: 'holds', by: [{ column: 'receipt_id', from: 'receipt.id' }] },
    ],
    decides: [
      { input: 'quantity', min: '0', max: { input: 'due' } },
      { input: 'quantity', min: '0', max: { read: 'accounts', column: 'balance' } },
    ],
  },
  tables: {
    accounts: { key: ['id'], links: {}, decided: new Set(['taken', 'balance']) },
    entries: { key: ['id'], links: { account_id: 'accounts', hold_id: 'holds' }, decided: new Set(['total']) },
    holds: { key: ['id'], links: { account_id: 'accounts' }, decided: new Set() },
  },
  reads: { accounts: [{ id: 2, balance: '4.500' }], mine: [{ id: 11, account_id: 3, state: 'held' }] },
  lines: [{ line: '', inputs: { account: 2, quantity: null, due: '3.00', note: null } }],
  written: { holds: [{ id: 12, account_id: 2, state: 'held' }] },
  mapped: new Set(['account', 'quantity', 'due']),
  ...over,
});
const plan = (rows: PlannedRow[], decides?: PlannedOutput['decides']): PlannedOutput => ({ rows, ...(decides === undefined ? {} : { decides }) });
const insert = (table: string, values: Record<string, unknown>, label?: string): PlannedRow => ({ op: 'insert', table, line: '', values: values as never, ...(label === undefined ? {} : { label }) });
const update = (table: string, key: Record<string, unknown>, set: Record<string, unknown>): PlannedRow => ({ op: 'update', table, line: '', key: key as never, set: set as never });
const cause = (result: ReturnType<typeof checkOutput>) => (result.ok ? 'ok' : result.cause);

describe('the plan an add-on answers', () => {
  it('passes: an entry for the account it was shown, a hold it held taken, a row that points at one it inserts', () => {
    expect(
      checkOutput(input(), plan([insert('holds', { account_id: 2, amount: '1', state: 'held' }, 'h'), insert('entries', { account_id: 2, amount: '1', kind: 'use', hold_id: { '@row': 'h' } }), update('holds', { id: 12 }, { state: 'taken' })])),
    ).toEqual({ ok: true });
    expect(checkOutput(input(), plan([]))).toEqual({ ok: true });
  });

  it('1 — a table, an operation or a column the ledger does not list', () => {
    expect(cause(checkOutput(input(), plan([insert('accounts', { name: 'x' })])))).toBe('scope-table');
    expect(cause(checkOutput(input(), plan([insert('entries', { account_id: 2, secret: 1 })])))).toBe('scope-table');
    expect(cause(checkOutput(input(), plan([update('entries', { id: 1 }, { amount: '9' })])))).toBe('scope-table');
    expect(cause(checkOutput(input(), plan([update('holds', { id: 12 }, { amount: '9' })])))).toBe('scope-table');
    // An update named by another column than the declared key.
    expect(cause(checkOutput(input(), plan([update('holds', { account_id: 2 }, { state: 'taken' })])))).toBe('scope-table');
    // An action that narrows the ledger's tables writes only those.
    const narrowed = input();
    expect(cause(checkOutput({ ...narrowed, action: { ...narrowed.action, writes: ['entries'] } }, plan([insert('holds', { account_id: 2, amount: '1' })])))).toBe('scope-table');
    expect(cause(checkOutput({ ...narrowed, action: { ...narrowed.action, writes: ['entries'] } }, plan([insert('entries', { account_id: 2, amount: '1' })])))).toBe('ok');
  });

  it('2 — a row the call was never shown', () => {
    // Another account than the one its read returned or its line handed in.
    expect(cause(checkOutput(input(), plan([insert('entries', { account_id: 99, amount: '1' })])))).toBe('scope-row');
    // Shown by a link of a row it was shown: the hold it read points at account 3.
    expect(cause(checkOutput(input(), plan([insert('entries', { account_id: 3, amount: '1' })])))).toBe('ok');
    // A hold of its own round, and one a read returned, may be changed; any other may not.
    expect(cause(checkOutput(input(), plan([update('holds', { id: 12 }, { state: 'released' })])))).toBe('ok');
    expect(cause(checkOutput(input(), plan([update('holds', { id: 11 }, { state: 'released' })])))).toBe('ok');
    expect(cause(checkOutput(input(), plan([update('holds', { id: 13 }, { state: 'released' })])))).toBe('scope-row');
    // A label that no EARLIER row carries, one for another table, one given twice, and one where no link is.
    expect(cause(checkOutput(input(), plan([insert('entries', { account_id: 2, hold_id: { '@row': 'h' } }), insert('holds', { account_id: 2 }, 'h')])))).toBe('scope-row');
    expect(cause(checkOutput(input(), plan([insert('entries', { account_id: 2 }, 'e'), insert('entries', { account_id: 2, hold_id: { '@row': 'e' } })])))).toBe('scope-row');
    expect(cause(checkOutput(input(), plan([insert('holds', { account_id: 2 }, 'h'), insert('holds', { account_id: 2 }, 'h')])))).toBe('scope-row');
    expect(cause(checkOutput(input(), plan([insert('holds', { account_id: 2 }, 'h'), insert('entries', { account_id: 2, note: { '@row': 'h' } })])))).toBe('scope-row');
    // With nothing shown and nothing handed in, no account can be named.
    expect(cause(checkOutput(input({ reads: {}, written: {}, lines: [{ line: '', inputs: {} }] }), plan([insert('entries', { account_id: 2 })])))).toBe('scope-row');
    // A link the host's row handed in is shown by being handed in, whatever the reads returned.
    expect(cause(checkOutput(input({ reads: {}, written: {}, lines: [{ line: '', inputs: { account: 5 } }] }), plan([insert('entries', { account_id: 5 })])))).toBe('ok');
    // An empty link names nothing, and is nothing to check.
    expect(cause(checkOutput(input(), plan([insert('entries', { account_id: 2, hold_id: null })])))).toBe('ok');
  });

  it('3 — a column Adminium decides, or the receipt\'s own link', () => {
    const wide = input({ writes: { entries: { insert: ['account_id', 'amount', 'total', 'receipt_id'] }, holds: { update: { by: ['id'], set: ['state', 'receipt_id'] } } } });
    expect(cause(checkOutput(wide, plan([insert('entries', { account_id: 2, total: '5' })])))).toBe('scope-op');
    expect(cause(checkOutput(wide, plan([insert('entries', { account_id: 2, receipt_id: 7 })])))).toBe('scope-op');
    expect(cause(checkOutput(wide, plan([update('holds', { id: 12 }, { receipt_id: 7 })])))).toBe('scope-op');
  });

  it('4 — an amount it is asked to decide: for a declared, mapped input, on a line of the call, from zero to every ceiling', () => {
    const decide = (value: string, more: Partial<{ line: string; input: string }> = {}) => plan([], [{ line: '', input: 'quantity', value, ...more }]);
    // Both ceilings hold: the line's `due` (3.00) and the account's balance (4.500).
    expect(cause(checkOutput(input(), decide('3')))).toBe('ok');
    expect(cause(checkOutput(input(), decide('0')))).toBe('ok');
    expect(cause(checkOutput(input(), decide('3.01')))).toBe('scope-decides');
    expect(cause(checkOutput(input(), decide('-0.01')))).toBe('scope-decides');
    // The other ceiling is the lower one here.
    expect(cause(checkOutput(input({ reads: { accounts: [{ id: 2, balance: '2' }], mine: [] } }), decide('2.5')))).toBe('scope-decides');
    expect(cause(checkOutput(input(), decide('1', { input: 'due' })))).toBe('scope-decides');
    expect(cause(checkOutput(input(), decide('1', { line: '9' })))).toBe('scope-decides');
    expect(cause(checkOutput(input({ mapped: new Set(['account', 'due']) }), decide('1')))).toBe('scope-decides');
    // A ceiling that cannot be read is no ceiling to stay under.
    expect(cause(checkOutput(input({ reads: { accounts: [], mine: [] } }), decide('1')))).toBe('scope-decides');
    expect(cause(checkOutput(input({ lines: [{ line: '', inputs: { account: 2, due: null } }] }), decide('1')))).toBe('scope-decides');
  });

  it('decimal text is compared as a number', () => {
    expect(compareDecimalText('3', '3.00')).toBe(0);
    expect(compareDecimalText('3.01', '3')).toBe(1);
    expect(compareDecimalText('10', '9.999')).toBe(1);
    expect(compareDecimalText('-0.01', '0')).toBe(-1);
    expect(compareDecimalText('0.1', '0.09')).toBe(1);
    expect(compareDecimalText('007', '7')).toBe(0);
  });
  it('a key is matched as the database would match it, a handed link reaches only the table it is read by, and an amount is decided once', () => {
    // "0042" and 42 read alike and name two different rows.
    const coded = input({ reads: { accounts: [{ id: '0042', balance: '4.500' }], mine: [] }, lines: [{ line: '', inputs: { account: '0042', quantity: null, due: '3.00', note: null } }] });
    expect(cause(checkOutput(coded, plan([insert('entries', { account_id: '0042', amount: '1' })])))).toBe('ok');
    expect(cause(checkOutput(coded, plan([insert('entries', { account_id: 42, amount: '1' })])))).toBe('scope-row');
    expect(cause(checkOutput(input({ written: { holds: [{ id: '0012', account_id: 2, state: 'held' }] } }), plan([update('holds', { id: 12 }, { state: 'taken' })])))).toBe('scope-row');
    // The account the row handed in is account 2 — not hold 2, which nothing showed.
    expect(cause(checkOutput(input(), plan([insert('entries', { account_id: 2, amount: '1', hold_id: 2 })])))).toBe('scope-row');
    // A handed link whose row no read returned is still that table's to point at.
    expect(cause(checkOutput(input({ reads: { accounts: [], mine: [] } }), plan([insert('entries', { account_id: 2, amount: '1' })])))).toBe('ok');
    expect(cause(checkOutput(input(), plan([], [{ line: '', input: 'quantity', value: '1' }, { line: '', input: 'quantity', value: '2' }])))).toBe('scope-decides');
  });
});
