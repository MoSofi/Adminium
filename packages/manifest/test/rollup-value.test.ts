// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A total over rows added up exactly: what SQLite, adding decimals as floats,
 * gets wrong at a half cent, and what a price a guest was shown is compared
 * with.
 */
import { describe, expect, it } from 'vitest';

import { rollupValue, sameDecimal } from '../src/index.js';

describe('a total over rows, exactly', () => {
  it('adds quantity times rate as fractions and rounds once: 1.500 × 0.33 is 0.50', () => {
    expect(rollupValue([{ qty: 1.5, rate: 0.33 }], { sum: 'qty', times: 'rate' }, 2)).toBe('0.50');
    expect(rollupValue([{ qty: '1.500', rate: '0.3300' }], { sum: 'qty', times: 'rate' }, 2)).toBe('0.50');
  });

  it('leaves an empty or unreadable value out, as SQL does, and answers zero for none', () => {
    expect(rollupValue([{ amount: '10.10' }, { amount: null }, { amount: 'x' }, { amount: 5 }], { sum: 'amount' }, 2)).toBe('15.10');
    expect(rollupValue([], { sum: 'amount' }, 2)).toBe('0.00');
    expect(rollupValue([{ qty: 2, rate: null }], { sum: 'qty', times: 'rate' }, 2)).toBe('0.00');
  });

  it('counts rows, and keeps a currency without decimals whole', () => {
    expect(rollupValue([{}, {}, {}], { count: true }, 0)).toBe('3');
    expect(rollupValue([{ amount: '1234.5' }], { sum: 'amount' }, 0)).toBe('1235');
    expect(rollupValue([{ amount: '-0.005' }], { sum: 'amount' }, 2)).toBe('-0.01');
  });
});

describe('two decimals compared at a scale', () => {
  it('reads text and numbers alike, and tells different prices apart', () => {
    expect(sameDecimal('90.00', 90, 2)).toBe(true);
    expect(sameDecimal('67.12', '67.120', 2)).toBe(true);
    expect(sameDecimal('81.00', '90.00', 2)).toBe(false);
    expect(sameDecimal(null, null, 2)).toBe(true);
    expect(sameDecimal(null, '0.00', 2)).toBe(false);
  });
});
