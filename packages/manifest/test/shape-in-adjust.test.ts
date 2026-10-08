// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a shape's part says of its rows to a price rule on the same table:
 * one word, naming a column of the part.
 */
import { describe, expect, it } from 'vitest';

import { shapePartSchema } from '../src/index.js';

const columns = [
  { ref: 'id', type: 'int', role: 'pk' },
  { ref: 'gift_card_id', type: 'int', nullable: true },
];
const issues = (inAdjust: unknown): string[] => {
  const parsed = shapePartSchema.safeParse({ columns, inAdjust });
  return parsed.success ? [] : parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
};

describe('a part\'s inAdjust', () => {
  it('takes excludes or paidBy, naming a column of the part', () => {
    expect(issues({ excludes: 'gift_card_id' })).toEqual([]);
    expect(issues({ paidBy: 'gift_card_id' })).toEqual([]);
    expect(shapePartSchema.safeParse({ columns }).success).toBe(true);
  });

  it('refuses a column the part does not have', () => {
    expect(issues({ excludes: 'card' })).toEqual(['inAdjust.excludes: "card" is not a column of this part']);
  });

  it('refuses both words at once, no word, and any other', () => {
    expect(issues({ excludes: 'gift_card_id', paidBy: 'gift_card_id' })).not.toEqual([]);
    expect(issues({})).not.toEqual([]);
    expect(issues({ skips: 'gift_card_id' })).not.toEqual([]);
  });
});
