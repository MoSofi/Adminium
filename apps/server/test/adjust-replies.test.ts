// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT A DOOR SAYS OF A PRICE, and the one refusal a price check answers in
 * a code's place. The reply is one named entry per reduction, in the reader's
 * language, with nothing a reader may not be told; a code that stood when the
 * price was shown and does not at the save is answered by the price check —
 * the order is priced without it — and refused only when it was worth nothing.
 */
import type { AdjustApplied } from '@adminium/add-on-contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { appliedReply, nameIn, priceAnswer } from '../src/crud/adjust/replies.js';
import type { AdjustedOrder } from '../src/crud/adjust/step.js';
import type { TreeWritten } from '../src/crud/write-tree.js';
import { priceWorld, seedOffers } from './adjust.helpers.js';
import { declaredColumns } from '../src/routes/data/staff-quote.js';
import { guessRung, treeRung, treeTypesCode, typesCode, writeRung } from '../src/routes/public/code-guesses.js';
import { GUEST, refused, saveWorld, sentLine, type SaveWorld } from './adjust-save.helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

const entry = (over: Partial<AdjustApplied>): AdjustApplied => ({ line: 'p0:1', offer: null, code: null, voucher: null, name: 'Offer', kind: 'offer', amount: '1.00', typed: false, ...over });
const WELCOME = { 'en-US': 'Welcome 10', 'de-DE': 'Willkommen 10' };
const APPLIED: AdjustApplied[] = [
  entry({ line: 'p0:42', offer: '3', name: 'Tote pair', amount: '15.00' }),
  entry({ line: 'p0:41', offer: '1', code: '7', name: WELCOME, kind: 'code', amount: '2.80', typed: true, reason: 'first order' }),
  entry({ line: 'p0:42', offer: '1', code: '7', name: WELCOME, kind: 'code', amount: '1.50', typed: true }),
  entry({ line: 'p0:43', offer: '1', code: '7', name: WELCOME, kind: 'code', amount: '0.65', typed: true }),
  entry({ line: 'p0:41', voucher: '9', name: 'Voucher', kind: 'voucher', amount: '5.00', typed: true }),
  entry({ line: 'p1:5', name: 'Staff · regular', kind: 'staff', amount: '2.00' }),
];
const CODES = [
  { typed: 'welcome10', kind: 'code' as const, id: '7' },
  { typed: 'vc-7k2m w3hn-q4xp', kind: 'voucher' as const, id: '9' },
];

describe('the reductions of an order, as a reply names them', () => {
  const opts = { locale: 'en-US', places: 2, lineOf: (line: string) => `at:${line}`, columnOf: (typed: string) => `col:${typed}` };

  it('one entry per reduction: on one line it names the line; over several it is the order\'s, with their sum', () => {
    const { applied } = appliedReply({ applied: APPLIED, told: [], codes: CODES }, opts);
    expect(applied).toEqual([
      { line: 'at:p0:42', name: 'Tote pair', kind: 'offer', amount: '15.00', typed: false },
      // 2.80 + 1.50 + 0.65, exactly.
      { line: null, name: 'Welcome 10', kind: 'code', amount: '4.95', typed: true },
      { line: 'at:p0:41', name: 'Voucher', kind: 'voucher', amount: '5.00', typed: true, codeLast4: 'Q4XP' },
      { line: 'at:p1:5', name: 'Staff · regular', kind: 'staff', amount: '2.00', typed: false },
    ]);
    // Two offers are two entries, whatever else they share.
    const two = appliedReply({ applied: [entry({ line: 'p0:1', offer: '3', name: 'Tote pair' }), entry({ line: 'p0:2', offer: '4', name: 'Monday mugs' })], told: [], codes: [] }, opts).applied;
    expect(two.map((one) => [one.line, one.name])).toEqual([['at:p0:1', 'Tote pair'], ['at:p0:2', 'Monday mugs']]);
    // Nothing a reader may not be told: no id, no reason, no whole code.
    expect(JSON.stringify(applied)).not.toMatch(/first order|7K2M|"offer":|"code":|"voucher":/);
  });

  it('a name is said in the reader\'s language, else the default one, else the first there is', () => {
    expect(nameIn(WELCOME, 'de-DE')).toBe('Willkommen 10');
    // (Adminium's own spelling of a language finds the same name.)
    expect(nameIn(WELCOME, 'de_DE')).toBe('Willkommen 10');
    expect(nameIn({ de_DE: 'Willkommen' }, 'de-DE')).toBe('Willkommen');
    expect(nameIn(WELCOME, 'fr-FR')).toBe('Welcome 10');
    expect(nameIn({ 'it-IT': 'Benvenuto' }, 'fr-FR')).toBe('Benvenuto');
    expect(nameIn('Plain', 'de-DE')).toBe('Plain');
    expect(nameIn({}, 'de-DE')).toBe('');
    expect(appliedReply({ applied: APPLIED, told: [], codes: CODES }, { ...opts, locale: 'de-DE' }).applied[1]!.name).toBe('Willkommen 10');
  });

  it('the last four are a voucher\'s only, and of the code as it was typed', () => {
    const only = (codes: typeof CODES, over: Partial<AdjustApplied> = {}) => appliedReply({ applied: [entry({ voucher: '9', kind: 'voucher', typed: true, ...over })], told: [], codes }, opts).applied[0];
    expect(only(CODES)).toMatchObject({ codeLast4: 'Q4XP' });
    expect(only(CODES, { kind: 'pack' })).toMatchObject({ codeLast4: 'Q4XP' });
    // A discount code is never cut to four; a voucher nobody typed here has none.
    expect(only(CODES, { kind: 'code', code: '7', voucher: null })).not.toHaveProperty('codeLast4');
    expect(only([])).not.toHaveProperty('codeLast4');
    expect(only([{ typed: 'welcome10', kind: 'code', id: '9' }])).not.toHaveProperty('codeLast4');
    // Of a code so short that four characters are most of it, nothing is told.
    expect(only([{ typed: 'VC-12345', kind: 'voucher', id: '9' }])).not.toHaveProperty('codeLast4');
    expect(only([{ typed: 'vc-1234-56', kind: 'voucher', id: '9' }])).toMatchObject({ codeLast4: '3456' });
  });

  it('a word beside a typed code names the column it was typed into', () => {
    const { told } = appliedReply({ applied: [], told: [{ typed: 'AUTUMN5', note: 'better-offer-applied', name: 'Welcome 10' }], codes: [] }, opts);
    expect(told).toEqual([{ column: 'col:AUTUMN5', note: 'better-offer-applied', name: 'Welcome 10' }]);
  });

  const order = (over: Partial<AdjustedOrder> = {}): AdjustedOrder => ({
    table: 'public.orders',
    key: 8,
    applied: APPLIED.slice(0, 2),
    told: [{ typed: 'AUTUMN5', note: 'better-offer-applied', name: 'Welcome 10' }],
    uses: [],
    discount: '17.80',
    lines: [
      { table: 'public.order_lines', key: '41', line: 'p0:41', discount: '2.80' },
      { table: 'public.order_lines', key: '42', line: 'p0:42', discount: '15.00' },
      { table: 'public.orders', key: '8', line: 'p1:8', discount: '0.00' },
    ],
    changedLines: 2,
    codes: [],
    wrote: {},
    places: 2,
    typed: { table: 'public.order_codes', column: 'typed', rows: [{ typed: 'AUTUMN5', key: '77' }, { typed: 'TRIED', key: null }] },
    ...over,
  });
  const nameOf = (id: string) => id.replace('public.', '');

  it('a line is named by its place in the request when the write was a row with its rows, else by its table and key', () => {
    const row = (table: string, at: (string | number)[], record: Record<string, unknown>): TreeWritten => ({ node: { at, target: { table: { id: table, primaryKey: ['id'] } } }, record }) as never;
    const tree = [row('public.orders', [], { id: 8 }), row('public.order_lines', ['order_lines', 0], { id: 41 }), row('public.order_lines', ['order_lines', 1], { id: 42 }), row('public.order_codes', ['order_codes', 0], { id: 77 })];
    expect(priceAnswer([order()], { locale: 'en-US', nameOf, tree })).toEqual({
      applied: [
        { line: 'order_lines/1', name: 'Tote pair', kind: 'offer', amount: '15.00', typed: false },
        { line: 'order_lines/0', name: 'Welcome 10', kind: 'code', amount: '2.80', typed: true },
      ],
      told: [{ column: 'order_codes/0/typed', note: 'better-offer-applied', name: 'Welcome 10' }],
    });
    expect(priceAnswer([order()], { locale: 'en-US', nameOf })).toMatchObject({
      applied: [{ line: 'order_lines:42' }, { line: 'order_lines:41' }],
      told: [{ column: 'typed' }],
    });
  });

  it('a customer is told of no row they did not send, and of a reduction by hand without the reason staff wrote', () => {
    const staffed = order({ applied: [...APPLIED.slice(0, 1), entry({ line: 'p0:41', name: 'Staff · regular who complains', kind: 'staff', amount: '2.00' })], told: [] });
    expect(priceAnswer([staffed], { locale: 'en-US', nameOf: () => null, guest: true })).toEqual({
      applied: [
        { line: null, name: 'Tote pair', kind: 'offer', amount: '15.00', typed: false },
        { line: null, name: '', kind: 'staff', amount: '2.00', typed: false },
      ],
    });
    // The desk reads the reason.
    expect(priceAnswer([staffed], { locale: 'en-US', nameOf }).applied![1]).toMatchObject({ line: 'order_lines:41', name: 'Staff · regular who complains' });
  });

  it('a reduction on the order itself names no line; no price asked says nothing; a price that took nothing off says so', () => {
    const self = order({ applied: [entry({ line: 'p1:8', name: 'Two nights', amount: '37.00' })], told: [] });
    expect(priceAnswer([self], { locale: 'en-US', nameOf })).toEqual({ applied: [{ line: null, name: 'Two nights', kind: 'offer', amount: '37.00', typed: false }] });
    expect(priceAnswer(undefined, { locale: 'en-US', nameOf })).toEqual({});
    expect(priceAnswer([], { locale: 'en-US', nameOf })).toEqual({});
    expect(priceAnswer([order({ applied: [], told: [] })], { locale: 'en-US', nameOf })).toEqual({ applied: [] });
  });
});

describe('a typed code is a guess', () => {
  it('a retry answered with what an earlier save made hands its guess back, and its codes are not remembered as codes that worked', () => {
    const calls: string[] = [];
    const limiter = { reserveGuess: () => ({ ticket: { keep: () => calls.push('keep'), giveBack: () => calls.push('back') } }), knownCodes: () => calls.push('known') } as never;
    const rung = guessRung(limiter, () => false);
    const request = { ip: '10.0.0.1' } as never;
    expect(rung.reserve(request, 'key_1', ['ANYCODE'])).toBeNull();
    rung.forget(request);
    rung.settle(request, { statusCode: 200 } as never);
    expect(calls).toEqual(['back']);
    // A request that did look its code up, and was answered: handed back, and remembered.
    const again = { ip: '10.0.0.1' } as never;
    rung.reserve(again, 'key_1', ['ANYCODE']);
    rung.settle(again, { statusCode: 200 } as never);
    expect(calls).toEqual(['back', 'back', 'known']);
  });
});

describe.each(LEGS)('a code that no longer stands, in a save that checks its price — %s', (dialect, available) => {
  let w: SaveWorld;
  const lines = (world: SaveWorld) => [sentLine(world, 'Mug, speckled', 2), sentLine(world, 'Canvas tote, natural', 2), sentLine(world, 'Notebook, A5', 1)];
  const basket = (codes: readonly string[]) => ({
    table: 'market_orders',
    values: {},
    lists: { order_lines: { table: 'market_order_lines', via: 'order_id', rows: lines(w) }, order_codes: { table: 'market_order_codes', via: 'order_id', rows: codes.map((typed) => ({ typed })) } },
  });
  class PriceChanged extends Error {
    constructor(
      readonly total: number,
      readonly adjusted: readonly AdjustedOrder[] | undefined,
    ) {
      super('the price changed');
    }
  }
  const check = (shown: string) => (row: Record<string, unknown>, adjusted?: readonly AdjustedOrder[]) => {
    if (Number(row['total']).toFixed(2) !== shown) throw new PriceChanged(Number(row['total']), adjusted);
  };
  const orders = async () => Number((await w.rows('SELECT COUNT(*) AS n FROM market_orders'))[0]!['n']);

  beforeAll(async () => {
    if (!available) return;
    w = saveWorld(await priceWorld(dialect));
    // LAUNCH20: twenty percent, every one of its fifty uses taken.
    const seeded = await seedOffers(w, { timeless: true });
    await w.insert('price_kit_codes', { code: 'SUMMER25', offer_id: seeded.offers['Summer close-out'] });
  }, 240_000);
  afterAll(async () => {
    if (available) await w.close();
  });

  it.skipIf(!available)('with no price check, and in a quote, the code is refused as ever', async () => {
    const before = await orders();
    const plain = await refused(w.tree(basket(['LAUNCH20'])));
    expect([plain.code, plain.details, plain.at]).toEqual(['ADJUST_REFUSED', { column: 'typed', reason: 'used-up' }, ['order_codes', 0]]);
    const quoted = await refused(w.tree(basket(['LAUNCH20']), { mode: 'dry', expect: check('42.77') }));
    expect(quoted.details).toMatchObject({ reason: 'used-up' });
    expect(await orders()).toBe(before);
  });

  it.skipIf(!available)('the save is priced without it, and its price check answers: the price changed, with what the order would have', async () => {
    const before = await orders();
    // Shown 42.77 while the code still had a use; it has none now.
    const changed = (await refused(w.tree(basket(['LAUNCH20']), { expect: check('42.77') }))) as unknown as PriceChanged;
    expect(changed).toBeInstanceOf(PriceChanged);
    // The pair alone: 64.50 less 15.00, and its tax.
    expect(changed.total).toBe(53.46);
    expect(changed.adjusted).toHaveLength(1);
    expect(changed.adjusted![0]!.applied.map((one) => one.kind)).toEqual(['offer']);
    // The price check is told a code was held back: the door spends the guess.
    expect(changed.adjusted![0]!.heldBack).toBeInstanceOf(Error);
    expect(await orders()).toBe(before);
  });

  it.skipIf(!available)('when the price is as shown without it, the code is refused after all — on the row it was typed into — and nothing is saved', async () => {
    const before = await orders();
    const worthless = await refused(w.tree(basket(['LAUNCH20']), { expect: check('53.46') }));
    expect([worthless.code, worthless.details, worthless.at]).toEqual(['ADJUST_REFUSED', { column: 'typed', reason: 'used-up' }, ['order_codes', 0]]);
    expect(await orders()).toBe(before);
  });

  it.skipIf(!available)('a code refused for a reason that does not turn is refused before any price check; a second refusal is raised as it is', async () => {
    let asked = 0;
    const counting = (row: Record<string, unknown>, adjusted?: readonly AdjustedOrder[]) => {
      asked += 1;
      check('1.00')(row, adjusted);
    };
    // Under AUTUMN5's minimum: a mug and two notebooks.
    const small = { ...basket(['AUTUMN5']), lists: { ...basket(['AUTUMN5']).lists, order_lines: { table: 'market_order_lines', via: 'order_id', rows: [sentLine(w, 'Mug, white', 1), sentLine(w, 'Notebook, A5', 2)] } } };
    expect((await refused(w.tree(small, { expect: counting }))).details).toMatchObject({ reason: 'needs-minimum', amount: '30.00' });
    // The used-up code is held back; the one beside it does not exist, and is refused straight away.
    const two = await refused(w.tree(basket(['LAUNCH20', 'NOSUCHCODE']), { expect: counting }));
    expect([two.details, two.at]).toEqual([{ column: 'typed', reason: 'unknown' }, ['order_codes', 1]]);
    // …and so is a code under its minimum beside one that ran out: the first is held back, the second refused on its own row.
    const under = await refused(w.tree({ ...small, lists: { ...small.lists, order_codes: { table: 'market_order_codes', via: 'order_id', rows: [{ typed: 'LAUNCH20' }, { typed: 'AUTUMN5' }] } } }, { expect: counting }));
    expect([under.details, under.at]).toEqual([{ column: 'typed', reason: 'needs-minimum', amount: '30.00' }, ['order_codes', 1]]);
    expect(asked).toBe(0);
  });

  it.skipIf(!available)('two codes that no longer stand are both answered by the price check; to a customer, a code that never was is answered as they are', async () => {
    const before = await orders();
    // SUMMER25: a code of an offer that ended.
    const both = (await refused(w.tree(basket(['LAUNCH20', 'SUMMER25']), { expect: check('30.00') }))) as unknown as PriceChanged;
    expect(both).toBeInstanceOf(PriceChanged);
    expect(both.total).toBe(53.46);
    const worthless = await refused(w.tree(basket(['LAUNCH20', 'SUMMER25']), { expect: check('53.46') }));
    expect([worthless.code, worthless.at]).toEqual(['ADJUST_REFUSED', ['order_codes', 0]]);
    // At the desk a code that never was is refused at once, whatever the save checks: it could not have been in the price shown.
    expect((await refused(w.tree(basket(['NOSUCHCODE']), { expect: check('30.00') }))).details).toEqual({ column: 'typed', reason: 'unknown' });
    // A customer hears every code that does not stand as one thing — so the price check answers for all of them alike.
    const guessed = [] as string[];
    for (const typed of ['LAUNCH20', 'SUMMER25', 'NOSUCHCODE']) {
      const wrong = await refused(w.tree(basket([typed]), { context: GUEST, expect: check('30.00') }));
      const equal = await refused(w.tree(basket([typed]), { context: GUEST, expect: check('53.46') }));
      guessed.push(`${wrong instanceof PriceChanged ? `changed ${String((wrong as unknown as PriceChanged).total)}` : 'refused'} / ${JSON.stringify((equal.details as { fields?: unknown } | undefined)?.fields)}`);
    }
    expect(guessed).toEqual(Array(3).fill('changed 53.46 / {"typed":{"code":"unknown"}}'));
    // What a customer may hear by name is said at once, price check or not.
    expect(((await refused(w.tree(basket(['WELCOME10']), { context: GUEST, expect: check('30.00') }))).details as { fields: unknown }).fields).toEqual({ typed: { code: 'needs-sign-in' } });
    expect(await orders()).toBe(before);
  });

  it.skipIf(!available)('a code typed on an order is a guess on both counts, wherever in the write it is; the desk checks the figure the price rule names', async () => {
    const codes = w.table('market_order_codes');
    expect(typesCode(codes, { typed: ' vc-1234 ' }, w.view())).toEqual([' vc-1234 ']);
    expect(typesCode(codes, { typed: '  ' }, w.view())).toEqual([]);
    // With no model to read the rule from, nothing says the column takes codes.
    expect(typesCode(codes, { typed: 'X' })).toEqual([]);
    expect(writeRung(codes, { typed: 'AUTUMN5' }, w.view())).toBe('both');
    expect(writeRung(w.table('market_orders'), { note: 'x' }, w.view())).toBe('code');
    const node = (table: string, values: Record<string, unknown>, children: unknown[] = []) => ({ target: w.target(table), values, children }) as never;
    expect(treeRung(node('market_orders', {}, [node('market_order_lines', { qty: 1 }), node('market_order_codes', { typed: 'AUTUMN5' })]))).toBe('both');
    expect(treeTypesCode(node('market_orders', {}, [node('market_order_codes', { typed: 'A' }), node('market_order_codes', { typed: 'B' })]))).toEqual(['A', 'B']);
    // No public entry names a figure for these orders: the price rule's own is the one a desk's price check compares.
    expect(await declaredColumns(w.h.meta, w.h.connectionId, w.view(), w.table('market_orders'))).toMatchObject({ expect: 'total' });
    expect(await declaredColumns(w.h.meta, w.h.connectionId, w.view(), w.table('market_order_lines'))).toMatchObject({ expect: null });
  });

  it.skipIf(!available)('the same in a change: a code typed onto a stored order', async () => {
    const made = await w.tree(basket(['AUTUMN5']));
    const [code] = made.rows.filter((row) => row.node.name === 'order_codes').map((row) => row.record['id']);
    const before = await w.figures(made.root['id']);
    const changed = (await refused(w.update('market_order_codes', code, { typed: 'LAUNCH20' }, { expect: () => {
      throw new PriceChanged(0, undefined);
    } }))) as unknown as PriceChanged;
    expect(changed).toBeInstanceOf(PriceChanged);
    const worthless = await refused(w.update('market_order_codes', code, { typed: 'LAUNCH20' }, { expect: () => undefined }));
    expect(worthless.details).toEqual({ column: 'typed', reason: 'used-up' });
    // Nothing of either was kept.
    expect(await w.figures(made.root['id'])).toEqual(before);
    expect((await w.rows(`SELECT typed FROM market_order_codes WHERE id = ${String(code)}`))[0]!['typed']).toBe('AUTUMN5');
  });
});
