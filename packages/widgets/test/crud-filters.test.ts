// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The filters a page offers (D8): what a column can be filtered with, what a
 * table gets for free, and what a stored block may say.
 *
 * The derivation's two rules are the ones worth pinning, because both are
 * about what a person meets on a page nobody has configured: TWO at most, and
 * status first — the column every admin ever written filters by.
 */
import { describe, expect, it } from 'vitest';

import {
  deriveFilters,
  filterControlFor,
  filtersFor,
  legalFilterControls,
  parseCrudFilters,
  type FilterColumnFact,
} from '../src/page-config/index.js';

const fact = (
  name: string,
  spec: Partial<FilterColumnFact['spec']> = {},
  over: Partial<FilterColumnFact> = {},
): FilterColumnFact => ({
  spec: { name, logicalType: 'varchar', ...spec },
  ordinal: 1,
  ...over,
});

describe('which control a column gets', () => {
  it('answers by shape, and refuses what wave 1 cannot filter', () => {
    expect(filterControlFor({ name: 'status', logicalType: 'enum', enumValues: ['new', 'seen'] })).toBe('one-of');
    expect(filterControlFor({ name: 'paid', logicalType: 'boolean' })).toBe('yes-no');
    expect(filterControlFor({ name: 'client_id', logicalType: 'integer', fk: { table: 'public.clients' } })).toBe('record');
    expect(filterControlFor({ name: 'created_at', logicalType: 'timestamptz' })).toBe('date-range');
    expect(filterControlFor({ name: 'total', logicalType: 'decimal' })).toBe('number-range');
    // A free text box over a text column is the query builder D8 refuses, and
    // its distinct values would mean reading the table to build a menu.
    expect(filterControlFor({ name: 'notes', logicalType: 'text' })).toBeNull();
    // A projection has nothing on this table to filter.
    expect(filterControlFor({ name: 'client__name', logicalType: 'varchar', lookup: {} })).toBeNull();
    // A key is a number nobody filters by range.
    expect(filterControlFor({ name: 'id', logicalType: 'integer', primaryKey: true })).toBeNull();
  });

  it('offers a choice both ways round, and everything else one way', () => {
    expect(legalFilterControls({ name: 'status', logicalType: 'enum', enumValues: ['a'] })).toEqual([
      'one-of',
      'any-of',
    ]);
    expect(legalFilterControls({ name: 'paid', logicalType: 'boolean' })).toEqual(['yes-no']);
    expect(legalFilterControls({ name: 'notes', logicalType: 'text' })).toEqual([]);
  });
});

describe('what a page gets for free', () => {
  it('takes two, and puts status first however late it sits', () => {
    const derived = deriveFilters({
      columns: [
        fact('total', { logicalType: 'decimal' }, { ordinal: 1 }),
        fact('created_at', { logicalType: 'timestamptz' }, { ordinal: 2 }),
        fact('status', { logicalType: 'enum', enumValues: ['new', 'seen'], semantic: 'status' }, { ordinal: 9 }),
      ],
    });
    expect(derived).toEqual([
      { column: 'status', control: 'one-of' },
      { column: 'created_at', control: 'date-range' },
    ]);
  });

  it('never offers a masked column', () => {
    // Its values are redacted for this reader, so a menu over it would either
    // leak what it exists to hide or list asterisks nobody can choose between.
    const derived = deriveFilters({
      columns: [
        fact('ssn', { logicalType: 'enum', enumValues: ['a', 'b'] }, { ordinal: 1, masked: true }),
        fact('paid', { logicalType: 'boolean' }, { ordinal: 2 }),
      ],
    });
    expect(derived).toEqual([{ column: 'paid', control: 'yes-no' }]);
  });

  it('answers nothing for a table with nothing filterable', () => {
    expect(deriveFilters({ columns: [fact('notes', { logicalType: 'text' })] })).toEqual([]);
  });
});

describe('the stored block', () => {
  it('reads what it can and refuses a column named twice', () => {
    expect(parseCrudFilters({ filters: [{ column: 'status', control: 'any-of', label: 'State' }] })).toEqual([
      { column: 'status', control: 'any-of', label: 'State' },
    ]);
    // Two controls writing one condition, and the last one silently wins.
    expect(parseCrudFilters({ filters: [{ column: 'status' }, { column: 'status' }] })).toBeNull();
    // A page a little ahead of this binary falls back to the derived set.
    expect(parseCrudFilters({ filters: [{ column: 'x', control: 'not-a-control' }] })).toBeNull();
    expect(parseCrudFilters({})).toBeNull();
  });

  it('drops a filter whose column is gone, or has become masked', () => {
    const facts = {
      columns: [
        fact('status', { logicalType: 'enum', enumValues: ['new'] }),
        fact('ssn', { logicalType: 'enum', enumValues: ['a'] }, { masked: true }),
      ],
    };
    expect(
      filtersFor([{ column: 'status' }, { column: 'ssn' }, { column: 'dropped' }], facts),
    ).toEqual([{ column: 'status', control: 'one-of' }]);
    // No block at all ⇒ the derived set, not an empty bar.
    expect(filtersFor(null, facts)).toEqual([{ column: 'status', control: 'one-of' }]);
  });
});
