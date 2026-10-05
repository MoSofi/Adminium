// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A tab that lists an add-on's rows on another table's record page: what its
 * declaration may say, checked against the add-on's own tables.
 */
import { describe, expect, it } from 'vitest';

import { recordTabIssues, recordTabsSchema, type RecordTab, type RecordTabTable } from '../src/record-tabs.js';

const text = (ref: string, rules?: Record<string, unknown>) => ({ ref, type: 'text', ...(rules === undefined ? {} : { rules }) });
const pair = [text('of_table', { tableRef: true }), text('of_row')];

const TABLES: RecordTabTable[] = [
  {
    ref: 'links',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      ...pair,
      { ref: 'item_id', type: 'fk', references: 'items' },
      { ref: 'kit_id', type: 'fk', references: 'kits' },
      { ref: 'qty', type: 'decimal' },
      { ref: 'note', type: 'text' },
      { ref: 'cost', type: 'decimal', rules: { formula: { multiply: ['qty', 2] } } },
      { ref: 'used', type: 'decimal' },
      { ref: 'uses', type: 'int', rules: { rollup: { from: 'uses', balance: { column: 'used' } } } },
    ],
  },
  { ref: 'items', columns: [{ ref: 'id', type: 'int', role: 'pk' }, text('name')] },
  { ref: 'kits', columns: [{ ref: 'id', type: 'int', role: 'pk' }, text('name')] },
  { ref: 'uses', columns: [{ ref: 'id', type: 'int', role: 'pk' }, ...pair, { ref: 'qty', type: 'decimal' }, text('stamp', { stamp: { on: 'create' } })] },
  { ref: 'plain', columns: [{ ref: 'id', type: 'int', role: 'pk' }, text('of_table'), { ref: 'of_row', type: 'int' }, text('name')] },
];

const label = { key: 'kit.tab', fallback: 'Stock' };
const TAB: RecordTab = {
  id: 'stock',
  label,
  table: 'links',
  match: { table: 'of_table', row: 'of_row' },
  on: 'linked',
  columns: ['item_id', 'qty', 'note', 'cost'],
  edit: ['qty', 'note'],
  add: { pick: [{ table: 'items', label: 'name' }, { table: 'kits', label: 'name' }] },
  remove: true,
  form: ['note'],
  empty: { key: 'kit.empty', fallback: 'Nothing linked yet' },
  summary: { words: 'stock' },
  actions: [{ id: 'use', label: { key: 'kit.use', fallback: 'Use stock' }, child: { table: 'uses', form: ['qty'] } }],
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the tests reach into a tab freely
const issues = (change: (tab: RecordTab & Record<string, any>) => void, tables = TABLES, words = ['stock']): string[] => {
  const tab = structuredClone(TAB);
  change(tab);
  return recordTabIssues({ tabs: [tab], tables, words }).map((issue) => `${issue.path.join('.')}: ${issue.message}`);
};

describe('a record tab\'s declaration', () => {
  it('parses whole, on the linked tables or on named ones, and refuses a key it does not know', () => {
    expect(recordTabsSchema.parse([TAB])).toEqual([TAB]);
    expect(recordTabsSchema.safeParse([{ ...TAB, on: ['main.pos_orders'] }]).success).toBe(true);
    expect(recordTabsSchema.safeParse([{ ...TAB, add: { pick: { table: 'items', label: 'name' } } }]).success).toBe(true);
    expect(recordTabsSchema.safeParse([{ ...TAB, colour: 'red' }]).success).toBe(false);
    expect(recordTabsSchema.safeParse([{ ...TAB, on: [] }]).success).toBe(false);
    expect(recordTabsSchema.safeParse([TAB, TAB]).success).toBe(false);
    expect(recordTabsSchema.safeParse([]).success).toBe(false);
  });

  it('the fixture has nothing wrong with it', () => {
    expect(issues(() => undefined)).toEqual([]);
  });

  it('lists a table of the add-on by a stored table name and a row\'s key', () => {
    expect(issues((tab) => { tab.table = 'ghosts'; })).toEqual(['addOn.recordTabs.0.table: "ghosts" is not one of this add-on\'s own tables']);
    expect(issues((tab) => { tab.table = 'plain'; tab.columns = ['name']; delete tab.edit; delete tab.form; delete tab.add; }).join('\n')).toContain('"plain.of_table" says which table a row belongs to: a text column with rules.tableRef');
    expect(issues((tab) => { tab.table = 'plain'; tab.columns = ['name']; delete tab.edit; delete tab.form; delete tab.add; }).join('\n')).toContain('"plain.of_row" holds the key of the row it belongs to: a text column');
    expect(issues((tab) => { tab.match = { table: 'ghost', row: 'gone' }; }).join('\n')).toContain('"links.ghost" says which table a row belongs to');
    expect(issues((tab) => { tab.match = { table: 'ghost', row: 'gone' }; }).join('\n')).toContain('"links.gone" holds the key of the row');
  });

  it('shows columns the table has; edits and forms only what it shows and a person may write', () => {
    expect(issues((tab) => { tab.columns = [...tab.columns, 'ghost']; }).join()).toContain('"links" has no column "ghost"');
    expect(issues((tab) => { tab.edit = ['used']; }).join()).toContain('"used" is edited where it is shown: list it in "columns" too');
    expect(issues((tab) => { tab.columns = [...tab.columns, 'of_row']; tab.edit = ['of_row']; }).join()).toContain('"of_row" says which record the row belongs to: nobody edits it');
    expect(issues((tab) => { tab.edit = ['cost']; }).join()).toContain('"links.cost" is decided by Adminium: nobody edits it');
    // A column a rollup keeps a balance in is Adminium's too, and so is the key.
    expect(issues((tab) => { tab.columns = [...tab.columns, 'used']; tab.edit = ['used']; }).join()).toContain('"links.used" is decided by Adminium');
    expect(issues((tab) => { tab.columns = [...tab.columns, 'id']; tab.edit = ['id']; }).join()).toContain('"links.id" is decided by Adminium');
    expect(issues((tab) => { tab.form = ['ghost']; }).join()).toContain('"links" has no column "ghost"');
    expect(issues((tab) => { tab.form = ['used']; }).join()).toContain('list "used" in "columns" too');
    expect(issues((tab) => { tab.columns = [...tab.columns, 'of_table']; tab.form = ['of_table']; }).join()).toContain('no form asks for it');
  });

  it('adds a row by picking one of another own table it links to by one foreign key', () => {
    expect(issues((tab) => { tab.add = { pick: { table: 'ghosts', label: 'name' } }; })).toEqual(['addOn.recordTabs.0.add.pick.table: "ghosts" is not one of this add-on\'s own tables']);
    expect(issues((tab) => { tab.add = { pick: [{ table: 'items', label: 'name' }, { table: 'items', label: 'name' }] }; }).join()).toContain('addOn.recordTabs.0.add.pick.1.table: "items" is picked from twice');
    expect(issues((tab) => { tab.add = { pick: { table: 'uses', label: 'qty' } }; }).join()).toContain('"links" has none to "uses"');
    expect(issues((tab) => { tab.add = { pick: { table: 'items', label: 'ghost' } }; }).join()).toContain('"items" has no column "ghost"');
    const twice = structuredClone(TABLES);
    (twice[0]!.columns as RecordTabTable['columns'][number][]).push({ ref: 'other_item_id', type: 'fk', references: 'items' });
    expect(issues(() => undefined, twice).join()).toContain('"links" has 2 to "items"');
  });

  it('heads the tab with stock words the add-on declares', () => {
    expect(issues(() => undefined, TABLES, [])).toEqual(['addOn.recordTabs.0.summary.words: "stock" is not one of this add-on\'s stock words (addOn.words)']);
    expect(issues((tab) => { delete tab.summary; }, TABLES, [])).toEqual([]);
  });

  it('a button makes a row of another own table for the same record', () => {
    const action = TAB.actions![0]!;
    expect(issues((tab) => { tab.actions = [action, action]; }).join()).toContain('two actions of the tab share the id "use"');
    expect(issues((tab) => { tab.actions = [{ ...action, child: { table: 'ghosts', form: ['qty'] } }]; })).toEqual(['addOn.recordTabs.0.actions.0.child.table: "ghosts" is not one of this add-on\'s own tables']);
    expect(issues((tab) => { tab.actions = [{ ...action, child: { table: 'items', form: ['name'] } }]; }).join()).toContain('"items.of_table" says which table a row belongs to');
    expect(issues((tab) => { tab.actions = [{ ...action, child: { table: 'uses', form: ['ghost'] } }]; }).join()).toContain('"uses" has no column "ghost"');
    expect(issues((tab) => { tab.actions = [{ ...action, child: { table: 'uses', form: ['of_row'] } }]; }).join()).toContain('"of_row" says which record the row belongs to: no form asks for it');
    expect(issues((tab) => { tab.actions = [{ ...action, child: { table: 'uses', form: ['stamp'] } }]; }).join()).toContain('"uses.stamp" is decided by Adminium: no form asks for it');
  });
});
