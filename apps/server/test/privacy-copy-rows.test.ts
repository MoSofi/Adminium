// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The same phone number written two ways: the digits, a leading 0 or a
 * country code aside, and never a number that only shares a few digits.
 */
import { describe, expect, it } from 'vitest';

import { phoneDigits, samePhone } from '../src/privacy/copy-rows.js';

const same = (a: string, b: string) => samePhone(phoneDigits(a)!, phoneDigits(b)!);

describe('a phone number, as an erasure matches it', () => {
  it('reads the digits without the leading zeros, and nothing too short to be a number', () => {
    expect(phoneDigits('+44 (0)7700 900-123')).toBe('4407700900123');
    expect(phoneDigits('07700 900123')).toBe('7700900123');
    expect(phoneDigits(7700900123)).toBe('7700900123');
    for (const none of ['123 456', '', '   ', 'n/a', null, undefined, {}]) expect(phoneDigits(none)).toBeNull();
  });

  it('takes a number written with a leading 0 or a country code as the same', () => {
    expect(same('07700 900123', '+44 7700 900123')).toBe(true);
    expect(same('+447700900123', '07700900123')).toBe(true);
    expect(same('(212) 555-0142', '+1 212 555 0142')).toBe(true);
    expect(same('020 7946 0001', '+44 20 7946 0001')).toBe(true);
  });

  it('never takes two numbers that share fewer than eight digits at the end', () => {
    expect(same('+48 900 123', '07700 900123')).toBe(false);
    expect(same('07700 900124', '07700 900123')).toBe(false);
    expect(samePhone('9460001', '442079460001')).toBe(false);
  });
});
