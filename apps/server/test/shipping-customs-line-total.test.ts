// SPDX-License-Identifier: AGPL-3.0-only
/** One unit's declared value, worked out of a line priced as a whole: exact, and never a value too small to state. */
import { describe, expect, it } from 'vitest';

import { unitValueOf } from '../src/shipping/customs.js';

describe('a line priced as a whole', () => {
  it('gives one unit\'s value, exact to six places', () => {
    expect(unitValueOf('33.33', 250)).toBe('0.13332');
    expect(unitValueOf(100, 3)).toBe('33.333333');
    expect(unitValueOf('200.00', 3)).toBe('66.666667');
    expect(unitValueOf('50.00', 10)).toBe('5');
    expect(unitValueOf('10.5', 1)).toBe('10.5');
    expect(unitValueOf('0.01', 10000)).toBe('0.000001');
  });

  it('states no value it cannot state', () => {
    expect(unitValueOf('0.01', 30000)).toBeNull();
    expect(unitValueOf('0.00', 5)).toBeNull();
    expect(unitValueOf('0.0000001', 5)).toBeNull();
    expect(unitValueOf('9.99', null)).toBeNull();
  });
});
