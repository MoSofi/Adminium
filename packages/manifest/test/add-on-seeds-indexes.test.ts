// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What an add-on's tables start with and how they are indexed: seed rows,
 * declared indexes, and the one-row settings table.
 */
import { describe, expect, it } from 'vitest';

import { ledgerIndexes, validateManifest, type Manifest } from '../src/index.js';
import { KIT } from './add-on-kit-fixture.js';
import { LEDGER_KIT } from './ledger-kit-fixture.js';

type Doc = Record<string, unknown>;

const issuesOf = (doc: unknown): string[] => {
  const result = validateManifest(doc);
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`);
};

const UNITS = {
  ref: 'units',
  columns: [
    { ref: 'id', type: 'int', role: 'pk' },
    { ref: 'code', type: 'text', maxLength: 12 },
    { ref: 'name', type: 'text', maxLength: 40 },
    { ref: 'base_id', type: 'fk', references: 'units', nullable: true },
  ],
};
const SETTINGS = {
  ref: 'settings',
  columns: [
    { ref: 'id', type: 'int', role: 'pk' },
    { ref: 'low_below', type: 'int', default: 5 },
    { ref: 'note', type: 'text', maxLength: 200, nullable: true },
  ],
};

const kit = (over: { tables?: Doc[]; items?: Doc; top?: Doc; addOn?: Doc } = {}): Doc => ({
  ...structuredClone(KIT),
  addOn: { ...KIT.addOn, ...(over.addOn ?? {}) },
  requiredSchema: { prefixed: true, tables: [{ ...KIT.requiredSchema.tables[0], ...(over.items ?? {}) }, UNITS, ...(over.tables ?? [])] },
  ...(over.top ?? {}),
});

describe('seed rows', () => {
  it('are rows of an own table, in its own columns', () => {
    expect(issuesOf(kit({ top: { seeds: [{ table: 'units', rows: [{ '@label': 'each', code: 'ea', name: { '@t': { 'en-US': 'Each' } } }, { code: 'dz', name: 'Dozen', base_id: { '@ref': 'each' } }] }] } }))).toEqual([]);
    expect(issuesOf(kit({ top: { seeds: [{ table: 'orders', rows: [{ code: 'x' }] }] } })).join('\n')).toContain('"orders" is not one of this add-on\'s tables');
    expect(issuesOf(kit({ top: { seeds: [{ table: 'units', rows: [{ colour: 'red' }] }] } })).join('\n')).toContain('"units" has no column "colour"');
  });

  it('a seed row takes only @t, @label and @ref', () => {
    const withValue = (value: unknown) => issuesOf(kit({ top: { seeds: [{ table: 'units', rows: [{ code: 'ea', name: value }] }] } })).join('\n');
    expect(withValue({ '@ago': 'PT1H' })).toContain('a seed value is a plain value, {"@t": {…}} or {"@ref": "<label>"}, not "@ago"');
    expect(withValue({ '@day': 1 })).toContain('not "@day"');
    expect(withValue({ '@asset': 'logo' })).toContain('not "@asset"');
    const rowDirective = issuesOf(kit({ top: { seeds: [{ table: 'units', rows: [{ code: 'ea', name: 'Each', '@onlyIfEmpty': true }] }] } })).join('\n');
    expect(rowDirective).toContain('a seed row takes "@label" and no other row directive, not "@onlyIfEmpty"');
  });

  it('a table is seeded with at most 200 rows', () => {
    const rows = Array.from({ length: 201 }, (_, i) => ({ code: `u${String(i)}`, name: 'Unit' }));
    expect(issuesOf(kit({ top: { seeds: [{ table: 'units', rows }] } })).join('\n')).toContain('a table is seeded with at most 200 rows');
  });
});

describe('declared indexes', () => {
  const withIndexes = (indexes: string[][], extra: Doc = {}) => issuesOf(kit({ items: { indexes, ...extra } })).join('\n');

  it('index columns of the table, in the order given', () => {
    expect(withIndexes([['name', 'sku'], ['sku', 'name'], ['on_hand']])).toBe('');
    expect(withIndexes([['colour']])).toContain('no column "colour" to index');
    expect(withIndexes([['name', 'name']])).toContain('an index names each column once');
    expect(withIndexes([['name', 'sku'], ['name', 'sku']])).toContain('the same columns are indexed twice');
  });

  it('an index set equal to a unique set is refused', () => {
    expect(withIndexes([['sku', 'name']], { unique: [['name', 'sku']] })).toContain('indexed already: these columns are a unique set');
    expect(withIndexes([['id']])).toContain('indexed already: "id" is unique');
  });

  it('more than six sets or five columns is refused', () => {
    const seven = [['name'], ['sku'], ['on_hand'], ['name', 'sku'], ['sku', 'name'], ['name', 'on_hand'], ['on_hand', 'name']];
    expect(withIndexes(seven)).not.toBe('');
    expect(withIndexes(seven.slice(0, 6))).toBe('');
    expect(withIndexes([['name', 'sku', 'on_hand', 'id', 'name']])).not.toBe('');
  });

  it('a text column in an index needs maxLength', () => {
    const tables = [{ ref: 'notes', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'body', type: 'text', nullable: true }], indexes: [['body']] }];
    expect(issuesOf(kit({ tables })).join('\n')).toContain('an index needs columns that can be indexed');
  });
});

describe('the settings table', () => {
  it('is an own table whose columns all have a default or may be empty', () => {
    expect(issuesOf(kit({ tables: [SETTINGS], addOn: { settingsTable: 'settings' } }))).toEqual([]);
    expect(issuesOf(kit({ addOn: { settingsTable: 'settings' } })).join('\n')).toContain('"settings" is not one of this add-on\'s tables');
  });

  it('a settings table with a required column and no default is refused', () => {
    const required = { ...SETTINGS, columns: [...SETTINGS.columns, { ref: 'currency', type: 'text', maxLength: 3 }] };
    expect(issuesOf(kit({ tables: [required], addOn: { settingsTable: 'settings' } })).join('\n')).toContain('give "settings.currency" a default, or make it nullable');
  });
});

describe('the floor', () => {
  it('seeds, indexes and a settings table under a floor before the install floor are refused', () => {
    const doc = kit({ tables: [SETTINGS], addOn: { settingsTable: 'settings' }, items: { indexes: [['name', 'sku']] }, top: { seeds: [{ table: 'units', rows: [{ code: 'ea', name: 'Each' }] }], compatibility: { minAdminiumVersion: '0.3.17' } } });
    const issues = issuesOf(doc).join('\n');
    expect(issues).toContain('seeds: "seeds" is read by Adminium 0.3.18 and later');
    expect(issues).toContain('requiredSchema.tables.0.indexes: "table.indexes" is read by');
    expect(issues).toContain('addOn.settingsTable: "addOn.settingsTable" is read by');
  });
});

describe('a ledger\'s own tables', () => {
  const ledgerKit = (over: Doc = {}, tables?: (tables: Doc[]) => Doc[]): Doc => {
    const doc = structuredClone(LEDGER_KIT) as unknown as { requiredSchema: { prefixed: true; tables: Doc[] } };
    if (tables !== undefined) doc.requiredSchema.tables = tables(doc.requiredSchema.tables);
    return { ...(doc as unknown as Doc), ...over };
  };

  it('a seed for a ledger table or a receipt table is refused', () => {
    const entries = issuesOf(ledgerKit({ seeds: [{ table: 'entries', rows: [{ amount: '1.000' }] }] })).join('\n');
    expect(entries).toContain('seeds.0.table: "entries" is a table of the ledger "units", which only postings write: a seed never fills it');
    const receipts = issuesOf(ledgerKit({ seeds: [{ table: 'postings', rows: [{ ledger: 'units' }] }] })).join('\n');
    expect(receipts).toContain('"postings" is the receipt table of the ledger "units"');
    expect(issuesOf(ledgerKit({ seeds: [{ table: 'accounts', rows: [{ name: 'Flour' }] }] }))).toEqual([]);
  });

  it('the derived receipt key is the six columns in order, with the indexes a guard, the timed job and a reverse read by', () => {
    const result = validateManifest(ledgerKit());
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(ledgerIndexes(result.manifest as Manifest)).toEqual([
      { table: 'postings', columns: ['source_table', 'source_row', 'source_line', 'posting', 'phase', 'round'], unique: true },
      { table: 'postings', columns: ['line_table', 'source_line'], unique: false },
      { table: 'postings', columns: ['held_until'], unique: false },
      { table: 'entries', columns: ['receipt_id'], unique: false },
      { table: 'holds', columns: ['receipt_id'], unique: false },
    ]);
  });

  it('an app, and an add-on with no ledger, derive none', () => {
    const result = validateManifest(structuredClone(KIT));
    expect(result.ok && ledgerIndexes(result.manifest as Manifest)).toEqual([]);
  });

  it('passes the MySQL bound for the fixture\'s widths; a receipt table with 255-wide source columns is refused', () => {
    expect(issuesOf(ledgerKit())).toEqual([]);
    const wide = (tables: Doc[]) =>
      tables.map((table) =>
        table['ref'] === 'postings'
          ? { ...table, columns: (table['columns'] as Doc[]).map((column) => (['source_table', 'source_row', 'source_line'].includes(String(column['ref'])) ? { ...column, maxLength: 255 } : column)) }
          : table,
      );
    const issues = issuesOf(ledgerKit({}, wide)).join('\n');
    expect(issues).toContain('the key of the receipt table "postings" (source_table 255, source_row 255, source_line 255, posting 40, phase, round) takes 3356 bytes, and MySQL indexes at most 3072');
  });
});
