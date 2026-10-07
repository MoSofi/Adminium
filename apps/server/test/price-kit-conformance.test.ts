// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The test price add-on's own deciding file, held to what every
 * `price-adjust` provider owes — and asked the way a save asks it: compiled
 * from its bytes and run in the bare context, not imported. So the fixture
 * every test of the price question stands on is known good: the worked order
 * to the cent, the split of an amount, a minimum judged on what is left, a
 * guest told to sign in — and each way it can be told to misbehave is known
 * to give no answer, or a wrong one, by name.
 */
import { adjustAnswerIssues, adjustOutputSchema, type AdjustCode, type AdjustInput, type AdjustLine, type AdjustOutput, type PriceAdjustProvider } from '@adminium/add-on-contracts';
import { priceAdjustConformance, type PriceAdjustCase } from '@adminium/add-on-contracts/testing';
import { validateManifest } from '@adminium/manifest';
import { describe, expect, it } from 'vitest';

import { DeciderFailed, callDecider, loadDecider } from '../src/add-ons/decide.js';
import { PRICE_KIT_SERVER, PRICES, marketManifest, priceKitManifest, type Item } from './fixtures/price-kit/index.js';

const decider = loadDecider({ key: 'price-kit', version: '1.0.0', path: 'dist/server.js', bytes: PRICE_KIT_SERVER });
/** The kit, asked as a save asks it. */
const provider: PriceAdjustProvider = { adjust: (input) => callDecider('adjust', decider, input) as AdjustOutput };

const CATEGORIES = 'market:categories';
const offer = (id: number, name: string, over: Record<string, unknown>) => ({
  id, name, public_name: null, status: 'active', kind: 'percent', value: '0.00', trigger: 'auto', scope: 'order', target_as: null, target_table: null, target_row: null, buy_qty: null,
  min_spend: null, max_uses: null, uses: 0, max_per_customer: null, first_order_only: false, group_id: null, weekdays: null, starts_on: null, ends_on: null, combinable: true, ...over,
});
const OFFERS = [
  offer(1, 'Welcome 10', { public_name: '{"de-DE":"Willkommen 10","en-US":"Welcome 10"}', value: '10.00', trigger: 'code', max_per_customer: 1, starts_on: '2026-08-01' }),
  offer(2, 'Monday mugs', { value: '15.00', scope: 'lines', target_as: 'category', target_table: CATEGORIES, target_row: '1', weekdays: '1', starts_on: '2026-09-14' }),
  offer(3, 'Tote pair', { kind: 'bonus_item', scope: 'lines', target_as: 'category', target_table: CATEGORIES, target_row: '2', buy_qty: 2, starts_on: '2026-09-24' }),
  offer(4, 'Autumn 5', { kind: 'amount', value: '5.00', trigger: 'code', min_spend: '30.00', max_uses: 100, uses: 20, starts_on: '2026-09-14', ends_on: '2026-11-30' }),
  offer(5, 'Launch week', { value: '20.00', trigger: 'code', max_uses: 50, uses: 50, starts_on: '2026-09-01', ends_on: '2026-09-30' }),
];
const ENDED = offer(6, 'Summer close-out', { status: 'ended', value: '25.00', starts_on: '2026-07-01', ends_on: '2026-08-31' });
const CATEGORY_OF: Record<Item, string> = { 'Mug, speckled': '1', 'Mug, white': '1', 'Canvas tote, natural': '2', 'Canvas tote, black': '2', 'Notebook, A5': '3', 'Greeting card': '3', 'Candle, fig': '4' };
const ITEM_OF: Record<Item, string> = { 'Mug, speckled': '1', 'Mug, white': '2', 'Canvas tote, natural': '3', 'Canvas tote, black': '4', 'Notebook, A5': '5', 'Greeting card': '6', 'Candle, fig': '7' };

const line = (index: number, item: Item, quantity: number, over: Partial<AdjustLine> = {}): AdjustLine => ({
  key: `p0:${String(index + 1)}`,
  part: 0,
  index,
  price: PRICES[item],
  quantity: String(quantity),
  amount: (Number(PRICES[item]) * quantity).toFixed(2),
  what: [{ as: 'item', table: 'market:items', row: ITEM_OF[item] }, { as: 'category', table: CATEGORIES, row: CATEGORY_OF[item] }],
  excluded: false,
  paidBy: null,
  kept: true,
  ...over,
});
const typed = (code: string, offerId: number, over: Record<string, unknown> = {}): AdjustCode => ({ typed: code, kind: 'code', row: { id: offerId + 10, code, offer_id: offerId, active: true, max_uses: null, uses: 0, valid_until: null, ...over } });
const BASKET = [line(0, 'Mug, speckled', 2), line(1, 'Canvas tote, natural', 2), line(2, 'Notebook, A5', 1)];
const ADA = { key: 'k-ada', groups: [], orders: 0, uses: {} };

const input = (over: Partial<AdjustInput> = {}): AdjustInput => ({
  contract: 'price-adjust@1',
  mode: 'save',
  point: 'line',
  origin: 'public',
  now: '2026-09-30T10:00:00.000Z',
  today: '2026-09-30',
  weekday: 3,
  time: '10:00',
  zone: 'UTC',
  currency: 'USD',
  scale: 2,
  locale: 'en-US',
  lines: BASKET,
  codes: [],
  customer: ADA,
  guest: false,
  staff: null,
  offers: { offers: OFFERS, typed: [] },
  settings: { id: 1, misbehave: null },
  explain: false,
  version: '1.0.0',
  ...over,
});

const CASES: PriceAdjustCase[] = [
  {
    name: 'the worked order: two totes give one, then ten percent of what is left, split to the cent',
    input: input({ codes: [typed('WELCOME10', 1)] }),
    expect: {
      order: '19.95',
      lines: { 'p0:1': '2.80', 'p0:2': '16.50', 'p0:3': '0.65' },
      applied: [
        { line: 'p0:2', offer: '3', kind: 'offer', amount: '15.00', typed: false, name: 'Tote pair' },
        { line: 'p0:1', offer: '1', code: '11', kind: 'code', amount: '2.80', typed: true, name: { 'de-DE': 'Willkommen 10', 'en-US': 'Welcome 10' } },
        { line: 'p0:2', offer: '1', amount: '1.50' },
        { line: 'p0:3', offer: '1', amount: '0.65' },
      ],
      refused: [],
    },
  },
  {
    name: 'five off is split 2.83, 1.51, 0.66: shares rounded down, the cents left over to the largest remainders',
    input: input({ codes: [typed('AUTUMN5', 4)] }),
    expect: { order: '20.00', lines: { 'p0:1': '2.83', 'p0:2': '16.51', 'p0:3': '0.66' }, refused: [] },
  },
  {
    name: 'a guest who types a code kept for one use a customer is told to sign in, and only the automatic offer applies',
    input: input({ codes: [typed('WELCOME10', 1)], customer: null, guest: true }),
    expect: { order: '15.00', lines: { 'p0:1': '0.00', 'p0:2': '15.00', 'p0:3': '0.00' }, refused: [{ typed: 'WELCOME10', reason: 'needs-sign-in' }] },
  },
  {
    name: 'a code whose uses are all taken is used up',
    input: input({ codes: [typed('LAUNCH20', 5)] }),
    expect: { order: '15.00', refused: [{ typed: 'LAUNCH20', reason: 'used-up' }] },
  },
  {
    name: 'a code under its minimum says so, and takes nothing',
    input: input({ lines: [line(0, 'Mug, white', 1), line(1, 'Notebook, A5', 2)], codes: [typed('AUTUMN5', 4)] }),
    expect: { order: '0.00', refused: [{ typed: 'AUTUMN5', reason: 'needs-minimum' }] },
  },
  {
    name: 'the minimum is judged on what earlier reductions left: Monday mugs first, then 27.30 is under 30.00',
    input: input({ today: '2026-10-05', now: '2026-10-05T10:00:00.000Z', weekday: 1, lines: [line(0, 'Mug, speckled', 2), line(1, 'Greeting card', 1)], codes: [typed('AUTUMN5', 4)] }),
    expect: { order: '4.20', lines: { 'p0:1': '4.20', 'p0:2': '0.00' }, refused: [{ typed: 'AUTUMN5', reason: 'needs-minimum' }] },
  },
  {
    name: 'a second use by the same customer is over their limit',
    input: input({ codes: [typed('WELCOME10', 1)], customer: { ...ADA, uses: { '1': 1 } } }),
    expect: { order: '15.00', refused: [{ typed: 'WELCOME10', reason: 'over-limit' }] },
  },
  {
    name: 'a line nothing reduces counts for nothing: ten percent of the mugs only, and an amount staff give stops at the goods',
    input: input({ lines: [line(0, 'Mug, speckled', 2), line(1, 'Candle, fig', 1, { price: '50.00', amount: '50.00', excluded: true })], codes: [typed('WELCOME10', 1)], staff: { kind: 'amount', value: '40.00', reason: null, ceiling: null, judge: false } }),
    expect: { order: '28.00', lines: { 'p0:1': '28.00', 'p0:2': '0.00' }, applied: [{ kind: 'code', amount: '2.80' }, { kind: 'staff', amount: '25.20' }] },
  },
  {
    name: 'a typed value that found no row is unknown',
    input: input({ codes: [{ typed: 'GC-7K2M-W3HN-Q4XP', kind: null, row: null }] }),
    expect: { order: '15.00', refused: [{ typed: 'GC-7K2M-W3HN-Q4XP', reason: 'unknown' }] },
  },
  {
    name: 'a voucher for a thing takes one unit of it, the dearest first',
    input: input({ lines: [line(0, 'Candle, fig', 2)], codes: [{ typed: 'VC-7K2MW3HNQ4XP', kind: 'voucher', row: { id: 4, worth: 'thing', value: null, what_table: 'market:items', what_row: '7', units: 1, uses_left: 1, status: 'issued', expires_on: null, holder_key: null, public_name: 'One candle' } }] }),
    expect: { order: '18.00', applied: [{ line: 'p0:1', voucher: '4', kind: 'voucher', amount: '18.00', typed: true, name: 'Voucher · One candle' }], refused: [] },
  },
  {
    name: 'a cashier\'s twenty percent with a limit of ten is over the limit, and nothing is taken off by hand',
    input: input({ origin: 'staff', staff: { kind: 'percent', value: '20.00', reason: 'Goodwill', ceiling: { percent: '10.00', amount: '0.00' }, judge: true } }),
    expect: { order: '15.00', refused: [{ typed: '', reason: 'over-ceiling' }] },
  },
  {
    name: 'the same reduction, stored and not judged again, is applied as it stands',
    input: input({ origin: 'staff', staff: { kind: 'percent', value: '20.00', reason: 'Goodwill', ceiling: null, judge: false } }),
    expect: { order: '24.90', applied: [{ kind: 'offer', amount: '15.00' }, { kind: 'staff', amount: '5.60', reason: 'Goodwill', name: 'Staff · Goodwill' }, { kind: 'staff', amount: '3.00' }, { kind: 'staff', amount: '1.30' }], refused: [] },
  },
  {
    name: 'of two offers that do not combine, the one that takes more off wins and the typed loser is told',
    input: input({ offers: { offers: [offer(1, 'Welcome 10', { value: '10.00', trigger: 'code', combinable: false }), offer(7, 'Big day', { value: '30.00', combinable: false })], typed: [] }, codes: [typed('WELCOME10', 1)] }),
    expect: { order: '19.35', applied: [{ offer: '7' }, { offer: '7' }, { offer: '7' }], refused: [] },
  },
  {
    name: 'a return: the lines kept are priced again, and one tote alone is no pair',
    input: input({ mode: 'refund', lines: [BASKET[0]!, line(1, 'Canvas tote, natural', 1), BASKET[2]!], codes: [typed('WELCOME10', 1)], offers: { offers: [OFFERS[0]!, OFFERS[2]!], typed: [] } }),
    expect: { order: '4.95', lines: { 'p0:1': '2.80', 'p0:2': '1.50', 'p0:3': '0.65' } },
  },
  {
    name: 'asked why, every offer handed in is answered: an ended one by name',
    input: input({ mode: 'try', explain: true, origin: 'staff', offers: { offers: [...OFFERS, ENDED], typed: [] }, draft: { name: 'Draft day', kind: 'percent', value: '50.00', trigger: 'auto', scope: 'order', combinable: true } }),
    expect: { refused: [] },
  },
];

priceAdjustConformance(provider, { cases: CASES });

describe('the test price add-on', () => {
  it('its manifest and the shop\'s are ones Adminium installs', () => {
    for (const manifest of [priceKitManifest(), marketManifest()]) {
      const read = validateManifest(manifest);
      expect(read.ok ? [] : read.issues).toEqual([]);
    }
  });

  it('reports uses only where the order is posted: one for each offer with its code, each for the customer handed in', () => {
    const at = (point: 'line' | 'post') => provider.adjust(input({ point, codes: [typed('WELCOME10', 1)] }));
    expect(at('line').uses).toEqual([]);
    expect(at('post').uses).toEqual([
      { offer: '3', code: null, voucher: null, amount: '15.00', customer: 'k-ada' },
      { offer: '1', code: '11', voucher: null, amount: '4.95', customer: 'k-ada' },
    ]);
    expect(at('post').lines).toEqual(at('line').lines);
  });

  it('tells a typed code that lost which offer won', () => {
    const answer = provider.adjust(input({ offers: { offers: [offer(1, 'Welcome 10', { value: '10.00', trigger: 'code', combinable: false }), offer(7, 'Big day', { value: '30.00', combinable: false })], typed: [] }, codes: [typed('WELCOME10', 1)] }));
    expect(answer.told).toEqual([{ typed: 'WELCOME10', note: 'better-offer-applied', name: 'Big day' }]);
  });

  it('does not count the order\'s own held use against it', () => {
    const full = { ...OFFERS[4]!, uses: 50 };
    const ask = (held?: AdjustInput['held']) => provider.adjust(input({ offers: { offers: [full], typed: [] }, codes: [typed('LAUNCH20', 5)], ...(held === undefined ? {} : { held }) }));
    expect(ask().refused).toEqual([{ typed: 'LAUNCH20', reason: 'used-up' }]);
    expect(ask({ redemptions: [{ id: 9, offer_id: 5, code_id: 15, voucher_id: null, state: 'held' }] }).refused).toEqual([]);
  });

  it('says why each offer does not apply, and judges an offer not saved yet as if it were on', () => {
    const answer = provider.adjust(input({ mode: 'try', explain: true, origin: 'staff', offers: { offers: [...OFFERS, ENDED], typed: [] }, draft: { name: 'Draft day', kind: 'percent', value: '50.00', trigger: 'auto', scope: 'order', combinable: true } }));
    const said = Object.fromEntries((answer.explain ?? []).map((entry) => [entry.offer, entry.applies ? `applies ${String(entry.amount)}` : entry.reason]));
    expect(said).toEqual({ '1': 'no-code-typed', '2': 'outside-days', '3': 'applies 15.00', '4': 'no-code-typed', '5': 'no-code-typed', '6': 'ended', draft: 'applies 24.75' });
  });

  for (const [how, cause] of [['throw', 'threw'], ['hang', 'timeout'], ['promise', 'thenable'], ['negative', 'shape']] as const) {
    it(`told to "${how}", it gives no answer at all (${cause})`, () => {
      let failure: unknown;
      try {
        callDecider('adjust', decider, input({ settings: { id: 1, misbehave: how } }), { shape: adjustOutputSchema });
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(DeciderFailed);
      expect((failure as DeciderFailed).cause).toBe(cause);
    });
  }

  for (const [how, said] of [
    ['over-line', 'is more than the line\'s'],
    ['wrong-sum', 'is not the sum of the lines\' reductions'],
    ['stray-line', 'is not a line of the question'],
    ['missing-line', 'has no answer'],
    ['uses-at-line', 'uses are reported only where the order is posted'],
  ] as const) {
    it(`told to "${how}", its answer is one the contract's own check refuses`, () => {
      const asked = input({ codes: [typed('WELCOME10', 1)], settings: { id: 1, misbehave: how } });
      expect(adjustAnswerIssues(asked, provider.adjust(asked)).join('\n')).toContain(said);
    });
  }
});
