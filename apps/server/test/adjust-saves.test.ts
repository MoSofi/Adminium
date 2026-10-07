// SPDX-License-Identifier: AGPL-3.0-only
/**
 * REDUCTIONS ARE WORKED OUT INSIDE THE SAVE — through a real write service,
 * against the test price add-on installed by the real installer, on every
 * engine this run can reach. An order made with its lines and a code in one
 * write, a line added to it, changed, voided or taken away, a code typed or
 * taken off, a reduction given by hand: each save asks the price once, after
 * its rows are in and before its totals, and leaves the order adding up — or
 * leaves nothing at all.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { priceWorld, seedOffers } from './adjust.helpers.js';
import { GUEST, STAFF, refused, saveWorld, sentLine, type SaveWorld } from './adjust-save.helpers.js';
import { MARKET_ADJUST, WIDE_ADJUST, marketManifest } from './fixtures/price-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';

const totes = (w: SaveWorld) => [sentLine(w, 'Mug, speckled', 2), sentLine(w, 'Canvas tote, natural', 2), sentLine(w, 'Notebook, A5', 1)];
const basket = (w: SaveWorld, codes: readonly string[] = [], order: Record<string, unknown> = {}) => ({
  table: 'market_orders',
  values: order,
  lists: {
    order_lines: { table: 'market_order_lines', via: 'order_id', rows: totes(w) },
    ...(codes.length === 0 ? {} : { order_codes: { table: 'market_order_codes', via: 'order_id', rows: codes.map((typed) => ({ typed })) } }),
  },
});

describe.each(LEGS)('reductions inside the save — %s', (dialect, available) => {
  let w: SaveWorld;
  let seeded: Awaited<ReturnType<typeof seedOffers>>;

  beforeAll(async () => {
    if (!available) return;
    w = saveWorld(await priceWorld(dialect));
    // Saves are judged on the real clock: the sample's offers with no end, so the figures hold whatever day this runs.
    seeded = await seedOffers(w, { timeless: true });
  }, 240_000);
  afterAll(async () => {
    if (available) await w.close();
  });

  it.skipIf(!available)('an order made with its lines and a code in one write is priced in it: 48.06, with tax on the order\'s net', async () => {
    const made = await w.tree(basket(w, ['AUTUMN5']));
    const id = made.root['id'];
    // Tote pair 15.00, then 5.00 off split 2.83 / 1.51 / 0.66; tax is 8 % of 44.50, never the lines' taxes added up.
    expect(await w.figures(id)).toEqual({ subtotal: '64.50', discount: '20.00', net: '44.50', tax: '3.56', total: '48.06' });
    expect(await w.reductions(id)).toEqual(['2.83', '16.51', '0.66']);
    expect((await w.applied(id)).map((row) => row.replace(/^p0:\d+ /, ''))).toEqual(['offer 15.00', 'code 2.83 typed', 'code 1.51 typed', 'code 0.66 typed']);
    // The rows the write answers are the rows as the price left them.
    expect(Number(made.root['total'])).toBe(48.06);
    expect(made.rows.filter((row) => row.node.name === 'order_lines').map((row) => Number(row.record['discount']))).toEqual([2.83, 16.51, 0.66]);
    expect(made.adjusted).toHaveLength(1);
    expect(made.adjusted![0]).toMatchObject({ discount: '20.00', table: w.table('market_orders').id });
    const [code] = await w.rows(`SELECT code_id FROM market_order_codes WHERE order_id = ${String(id)}`);
    expect(Number(code!['code_id'])).toBe(seeded.codes['AUTUMN5']);
  });

  it.skipIf(!available)('a quote of the same order says the same figures and keeps nothing', async () => {
    const orders = async () => Number((await w.rows('SELECT COUNT(*) AS n FROM market_orders'))[0]!['n']);
    const before = await orders();
    const quoted = await w.tree(basket(w, ['AUTUMN5']), { mode: 'dry' });
    expect([Number(quoted.root['discount']), Number(quoted.root['net']), Number(quoted.root['tax']), Number(quoted.root['total'])]).toEqual([20, 44.5, 3.56, 48.06]);
    expect(quoted.adjusted![0]!.applied.map((entry) => [entry.kind, entry.amount])).toEqual([['offer', '15.00'], ['code', '2.83'], ['code', '1.51'], ['code', '0.66']]);
    expect(await orders()).toBe(before);
    expect(Number((await w.rows('SELECT COUNT(*) AS n FROM price_kit_applied'))[0]!['n'])).toBe(Number((await w.rows('SELECT COUNT(*) AS n FROM price_kit_applied'))[0]!['n']));
  });

  it.skipIf(!available)('a writer\'s own reduction is dropped: the price is Adminium\'s alone', async () => {
    const made = await w.tree({ table: 'market_orders', values: { discount: '60.00', customer_proved: true, staff_by: 'usr_eve' }, lists: { order_lines: { table: 'market_order_lines', via: 'order_id', rows: [sentLine(w, 'Mug, speckled', 2, { discount: '27.00' })] } } });
    expect(await w.figures(made.root['id'])).toMatchObject({ subtotal: '28.00', discount: '0.00', total: '30.24' });
    expect(await w.reductions(made.root['id'])).toEqual(['0.00']);
    const [row] = await w.rows(`SELECT customer_proved, staff_by FROM market_orders WHERE id = ${String(made.root['id'])}`);
    expect([row!['customer_proved'], row!['staff_by']]).toEqual([null, null]);
  });

  it.skipIf(!available)('adding a third line re-prices the order in the same save', async () => {
    const order = await w.create('market_orders', {});
    await w.create('market_order_lines', { order_id: order['id'], ...sentLine(w, 'Mug, speckled', 2) });
    expect(await w.figures(order['id'])).toEqual({ subtotal: '28.00', discount: '0.00', net: '28.00', tax: '2.24', total: '30.24' });
    await w.create('market_order_lines', { order_id: order['id'], ...sentLine(w, 'Canvas tote, natural', 1) });
    expect(await w.figures(order['id'])).toMatchObject({ subtotal: '43.00', discount: '0.00' });
    // The second tote makes the pair.
    const line = await w.create('market_order_lines', { order_id: order['id'], ...sentLine(w, 'Canvas tote, black', 1) });
    expect(await w.figures(order['id'])).toEqual({ subtotal: '59.00', discount: '15.00', net: '44.00', tax: '3.52', total: '47.52' });
    expect(await w.reductions(order['id'])).toEqual(['0.00', '15.00', '0.00']);
    // The row the save answers is the row as it stands.
    expect(Number(line['discount'])).toBe(0);
    expect((await w.applied(order['id'])).map((row) => row.replace(/^p0:\d+ /, ''))).toEqual(['offer 15.00']);
  });

  it.skipIf(!available)('a code typed on an open order, then taken off again: each a save of its own, the order adding up after each', async () => {
    const made = await w.tree(basket(w));
    const id = made.root['id'];
    expect(await w.figures(id)).toMatchObject({ discount: '15.00', total: '53.46' });
    const code = await w.create('market_order_codes', { order_id: id, typed: 'autumn5' });
    expect(await w.figures(id)).toEqual({ subtotal: '64.50', discount: '20.00', net: '44.50', tax: '3.56', total: '48.06' });
    expect(await w.reductions(id)).toEqual(['2.83', '16.51', '0.66']);
    // The link the code found is on the row the save answers.
    expect(Number(code['code_id'])).toBe(seeded.codes['AUTUMN5']);
    await w.update('market_order_codes', code['id'], { removed_at: '2026-09-30T10:05:00.000Z' });
    expect(await w.figures(id)).toMatchObject({ discount: '15.00', total: '53.46' });
    expect(await w.reductions(id)).toEqual(['0.00', '15.00', '0.00']);
    // …and typed again as another row, then that row deleted.
    const again = await w.create('market_order_codes', { order_id: id, typed: 'AUTUMN5' });
    expect(await w.figures(id)).toMatchObject({ discount: '20.00' });
    expect(await w.remove('market_order_codes', again['id'])).toBe(1);
    expect(await w.figures(id)).toMatchObject({ discount: '15.00', total: '53.46' });
    expect((await w.applied(id)).map((row) => row.replace(/^p0:\d+ /, ''))).toEqual(['offer 15.00']);
  });

  it.skipIf(!available)('a code that does not stand refuses the save, and the row it was typed into is not kept', async () => {
    const made = await w.tree(basket(w));
    const id = made.root['id'];
    const refusal = await refused(w.create('market_order_codes', { order_id: id, typed: 'LAUNCH20' }));
    expect([refusal.code, refusal.details]).toEqual(['ADJUST_REFUSED', { column: 'typed', reason: 'used-up' }]);
    expect(Number((await w.rows(`SELECT COUNT(*) AS n FROM market_order_codes WHERE order_id = ${String(id)}`))[0]!['n'])).toBe(0);
    expect(await w.figures(id)).toMatchObject({ discount: '15.00', total: '53.46' });
    // In one write with the order, the refusal says which row of the tree it is about, and nothing of the tree is kept.
    const orders = Number((await w.rows('SELECT COUNT(*) AS n FROM market_orders'))[0]!['n']);
    const whole = await refused(w.tree(basket(w, ['AUTUMN5', 'LAUNCH20'])));
    expect([whole.code, whole.details, whole.at]).toEqual(['ADJUST_REFUSED', { column: 'typed', reason: 'used-up' }, ['order_codes', 1]]);
    expect(Number((await w.rows('SELECT COUNT(*) AS n FROM market_orders'))[0]!['n'])).toBe(orders);
    // A customer hears it as not a valid code, on the same row.
    const guest = await refused(w.tree(basket(w, ['LAUNCH20']), { context: GUEST }));
    expect([guest.code, guest.details, guest.at]).toEqual(['VALIDATION_FAILED', { fields: { typed: { code: 'unknown' } } }, ['order_codes', 0]]);
  });

  it.skipIf(!available)('a line changed where the price reads it is priced again; a change it does not read asks nobody', async () => {
    const made = await w.tree(basket(w, ['AUTUMN5']));
    const id = made.root['id'];
    const [mugs, bags] = made.rows.filter((row) => row.node.name === 'order_lines').map((row) => row.record['id']);
    // One tote: no pair. 5.00 off 49.50, split 2.83 / 1.51 / 0.66.
    const changed = await w.update('market_order_lines', bags, { qty: 1 });
    expect(Number(changed.after!['discount'])).toBe(1.51);
    expect(await w.figures(id)).toEqual({ subtotal: '49.50', discount: '5.00', net: '44.50', tax: '3.56', total: '48.06' });
    expect(await w.reductions(id)).toEqual(['2.83', '1.51', '0.66']);
    expect((await w.applied(id)).map((row) => row.replace(/^p0:\d+ /, ''))).toEqual(['code 2.83 typed', 'code 1.51 typed', 'code 0.66 typed']);
    // The add-on told to throw: a change the price does not read never reaches it.
    await w.misbehave('throw');
    try {
      await w.update('market_orders', id, { note: 'leave at the door' });
      const said = await refused(w.update('market_order_lines', mugs, { qty: 3 }));
      expect(said.details).toEqual({ reason: 'planner-failed' });
    } finally {
      await w.misbehave(null);
    }
    // …and the refused change left the line as it was.
    expect(Number((await w.rows(`SELECT qty FROM market_order_lines WHERE id = ${String(mugs)}`))[0]!['qty'])).toBe(2);
    expect(await w.figures(id)).toMatchObject({ subtotal: '49.50', discount: '5.00' });
  });

  it.skipIf(!available)('a voided line is no line: its reduction is taken off again, and the minimum no longer counts it', async () => {
    const made = await w.tree(basket(w, ['AUTUMN5']));
    const id = made.root['id'];
    const [mugs, bags] = made.rows.filter((row) => row.node.name === 'order_lines').map((row) => row.record['id']);
    await w.update('market_order_lines', bags, { voided_at: '2026-09-30T10:05:00.000Z' });
    // 28.00 + 6.50 = 34.50 of goods: the code still stands; the totes carry nothing.
    expect(await w.reductions(id)).toEqual(['4.06', '0.00', '0.94']);
    // With the mugs voided too, 6.50 is under the code's 30.00: the save that voids them is refused, the code being on the order.
    const said = await refused(w.update('market_order_lines', mugs, { voided_at: '2026-09-30T10:06:00.000Z' }));
    expect(said.details).toEqual({ column: 'typed', reason: 'needs-minimum', amount: '30.00' });
    expect(await w.reductions(id)).toEqual(['4.06', '0.00', '0.94']);
  });

  it.skipIf(!available)('a line taken away re-prices the order, and what was applied to it goes', async () => {
    const made = await w.tree(basket(w, ['AUTUMN5']));
    const id = made.root['id'];
    const lines = made.rows.filter((row) => row.node.name === 'order_lines').map((row) => row.record['id']);
    expect(await w.remove('market_order_lines', lines[2])).toBe(1);
    // 58.00 of goods, the pair, then 5.00 off 43.00: 3.26 / 1.74.
    expect(await w.figures(id)).toEqual({ subtotal: '58.00', discount: '20.00', net: '38.00', tax: '3.04', total: '41.04' });
    expect(await w.reductions(id)).toEqual(['3.26', '16.74']);
    expect(await w.applied(id)).toHaveLength(3);
  });

  it.skipIf(!available)('a line no offer reduces is never reduced', async () => {
    const made = await w.tree({
      table: 'market_orders',
      values: {},
      lists: {
        order_lines: { table: 'market_order_lines', via: 'order_id', rows: [sentLine(w, 'Mug, speckled', 2), { unit_price: '50.00', qty: 1, card_load: '2026-09-30T09:00:00.000Z' }, sentLine(w, 'Greeting card', 1)] },
        order_codes: { table: 'market_order_codes', via: 'order_id', rows: [{ typed: 'AUTUMN5' }] },
      },
    });
    // 31.50 of goods (the load counts for nothing): 5.00 off, split 4.44 / 0.56.
    expect(await w.reductions(made.root['id'])).toEqual(['4.44', '0.00', '0.56']);
    expect(await w.figures(made.root['id'])).toMatchObject({ subtotal: '81.50', discount: '5.00', net: '76.50' });
  });

  it.skipIf(!available)('what staff take off by hand is priced in the save that sets it, and in every save after', async () => {
    const made = await w.tree(basket(w));
    const id = made.root['id'];
    await w.update('market_orders', id, { staff_kind: 'percent', staff_value: '10', staff_reason: 'Goodwill' });
    // The pair, then ten percent of 49.50.
    expect(await w.figures(id)).toEqual({ subtotal: '64.50', discount: '19.95', net: '44.55', tax: '3.56', total: '48.11' });
    expect((await w.applied(id)).filter((row) => row.includes('staff'))).toHaveLength(3);
    await w.create('market_order_lines', { order_id: id, ...sentLine(w, 'Greeting card', 1) });
    // …of 53.00 now.
    expect(await w.figures(id)).toMatchObject({ subtotal: '68.00', discount: '20.30', net: '47.70' });
    await w.update('market_orders', id, { staff_kind: 'none' });
    expect(await w.figures(id)).toMatchObject({ discount: '15.00' });
  });

  it.skipIf(!available)('an order whose price stands is not priced again, and a change of what it rests on is refused', async () => {
    const made = await w.tree(basket(w, ['AUTUMN5']));
    const id = made.root['id'];
    const lines = made.rows.filter((row) => row.node.name === 'order_lines').map((row) => row.record['id']);
    await w.update('market_orders', id, { status: 'placed' });
    await w.update('market_orders', id, { status: 'paid' });
    const frozen = { reason: 'frozen' };
    expect((await refused(w.create('market_order_lines', { order_id: id, ...sentLine(w, 'Greeting card', 1) }))).details).toEqual(frozen);
    expect((await refused(w.update('market_order_lines', lines[0], { qty: 5 }))).details).toEqual(frozen);
    expect((await refused(w.remove('market_order_lines', lines[0]))).details).toEqual(frozen);
    expect((await refused(w.create('market_order_codes', { order_id: id, typed: 'AUTUMN5' }))).details).toEqual(frozen);
    expect((await refused(w.update('market_orders', id, { staff_kind: 'percent', staff_value: '50' }))).details).toEqual(frozen);
    // What the price does not read is still written; and a whole-row send that repeats what is stored changes nothing it rests on.
    await w.update('market_orders', id, { note: 'paid at the till' });
    await w.update('market_orders', id, { note: 'again', staff_kind: 'none', staff_value: null, customer_id: null });
    await w.update('market_order_lines', lines[1], { note: 'for the kitchen', qty: 2, unit_price: '15.00', voided_at: null });
    expect(await w.figures(id)).toEqual({ subtotal: '64.50', discount: '20.00', net: '44.50', tax: '3.56', total: '48.06' });
    expect(Number((await w.rows(`SELECT COUNT(*) AS n FROM market_order_lines WHERE order_id = ${String(id)}`))[0]!['n'])).toBe(3);
  });

  it.skipIf(!available)('an answer that fails leaves one audit row with the word for why, and nothing of the save', async () => {
    const made = await w.tree(basket(w));
    const id = made.root['id'];
    const refusals: unknown[] = [];
    const service = w.service(w.runtimeWith({ refused: async (event) => void refusals.push(event) }));
    await w.misbehave('wrong-sum');
    try {
      const said = await refused(w.create('market_order_lines', { order_id: id, ...sentLine(w, 'Greeting card', 1) }, STAFF, service));
      // The person saving is told nothing of why.
      expect([said.code, said.details]).toEqual(['POSTING_REFUSED', { reason: 'planner-failed' }]);
    } finally {
      await w.misbehave(null);
    }
    expect(refusals).toEqual([{ connectionId: w.h.connectionId, table: w.table('market_order_lines').id, reason: 'planner-failed', cause: 'check', detail: expect.stringContaining('is not the sum'), actor: STAFF.actor }]);
    expect(Number((await w.rows(`SELECT COUNT(*) AS n FROM market_order_lines WHERE order_id = ${String(id)}`))[0]!['n'])).toBe(3);
  });

  it.skipIf(!available)('the save that moves an order to where its price stands prices it one last time', async () => {
    const made = await w.tree(basket(w, ['AUTUMN5']));
    const id = made.root['id'];
    await w.update('market_orders', id, { status: 'placed' });
    // Autumn 5 has ended since the order was made: the save that pays the order asks once more, and the code no longer stands.
    await w.rows(`UPDATE price_kit_offers SET status = 'ended' WHERE id = ${String(seeded.offers['Autumn 5'])}`);
    try {
      const said = await refused(w.update('market_orders', id, { status: 'paid' }));
      expect(said.details).toMatchObject({ column: 'typed' });
      expect((await w.rows(`SELECT status FROM market_orders WHERE id = ${String(id)}`))[0]!['status']).toBe('placed');
    } finally {
      await w.rows(`UPDATE price_kit_offers SET status = 'active' WHERE id = ${String(seeded.offers['Autumn 5'])}`);
    }
    await w.update('market_orders', id, { status: 'paid' });
    expect(await w.figures(id)).toMatchObject({ discount: '20.00', total: '48.06' });
  });

  it.skipIf(!available)('an order made smaller than what was already paid is refused, until the difference is given back', async () => {
    const made = await w.tree(basket(w));
    const id = made.root['id'];
    const lines = made.rows.filter((row) => row.node.name === 'order_lines').map((row) => row.record['id']);
    const due = async () => Number((await w.rows(`SELECT due FROM market_orders WHERE id = ${String(id)}`))[0]!['due']);
    expect(await due()).toBe(53.46);
    const payment = await w.create('market_payments', { order_id: id, amount: '53.46' });
    expect(await due()).toBe(0);
    // A code typed now would take 5.00 off an order that is paid in full: its total would fall under what was paid.
    const typed = await refused(w.create('market_order_codes', { order_id: id, typed: 'AUTUMN5' }));
    expect([typed.code, typed.statusCode]).toEqual(['BALANCE_EXCEEDED', 409]);
    // So would a reduction given by hand, and a line taken away.
    expect((await refused(w.update('market_orders', id, { staff_kind: 'amount', staff_value: '2.00' }))).code).toBe('BALANCE_EXCEEDED');
    expect((await refused(w.remove('market_order_lines', lines[2]))).code).toBe('BALANCE_EXCEEDED');
    // A quote of it says what the save would say.
    expect((await refused(w.update('market_orders', id, { staff_kind: 'amount', staff_value: '2.00' }, { mode: 'dry' }))).code).toBe('BALANCE_EXCEEDED');
    expect(await w.figures(id)).toMatchObject({ discount: '15.00', total: '53.46' });
    expect(Number((await w.rows(`SELECT COUNT(*) AS n FROM market_order_codes WHERE order_id = ${String(id)}`))[0]!['n'])).toBe(0);
    // With the difference given back first, the code is taken: 48.06 against 48.06 paid.
    await w.update('market_payments', payment['id'], { amount: '48.06' });
    expect(await due()).toBe(5.4);
    await w.create('market_order_codes', { order_id: id, typed: 'AUTUMN5' });
    expect(await w.figures(id)).toMatchObject({ discount: '20.00', total: '48.06' });
    expect(await due()).toBe(0);
  });

  it.skipIf(!available)('a paid order is judged on its totals as the whole save leaves them, never half-way', async () => {
    // A mug pair and one tote, paid in full: 43.00 and its tax.
    const made = await w.tree({ table: 'market_orders', values: {}, lists: { order_lines: { table: 'market_order_lines', via: 'order_id', rows: [sentLine(w, 'Mug, speckled', 2), sentLine(w, 'Canvas tote, natural', 1)] } } });
    const id = made.root['id'];
    await w.create('market_payments', { order_id: id, amount: '46.44' });
    // The second tote makes the pair: 16.00 more of goods and 15.00 off, so 1.08 more to pay. Judged half-way — the old goods less the new
    // reduction — the order would look paid over by sixteen dollars, and the line would be refused.
    await w.create('market_order_lines', { order_id: id, ...sentLine(w, 'Canvas tote, black', 1) });
    expect(await w.figures(id)).toEqual({ subtotal: '59.00', discount: '15.00', net: '44.00', tax: '3.52', total: '47.52' });
    expect(Number((await w.rows(`SELECT due FROM market_orders WHERE id = ${String(id)}`))[0]!['due'])).toBe(1.08);
  });

  it.skipIf(!available)('two saves at once on one order — a line and a code — leave it adding up', async () => {
    const made = await w.tree(basket(w));
    const id = made.root['id'];
    const both = await Promise.allSettled([
      w.create('market_order_lines', { order_id: id, ...sentLine(w, 'Greeting card', 2) }),
      w.create('market_order_codes', { order_id: id, typed: 'AUTUMN5' }),
    ]);
    expect(both.map((one) => one.status)).toEqual(['fulfilled', 'fulfilled']);
    // 71.50 of goods, the pair, then 5.00 off 56.50: whichever save came second priced the order as both left it.
    const figures = await w.figures(id);
    expect(figures).toMatchObject({ subtotal: '71.50', discount: '20.00', net: '51.50' });
    const reductions = await w.reductions(id);
    expect(reductions.reduce((sum, value) => sum + Math.round(Number(value) * 100), 0)).toBe(2000);
    const applied = await w.rows(`SELECT amount FROM price_kit_applied WHERE source_row = '${String(id)}'`);
    expect(applied.reduce((sum, row) => sum + Math.round(Number(row['amount']) * 100), 0)).toBe(2000);
  });
});

describe.each(LEGS)('saves at once on one order — %s', (dialect, available) => {
  let w: SaveWorld;
  beforeAll(async () => {
    if (!available) return;
    w = saveWorld(await priceWorld(dialect));
    await seedOffers(w, { timeless: true });
  }, 240_000);
  afterAll(async () => {
    if (available) await w.close();
  });

  // Each save waits for the order's row, then reads the order's lines and codes as the save before it left them — on every engine,
  // whatever it had read before it waited.
  it.skipIf(!available)('a line\'s quantity changed while a code is typed, and a line taken away while another is added: the order adds up each time', async () => {
    for (let round = 0; round < 6; round += 1) {
      const made = await w.tree(basket(w));
      const id = made.root['id'];
      const [mugs, , notebook] = made.rows.filter((row) => row.node.name === 'order_lines').map((row) => row.record['id']);
      const both = await Promise.allSettled([
        w.update('market_order_lines', mugs, { qty: 3 }),
        w.create('market_order_codes', { order_id: id, typed: 'AUTUMN5' }),
        w.remove('market_order_lines', notebook),
        w.create('market_order_lines', { order_id: id, ...sentLine(w, 'Greeting card', 2) }),
      ]);
      expect(both.map((one) => (one.status === 'rejected' ? String((one.reason as Error).message) : 'saved')), `round ${String(round)}`).toEqual(['saved', 'saved', 'saved', 'saved']);
      // Three mugs, two totes, two cards: 79.00 of goods; the pair, then 5.00 off 64.00.
      expect(await w.figures(id), `round ${String(round)}`).toEqual({ subtotal: '79.00', discount: '20.00', net: '59.00', tax: '4.72', total: '63.72' });
      const reductions = (await w.reductions(id)).reduce((sum, value) => sum + Math.round(Number(value) * 100), 0);
      const applied = (await w.rows(`SELECT amount FROM price_kit_applied WHERE source_row = '${String(id)}'`)).reduce((sum, row) => sum + Math.round(Number(row['amount']) * 100), 0);
      expect([reductions, applied], `round ${String(round)}`).toEqual([2000, 2000]);
    }
  });
});

describe.each(LEGS)('an order that goes, and rows written many at once — %s', (dialect, available) => {
  let w: SaveWorld;
  beforeAll(async () => {
    if (!available) return;
    w = saveWorld(await priceWorld(dialect, { market: marketManifest({}, MARKET_ADJUST, { uncapped: true }) }));
    await seedOffers(w, { timeless: true });
  }, 240_000);
  afterAll(async () => {
    if (available) await w.close();
  });

  it.skipIf(!available)('an order deleted takes the rows of what was applied to it with it', async () => {
    const kept = await w.tree(basket(w, ['AUTUMN5']));
    const gone = await w.tree(basket(w, ['AUTUMN5']));
    expect(await w.applied(gone.root['id'])).toHaveLength(4);
    // Its codes and its lines first, each a save of its own (the order's price is worked out again without each); then the order.
    for (const row of gone.rows.filter((one) => one.node.name === 'order_codes')) await w.remove(row.node.target.table.name, row.record['id']);
    for (const row of gone.rows.filter((one) => one.node.name === 'order_lines')) await w.remove(row.node.target.table.name, row.record['id']);
    expect(await w.applied(gone.root['id'])).toEqual([]);
    await w.tree({ table: 'market_orders', values: {}, lists: { order_lines: { table: 'market_order_lines', via: 'order_id', rows: totes(w).slice(1, 2) } } }).then(async (alone) => {
      expect(await w.applied(alone.root['id'])).toHaveLength(1);
      const [line] = alone.rows.filter((one) => one.node.name === 'order_lines');
      // The order goes while a row of what was applied still names it (its line is removed by the database with it, or kept: either way the rows go).
      await w.rows(`DELETE FROM market_order_lines WHERE id = ${String(line!.record['id'])}`);
      expect(await w.remove('market_orders', alone.root['id'])).toBe(1);
      expect(await w.applied(alone.root['id'])).toEqual([]);
    });
    // Another order's rows are not touched.
    expect(await w.applied(kept.root['id'])).toHaveLength(4);
  });

  it.skipIf(!available)('a write of many rows asks no price: a row that would move one is refused, to be saved on its own', async () => {
    const made = await w.tree(basket(w));
    const id = made.root['id'];
    const lines = w.target('market_order_lines');
    const refusedBy = async (run: Promise<unknown>) => (await refused(run)).details;
    const one = { reason: 'one-at-a-time' };
    // A bulk edit of what the price reads, a line made or taken away in a batch, a code typed in one.
    expect(await refusedBy(w.writes.check('update', lines, STAFF, [{ qty: 4 }]))).toMatchObject({ ...one, column: 'qty' });
    expect(await refusedBy(w.writes.check('create', lines, STAFF, [{ order_id: id, ...sentLine(w, 'Greeting card', 1) }]))).toMatchObject({ ...one, column: 'order_id' });
    expect(await refusedBy(w.writes.check('delete', lines, STAFF, [{}]))).toMatchObject(one);
    expect(await refusedBy(w.writes.check('create', w.target('market_order_codes'), STAFF, [{ order_id: id, typed: 'AUTUMN5' }]))).toMatchObject(one);
    expect(await refusedBy(w.writes.check('update', w.target('market_orders'), STAFF, [{ staff_kind: 'percent', staff_value: '10' }]))).toMatchObject({ ...one, column: 'staff_kind' });
    // An order made with a reduction on it, one moved to where its price stands, one taken away: each is priced, or cleared up after, on its own.
    expect(await refusedBy(w.writes.check('create', w.target('market_orders'), STAFF, [{ staff_kind: 'percent', staff_value: '10' }]))).toMatchObject({ ...one, column: 'staff_kind' });
    expect(await refusedBy(w.writes.check('update', w.target('market_orders'), STAFF, [{ status: 'paid' }]))).toMatchObject({ ...one, column: 'status' });
    expect(await refusedBy(w.writes.check('delete', w.target('market_orders'), STAFF, [{}]))).toMatchObject({ ...one, column: 'id' });
    await expect(w.writes.check('update', w.target('market_orders'), STAFF, [{ status: 'placed' }])).resolves.toMatchObject({ issues: [null] });
    // What the price does not read goes through as ever; so do orders made many at once (each is priced when its first line is saved).
    await expect(w.writes.check('update', lines, STAFF, [{ note: 'no onions' }])).resolves.toMatchObject({ issues: [null] });
    await expect(w.writes.check('update', w.target('market_orders'), STAFF, [{ note: 'x' }])).resolves.toMatchObject({ issues: [null] });
    await expect(w.writes.check('create', w.target('market_orders'), STAFF, [{ note: 'x' }])).resolves.toMatchObject({ issues: [null] });
    // An import refuses the row and goes on; rows it brings in as history keep the reductions they bring.
    const importing = { ...STAFF, origin: 'import' as const };
    await expect(w.writes.check('update', lines, importing, [{ qty: 4 }])).resolves.toMatchObject({ issues: [{ qty: { code: 'one-at-a-time' } }] });
    const history = await w.writes.check('create', lines, importing, [{ order_id: id, unit_price: '9.00', qty: 1, discount: '2.50' }], { capacity: 'unchecked' });
    expect(history.issues).toEqual([null]);
    expect(Number(history.rows[0]!['discount'])).toBe(2.5);
  });
});

describe.each(LEGS)('the totals a price moves beyond the order\'s own reduction — %s', (dialect, available) => {
  let w: SaveWorld;
  beforeAll(async () => {
    if (!available) return;
    w = saveWorld(await priceWorld(dialect, { market: marketManifest({}, WIDE_ADJUST, { uncapped: true, wide: true }) }));
    await seedOffers(w, { timeless: true });
  }, 240_000);
  afterAll(async () => {
    if (available) await w.close();
  });
  const one = async (sql: string): Promise<string> => Number(Object.values((await w.rows(sql))[0] ?? { n: 0 })[0]).toFixed(2);

  it.skipIf(!available)('a code typed on an order moves each line\'s net, the order\'s total of them, and what its customer has spent', async () => {
    const customer = await w.create('market_customers', { name: 'Ada' });
    const made = await w.tree(basket(w, [], { customer_id: customer['id'] }));
    const id = made.root['id'];
    const spentBefore = Number(await one(`SELECT spent FROM market_customers WHERE id = ${String(customer['id'])}`));
    // The pair alone: 64.50 less 15.00.
    expect(await one(`SELECT lines_net FROM market_orders WHERE id = ${String(id)}`)).toBe('49.50');
    const total = Number((await w.figures(id))['total']);
    // The code is a row of its own, adding up into nothing: the order's totals are worked out by the price step all the same.
    await w.create('market_order_codes', { order_id: id, typed: 'AUTUMN5' });
    expect(await w.figures(id)).toMatchObject({ discount: '20.00', net: '44.50', total: '48.06' });
    expect(await one(`SELECT SUM(net) AS n FROM market_order_lines WHERE order_id = ${String(id)}`)).toBe('44.50');
    expect(await one(`SELECT lines_net FROM market_orders WHERE id = ${String(id)}`)).toBe('44.50');
    expect((Number(await one(`SELECT spent FROM market_customers WHERE id = ${String(customer['id'])}`)) - spentBefore).toFixed(2)).toBe((48.06 - total).toFixed(2));
    // A quote of the code's removal shows the order without it, and moves nothing its customer keeps.
    const [code] = await w.rows(`SELECT id FROM market_order_codes WHERE order_id = ${String(id)}`);
    const spent = await one(`SELECT spent FROM market_customers WHERE id = ${String(customer['id'])}`);
    const quoted = await w.update('market_order_codes', code!['id'], { removed_at: new Date().toISOString() }, { mode: 'dry' });
    expect(quoted.adjusted).toMatchObject([{ discount: '15.00' }]);
    expect(await one(`SELECT spent FROM market_customers WHERE id = ${String(customer['id'])}`)).toBe(spent);
    expect(await one(`SELECT lines_net FROM market_orders WHERE id = ${String(id)}`)).toBe('44.50');
  });

  it.skipIf(!available)('lines brought in step while the order\'s own reduction stands still move its totals', async () => {
    const made = await w.tree(basket(w));
    const id = made.root['id'];
    // Rows as an import of history leaves them: a net nobody worked out, and the order's total of them with it.
    await w.rows(`UPDATE market_order_lines SET net = NULL WHERE order_id = ${String(id)}`);
    await w.rows(`UPDATE market_orders SET lines_net = 0 WHERE id = ${String(id)}`);
    // A save of the order that asks its price and leaves its reduction where it was: 15.00 for the pair.
    const changed = await w.update('market_orders', id, { staff_reason: 'regular' });
    expect(changed.adjusted).toMatchObject([{ discount: '15.00', wrote: {} }]);
    expect(await one(`SELECT lines_net FROM market_orders WHERE id = ${String(id)}`)).toBe('49.50');
  });

  it.skipIf(!available)('rows charged by the night follow their order before its price is asked: three nights are reduced as three', async () => {
    const made = await w.tree({ table: 'market_orders', values: { nights: 5, staff_kind: 'percent', staff_value: '10' }, lists: { order_extras: { table: 'market_order_extras', via: 'order_id', rows: [{ rate: '10.00' }] } } });
    const id = made.root['id'];
    expect(await one(`SELECT discount FROM market_order_extras WHERE order_id = ${String(id)}`)).toBe('5.00');
    expect(await w.figures(id)).toMatchObject({ discount: '5.00', net: '45.00' });
    // The order's nights are nothing the price reads of the order itself: its rows follow them, and the price is asked of the rows as they then stand.
    const changed = await w.update('market_orders', id, { nights: 3 });
    expect(changed.adjusted).toHaveLength(1);
    expect(await one(`SELECT amount FROM market_order_extras WHERE order_id = ${String(id)}`)).toBe('30.00');
    expect(await one(`SELECT discount FROM market_order_extras WHERE order_id = ${String(id)}`)).toBe('3.00');
    expect(await w.figures(id)).toMatchObject({ discount: '3.00', net: '27.00', tax: '2.16', total: '29.16' });
    // A change that repeats the nights moves no row, and asks nobody.
    expect((await w.update('market_orders', id, { nights: 3 })).adjusted ?? []).toEqual([]);
  });

  it.skipIf(!available)('a row that is no line, made on or taken off an order whose price stands, is not refused', async () => {
    const made = await w.tree(basket(w));
    const id = made.root['id'];
    const [mugs] = made.rows.filter((row) => row.node.name === 'order_lines').map((row) => row.record['id']);
    await w.update('market_order_lines', mugs, { voided_at: new Date().toISOString() });
    await w.update('market_orders', id, { status: 'placed' });
    await w.update('market_orders', id, { status: 'paid' });
    const before = await w.figures(id);
    // A fee is no line of the rule, and a voided line is none any more: neither moves the price.
    const fee = await w.create('market_order_lines', { order_id: id, kind: 'fee', unit_price: '0.00', qty: 1 });
    expect(await w.remove('market_order_lines', fee['id'])).toBe(1);
    expect(await w.remove('market_order_lines', mugs)).toBe(1);
    expect((await w.figures(id))['discount']).toBe(before['discount']);
    // A line is refused as ever.
    expect((await refused(w.create('market_order_lines', { order_id: id, ...sentLine(w, 'Greeting card', 1) }))).details).toMatchObject({ reason: 'frozen' });
  });
});

describe('a price rule that cannot be asked, is not here, or is switched off', () => {
  const lineFor = (w: SaveWorld, order: unknown) => ({ order_id: order, ...sentLine(w, 'Mug, speckled', 2) });

  it('an add-on that cannot answer: every save that would move a price is refused, an order with no code included; what the price does not read is written', async () => {
    const w = saveWorld(await priceWorld('sqlite'));
    try {
      await seedOffers(w, { timeless: true });
      const made = await w.tree(basket(w));
      const id = made.root['id'];
      const line = made.rows.find((row) => row.node.name === 'order_lines')!.record['id'];
      const unavailable = { reason: 'add-on-unavailable' };
      for (const [how, service] of [
        ['its code did not load', w.service(w.runtimeWith({ adjustDecider: () => null }))],
        ['code of another version', w.service(w.runtimeWith({ adjustDecider: () => ({ ...w.decider, version: '0.9.0' }) }))],
        ['no add-on runtime at all', w.service(null)],
      ] as const) {
        expect((await refused(w.tree(basket(w), { service }))).details, how).toEqual(unavailable);
        expect((await refused(w.create('market_order_lines', lineFor(w, id), STAFF, service))).details, how).toEqual(unavailable);
        expect((await refused(w.update('market_order_lines', line, { qty: 3 }, { service }))).details, how).toEqual(unavailable);
        expect((await refused(w.remove('market_order_lines', line, STAFF, service))).details, how).toEqual(unavailable);
        expect((await refused(w.create('market_order_codes', { order_id: id, typed: 'AUTUMN5' }, STAFF, service))).details, how).toEqual(unavailable);
        expect((await refused(w.update('market_orders', id, { staff_kind: 'percent', staff_value: '5' }, { service }))).details, how).toEqual(unavailable);
        // A quote says the same: it would not be saved.
        expect((await refused(w.tree(basket(w), { service, mode: 'dry' }))).details, how).toEqual(unavailable);
        await w.update('market_orders', id, { note: how }, { service });
        await w.update('market_order_lines', line, { note: 'no onions' }, { service });
      }
      // Nothing of the refused saves was kept.
      expect(await w.figures(id)).toMatchObject({ subtotal: '64.50', discount: '15.00' });
    } finally {
      await w.close();
    }
  });

  it('the owner\'s switch is the way through: off, saves ask nothing, and the reductions stay as they were stored', async () => {
    const w = saveWorld(await priceWorld('sqlite'));
    try {
      await seedOffers(w, { timeless: true });
      const made = await w.tree(basket(w));
      const id = made.root['id'];
      const { overridesRepo } = await import('@adminium/meta');
      await overridesRepo(w.h.meta).create({ connectionId: w.h.connectionId, op: 'table.switchedOff', tableName: w.table('market_orders').id, columnName: null, value: { postings: [], adjust: true }, origin: 'user' } as never);
      await w.reload();
      const off = saveWorld(w);
      // Even with an add-on that could not answer.
      const service = off.service(w.runtimeWith({ adjustDecider: () => null }));
      await off.create('market_order_lines', lineFor(off, id), STAFF, service);
      expect(await off.figures(id)).toMatchObject({ subtotal: '92.50', discount: '15.00', net: '77.50' });
      await off.create('market_order_codes', { order_id: id, typed: 'AUTUMN5' }, STAFF, service);
      expect(await off.figures(id)).toMatchObject({ discount: '15.00' });
    } finally {
      await w.close();
    }
  });

  for (const [how, options] of [['not installed', { noKit: true }], ['installed and not attached to the shop', { attachTo: [] as string[] }]] as const) {
    it(`with the add-on ${how}, an order is saved at its own price — and a code typed on it is refused, never taken in silence`, async () => {
      const w = saveWorld(await priceWorld('sqlite', { ...options, market: marketManifest({}, MARKET_ADJUST, { uncapped: true }) }));
      try {
        const made = await w.tree(basket(w));
        const id = made.root['id'];
        expect(await w.figures(id)).toEqual({ subtotal: '64.50', discount: '0.00', net: '64.50', tax: '5.16', total: '69.66' });
        await w.create('market_order_lines', lineFor(w, id));
        expect(await w.figures(id)).toMatchObject({ subtotal: '92.50', discount: '0.00' });
        const typed = await refused(w.create('market_order_codes', { order_id: id, typed: 'AUTUMN5' }));
        expect([typed.code, typed.details]).toEqual(['POSTING_REFUSED', { reason: 'add-on-unavailable', column: 'typed' }]);
        const inTree = await refused(w.tree(basket(w, ['AUTUMN5'])));
        expect([inTree.details, inTree.at]).toEqual([{ reason: 'add-on-unavailable', column: 'typed' }, ['order_codes', 0]]);
        // A row with nothing typed is taken; and a batch of lines is nobody's to refuse.
        await w.create('market_order_codes', { order_id: id });
        await expect(w.writes.check('update', w.target('market_order_lines'), STAFF, [{ qty: 4 }])).resolves.toMatchObject({ issues: [null] });
      } finally {
        await w.close();
      }
    });
  }
});
