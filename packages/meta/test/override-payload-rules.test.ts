// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The rule payloads the store keeps for a count, a copy that follows its row
 * and a price by the night: every key given comes back, and a total that both
 * adds and counts is refused.
 */
import { describe, expect, it } from 'vitest';

import { validateOverrideInput } from '../src/repos/overrides.js';

const base = { connectionId: 'conn_1', tableName: 'main.stays', columnName: 'room_total', origin: 'app' as const };

describe('rule payloads', () => {
  it('keep a price by the night whole', () => {
    const value = {
      from: 'arrive',
      to: 'depart',
      rate: { via: 'room_type_id', column: 'base_rate' },
      adjust: { table: 'main.rate_rules', match: { via: 'room_type_id', weekdays: 'weekdays', from: 'from_date', to: 'to_date' }, add: 'amount', name: 'name', where: { column: 'active', eq: true } },
    };
    expect(validateOverrideInput({ ...base, op: 'column.perNight', value })).toEqual({ op: 'column.perNight', value });
    expect(() => validateOverrideInput({ ...base, op: 'column.perNight', columnName: null, value })).toThrow();
  });

  it('keep a count, and refuse a total that both adds and counts', () => {
    const value = { from: 'main.stay_extras', via: 'stay_id', count: true as const };
    expect(validateOverrideInput({ ...base, op: 'column.rollup', value })).toEqual({ op: 'column.rollup', value });
    expect(() => validateOverrideInput({ ...base, op: 'column.rollup', value: { ...value, sum: 'amount' } })).toThrow();
    expect(() => validateOverrideInput({ ...base, op: 'column.rollup', value: { from: 'main.stay_extras', via: 'stay_id' } })).toThrow();
  });

  it('keep a copy that follows its row', () => {
    const value = { via: 'stay_id', from: 'nights', mode: 'always' as const, follow: true as const };
    expect(validateOverrideInput({ ...base, op: 'column.copy', value })).toEqual({ op: 'column.copy', value });
  });
});
