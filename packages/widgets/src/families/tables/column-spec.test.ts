// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import {
  compareCellValues,
  displayValueOf,
  formatMoney,
  formatRelativeTime,
  gridColumnSpecSchema,
  isNumericColumn,
  maskedColumnsOf,
  rowIdOf,
} from './column-spec.js';
import type { GridColumnSpec, GridColumnSpecInput } from './column-spec.js';

const spec = (input: GridColumnSpecInput): GridColumnSpec => gridColumnSpecSchema.parse(input);

describe('gridColumnSpecSchema', () => {
  it('applies defaults', () => {
    const column = spec({ name: 'mrr', label: 'MRR' });
    expect(column.logicalType).toBe('text');
    expect(column.sortable).toBe(true);
    expect(column.pii).toBe(false);
    expect(column.nullable).toBe(true);
  });
});

describe('compareCellValues — the string-mrr numeric sort fix (ia-mapping §5)', () => {
  const mrr = spec({ name: 'mrr', label: 'MRR', logicalType: 'decimal', semantic: 'money' });

  it('sorts numerically when pg serializes decimals as strings', () => {
    // Lexicographic would order "1290" < "290" < "6100" < "980" — wrong.
    const values = ['980', '6100', '290', '1290'];
    const sorted = [...values].sort((a, b) => compareCellValues(mrr, a, b));
    expect(sorted).toEqual(['290', '980', '1290', '6100']);
  });

  it('sorts mixed number/string values numerically (client-added row defect)', () => {
    const values: unknown[] = [4820, '980', 6100, '1290'];
    const sorted = [...values].sort((a, b) => compareCellValues(mrr, a, b));
    expect(sorted).toEqual(['980', '1290', 4820, 6100]);
  });

  it('keeps malformed numerics deterministic (sorted last)', () => {
    const values: unknown[] = ['n/a', '10', 5];
    const sorted = [...values].sort((a, b) => compareCellValues(mrr, a, b));
    expect(sorted).toEqual([5, '10', 'n/a']);
  });

  it('nulls sort first, booleans false<true, timestamps chronologically', () => {
    expect(compareCellValues(mrr, null, '5')).toBeLessThan(0);
    const flag = spec({ name: 'ok', label: 'OK', logicalType: 'boolean' });
    expect(compareCellValues(flag, false, true)).toBeLessThan(0);
    const at = spec({ name: 'at', label: 'At', logicalType: 'timestamptz' });
    expect(compareCellValues(at, '2026-01-02T00:00:00Z', '2026-01-10T00:00:00Z')).toBeLessThan(0);
  });

  it('integer logicalType counts as numeric even without semantics', () => {
    expect(isNumericColumn(spec({ name: 'seats', label: 'Seats', logicalType: 'integer' }))).toBe(true);
    expect(isNumericColumn(spec({ name: 'name', label: 'Name', logicalType: 'varchar' }))).toBe(false);
  });
});

describe('formatMoney / formatRelativeTime', () => {
  it('formats currency from string amounts', () => {
    expect(formatMoney('4820', { currency: 'USD' })).toBe('$4,820');
    expect(formatMoney(12.5, { currency: 'EUR' })).toBe('€12.50');
  });
  it('falls back to the raw value for non-numbers', () => {
    expect(formatMoney('n/a')).toBe('n/a');
  });
  it('renders relative time', () => {
    const now = Date.UTC(2026, 5, 1, 12, 0, 0);
    expect(formatRelativeTime('2026-06-01T09:00:00Z', { now })).toMatch(/3\s?hr?\.? ago/i);
  });
});

describe('row identity helpers', () => {
  const columns = [
    spec({ name: 'id', label: 'ID', primaryKey: true }),
    spec({ name: 'name', label: 'Name', isDisplay: true }),
  ];
  it('rowIdOf uses the PK; composite PKs serialize as JSON tuples', () => {
    expect(rowIdOf(columns, { id: 7, name: 'Acme' })).toBe('7');
    const composite = [
      spec({ name: 'a', label: 'A', primaryKey: true }),
      spec({ name: 'b', label: 'B', primaryKey: true }),
    ];
    expect(rowIdOf(composite, { a: 1, b: 'x' })).toBe('[1,"x"]');
  });
  it('displayValueOf prefers the display column, falls back to the PK', () => {
    expect(displayValueOf(columns, { id: 7, name: 'Acme' })).toBe('Acme');
    expect(displayValueOf(columns, { id: 7, name: '' })).toBe('7');
  });
  it('maskedColumnsOf reads the server _masked marker', () => {
    expect(maskedColumnsOf({ phone: null, _masked: ['phone'] })).toEqual(['phone']);
    expect(maskedColumnsOf({ phone: '+1' })).toEqual([]);
  });
});
