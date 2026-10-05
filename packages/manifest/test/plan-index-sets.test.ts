// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Indexes over a set of columns, planned for a table that is already there:
 * the sets a table declares and the ones a ledger reads by are added where
 * the table has no index that starts with exactly those columns; the key a
 * receipt table is kept by is added where no unique rule equals it. A table
 * whose indexes are not known is offered none.
 */
import { describe, expect, it } from 'vitest';

import { indexSetName, ledgerIndexes, planInstall, plainIndexName, uniqueSetName, validateManifest, type Manifest, type PlanContext, type SchemaModelView } from '../src/index.js';
import { LEDGER_KIT } from './ledger-kit-fixture.js';

const app = (indexes: string[][], more: { unique?: string[][]; index?: boolean; width?: number } = {}) =>
  ({
    kind: 'app',
    key: 'box',
    version: '0.2.0',
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'events', columns: [{ ref: 'id', type: 'int', role: 'pk' }] },
        {
          ref: 'waitlist',
          columns: [
            { ref: 'id', type: 'int', role: 'pk' },
            { ref: 'event_id', type: 'fk', references: 'events', ...(more.index === true ? { index: true } : {}) },
            { ref: 'email', type: 'text', maxLength: more.width ?? 200, nullable: true },
            { ref: 'day', type: 'date', nullable: true },
          ],
          indexes,
          ...(more.unique === undefined ? {} : { unique: more.unique }),
        },
      ],
    },
  }) as unknown as Manifest;

const records = { events: { table: 'box_events', owned: true, state: 'released' }, waitlist: { table: 'box_waitlist', owned: true, state: 'released' } };
const ctx = (over: Partial<PlanContext> = {}): PlanContext => ({ prefix: 'box_', records, others: [], dialect: 'postgres', ...over });
const col = (ref: string) => ({ ref, nullable: true });
const live = (indexSets?: string[][], more: { indexed?: string[]; columns?: string[]; indexNames?: string[] } = {}): SchemaModelView => ({
  tables: [
    { ref: 'box_events', columns: [{ ref: 'id', isPrimaryKey: true }], uniques: [], indexSets: [] },
    {
      ref: 'box_waitlist',
      columns: [{ ref: 'id', isPrimaryKey: true }, ...(more.columns ?? ['event_id', 'email', 'day']).map(col)],
      uniques: [],
      ...(indexSets === undefined ? {} : { indexSets }),
      ...(more.indexed === undefined ? {} : { indexed: more.indexed }),
      ...(more.indexNames === undefined ? {} : { indexNames: more.indexNames }),
    },
  ],
});
const edits = (manifest: Manifest, model: SchemaModelView, over: Partial<PlanContext> = {}) => planInstall(manifest, model, ctx(over)).tables?.find((t) => t.ref === 'waitlist')?.edits.filter((edit) => edit.kind === 'add-index' || edit.kind === 'add-unique');

describe('an index over a set of columns, on a table that is already there', () => {
  it('is added, by its own name, with the columns before its last in order', () => {
    expect(edits(app([['event_id', 'day']]), live([]))).toEqual([{ kind: 'add-index', column: 'day', with: ['event_id'], name: 'ix_box_waitlist_event_id_day' }]);
    // Over one column it is named as a plain index is, and names no other column.
    expect(edits(app([['email']]), live([]))).toEqual([{ kind: 'add-index', column: 'email', name: plainIndexName('box_waitlist', 'email') }]);
  });

  it('is compared by its whole column list: (a) indexed says nothing about (a, b)', () => {
    expect(edits(app([['event_id', 'day']]), live([['event_id']]))).toHaveLength(1);
    // The other order is another index.
    expect(edits(app([['event_id', 'day']]), live([['day', 'event_id']]))).toHaveLength(1);
  });

  it('is left alone where an index equals it, or goes on after its columns', () => {
    expect(edits(app([['event_id', 'day']]), live([['event_id', 'day']]))).toEqual([]);
    expect(edits(app([['event_id', 'day']]), live([['email'], ['event_id', 'day', 'email']]))).toEqual([]);
  });

  it('is offered for no table whose indexes are not known', () => {
    expect(edits(app([['event_id', 'day']]), live(undefined))).toEqual([]);
  });

  it('waits for nothing: a set over a column the same update adds is planned with it', () => {
    const planned = planInstall(app([['event_id', 'day']]), live([], { columns: ['event_id', 'email'] }), ctx()).tables?.find((t) => t.ref === 'waitlist')?.edits;
    expect(planned).toEqual([{ kind: 'add-column', column: 'day' }, { kind: 'add-index', column: 'day', with: ['event_id'], name: 'ix_box_waitlist_event_id_day' }]);
  });

  it('is not made a second time for a column that is indexed on its own in the same plan', () => {
    const both = edits(app([['event_id'], ['event_id', 'day']], { index: true }), live([], { indexed: [] }));
    expect(both).toEqual([
      { kind: 'add-index', column: 'event_id', name: plainIndexName('box_waitlist', 'event_id') },
      { kind: 'add-index', column: 'day', with: ['event_id'], name: 'ix_box_waitlist_event_id_day' },
    ]);
  });

  it('takes no name the database already has', () => {
    const [edit] = edits(app([['event_id', 'day']]), live([], { indexNames: ['ix_box_waitlist_event_id_day'] }))!;
    expect(edit).toMatchObject({ kind: 'add-index', name: indexSetName('box_waitlist', ['event_id', 'day'], new Set(['ix_box_waitlist_event_id_day'])) });
    expect((edit as { name: string }).name).not.toBe('ix_box_waitlist_event_id_day');
  });

  it('is refused on MySQL when its columns are wider than MySQL can index, on the check', () => {
    const wide = planInstall(app([['email', 'day']], { width: 800 }), live([]), ctx({ dialect: 'mysql' }));
    expect(wide.problems.map((problem) => `${problem.code} ${problem.table}.${problem.column ?? ''}`)).toEqual(['UNIQUE_KEY_TOO_LONG waitlist.day']);
    expect(wide.problems[0]!.message).toContain('is indexed by email, day');
    expect(planInstall(app([['email', 'day']], { width: 800 }), live([]), ctx()).problems).toEqual([]);
    expect(planInstall(app([['email', 'day']]), live([]), ctx({ dialect: 'mysql' })).problems).toEqual([]);
  });
});

describe('what a ledger needs of tables that are already there', () => {
  const parsed = validateManifest(structuredClone(LEDGER_KIT));
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  const kit = parsed.manifest;
  const tables = kit.requiredSchema!.tables;
  const kitRecords = Object.fromEntries(tables.map((table) => [table.ref, { table: `ledger_kit_${table.ref}`, owned: true, state: 'released' }]));
  /** Every table of the kit as an install before this one left it: its columns, and no index but what is given. */
  const there = (given: Record<string, { uniques?: string[][]; indexSets?: string[][] }> = {}): SchemaModelView => ({
    tables: tables.map((table) => ({
      ref: `ledger_kit_${table.ref}`,
      columns: table.columns.map((column) => ({ ref: column.ref, nullable: true, ...(column.role === 'pk' ? { isPrimaryKey: true } : {}) })),
      uniques: given[table.ref]?.uniques ?? [],
      indexSets: given[table.ref]?.indexSets ?? [],
    })),
  });
  const planned = (model: SchemaModelView) => {
    const plan = planInstall(kit, model, { prefix: 'ledger_kit_', records: kitRecords, others: [], dialect: 'postgres' });
    return Object.fromEntries((plan.tables ?? []).map((table) => [table.ref, table.edits.filter((edit) => edit.kind === 'add-index' || edit.kind === 'add-unique')]));
  };
  const KEY = ['source_table', 'source_row', 'source_line', 'posting', 'phase', 'round'];

  it('the receipt table gains its six-column key and its two indexes; each ledger table an index on its receipt', () => {
    expect(ledgerIndexes(kit).filter((index) => index.unique)).toEqual([{ table: 'postings', columns: KEY, unique: true }]);
    const got = planned(there());
    expect(got['postings']).toEqual([
      { kind: 'add-unique', column: 'round', with: KEY.slice(0, -1), name: uniqueSetName('ledger_kit_postings', KEY) },
      { kind: 'add-index', column: 'source_line', with: ['line_table'], name: indexSetName('ledger_kit_postings', ['line_table', 'source_line']) },
      { kind: 'add-index', column: 'held_until', name: plainIndexName('ledger_kit_postings', 'held_until') },
    ]);
    expect(got['entries']).toContainEqual({ kind: 'add-index', column: 'receipt_id', name: plainIndexName('ledger_kit_entries', 'receipt_id') });
    expect(got['holds']).toContainEqual({ kind: 'add-index', column: 'receipt_id', name: plainIndexName('ledger_kit_holds', 'receipt_id') });
    // A table no action inserts into is given none.
    expect(got['accounts']).toEqual([]);
  });

  it('nothing is planned twice: a table that has them is left as it is', () => {
    const got = planned(
      there({
        postings: { uniques: [KEY], indexSets: [KEY, ['line_table', 'source_line'], ['held_until']] },
        entries: { indexSets: [['receipt_id']] },
        holds: { indexSets: [['receipt_id']] },
      }),
    );
    expect(got['postings']).toEqual([]);
    expect(got['entries']).toEqual([]);
    expect(got['holds']).toEqual([]);
  });

  it('a key without the round is not the key: it is still added', () => {
    const got = planned(there({ postings: { uniques: [KEY.slice(0, -1)] } }));
    expect(got['postings']![0]).toMatchObject({ kind: 'add-unique', column: 'round' });
  });
});
