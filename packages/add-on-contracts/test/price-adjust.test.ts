// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `price-adjust@1`: the shape of an answer, the check Adminium makes of it
 * against the question, and the conformance suite run against an adjuster
 * small enough to read.
 */
import { describe, expect, it } from 'vitest';

import { ADJUST_PUBLIC_REASONS, ADJUST_REASONS, adjustAnswerIssues, adjustOutputSchema, type AdjustInput, type AdjustLine, type AdjustOutput, type PriceAdjustProvider } from '../src/index.js';
import { priceAdjustConformance } from '../src/testing/index.js';

const line = (key: string, amount: string, over: Partial<AdjustLine> = {}): AdjustLine => ({
  key,
  part: 0,
  index: Number(key) - 1,
  price: amount,
  quantity: '1',
  amount,
  what: [{ as: 'item', table: 'shop:items', row: key }],
  excluded: false,
  paidBy: null,
  kept: true,
  ...over,
});

const input = (over: Partial<AdjustInput> = {}): AdjustInput => ({
  contract: 'price-adjust@1',
  mode: 'save',
  point: 'line',
  origin: 'public',
  now: '2026-09-27T10:00:00.000Z',
  today: '2026-09-27',
  weekday: 0,
  time: '10:00',
  zone: 'UTC',
  currency: 'USD',
  scale: 2,
  locale: 'en-US',
  lines: [line('1', '30.00'), line('2', '20.01'), line('3', '25.00', { excluded: true })],
  codes: [{ typed: 'TEN', kind: 'code', row: { id: 7, percent: 10 } }],
  customer: null,
  guest: true,
  staff: null,
  offers: { offers: [{ id: 7, percent: 10 }] },
  settings: {},
  explain: false,
  version: '1.0.0',
  ...over,
});

/** Ten percent off every line a found code allows, in whole cents, largest remainder the remainder to the last line; an unknown code is refused. */
const provider: PriceAdjustProvider = {
  adjust(call) {
    const found = call.codes.find((code) => code.row !== null);
    const open = call.lines.filter((each) => !each.excluded);
    const cents = (text: string) => Math.round(Number(text) * 100);
    const total = open.reduce((sum, each) => sum + cents(each.amount), 0);
    const off = found === undefined ? 0 : Math.floor(total / 10);
    let left = off;
    const lines = call.lines.map((each) => {
      if (each.excluded || found === undefined) return { key: each.key, discount: '0.00' };
      const share = each === open[open.length - 1] ? left : Math.floor((cents(each.amount) * off) / total);
      left -= share;
      return { key: each.key, discount: (share / 100).toFixed(2) };
    });
    return {
      lines,
      order: { discount: (off / 100).toFixed(2) },
      applied: found === undefined ? [] : open.map((each) => ({ line: each.key, offer: '7', code: '7', voucher: null, name: 'Ten off', kind: 'code' as const, amount: lines.find((l) => l.key === each.key)!.discount, typed: true })),
      uses: call.point === 'post' && found !== undefined ? [{ offer: '7', code: '7', voucher: null, amount: (off / 100).toFixed(2) }] : [],
      refused: call.codes.filter((code) => code.row === null).map((code) => ({ typed: code.typed, reason: 'unknown' as const })),
      ...(call.explain ? { explain: [{ offer: '7', applies: found !== undefined, ...(found === undefined ? { reason: 'no-code-typed' as const } : {}) }] } : {}),
    };
  },
};

describe('the shape of an answer', () => {
  it('takes one reduction a line, what was applied, uses and refusals', () => {
    expect(adjustOutputSchema.safeParse(provider.adjust(input())).success).toBe(true);
    expect(adjustOutputSchema.safeParse(provider.adjust(input({ point: 'post', explain: true }))).success).toBe(true);
  });

  it('refuses a negative amount, a number, an unknown reason and an unknown kind', () => {
    const good = provider.adjust(input());
    expect(adjustOutputSchema.safeParse({ ...good, order: { discount: '-1.00' } }).success).toBe(false);
    expect(adjustOutputSchema.safeParse({ ...good, order: { discount: 5 } }).success).toBe(false);
    expect(adjustOutputSchema.safeParse({ ...good, refused: [{ typed: 'X', reason: 'sold-out' }] }).success).toBe(false);
    expect(adjustOutputSchema.safeParse({ ...good, applied: [{ ...good.applied[0], kind: 'coupon' }] }).success).toBe(false);
    expect(adjustOutputSchema.safeParse({ ...good, extra: true }).success).toBe(false);
  });

  it('a guest is told five reasons by name, each one of the reasons there are', () => {
    expect(ADJUST_PUBLIC_REASONS).toEqual(['unknown', 'used-up', 'needs-minimum', 'not-for-these-items', 'needs-sign-in']);
    for (const reason of ADJUST_PUBLIC_REASONS) expect(ADJUST_REASONS).toContain(reason);
  });
});

describe('an answer against its question', () => {
  const answer = (over: Partial<AdjustOutput>, question = input()): string[] => adjustAnswerIssues(question, { ...provider.adjust(question), ...over });

  it('passes: every line once, the order their sum, an excluded line untouched', () => {
    expect(answer({})).toEqual([]);
    expect(provider.adjust(input()).order.discount).toBe('5.00');
    expect(provider.adjust(input()).lines).toEqual([
      { key: '1', discount: '2.99' },
      { key: '2', discount: '2.01' },
      { key: '3', discount: '0.00' },
    ]);
  });

  it('a line missing, invented or answered twice', () => {
    expect(answer({ lines: [{ key: '1', discount: '5.00' }] })).toEqual(['lines: the line "2" has no answer', 'lines: the line "3" has no answer']);
    expect(answer({ lines: [{ key: '1', discount: '3.00' }, { key: '2', discount: '2.00' }, { key: '3', discount: '0.00' }, { key: '9', discount: '0.00' }] })).toContain('lines.3: "9" is not a line of the question');
    expect(answer({ lines: [{ key: '1', discount: '3.00' }, { key: '1', discount: '2.00' }, { key: '2', discount: '0.00' }, { key: '3', discount: '0.00' }] })).toContain('lines.1: "1" is answered twice');
  });

  it('a reduction past its line, finer than the scale, or on an excluded line', () => {
    expect(answer({ lines: [{ key: '1', discount: '30.01' }, { key: '2', discount: '0.00' }, { key: '3', discount: '0.00' }], order: { discount: '30.01' } })).toEqual(["lines.0: a reduction of 30.01 is more than the line's 30.00"]);
    expect(answer({ lines: [{ key: '1', discount: '3.005' }, { key: '2', discount: '2.00' }, { key: '3', discount: '0.00' }] })).toContain('lines.0: "3.005" is finer than the order\'s 2 decimals');
    expect(answer({ lines: [{ key: '1', discount: '3.00' }, { key: '2', discount: '1.00' }, { key: '3', discount: '1.00' }] })).toEqual(['lines.2: "3" is excluded, so nothing reduces it']);
  });

  it('an order total that is not the lines\' sum', () => {
    expect(answer({ order: { discount: '5.01' } })).toEqual(["order.discount: 5.01 is not the sum of the lines' reductions"]);
  });

  it('uses where none are due, and reasons said to the wrong caller', () => {
    expect(answer({ uses: [{ offer: '7', code: null, voucher: null, amount: '5.00' }] })).toEqual(['uses: uses are reported only where the order is posted']);
    expect(answer({ refused: [{ typed: 'X', reason: 'over-ceiling' }] })).toEqual(['refused.0: "over-ceiling" is said of a reduction staff gave, and there is none']);
    expect(answer({ refused: [{ typed: 'X', reason: 'needs-customer' }] })).toEqual(['refused.0: "needs-customer" is said to staff']);
    const known = input({ guest: false, customer: { key: 'k', groups: [], orders: 0, uses: {} } });
    expect(answer({ refused: [{ typed: 'X', reason: 'needs-sign-in' }] }, known)).toEqual(['refused.0: "needs-sign-in" is said to a guest, and this customer is known']);
  });
});

priceAdjustConformance(provider, {
  cases: [
    { name: 'ten percent off the lines a code allows', input: input(), expect: { order: '5.00', lines: { '1': '2.99', '2': '2.01', '3': '0.00' }, applied: [{ line: '1', kind: 'code', typed: true }, { line: '2', kind: 'code' }], refused: [] } },
    { name: 'a code that is not found is refused, and nothing is taken off', input: input({ codes: [{ typed: 'NOPE', kind: null, row: null }], explain: true }), expect: { order: '0.00', applied: [], refused: [{ typed: 'NOPE', reason: 'unknown' }] } },
    { name: 'uses are reported where the order is posted', input: input({ point: 'post' }), expect: { order: '5.00' } },
  ],
});
