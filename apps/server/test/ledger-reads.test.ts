// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT A POSTING READS, AND ITS RECEIPTS — against the test ledger installed
 * by the real installer, on every engine this run can reach: the lines under
 * a source row, the inputs a rule maps for one, the add-on's settings row,
 * the action's reads in order, the names a save locks, and the receipts that
 * say which round a line is in.
 */
import type { Ledger } from '@adminium/manifest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadAddOnInstalls } from '../src/apps/table-ref.js';
import type { DeclaredPosting } from '../src/crud/ledger-points.js';
import { LedgerTooLarge, ledgerSettings, linesOf, lockNames, mapInputs, runReads, scalarOf } from '../src/crud/ledger-reads.js';
import { openRounds, phaseDue, receiptsOfLine, receiptsOfSource, roundOf, roundRows } from '../src/crud/ledger-receipts.js';
import { createLedgerRuntime, type ResolvedLedger } from '../src/ledgers/registry.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { ledgerKitFiles, ledgerKitManifest } from './fixtures/ledger-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';

const RULE: DeclaredPosting = { id: 'by-hand', into: { addOn: 'ledger-kit', ledger: 'units', action: 'use' }, map: { account: 'account_id', quantity: 'amount', note: 'note' }, post: { on: { create: true } } };

describe.each(LEGS)('what a posting reads — %s', (dialect, available) => {
  let h: Harness;
  let ledger: ResolvedLedger;
  let action: Ledger['actions'][string];
  let db: Parameters<typeof linesOf>[0];
  const t = (on: boolean) => (dialect === 'postgres' ? String(on) : on ? '1' : '0');

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageAddOn(ledgerKitManifest(), { files: ledgerKitFiles() });
    const added = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'ledger-kit', version: '1.0.0', attachTo: [] } });
    expect(added.statusCode, added.body).toBe(200);
    await h.introspect();
    const view = (await createPublicViews(h.meta).viewFor(h.connectionId))!;
    const installs = await loadAddOnInstalls(h.meta, async () => view.model);
    const runtime = createLedgerRuntime({ installs: () => installs, decider: () => ({ key: 'ledger-kit', version: '1.0.0', kinds: ['rows'] }) as never, versionNow: async () => null });
    // An owner's own rule on a table of the add-on's: nothing to be connected to.
    const state = runtime.resolve(view, view.table(installs.tableOf(h.connectionId, 'ledger-kit', 'entries')!), RULE);
    if (state.state !== 'live' || !('ledger' in state)) throw new Error(JSON.stringify(state));
    ledger = state.ledger;
    action = state.action;
    db = (await h.manager.data(h.connectionId)).db as never;
    await h.rows(`INSERT INTO ledger_kit_accounts (id, name, opening, taken, balance, allow_below, reorder_at) VALUES (1, 'Flour', 10, 0, 10, ${t(false)}, 2), (2, 'Sugar', 4.5, 0, 4.5, ${t(true)}, 1), (3, 'Salt', 1, 0, 1, ${t(false)}, 0)`);
    await h.rows(`UPDATE ledger_kit_settings SET note = '{"b": 1,  "a": [true, null]}', show_left_below = 5`);
    // Receipts: a hold for source 7's whole row (round 1), then given back, then held again (round 2); a posting for line 31 of source 8.
    const receipt = (id: number, row: string, line: string, lineTable: string, phase: string, round: number) =>
      `(${String(id)}, 'shop:orders', '${row}', '${line}', '${lineTable}', 'units', 'use', 'by-hand', '${phase}', ${String(round)}, 'planned', 1, '1.0.0', 'staff', 'usr_1', '2026-10-06 10:00:00')`;
    await h.rows(
      `INSERT INTO ledger_kit_postings (id, source_table, source_row, source_line, line_table, ledger, action, posting, phase, round, state, ${dialect === 'mysql' ? '`rows`' : '"rows"'}, add_on_version, origin, ${dialect === 'mysql' ? '`by`' : '"by"'}, ${dialect === 'mysql' ? '`at`' : '"at"'}) VALUES ` +
        [receipt(1, '7', '', '', 'reserve', 1), receipt(2, '7', '', '', 'reverse', 1), receipt(3, '7', '', '', 'reserve', 2), receipt(4, '8', '31', 'shop:order_lines', 'post', 1)].join(', '),
    );
    await h.rows(`INSERT INTO ledger_kit_holds (id, account_id, amount, state, receipt_id) VALUES (1, 1, 2, 'released', 1), (2, 1, 3, 'held', 3), (3, 2, 1, 'held', 3)`);
    await h.rows(`INSERT INTO ledger_kit_entries (id, account_id, amount, kind, note, receipt_id) VALUES (1, 2, 1.25, 'use', 'a', 4), (2, 2, 0.5, 'use', NULL, NULL), (3, 1, 2, 'use', 'c', NULL)`);
  }, 180_000);
  afterAll(async () => {
    if (available) await h.close();
  });

  it.skipIf(!available)('the lines under a row: the child\'s rows its link names, by key; never another row\'s', async () => {
    const entries = ledger.table('entries')!;
    expect((await linesOf(db, entries, 'account_id', 2)).map((row) => Number(row['id']))).toEqual([1, 2]);
    expect((await linesOf(db, entries, 'account_id', 1)).map((row) => Number(row['id']))).toEqual([3]);
    expect(await linesOf(db, entries, 'account_id', 99)).toEqual([]);
  });

  it.skipIf(!available)('a value is handed the same on every engine: a decimal and json as text, a yes/no as a boolean', async () => {
    const settings = await ledgerSettings(ledger, db);
    // The parsed value printed again: whitespace and the driver's own shape are gone.
    expect(settings['note']).toBe('{"a":[true,null],"b":1}');
    expect(settings['show_left_below']).toBe(5);
    expect(await ledgerSettings({ settings: null }, db)).toEqual({});
    const reads = await runReads(db, { ledger, action, lines: [{ line: '', inputs: { account: 2 } }], source: { table: 'shop:orders', row: '7' }, settings });
    const sugar = reads['accounts']![0]!;
    expect(sugar['allow_below']).toBe(true);
    expect(typeof sugar['opening']).toBe('string');
    expect(Number(sugar['opening'])).toBe(4.5);
    expect(scalarOf({ logicalType: 'decimal' }, 12.5)).toBe('12.5');
    expect(scalarOf({ logicalType: 'date' }, new Date('2026-10-06T10:00:00Z'))).toBe('2026-10-06');
    expect(scalarOf({ logicalType: 'json' }, { a: 1 })).toBe('{"a":1}');
    expect(scalarOf(undefined, null)).toBeNull();
  });

  it.skipIf(!available)('the inputs a rule maps for a line: a column, the row itself, the parent, a setting, a fixed value', async () => {
    const entries = ledger.table('entries')!;
    const accounts = ledger.table('accounts')!;
    const line = (await linesOf(db, entries, 'account_id', 2))[0]!;
    const parent = { table: accounts, row: (await h.rows('SELECT * FROM ledger_kit_accounts WHERE id = 2'))[0]! };
    const settings = await ledgerSettings(ledger, db);
    const mapped = mapInputs({
      posting: { map: { account: 'account_id', quantity: 'amount', note: 'note', what: { row: true }, key: { row: true }, limit: { parent: 'reorder_at' }, below: { setting: 'show_left_below' }, fixed: { value: 'x' }, count: 'account_id' }, multipliers: { quantity: 'id', other: { value: 6 }, none: 'note' } },
      action: { inputs: { account: 'link', quantity: 'decimal', note: 'text?', what: 'rowRef', key: 'text', limit: 'decimal', below: 'number', fixed: 'text', count: 'text' } },
      table: entries,
      tableRef: 'ledger-kit:entries',
      row: line,
      parent,
      settings,
    });
    expect(mapped.missing).toEqual([]);
    expect(mapped.inputs).toMatchObject({ account: 2, note: 'a', what: { table: 'ledger-kit:entries', row: '1' }, key: '1', below: 5, fixed: 'x', count: '2' });
    // A decimal is text; a number mapped to a text input is its text.
    expect(typeof mapped.inputs['quantity']).toBe('string');
    expect(Number(mapped.inputs['quantity'])).toBe(1.25);
    expect(Number(mapped.inputs['limit'])).toBe(1);
    // A multiplier that is not a number is one.
    expect(mapped.multipliers).toEqual({ quantity: 1, other: 6, none: 1 });

    // A row of another table, through a link: the link's table by its stored name and the key the column holds.
    const linkRef = (_table: unknown, column: string) => (column === 'account_id' ? 'ledger-kit:accounts' : null);
    const through = mapInputs({ posting: { map: { what: 'account_id', plain: 'note' } }, action: { inputs: { what: 'rowRef', plain: 'rowRef' } }, table: entries, tableRef: 'ledger-kit:entries', row: line, parent, settings, linkRef });
    expect(through.inputs['what']).toEqual({ table: 'ledger-kit:accounts', row: '2' });
    // A column that is no link is no row, and neither is a link nobody resolves.
    expect(through.inputs['plain']).toBeNull();
    expect(through.missing).toEqual([{ input: 'plain', column: 'note' }]);
    expect(mapInputs({ posting: { map: { what: 'account_id' } }, action: { inputs: { what: 'rowRef' } }, table: entries, tableRef: 'e', row: line, settings }).missing).toEqual([{ input: 'what', column: 'account_id' }]);
    // An empty link is an empty row: named as missing on its column.
    expect(mapInputs({ posting: { map: { what: 'account_id' } }, action: { inputs: { what: 'rowRef' } }, table: entries, tableRef: 'e', row: { ...line, account_id: null }, settings, linkRef }).missing).toEqual([{ input: 'what', column: 'account_id' }]);

    // A needed input left empty is named with its column; an optional one is handed empty.
    const bare = (await linesOf(db, entries, 'account_id', 2))[1]!;
    const short = mapInputs({ posting: { map: { account: 'account_id', quantity: 'kind', note: 'note', gone: { parent: 'x' } } }, action: { inputs: { account: 'link', quantity: 'decimal', note: 'text?', gone: 'link', unmapped: 'link?' } }, table: entries, tableRef: 'e', row: { ...bare, kind: null }, settings });
    expect(short.inputs).toMatchObject({ note: null, quantity: null, gone: null, unmapped: null });
    expect(short.missing).toEqual([{ input: 'quantity', column: 'kind' }, { input: 'gone', column: null }]);
  });

  it.skipIf(!available)('the action\'s reads, in order: by the inputs of every line together, by a receipt, and nothing asked for a key with no value', async () => {
    const settings = await ledgerSettings(ledger, db);
    const context = { ledger, action, source: { table: 'shop:orders', row: '7' }, settings };
    const both = await runReads(db, { ...context, lines: [{ line: '', inputs: { account: 1 } }, { line: '', inputs: { account: 2 } }, { line: '', inputs: { account: 2 } }], receiptIds: [3] });
    expect(both['accounts']!.map((row) => row['name'])).toEqual(['Flour', 'Sugar']);
    expect(both['mine']!.map((row) => Number(row['id']))).toEqual([2, 3]);
    // No receipt yet: the read keyed by one answers no row.
    const first = await runReads(db, { ...context, lines: [{ line: '', inputs: { account: 3 } }] });
    expect(first['accounts']!.map((row) => row['name'])).toEqual(['Salt']);
    expect(first['mine']).toEqual([]);
    // An input left empty names no row.
    expect((await runReads(db, { ...context, lines: [{ line: '', inputs: { account: null } }] }))['accounts']).toEqual([]);

    // A read of its own shape: two keys, a union of sources, a condition, an earlier read's column.
    const shaped = await runReads(db, {
      ...context,
      action: {
        reads: [
          { as: 'held', table: 'holds', by: [{ column: 'receipt_id', from: ['input.other', 'receipt.id'] }], where: [{ column: 'state', eq: 'held' }] },
          { as: 'theirs', table: 'accounts', by: [{ column: 'id', from: 'held.account_id' }], where: [{ column: 'name', in: ['Sugar', 'Salt'] }] },
          { as: 'byRow', table: 'entries', by: [{ column: 'note', from: 'input.what.row' }, { column: 'kind', from: 'setting.kind' }] },
        ],
      },
      settings: { ...settings, kind: 'use' },
      lines: [{ line: '', inputs: { other: 1, what: { table: 't', row: 'a' } } }],
      receiptIds: [3],
    });
    // Receipt 1's hold is `released`: the condition leaves it out.
    expect(shaped['held']!.map((row) => Number(row['id']))).toEqual([2, 3]);
    expect(shaped['theirs']!.map((row) => row['name'])).toEqual(['Sugar']);
    expect(shaped['byRow']!.map((row) => Number(row['id']))).toEqual([1]);

    // A condition on a yes/no reads the same on every engine: which of the two accounts with a hold may go below.
    const flagged = (where: { column: string; eq?: boolean; in?: boolean[] }) =>
      runReads(db, {
        ...context,
        action: {
          reads: [
            { as: 'held', table: 'holds', by: [{ column: 'receipt_id', from: 'receipt.id' }] },
            { as: 'theirs', table: 'accounts', by: [{ column: 'id', from: 'held.account_id' }], where: [where] },
          ],
        },
        lines: [{ line: '', inputs: {} }],
        receiptIds: [3],
      }).then((read) => read['theirs']!.map((row) => row['name']));
    expect(await flagged({ column: 'allow_below', eq: true })).toEqual(['Sugar']);
    expect(await flagged({ column: 'allow_below', eq: false })).toEqual(['Flour']);
    expect(await flagged({ column: 'allow_below', in: [true, false] })).toEqual(['Flour', 'Sugar']);
  });

  it.skipIf(!available)('a read over its limit is too large, not cut short', async () => {
    const settings = await ledgerSettings(ledger, db);
    const context = { ledger, source: { table: 's', row: '1' }, settings, lines: [{ line: '', inputs: {} }] };
    const all = { reads: [{ as: 'every', table: 'accounts', by: [], limit: 3 }] };
    expect((await runReads(db, { ...context, action: all }))['every']).toHaveLength(3);
    await expect(runReads(db, { ...context, action: { reads: [{ as: 'every', table: 'accounts', by: [], limit: 2 }] } })).rejects.toBeInstanceOf(LedgerTooLarge);
    await expect(runReads(db, { ...context, action: { reads: [{ as: 'x', table: 'ghosts', by: [] }] } })).rejects.toThrow(/not one of its tables/);
  });

  it.skipIf(!available)('the names a save locks: one for each row a lock stands for, sorted, each once', async () => {
    const settings = await ledgerSettings(ledger, db);
    const reads = await runReads(db, { ledger, action, lines: [{ line: '', inputs: { account: 2 } }, { line: '', inputs: { account: 1 } }], source: { table: 's', row: '1' }, settings });
    expect(lockNames('cnx_1', ledger, action, reads)).toEqual(['cnx_1|led|ledger-kit|accounts|1', 'cnx_1|led|ledger-kit|accounts|2']);
    expect(lockNames('cnx_1', ledger, action, {})).toEqual([]);
  });

  it.skipIf(!available)('receipts: which round a line is in, what is due, what is open, and what a round wrote', async () => {
    const seven = await receiptsOfSource(db, ledger, { table: 'shop:orders', row: '7' });
    expect(seven.map((receipt) => `${receipt.phase}:${String(receipt.round)}`)).toEqual(['reserve:1', 'reverse:1', 'reserve:2']);
    // Given back once: round two, holding again.
    const state = roundOf(seven, 'by-hand', '');
    expect(state).toMatchObject({ round: 2, posted: null });
    expect(Number(state.reserved!.id)).toBe(3);
    expect([phaseDue(state, 'reserve'), phaseDue(state, 'post'), phaseDue(state, 'reverse')]).toEqual([false, true, true]);
    expect(openRounds(seven)).toEqual([{ posting: 'by-hand', line: '', round: 2 }]);
    // Another rule of the same row has nothing yet: round one, everything to do but a giving back.
    const other = roundOf(seven, 'another', '');
    expect(other).toEqual({ round: 1, reserved: null, posted: null });
    expect([phaseDue(other, 'reserve'), phaseDue(other, 'post'), phaseDue(other, 'reverse')]).toEqual([true, true, false]);

    // A line's receipts are found by the line, whichever row it hangs under.
    const line = await receiptsOfLine(db, ledger, { table: 'shop:order_lines', row: '31' });
    expect(line.map((receipt) => Number(receipt.id))).toEqual([4]);
    const posted = roundOf(line, 'by-hand', '31');
    expect([phaseDue(posted, 'reserve'), phaseDue(posted, 'post'), phaseDue(posted, 'reverse')]).toEqual([false, false, true]);
    expect(await receiptsOfSource(db, ledger, { table: 'shop:orders', row: '99' })).toEqual([]);
    expect(openRounds([])).toEqual([]);

    // What round two wrote, by the add-on's own table names; nothing of round one, nothing of rows no receipt wrote.
    const written = await roundRows(db, ledger, [3]);
    expect(Object.keys(written)).toEqual(['holds']);
    expect(written['holds']!.map((row) => Number(row['id']))).toEqual([2, 3]);
    expect((await roundRows(db, ledger, [4]))['entries']!.map((row) => Number(row['id']))).toEqual([1]);
    expect(await roundRows(db, ledger, [])).toEqual({});
  });
});
