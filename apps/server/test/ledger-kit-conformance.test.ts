// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The test ledger's own deciding file, held to what every `posting-rows`
 * provider owes — and asked the way a save asks it: compiled from its bytes
 * and run in the bare context, not imported. So the fixture every later test
 * of the write path stands on is known good, and each way it can be told to
 * misbehave is known to give no answer, or a wrong one, by name.
 */
import { postingOutputSchema, type PostingInput, type PostingOutput, type PostingRowsProvider } from '@adminium/add-on-contracts';
import { postingCaseIssues, postingRowsConformance, postingSourceIssues, type PostingRowsCase } from '@adminium/add-on-contracts/testing';
import { validateManifest } from '@adminium/manifest';
import { describe, expect, it } from 'vitest';

import { DeciderFailed, callDecider, loadDecider } from '../src/add-ons/decide.js';
import { LEDGER_KIT_SERVER, LEDGER_KIT_SUMS, LEDGER_KIT_WRITES, ledgerHostManifest, ledgerKitFiles, ledgerKitManifest } from './fixtures/ledger-kit/index.js';

const decider = loadDecider({ key: 'ledger-kit', version: '1.0.0', path: 'dist/server.js', bytes: LEDGER_KIT_SERVER });
/** The kit, asked as a save asks it. */
const provider: PostingRowsProvider = { rows: (input) => callDecider('rows', decider, input) as PostingOutput };

const ACCOUNTS = [
  { id: 3, name: 'Flour', balance: '5.000', allow_below: false, reorder_at: '2.000' },
  { id: 4, name: 'Sugar', balance: '0.000', allow_below: true, reorder_at: '1.000' },
];
const line = (key: string, account: number, quantity: string, note?: string) => ({ line: key, lineTable: 'main.host_order_lines', inputs: { account, quantity, ...(note === undefined ? {} : { note }) }, multipliers: {}, round: 1 });
const input = (over: Partial<PostingInput> = {}): PostingInput => ({
  contract: 'posting-rows@1',
  ledger: 'units',
  action: 'use',
  posting: 'line',
  phase: 'post',
  mode: 'save',
  origin: 'staff',
  now: '2026-09-27T10:00:00.000Z',
  today: '2026-09-27',
  zone: 'UTC',
  currency: null,
  source: { table: 'main.host_orders', row: '7' },
  lines: [line('41', 3, '2.000')],
  reads: { accounts: ACCOUNTS, mine: [] },
  settings: { misbehave: null, show_left_below: null },
  written: {},
  version: '1.0.0',
  ...over,
});

const CASES: PostingRowsCase[] = [
  { name: 'a post takes what each line asks', input: input({ lines: [line('41', 3, '2.000', 'for the till'), line('42', 4, '1.500')] }), expect: { rows: [{ op: 'insert', table: 'entries', line: '41', values: { account_id: 3, amount: '2.000', kind: 'use', note: 'for the till' } }, { table: 'entries', line: '42', values: { account_id: 4, amount: '1.500', note: null } }], refusals: [] } },
  { name: 'staff may take what is not there: the account\'s own cap decides', input: input({ lines: [line('41', 3, '9.000')] }), expect: { rows: [{ values: { amount: '9.000' } }], refusals: [] } },
  { name: 'a customer is refused what is not there, with what is left and the account\'s name', input: input({ origin: 'public', lines: [line('41', 3, '9.000')] }), expect: { rows: [], refusals: [{ line: '41', reason: 'out-of-stock', left: '5.000', item: 'Flour' }] } },
  { name: 'a customer takes from an account that allows going below', input: input({ origin: 'public', lines: [line('41', 4, '2.000')] }), expect: { rows: [{ values: { account_id: 4, amount: '2.000' } }], refusals: [] } },
  { name: 'a reserve holds, one hold a line', input: input({ phase: 'reserve', lines: [line('41', 3, '2.000'), line('42', 3, '3.000')] }), expect: { rows: [{ op: 'insert', table: 'holds', values: { account_id: 3, amount: '2.000', state: 'held' } }, { table: 'holds', values: { amount: '3.000' } }], refusals: [] } },
  { name: 'a reserve of more than there is, is refused for staff too', input: input({ phase: 'reserve', lines: [line('41', 3, '5.001')] }), expect: { rows: [], refusals: [{ line: '41', reason: 'out-of-stock', left: '5.000' }] } },
  { name: 'a post after a reserve takes the round\'s hold', input: input({ written: { holds: [{ id: 12, account_id: 3, amount: '2.000', state: 'held' }] } }), expect: { rows: [{ op: 'update', table: 'holds', key: { id: 12 }, set: { state: 'taken' } }, { op: 'insert', table: 'entries', values: { amount: '2.000' } }] } },
  { name: 'a reverse gives back every entry and lets go of a hold still held', input: input({ phase: 'reverse', written: { entries: [{ id: 1, account_id: 3, amount: '2.000', kind: 'use' }, { id: 2, account_id: 4, amount: '0.500', kind: 'use' }], holds: [{ id: 12, account_id: 3, amount: '2.000', state: 'held' }, { id: 13, account_id: 3, amount: '1.000', state: 'taken' }] } }), expect: { rows: [{ table: 'entries', values: { account_id: 3, amount: '-2.000', kind: 'back' } }, { table: 'entries', values: { account_id: 4, amount: '-0.500' } }, { op: 'update', table: 'holds', key: { id: 12 }, set: { state: 'released' } }] } },
  { name: 'a count writes one entry of its own kind', input: input({ action: 'count', posting: 'visit', lines: [line('', 3, '1')] }), expect: { rows: [{ table: 'entries', values: { amount: '1.000', kind: 'count' } }], refusals: [] } },
  { name: 'a line whose account was not read is told, never guessed', input: input({ lines: [line('41', 99, '1.000')] }), expect: { rows: [], refusals: [] } },
];

postingRowsConformance(provider, { ledgers: { units: { writes: LEDGER_KIT_WRITES, sums: LEDGER_KIT_SUMS } }, cases: CASES, source: LEDGER_KIT_SERVER.toString('utf8') });

describe('the test ledger, as a package', () => {
  it('is an add-on and an app the validator takes', () => {
    for (const manifest of [ledgerKitManifest(), ledgerHostManifest()]) {
      const result = validateManifest(manifest);
      expect(result.ok ? [] : result.issues).toEqual([]);
    }
    expect(Object.keys(ledgerKitFiles()).sort()).toEqual(['dist/server.js', 'manifest.json']);
    expect(decider.kinds).toEqual(['rows']);
  });

  it('says what is left of each account asked about, in words', () => {
    const answer = provider.rows(input({ mode: 'words', lines: [line('a', 3, '1'), line('b', 4, '1'), line('c', 99, '1')], reads: { accounts: [...ACCOUNTS, { id: 5, name: 'Salt', balance: '1.500', allow_below: false, reorder_at: '2.000' }] } }));
    expect(postingOutputSchema.safeParse(answer).success).toBe(true);
    expect(answer.words).toEqual([{ line: 'a', state: 'in', left: '5.000' }, { line: 'b', state: 'out', left: '0.000' }, { line: 'c', state: 'out', left: '0.000' }]);
    const low = provider.rows(input({ mode: 'words', lines: [line('d', 5, '1')], reads: { accounts: [{ id: 5, name: 'Salt', balance: '1.500', allow_below: false, reorder_at: '2.000' }] } }));
    expect(low.words).toEqual([{ line: 'd', state: 'low', left: '1.500' }]);
    expect(answer.rows).toEqual([]);
  });

  it('tells back what kind of value a json setting arrived as', () => {
    const answer = provider.rows(input({ settings: { misbehave: null, note: '{"a":1}' } }));
    expect(answer.notes).toEqual([{ line: '41', note: 'to-check', item: 'string' }]);
    expect(provider.rows(input()).notes).toEqual([]);
  });
});

describe('the test ledger, told to misbehave', () => {
  const told = (misbehave: string, over: Partial<PostingInput> = {}) => input({ settings: { misbehave }, ...over });
  const cause = (misbehave: string): string => {
    try {
      callDecider('rows', decider, told(misbehave), { shape: postingOutputSchema });
      return 'answered';
    } catch (error) {
      return error instanceof DeciderFailed ? error.cause : 'another error';
    }
  };

  it('gives no answer when it throws, hangs, answers with a promise or reaches for a module', () => {
    expect(cause('throw')).toBe('threw');
    expect(cause('hang')).toBe('timeout');
    expect(cause('promise')).toBe('thenable');
    expect(cause('require')).toBe('threw');
  });

  it.each([
    ['outside-table', /"accounts" is not a table the ledger writes/],
    ['update-total', /"accounts" is not a table the ledger writes/],
    ['negative', /"entries.amount" does not come to zero|row 0 is not what the case expects/],
    ['second-account', /row 0 is not what the case expects/],
  ])('answers wrongly when told "%s", and the suite says so', (misbehave, said) => {
    const one: PostingRowsCase = { name: misbehave, input: told(misbehave), expect: { rows: [{ table: 'entries', values: { account_id: 3, amount: '2.000' } }] } };
    expect(postingCaseIssues(provider, { ledgers: { units: { writes: LEDGER_KIT_WRITES, sums: LEDGER_KIT_SUMS } } }, one).join('\n')).toMatch(said);
  });

  it('answers in the declared shape even when what it says is wrong', () => {
    // These are the engine's own checks to refuse (a row outside the ledger, a second account): the shape alone lets them through.
    for (const misbehave of ['outside-table', 'update-total', 'negative', 'second-account']) expect(cause(misbehave), misbehave).toBe('answered');
  });

  it('ships a file the source check passes, misbehaviour and all', () => {
    expect(postingSourceIssues(LEDGER_KIT_SERVER.toString('utf8'))).toEqual([]);
  });
});
