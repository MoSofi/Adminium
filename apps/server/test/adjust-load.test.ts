// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT A PRICE QUESTION ASKS ABOUT — read against the test price add-on
 * installed by the real installer and attached to a shop, on every engine
 * this run can reach: an order's lines (and the rows that are no line), the
 * codes typed on it, each routed and looked up as every door routes one, the
 * add-on's own reads in order, and what is known of the customer — only when
 * the order says who that is was PROVED.
 */
import type { KyselyPlugin } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AdjustTooLarge, adjustCodeOf, adjustLineOf, findCodes, loadCodes, loadLines, loadOffers, loadOrder, loadPerson } from '../src/crud/adjust/load.js';
import type { CompiledAdjust } from '../src/crud/adjust/rule.js';
import { ledgerSettings } from '../src/crud/ledger-reads.js';
import { customerKeyOf } from '../src/public-api/customer-key.js';
import { SAMPLE_NOW, lineOf, priceWorld, seedOffers, type PriceWorld } from './adjust.helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

const keyOf = customerKeyOf('a-test-secret-of-some-length');

describe.each(LEGS)('what a price question asks about — %s', (dialect, available) => {
  let w: PriceWorld;
  let adjust: CompiledAdjust;
  let seeded: Awaited<ReturnType<typeof seedOffers>>;
  let order: number;
  let ada: number;
  const vouchers: Record<string, number> = {};
  const key = (address: string) => keyOf(w.h.connectionId, address);
  /** A handle that counts the statements issued through it. */
  const counting = () => {
    let n = 0;
    const plugin: KyselyPlugin = { transformQuery: (args) => ((n += 1), args.node), transformResult: async (args) => args.result };
    return { db: w.db.withPlugin(plugin), count: () => n };
  };

  beforeAll(async () => {
    if (!available) return;
    w = await priceWorld(dialect);
    adjust = w.rules('market_orders')!.adjust!;
    seeded = await seedOffers(w);
    ada = await w.insert('market_customers', { name: 'Ada', email: 'Ada@Example.com ' });
    // The worked order, by a customer who was proved; with a voided line and a fee, which are no lines.
    order = await w.insert('market_orders', { status: 'placed', customer_id: ada, customer_proved: true, subtotal: '64.50' });
    await w.insert('market_order_lines', { order_id: order, ...lineOf(w, 'Mug, speckled', 2) });
    await w.insert('market_order_lines', { order_id: order, ...lineOf(w, 'Canvas tote, natural', 2, { tag: 'gift' }) });
    await w.insert('market_order_lines', { order_id: order, ...lineOf(w, 'Notebook, A5', 1) });
    await w.insert('market_order_lines', { order_id: order, ...lineOf(w, 'Candle, fig', 1, { voided_at: '2026-09-30 09:00:00', discount: '1.80' }) });
    await w.insert('market_order_lines', { order_id: order, kind: 'fee', unit_price: '2.00', qty: 1, amount: '2.00' });
    // The codes the kit keeps beside the sample's: one switched off, two that fold alike, a discount code as long as a voucher's.
    await w.insert('price_kit_codes', { code: 'SLEEPY', offer_id: seeded.offers['Autumn 5'], active: false });
    await w.insert('price_kit_codes', { code: 'COOL10', offer_id: seeded.offers['Autumn 5'] });
    await w.insert('price_kit_codes', { code: 'C00L10', offer_id: seeded.offers['Autumn 5'] });
    await w.insert('price_kit_codes', { code: 'TWELVELONG12', offer_id: seeded.offers['Autumn 5'] });
    // A discount code that starts with a card's word, put there past every check: it is still never read as a code.
    await w.insert('price_kit_codes', { code: 'GCSUMMER', offer_id: seeded.offers['Autumn 5'] });
    vouchers['candle'] = await w.insert('price_kit_vouchers', { code: '7K2MW3HNQ4XP', worth: 'thing', what_table: w.refOf('market_items'), what_row: String(w.items['Candle, fig']), public_name: 'One candle' });
    vouchers['pack'] = await w.insert('price_kit_vouchers', { code: 'M9RD5PTC2HVT', worth: 'pack', uses_left: 6, public_name: 'Ten classes' });
    // A voucher whose bare twelve happen to start with a card's word, and one with a voucher's own.
    vouchers['gc'] = await w.insert('price_kit_vouchers', { code: 'GC4TQ8B7YDWN', worth: 'amount', value: '5.00' });
    vouchers['vc'] = await w.insert('price_kit_vouchers', { code: 'VCP3XF6ZKE8K', worth: 'amount', value: '5.00' });
  }, 240_000);
  afterAll(async () => {
    if (available) await w.close();
  });

  it.skipIf(!available)('an order is read by its key, plainly; one that is not there is nothing', async () => {
    const found = await loadOrder(w.db, w.table('market_orders'), adjust, order);
    expect(found).toMatchObject({ status: 'placed' });
    expect(Number(found!['customer_id'])).toBe(ada);
    expect(await loadOrder(w.db, w.table('market_orders'), adjust, 999_999)).toBeUndefined();
  });

  it.skipIf(!available)('the rows of every part come oldest first, each with its key; a voided row and a row of another kind are marked as no line', async () => {
    const stored = (await loadOrder(w.db, w.table('market_orders'), adjust, order))!;
    const lines = await loadLines(w.db, w.view(), adjust, stored);
    expect(lines.map((line) => [line.key.startsWith('p0:'), line.line])).toEqual([[true, true], [true, true], [true, true], [true, false], [true, false]]);
    expect(lines.map((line) => Number(line.row['qty']))).toEqual([2, 2, 1, 1, 1]);
    expect(lines[0]!.key).toBe(`p0:${String(lines[0]!.row['id'])}`);
    expect(lines.every((line) => line.table.id === w.table('market_order_lines').id && line.part.index === 0)).toBe(true);
    // Another order's rows are never among them.
    const other = await w.insert('market_orders', { status: 'open' });
    expect(await loadLines(w.db, w.view(), adjust, (await loadOrder(w.db, w.table('market_orders'), adjust, other))!)).toEqual([]);
  });

  it.skipIf(!available)('a line is handed with its price, quantity and amount as text at the order\'s places, and what it sells by a stored name and a key', async () => {
    const stored = (await loadOrder(w.db, w.table('market_orders'), adjust, order))!;
    const lines = (await loadLines(w.db, w.view(), adjust, stored)).filter((line) => line.line);
    const handed = lines.map((line, index) => adjustLineOf({ view: w.view(), line, index, places: 2, refOf: (tableId) => w.runtime.refOf(w.h.connectionId, tableId) }));
    expect(handed[0]).toEqual({
      key: lines[0]!.key,
      part: 0,
      index: 0,
      price: '14.00',
      quantity: '2',
      amount: '28.00',
      what: [
        { as: 'item', table: 'market:items', row: String(w.items['Mug, speckled']) },
        { as: 'category', table: 'market:categories', row: String(w.categories['Mugs']) },
      ],
      excluded: false,
      paidBy: null,
      kept: true,
    });
    // A tag is its own text, of no table; an empty one is left out.
    expect(handed[1]!.what).toEqual([
      { as: 'item', table: 'market:items', row: String(w.items['Canvas tote, natural']) },
      { as: 'category', table: 'market:categories', row: String(w.categories['Bags']) },
      { as: 'tag', table: '', row: 'gift' },
    ]);
    expect(handed.map((line) => line.amount)).toEqual(['28.00', '30.00', '6.50']);
  });

  it.skipIf(!available)('a line no offer reduces, a line a code pays for, and a line being given back are said so', async () => {
    const loaded = await w.insert('market_orders', { status: 'open' });
    await w.insert('market_order_lines', { order_id: loaded, unit_price: '50.00', qty: 1, amount: '50.00', card_load: '2026-09-30 09:00:00' });
    await w.insert('market_order_lines', { order_id: loaded, ...lineOf(w, 'Candle, fig', 1, { paid_by: vouchers['candle'] }) });
    const lines = await loadLines(w.db, w.view(), adjust, (await loadOrder(w.db, w.table('market_orders'), adjust, loaded))!);
    const handed = lines.map((line, index) => adjustLineOf({ view: w.view(), line, index, places: 2, refOf: (tableId) => tableId, ...(index === 1 ? { kept: false } : {}) }));
    expect(handed.map((line) => [line.excluded, line.paidBy, line.kept])).toEqual([[true, null, true], [false, String(vouchers['candle']), false]]);
  });

  it.skipIf(!available)('more lines than one question carries is too large', async () => {
    const big = await w.insert('market_orders', { status: 'open' });
    const values = Array.from({ length: 201 }, () => `(${String(big)}, 1.00, 1, 1.00)`).join(', ');
    await w.rows(`INSERT INTO market_order_lines (order_id, unit_price, qty, amount) VALUES ${values}`);
    await expect(loadLines(w.db, w.view(), adjust, (await loadOrder(w.db, w.table('market_orders'), adjust, big))!)).rejects.toBeInstanceOf(AdjustTooLarge);
    await w.rows(`DELETE FROM market_order_lines WHERE order_id = ${String(big)} AND id = (SELECT m FROM (SELECT MAX(id) AS m FROM market_order_lines WHERE order_id = ${String(big)}) AS last)`);
    expect(await loadLines(w.db, w.view(), adjust, (await loadOrder(w.db, w.table('market_orders'), adjust, big))!)).toHaveLength(200);
  });

  it.skipIf(!available)('a typed discount code is found however it is spelled; one switched off is no code at all', async () => {
    const found = await findCodes(w.db, w.adjuster(), ['welcome10', ' WELCOME-10 ', 'NOSUCHCODE', 'SLEEPY', '']);
    expect(found.map((code) => [code.typed, code.kind, code.id])).toEqual([
      ['welcome10', 'code', String(seeded.codes['WELCOME10'])],
      [' WELCOME-10 ', 'code', String(seeded.codes['WELCOME10'])],
      ['NOSUCHCODE', null, null],
      ['SLEEPY', null, null],
      ['', null, null],
    ]);
    expect(found[0]!.table?.id).toBe(w.table('price_kit_codes').id);
    expect(adjustCodeOf(w.adjuster(), found[0]!)).toMatchObject({ typed: 'welcome10', kind: 'code', row: { code: 'WELCOME10', offer_id: seeded.offers['Welcome 10'], active: true } });
    expect(adjustCodeOf(w.adjuster(), found[2]!)).toEqual({ typed: 'NOSUCHCODE', kind: null, row: null });
  });

  it.skipIf(!available)('two codes that fold alike: the one typed exactly is found, and a value that is neither finds no row', async () => {
    const found = await findCodes(w.db, w.adjuster(), ['COOL10', 'C00L10', 'CO0L10']);
    expect(found.map((code) => code.found?.['code'] ?? null)).toEqual(['COOL10', 'C00L10', null]);
  });

  it.skipIf(!available)('a voucher and a pack are found by their word, cut; a card is not a code', async () => {
    const found = await findCodes(w.db, w.adjuster(), ['VC-7K2M-W3HN-Q4XP', 'pk-m9rd-5ptc-2hvt', 'VC-M9RD-5PTC-2HVT', 'GC-7K2M-W3HN-Q4XP', 'VC-0000-0000-0000', 'GCSUMMER', 'gc-summer']);
    expect(found.map((code) => [code.kind, code.id])).toEqual([
      ['voucher', String(vouchers['candle'])],
      // Which of the two a row is, the row says: the word only says where to look.
      ['voucher', String(vouchers['pack'])],
      ['voucher', String(vouchers['pack'])],
      [null, null],
      [null, null],
      // A value that starts with a card's word is no reduction, whatever the codes table holds.
      [null, null],
      [null, null],
    ]);
    expect(found[0]!.table?.id).toBe(w.table('price_kit_vouchers').id);
    // The whole value was never looked for: a voucher is kept without its word.
    expect(adjustCodeOf(w.adjuster(), found[0]!).row).toMatchObject({ code: '7K2MW3HNQ4XP', worth: 'thing', public_name: 'One candle' });
  });

  it.skipIf(!available)('a value with no word is a discount code first, then a voucher of the voucher\'s length', async () => {
    const found = await findCodes(w.db, w.adjuster(), ['7K2M W3HN Q4XP', 'TWELVELONG12', '7K2MW3HNQ4X', 'GC4TQ8B7YDWN', 'VCP3XF6ZKE8K']);
    expect(found.map((code) => [code.kind, code.id])).toEqual([
      // A scanned voucher holds the bare stored code.
      ['voucher', String(vouchers['candle'])],
      // A discount code of the same length wins.
      ['code', expect.any(String)],
      // Of another length it is neither.
      [null, null],
      // A bare code that happens to start with a card's word, or with a voucher's own, is still found whole.
      ['voucher', String(vouchers['gc'])],
      ['voucher', String(vouchers['vc'])],
    ]);
  });

  it.skipIf(!available)('text that could be no code makes no query, and more codes than a question carries is too large', async () => {
    const log = counting();
    const found = await findCodes(log.db, w.adjuster(), ['no/such', 'x'.repeat(40), 'ünïcode']);
    expect(found.every((code) => code.kind === null)).toBe(true);
    expect(log.count()).toBe(0);
    await expect(findCodes(w.db, w.adjuster(), Array.from({ length: 13 }, (_, i) => `CODE${String(i)}`))).rejects.toBeInstanceOf(AdjustTooLarge);
  });

  it.skipIf(!available)('the codes typed on a stored order are its codes rows, oldest first — but an empty one and one marked removed', async () => {
    const first = await w.insert('market_order_codes', { order_id: order, typed: 'AUTUMN5' });
    await w.insert('market_order_codes', { order_id: order, typed: 'LAUNCH20', removed_at: '2026-09-30 09:30:00' });
    await w.insert('market_order_codes', { order_id: order, typed: null });
    await w.insert('market_order_codes', { order_id: order, typed: 'VC-7K2M-W3HN-Q4XP' });
    const stored = (await loadOrder(w.db, w.table('market_orders'), adjust, order))!;
    const codes = await loadCodes(w.db, w.view(), adjust, w.adjuster(), stored);
    expect(codes.map((code) => [code.typed, code.kind, Number(code.row?.['id']) === first])).toEqual([['AUTUMN5', 'code', true], ['VC-7K2M-W3HN-Q4XP', 'voucher', false]]);
    const other = await w.insert('market_orders', { status: 'open' });
    expect(await loadCodes(w.db, w.view(), adjust, w.adjuster(), (await loadOrder(w.db, w.table('market_orders'), adjust, other))!)).toEqual([]);
    for (let i = 0; i < 13; i += 1) await w.insert('market_order_codes', { order_id: other, typed: `CODE${String(i)}` });
    await expect(loadCodes(w.db, w.view(), adjust, w.adjuster(), (await loadOrder(w.db, w.table('market_orders'), adjust, other))!)).rejects.toBeInstanceOf(AdjustTooLarge);
  });

  it.skipIf(!available)('the add-on\'s reads run in order, each row the same on every engine; a read keyed by the typed codes reads only those', async () => {
    const settings = await ledgerSettings(w.adjuster(), w.db);
    expect(settings).toEqual({ id: expect.any(Number), misbehave: null });
    const reads = await loadOffers(w.db, w.adjuster(), { codes: [String(seeded.codes['AUTUMN5'])], now: SAMPLE_NOW, settings });
    // Only the offers that are on.
    expect(reads['offers']!.map((row) => row['name'])).toEqual(['Welcome 10', 'Monday mugs', 'Tote pair', 'Autumn 5', 'Launch week']);
    expect(reads['offers']![0]).toMatchObject({ first_order_only: false, combinable: true, max_per_customer: 1, starts_on: '2026-08-01', public_name: '{"de-DE":"Willkommen 10","en-US":"Welcome 10"}' });
    expect(reads['offers']![3]).toMatchObject({ max_uses: 100, uses: 20, ends_on: '2026-11-30' });
    // Money is text, never a float: `10` on an engine that keeps no trailing zeros, `10.00` on one that does.
    expect(reads['offers']!.map((row) => [typeof row['value'], Number(row['value'])])).toEqual([['string', 10], ['string', 15], ['string', 0], ['string', 5], ['string', 20]]);
    expect([typeof reads['offers']![3]!['min_spend'], Number(reads['offers']![3]!['min_spend'])]).toEqual(['string', 30]);
    expect(reads['typed']).toMatchObject([{ code: 'AUTUMN5', offer_id: seeded.offers['Autumn 5'] }]);
    // With no code typed the keyed read asks the database nothing.
    const log = counting();
    const bare = await loadOffers(log.db, w.adjuster(), { codes: [], now: SAMPLE_NOW, settings });
    expect(bare['typed']).toEqual([]);
    expect(log.count()).toBe(1);
  });

  it.skipIf(!available)('staff asking why are read every offer, the ended one too; an order priced again is read only what it took', async () => {
    const settings = await ledgerSettings(w.adjuster(), w.db);
    const all = await loadOffers(w.db, w.adjuster(), { codes: [], now: SAMPLE_NOW, settings, everything: true });
    expect(all['offers']!.map((row) => row['name'])).toContain('Summer close-out');
    expect(all['offers']).toHaveLength(6);
    const pinned = await loadOffers(w.db, w.adjuster(), { codes: [], now: SAMPLE_NOW, settings, only: new Set([String(seeded.offers['Tote pair']), String(seeded.offers['Welcome 10'])]) });
    expect(pinned['offers']!.map((row) => row['name'])).toEqual(['Welcome 10', 'Tote pair']);
    const none = await loadOffers(w.db, w.adjuster(), { codes: [], now: SAMPLE_NOW, settings, only: new Set() });
    expect(none['offers']).toEqual([]);
  });

  it.skipIf(!available)('more rows than a question carries, in one read, is too large', async () => {
    const narrow = { ...w.adjuster(), declared: { ...w.adjuster().declared, offers: [{ as: 'offers', table: 'offers', by: [], limit: 3 }] } };
    await expect(loadOffers(w.db, narrow, { codes: [], now: SAMPLE_NOW, settings: {} })).rejects.toBeInstanceOf(AdjustTooLarge);
    const wide = { ...w.adjuster(), declared: { ...w.adjuster().declared, offers: [{ as: 'offers', table: 'offers', by: [], limit: 6 }] } };
    expect((await loadOffers(w.db, wide, { codes: [], now: SAMPLE_NOW, settings: {} }))['offers']).toHaveLength(6);
  });

  it.skipIf(!available)('a proved customer: their key, their groups, what they used before, and their other orders that stand', async () => {
    await w.insert('price_kit_group_members', { member_key: key('ada@example.com'), group_id: 7 });
    await w.insert('price_kit_group_members', { member_key: key('ada@example.com'), group_id: 3 });
    await w.insert('price_kit_group_members', { member_key: key('tomas@example.com'), group_id: 9 });
    const use = (offer: string, state: string, customer = 'ada@example.com') => w.insert('price_kit_redemptions', { customer: key(customer), offer_id: seeded.offers[offer], state });
    await use('Welcome 10', 'counted');
    await use('Autumn 5', 'counted');
    await use('Autumn 5', 'held');
    await use('Autumn 5', 'back');
    await use('Launch week', 'counted', 'tomas@example.com');
    // Her other orders: one placed, one paid, one cancelled (which does not count), and somebody else's.
    for (const status of ['placed', 'paid', 'cancelled']) await w.insert('market_orders', { status, customer_id: ada, customer_proved: true });
    const tomas = await w.insert('market_customers', { name: 'Tomas', email: 'tomas@example.com' });
    await w.insert('market_orders', { status: 'placed', customer_id: tomas, customer_proved: true });

    const stored = (await loadOrder(w.db, w.table('market_orders'), adjust, order))!;
    const facts = await loadPerson(w.db, w.view(), adjust, w.adjuster(), stored, { orderTable: w.table('market_orders'), keyOf: key });
    // The address is compared as every door compares one: trimmed, in lower case.
    expect(facts).toEqual({ key: key('ada@example.com'), groups: ['3', '7'], orders: 2, uses: { [String(seeded.offers['Welcome 10'])]: 1, [String(seeded.offers['Autumn 5'])]: 2 } });
    // What this order's own open round holds is not counted against it.
    const own = await loadPerson(w.db, w.view(), adjust, w.adjuster(), stored, { orderTable: w.table('market_orders'), keyOf: key, own: { [String(seeded.offers['Autumn 5'])]: 1, [String(seeded.offers['Welcome 10'])]: 1 } });
    expect(own!.uses).toEqual({ [String(seeded.offers['Autumn 5'])]: 1 });
  });

  it.skipIf(!available)('a customer who was not proved is nobody: not one statement is issued, whoever the order names', async () => {
    const unproved = await w.insert('market_orders', { status: 'placed', customer_id: ada, customer_proved: false });
    const unsaid = await w.insert('market_orders', { status: 'placed', customer_id: ada });
    const nobody = await w.insert('market_orders', { status: 'placed', customer_proved: true });
    const log = counting();
    for (const id of [unproved, unsaid, nobody]) {
      const stored = (await loadOrder(w.db, w.table('market_orders'), adjust, id))!;
      expect(await loadPerson(log.db, w.view(), adjust, w.adjuster(), stored, { orderTable: w.table('market_orders'), keyOf: key })).toBeNull();
    }
    expect(log.count()).toBe(0);
    // Proved, with a customer who has no address: one read, and still nobody the add-on's rows could name.
    const blank = await w.insert('market_customers', { name: 'Walk-in' });
    const walkIn = await w.insert('market_orders', { status: 'placed', customer_id: blank, customer_proved: true });
    expect(await loadPerson(log.db, w.view(), adjust, w.adjuster(), (await loadOrder(w.db, w.table('market_orders'), adjust, walkIn))!, { orderTable: w.table('market_orders'), keyOf: key })).toBeNull();
    expect(log.count()).toBe(1);
  });
});
