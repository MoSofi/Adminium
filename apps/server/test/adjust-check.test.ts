// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE ANSWER IS CHECKED BEFORE IT IS WRITTEN — each thing Adminium holds an
 * add-on's answer to, one at a time: an answer that passes, then the same
 * answer wrong in exactly one way.
 */
import type { AdjustInput, AdjustOutput } from '@adminium/add-on-contracts';
import { describe, expect, it } from 'vitest';

import { checkAdjust, type AdjustLoaded } from '../src/crud/adjust/check.js';

const line = (key: string, amount: string, over: Partial<AdjustInput['lines'][number]> = {}): AdjustInput['lines'][number] => ({ key, part: 0, index: 0, price: amount, quantity: '1', amount, what: [], excluded: false, paidBy: null, kept: true, ...over });

const question = (over: Partial<AdjustInput> = {}): AdjustInput => ({
  contract: 'price-adjust@1',
  mode: 'save',
  point: 'post',
  origin: 'staff',
  now: '2026-09-30T10:00:00.000Z',
  today: '2026-09-30',
  weekday: 3,
  time: '10:00',
  zone: 'UTC',
  currency: 'USD',
  scale: 2,
  locale: 'en-US',
  lines: [line('p0:1', '28.00'), line('p0:2', '30.00'), line('p0:3', '50.00', { excluded: true })],
  codes: [{ typed: 'WELCOME10', kind: 'code', row: { id: 11 } }, { typed: 'VC-AAAA', kind: 'voucher', row: { id: 4 } }],
  customer: { key: 'k-ada', groups: [], orders: 0, uses: {} },
  guest: false,
  staff: null,
  offers: { offers: [{ id: 1 }, { id: 3 }] },
  settings: {},
  explain: false,
  version: '1.0.0',
  ...over,
});

const LOADED: AdjustLoaded = { offers: new Set(['1', '3']), codes: new Set(['11']), vouchers: new Set(['4']) };

const answer = (over: Partial<AdjustOutput> = {}): AdjustOutput => ({
  lines: [{ key: 'p0:1', discount: '2.80' }, { key: 'p0:2', discount: '18.00' }, { key: 'p0:3', discount: '0.00' }],
  order: { discount: '20.80' },
  applied: [
    { line: 'p0:1', offer: '1', code: '11', voucher: null, name: 'Welcome 10', kind: 'code', amount: '2.80', typed: true },
    { line: 'p0:2', offer: '3', code: null, voucher: null, name: 'Tote pair', kind: 'offer', amount: '15.00', typed: false },
    { line: 'p0:2', offer: '1', code: '11', voucher: null, name: 'Welcome 10', kind: 'code', amount: '3.00', typed: true },
  ],
  uses: [{ offer: '1', code: '11', voucher: null, amount: '5.80', customer: 'k-ada' }, { offer: '3', code: null, voucher: null, amount: '15.00' }],
  refused: [],
  ...over,
});

const check = (output: AdjustOutput, input: AdjustInput = question(), loaded: AdjustLoaded = LOADED) => checkAdjust(input, output, loaded);

describe('an answer that is taken', () => {
  it('names only rows read for the call, and adds up line by line', () => {
    expect(check(answer())).toBeNull();
  });

  it('may apply nothing at all', () => {
    expect(check({ lines: [{ key: 'p0:1', discount: '0.00' }, { key: 'p0:2', discount: '0' }, { key: 'p0:3', discount: '0.00' }], order: { discount: '0.00' }, applied: [], uses: [], refused: [] })).toBeNull();
  });
});

describe('an answer that is refused', () => {
  it('what the contract\'s own check refuses is refused first', () => {
    expect(check(answer({ order: { discount: '20.81' } }))).toContain('not the sum');
    expect(check(answer({ lines: [{ key: 'p0:1', discount: '2.80' }, { key: 'p0:2', discount: '18.00' }] }))).toContain('has no answer');
  });

  it('an offer, a code or a voucher that was not read for this order', () => {
    const swap = (index: number, change: Partial<AdjustOutput['applied'][number]>) => answer({ applied: answer().applied.map((entry, i) => (i === index ? { ...entry, ...change } : entry)) });
    expect(check(swap(1, { offer: '9' }))).toContain('the offer "9" was not read for this order');
    expect(check(swap(0, { code: '12' }))).toContain('the code "12" was not typed on this order');
    expect(check(swap(1, { voucher: '5' }))).toContain('the voucher "5" was not typed on this order');
    // A row of the other kind is not the same row: the voucher's key is no code's.
    expect(check(swap(0, { code: '4' }))).toContain('the code "4" was not typed');
    // An offer being tried is named `draft` — only when one was handed in.
    expect(check(swap(1, { offer: 'draft' }))).toContain('the offer "draft" was not read');
    expect(check(swap(1, { offer: 'draft' }), question({ mode: 'try', point: 'line', draft: { name: 'x' } }), LOADED)).toContain('uses');
    expect(check({ ...swap(1, { offer: 'draft' }), uses: [] }, question({ mode: 'try', point: 'line', draft: { name: 'x' } }))).toBeNull();
  });

  it('a reduction applied twice under one name, or under no name at all', () => {
    const twice = answer({ applied: [...answer().applied.slice(0, 2), { ...answer().applied[2]!, amount: '1.00' }, { ...answer().applied[2]!, amount: '2.00' }] });
    // The two add up to the line's reduction — and would be kept as one row.
    expect(check(twice)).toContain('the same reduction is applied to "p0:2" twice');
    const unnamed = (kind: AdjustOutput['applied'][number]['kind'], ids: Partial<AdjustOutput['applied'][number]>) => answer({ applied: answer().applied.map((entry, i) => (i === 1 ? { ...entry, kind, offer: null, code: null, voucher: null, ...ids } : entry)) });
    expect(check(unnamed('offer', {}))).toContain('a reduction of kind "offer" names no offer');
    expect(check(unnamed('code', { offer: '3' }))).toContain('a reduction of kind "code" names no code');
    expect(check(unnamed('voucher', { offer: '3' }))).toContain('a reduction of kind "voucher" names no voucher');
    expect(check(unnamed('pack', {}))).toContain('a reduction of kind "pack" names no voucher');
    expect(check(unnamed('pack', { voucher: '4' }))).toBeNull();
  });

  it('a figure written finer than the order\'s places, or longer than any amount is', () => {
    // The lines add up to 20.80, and so does 20.809 cut short: the order's own figure is held to the places too.
    expect(check(answer({ order: { discount: '20.809' } }))).toContain('order.discount: "20.809" is finer than the order\'s 2 decimals');
    expect(check(answer({ order: { discount: `${'0'.repeat(40)}20.80` } }))).toContain('more than 32 characters');
    expect(check(answer({ uses: [{ offer: '3', code: null, voucher: null, amount: `${'9'.repeat(33)}` }] }))).toContain('more than 32 characters');
  });

  it('what was applied to a line that does not add up to the line\'s reduction', () => {
    expect(check(answer({ applied: answer().applied.slice(0, 2) }))).toContain('"p0:2" is reduced by 18.00, and what was applied to it does not add up');
    expect(check(answer({ applied: [...answer().applied, { line: 'p0:1', offer: '3', code: null, voucher: null, name: 'x', kind: 'offer', amount: '0.01', typed: false }] }))).toContain('"p0:1" is reduced by 2.80');
    // A line with no reduction has nothing applied to it.
    expect(check(answer({ applied: [...answer().applied, { line: 'p0:3', offer: '3', code: null, voucher: null, name: 'x', kind: 'offer', amount: '1.00', typed: false }] }))).toContain('"p0:3"');
    expect(check(answer({ applied: answer().applied.map((entry, i) => (i === 0 ? { ...entry, amount: '2.801' } : entry)) }))).toContain('finer than');
  });

  const staffed = (staff: NonNullable<AdjustInput['staff']>, amounts: [string, string]) => {
    const total = (Number(amounts[0]) + Number(amounts[1])).toFixed(2);
    return {
      input: question({ staff, codes: [] }),
      output: {
        lines: [{ key: 'p0:1', discount: amounts[0] }, { key: 'p0:2', discount: amounts[1] }, { key: 'p0:3', discount: '0.00' }],
        order: { discount: total },
        applied: [
          { line: 'p0:1', offer: null, code: null, voucher: null, name: 'Staff', kind: 'staff' as const, amount: amounts[0], typed: false },
          { line: 'p0:2', offer: null, code: null, voucher: null, name: 'Staff', kind: 'staff' as const, amount: amounts[1], typed: false },
        ],
        uses: [{ offer: null, code: null, voucher: null, amount: total }],
        refused: [],
      } satisfies AdjustOutput,
    };
  };

  it('more taken off by hand than the stored reduction comes to', () => {
    // Ten percent of 58.00 of goods is 5.80; a cent a line is let through for rounding, and no more.
    const stored = { kind: 'percent' as const, value: '10.00', reason: null, ceiling: null, judge: false };
    const within = staffed(stored, ['2.80', '3.00']);
    expect(check(within.output, within.input)).toBeNull();
    const rounded = staffed(stored, ['2.81', '3.01']);
    expect(check(rounded.output, rounded.input)).toBeNull();
    const over = staffed(stored, ['2.82', '3.01']);
    expect(check(over.output, over.input)).toContain('applies more than that comes to');
    // An amount is an amount: not a cent more.
    const five = { kind: 'amount' as const, value: '5.00', reason: null, ceiling: null, judge: false };
    expect(check(staffed(five, ['2.00', '3.00']).output, staffed(five, ['2.00', '3.00']).input)).toBeNull();
    expect(check(staffed(five, ['2.01', '3.00']).output, staffed(five, ['2.01', '3.00']).input)).toContain('applies more');
    // The line nothing reduces is no part of what a percent is taken of.
    const half = staffed({ ...stored, value: '50.00' }, ['14.00', '15.00']);
    expect(check(half.output, half.input)).toBeNull();
    // A comp is the whole of the goods.
    const comp = staffed({ kind: 'comp', value: '0', reason: null, ceiling: null, judge: false }, ['28.00', '30.00']);
    expect(check(comp.output, comp.input)).toBeNull();
    // A reduction staff gave names no offer.
    const named = staffed(stored, ['2.80', '3.00']);
    expect(check({ ...named.output, applied: named.output.applied.map((entry) => ({ ...entry, offer: '1' })) }, named.input)).toContain('names no offer');
  });

  it('more taken off by hand than its giver may give, in the save that gives it', () => {
    const giving = (ceiling: { percent: string; amount: string | null }, kind: 'percent' | 'amount' = 'percent', value = '20.00') => ({ kind, value, reason: null, ceiling, judge: true });
    // Twenty percent asked, ten allowed: 11.60 applied is over what ten percent comes to.
    const over = staffed(giving({ percent: '10.00', amount: null }), ['5.60', '6.00']);
    expect(check(over.output, over.input)).toContain('more than its giver may give');
    // Within the percent, and over the giver's amount.
    const capped = staffed(giving({ percent: '50.00', amount: '10.00' }), ['5.60', '6.00']);
    expect(check(capped.output, capped.input)).toContain('more than its giver may give');
    const allowed = staffed(giving({ percent: '50.00', amount: '20.00' }), ['5.60', '6.00']);
    expect(check(allowed.output, allowed.input)).toBeNull();
    const unlimited = staffed(giving({ percent: '20.00', amount: null }), ['5.60', '6.00']);
    expect(check(unlimited.output, unlimited.input)).toBeNull();
    // An amount is held to the giver's amount alone.
    const amount = staffed(giving({ percent: '0.00', amount: '5.00' }, 'amount', '8.00'), ['4.00', '4.00']);
    expect(check(amount.output, amount.input)).toContain('more than its giver may give');
    // With no limit in money, an amount is held to what the giver's percent of the goods comes to: a role allowed ten percent is not allowed any sum.
    const none = staffed(giving({ percent: '0.00', amount: null }, 'amount', '8.00'), ['4.00', '4.00']);
    expect(check(none.output, none.input)).toContain('more than its giver may give');
    const tenth = staffed(giving({ percent: '10.00', amount: null }, 'amount', '8.00'), ['4.00', '4.00']);
    expect(check(tenth.output, tenth.input)).toContain('more than its giver may give');
    const fifth = staffed(giving({ percent: '20.00', amount: null }, 'amount', '8.00'), ['4.00', '4.00']);
    expect(check(fifth.output, fifth.input)).toBeNull();
    // Not judged again (a later save by somebody else): the stored reduction stands, whatever a limit would say.
    const later = staffed({ ...giving({ percent: '10.00', amount: null }), judge: false }, ['5.60', '6.00']);
    expect(check(later.output, later.input)).toBeNull();
  });

  it('a use for a row that was not read, of no unit, or for another customer', () => {
    const use = (change: Partial<AdjustOutput['uses'][number]>) => answer({ uses: [{ ...answer().uses[0]!, ...change }, answer().uses[1]!] });
    expect(check(use({ offer: '9' }))).toContain('uses.0: the offer "9" was not read');
    expect(check(use({ code: '99' }))).toContain('uses.0: the code "99" was not typed');
    expect(check(use({ voucher: '99' }))).toContain('uses.0: the voucher "99" was not typed');
    expect(check(use({ units: 0 }))).toContain('counts one unit at least');
    expect(check(use({ units: 2 }))).toBeNull();
    expect(check(use({ customer: 'k-tomas' }))).toContain('for a customer other than the one handed in');
    expect(check(use({ amount: '5.801' }))).toContain('finer than');
    // With nobody proved, a use is nobody's.
    expect(check(answer(), question({ customer: null }))).toContain('for a customer other than the one handed in');
    expect(check(answer({ uses: [] }), question({ customer: null }))).toBeNull();
  });

  it('a refusal about a code nobody typed, or one this caller cannot be given', () => {
    const refused = (entry: AdjustOutput['refused'][number], input = question()) => check(answer({ refused: [entry] }), input);
    expect(refused({ typed: 'WELCOME10', reason: 'used-up' })).toBeNull();
    expect(refused({ typed: 'NOBODY', reason: 'unknown' })).toContain('"NOBODY" was not typed on this order');
    expect(refused({ typed: '', reason: 'unknown' })).toContain('was not typed');
    // What staff gave is refused by no code's name, and only in the save that gives it.
    const giving = { kind: 'percent' as const, value: '20.00', reason: null, ceiling: { percent: '10.00', amount: '0.00' }, judge: true };
    expect(refused({ typed: '', reason: 'over-ceiling', params: { max: '10.00' } }, question({ staff: giving }))).toBeNull();
    expect(refused({ typed: 'WELCOME10', reason: 'over-ceiling' }, question({ staff: giving }))).toContain('names no code');
    expect(refused({ typed: '', reason: 'over-ceiling' }, question({ staff: { ...giving, judge: false } }))).toContain('in the save that gives a reduction');
    expect(refused({ typed: '', reason: 'over-ceiling' })).toContain('over-ceiling');
    // Needing a customer is said when nobody is named on the order.
    expect(refused({ typed: 'WELCOME10', reason: 'needs-customer' })).toContain('this order names its customer');
    expect(refused({ typed: 'WELCOME10', reason: 'needs-customer' }, question({ customer: null }))).toContain('for a customer other');
    expect(check(answer({ uses: [], refused: [{ typed: 'WELCOME10', reason: 'needs-customer' }] }), question({ customer: null }))).toBeNull();
    // A word beside a code is beside a code that was typed.
    expect(check(answer({ told: [{ typed: 'WELCOME10', note: 'better-offer-applied', name: 'Tote pair' }] }))).toBeNull();
    expect(check(answer({ told: [{ typed: 'NOBODY', note: 'better-offer-applied', name: 'Tote pair' }] }))).toContain('told.0: "NOBODY" was not typed');
  });

  it('why each offer applies, said unasked, or not of every offer handed in', () => {
    expect(check(answer({ explain: [] }))).toContain('nobody asked why');
    const asked = question({ explain: true });
    expect(check(answer({ explain: [{ offer: '1', applies: true }, { offer: '3', applies: true }] }), asked)).toBeNull();
    expect(check(answer({ explain: [{ offer: '1', applies: true }] }), asked)).toContain('nothing is said of the offer "3"');
    // An offer being tried is answered too: by its own id, or as `draft`.
    const trying = question({ mode: 'try', point: 'line', explain: true, draft: { name: 'x' } });
    expect(check(answer({ uses: [], explain: [{ offer: '1', applies: true }, { offer: '3', applies: true }] }), trying)).toContain('the offer being tried');
    expect(check(answer({ uses: [], explain: [{ offer: '1', applies: true }, { offer: '3', applies: true }, { offer: 'draft', applies: false, reason: 'draft' }] }), trying)).toBeNull();
    expect(check(answer({ uses: [], explain: [{ offer: '1', applies: true }, { offer: '3', applies: true }] }), { ...trying, draft: { id: 3, name: 'x' } })).toBeNull();
  });
});
