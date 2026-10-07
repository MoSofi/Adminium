// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT A RETURN GIVES BACK. A refund is the difference between what the order
 * cost and what it would cost with the returned things gone, priced again
 * under the offers it had — never the returned thing's own share. Worked on
 * the shop's order of two mugs, two totes (the second free) and a notebook
 * with ten percent off for a known customer: $48.11.
 */
import { rolesRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { refundShares } from '../src/crud/adjust/refund.js';
import { priceAnswer } from '../src/crud/adjust/replies.js';
import { priceWorld, seedOffers, type PriceWorld } from './adjust.helpers.js';
import { refused, saveWorld, sentLine, type SaveWorld } from './adjust-save.helpers.js';
import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from './auth-helpers.js';
import { MARKET_ADJUST, PRICE_KIT, marketManifest } from './fixtures/price-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';
import { servePublic } from './public-lane.helpers.js';

type Doc = Record<string, unknown>;
const money = (value: unknown): string => (value === null || value === undefined ? 'null' : Number(value).toFixed(2));

describe.each(LEGS)('what a return gives back — %s', (dialect, available) => {
  let w: PriceWorld;
  let s: SaveWorld;
  let ada: number;

  /** The worked order, paid: $19.00 by card and the rest in cash. Answers its id, its lines' ids and its payments'. */
  const order = async (): Promise<{ id: unknown; lines: unknown[]; card: unknown; cash: unknown }> => {
    const made = await s.tree({
      table: 'market_orders',
      values: { customer_id: ada },
      lists: {
        order_lines: { table: 'market_order_lines', via: 'order_id', rows: [sentLine(w, 'Mug, speckled', 2), sentLine(w, 'Canvas tote, natural', 2), sentLine(w, 'Notebook, A5', 1)] },
        order_codes: { table: 'market_order_codes', via: 'order_id', rows: [{ typed: 'WELCOME10' }] },
      },
    });
    const id = made.root['id'];
    expect(await s.figures(id)).toMatchObject({ discount: '19.95', net: '44.55', tax: '3.56', total: '48.11' });
    const card = (await s.create('market_payments', { order_id: id, method: 'card', amount: '19.00' }))['id'];
    const cash = (await s.create('market_payments', { order_id: id, method: 'cash', amount: '29.11' }))['id'];
    await s.update('market_orders', id, { status: 'placed' });
    await s.update('market_orders', id, { status: 'paid' });
    const lines = (await w.rows(`SELECT id FROM market_order_lines WHERE order_id = ${String(id)} ORDER BY id`)).map((row) => row['id']);
    return { id, lines, card, cash };
  };
  const giveBack = (of: { id: unknown }, returned: readonly (readonly [unknown, number])[], values: Doc = {}, mode?: 'dry') =>
    s.tree({ table: 'market_refunds', values: { order_id: of.id, ...values }, lists: { refund_lines: { table: 'market_refund_lines', via: 'refund_id', rows: returned.map(([line, qty]) => ({ line_id: line, qty })) } } }, mode === undefined ? {} : { mode });
  const refunds = async (id: unknown) => (await w.rows(`SELECT amount, tax, net_back, payment_id FROM market_refunds WHERE order_id = ${String(id)} ORDER BY id`)).map((row) => `${money(row['amount'])} ${money(row['tax'])} ${money(row['net_back'])}`);

  beforeAll(async () => {
    if (!available) return;
    w = await priceWorld(dialect, { market: marketManifest({}, MARKET_ADJUST, { refunds: true }) });
    s = saveWorld(w);
    await seedOffers(w, { timeless: true });
    ada = await w.insert('market_customers', { name: 'Ada', email: 'ada@example.com' });
  }, 240_000);
  afterAll(async () => {
    if (available) await w.close();
  });

  it.skipIf(!available)('one mug back gives $13.60; one tote of the pair gives $0.00', async () => {
    const mug = await order();
    const before = await s.figures(mug.id);
    const back = await giveBack(mug, [[mug.lines[0], 1]]);
    // The order without the mug: 50.50, the pair, ten percent of 35.50, tax on 31.95 — 34.51. The difference, of which 1.00 is tax.
    expect([money(back.root['amount']), money(back.root['tax']), money(back.root['net_back'])]).toEqual(['13.60', '1.00', '12.60']);
    expect(await refunds(mug.id)).toEqual(['13.60 1.00 12.60']);
    // Never the mug's own share of its line, taxed alone; never a cent off.
    expect(money(back.root['amount'])).not.toBe('13.61');
    // Nothing of the order moved: its price stands, and so do its lines' reductions and what was applied to it.
    expect(await s.figures(mug.id)).toEqual(before);
    expect(money((await w.rows(`SELECT refunded FROM market_orders WHERE id = ${String(mug.id)}`))[0]!['refunded'])).toBe('13.60');
    // The save says what there was to give back, and what each payment may still be given.
    expect(back.adjusted?.[0]?.refund).toMatchObject({ refundable: '13.60', taxRefundable: '1.00', rows: [{ amount: '13.60', tax: '1.00' }] });

    // One tote of the pair: the pair is gone, the tote kept is paid in full, and the order costs what it cost.
    const tote = await order();
    const none = await giveBack(tote, [[tote.lines[1], 1]]);
    expect([money(none.root['amount']), money(none.root['tax'])]).toEqual(['0.00', '0.00']);
    expect(money(none.root['amount'])).not.toBe('7.29');
  });

  it.skipIf(!available)('a quote of a return says the same, and keeps nothing', async () => {
    const one = await order();
    const quoted = await giveBack(one, [[one.lines[0], 1]], {}, 'dry');
    expect([money(quoted.root['amount']), money(quoted.root['tax'])]).toEqual(['13.60', '1.00']);
    expect(quoted.adjusted?.[0]?.refund).toMatchObject({ refundable: '13.60', payments: [{ key: String(one.card), took: '19.00', givenBack: '0.00', max: '19.00' }, { key: String(one.cash), took: '29.11', givenBack: '0.00', max: '29.11' }] });
    expect(await refunds(one.id)).toEqual([]);
  });

  it.skipIf(!available)('a second return gives back what the order is smaller by since the first; more than was bought is refused', async () => {
    const one = await order();
    await giveBack(one, [[one.lines[0], 1]]);
    // The other mug too: the order without mugs is 36.50, the pair, ten percent of 21.50 — net 19.35, tax 1.55, total 20.90.
    const second = await giveBack(one, [[one.lines[0], 1]]);
    expect([money(second.root['amount']), money(second.root['tax'])]).toEqual(['13.61', '1.01']);
    expect(await refunds(one.id)).toEqual(['13.60 1.00 12.60', '13.61 1.01 12.60']);
    // A third mug was never bought.
    const over = await refused(giveBack(one, [[one.lines[0], 1]]));
    expect(over).toMatchObject({ code: 'ADJUST_REFUSED', details: { reason: 'refund-over' } });
    expect((await refunds(one.id)).length).toBe(2);
    // Money asked back for nothing returned, when nothing is left to give: refused, never a row of nothing.
    const nothing = await refused(s.create('market_refunds', { order_id: one.id }));
    expect(nothing).toMatchObject({ code: 'ADJUST_REFUSED', details: { reason: 'refund-over' } });
  });

  it.skipIf(!available)('a refund is capped at what its payment took, and the rest goes to the next row', async () => {
    const one = await order();
    // Everything back: 48.11 in all. The card took 19.00.
    const everything = [[one.lines[0], 2], [one.lines[1], 2], [one.lines[2], 1]] as const;
    const card = await giveBack(one, everything, { payment_id: one.card });
    expect([money(card.root['amount']), money(card.root['tax'])]).toEqual(['19.00', '1.40']);
    // The rest, with no line of its own to return: to the cash.
    const cash = await s.create('market_refunds', { order_id: one.id, payment_id: one.cash });
    expect([money(cash['amount']), money(cash['tax'])]).toEqual(['29.11', '2.16']);
    // The card has been given all it took.
    const again = await refused(s.create('market_refunds', { order_id: one.id, payment_id: one.card }));
    expect(again).toMatchObject({ code: 'ADJUST_REFUSED', details: { reason: 'refund-over' } });
    expect(money((await w.rows(`SELECT refunded FROM market_orders WHERE id = ${String(one.id)}`))[0]!['refunded'])).toBe('48.11');
  });

  it.skipIf(!available)('a payment is given back no more than it took, over every refund against it; and an order no more than was paid in', async () => {
    const one = await order();
    // One mug, to the card: 13.60 of its 19.00.
    await giveBack(one, [[one.lines[0], 1]], { payment_id: one.card });
    // The other mug, to the card again: 13.61 is due, and the card has 5.40 left.
    const rest = await giveBack(one, [[one.lines[0], 1]], { payment_id: one.card });
    expect(money(rest.root['amount'])).toBe('5.40');
    expect(rest.adjusted?.[0]?.refund?.payments[0]).toEqual({ key: String(one.card), took: '19.00', givenBack: '13.60', max: '5.40' });

    // An order with a deposit of ten paid: one mug back is worth 13.60, and ten is all that came in.
    const made = await s.tree({ table: 'market_orders', values: { customer_id: ada }, lists: { order_lines: { table: 'market_order_lines', via: 'order_id', rows: [sentLine(w, 'Mug, speckled', 2), sentLine(w, 'Canvas tote, natural', 2), sentLine(w, 'Notebook, A5', 1)] }, order_codes: { table: 'market_order_codes', via: 'order_id', rows: [{ typed: 'WELCOME10' }] } } });
    await s.create('market_payments', { order_id: made.root['id'], method: 'cash', amount: '10.00' });
    const [mugs] = await w.rows(`SELECT id FROM market_order_lines WHERE order_id = ${String(made.root['id'])} ORDER BY id`);
    const deposit = await giveBack({ id: made.root['id'] }, [[mugs!['id'], 1]]);
    expect(money(deposit.root['amount'])).toBe('10.00');
  });

  it.skipIf(!available)('a refund names a payment and lines of its own order, and stands once made', async () => {
    const one = await order();
    const other = await order();
    // Another order's payment; another order's line.
    expect(await refused(giveBack(one, [[one.lines[0], 1]], { payment_id: other.card }))).toMatchObject({ code: 'ADJUST_REFUSED', details: { reason: 'refund-over' } });
    expect(await refused(giveBack(one, [[other.lines[0], 1]]))).toMatchObject({ code: 'ADJUST_REFUSED', details: { reason: 'refund-over' } });
    expect(await refunds(one.id)).toEqual([]);
    const back = await giveBack(one, [[one.lines[0], 1]], { payment_id: one.cash });
    const id = back.root['id'];
    // Moved to another payment, to another order, or taken away: refused — what was given back stands.
    for (const change of [{ payment_id: one.card }, { order_id: other.id }]) {
      expect(await refused(s.update('market_refunds', id, change))).toMatchObject({ code: 'ADJUST_REFUSED', details: { reason: 'not-allowed' } });
    }
    // (With its returned lines out of the way: the database would refuse the delete for them first.)
    await w.rows(`DELETE FROM market_refund_lines WHERE refund_id = ${String(id)}`);
    expect(await refused(s.remove('market_refunds', id))).toMatchObject({ code: 'ADJUST_REFUSED', details: { reason: 'not-allowed' } });
    expect(await refunds(one.id)).toEqual(['13.60 1.00 12.60']);
    // What is written beside it is its writer's.
    await s.update('market_refunds', id, { reason: 'chipped' });
    // A refund left without an amount (made while nobody could decide it) stops the next one: never a second refund on top of an unknown first.
    await w.insert('market_refunds', { order_id: other.id, reason: 'from before' });
    expect(await refused(giveBack(other, [[other.lines[0], 1]]))).toMatchObject({ code: 'ADJUST_REFUSED', details: { reason: 'not-allowed', column: 'amount' } });
  });

  it.skipIf(!available)('what a refund comes to is nobody\'s to write', async () => {
    const one = await order();
    const forged = await giveBack(one, [[one.lines[2], 1]], { amount: '40.00', tax: '0.00' }).catch((error: unknown) => error as { statusCode?: number });
    // The notebook: the order without it is 41.80.
    if ('root' in (forged as object)) expect(money((forged as { root: Doc }).root['amount'])).toBe('6.31');
    else expect((forged as { statusCode?: number }).statusCode).toBe(422);
    expect(Number((await w.rows(`SELECT COUNT(*) AS n FROM market_refunds WHERE amount = 40`))[0]!['n'])).toBe(0);
    // A refund row changed afterwards keeps what was decided: its reason is its writer's, its amount is not.
    const id = (await w.rows(`SELECT MAX(id) AS id FROM market_refunds WHERE order_id = ${String(one.id)}`))[0]!['id'];
    await s.update('market_refunds', id, { reason: 'changed their mind', amount: '40.00' }).catch(() => undefined);
    expect(money((await w.rows(`SELECT amount FROM market_refunds WHERE id = ${String(id)}`))[0]!['amount'])).toBe('6.31');
  });
});

describe('a return through the desk\'s own routes', () => {
  it('the quote of a refund says what it would come to and what each payment may be given; the save says the same, and has no Undo', async () => {
    const w = await priceWorld('sqlite', { market: marketManifest({}, MARKET_ADJUST, { refunds: true }) });
    const trusted = process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
    process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = PRICE_KIT;
    const served = await servePublic(w.h as never, null, { ADMINIUM_DATA_DIR: w.h.dataDir });
    try {
      await seedOffers(w, { timeless: true });
      const s = saveWorld(w);
      const made = await s.tree({ table: 'market_orders', values: {}, lists: { order_lines: { table: 'market_order_lines', via: 'order_id', rows: [sentLine(w, 'Mug, speckled', 2), sentLine(w, 'Notebook, A5', 1)] } } });
      const id = made.root['id'];
      const pay = (await s.create('market_payments', { order_id: id, method: 'cash', amount: '37.26' }))['id'];
      const [mugs] = await w.rows(`SELECT id FROM market_order_lines WHERE order_id = ${String(id)} ORDER BY id`);
      const user = await usersRepo(w.h.meta).create({ email: 'desk@market.example', name: 'Desk', passwordHash: await adminPasswordHash(), status: 'active' });
      await rolesRepo(w.h.meta).assignToUser(user.id, (await rolesRepo(w.h.meta).findBySlug('super-admin'))!.id);
      const cookie = sessionCookie((await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'desk@market.example', password: ADMIN_PASSWORD } })).headers['set-cookie']);
      const table = encodeURIComponent(w.table('market_refunds').id);
      // (A staff form names a list of child rows by the relation it is.)
      const relation = w.view().model.relations.find((r) => r.through === null && r.from.tableId === w.table('market_refund_lines').id && r.to.tableId === w.table('market_refunds').id)!;
      const body = { values: { order_id: id, payment_id: pay }, children: { [relation.id]: [{ values: { line_id: mugs!['id'], qty: 1 } }] } };
      const post = (url: string) => served.composed.app.inject({ method: 'POST', url: `/api/v1/data/${w.h.connectionId}/${table}${url}`, headers: { cookie }, payload: body as never });
      // One mug of 14.00 with its tax of eight percent.
      const quoted = await post('/dry-run');
      expect(quoted.statusCode, quoted.body).toBe(200);
      const shown = quoted.json() as { data: Doc; refund?: Doc; applied?: unknown };
      expect([money(shown.data['amount']), money(shown.data['tax'])]).toEqual(['15.12', '1.12']);
      expect(shown.refund).toEqual({ refundable: '15.12', taxRefundable: '1.12', payments: [{ key: String(pay), took: '37.26', givenBack: '0.00', max: '37.26' }] });
      expect(shown.applied).toBeUndefined();
      expect((await w.rows('SELECT COUNT(*) AS n FROM market_refunds'))[0]!['n']).toBe(0);
      const saved = await post('');
      expect(saved.statusCode, saved.body).toBe(201);
      const kept = saved.json() as { data: Doc; refund?: Doc; undoToken?: unknown };
      expect(money(kept.data['amount'])).toBe('15.12');
      expect(kept.refund).toMatchObject({ refundable: '15.12' });
      expect(kept.undoToken ?? null).toBeNull();
    } finally {
      if (trusted === undefined) delete process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
      else process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = trusted;
      await served.close();
      await w.close();
    }
  }, 240_000);
});

describe('what a door says of money given back', () => {
  const back = { applied: [], told: [], uses: [], discount: '0.00', lines: [], changedLines: 0, codes: [], wrote: {}, places: 2, table: 't', key: 1, refund: { refundable: '13.60', taxRefundable: '1.00', payments: [{ key: '7', took: '19.00', givenBack: '0.00', max: '19.00' }], rows: [{ key: '3', amount: '13.60', tax: '1.00' }] } };
  it('staff are told what there was to give and what each payment may be given; a customer is told nothing of it', () => {
    expect(priceAnswer([back] as never, { locale: 'en-US', nameOf: () => 't' })).toEqual({ refund: { refundable: '13.60', taxRefundable: '1.00', payments: back.refund.payments } });
    expect(priceAnswer([back] as never, { locale: 'en-US', nameOf: () => null, guest: true })).toEqual({});
  });
});

describe('how what is given back is shared', () => {
  const r = (text: string) => ({ n: BigInt(Math.round(Number(text) * 100)), d: 100n });
  const share = (refundable: string, tax: string, rows: { key: string; against?: string; returns?: boolean }[], payments: Record<string, [string, string]> = {}) =>
    refundShares({ refundable: r(refundable), taxRefundable: r(tax), rows: rows.map((row) => ({ key: row.key, against: row.against ?? null, returns: row.returns ?? true })), payments: new Map(Object.entries(payments).map(([key, [took, back]]) => [key, { took: r(took), givenBack: r(back) }])), places: 2 });

  it('one row takes all there is, with all its tax', () => {
    expect(share('13.60', '1.00', [{ key: 'a' }])).toEqual({ rows: [{ key: 'a', amount: '13.60', tax: '1.00' }] });
  });

  it('a row against a payment takes no more than the payment has left; its tax is its share, rounded down; the last row takes the rest', () => {
    expect(share('48.11', '3.56', [{ key: 'a', against: 'card' }, { key: 'b', against: 'cash' }], { card: ['19.00', '0.00'], cash: ['29.11', '0.00'] })).toEqual({
      rows: [{ key: 'a', amount: '19.00', tax: '1.40' }, { key: 'b', amount: '29.11', tax: '2.16' }],
    });
    // What the payment already gave back, and what an earlier row of the same save gives it, both count.
    expect(share('30.00', '0.00', [{ key: 'a', against: 'card' }, { key: 'b', against: 'card' }], { card: ['19.00', '9.00'] }).rows.map((row) => row.amount)).toEqual(['10.00', '0.00']);
  });

  it('nothing to give and nothing returned is refused; nothing to give for something returned is a row of nothing', () => {
    expect(share('0.00', '0.00', [{ key: 'a', returns: false }]).over).toEqual({ key: 'a', max: '0.00' });
    expect(share('0.00', '0.00', [{ key: 'a', returns: true }])).toEqual({ rows: [{ key: 'a', amount: '0.00', tax: '0.00' }] });
    // An order that came to cost MORE without the thing (a pair broken) gives nothing back, never less than nothing.
    expect(share('-2.00', '-0.10', [{ key: 'a' }])).toEqual({ rows: [{ key: 'a', amount: '0.00', tax: '0.00' }] });
    expect(share('5.00', '0.40', [{ key: 'a', against: 'gone' }])).toEqual({ rows: [{ key: 'a', amount: '5.00', tax: '0.40' }] });
  });
});
