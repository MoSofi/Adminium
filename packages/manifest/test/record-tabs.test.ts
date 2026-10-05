// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A record tab: an add-on's rows listed on the record page of the row they
 * belong to, found by the table-and-row pair the add-on keeps.
 */
import { recordTabsSchema } from '@adminium/add-on-contracts';
import { describe, expect, it } from 'vitest';

import { installFloorWords, validateManifest } from '../src/index.js';
import { LEDGER_KIT } from './ledger-kit-fixture.js';

type Doc = Record<string, unknown>;

const issuesOf = (doc: unknown): string => {
  const result = validateManifest(doc);
  return result.ok ? '' : result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n');
};

const pk = { ref: 'id', type: 'int', role: 'pk' };
const pair = [
  { ref: 'host_table', type: 'text', maxLength: 128, rules: { tableRef: true } },
  { ref: 'host_row', type: 'text', maxLength: 64 },
];
/** Which account a host row draws on: the tab's own table. */
const LINKS = { ref: 'links', columns: [pk, ...pair, { ref: 'account_id', type: 'fk', references: 'accounts' }, { ref: 'per_unit', type: 'decimal', scale: 3, default: 1 }, { ref: 'note', type: 'text', maxLength: 200, nullable: true }] };
/** A use of stock noted against a host row: what the tab's button makes. */
const USES = { ref: 'uses', columns: [pk, ...pair, { ref: 'account_id', type: 'fk', references: 'accounts' }, { ref: 'quantity', type: 'decimal', scale: 3 }] };
const SETTINGS = { ref: 'settings', columns: [pk, { ref: 'show_left_below', type: 'int', default: 5 }] };

const label = (text: string) => ({ key: `kit.${text.toLowerCase().replaceAll(' ', '-')}`, fallback: text });
const TAB = {
  id: 'stock',
  label: label('Stock'),
  table: 'links',
  match: { table: 'host_table', row: 'host_row' },
  on: 'linked',
  columns: ['account_id', 'per_unit', 'note'],
  edit: ['per_unit', 'note'],
  add: { pick: { table: 'accounts', label: 'name' } },
  remove: true,
  empty: label('Nothing is linked yet'),
  summary: { words: 'units-left' },
  actions: [{ id: 'use', label: label('Use stock'), child: { table: 'uses', form: ['account_id', 'quantity'] } }],
};

function kit(tabs: Doc[], tables: Doc[] = [LINKS, USES, SETTINGS]): Doc {
  const doc = structuredClone(LEDGER_KIT) as unknown as { requiredSchema: { prefixed: true; tables: Doc[] }; addOn: Doc };
  doc.requiredSchema.tables.push(...tables);
  doc.addOn = { ...doc.addOn, settingsTable: 'settings', words: [{ id: 'units-left', ledger: 'units', action: 'use', input: 'account' }], recordTabs: tabs };
  return doc as unknown as Doc;
}
const one = (over: Doc) => issuesOf(kit([{ ...TAB, ...over }]));

describe('a record tab', () => {
  it('lists rows of one of the add-on\'s own tables, found by a stored table name and a row\'s key', () => {
    expect(issuesOf(kit([TAB]))).toBe('');
    expect(installFloorWords(kit([TAB])).map((found) => found.word)).toContain('addOn.recordTabs');
    expect(one({ table: 'orders' })).toContain('addOn.recordTabs.0.table: "orders" is not one of this add-on\'s own tables');
    expect(one({ match: { table: 'note', row: 'host_row' } })).toContain('"links.note" says which table a row belongs to: a text column with rules.tableRef');
    expect(one({ match: { table: 'host_table', row: 'account_id' } })).toContain('"links.account_id" holds the key of the row it belongs to: a text column');
  });

  it('takes one to six tabs, each with its own id, of one to eight columns', () => {
    expect(recordTabsSchema.safeParse([TAB, TAB]).success).toBe(false);
    expect(recordTabsSchema.safeParse(Array.from({ length: 7 }, (_, i) => ({ ...TAB, id: `t${String(i)}` }))).success).toBe(false);
    expect(recordTabsSchema.safeParse([{ ...TAB, columns: [] }]).success).toBe(false);
    expect(recordTabsSchema.safeParse([{ ...TAB, on: ['pos:menu_items', 'public.products'] }]).success).toBe(true);
    expect(recordTabsSchema.safeParse([{ ...TAB, on: 'all' }]).success).toBe(false);
  });

  it('shows and edits its own columns: never the pair, never a column Adminium decides', () => {
    expect(one({ columns: ['account_id', 'colour'] })).toContain('"links" has no column "colour"');
    expect(one({ edit: ['account_id', 'host_row'], columns: ['account_id', 'host_row'] })).toContain('"host_row" says which record the row belongs to: nobody edits it');
    expect(one({ edit: ['id'], columns: ['id', 'account_id'] })).toContain('"links.id" is decided by Adminium: nobody edits it');
    expect(one({ edit: ['per_unit'], columns: ['account_id'] })).toContain('"per_unit" is edited where it is shown: list it in "columns" too');
  });

  it('adds a row by picking one or two kinds of row the table links to, each once', () => {
    expect(one({ add: { pick: { table: 'entries', label: 'kind' } } })).toContain('a picked row is linked by one foreign key: "links" has none to "entries"');
    expect(one({ add: { pick: { table: 'accounts', label: 'colour' } } })).toContain('"accounts" has no column "colour"');
    expect(one({ add: { pick: [{ table: 'accounts', label: 'name' }, { table: 'accounts', label: 'name' }] } })).toContain('"accounts" is picked from twice');
    expect(recordTabsSchema.safeParse([{ ...TAB, add: { pick: [TAB.add.pick, TAB.add.pick, TAB.add.pick] } }]).success).toBe(false);
  });

  it('a form is the same row the tab shows, without the pair', () => {
    expect(one({ form: ['per_unit', 'note'], edit: undefined })).toBe('');
    expect(one({ form: ['host_table'], columns: ['account_id', 'host_table'], edit: undefined })).toContain('"host_table" says which record the row belongs to: no form asks for it');
    expect(one({ form: ['per_unit'], columns: ['account_id'], edit: undefined })).toContain('the form is the same row the tab shows: list "per_unit" in "columns" too');
  });

  it('is headed by one of the add-on\'s own stock words', () => {
    expect(one({ summary: { words: 'items-left' } })).toContain('"items-left" is not one of this add-on\'s stock words (addOn.words)');
  });

  it('a button makes a row of another own table that carries the same pair, which its form never asks for', () => {
    const action = (child: Doc) => one({ actions: [{ ...TAB.actions[0], child }] });
    expect(action({ table: 'entries', form: ['amount'] })).toContain('"entries.host_table" says which table a row belongs to');
    expect(action({ table: 'uses', form: ['quantity', 'host_row'] })).toContain('"host_row" says which record the row belongs to: no form asks for it');
    expect(action({ table: 'uses', form: ['colour'] })).toContain('"uses" has no column "colour"');
    expect(action({ table: 'orders', form: ['x'] })).toContain('"orders" is not one of this add-on\'s own tables');
    expect(one({ actions: [TAB.actions[0], TAB.actions[0]] })).toContain('two actions of the tab share the id "use"');
  });
});
