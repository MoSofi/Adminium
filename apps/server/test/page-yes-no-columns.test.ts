// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A stored page follows a column that became a yes/no after it was stored.
 *
 * An app's update marks its yes/no columns (`column.yesNo`) long after its
 * pages exist, and a stored column keeps the type of the day it was written:
 * the page went on drawing a number box. The page reply follows that one
 * move, and nothing else about the stored column.
 */
import { describe, expect, it } from 'vitest';

import { withYesNoColumns, type ColumnFact, type ColumnFactsBlock } from '../src/routes/pages/column-facts.js';

const fact = (spec: Record<string, unknown>): ColumnFact => ({ spec, ordinal: 0, writable: true, filledBy: null, required: false });

const facts = (columns: Record<string, unknown>[]): ColumnFactsBlock => ({
  table: { labelSingular: null, labelPlural: null },
  columns: columns.map(fact),
  relations: [],
  children: [],
});

const LIVE = facts([
  { name: 'id', logicalType: 'integer', semantic: 'pk-id' },
  { name: 'active', label: 'Active', logicalType: 'boolean', semantic: 'plain', sortable: true },
  { name: 'stock', logicalType: 'integer', semantic: 'quantity' },
]);

const stored = (columns: Record<string, unknown>[]) => ({ template: 'page-crud', source: { table: 'main.products' }, config: { columns, pageSize: 25 } });

describe('a stored page and a column that became a yes/no', () => {
  it('reads the column as a yes/no, and keeps what the page set on it', () => {
    const page = stored([
      { name: 'id', logicalType: 'integer', semantic: 'pk-id' },
      { name: 'active', label: 'On sale', logicalType: 'integer', semantic: 'quantity', align: 'end', width: 90, hidden: true },
      { name: 'stock', logicalType: 'integer', semantic: 'quantity' },
    ]);
    const out = withYesNoColumns(page, LIVE) as typeof page;
    expect(out.config.columns[1]).toEqual({ name: 'active', label: 'On sale', logicalType: 'boolean', semantic: 'plain', width: 90, hidden: true });
    // A whole number that is one stays one, and the rest of the page is untouched.
    expect(out.config.columns[2]).toEqual(page.config.columns[2]);
    expect(out.config.pageSize).toBe(25);
  });

  it('follows an older envelope, whose columns sit at the top', () => {
    const page = { columns: [{ name: 'active', logicalType: 'bigint' }] };
    expect(withYesNoColumns(page, LIVE)).toEqual({ columns: [{ name: 'active', logicalType: 'boolean', semantic: 'plain' }] });
  });

  it('hands back the very page when nothing moved', () => {
    const page = stored([{ name: 'active', logicalType: 'boolean' }, { name: 'stock', logicalType: 'integer' }]);
    expect(withYesNoColumns(page, LIVE)).toBe(page);
    expect(withYesNoColumns(page, null)).toBe(page);
    // A column the page reads as text is the page's own choice, not a stale number.
    const text = stored([{ name: 'active', logicalType: 'text' }]);
    expect(withYesNoColumns(text, LIVE)).toBe(text);
  });
});
