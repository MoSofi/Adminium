// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import {
  evaluateDerivedFields,
  parseCrudDerived,
  type DerivedField,
} from '../src/page-config/index.js';

/**
 * The derived-field evaluator (36-derived-columns.md §3.5).
 *
 * Two things are being tested and only one of them is arithmetic. The other is
 * the three-state lattice — value / absent / refused — which is the whole of
 * the security argument: a refused operand must poison every node above it
 * INCLUDING a comparison, because a conditional evaluated over an unreadable
 * input leaks one bit per row (D11).
 */

/** The plan's worked example: subtotal -> discount -> tax -> total -> shipping. */
const FIELDS: DerivedField[] = (() => {
  const parsed = parseCrudDerived({
    measures: [
      {
        id: 'subtotal',
        table: 'public.invoice_items',
        fkColumn: 'invoice_id',
        fn: 'sum',
        of: { terms: [{ sign: 'plus', factors: ['line_total'] }] },
      },
      {
        id: 'gross',
        table: 'public.invoice_items',
        fkColumn: 'invoice_id',
        fn: 'sum',
        of: { terms: [{ sign: 'plus', factors: ['qty', 'rate'] }] },
      },
    ],
    fields: [
      {
        id: 'discount_total',
        scale: 2,
        expr: { op: 'sub', args: [{ measure: 'gross' }, { measure: 'subtotal' }] },
      },
      {
        id: 'tax_amount',
        scale: 2,
        expr: {
          op: 'mul',
          args: [
            { measure: 'subtotal' },
            { op: 'div', args: [{ col: 'tax_rate' }, { lit: '100' }] },
          ],
        },
      },
      {
        id: 'total',
        scale: 2,
        expr: { op: 'add', args: [{ measure: 'subtotal' }, { field: 'tax_amount' }] },
      },
      {
        id: 'shipping',
        scale: 2,
        expr: {
          cases: [
            {
              when: { left: { field: 'total' }, cmp: 'gte', right: { lit: '500' } },
              then: { lit: '0' },
            },
          ],
          else: { lit: '12.50' },
        },
      },
    ],
  });
  if (!parsed.ok) throw new Error(parsed.refusal.code);
  return parsed.value.fields;
})();

/**
 * Invoice 7 of `rec30_outline` as it reaches this pass: the measures already
 * folded and normalized to canonical decimal strings by the server, the
 * parent's own `tax_rate` still a driver string.
 */
const INVOICE_7 = { subtotal: '1266.00', gross: '1300.0000', tax_rate: '8.00' };

describe('the owner five numbers, over a real row', () => {
  it('computes all four derived fields', () => {
    const { values, masked } = evaluateDerivedFields(FIELDS, { row: INVOICE_7 });
    expect(values).toEqual({
      discount_total: '34.00',
      tax_amount: '101.28',
      total: '1367.28',
      shipping: '0.00',
    });
    expect(masked).toEqual([]);
  });

  it('takes the else branch below the threshold', () => {
    const { values } = evaluateDerivedFields(FIELDS, {
      row: { subtotal: '120.00', gross: '120.00', tax_rate: '8.00' },
    });
    expect(values['total']).toBe('129.60');
    expect(values['shipping']).toBe('12.50');
  });

  it('reads an empty fold as zero without turning it into an absence', () => {
    const { values, masked } = evaluateDerivedFields(FIELDS, {
      row: { subtotal: '0.00', gross: '0.00', tax_rate: '8.00' },
    });
    expect(values['total']).toBe('0.00');
    expect(values['shipping']).toBe('12.50');
    expect(masked).toEqual([]);
  });

  it('carries the UNROUNDED earlier field forward (D7)', () => {
    const fields: DerivedField[] = [
      { id: 'avg_rate', scale: 2, expr: { col: 'avg_rate' } },
      { id: 'tripled', scale: 2, expr: { op: 'mul', args: [{ field: 'avg_rate' }, { lit: '3' }] } },
    ];
    // avg(rate) as Postgres hands it back, at sixteen decimals.
    const { values } = evaluateDerivedFields(fields, { row: { avg_rate: '750.9545454545454545' } });
    expect(values['avg_rate']).toBe('750.95');
    // 750.954545 x 3, not 750.95 x 3 — reading the displayed value would give 2252.85.
    expect(values['tripled']).toBe('2252.86');
  });
});

describe('the lattice: value / absent / refused', () => {
  it('refuses every field downstream of a refused measure, and marks each one', () => {
    const { values, masked } = evaluateDerivedFields(FIELDS, {
      row: { subtotal: null, gross: null, tax_rate: '8.00' },
      masked: ['subtotal', 'gross'],
    });
    expect(values).toEqual({
      discount_total: null,
      tax_amount: null,
      total: null,
      shipping: null,
    });
    // Masked dots on all four — not a partial number, not a zero.
    expect(masked).toEqual(['discount_total', 'tax_amount', 'total', 'shipping']);
  });

  it('refuses through a masked base column, not only a masked measure', () => {
    const { values, masked } = evaluateDerivedFields(FIELDS, {
      row: { ...INVOICE_7, tax_rate: null },
      masked: ['tax_rate'],
    });
    expect(values['discount_total']).toBe('34.00');
    expect(values['tax_amount']).toBeNull();
    expect(values['total']).toBeNull();
    expect(masked).toEqual(['tax_amount', 'total', 'shipping']);
  });

  it('a cases predicate over a REFUSED operand refuses, it does not take a branch', () => {
    const fields: DerivedField[] = [
      {
        id: 'shipping',
        scale: 2,
        expr: {
          cases: [
            {
              when: { left: { measure: 'subtotal' }, cmp: 'gte', right: { lit: '500' } },
              then: { lit: '0' },
            },
          ],
          else: { lit: '12.50' },
        },
      },
    ];
    const { values, masked } = evaluateDerivedFields(fields, {
      row: { subtotal: null },
      masked: ['subtotal'],
    });
    // The `else` branch would have been a readable answer computed from an
    // unreadable input — one leaked bit per row.
    expect(values['shipping']).toBeNull();
    expect(masked).toEqual(['shipping']);
  });

  it('an ABSENT operand is not a refusal: it absorbs, and the predicate is simply not true', () => {
    const { values, masked } = evaluateDerivedFields(FIELDS, {
      row: { ...INVOICE_7, tax_rate: null },
    });
    expect(values['discount_total']).toBe('34.00');
    // em-dash, not masked dots
    expect(values['tax_amount']).toBeNull();
    expect(values['total']).toBeNull();
    expect(values['shipping']).toBe('12.50');
    expect(masked).toEqual([]);
  });

  it.each([
    ['a value', { subtotal: '600.00' }, [], '0.00', []],
    ['a value below the threshold', { subtotal: '400.00' }, [], '12.50', []],
    ['a missing key', {}, [], '12.50', []],
    ['an explicit null', { subtotal: null }, [], '12.50', []],
    ['an unreadable driver value', { subtotal: 'n/a' }, [], '12.50', []],
    ['a masked value', { subtotal: null }, ['subtotal'], null, ['shipping']],
  ])(
    'resolves %s',
    (_name, row, masked, expected: string | null, expectedMarkers: readonly string[]) => {
      const fields: DerivedField[] = [
        {
          id: 'shipping',
          scale: 2,
          expr: {
            cases: [
              {
                when: { left: { measure: 'subtotal' }, cmp: 'gte', right: { lit: '500' } },
                then: { lit: '0' },
              },
            ],
            else: { lit: '12.50' },
          },
        },
      ];
      const result = evaluateDerivedFields(fields, { row, masked });
      expect(result.values['shipping']).toBe(expected);
      expect(result.masked).toEqual(expectedMarkers);
    },
  );
});

describe('the comparison operators', () => {
  const compare = (cmp: 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq', left: string): string | null => {
    const fields: DerivedField[] = [
      {
        id: 'hit',
        scale: 0,
        expr: {
          cases: [{ when: { left: { col: 'x' }, cmp, right: { lit: '10' } }, then: { lit: '1' } }],
          else: { lit: '0' },
        },
      },
    ];
    return evaluateDerivedFields(fields, { row: { x: left } }).values['hit'] ?? null;
  };

  it.each([
    ['gt', '11', '1'],
    ['gt', '10', '0'],
    ['gte', '10', '1'],
    ['gte', '9', '0'],
    ['lt', '9', '1'],
    ['lt', '10', '0'],
    ['lte', '10', '1'],
    ['lte', '11', '0'],
    ['eq', '10', '1'],
    ['eq', '10.01', '0'],
    ['neq', '10.01', '1'],
    ['neq', '10', '0'],
  ] as const)('%s against %s is %s', (cmp, left, expected) => {
    expect(compare(cmp, left)).toBe(expected);
  });

  it('walks a multi-branch chain in order and falls through to else', () => {
    const fields: DerivedField[] = [
      {
        id: 'band',
        scale: 0,
        expr: {
          cases: [
            { when: { left: { col: 'x' }, cmp: 'gte', right: { lit: '100' } }, then: { lit: '3' } },
            { when: { left: { col: 'x' }, cmp: 'gte', right: { lit: '50' } }, then: { lit: '2' } },
            { when: { left: { col: 'x' }, cmp: 'gte', right: { lit: '10' } }, then: { lit: '1' } },
          ],
          else: { lit: '0' },
        },
      },
    ];
    const band = (x: string): string | null =>
      evaluateDerivedFields(fields, { row: { x } }).values['band'] ?? null;
    expect(band('120')).toBe('3');
    expect(band('60')).toBe('2');
    expect(band('10')).toBe('1');
    expect(band('9')).toBe('0');
  });
});

describe('arithmetic edges', () => {
  it('evaluates all four operators', () => {
    const fields: DerivedField[] = [
      { id: 'a', scale: 2, expr: { op: 'add', args: [{ col: 'x' }, { lit: '1.5' }] } },
      { id: 's', scale: 2, expr: { op: 'sub', args: [{ col: 'x' }, { lit: '1.5' }] } },
      { id: 'm', scale: 2, expr: { op: 'mul', args: [{ col: 'x' }, { lit: '3' }] } },
      { id: 'd', scale: 4, expr: { op: 'div', args: [{ col: 'x' }, { lit: '100' }] } },
    ];
    expect(evaluateDerivedFields(fields, { row: { x: '8' } }).values).toEqual({
      a: '9.50',
      s: '6.50',
      m: '24.00',
      d: '0.0800',
    });
  });

  it('reads a JS number, which is what SQLite hands back', () => {
    const fields: DerivedField[] = [
      { id: 'doubled', scale: 2, expr: { op: 'mul', args: [{ col: 'x' }, { lit: '2' }] } },
    ];
    expect(evaluateDerivedFields(fields, { row: { x: 12.5 } }).values['doubled']).toBe('25.00');
  });

  it('answers a field that names nothing at all as absent rather than throwing', () => {
    // Unreachable from a parsed spec; a live read path must blank a cell, not
    // fail a page.
    const fields: DerivedField[] = [{ id: 'x', scale: 2, expr: { field: 'ghost' } }];
    expect(evaluateDerivedFields(fields, { row: {} })).toEqual({
      values: { x: null },
      masked: [],
    });
  });
});
