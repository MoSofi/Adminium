// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A QUOTE SAYS WHAT A SAVE WOULD BE TOLD — and writes nothing.
 *
 * A dry run of a change, or of a create with its rows, runs everything a
 * save does up to its first write of the add-on's: the reads, the plan, the
 * checks, the cap. A ledger's "no" is an ANSWER here (`state: 'refused'`,
 * with the reason and the line a save would give), never a failure: the
 * page keeps its figures and marks the line. No row of the add-on is
 * inserted, no receipt written, and the row quoted is as it was afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { postingAnswers, type PostedOutcome } from '../src/crud/ledger-write.js';
import type { RecordWriteService } from '../src/crud/write-service.js';
import type { WriteContext } from '../src/crud/write-context.js';
import { ledgerKitDecidesManifest } from './fixtures/ledger-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';
import { DESK, GUEST, ledgerWorld, refusal, type LedgerWorld } from './ledger.helpers.js';

const TALLY = { id: 'tally', into: { addOn: 'ledger-kit', ledger: 'units', action: 'count' }, map: { account: 'account_id', quantity: 'qty' }, post: { on: { create: true } } };
const ASK = { id: 'ask', into: { addOn: 'ledger-kit', ledger: 'units', action: 'use' }, map: { account: 'account_id', quantity: 'qty' }, reserve: { on: { column: 'status', in: ['sent'] } }, post: { on: { column: 'status', in: ['done'] } }, reverse: { on: { column: 'status', in: ['cancelled'] } } };
const PAY = { id: 'pay', into: { addOn: 'ledger-kit', ledger: 'units', action: 'pay' }, map: { account: 'account_id', due: 'due', amount: 'amount' }, post: { on: { create: true } } };
const LINE = { id: 'line', into: { addOn: 'ledger-kit', ledger: 'units', action: 'use' }, via: 'order_id', map: { account: 'account_id', quantity: 'qty' }, reserve: { on: { create: true } } };

describe('what a door answers of the ledgers', () => {
  const call = (over: Partial<PostedOutcome>): PostedOutcome => ({ addOn: 'kit', ledger: 'units', action: 'use', posting: 'p', phase: 'post', round: 1, rows: 1, version: '1.0.0', state: 'planned', source: { table: 't', row: '1' }, lines: ['7', '9'], notes: [], written: [], decided: [], ...over });
  it('a save\'s calls are ok, or unavailable when nobody planned them; a quote\'s are what it was told; and never what is left or of what', () => {
    expect(postingAnswers(undefined)).toBeUndefined();
    expect(postingAnswers([])).toBeUndefined();
    expect(postingAnswers([call({}), call({ state: 'unplanned', ledger: 'cards' })])).toEqual([{ ledger: 'units', state: 'ok' }, { ledger: 'cards', state: 'unavailable' }]);
    // A note is told by its line's place among the lines handed over.
    expect(postingAnswers([call({ notes: [{ line: '9', note: 'not-linked', item: 'Flour' }] })])).toEqual([{ ledger: 'units', state: 'ok', notes: [{ line: 1, note: 'not-linked' }] }]);
    const quoted = postingAnswers([call({ quote: { state: 'refused', reason: 'out-of-stock', line: 2, path: ['lines', 2], left: '3', item: 'Sugar' } })]);
    expect(quoted).toEqual([{ ledger: 'units', state: 'refused', reason: 'out-of-stock', line: 2, path: ['lines', 2] }]);
    expect(JSON.stringify(quoted)).not.toContain('Sugar');
  });
});

describe.each(LEGS)('a quote of a posting — %s', (dialect, available) => {
  let w: LedgerWorld;
  const says = (postings: PostedOutcome[] | undefined) => (postings ?? []).map((call) => ({ posting: call.posting, phase: call.phase, ...call.quote }));
  /** A quote of a new row (with its child rows). */
  const quoteNew = async (table: string, values: Record<string, unknown>, context: WriteContext = DESK, service: RecordWriteService = w.writes, children: { table: string; values: Record<string, unknown> }[] = []) =>
    service.createTree({
      root: { name: table, target: w.target(table), values, at: [], children: children.map((child, index) => ({ name: child.table, target: w.target(child.table), values: child.values, via: { column: 'order_id', parentKey: 'id' }, at: [child.table, index], children: [] })) },
      context,
      mode: 'dry',
      announce: async () => undefined,
      mapError: (error) => {
        throw error;
      },
    });
  /** A quote of a change. */
  const quoteChange = (table: string, id: number, values: Record<string, unknown>, context: WriteContext = DESK, service: RecordWriteService = w.writes) =>
    service.update({ target: w.target(table), pk: { id }, values, context, mode: 'dry', announce: async () => undefined });
  const everything = async () => ({
    tallies: await w.count('tallies'),
    pays: await w.count('pays'),
    orders: await w.count('orders'),
    lines: await w.count('order_lines'),
    receipts: await w.count('ledger_kit_postings'),
    entries: await w.count('ledger_kit_entries'),
    holds: await w.count('ledger_kit_holds'),
    balances: (await w.h.rows('SELECT id, taken, balance, held FROM ledger_kit_accounts ORDER BY id')).map((row) => `${String(row['id'])}:${String(Number(row['taken']))}:${String(Number(row['balance']))}:${String(Number(row['held']))}`),
  });

  beforeAll(async () => {
    if (!available) return;
    const columns = 'account_id INT NULL, qty DECIMAL(12,3) NULL, status VARCHAR(20) NULL';
    w = await ledgerWorld(
      dialect,
      {
        tallies: { columns, postings: [TALLY] },
        asks: { columns, postings: [ASK] },
        pays: { columns: 'account_id INT NULL, due DECIMAL(12,3) NULL, amount DECIMAL(12,3) NULL', postings: [PAY] },
        orders: { columns: 'status VARCHAR(20) NULL', postings: [] },
        order_lines: { columns: 'order_id INT NULL, account_id INT NULL, qty DECIMAL(12,3) NULL, FOREIGN KEY (order_id) REFERENCES orders(id)', postings: [LINE] },
      },
      ledgerKitDecidesManifest(),
    );
    await w.h.rows(`INSERT INTO ledger_kit_accounts (id, name, opening, taken, balance, allow_below, reorder_at) VALUES (1, 'Flour', 10, 0, 10, ${w.flag(false)}, 2), (2, 'Sugar', 3, 0, 3, ${w.flag(false)}, 1)`);
  }, 180_000);
  afterAll(async () => {
    if (available) await w.close();
  });

  it.skipIf(!available)('a quote that would go through says ok, and nothing of it is left: no row, no receipt, no hold, no total moved', async () => {
    const before = await everything();
    expect(says((await quoteNew('tallies', { account_id: 1, qty: '2' })).postings)).toEqual([{ posting: 'tally', phase: 'post', state: 'ok' }]);
    const ask = Number((await w.create('asks', { account_id: 1, qty: '1', status: 'draft' }))['id']);
    const quoted = await quoteChange('asks', ask, { status: 'sent' });
    expect(says(quoted.postings)).toEqual([{ posting: 'ask', phase: 'reserve', state: 'ok' }]);
    expect((await w.h.rows(`SELECT status FROM asks WHERE id = ${String(ask)}`))[0]).toMatchObject({ status: 'draft' });
    expect(await everything()).toEqual(before);
    // A change that crosses nothing says nothing.
    expect((await quoteChange('asks', ask, { qty: '2' })).postings).toBeUndefined();
  });

  it.skipIf(!available)('a quote and a save give the same reason — and the save is the one that fails', async () => {
    const before = await everything();
    const deaf = w.service({ decider: () => null });
    const cases: { name: string; context: WriteContext; service?: RecordWriteService; values: Record<string, unknown>; misbehave?: string; quote: Record<string, unknown>; save: Record<string, unknown> }[] = [
      // The add-on's own no, to a guest: with what is left and of what.
      { name: 'short', context: GUEST, values: { account_id: 2, qty: '50' }, quote: { state: 'refused', reason: 'out-of-stock', left: '3.000', item: 'Sugar' }, save: { reason: 'out-of-stock', left: '3.000', item: 'Sugar' } },
      // Staff may ask for more than there is: the cap on the account says no — worked out in memory for the quote.
      { name: 'capped', context: DESK, values: { account_id: 2, qty: '50' }, quote: { state: 'refused', reason: 'out-of-stock', left: '3' }, save: { reason: 'out-of-stock' } },
      { name: 'unavailable', context: DESK, service: deaf, values: { account_id: 1, qty: '1' }, quote: { state: 'unavailable', reason: 'add-on-unavailable' }, save: { reason: 'add-on-unavailable' } },
      { name: 'planner failure', context: DESK, misbehave: 'throw', values: { account_id: 1, qty: '1' }, quote: { state: 'refused', reason: 'planner-failed' }, save: { reason: 'planner-failed' } },
      { name: 'a plan outside its tables', context: DESK, misbehave: 'outside-table', values: { account_id: 1, qty: '1' }, quote: { state: 'refused', reason: 'planner-failed' }, save: { reason: 'planner-failed' } },
    ];
    for (const entry of cases) {
      await w.misbehave(entry.misbehave ?? null);
      try {
        const quoted = await quoteNew('tallies', entry.values, entry.context, entry.service ?? w.writes);
        expect(says(quoted.postings), entry.name).toMatchObject([{ posting: 'tally', ...entry.quote }]);
        const error = await refusal(w.create('tallies', entry.values, entry.context, entry.service ?? w.writes));
        expect(error, entry.name).toMatchObject({ code: 'POSTING_REFUSED', details: entry.save });
      } finally {
        await w.misbehave(null);
      }
    }
    expect(await everything()).toEqual(before);
    // What is not a ledger's refusal stays an error for a quote too: a needed value left empty.
    expect(await refusal(quoteNew('tallies', { account_id: 1 }))).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it.skipIf(!available)('a rule switched off is said to be off; an add-on that is not there is not mentioned', async () => {
    const at = w.target('tallies');
    const off = { ...at, table: { ...at.table, table: { ...at.table.table!, switchedOff: { postings: ['tally'] } } } };
    const quoted = await w.writes.createTree({ root: { name: 'tallies', target: off as never, values: { account_id: 1, qty: '1' }, at: [], children: [] }, context: DESK, mode: 'dry', announce: async () => undefined, mapError: (error) => { throw error; } });
    expect(says(quoted.postings)).toEqual([{ posting: 'tally', phase: 'post', state: 'ok', reason: 'switched-off' }]);
    // No add-on runtime at all: a quote is answered with nothing to say (the save is what refuses).
    expect((await quoteNew('tallies', { account_id: 1, qty: '1' }, DESK, w.service(null))).postings).toBeUndefined();
  });

  it.skipIf(!available)('an amount Adminium would decide shows in the quote\'s own figures, and is not kept', async () => {
    const before = await everything();
    const quoted = await quoteNew('pays', { account_id: 1, due: '4' });
    expect(Number(quoted.root['amount'])).toBe(4);
    expect(quoted.postings![0]).toMatchObject({ quote: { state: 'ok' }, decided: [{ input: 'amount', column: 'amount', value: '4.000' }] });
    expect(await everything()).toEqual(before);
  });

  it.skipIf(!available)('a quote of an order with its lines names the line that is short, by its place and its path', async () => {
    const before = await everything();
    const quoted = await quoteNew('orders', { status: 'placed' }, GUEST, w.writes, [
      { table: 'order_lines', values: { account_id: 1, qty: '1' } },
      { table: 'order_lines', values: { account_id: 2, qty: '50' } },
    ]);
    expect(says(quoted.postings)).toMatchObject([{ posting: 'line', phase: 'reserve', state: 'refused', reason: 'out-of-stock', line: 1, path: ['order_lines', 1], item: 'Sugar' }]);
    const fine = await quoteNew('orders', { status: 'placed' }, GUEST, w.writes, [{ table: 'order_lines', values: { account_id: 1, qty: '1' } }]);
    expect(says(fine.postings)).toEqual([{ posting: 'line', phase: 'reserve', state: 'ok' }]);
    expect(await everything()).toEqual(before);
  });
});
