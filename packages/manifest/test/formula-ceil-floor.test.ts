// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `ceil` and `floor` in a formula: rounding up and down on the exact ratio,
 * beside `round`, with the same shape (`expr` or `[expr, places]`). Print's
 * sheets are `ceil(quantity / pieces per sheet)`.
 */
import { describe, expect, it } from 'vitest';

import { formulaIssues } from '../src/formula.js';
import { evaluateFormula, formulaColumns, formulaExprSchema, type FormulaExpr } from '../src/index.js';

const at = (expr: FormulaExpr, row: Record<string, unknown>, scale = 0) => evaluateFormula(expr, row, scale);

describe('ceil and floor', () => {
  it('round a whole-number result up and down', () => {
    const row = { qty: 101, per_sheet: 100 };
    expect(at({ ceil: { div: ['qty', 'per_sheet'] } }, row)).toBe('2');
    expect(at({ floor: { div: ['qty', 'per_sheet'] } }, row)).toBe('1');
    // Exactly on a whole number: nothing to round.
    expect(at({ ceil: { div: [200, 'per_sheet'] } }, row)).toBe('2');
    expect(at({ floor: { div: [200, 'per_sheet'] } }, row)).toBe('2');
  });

  it('go towards plus and minus infinity for a negative number, not towards zero', () => {
    expect(at({ ceil: 'n' }, { n: '-1.5' })).toBe('-1');
    expect(at({ floor: 'n' }, { n: '-1.5' })).toBe('-2');
    expect(at({ ceil: 'n' }, { n: '-0.2' })).toBe('0');
    expect(at({ floor: 'n' }, { n: '0.2' })).toBe('0');
    expect(at({ ceil: 'n' }, { n: '1.5' })).toBe('2');
    expect(at({ floor: 'n' }, { n: '1.5' })).toBe('1');
    // Round half away from zero gives a third answer, so the three really differ.
    expect(at({ round: 'n' }, { n: '-1.5' })).toBe('-2');
    expect(at({ round: 'n' }, { n: '-1.4' })).toBe('-1');
  });

  it('leave a value already at the scale as it is (2.000 is 2)', () => {
    expect(at({ ceil: 'n' }, { n: '2.000' })).toBe('2');
    expect(at({ floor: 'n' }, { n: '2.000' })).toBe('2');
    expect(at({ ceil: 'n' }, { n: '-2.000' })).toBe('-2');
    expect(at({ ceil: ['n', 2] }, { n: '1.2500' }, 2)).toBe('1.25');
  });

  it('round to the places given, on the exact ratio (1/3 is not 0.3333…)', () => {
    expect(at({ ceil: [{ div: [1, 3] }, 2] }, {}, 2)).toBe('0.34');
    expect(at({ floor: [{ div: [2, 3] }, 2] }, {}, 2)).toBe('0.66');
    expect(at({ floor: [{ div: [-1, 3] }, 2] }, {}, 2)).toBe('-0.34');
    expect(at({ ceil: [{ div: [-2, 3] }, 4] }, {}, 4)).toBe('-0.6666');
    // Places 0 inside a scale-2 column: a whole number written with two places.
    expect(at({ ceil: [{ div: ['a', 'b'] }, 0] }, { a: 7, b: 2 }, 2)).toBe('4.00');
    // No places: the column's own scale.
    expect(at({ floor: { div: ['a', 'b'] } }, { a: 7, b: 3 }, 2)).toBe('2.33');
    expect(at({ ceil: { div: ['a', 'b'] } }, { a: 7, b: 3 }, 2)).toBe('2.34');
  });

  it('are empty when what they read is empty, as round is', () => {
    expect(at({ ceil: { div: ['qty', 'per_sheet'] } }, { qty: 5, per_sheet: null })).toBeNull();
    expect(at({ floor: { div: ['qty', 'per_sheet'] } }, { qty: 5, per_sheet: 0 })).toBeNull();
  });

  it('read every driver spelling the same (a decimal string, a number, a bigint)', () => {
    expect(at({ ceil: { div: ['qty', 'per_sheet'] } }, { qty: '250.0000', per_sheet: 24n })).toBe('11');
    expect(at({ ceil: { div: ['qty', 'per_sheet'] } }, { qty: 250, per_sheet: '24' })).toBe('11');
  });

  it('take the same shape as round: an expression, or an expression and 0–4 places', () => {
    expect(formulaExprSchema.safeParse({ ceil: 'qty' }).success).toBe(true);
    expect(formulaExprSchema.safeParse({ floor: ['qty', 4] }).success).toBe(true);
    expect(formulaExprSchema.safeParse({ ceil: ['qty', 5] }).success).toBe(false);
    expect(formulaExprSchema.safeParse({ floor: ['qty', -1] }).success).toBe(false);
    expect(formulaExprSchema.safeParse({ floor: ['qty', 1.5] }).success).toBe(false);
    expect(formulaExprSchema.safeParse({ ceil: 'qty', extra: 1 }).success).toBe(false);
  });

  it('are walked like any operator: their columns are read, counted with, and nest in the depth cap', () => {
    expect(formulaColumns({ ceil: [{ div: ['qty', 'per_sheet'] }, 0] })).toEqual(['qty', 'per_sheet']);
    const column = (ref: string) =>
      ref === 'label' ? { type: 'text' as const } : ref === 'qty' || ref === 'per_sheet' ? { type: 'int' as const } : undefined;
    expect(formulaIssues({ floor: 'label' }, 'sheets', column as never)).toContain(
      '"label" is not a number, so a formula cannot count with it',
    );
    expect(formulaIssues({ ceil: 'nope' }, 'sheets', column as never)).toContain('the table has no column "nope"');
    // Eight deep is the cap: a ceil at the eighth level is fine, a ninth is not.
    let deep: FormulaExpr = 'qty';
    for (let i = 0; i < 8; i += 1) deep = { ceil: deep };
    expect(formulaIssues(deep, 'sheets', column as never)).toEqual([]);
    expect(formulaIssues({ floor: deep }, 'sheets', column as never)).toContain('a formula nests at most 8 deep');
  });
});
