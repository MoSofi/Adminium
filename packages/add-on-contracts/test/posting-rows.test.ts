// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `posting-rows@1`: the shape of an answer, the check that it stays inside a
 * ledger's declared writes, and the conformance suite run against a provider
 * small enough to read.
 */
import { describe, expect, it } from 'vitest';

import { POSTING_ROWS_MAX, postingOutputSchema, rowsOutsideWrites, type PostingInput, type PostingOutput, type PostingRowsProvider } from '../src/index.js';
import { postingRowsConformance } from '../src/testing/index.js';

const WRITES = {
  entries: { insert: ['account_id', 'amount', 'kind'] },
  holds: { insert: ['account_id', 'amount', 'state'], update: { by: ['id'], set: ['state'] } },
};

const input = (over: Partial<PostingInput> = {}): PostingInput => ({
  contract: 'posting-rows@1',
  ledger: 'units',
  action: 'use',
  posting: 'take',
  phase: 'post',
  mode: 'save',
  origin: 'staff',
  now: '2026-09-27T10:00:00.000Z',
  today: '2026-09-27',
  zone: 'UTC',
  currency: 'USD',
  source: { table: 'shop:orders', row: '7' },
  lines: [{ line: '41', lineTable: 'shop:order_lines', inputs: { account: 3, quantity: '2.000' }, multipliers: {}, round: 1 }],
  reads: { accounts: [{ id: 3, balance: '5.000', allow_below: false }] },
  settings: {},
  written: {},
  version: '1.0.0',
  ...over,
});

/** Takes what each line asks for; refuses a line that asks for more than its account holds; gives back what a round wrote. */
const provider: PostingRowsProvider = {
  rows(call) {
    if (call.phase === 'reverse') {
      return { rows: (call.written['entries'] ?? []).map((row) => ({ op: 'insert' as const, table: 'entries', line: '', values: { account_id: row['account_id'] ?? null, amount: `-${String(row['amount'])}`, kind: 'back' } })) };
    }
    const out: PostingOutput = { rows: [], refusals: [] };
    for (const line of call.lines) {
      const account = (call.reads['accounts'] ?? []).find((row) => row['id'] === line.inputs['account']);
      const quantity = Number(line.inputs['quantity']);
      if (account === undefined || Number(account['balance']) < quantity) {
        out.refusals!.push({ line: line.line, reason: 'out-of-stock', left: String(account?.['balance'] ?? '0') });
        continue;
      }
      out.rows.push({ op: 'insert', table: 'entries', line: line.line, values: { account_id: Number(account['id']), amount: String(line.inputs['quantity']), kind: 'use' } });
    }
    return out;
  },
};

describe('the shape of an answer', () => {
  it('takes inserts with labels and links to earlier rows, and updates by key', () => {
    const output: PostingOutput = {
      rows: [
        { op: 'insert', table: 'holds', label: 'h1', line: '41', values: { account_id: 3, amount: '2.000', state: 'held' } },
        { op: 'insert', table: 'entries', line: '41', values: { account_id: { '@row': 'h1' }, amount: '2.000', kind: null } },
        { op: 'update', table: 'holds', line: '41', key: { id: 9 }, set: { state: 'taken' } },
      ],
      decides: [{ line: '41', input: 'amount', value: '12.50' }],
      notes: [{ line: '41', note: 'short', item: 'Flour' }],
    };
    expect(postingOutputSchema.safeParse(output).success).toBe(true);
  });

  it('refuses a delete, an unknown reason, a number where a decimal is text, and more rows than the limit', () => {
    expect(postingOutputSchema.safeParse({ rows: [{ op: 'delete', table: 'holds', line: '', key: { id: 1 } }] }).success).toBe(false);
    expect(postingOutputSchema.safeParse({ rows: [], refusals: [{ line: '', reason: 'sold' }] }).success).toBe(false);
    expect(postingOutputSchema.safeParse({ rows: [], decides: [{ line: '', input: 'amount', value: 12.5 }] }).success).toBe(false);
    const many = Array.from({ length: POSTING_ROWS_MAX + 1 }, () => ({ op: 'insert', table: 'entries', line: '', values: { amount: '1' } }));
    expect(postingOutputSchema.safeParse({ rows: many }).success).toBe(false);
    expect(postingOutputSchema.safeParse({ rows: many.slice(1) }).success).toBe(true);
  });

  it('an update names its row and sets something', () => {
    expect(postingOutputSchema.safeParse({ rows: [{ op: 'update', table: 'holds', line: '', key: {}, set: { state: 'taken' } }] }).success).toBe(false);
    expect(postingOutputSchema.safeParse({ rows: [{ op: 'update', table: 'holds', line: '', key: { id: 1 }, set: {} }] }).success).toBe(false);
  });
});

describe('what a ledger declares it writes', () => {
  it('lets through rows inside it', () => {
    expect(rowsOutsideWrites(provider.rows(input()), WRITES)).toEqual([]);
    expect(rowsOutsideWrites({ rows: [{ op: 'update', table: 'holds', line: '', key: { id: 9 }, set: { state: 'taken' } }] }, WRITES)).toEqual([]);
  });

  it('names a table, a column, an operation and a key outside it', () => {
    const outside = rowsOutsideWrites(
      {
        rows: [
          { op: 'insert', table: 'accounts', line: '', values: { name: 'x' } },
          { op: 'insert', table: 'entries', line: '', values: { account_id: 3, receipt_id: 1 } },
          { op: 'update', table: 'entries', line: '', key: { id: 1 }, set: { amount: '0' } },
          { op: 'update', table: 'holds', line: '', key: { account_id: 3 }, set: { state: 'taken' } },
          { op: 'update', table: 'holds', line: '', key: { id: 1 }, set: { amount: '0' } },
        ],
      },
      WRITES,
    );
    expect(outside).toEqual([
      'rows.0: "accounts" is not a table the ledger writes',
      'rows.1: "entries.receipt_id" is not a column an insert may give',
      'rows.2: "entries" takes no update',
      'rows.3: a row of "holds" is named by id',
      'rows.4: "holds.amount" is not a column an update may set',
    ]);
  });
});

postingRowsConformance(provider, {
  ledgers: { units: { writes: WRITES } },
  cases: [
    { name: 'a line within the balance is taken', input: input(), expect: { rows: [{ op: 'insert', table: 'entries', values: { amount: '2.000', kind: 'use' } }], refusals: [] } },
    { name: 'a line over the balance is refused with what is left', input: input({ lines: [{ line: '41', lineTable: 'shop:order_lines', inputs: { account: 3, quantity: '9.000' }, multipliers: {}, round: 1 }] }), expect: { rows: [], refusals: [{ line: '41', reason: 'out-of-stock', left: '5.000' }] } },
    { name: 'a reverse gives back what the round wrote', input: input({ phase: 'reverse', written: { entries: [{ account_id: 3, amount: '2.000', kind: 'use' }] } }), expect: { rows: [{ values: { amount: '-2.000', kind: 'back' } }] } },
  ],
});
