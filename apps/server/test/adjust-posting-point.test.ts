// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT AN ORDER USED IS RECORDED ONCE, WHERE THE ORDER POSTS — through a real
 * write service, the price add-on's real deciding file answering both which
 * reductions an order has and which rows record what it used.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { priceWorld, seedOffers } from './adjust.helpers.js';
import type { WriteContext } from '../src/crud/write-context.js';
import { GUEST, refused, saveWorld, sentLine, type SaveWorld } from './adjust-save.helpers.js';
import { MARKET_ADJUST, marketManifest } from './fixtures/price-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';

const lines = (w: SaveWorld) => [sentLine(w, 'Mug, speckled', 2), sentLine(w, 'Canvas tote, natural', 2), sentLine(w, 'Notebook, A5', 1)];
const basket = (w: SaveWorld, codes: readonly string[] = [], order: Record<string, unknown> = {}) => ({
  table: 'market_orders',
  values: order,
  lists: {
    order_lines: { table: 'market_order_lines', via: 'order_id', rows: lines(w) },
    ...(codes.length === 0 ? {} : { order_codes: { table: 'market_order_codes', via: 'order_id', rows: codes.map((typed) => ({ typed })) } }),
  },
});

type Mode = 'paid' | 'held' | 'placed' | 'made';

/** The shop with a rule that records what an order used, and what a test reads of it. */
function recording(dialect: Parameters<typeof priceWorld>[0], mode: Mode) {
  const state = {} as { w: SaveWorld; seeded: Awaited<ReturnType<typeof seedOffers>> };
  const names = () => new Map(Object.entries(state.seeded.offers).map(([name, id]) => [id, name]));
  return {
    state,
    async open(): Promise<void> {
      state.w = saveWorld(await priceWorld(dialect, { market: marketManifest({}, MARKET_ADJUST, { uncapped: true, uses: mode }) }));
      state.seeded = await seedOffers(state.w, { timeless: true });
    },
    usesOf: async (name: string) => Number((await state.w.rows(`SELECT uses FROM price_kit_offers WHERE id = ${String(state.seeded.offers[name])}`))[0]!['uses']),
    codeUses: async (code: string) => Number((await state.w.rows(`SELECT uses FROM price_kit_codes WHERE code = '${code}'`))[0]!['uses']),
    /** What was recorded for an order: `<offer> <code?> <state> <amount>`, oldest first. */
    recorded: async (order: unknown) =>
      (await state.w.rows(`SELECT offer_id, code_id, state, amount FROM price_kit_redemptions WHERE source_row = '${String(order)}' ORDER BY id`)).map(
        (row) => `${row['offer_id'] === null ? '-' : (names().get(Number(row['offer_id'])) ?? '?')} ${row['code_id'] === null ? '-' : 'code'} ${String(row['state'])} ${Number(row['amount']).toFixed(2)}`,
      ),
    receipts: async (order: unknown) => (await state.w.rows(`SELECT phase, state FROM price_kit_postings WHERE source_row = '${String(order)}' ORDER BY id`)).map((row) => `${String(row['phase'])} ${String(row['state'])}`),
    move: (order: unknown, status: string, context?: WriteContext) => state.w.update('market_orders', order, { status }, context === undefined ? {} : { context }),
    /** A code kept for so many uses, of an offer that takes a tenth off. */
    async limited(code: string, max: number): Promise<void> {
      const offer = await state.w.insert('price_kit_offers', { name: code, kind: 'percent', value: '10.00', trigger: 'code', scope: 'order' });
      state.seeded.offers[code] = offer;
      await state.w.insert('price_kit_codes', { code, offer_id: offer, max_uses: max });
    },
  };
}

describe.each(LEGS)('uses are recorded where the order posts — %s', (dialect, available) => {
  const r = recording(dialect, 'paid');
  let w: SaveWorld;
  beforeAll(async () => {
    if (!available) return;
    await r.open();
    w = r.state.w;
    await r.limited('LAST3', 3);
  }, 240_000);
  afterAll(async () => {
    if (available) await w.close();
  });

  it.skipIf(!available)('an open order holds no use of a limited code; paying it records each use once, and asks the price once', async () => {
    const before = { autumn: await r.usesOf('Autumn 5'), pair: await r.usesOf('Tote pair'), code: await r.codeUses('AUTUMN5') };
    const made = await w.tree(basket(w, ['AUTUMN5']));
    const id = made.root['id'];
    // Lines added, a code typed, the order placed: nothing of it is a use yet.
    await w.create('market_order_lines', { order_id: id, ...sentLine(w, 'Greeting card', 1) });
    await r.move(id, 'placed');
    expect(await r.recorded(id)).toEqual([]);
    expect(await r.receipts(id)).toEqual([]);
    expect([await r.usesOf('Autumn 5'), await r.codeUses('AUTUMN5')]).toEqual([before.autumn, before.code]);
    const paid = await r.move(id, 'paid');
    // The pair, and five dollars off by the code: each written once, with what it took off.
    expect(await r.recorded(id)).toEqual(['Tote pair - counted 15.00', 'Autumn 5 code counted 5.00']);
    expect(await r.receipts(id)).toEqual(['post planned']);
    expect([await r.usesOf('Autumn 5'), await r.usesOf('Tote pair'), await r.codeUses('AUTUMN5')]).toEqual([before.autumn + 1, before.pair + 1, before.code + 1]);
    expect(paid.adjusted).toHaveLength(1);
    expect(paid.adjusted![0]).toMatchObject({ recorder: 'redeem', discount: '20.00' });
    expect(w.posted()).toMatchObject([{ posting: 'redeem', phase: 'post' }]);
  });

  it.skipIf(!available)('cancelling the order gives every use back', async () => {
    const before = { autumn: await r.usesOf('Autumn 5'), code: await r.codeUses('AUTUMN5') };
    const made = await w.tree(basket(w, ['AUTUMN5']));
    const id = made.root['id'];
    await r.move(id, 'placed');
    await r.move(id, 'paid');
    expect(await r.usesOf('Autumn 5')).toBe(before.autumn + 1);
    await r.move(id, 'cancelled');
    expect(await r.recorded(id)).toEqual(['Tote pair - back 15.00', 'Autumn 5 code back 5.00']);
    expect(await r.receipts(id)).toEqual(['post planned', 'reverse planned']);
    expect([await r.usesOf('Autumn 5'), await r.codeUses('AUTUMN5')]).toEqual([before.autumn, before.code]);
  });

  it.skipIf(!available)('an order that took nothing off records that it used nothing: no row, and a receipt all the same', async () => {
    const made = await w.tree({ table: 'market_orders', values: {}, lists: { order_lines: { table: 'market_order_lines', via: 'order_id', rows: [sentLine(w, 'Mug, speckled', 1)] } } });
    const id = made.root['id'];
    await r.move(id, 'placed');
    const paid = await r.move(id, 'paid');
    expect(paid.adjusted).toMatchObject([{ recorder: 'redeem', uses: [], discount: '0.00' }]);
    expect(await r.recorded(id)).toEqual([]);
    expect(await r.receipts(id)).toEqual(['post planned']);
    expect(w.posted()).toMatchObject([{ posting: 'redeem', phase: 'post', rows: 0 }]);
  });

  it.skipIf(!available)('of six orders paying at once with a code kept for three, three are paid and three are told it is used up', async () => {
    const orders: unknown[] = [];
    for (let n = 0; n < 6; n += 1) {
      const made = await w.tree(basket(w, ['LAST3']));
      await r.move(made.root['id'], 'placed');
      orders.push(made.root['id']);
    }
    const paid = await Promise.allSettled(orders.map((id) => r.move(id, 'paid')));
    expect(paid.filter((one) => one.status === 'fulfilled')).toHaveLength(3);
    for (const one of paid) {
      if (one.status === 'fulfilled') continue;
      expect((one.reason as { code?: string; details?: unknown }).code, String(one.reason)).toBe('ADJUST_REFUSED');
      expect((one.reason as { details?: unknown }).details).toEqual({ column: 'typed', reason: 'used-up' });
    }
    expect(await r.codeUses('LAST3')).toBe(3);
    const counted = await w.rows(`SELECT COUNT(*) AS n FROM price_kit_redemptions WHERE code_id IS NOT NULL AND state = 'counted' AND offer_id = ${String(r.state.seeded.offers['LAST3'])}`);
    expect(Number(counted[0]!['n'])).toBe(3);
    // The three that were refused are still placed, with the code on them and nothing recorded.
    const states = (await w.rows(`SELECT status FROM market_orders WHERE id IN (${orders.map(String).join(',')}) ORDER BY id`)).map((row) => String(row['status']));
    expect(states.filter((status) => status === 'paid')).toHaveLength(3);
    expect(states.filter((status) => status === 'placed')).toHaveLength(3);
  });

  it.skipIf(!available)('a record caught up later, for an order whose price already stands, writes what the order used and moves no price', async () => {
    const made = await w.tree(basket(w, ['AUTUMN5']));
    const id = made.root['id'];
    await r.move(id, 'placed');
    // Paid with nobody recording it (a save let through while the add-on could not be asked, say).
    await w.rows(`UPDATE market_orders SET status = 'paid' WHERE id = ${String(id)}`);
    const before = await w.figures(id);
    const system: WriteContext = { origin: 'automation', hops: 0, actor: { kind: 'system', id: null, label: 'Catch up' }, request: null };
    let told = 0;
    // Its offer was paused since: nobody is asked again, so nothing can be refused or taken off now.
    await w.rows(`UPDATE price_kit_offers SET status = 'paused' WHERE id = ${String(r.state.seeded.offers['Autumn 5'])}`);
    const posted = await w.writes
      .post({ target: w.target('market_orders'), pk: { id }, posting: 'redeem', phase: 'post', context: system, announce: async () => void (told += 1) })
      .finally(() => w.rows(`UPDATE price_kit_offers SET status = 'active' WHERE id = ${String(r.state.seeded.offers['Autumn 5'])}`));
    expect(posted).toMatchObject([{ posting: 'redeem', phase: 'post' }]);
    expect(told).toBe(1);
    expect(await r.recorded(id)).toEqual(['Tote pair - counted 15.00', 'Autumn 5 code counted 5.00']);
    expect(await r.receipts(id)).toEqual(['post planned']);
    expect(await w.figures(id)).toEqual(before);
    // Told again, it finds its phase done.
    expect(await w.writes.post({ target: w.target('market_orders'), pk: { id }, posting: 'redeem', phase: 'post', context: system, announce: async () => undefined })).toEqual([]);
    expect(await r.receipts(id)).toEqual(['post planned']);
  });

  it.skipIf(!available)('a use the ledger refuses under its lock is the code\'s own refusal — to a customer, not a valid code', async () => {
    // The add-on's price answer does not count (as one that read the count a moment too early would not): its ledger does, under the lock.
    await w.misbehave('adjust-uncounted');
    let id: unknown;
    try {
      const made = await w.tree(basket(w, ['LAST3']));
      id = made.root['id'];
      await r.move(id, 'placed');
      const desk = await refused(r.move(id, 'paid'));
      expect([desk.code, desk.details]).toEqual(['ADJUST_REFUSED', { column: 'typed', reason: 'used-up' }]);
      const guest = await refused(r.move(id, 'paid', GUEST));
      expect((guest.details as { fields?: unknown }).fields).toEqual({ typed: { code: 'unknown' } });
    } finally {
      await w.misbehave(null);
    }
    expect(await r.receipts(id)).toEqual([]);
    expect(await r.codeUses('LAST3')).toBe(3);
  });
});

describe.each(LEGS)('once what an order used is recorded, it is closed — %s', (dialect, available) => {
  const r = recording(dialect, 'placed');
  let w: SaveWorld;
  beforeAll(async () => {
    if (!available) return;
    await r.open();
    w = r.state.w;
  }, 240_000);
  afterAll(async () => {
    if (available) await w.close();
  });
  const open = { reason: 'receipt-open', posting: 'redeem' };

  it.skipIf(!available)('a code cannot be added, changed or taken off, nor the reduction by hand or the customer', async () => {
    const customer = await w.create('market_customers', { name: 'Ada', email: 'ada@example.com' });
    const made = await w.tree(basket(w, ['AUTUMN5']));
    const id = made.root['id'];
    const [code] = made.rows.filter((row) => row.node.name === 'order_codes').map((row) => row.record['id']);
    await r.move(id, 'placed');
    expect(await r.receipts(id)).toEqual(['post planned']);
    const before = { figures: await w.figures(id), recorded: await r.recorded(id) };
    const tries: [string, () => Promise<unknown>][] = [
      ['a code added', () => w.create('market_order_codes', { order_id: id, typed: 'WELCOME10' })],
      ['a code retyped', () => w.update('market_order_codes', code, { typed: 'WELCOME10' })],
      ['a code taken off', () => w.update('market_order_codes', code, { removed_at: new Date().toISOString() })],
      ['a code deleted', () => w.remove('market_order_codes', code)],
      ['a reduction by hand', () => w.update('market_orders', id, { staff_kind: 'percent', staff_value: '5' })],
      ['the customer', () => w.update('market_orders', id, { customer_id: customer['id'] })],
    ];
    for (const [what, run] of tries) {
      const no = await refused(run());
      expect([no.code, no.details], what).toEqual(['POSTING_REFUSED', open]);
    }
    expect({ figures: await w.figures(id), recorded: await r.recorded(id) }).toEqual(before);
    expect(await r.receipts(id)).toEqual(['post planned']);
  });

  it.skipIf(!available)('an order placed with nothing off is closed like any other: a code typed afterwards is refused, never taken for free', async () => {
    const made = await w.tree({ table: 'market_orders', values: {}, lists: { order_lines: { table: 'market_order_lines', via: 'order_id', rows: [sentLine(w, 'Mug, speckled', 3)] } } });
    const id = made.root['id'];
    await r.move(id, 'placed');
    expect(await r.receipts(id)).toEqual(['post planned']);
    const uses = await r.codeUses('AUTUMN5');
    const typed = await refused(w.create('market_order_codes', { order_id: id, typed: 'AUTUMN5' }));
    expect([typed.code, typed.details]).toEqual(['POSTING_REFUSED', open]);
    expect(await w.figures(id)).toMatchObject({ subtotal: '42.00', discount: '0.00' });
    expect(await r.codeUses('AUTUMN5')).toBe(uses);
    // A line is still its to add — at its own price: no offer is ever its again.
    await w.create('market_order_lines', { order_id: id, ...sentLine(w, 'Canvas tote, natural', 2) });
    expect(await w.figures(id)).toMatchObject({ subtotal: '72.00', discount: '0.00' });
  });

  it.skipIf(!available)('a line added, changed or taken away is priced under the recorded uses: no second receipt, no offer that came later', async () => {
    const made = await w.tree(basket(w, ['AUTUMN5']));
    const id = made.root['id'];
    const [mugs, totes] = made.rows.filter((row) => row.node.name === 'order_lines').map((row) => row.record['id']);
    await r.move(id, 'placed');
    const recorded = await r.recorded(id);
    const uses = await r.usesOf('Autumn 5');
    // An offer switched on after the order was placed: nothing the order ever had.
    const flash = await w.insert('price_kit_offers', { name: 'Flash 50', kind: 'percent', value: '50.00', trigger: 'auto', scope: 'order' });
    try {
      await w.create('market_order_lines', { order_id: id, ...sentLine(w, 'Greeting card', 2) });
      // 71.50 of goods, the pair, then 5.00 off: as before the flash, never half off.
      expect(await w.figures(id)).toMatchObject({ subtotal: '71.50', discount: '20.00' });
      await w.update('market_order_lines', mugs, { qty: 3 });
      expect(await w.figures(id)).toMatchObject({ subtotal: '85.50', discount: '20.00' });
      // One tote fewer: the pair is no pair any more, and comes off the price — the use it recorded stands as it was written.
      await w.update('market_order_lines', totes, { qty: 1 });
      expect(await w.figures(id)).toMatchObject({ subtotal: '70.50', discount: '5.00' });
      // …and two totes again are a pair again: the order has that offer, by its record, though nothing of it was applied a moment ago.
      await w.update('market_order_lines', totes, { qty: 2 });
      expect(await w.figures(id)).toMatchObject({ subtotal: '85.50', discount: '20.00' });
      // The code switched off, then its offer paused: for the shop, from now on — the order has them, and keeps them.
      await w.rows(`UPDATE price_kit_codes SET active = ${w.flag(false)} WHERE code = 'AUTUMN5'`);
      try {
        await w.update('market_order_lines', mugs, { qty: 2 });
        expect(await w.figures(id)).toMatchObject({ subtotal: '71.50', discount: '20.00' });
        // To anybody else it is no code at all.
        expect((await refused(w.tree(basket(w, ['AUTUMN5'])))).details).toEqual({ column: 'typed', reason: 'unknown' });
        await w.rows(`UPDATE price_kit_offers SET status = 'paused' WHERE id = ${String(r.state.seeded.offers['Autumn 5'])}`);
        await w.update('market_order_lines', mugs, { qty: 3 });
        expect(await w.figures(id)).toMatchObject({ subtotal: '85.50', discount: '20.00' });
        await w.update('market_order_lines', mugs, { qty: 2 });
      } finally {
        await w.rows(`UPDATE price_kit_offers SET status = 'active' WHERE id = ${String(r.state.seeded.offers['Autumn 5'])}`);
        await w.rows(`UPDATE price_kit_codes SET active = ${w.flag(true)} WHERE code = 'AUTUMN5'`);
      }
      await w.update('market_order_lines', totes, { qty: 1 });
      expect(await r.recorded(id)).toEqual(recorded);
      expect(await r.receipts(id)).toEqual(['post planned']);
      expect(await r.usesOf('Autumn 5')).toBe(uses);
      // A new order is offered the flash like anybody.
      const fresh = await w.tree(basket(w));
      expect(Number((await w.figures(fresh.root['id']))['discount'])).toBeGreaterThan(20);
    } finally {
      await w.rows(`DELETE FROM price_kit_applied WHERE offer_id = ${String(flash)}`);
      await w.rows(`DELETE FROM price_kit_offers WHERE id = ${String(flash)}`);
    }
    // Paid, its price stands for good; cancelled, what it used is given back — once.
    await r.move(id, 'paid');
    expect(await r.receipts(id)).toEqual(['post planned']);
    await r.move(id, 'cancelled');
    expect(await r.receipts(id)).toEqual(['post planned', 'reverse planned']);
    expect(await r.usesOf('Autumn 5')).toBe(uses - 1);
  });
});

describe.each(LEGS)('a use held from the moment an order is placed — %s', (dialect, available) => {
  const r = recording(dialect, 'held');
  let w: SaveWorld;
  beforeAll(async () => {
    if (!available) return;
    await r.open();
    w = r.state.w;
    await r.limited('ONCE1', 1);
  }, 240_000);
  afterAll(async () => {
    if (available) await w.close();
  });

  it.skipIf(!available)('is the order\'s own: it does not count against it when it posts, and it does against everybody else', async () => {
    const first = await w.tree(basket(w, ['ONCE1']));
    const id = first.root['id'];
    await r.move(id, 'placed');
    expect(await r.recorded(id)).toEqual(['Tote pair - held 15.00', 'ONCE1 code held 4.95']);
    expect(await r.receipts(id)).toEqual(['reserve planned']);
    expect(await r.codeUses('ONCE1')).toBe(1);
    // The one use is taken: another order typing the code is told so.
    const other = await w.tree(basket(w));
    const taken = await refused(w.create('market_order_codes', { order_id: other.root['id'], typed: 'ONCE1' }));
    expect(taken.details).toEqual({ column: 'typed', reason: 'used-up' });
    // A line added while it is held is priced with the held use left out of the count.
    await w.create('market_order_lines', { order_id: id, ...sentLine(w, 'Greeting card', 2) });
    expect(await w.figures(id)).toMatchObject({ subtotal: '71.50', discount: '20.65' });
    // Paid: what was held is counted, never written twice.
    await r.move(id, 'paid');
    expect(await r.recorded(id)).toEqual(['Tote pair - counted 15.00', 'ONCE1 code counted 4.95']);
    expect(await r.receipts(id)).toEqual(['reserve planned', 'post planned']);
    expect(await r.codeUses('ONCE1')).toBe(1);
  });

  it.skipIf(!available)('does not count against its own customer either: a code kept for one use a customer is held, then counted, by the same order', async () => {
    const ada = await w.create('market_customers', { name: 'Ada', email: 'ada@example.com' });
    // Staff name the customer: proved. WELCOME10 is theirs once.
    const made = await w.tree(basket(w, ['WELCOME10'], { customer_id: ada['id'] }));
    const id = made.root['id'];
    await r.move(id, 'placed');
    expect(await r.recorded(id)).toEqual(['Tote pair - held 15.00', 'Welcome 10 code held 4.95']);
    // Priced again while it is held, and paid: its own held use is not a use "already made".
    await w.create('market_order_lines', { order_id: id, ...sentLine(w, 'Greeting card', 2) });
    expect(await w.figures(id)).toMatchObject({ subtotal: '71.50', discount: '20.65' });
    // (Even an add-on that judges by the customer's count alone: the count Adminium hands it leaves this order's own use out.)
    await w.misbehave('own-not-kept');
    try {
      await w.create('market_order_lines', { order_id: id, ...sentLine(w, 'Greeting card', 1) });
      expect(await w.figures(id)).toMatchObject({ subtotal: '75.00', discount: '21.00' });
      await r.move(id, 'paid');
    } finally {
      await w.misbehave(null);
    }
    expect(await r.recorded(id)).toEqual(['Tote pair - counted 15.00', 'Welcome 10 code counted 4.95']);
    // A second order of theirs is told they have used it.
    const again = await refused(w.tree(basket(w, ['WELCOME10'], { customer_id: ada['id'] })));
    expect(again.details).toMatchObject({ column: 'typed', reason: 'over-limit' });
  });

  it.skipIf(!available)('is given back when the order is cancelled, for the next order to take', async () => {
    await r.limited('ONCE2', 1);
    const first = await w.tree(basket(w, ['ONCE2']));
    await r.move(first.root['id'], 'placed');
    expect(await r.codeUses('ONCE2')).toBe(1);
    await r.move(first.root['id'], 'cancelled');
    expect(await r.recorded(first.root['id'])).toEqual(['Tote pair - back 15.00', 'ONCE2 code back 4.95']);
    expect(await r.codeUses('ONCE2')).toBe(0);
    const next = await w.tree(basket(w, ['ONCE2']));
    await r.move(next.root['id'], 'placed');
    expect(await r.codeUses('ONCE2')).toBe(1);
  });
});

describe.each(LEGS)('an order that records what it used as it is made — %s', (dialect, available) => {
  const r = recording(dialect, 'made');
  let w: SaveWorld;
  beforeAll(async () => {
    if (!available) return;
    await r.open();
    w = r.state.w;
  }, 240_000);
  afterAll(async () => {
    if (available) await w.close();
  });

  it.skipIf(!available)('with its lines and a code in one write: each use written once, under the locks named from what was typed', async () => {
    const uses = await r.usesOf('Autumn 5');
    const made = await w.tree(basket(w, ['AUTUMN5']));
    const id = made.root['id'];
    expect(made.adjusted).toMatchObject([{ recorder: 'redeem', discount: '20.00' }]);
    expect(await r.recorded(id)).toEqual(['Tote pair - counted 15.00', 'Autumn 5 code counted 5.00']);
    expect(await r.receipts(id)).toEqual(['post planned']);
    expect(await r.usesOf('Autumn 5')).toBe(uses + 1);
    // A quote of the same write keeps nothing — no row, no receipt, no count.
    const receipts = Number((await w.rows('SELECT COUNT(*) AS n FROM price_kit_postings'))[0]!['n']);
    const quoted = await w.tree(basket(w, ['AUTUMN5']), { mode: 'dry' });
    expect(Number(quoted.root['total'])).toBe(48.06);
    expect(await r.usesOf('Autumn 5')).toBe(uses + 1);
    expect(Number((await w.rows('SELECT COUNT(*) AS n FROM price_kit_postings'))[0]!['n'])).toBe(receipts);
    // A code after the order is made is refused: what it used is recorded.
    expect((await refused(w.create('market_order_codes', { order_id: id, typed: 'WELCOME10' }))).details).toEqual({ reason: 'receipt-open', posting: 'redeem' });
    // Cancelled, every use is given back.
    await r.move(id, 'cancelled');
    expect(await r.recorded(id)).toEqual(['Tote pair - back 15.00', 'Autumn 5 code back 5.00']);
    expect(await r.usesOf('Autumn 5')).toBe(uses);
  });

  it.skipIf(!available)('a code that ran out refuses the whole write, on the row it was typed into, and nothing is kept', async () => {
    await r.limited('ONLY1', 1);
    await w.tree(basket(w, ['ONLY1']));
    const orders = Number((await w.rows('SELECT COUNT(*) AS n FROM market_orders'))[0]!['n']);
    const second = await refused(w.tree(basket(w, ['ONLY1'])));
    expect([second.code, second.details, second.at]).toEqual(['ADJUST_REFUSED', { column: 'typed', reason: 'used-up' }, ['order_codes', 0]]);
    // The same when only the ledger counts.
    await w.misbehave('adjust-uncounted');
    try {
      const third = await refused(w.tree(basket(w, ['ONLY1'])));
      expect([third.code, third.details, third.at]).toEqual(['ADJUST_REFUSED', { column: 'typed', reason: 'used-up' }, ['order_codes', 0]]);
    } finally {
      await w.misbehave(null);
    }
    expect(Number((await w.rows('SELECT COUNT(*) AS n FROM market_orders'))[0]!['n'])).toBe(orders);
    expect(await r.codeUses('ONLY1')).toBe(1);
  });
});

describe('with the price rule switched off, the rule that records uses starts nothing', () => {
  it('an order paid while it is off counts nothing new and gives nothing back; cancelled, what it held is still given back', async () => {
    const r = recording('sqlite', 'held');
    await r.open();
    const w = r.state.w;
    try {
      const made = await w.tree(basket(w, ['AUTUMN5']));
      const id = made.root['id'];
      await r.move(id, 'placed');
      expect(await r.recorded(id)).toEqual(['Tote pair - held 15.00', 'Autumn 5 code held 5.00']);
      const uses = await r.usesOf('Autumn 5');
      const { overridesRepo } = await import('@adminium/meta');
      await overridesRepo(w.h.meta).create({ connectionId: w.h.connectionId, op: 'table.switchedOff', tableName: w.table('market_orders').id, columnName: null, value: { postings: [], adjust: true }, origin: 'user' } as never);
      await w.reload();
      const off = saveWorld(w);
      // Nobody is asked what the order used: nothing is counted, and what it holds is not taken for "no longer used".
      await off.update('market_orders', id, { status: 'paid' });
      expect(await r.recorded(id)).toEqual(['Tote pair - held 15.00', 'Autumn 5 code held 5.00']);
      expect(await r.receipts(id)).toEqual(['reserve planned']);
      expect(await r.usesOf('Autumn 5')).toBe(uses);
      await off.update('market_orders', id, { status: 'cancelled' });
      expect(await r.recorded(id)).toEqual(['Tote pair - back 15.00', 'Autumn 5 code back 5.00']);
      expect(await r.usesOf('Autumn 5')).toBe(uses - 1);
    } finally {
      await w.close();
    }
  }, 240_000);
});
