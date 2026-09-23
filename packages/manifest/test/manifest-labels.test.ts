// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app's names for its tables and columns, and the column that names a row
 * where another table links to it.
 */
import { describe, expect, it } from 'vitest';

import { requiredTableSchema } from '../src/index.js';

const table = (extra: Record<string, unknown>, columns: Record<string, unknown>[] = []) => ({
  ref: 'menu_categories',
  columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'name', type: 'text', maxLength: 80 }, ...columns],
  ...extra,
});

describe('table and column labels', () => {
  it('takes a label, its plural and a key field, as text or in several languages', () => {
    expect(requiredTableSchema.safeParse(table({ label: 'Category', labelPlural: 'Categories', keyField: 'name' })).success).toBe(true);
    const labelled = table(
      { label: { 'en-US': 'Category', 'de-DE': 'Kategorie' }, labelPlural: { 'en-US': 'Categories', 'de-DE': 'Kategorien' } },
      [{ ref: 'icon', type: 'text', maxLength: 40, label: { 'en-US': 'Icon', 'de-DE': 'Symbol' } }],
    );
    expect(requiredTableSchema.safeParse(labelled).success).toBe(true);
  });

  it('refuses a key field the table does not have, a plural with no label, and labels with no English', () => {
    const issues = (value: unknown) => requiredTableSchema.safeParse(value).error?.issues.map((i) => i.message) ?? [];
    expect(issues(table({ keyField: 'title' }))).toContain('keyField must name one of the table’s columns');
    expect(issues(table({ labelPlural: 'Categories' }))).toContain('labelPlural needs a label');
    expect(requiredTableSchema.safeParse(table({ label: { 'de-DE': 'Kategorie' } })).success).toBe(false);
    expect(requiredTableSchema.safeParse(table({}, [{ ref: 'tint', type: 'text', maxLength: 32, label: '' }])).success).toBe(false);
  });
});
