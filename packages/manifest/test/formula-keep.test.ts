// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a formula column keeps of the value worked out: its `normalize` rule,
 * then, for a join, its longest. The server stores a formula's value through
 * this same evaluator, so an app's demo that passes the column's
 * `formulaKeepOf` shows the value the server would store: a sample request's
 * `address_key` is `SL71BT12QUAYSTREET` however the address is typed.
 */
import { describe, expect, it } from 'vitest';

import { evaluateFormula, formulaKeepOf, normalizedText, type FormulaExpr } from '../src/index.js';

const address: FormulaExpr = { join: ['postcode', 'address_line1'] };

describe('normalizedText', () => {
  it('keeps a value as each rule says', () => {
    expect(normalizedText('code', ' sl7-1bt 12 quay  street ')).toBe('SL71BT12QUAYSTREET');
    expect(normalizedText('email', '  Orders@HarbourBakery.Example ')).toBe('orders@harbourbakery.example');
    expect(normalizedText('trim', '  Quay Street  ')).toBe('Quay Street');
    // A dot, a plus and an accent are part of what is kept: no folding beyond case.
    expect(normalizedText('email', 'Ana.B+news@Café.example')).toBe('ana.b+news@café.example');
    expect(normalizedText('code', 'br_2291')).toBe('BR_2291');
  });
});

describe('a formula column kept as its rules say', () => {
  it('works a join out as a code: the same address typed another way is the same key', () => {
    const keep = formulaKeepOf({ maxLength: 160, rules: { formula: address, normalize: 'code' } });
    expect(keep).toEqual({ normalize: 'code', maxLength: 160 });
    expect(evaluateFormula(address, { postcode: 'SL7 1BT', address_line1: '12 Quay Street' }, 0, keep)).toBe('SL71BT12QUAYSTREET');
    expect(evaluateFormula(address, { postcode: 'sl7-1bt', address_line1: '12 quay  street' }, 0, keep)).toBe('SL71BT12QUAYSTREET');
  });

  it('keeps a join as worked out when the column has no rule', () => {
    expect(evaluateFormula(address, { postcode: 'SL7 1BT', address_line1: '12 Quay Street' }, 0)).toBe('SL7 1BT12 Quay Street');
    expect(formulaKeepOf({ rules: { formula: address } })).toEqual({});
  });

  it('normalises, then cuts to the shorter of the column and its validation, a cut never ending in a space', () => {
    const keep = formulaKeepOf({ maxLength: 12, rules: { formula: address, normalize: 'code', validation: { maxLength: 10 } } });
    expect(keep).toEqual({ normalize: 'code', maxLength: 10 });
    // Normalised first: the spaces go before the cut, so more of the address fits.
    expect(evaluateFormula(address, { postcode: 'SL7 1BT', address_line1: '12 Quay Street' }, 0, keep)).toBe('SL71BT12QU');
    const name: FormulaExpr = { join: ['first', ' ', 'last'] };
    expect(evaluateFormula(name, { first: 'Mia', last: 'Lindqvist' }, 0, formulaKeepOf({ maxLength: 4, rules: { formula: name } }))).toBe('Mia');
  });

  it('keeps an email join in lower case', () => {
    const contact: FormulaExpr = { join: ['mailbox', '@', 'domain'] };
    const keep = formulaKeepOf({ maxLength: 190, rules: { formula: contact, normalize: 'email' } });
    expect(evaluateFormula(contact, { mailbox: 'Orders', domain: 'HarbourBakery.example' }, 0, keep)).toBe('orders@harbourbakery.example');
  });

  it('leaves an empty join empty, and cuts no number', () => {
    const keep = formulaKeepOf({ maxLength: 160, rules: { formula: address, normalize: 'code' } });
    expect(evaluateFormula(address, { postcode: null, address_line1: '' }, 0, keep)).toBeNull();
    // Only a join is cut: a sum is never shortened to a column's length.
    expect(formulaKeepOf({ maxLength: 2, rules: { formula: { add: ['a', 'b'] } } })).toEqual({});
    expect(evaluateFormula({ add: ['a', 'b'] }, { a: 100, b: 23 }, 2, { maxLength: 2 })).toBe('123.00');
  });
});
