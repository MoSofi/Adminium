// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The totals block's arithmetic.
 *
 * Every claim here is about money, so every one of them is about a rounding
 * rule somebody can be wrong by a cent on.
 */
import { describe, expect, it } from 'vitest';

import { computeTotals } from '../src/page-config/child-totals.js';

/** qty × unit — the comp's own line total (297–305). */
const ROW = { expr: { op: 'mul', args: [{ col: 'qty' }, { col: 'unit' }] } };

const BLOCK = {
  row: ROW,
  rows: [
    { label: 'Subtotal', of: 'sum' as const },
    { label: 'Tax', of: 'rate' as const, rate: '0.085' },
    { label: 'Total', of: 'total' as const },
  ],
};

describe('what a list of lines adds up to', () => {
  it('totals each line and then the lines', () => {
    const out = computeTotals(BLOCK, [
      { qty: '2', unit: '10.00' },
      { qty: '1', unit: '5.50' },
    ]);
    expect(out.lines).toEqual(['20.00', '5.50']);
    expect(out.rows.map((row) => `${row.label} ${row.value}`)).toEqual([
      'Subtotal 25.50',
      'Tax 2.17',
      'Total 27.67',
    ]);
  });

  it('takes a rate off the SUBTOTAL, never off the running total', () => {
    const twoRates = computeTotals(
      {
        row: ROW,
        rows: [
          { label: 'Subtotal', of: 'sum' },
          { label: 'Tax', of: 'rate', rate: '0.10' },
          { label: 'Levy', of: 'rate', rate: '0.10' },
          { label: 'Total', of: 'total' },
        ],
      },
      [{ qty: '1', unit: '100' }],
    );
    // 10 and 10, not 10 and 11: a tax on a tax is a different number and
    // nobody asked for one.
    expect(twoRates.rows.map((row) => row.value)).toEqual(['100.00', '10.00', '10.00', '120.00']);
  });

  it('rounds at the END, not at every line', () => {
    // Three lines of 0.005 are 0.015 — one and a half cents. Rounding each
    // line first gives 0.03; rounding the sum gives 0.02 (banker's-free
    // half-up on the total, which is the arithmetic the money law uses).
    const out = computeTotals(
      { row: ROW, rows: [{ label: 'Subtotal', of: 'sum' }] },
      [
        { qty: '1', unit: '0.005' },
        { qty: '1', unit: '0.005' },
        { qty: '1', unit: '0.005' },
      ],
    );
    expect(out.rows[0]?.value).toBe('0.02');
  });

  it('reads an unparseable line as nothing rather than throwing', () => {
    // A half-typed quantity is a normal state of a form, not an error state.
    const out = computeTotals(BLOCK, [{ qty: '', unit: '10' }, { qty: '2', unit: '10' }]);
    expect(out.lines[0]).toBe('0.00');
    expect(out.rows[0]?.value).toBe('20.00');
  });

  it('answers zeroes for no lines at all', () => {
    const out = computeTotals(BLOCK, []);
    expect(out.lines).toEqual([]);
    expect(out.rows.map((row) => row.value)).toEqual(['0.00', '0.00', '0.00']);
  });

  it('honours the declared scale', () => {
    const out = computeTotals(
      { row: ROW, scale: 4, rows: [{ label: 'Subtotal', of: 'sum' }] },
      [{ qty: '3', unit: '0.3333' }],
    );
    expect(out.rows[0]?.value).toBe('0.9999');
  });

  it('marks the total row, and only it, as the emphasised one', () => {
    const out = computeTotals(BLOCK, [{ qty: '1', unit: '1' }]);
    expect(out.rows.map((row) => row.emphasis)).toEqual([false, false, true]);
  });
});
