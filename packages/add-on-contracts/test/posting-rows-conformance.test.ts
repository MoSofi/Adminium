// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The posting conformance suite, tried on a provider that is right and on
 * providers that are each wrong in one way: the suite is only worth running
 * if it says so, in words, for every one of them.
 */
import { describe, expect, it } from 'vitest';

import type { PostingInput, PostingOutput, PostingRowsProvider } from '../src/index.js';
import { postingCaseIssues, postingSourceIssues, type PostingRowsCase } from '../src/testing/index.js';

const WRITES = {
  entries: { insert: ['account_id', 'amount', 'kind'] },
  holds: { insert: ['account_id', 'amount', 'state'], update: { by: ['id'], set: ['state'] } },
};
const OPTIONS = { ledgers: { units: { writes: WRITES, sums: { entries: ['amount'] } } } };

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

/** Takes what each line asks; refuses a line over its account's balance; gives back what a round wrote. */
function good(call: PostingInput): PostingOutput {
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
}

const TAKE: PostingRowsCase = { name: 'a line within the balance is taken', input: input(), expect: { rows: [{ op: 'insert', table: 'entries', values: { amount: '2.000', kind: 'use' } }], refusals: [] } };
const SHORT: PostingRowsCase = {
  name: 'a line over the balance is refused',
  input: input({ lines: [{ line: '41', lineTable: 'shop:order_lines', inputs: { account: 3, quantity: '9.000' }, multipliers: {}, round: 1 }] }),
  expect: { rows: [], refusals: [{ line: '41', reason: 'out-of-stock', left: '5.000' }] },
};
const BACK: PostingRowsCase = { name: 'a reverse gives back what the round wrote', input: input({ phase: 'reverse', written: { entries: [{ id: 1, account_id: 3, amount: '2.000', kind: 'use' }] } }), expect: { rows: [{ values: { amount: '-2.000', kind: 'back' } }] } };

/** Right every time but the second: only asking again shows it. */
function secondCallDiffers(): (call: PostingInput) => unknown {
  let calls = 0;
  return (call) => ({ ...good(call), notes: (calls += 1) === 2 ? [{ line: '41', note: 'short' }] : [] });
}

const issues = (rows: (call: PostingInput) => unknown, one: PostingRowsCase = TAKE): string[] => postingCaseIssues({ rows } as PostingRowsProvider, OPTIONS, one);

describe('the suite on a provider that is right', () => {
  it('finds nothing wrong in any of its cases', () => {
    for (const one of [TAKE, SHORT, BACK]) expect(issues(good, one), one.name).toEqual([]);
  });

  it('leaves the wall clock as it found it', () => {
    const RealDate = Date;
    issues(good);
    expect(Date).toBe(RealDate);
  });
});

describe('the suite on a provider that is wrong in one way', () => {
  const WRONG: readonly [string, (call: PostingInput) => unknown, RegExp, PostingRowsCase?][] = [
    ['it throws', () => { throw new Error('no stock table'); }, /^it threw: no stock table$/],
    ['it answers with a promise', async (call) => good(call), /answered with a promise/],
    ['its answer is not of the declared shape', (call) => ({ ...good(call), total: 1 }), /not of the declared shape/],
    ['it deletes', () => ({ rows: [{ op: 'delete', table: 'entries', line: '', key: { id: 1 } }] }), /not of the declared shape/],
    ['it writes a table its ledger does not', (call) => (call.phase === 'reverse' ? good(call) : { rows: [...good(call).rows, { op: 'insert', table: 'accounts', line: '', values: { name: 'x' } }] }), /^rows\.1: "accounts" is not a table the ledger writes$/m],
    ['it writes a column its ledger does not list', (call) => (call.phase === 'reverse' ? good(call) : { rows: good(call).rows.map((row) => (row.op === 'insert' ? { ...row, values: { ...row.values, receipt_id: 1 } } : row)) }), /^rows\.0: "entries.receipt_id" is not a column an insert may give$/m],
    ['it remembers the call before', secondCallDiffers(), /^the same input gave another answer the second time$/m],
    ['it reads the clock', (call) => ({ rows: good(call).rows.map((row) => (row.op === 'insert' ? { ...row, values: { ...row.values, kind: `use-${String(new Date().getFullYear())}` } } : row)) }), /^the answer changes with the wall clock/m],
    ['it reads the clock another way', (call) => ({ rows: good(call).rows.map((row) => (row.op === 'insert' ? { ...row, values: { ...row.values, kind: `use-${String(Date.now())}` } } : row)) }), /another answer the second time|changes with the wall clock/],
    ['it asks for a random number', (call) => ({ rows: good(call).rows.map((row) => (row.op === 'insert' ? { ...row, values: { ...row.values, kind: `k${String(Math.random())}` } } : row)) }), /another answer the second time/],
    ['its peek answers differently from its save', (call) => (call.mode === 'peek' ? { rows: [] } : good(call)), /a peek answers differently from the save/],
    ['its reverse refuses', (call) => (call.phase === 'reverse' ? { rows: [], refusals: [{ line: '', reason: 'not-allowed' }] } : good(call)), /a reverse refuses/, BACK],
    ['the reverse of what it wrote refuses', (call) => (call.phase === 'reverse' ? { rows: [], refusals: [{ line: '', reason: 'not-allowed' }] } : good(call)), /the reverse of what it wrote refuses/],
    ['its reverse gives back half', (call) => (call.phase === 'reverse' ? { rows: (call.written['entries'] ?? []).map((row) => ({ op: 'insert', table: 'entries', line: '', values: { account_id: row['account_id'] ?? null, amount: '-1.000', kind: 'back' } })) } : good(call)), /"entries.amount" does not come to zero/],
    ['its reverse gives back nothing', (call) => (call.phase === 'reverse' ? { rows: [] } : good(call)), /"entries.amount" does not come to zero/],
    ['its reverse writes outside the ledger', (call) => (call.phase === 'reverse' ? { rows: [...good(call).rows, { op: 'update', table: 'entries', line: '', key: { id: 1 }, set: { amount: '0' } }] } : good(call)), /the reverse: rows\.1: "entries" takes no update/],
    ['a summed column is not a decimal', (call) => (call.phase === 'reverse' ? good(call) : { rows: good(call).rows.map((row) => (row.op === 'insert' ? { ...row, values: { ...row.values, amount: 'two' } } : row)) }), /every row gives it as a decimal/],
    ['it writes another row than the case expects', (call) => ({ rows: good(call).rows.map((row) => (row.op === 'insert' ? { ...row, values: { ...row.values, kind: 'take' } } : row)) }), /row 0 is not what the case expects/],
    ['it writes more rows than the case expects', (call) => ({ rows: [...good(call).rows, ...good(call).rows] }), /the case expects 1 rows; the answer has 2/],
    ['it takes what the case says it refuses', () => ({ rows: [], refusals: [] }), /the case expects 1 refusals; the answer has 0/, SHORT],
    ['it refuses with another reason', () => ({ rows: [], refusals: [{ line: '41', reason: 'expired' }] }), /refusal 0 is not what the case expects/, SHORT],
  ];

  it.each(WRONG.map(([name, rows, said, one]) => [name, rows, said, one] as const))('says so when %s', (_name, rows, said, one) => {
    const found = issues(rows, one ?? TAKE);
    expect(found.join('\n')).toMatch(said);
  });

  it('says so of a provider with no `rows`, and of a case for a ledger it was not told of', () => {
    expect(postingCaseIssues({} as PostingRowsProvider, OPTIONS, TAKE)).toEqual(['the provider has no `rows`']);
    expect(postingCaseIssues({ rows: good }, OPTIONS, { ...TAKE, input: input({ ledger: 'value' }) })).toEqual(['the case names the ledger "value", which the suite was not told of']);
  });

  it('sums decimals exactly, whatever their places', () => {
    const cents = (call: PostingInput): PostingOutput =>
      call.phase === 'reverse'
        ? { rows: [{ op: 'insert', table: 'entries', line: '', values: { account_id: 3, amount: '-0.3', kind: 'back' } }] }
        : { rows: ['0.1', '0.2'].map((amount) => ({ op: 'insert' as const, table: 'entries', line: '41', values: { account_id: 3, amount, kind: 'use' } })) };
    expect(issues(cents, { ...TAKE, expect: {} })).toEqual([]);
  });
});

describe('the built file an add-on ships', () => {
  it('passes when it is one script that assigns module.exports', () => {
    expect(postingSourceIssues('"use strict";\nvar update = function (rows) { return rows; };\nmodule.exports = { rows: function (input) { return { rows: update([]), at: input.now, important: 1, exportable: 2 }; } };')).toEqual([]);
  });

  it.each([
    ['const fs = require("node:fs");', /require\(\)/],
    ['module.exports = { rows: function () { return import("./x.js"); } };', /import\(\)/],
    ['import { z } from "zod";\nmodule.exports = {};', /an import statement/],
    ['export const rows = function () {};', /an export statement/],
    ['module.exports = { rows: function () { return process.env.X; } };', /reads process/],
    ['module.exports = { rows: function () { return new Date(); } };', /reads the clock/],
    ['module.exports = { rows: function () { return Date.now(); } };', /reads the clock/],
    ['module.exports = { rows: function () { return globalThis.Date; } };', /reads the clock/],
    ['module.exports = { rows: function () { return Math.random(); } };', /random number/],
    ['module.exports = { rows: function () { return fetch("https://x"); } };', /fetch\(\)/],
  ])('says so of %s', (source, said) => {
    expect(postingSourceIssues(source).join('\n')).toMatch(said);
  });
});
