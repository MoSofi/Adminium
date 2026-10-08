// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A LIST'S HEADING IN THE READER'S LANGUAGE.
 *
 * A page stores each column's label once, the day it is made. The manifest
 * that made the table names the column in every language it speaks, and a
 * form reads those for the reader — a list read the stored one, so a German
 * reader had German fields over English headings. A stored label that is
 * still one of the column's own names follows the reader; one somebody typed
 * on the page stays.
 */
import { describe, expect, it } from 'vitest';

import { labelWordsOf, withReaderLabels, withReaderTitle, withStoredLabels, type ColumnFactsBlock } from '../src/routes/pages/column-facts.js';

const ROWS = [
  { op: 'column.label', tableName: 'main.items', columnName: 'cost_avg', value: { label: { en_US: 'Average cost', de_DE: 'Durchschnittskosten', ar_EG: 'متوسط التكلفة' } } },
  { op: 'column.label', tableName: 'main.items', columnName: 'sku', value: { label: 'SKU' } },
  { op: 'column.label', tableName: 'main.places', columnName: 'name', value: { label: { en_US: 'Name', de_DE: 'Name' } } },
  { op: 'column.pii', tableName: 'main.items', columnName: 'cost_avg', value: { masked: true } },
  { op: 'table.label', tableName: 'main.items', columnName: null, value: { label: { en_US: 'Item' } } },
];
const facts = (labels: Record<string, string>): ColumnFactsBlock => ({ columns: Object.entries(labels).map(([name, label]) => ({ spec: { name, label } })) }) as unknown as ColumnFactsBlock;
const page = (columns: { name: string; label: string }[]) => ({ v: 1, config: { columns, pageSize: 25 } });
const labelsOf = (config: unknown) => ((config as { config: { columns: { label: string }[] } }).config.columns.map((column) => column.label));

describe('the names a table\'s columns were given', () => {
  it('are every language of each column\'s label, for that table alone', () => {
    const said = labelWordsOf(ROWS, 'main.items');
    expect([...said.keys()]).toEqual(['cost_avg', 'sku']);
    expect([...said.get('cost_avg')!]).toEqual(['Average cost', 'Durchschnittskosten', 'متوسط التكلفة']);
    expect([...said.get('sku')!]).toEqual(['SKU']);
  });
});

describe('a stored heading', () => {
  const said = labelWordsOf(ROWS, 'main.items');
  const german = facts({ cost_avg: 'Durchschnittskosten', sku: 'SKU', note: 'Notiz' });

  it('that is still the column\'s own name is shown in the reader\'s language', () => {
    const stored = page([{ name: 'cost_avg', label: 'Average cost' }, { name: 'sku', label: 'SKU' }]);
    expect(labelsOf(withReaderLabels(stored, german, said))).toEqual(['Durchschnittskosten', 'SKU']);
    // Stored in another language than English (an Arabic-speaking admin installed it): the same.
    expect(labelsOf(withReaderLabels(page([{ name: 'cost_avg', label: 'متوسط التكلفة' }]), german, said))).toEqual(['Durchschnittskosten']);
    // The stored page itself is never changed.
    expect(labelsOf(stored)).toEqual(['Average cost', 'SKU']);
  });

  it('that somebody typed on the page stays as typed', () => {
    const stored = page([{ name: 'cost_avg', label: 'What it costs us' }]);
    expect(withReaderLabels(stored, german, said)).toBe(stored);
  });

  it('of a column no manifest named, or with nothing to read, is left alone', () => {
    const stored = page([{ name: 'note', label: 'Note' }]);
    expect(withReaderLabels(stored, german, said)).toBe(stored);
    expect(withReaderLabels(stored, null, said)).toBe(stored);
    expect(withReaderLabels(stored, german, new Map())).toBe(stored);
  });

  it('is followed in an older page too, whose columns sit one level up', () => {
    const old = { v: 1, columns: [{ name: 'cost_avg', label: 'Average cost' }] };
    expect((withReaderLabels(old, german, said) as typeof old).columns[0]!.label).toBe('Durchschnittskosten');
  });
});

describe('a page\'s own title', () => {
  const stored = { v: 1, title: { key: 'k', fallback: 'Overview', from: 'Overview', titles: { 'en-US': 'Overview', 'de-DE': 'Übersicht' } } };
  const titleOf = (config: unknown) => (config as typeof stored).title.fallback;

  it('is read in the reader\'s language while it is the manifest\'s', () => {
    expect(titleOf(withReaderTitle(stored, 'de_DE'))).toBe('Übersicht');
    expect(titleOf(withReaderTitle(stored, 'de-AT'))).toBe('Übersicht');
    expect(withReaderTitle(stored, 'fr_FR')).toBe(stored);
    expect(withReaderTitle(stored, undefined)).toBe(stored);
  });

  it('stays as renamed once somebody renamed the page', () => {
    const renamed = { ...stored, title: { ...stored.title, fallback: 'Lager heute' } };
    expect(withReaderTitle(renamed, 'de_DE')).toBe(renamed);
  });
});

describe('a save from the page\'s editor', () => {
  const said = labelWordsOf(ROWS, 'main.items');
  const stored = { v: 1, config: { columns: [{ name: 'cost_avg', label: 'Average cost' }, { name: 'sku', label: 'Stock code' }], pageSize: 25 } };
  const labels = (config: unknown) => (config as { columns: { label: string }[] }).columns.map((column) => column.label);

  it('keeps the stored heading where the one sent back is only the reader\'s translation of it', () => {
    // A German admin changed the page size: the headings went out in German and come back so.
    const sent = { columns: [{ name: 'cost_avg', label: 'Durchschnittskosten' }, { name: 'sku', label: 'Stock code' }], pageSize: 50 };
    const saved = withStoredLabels(sent, stored, said) as typeof sent;
    expect(labels(saved)).toEqual(['Average cost', 'Stock code']);
    expect(saved.pageSize).toBe(50);
  });

  it('saves a heading somebody typed, and one typed over a heading typed before', () => {
    const typed = { columns: [{ name: 'cost_avg', label: 'Einstandspreis' }, { name: 'sku', label: 'SKU' }] };
    // "Einstandspreis" is none of the column's names; "Stock code" was typed earlier, so "SKU" over it is a change.
    expect(withStoredLabels(typed, stored, said)).toBe(typed);
  });

  it('leaves a body with no columns, and a page of no named columns, as they are', () => {
    const body = { pageSize: 10 };
    expect(withStoredLabels(body, stored, said)).toBe(body);
    const sent = { columns: [{ name: 'cost_avg', label: 'Durchschnittskosten' }] };
    expect(withStoredLabels(sent, stored, new Map())).toBe(sent);
  });
});
