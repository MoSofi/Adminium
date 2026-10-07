// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE PRICE QUESTION, ASKED — the step on its own, against the test price
 * add-on installed by the real installer, on every engine this run can
 * reach: what it reads, what it asks, how it holds the answer to what was
 * read, and what it writes — each line's reduction, the order's, the links a
 * typed code found, and the rows that say what was applied; only what
 * changed, and nothing at all when anything is refused.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { refusedAt } from '../src/crud/adjust/answers.js';
import { AdjustFailed } from '../src/crud/adjust/step.js';
import { instantOf } from '../src/crud/states.js';
import { SAMPLE_NOW, priceWorld, seedOffers, type PriceWorld } from './adjust.helpers.js';
import { PUBLIC, STAFF, SYSTEM, stepperOf, type Stepper } from './adjust-step.helpers.js';
import { LEGS } from './invoicing-install.helpers.js';
import { refusal } from './ledger.helpers.js';

const BASKET = [['Mug, speckled', 2], ['Canvas tote, natural', 2], ['Notebook, A5', 1]] as const;

describe.each(LEGS)('the price question, asked — %s', (dialect, available) => {
  let w: PriceWorld;
  let s: Stepper;
  let seeded: Awaited<ReturnType<typeof seedOffers>>;
  let ada: number;
  const proved = () => ({ customer_id: ada, customer_proved: true });

  beforeAll(async () => {
    if (!available) return;
    w = await priceWorld(dialect);
    s = stepperOf(w);
    seeded = await seedOffers(w);
    ada = await w.insert('market_customers', { name: 'Ada', email: 'ada@example.com' });
  }, 240_000);
  afterAll(async () => {
    if (available) await w.close();
  });

  it.skipIf(!available)('the worked order: every line\'s reduction, the order\'s figures, the code\'s link and what was applied are written', async () => {
    const order = await s.place({ lines: BASKET, codes: ['WELCOME10'], order: proved() });
    const { result } = await s.run(order.id);
    expect(result).toMatchObject({ discount: '19.95', changedLines: 3, told: [], uses: [] });
    expect(result!.lines.map((line) => [line.table, line.key, line.discount])).toEqual(order.lines.map((id, i) => [w.table('market_order_lines').id, String(id), ['2.80', '16.50', '0.65'][i]]));
    const stands = await s.stands(order.id);
    expect(stands.lines).toEqual(['2.80', '16.50', '0.65']);
    // The order's own formulas that read its reduction are worked out with it: the totals are the save's to settle after.
    expect(stands.order).toEqual({ subtotal: '64.50', discount: '19.95', net: '44.55', tax: '3.56', total: '48.11' });
    expect(stands.applied).toEqual([`p0:${String(order.lines[1])} offer 15.00`, `p0:${String(order.lines[0])} code 2.80 typed`, `p0:${String(order.lines[1])} code 1.50 typed`, `p0:${String(order.lines[2])} code 0.65 typed`]);
    const [code] = await w.rows(`SELECT code_id, voucher_id FROM market_order_codes WHERE id = ${String(order.codes[0])}`);
    expect([Number(code!['code_id']), code!['voucher_id']]).toEqual([seeded.codes['WELCOME10'], null]);
    // What was applied names the order by its table's stored name, the offer and the code by their keys, and keeps the name in every language it has.
    const rows = await w.rows(`SELECT source_table, offer_id, code_id, name, reason, applied_at FROM price_kit_applied WHERE source_row = '${String(order.id)}' ORDER BY id`);
    expect(rows.map((row) => [row['source_table'], Number(row['offer_id']), row['code_id'] === null ? null : Number(row['code_id']), row['reason']])).toEqual([
      ['market:orders', seeded.offers['Tote pair'], null, null],
      ['market:orders', seeded.offers['Welcome 10'], seeded.codes['WELCOME10'], null],
      ['market:orders', seeded.offers['Welcome 10'], seeded.codes['WELCOME10'], null],
      ['market:orders', seeded.offers['Welcome 10'], seeded.codes['WELCOME10'], null],
    ]);
    // An engine that keeps json as text hands the text back; one that does not, what it parsed.
    const named = rows.map((row) => {
      try {
        return typeof row['name'] === 'string' ? JSON.parse(row['name']) : row['name'];
      } catch {
        return row['name'];
      }
    });
    expect(named).toEqual(['Tote pair', { 'de-DE': 'Willkommen 10', 'en-US': 'Welcome 10' }, { 'de-DE': 'Willkommen 10', 'en-US': 'Welcome 10' }, { 'de-DE': 'Willkommen 10', 'en-US': 'Welcome 10' }]);
    // Applied at the instant the save judged by.
    expect(new Date(instantOf(rows[0]!['applied_at'])!).toISOString()).toBe(SAMPLE_NOW);
  });

  it.skipIf(!available)('five off is stored 2.83, 1.51 and 0.66, and the order totals 48.06', async () => {
    const order = await s.place({ lines: BASKET, codes: ['AUTUMN5'], order: proved() });
    await s.run(order.id);
    const stands = await s.stands(order.id);
    expect(stands.lines).toEqual(['2.83', '16.51', '0.66']);
    expect(stands.order).toMatchObject({ discount: '20.00', net: '44.50', tax: '3.56', total: '48.06' });
  });

  it.skipIf(!available)('asked again with nothing changed, it writes nothing', async () => {
    const order = await s.place({ lines: BASKET, codes: ['WELCOME10'], order: proved() });
    const first = await s.run(order.id);
    // Three lines, the order, the code's link, and what was applied in one statement.
    expect(first.writes).toBe(6);
    const again = await s.run(order.id);
    expect(again.result).toMatchObject({ discount: '19.95', changedLines: 0 });
    expect(again.writes).toBe(0);
  });

  it.skipIf(!available)('a line added: only what moved is written, and what was applied is brought in step', async () => {
    const order = await s.place({ lines: BASKET, codes: ['WELCOME10'], order: proved() });
    await s.run(order.id);
    const card = await w.insert('market_order_lines', { order_id: order.id, item_id: w.items['Greeting card'], category_id: w.categories['Paper'], unit_price: '3.50', qty: 1, amount: '3.50' });
    const { result, writes } = await s.run(order.id);
    // Ten percent of 53.00 is 5.30, split 2.80 / 1.50 / 0.65 / 0.35: only the new line's reduction and the order's moved.
    expect(result).toMatchObject({ discount: '20.30', changedLines: 1 });
    expect(writes).toBe(3);
    expect((await s.stands(order.id)).applied).toContain(`p0:${String(card)} code 0.35 typed`);
    expect((await s.stands(order.id)).applied).toHaveLength(5);
  });

  it.skipIf(!available)('a third mug: the rows of what was applied that moved are changed where they are, and no other is touched', async () => {
    const order = await s.place({ lines: BASKET, codes: ['WELCOME10'], order: proved() });
    await s.run(order.id);
    const before = await w.rows(`SELECT id FROM price_kit_applied WHERE source_row = '${String(order.id)}' ORDER BY id`);
    await w.rows(`UPDATE market_order_lines SET qty = 3, amount = 42.00 WHERE id = ${String(order.lines[0])}`);
    await w.rows(`UPDATE market_orders SET subtotal = 78.50 WHERE id = ${String(order.id)}`);
    const { result, writes } = await s.run(order.id);
    // Ten percent of 63.50 is 6.35, split 4.20 / 1.50 / 0.65: one line, the order, and one row of what was applied.
    expect(result).toMatchObject({ discount: '21.35', changedLines: 1 });
    expect(writes).toBe(3);
    const stands = await s.stands(order.id);
    expect(stands.lines).toEqual(['4.20', '16.50', '0.65']);
    expect(stands.applied).toEqual([`p0:${String(order.lines[1])} offer 15.00`, `p0:${String(order.lines[0])} code 4.20 typed`, `p0:${String(order.lines[1])} code 1.50 typed`, `p0:${String(order.lines[2])} code 0.65 typed`]);
    // The same rows as before: changed, never taken away and made again.
    expect(await w.rows(`SELECT id FROM price_kit_applied WHERE source_row = '${String(order.id)}' ORDER BY id`)).toEqual(before);
  });

  it.skipIf(!available)('the second tote taken away: the pair is no pair, and its row of what was applied goes', async () => {
    const order = await s.place({ lines: BASKET, codes: ['WELCOME10'], order: proved() });
    await s.run(order.id);
    await w.rows(`UPDATE market_order_lines SET qty = 1, amount = 15.00 WHERE id = ${String(order.lines[1])}`);
    await w.rows(`UPDATE market_orders SET subtotal = 49.50 WHERE id = ${String(order.id)}`);
    const { result } = await s.run(order.id);
    expect(result).toMatchObject({ discount: '4.95' });
    const stands = await s.stands(order.id);
    expect(stands.lines).toEqual(['2.80', '1.50', '0.65']);
    expect(stands.applied).toEqual([`p0:${String(order.lines[0])} code 2.80 typed`, `p0:${String(order.lines[1])} code 1.50 typed`, `p0:${String(order.lines[2])} code 0.65 typed`]);
    expect(stands.order).toMatchObject({ discount: '4.95', net: '44.55', total: '48.11' });
  });

  it.skipIf(!available)('a code taken off the order gives every reduction it made back, and its rows go', async () => {
    const order = await s.place({ lines: BASKET, codes: ['WELCOME10'], order: proved() });
    await s.run(order.id);
    await w.rows(`UPDATE market_order_codes SET removed_at = '2026-09-30 10:05:00' WHERE id = ${String(order.codes[0])}`);
    await s.run(order.id);
    const stands = await s.stands(order.id);
    expect(stands.lines).toEqual(['0.00', '15.00', '0.00']);
    expect(stands.applied).toEqual([`p0:${String(order.lines[1])} offer 15.00`]);
  });

  it.skipIf(!available)('a quote writes the reductions where it can be rolled back, and never what was applied', async () => {
    const order = await s.place({ lines: BASKET, codes: ['WELCOME10'], order: proved() });
    const inside = await s.quote(order.id, async (trx, result) => {
      const [row] = (await trx.selectFrom('market_orders' as never).select(['discount', 'total'] as never).where('id' as never, '=', order.id as never).execute()) as Record<string, unknown>[];
      const applied = await trx.selectFrom('price_kit_applied' as never).selectAll().where('source_row' as never, '=', String(order.id) as never).execute();
      return { discount: Number(row!['discount']), total: Number(row!['total']), applied: applied.length, said: result?.applied.length };
    });
    expect(inside).toEqual({ discount: 19.95, total: 48.11, applied: 0, said: 4 });
    // And nothing of it is kept.
    expect(await s.stands(order.id)).toMatchObject({ lines: ['0.00', '0.00', '0.00'], applied: [] });
  });

  it.skipIf(!available)('a voided line is handed to nobody, and a reduction it still carries is taken off again', async () => {
    const order = await s.place({ lines: [['Mug, speckled', 2], ['Canvas tote, natural', 2, { voided_at: '2026-09-30 09:00:00', discount: '15.00' }], ['Notebook, A5', 1]], codes: ['WELCOME10'], order: proved() });
    const { result } = await s.run(order.id);
    // No pair (the totes are voided); ten percent of 34.50.
    expect(result).toMatchObject({ discount: '3.45' });
    expect(result!.lines.map((line) => line.key)).toEqual([String(order.lines[0]), String(order.lines[2])]);
    expect((await s.stands(order.id)).lines).toEqual(['2.80', '0.00', '0.65']);
  });

  it.skipIf(!available)('a line no offer reduces is never reduced: ten percent of the mugs alone', async () => {
    const order = await s.place({ lines: [['Mug, speckled', 2], ['Candle, fig', 1, { unit_price: '50.00', amount: '50.00', card_load: '2026-09-30 09:00:00' }]], codes: ['WELCOME10'], order: proved() });
    await s.run(order.id);
    expect((await s.stands(order.id)).lines).toEqual(['2.80', '0.00']);
  });

  it.skipIf(!available)('a voucher typed with its word is found, takes its thing, and its link is filled', async () => {
    const voucher = await w.insert('price_kit_vouchers', { code: `7K2MW3HNQ${dialect.slice(0, 1).toUpperCase()}XP`, worth: 'thing', what_table: w.refOf('market_items'), what_row: String(w.items['Candle, fig']), public_name: 'One candle' });
    const order = await s.place({ lines: [['Candle, fig', 2]], codes: [`VC-7K2M-W3HN-Q${dialect.slice(0, 1).toUpperCase()}XP`] });
    const { result } = await s.run(order.id);
    expect(result).toMatchObject({ discount: '18.00', applied: [{ kind: 'voucher', voucher: String(voucher), amount: '18.00', typed: true, name: 'Voucher · One candle' }] });
    const [code] = await w.rows(`SELECT code_id, voucher_id FROM market_order_codes WHERE id = ${String(order.codes[0])}`);
    expect([code!['code_id'], Number(code!['voucher_id'])]).toEqual([null, voucher]);
    const [applied] = await w.rows(`SELECT voucher_id, offer_id FROM price_kit_applied WHERE source_row = '${String(order.id)}'`);
    expect([Number(applied!['voucher_id']), applied!['offer_id']]).toEqual([voucher, null]);
  });

  it.skipIf(!available)('what staff took off by hand is handed in as the order keeps it; a comp is the whole of the goods', async () => {
    const tenth = await s.place({ lines: [['Mug, speckled', 2]], order: { staff_kind: 'percent', staff_value: '10.00', staff_reason: 'Goodwill' } });
    expect((await s.run(tenth.id)).result).toMatchObject({ discount: '2.80', applied: [{ kind: 'staff', amount: '2.80', reason: 'Goodwill', name: 'Staff · Goodwill' }] });
    const [kept] = await w.rows(`SELECT reason FROM price_kit_applied WHERE source_row = '${String(tenth.id)}'`);
    expect(kept!['reason']).toBe('Goodwill');
    const five = await s.place({ lines: [['Mug, speckled', 2]], order: { staff_kind: 'amount', staff_value: '5.00' } });
    expect((await s.run(five.id)).result).toMatchObject({ discount: '5.00' });
    const comp = await s.place({ lines: [['Mug, speckled', 2]], order: { staff_kind: 'comp' } });
    expect((await s.run(comp.id)).result).toMatchObject({ discount: '28.00' });
    // A kind that is none of the three, and a value of nothing, is no reduction.
    const none = await s.place({ lines: [['Mug, speckled', 2]], order: { staff_kind: 'none', staff_value: '10.00' } });
    expect((await s.run(none.id)).result).toMatchObject({ discount: '0.00', applied: [] });
    const blank = await s.place({ lines: [['Mug, speckled', 2]], order: { staff_kind: 'percent' } });
    expect((await s.run(blank.id)).result).toMatchObject({ discount: '0.00' });
  });

  it.skipIf(!available)('an order whose price stands is not asked about again; a change of what it rests on is refused', async () => {
    const order = await s.place({ lines: BASKET, codes: ['WELCOME10'], order: { ...proved(), status: 'paid' } });
    await w.misbehave('throw');
    try {
      // Nobody is asked: the add-on, told to throw, is never reached.
      expect((await s.run(order.id, { stood: { status: 'paid' }, touches: false })).result).toBeNull();
      const refused = await refusal(s.run(order.id, { stood: { status: 'paid' }, touches: true }));
      expect([refused.code, refused.statusCode, refused.details]).toEqual(['ADJUST_REFUSED', 409, { reason: 'frozen' }]);
    } finally {
      await w.misbehave(null);
    }
    // The save that moves it there prices it one last time: it stood open when the save began.
    expect((await s.run(order.id, { stood: { status: 'placed' }, touches: false })).result).toMatchObject({ discount: '19.95' });
    // An order that is gone is nothing to price.
    expect((await s.run(999_999)).result).toBeNull();
  });

  it.skipIf(!available)('staff are told why a code does not stand; nothing of the answer is written', async () => {
    const order = await s.place({ lines: BASKET, codes: ['LAUNCH20'], order: proved() });
    const refused = await refusal(s.run(order.id));
    expect([refused.code, refused.statusCode, refused.details]).toEqual(['ADJUST_REFUSED', 409, { column: 'typed', reason: 'used-up' }]);
    expect(refusedAt(refused)).toEqual({ table: w.table('market_order_codes').id, key: String(order.codes[0]) });
    expect(await s.stands(order.id)).toMatchObject({ lines: ['0.00', '0.00', '0.00'], applied: [] });
    const small = await s.place({ lines: [['Mug, white', 1], ['Notebook, A5', 2]], codes: ['AUTUMN5'] });
    expect((await refusal(s.run(small.id))).details).toEqual({ column: 'typed', reason: 'needs-minimum', amount: '30.00' });
    const none = await s.place({ lines: BASKET, codes: ['NOSUCHCODE'] });
    expect((await refusal(s.run(none.id, { context: SYSTEM }))).details).toEqual({ column: 'typed', reason: 'unknown' });
  });

  // Where the database holds a column to its length no such value is ever stored; an engine that does not (SQLite) is where it can be.
  it.skipIf(!available || dialect !== 'sqlite')('a value typed longer than any code is refused as not valid by Adminium itself: the add-on is never asked', async () => {
    const long = `S-U-M-M-E-R-${'-2-0-2-6'.repeat(8)}`;
    expect(long.length).toBeGreaterThan(64);
    const order = await s.place({ lines: BASKET, codes: [long] });
    await w.misbehave('throw');
    try {
      const refused = await refusal(s.run(order.id, { context: PUBLIC }));
      expect([refused.code, (refused.details as { fields: unknown }).fields]).toEqual(['VALIDATION_FAILED', { typed: { code: 'unknown' } }]);
      expect(refusedAt(refused)).toEqual({ table: w.table('market_order_codes').id, key: String(order.codes[0]) });
      expect((await refusal(s.run(order.id))).details).toEqual({ column: 'typed', reason: 'unknown' });
    } finally {
      await w.misbehave(null);
    }
  });

  it.skipIf(!available)('a row of what was applied changed by hand is put right; a table of the add-on\'s that will not take a row fails the save as the add-on\'s fault', async () => {
    const order = await s.place({ lines: BASKET, codes: ['AUTUMN5'] });
    await s.run(order.id);
    await w.rows(`UPDATE price_kit_applied SET typed = ${w.flag(false)} WHERE source_row = '${String(order.id)}' AND kind = 'code'`);
    expect((await s.run(order.id)).writes).toBe(3);
    expect((await s.stands(order.id)).applied.filter((row) => row.endsWith('typed'))).toHaveLength(3);
    // One row a kind for an order, said by the table itself: the second share of the code cannot go in.
    await w.rows('DELETE FROM price_kit_applied');
    await w.rows('CREATE UNIQUE INDEX price_kit_applied_once ON price_kit_applied (source_row, kind)');
    try {
      const other = await s.place({ lines: BASKET, codes: ['AUTUMN5'] });
      const refused = await refusal(s.run(other.id));
      expect(refused).toBeInstanceOf(AdjustFailed);
      expect([(refused.details as { reason: string }).reason, (refused as unknown as AdjustFailed).cause]).toEqual(['planner-failed', 'applied']);
      expect(await s.stands(other.id)).toMatchObject({ lines: ['0.00', '0.00', '0.00'], applied: [] });
    } finally {
      await w.rows(dialect === 'mysql' ? 'DROP INDEX price_kit_applied_once ON price_kit_applied' : 'DROP INDEX price_kit_applied_once');
    }
  });

  it.skipIf(!available)('a customer hears three reasons by name, and every other one as not a valid code', async () => {
    const said = async (lines: Parameters<Stepper['place']>[0]['lines'], code: string, order: Record<string, unknown> = {}) => {
      const placed = await s.place({ lines, codes: [code], order });
      const refused = await refusal(s.run(placed.id, { context: PUBLIC }));
      expect([refused.code, refused.statusCode]).toEqual(['VALIDATION_FAILED', 422]);
      expect(refusedAt(refused)).toEqual({ table: w.table('market_order_codes').id, key: String(placed.codes[0]) });
      return (refused.details as { fields: Record<string, unknown> }).fields;
    };
    expect(await said(BASKET, 'LAUNCH20')).toEqual({ typed: { code: 'unknown' } });
    expect(await said(BASKET, 'NOSUCHCODE')).toEqual({ typed: { code: 'unknown' } });
    expect(await said(BASKET, 'GC-7K2M-W3HN-Q4XP')).toEqual({ typed: { code: 'unknown' } });
    expect(await said([['Mug, white', 1], ['Notebook, A5', 2]], 'AUTUMN5')).toEqual({ typed: { code: 'needs-minimum', amount: '30.00' } });
    // Nobody proved who they are: the code kept for one use a customer asks them to sign in.
    expect(await said(BASKET, 'WELCOME10')).toEqual({ typed: { code: 'needs-sign-in' } });
  });

  it.skipIf(!available)('a link nobody proved is nobody: the same code, the same answer, whoever the order names', async () => {
    const unproved = await s.place({ lines: BASKET, codes: ['WELCOME10'], order: { customer_id: ada, customer_proved: false } });
    const refused = await refusal(s.run(unproved.id, { context: PUBLIC }));
    expect((refused.details as { fields: unknown }).fields).toEqual({ typed: { code: 'needs-sign-in' } });
    // To staff with nobody proved on the order, the same code needs a customer.
    expect((await refusal(s.run(unproved.id))).details).toEqual({ column: 'typed', reason: 'needs-customer' });
  });

  it.skipIf(!available)('a proved customer\'s second use of a code kept for one is refused: over their limit to staff, not valid to them', async () => {
    await w.insert('price_kit_redemptions', { customer: s.key('ada@example.com'), offer_id: seeded.offers['Welcome 10'], state: 'counted' });
    try {
      const order = await s.place({ lines: BASKET, codes: ['WELCOME10'], order: proved() });
      expect((await refusal(s.run(order.id))).details).toEqual({ column: 'typed', reason: 'over-limit' });
      expect(((await refusal(s.run(order.id, { context: PUBLIC }))).details as { fields: unknown }).fields).toEqual({ typed: { code: 'unknown' } });
    } finally {
      await w.rows('DELETE FROM price_kit_redemptions');
    }
  });

  it.skipIf(!available)('an answer that never comes, or is no answer, fails the save closed and says why to the log alone', async () => {
    const order = await s.place({ lines: BASKET, codes: ['WELCOME10'], order: proved() });
    for (const [how, cause] of [['throw', 'threw'], ['hang', 'timeout'], ['promise', 'thenable'], ['negative', 'shape']] as const) {
      await w.misbehave(how);
      const refused = await refusal(s.run(order.id));
      expect(refused, how).toBeInstanceOf(AdjustFailed);
      expect([refused.code, refused.statusCode, refused.details, (refused as unknown as AdjustFailed).cause], how).toEqual(['POSTING_REFUSED', 409, { reason: 'planner-failed' }, cause]);
    }
    await w.misbehave(null);
    expect(await s.stands(order.id)).toMatchObject({ lines: ['0.00', '0.00', '0.00'], applied: [] });
  });

  it.skipIf(!available)('an answer that names what was not read, or does not add up, fails the save closed before anything is written', async () => {
    const order = await s.place({ lines: [['Mug, speckled', 2], ['Canvas tote, natural', 2], ['Candle, fig', 1, { unit_price: '50.00', amount: '50.00', card_load: '2026-09-30 09:00:00' }]], codes: ['WELCOME10'], order: proved() });
    for (const [how, said] of [
      ['over-line', 'is more than the line\'s'],
      ['wrong-sum', 'is not the sum'],
      ['stray-line', 'is not a line of the question'],
      ['missing-line', 'has no answer'],
      ['reduce-excluded', 'is excluded'],
      ['uses-at-line', 'only where the order is posted'],
      ['stray-offer', 'was not read for this order'],
      ['applied-short', 'does not add up'],
      ['sign-in-to-known', 'this customer is known'],
    ] as const) {
      await w.misbehave(how);
      const refused = await refusal(s.run(order.id));
      expect(refused, how).toBeInstanceOf(AdjustFailed);
      expect([(refused.details as { reason: string }).reason, (refused as unknown as AdjustFailed).cause], how).toEqual(['planner-failed', 'check']);
      expect((refused as unknown as AdjustFailed).detail, how).toContain(said);
    }
    await w.misbehave(null);
    expect(await s.stands(order.id)).toMatchObject({ lines: ['0.00', '0.00', '0.00'], applied: [] });
    // Told nothing wrong, the same order is priced: the pair, then ten percent of the 43.00 of goods left — nothing off the load.
    expect((await s.run(order.id)).result).toMatchObject({ discount: '19.30' });
    expect((await s.stands(order.id)).lines).toEqual(['2.80', '16.50', '0.00']);
  });

  it.skipIf(!available)('an add-on updated since the save looked is not asked: the save starts again', async () => {
    const order = await s.place({ lines: BASKET });
    for (const now of [{ version: '1.0.1', status: 'installed' }, { version: '1.0.0', status: 'updating' }, null]) {
      const refused = await refusal(s.run(order.id, { runtime: w.runtimeWith({ versionNow: async () => now }) }));
      expect([refused.code, refused.details]).toEqual(['WRITE_CONFLICT', { retry: true }]);
    }
    expect((await s.stands(order.id)).applied).toEqual([]);
  });

  it.skipIf(!available)('more lines than one question carries refuses the save as too large', async () => {
    const order = await s.place({ lines: [] });
    await w.rows(`INSERT INTO market_order_lines (order_id, unit_price, qty, amount) VALUES ${Array.from({ length: 201 }, () => `(${String(order.id)}, 1.00, 1, 1.00)`).join(', ')}`);
    const refused = await refusal(s.run(order.id));
    expect([refused.code, refused.details]).toEqual(['POSTING_REFUSED', { reason: 'too-large' }]);
  });
});

describe('which orders a write asks about', () => {
  let w: PriceWorld;
  let s: Stepper;
  beforeAll(async () => {
    w = await priceWorld('sqlite');
    s = stepperOf(w);
  }, 120_000);
  afterAll(async () => {
    await w.close();
  });
  const peek = (table: string, action: 'create' | 'update' | 'delete', values: Record<string, unknown> | null, stepper = s) =>
    stepper.adjuster.peek({ target: w.target(table), rules: w.rules(table), action, values, context: STAFF });
  const orders = (peeked: Awaited<ReturnType<typeof peek>>) => peeked?.orders.map((order) => order.target.table.name) ?? null;

  it('a line or a code made, changed where the price reads it, or taken away asks about its order', async () => {
    expect(orders(await peek('market_order_lines', 'create', { order_id: 1, qty: 2 }))).toEqual(['market_orders']);
    expect(orders(await peek('market_order_lines', 'delete', null))).toEqual(['market_orders']);
    expect(orders(await peek('market_order_lines', 'update', { qty: 3 }))).toEqual(['market_orders']);
    expect(orders(await peek('market_order_lines', 'update', { voided_at: '2026-09-30T10:00:00Z' }))).toEqual(['market_orders']);
    expect(orders(await peek('market_order_codes', 'create', { typed: 'WELCOME10' }))).toEqual(['market_orders']);
    expect(orders(await peek('market_order_codes', 'update', { removed_at: '2026-09-30T10:00:00Z' }))).toEqual(['market_orders']);
    // A change the price does not read asks nobody.
    expect(await peek('market_order_lines', 'update', { discount: '1.00' })).toBeNull();
    expect(await peek('market_items', 'update', { price: '9.00' })).toBeNull();
    expect(await peek('market_items', 'create', { name: 'x' })).toBeNull();
  });

  it('an order made, or changed in who buys, what staff took off or where its price stands, asks about itself', async () => {
    const peeked = await peek('market_orders', 'create', { status: 'open' });
    expect(orders(peeked)).toEqual(['market_orders']);
    expect(peeked!.addOns).toEqual(['price-kit']);
    expect(peeked!.orders[0]!.applied.table.name).toBe('price_kit_applied');
    expect(peeked!.orders[0]!.adjuster.addOn).toBe('price-kit');
    for (const values of [{ staff_value: '10' }, { staff_kind: 'comp' }, { staff_reason: 'x' }, { customer_id: 4 }, { status: 'paid' }]) expect(orders(await peek('market_orders', 'update', values)), JSON.stringify(values)).toEqual(['market_orders']);
    expect(await peek('market_orders', 'update', { note: 'leave at the door' })).toBeNull();
    expect(await peek('market_orders', 'delete', null)).toBeNull();
  });

  it('a rule that should run and cannot be asked refuses the write before anything is opened; one that is off, or not there, asks nobody', async () => {
    const unavailable = async (stepper: Stepper) => {
      const refused = await refusal(peek('market_order_lines', 'create', { order_id: 1 }, stepper));
      return [refused.code, refused.details];
    };
    const without = (over: Parameters<PriceWorld['runtimeWith']>[0]) => ({ ...s, adjuster: stepperOf({ ...w, runtime: w.runtimeWith(over) }).adjuster }) as Stepper;
    expect(await unavailable(without({ adjustDecider: () => null }))).toEqual(['POSTING_REFUSED', { reason: 'add-on-unavailable' }]);
    // No runtime at all: nothing can be told live from not there, so the write is refused rather than priced by nobody.
    const bare = stepperOf({ ...w, runtime: { ...w.runtime, adjuster: undefined } as never });
    expect(await unavailable(bare)).toEqual(['POSTING_REFUSED', { reason: 'add-on-unavailable' }]);
    // A change the price does not read is not refused even then.
    expect(await peek('market_order_lines', 'update', { discount: '1' }, bare)).toBeNull();
    // A rule the table carries that cannot be read as one is refused, never passed by — when its add-on is here to be asked.
    const { createAdjuster } = await import('../src/crud/adjust/step.js');
    const unread = createAdjuster({ ...s.kit, rulesOf: (target) => ({ ...s.kit.rulesOf(target)!, adjust: undefined }) as never });
    const refusedUnread = await refusal(unread.peek({ target: w.target('market_orders'), rules: { ...w.rules('market_orders')!, adjust: undefined } as never, action: 'create', values: {}, context: STAFF }));
    expect(refusedUnread.details).toEqual({ reason: 'add-on-unavailable' });
    // Project code on the table that keeps what was applied cannot run inside a save.
    const hooked = stepperOf(w);
    const refused = await refusal(
      (await import('../src/crud/adjust/step.js')).createAdjuster({ ...hooked.kit, hooked: async (target) => target.table.name === 'price_kit_applied' }).peek({ target: w.target('market_orders'), rules: w.rules('market_orders'), action: 'create', values: {}, context: STAFF }),
    );
    expect(refused.details).toEqual({ reason: 'hooked', table: 'price_kit_applied' });
  });
});

describe('a price rule whose add-on is not here, or is switched off', () => {
  it('with the add-on not installed, nobody is asked', async () => {
    const w = await priceWorld('sqlite', { noKit: true });
    try {
      const s = stepperOf(w);
      expect(await s.adjuster.peek({ target: w.target('market_order_lines'), rules: w.rules('market_order_lines'), action: 'create', values: { order_id: 1 }, context: STAFF })).toBeNull();
    } finally {
      await w.close();
    }
  });

  it('installed and not attached to the shop, nobody is asked either', async () => {
    const w = await priceWorld('sqlite', { attachTo: [] });
    try {
      const s = stepperOf(w);
      expect(await s.adjuster.peek({ target: w.target('market_orders'), rules: w.rules('market_orders'), action: 'create', values: {}, context: STAFF })).toBeNull();
    } finally {
      await w.close();
    }
  });
});
