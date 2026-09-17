// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The money law against the shared fixture: the same JSON table the server's
 * summary and, later, the add-on's renderer assert. A number that changes
 * here must change in the fixture, and the fixture is held byte-equal across
 * trees by `scripts/check-invoice-money- fixture.mjs` — so a law that drifts
 * in one tree goes red in CI, not in a customer's inbox.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { formatMoney, fxMinor, lineMinor, parseDecimal, parseMinor, taxBreakdown, totalsOf } from './money.js';

interface Fixture {
  cases: { name: string; items: { qty: string; rate: string }[]; discountRate: string; taxRate: string; expect: { lines: number[]; subtotal: number; discount: number; taxBase: number; tax: number; total: number } }[];
  breakdown: { taxBase: number; lines: { label: string; rate: string }[]; expect: number[] };
  fx: { totalMinor: number; rates: { rate: string; expect: number }[] };
  format: { minor: number; currency: string; cents: boolean; expect: string }[];
}

const fixture = JSON.parse(readFileSync(join(process.cwd(), 'src/invoices/model/money-fixture.json'), 'utf8')) as Fixture;

describe('the money law', () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      const totals = totalsOf({ items: c.items.map((item, i) => ({ id: String(i), desc: '', ...item })), discountRate: c.discountRate, taxRate: c.taxRate });
      expect(totals).toEqual(c.expect);
    });
  }

  it('tax-breakdown components use the ladder’s base', () => {
    expect(taxBreakdown(fixture.breakdown.taxBase, fixture.breakdown.lines).map((line) => line.amount)).toEqual(fixture.breakdown.expect);
  });

  it('multi-currency rows multiply the total by the typed rate', () => {
    for (const row of fixture.fx.rates) expect(fxMinor(fixture.fx.totalMinor, row.rate)).toBe(row.expect);
  });

  it('formats like the comp’s fmt (1332)', () => {
    for (const f of fixture.format) expect(formatMoney(f.minor, f.currency, f.cents)).toBe(f.expect);
  });

  it('parses decimal text exactly, never through a float', () => {
    expect(parseMinor('0.1')).toBe(10);
    expect(parseMinor('0.10')).toBe(10);
    expect(parseMinor('.5')).toBe(50);
    expect(parseMinor('1234')).toBe(123400);
    expect(parseMinor('-0.005')).toBe(-1);
    expect(parseMinor('')).toBe(0);
    expect(parseMinor('1,234.56')).toBe(0);
    expect(parseDecimal('24')).toBe(24);
    expect(parseDecimal('1.5')).toBe(1.5);
    expect(lineMinor({ qty: '2', rate: '0.1' })).toBe(20);
  });
});
