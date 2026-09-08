// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import {
  WORKING_SCALE,
  addDecimal,
  compareDecimal,
  divDecimal,
  formatDecimal,
  mulDecimal,
  parseDecimal,
  roundDecimal,
  subDecimal,
} from '../src/page-config/index.js';

/**
 * The money law for derived columns (36-derived-columns.md D7).
 *
 * The operands below are REAL DRIVER STRINGS, read from the `rec30_outline`
 * Postgres on 2026-09-03 — `'10036.50'` is `sum(line_total)` over the whole
 * table, `'750.9545454545454545'` is `avg(rate)` at sixteen decimals, and
 * `'34.00000000000000000000'` is the discount fold at twenty. Testing against
 * hand-typed literals would prove the arithmetic and miss the thing that
 * actually breaks: what a driver hands back.
 */

/** Postgres, `select sum(line_total) from invoice_items` — the whole table. */
const ALL_LINE_TOTALS = '10036.50';
/** Postgres, `select avg(rate) from invoice_items` — sixteen decimals. */
const AVG_RATE = '750.9545454545454545';
/** Postgres, invoice 7's `sum(qty*rate*discount_pct/100)` — twenty decimals. */
const DISCOUNT_20DP = '34.00000000000000000000';
/** Invoice 7: `sum(line_total)`, `sum(qty*rate)`, and the parent's `tax_rate`. */
const INV7_SUBTOTAL = '1266.00';
const INV7_GROSS = '1300.0000';
const INV7_TAX_RATE = '8.00';

function decimal(input: string): bigint {
  const parsed = parseDecimal(input);
  if (parsed === null) throw new Error(`unreadable: ${input}`);
  return parsed;
}

describe('the working representation', () => {
  it('carries six digits', () => {
    expect(WORKING_SCALE).toBe(6);
  });

  it('reads a driver string exactly', () => {
    expect(formatDecimal(decimal(INV7_SUBTOTAL), 2)).toBe('1266.00');
    expect(formatDecimal(decimal(INV7_GROSS), 4)).toBe('1300.0000');
    expect(formatDecimal(decimal(ALL_LINE_TOTALS), 2)).toBe('10036.50');
  });

  it('rounds a longer driver string to the working width ONCE, on entry', () => {
    // 750.954545|4545454545 — digit seven is a 4, so it rounds down.
    expect(formatDecimal(decimal(AVG_RATE))).toBe('750.954545');
    expect(formatDecimal(decimal(DISCOUNT_20DP))).toBe('34.000000');
  });

  it('is exact where the JS number path is not', () => {
    // Measured: Intl.NumberFormat on this string is exact; on Number(string)
    // it renders …800.00. A decimal string is the carrier, not a workaround.
    expect(formatDecimal(decimal('1234567890123456789.55'), 2)).toBe('1234567890123456789.55');
  });

  it('reads exponent form, because SQLite hands back JS numbers', () => {
    expect(formatDecimal(decimal('1e3'), 2)).toBe('1000.00');
    expect(formatDecimal(decimal('1.5e-3'), 6)).toBe('0.001500');
    expect(formatDecimal(parseDecimal(1234.5) ?? 0n, 2)).toBe('1234.50');
    expect(formatDecimal(parseDecimal(11n) ?? 0n, 0)).toBe('11');
  });

  it('answers null for what it cannot read, rather than guessing zero', () => {
    expect(parseDecimal(null)).toBeNull();
    expect(parseDecimal(undefined)).toBeNull();
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal('  ')).toBeNull();
    expect(parseDecimal('draft')).toBeNull();
    expect(parseDecimal('12,50')).toBeNull();
    expect(parseDecimal(Number.NaN)).toBeNull();
    expect(parseDecimal(Number.POSITIVE_INFINITY)).toBeNull();
    expect(parseDecimal(true)).toBeNull();
    expect(parseDecimal({})).toBeNull();
    // Wider than any money value, and a guard on the work a per-row parse does.
    expect(parseDecimal('1e1000')).toBeNull();
    expect(parseDecimal(`${'9'.repeat(61)}`)).toBeNull();
    expect(parseDecimal('1e999999999999999999999')).toBeNull();
    // Smaller than the working width can hold: zero, not null — it IS a number.
    expect(formatDecimal(decimal('1e-40'))).toBe('0.000000');
  });
});

describe('rounding is half-up away from zero, on output only', () => {
  it.each([
    ['0.005', 2, '0.01'],
    ['-0.005', 2, '-0.01'],
    ['0.004', 2, '0.00'],
    ['-0.004', 2, '0.00'],
    ['2.5', 0, '3'],
    ['-2.5', 0, '-3'],
    ['1.5', 0, '2'],
  ])('formats %s at scale %i as %s', (input, scale, expected) => {
    expect(formatDecimal(decimal(input), scale)).toBe(expected);
  });

  it('never renders negative zero', () => {
    expect(formatDecimal(decimal('-0.0001'), 2)).toBe('0.00');
  });

  it('pads to exactly the requested width', () => {
    // The alternative — `Number.isInteger(x) ? 0 : 2` — is how one money
    // column renders `$1,234` directly above `$1,234.50`.
    expect(formatDecimal(decimal('1234'), 2)).toBe('1234.00');
    expect(formatDecimal(decimal('1234.5'), 2)).toBe('1234.50');
  });
});

describe('the four numbers the owner asked for, on invoice 7', () => {
  const subtotal = decimal(INV7_SUBTOTAL);
  const gross = decimal(INV7_GROSS);
  const taxRate = decimal(INV7_TAX_RATE);
  const hundred = decimal('100');

  it('1 + 4: the discount total is the gross fold minus the net fold', () => {
    const discount = subDecimal(gross, subtotal);
    expect(formatDecimal(discount, 2)).toBe('34.00');
    // The other formula the same invoice supports — `sum(qty*rate*d/100)` —
    // agrees here to the cent. It is a DIFFERENT number in general (a stored
    // `line_total` rounds per line), which is why the plan refuses to claim
    // the two are interchangeable; on this row they coincide.
    expect(formatDecimal(decimal(DISCOUNT_20DP), 2)).toBe('34.00');
  });

  it('2: tax is a child-scope fold times a parent-scope column', () => {
    const taxAmount = mulDecimal(subtotal, divDecimal(taxRate, hundred) ?? 0n);
    expect(formatDecimal(taxAmount, 2)).toBe('101.28');
  });

  it('2 (continued): the total reads the UNROUNDED tax, not its display value', () => {
    const taxAmount = mulDecimal(subtotal, divDecimal(taxRate, hundred) ?? 0n);
    expect(formatDecimal(addDecimal(subtotal, taxAmount), 2)).toBe('1367.28');
  });

  it('5: the conditional picks a branch from the total', () => {
    const taxAmount = mulDecimal(subtotal, divDecimal(taxRate, hundred) ?? 0n);
    const total = addDecimal(subtotal, taxAmount);
    const shipping = compareDecimal(total, decimal('500')) >= 0 ? decimal('0') : decimal('12.50');
    expect(formatDecimal(shipping, 2)).toBe('0.00');
    const smallOrder = decimal('120.00');
    const smallShipping =
      compareDecimal(smallOrder, decimal('500')) >= 0 ? decimal('0') : decimal('12.50');
    expect(formatDecimal(smallShipping, 2)).toBe('12.50');
  });

  it('the same chain over the whole table', () => {
    const all = decimal(ALL_LINE_TOTALS);
    const tax = mulDecimal(all, divDecimal(taxRate, hundred) ?? 0n);
    expect(formatDecimal(tax, 2)).toBe('802.92');
    expect(formatDecimal(addDecimal(all, tax), 2)).toBe('10839.42');
  });
});

describe('carrying the unrounded value forward is the whole of D7', () => {
  it('rounding once and rounding twice give different money', () => {
    const avgRate = decimal(AVG_RATE); // 750.954545 at the working width
    const three = decimal('3');

    // What the evaluator does: reference the working value, round on output.
    expect(formatDecimal(mulDecimal(avgRate, three), 2)).toBe('2252.86');
    // What "one terminal rounding" would have done if a `{field}` reference
    // read the DISPLAYED value of an earlier field declaring `scale: 2`.
    expect(formatDecimal(mulDecimal(roundDecimal(avgRate, 2), three), 2)).toBe('2252.85');
  });

  it('roundDecimal quantizes without leaving the working representation', () => {
    expect(formatDecimal(roundDecimal(decimal('1.005'), 2))).toBe('1.010000');
  });
});

describe('the operations', () => {
  it('adds and subtracts exactly', () => {
    expect(formatDecimal(addDecimal(decimal('0.1'), decimal('0.2')), 6)).toBe('0.300000');
    expect(formatDecimal(subDecimal(decimal('1300.0000'), decimal('1266.00')), 4)).toBe('34.0000');
  });

  it('multiplies at working precision, rounding the excess digits once', () => {
    expect(formatDecimal(mulDecimal(decimal('0.000001'), decimal('0.5')), 6)).toBe('0.000001');
    expect(formatDecimal(mulDecimal(decimal('0.000001'), decimal('0.4')), 6)).toBe('0.000000');
    expect(formatDecimal(mulDecimal(decimal('-1.5'), decimal('2')), 2)).toBe('-3.00');
  });

  it('divides, and answers null for a zero divisor rather than throwing', () => {
    expect(formatDecimal(divDecimal(decimal('8.00'), decimal('100')) ?? 0n, 6)).toBe('0.080000');
    expect(formatDecimal(divDecimal(decimal('1'), decimal('3')) ?? 0n, 6)).toBe('0.333333');
    expect(formatDecimal(divDecimal(decimal('-1'), decimal('-4')) ?? 0n, 2)).toBe('0.25');
    expect(divDecimal(decimal('1'), decimal('0'))).toBeNull();
  });

  it('compares', () => {
    expect(compareDecimal(decimal('1367.28'), decimal('500'))).toBe(1);
    expect(compareDecimal(decimal('500'), decimal('500'))).toBe(0);
    expect(compareDecimal(decimal('-1'), decimal('0'))).toBe(-1);
  });
});
