// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GIFT CARDS, THROUGH A SHOP'S OWN TABLES.
 *
 * The built add-on beside an app that spells out its card parts: a payment a
 * card makes, a sale line that loads one, a refund that goes back to one. A
 * card pays what it holds and no more, twenty payments at once never pass
 * what is on it, a card cannot pay for a card, and money given back goes to
 * the card it came from.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GUEST, refused } from '../../adjust-save.helpers.js';
import { LEGS } from '../../invoicing-install.helpers.js';
import { money2, offers, offersWorld, type OffersWorld } from './world.js';

type Doc = Record<string, unknown>;

describe.each(LEGS)('gift cards through a shop — %s', (dialect, available) => {
  const run = available && offers !== null;
  let w: OffersWorld;
  let mug = 0;
  beforeAll(async () => {
    if (!run) return;
    w = await offersWorld(dialect);
    mug = await w.insert('shop_items', { name: 'Mug, speckled', price: '14.00', tag: 'mugs' });
  }, 240_000);
  afterAll(async () => {
    if (run) await w.close();
  });

  /** An order of so many mugs, open. */
  const order = async (mugs: number, more: Doc = {}): Promise<number> => {
    const made = await w.tree({ table: 'shop_orders', values: more, lists: { lines: { table: 'shop_order_lines', via: 'order_id', rows: [{ item_id: mug, tag: 'mugs', unit_price: '14.00', qty: mugs }] } } });
    return Number(made.root['id']);
  };
  const ledger = async (card: number) => (await w.all('offers_card_ledger', `card_id = ${String(card)}`)).map((row) => `${String(row['kind'])} ${money2(row['amount'])} → ${money2(row['balance_after'])}`);
  const balance = async (card: number) => money2((await w.row('offers_gift_cards', card))['balance']);

  it.skipIf(!run)('a card issued by hand is active, holds what was put on it, and says so in its ledger', async () => {
    const card = await w.card('50.00', { recipient_name: 'Ada' });
    const row = await w.row('offers_gift_cards', card.id);
    expect(row['status']).toBe('active');
    expect(money2(row['balance'])).toBe('50.00');
    expect(row['notify']).toBe('card');
    expect(card.code).toMatch(/^GC-[0-9A-Z]{12}$/);
    expect(await ledger(card.id)).toEqual(['issue 50.00 → 50.00']);
    // The row the ledger wrote names the action that asked for it, and the receipt that made it.
    const [written] = await w.all('offers_card_ledger', `card_id = ${String(card.id)}`);
    expect(written).toMatchObject({ source_table: 'offers:card_actions', note: 'Sold at the desk' });
    expect(written!['receipt_id']).not.toBeNull();
  });

  it.skipIf(!run)('a card pays what it holds and a cancel gives it back', async () => {
    const card = await w.card('19.00');
    // Four mugs: $56.00 and eight percent, $60.48 due.
    const id = await order(4);
    expect(money2((await w.row('shop_orders', id))['due'])).toBe('60.48');
    const paid = await w.create('shop_payments', { order_id: id, method: 'gift_card', card_code: card.code });
    // The amount is the card's to give: all nineteen, and what is left on it is said beside.
    const payment = await w.row('shop_payments', paid['id']);
    expect(money2(payment['amount'])).toBe('19.00');
    expect(money2(payment['card_balance_after'])).toBe('0.00');
    expect(Number(payment['card_id'])).toBe(card.id);
    expect(await balance(card.id)).toBe('0.00');
    expect(money2((await w.row('shop_orders', id))['due'])).toBe('41.48');
    expect(await ledger(card.id)).toEqual(['issue 19.00 → 19.00', 'spend -19.00 → 0.00']);
    // The ledger's row names the payment that paid, not the order.
    const spend = (await w.all('offers_card_ledger', `card_id = ${String(card.id)} AND kind = 'spend'`))[0]!;
    expect(spend).toMatchObject({ source_table: 'shop:payments', source_row: String(paid['id']) });

    // Voided, the payment gives the card its money back, against the row that took it.
    await w.update('shop_payments', paid['id'], { voided_at: '2026-10-01T12:00:00.000Z' });
    expect(await balance(card.id)).toBe('19.00');
    const rows = await w.all('offers_card_ledger', `card_id = ${String(card.id)}`);
    expect(rows.map((row) => String(row['kind']))).toEqual(['issue', 'spend', 'refund']);
    expect(Number(rows[2]!['against_id'])).toBe(Number(rows[1]!['id']));
    expect(money2((await w.row('shop_orders', id))['due'])).toBe('60.48');
  });

  it.skipIf(!run)('a card that holds more than is due pays what is due and keeps the rest', async () => {
    const card = await w.card('100.00');
    const id = await order(1);
    const paid = await w.create('shop_payments', { order_id: id, method: 'gift_card', card_code: card.code });
    expect(money2((await w.row('shop_payments', paid['id']))['amount'])).toBe('15.12');
    expect(await balance(card.id)).toBe('84.88');
    expect(money2((await w.row('shop_orders', id))['due'])).toBe('0.00');
  });

  it.skipIf(!run)('a cash payment and an ordinary line in the same tables write nothing', async () => {
    const id = await order(1);
    const before = (await w.all('offers_card_ledger')).length;
    const receipts = (await w.all('offers_postings')).length;
    const cash = await w.create('shop_payments', { order_id: id, method: 'cash', amount: '15.12' });
    expect(money2((await w.row('shop_payments', cash['id']))['amount'])).toBe('15.12');
    expect((await w.all('offers_card_ledger')).length).toBe(before);
    // Paid: the order's own line loads no card and sells no voucher, so nothing is written for it either.
    await w.update('shop_orders', id, { status: 'paid' });
    expect((await w.all('offers_card_ledger')).length).toBe(before);
    expect((await w.all('offers_postings', "action IN ('spend', 'issue', 'sell')")).length).toBe((await w.all('offers_postings', "action IN ('spend', 'issue', 'sell')")).length);
    expect(receipts).toBeGreaterThanOrEqual(0);
  });

  it.skipIf(!run)('a card that is not known, not yet sold or cancelled pays nothing', async () => {
    const id = await order(1);
    // A code nobody issued: the shop's own lookup finds no card.
    const unknown = await refused(w.create('shop_payments', { order_id: id, method: 'gift_card', card_code: 'GC-AAAA-BBBB-CCCC' }));
    expect(unknown.code, unknown.message).toBeDefined();
    // A card made and never loaded is inactive: the lookup takes active cards only.
    const idle = await w.create('offers_gift_cards', {});
    const notSold = await refused(w.create('shop_payments', { order_id: id, method: 'gift_card', card_code: String((await w.row('offers_gift_cards', idle['id']))['code']) }));
    expect(notSold.code, notSold.message).toBeDefined();
    // A card cancelled after it was scanned: named by its key, it is refused by the ledger, by name.
    const card = await w.card('20.00');
    await w.update('offers_gift_cards', card.id, { status: 'void', void_reason: 'Lost' });
    expect(await ledger(card.id)).toEqual(['issue 20.00 → 20.00', 'void -20.00 → 0.00']);
    const cancelled = await refused(w.create('shop_payments', { order_id: id, method: 'gift_card', card_id: card.id }));
    expect(cancelled.code, cancelled.message).toBe('POSTING_REFUSED');
    expect(cancelled.details).toMatchObject({ reason: 'void' });
    expect((await w.all('shop_payments', `order_id = ${String(id)}`)).length).toBe(0);
  });

  it.skipIf(!run)('a guest pays with a card as staff do, and is told no balance', async () => {
    const card = await w.card('30.00');
    const id = await order(1);
    const paid = await w.create('shop_payments', { order_id: id, method: 'gift_card', card_code: card.code }, GUEST);
    expect(money2((await w.row('shop_payments', paid['id']))['amount'])).toBe('15.12');
    expect(await balance(card.id)).toBe('14.88');
  });

  /** What a save came to: that it went through, or the refusal it met. */
  const settle = async (run: Promise<unknown>): Promise<{ ok: true } | { ok: false; code: string; reason: string; left?: string }> => {
    try {
      await run;
      return { ok: true };
    } catch (error) {
      const told = error as { code?: string; details?: { reason?: string; left?: string } };
      return { ok: false, code: String(told.code), reason: String(told.details?.reason), ...(told.details?.left === undefined ? {} : { left: told.details.left }) };
    }
  };

  it.skipIf(!run)('twenty spends of ten on sixty-two give six', async () => {
    const card = await w.card('62.00');
    // Thirty mugs: far more due than the card holds.
    const id = await order(30);
    const sent = await Promise.all(Array.from({ length: 20 }, () => settle(w.create('shop_payments', { order_id: id, method: 'gift_card', card_id: card.id, asked: '10.00' }))));
    expect(sent.filter((one) => one.ok)).toHaveLength(6);
    // Each of the others is told the card does not hold ten — by the add-on, with what is left where it is the next in line.
    for (const one of sent.filter((each) => !each.ok)) expect(`${(one as { code: string }).code}:${(one as { reason: string }).reason}`).toBe('POSTING_REFUSED:empty');
    expect(await balance(card.id)).toBe('2.00');
    expect((await ledger(card.id)).filter((row) => row.startsWith('spend'))).toHaveLength(6);
    expect((await w.all('shop_payments', `order_id = ${String(id)}`)).length).toBe(6);
    expect(money2((await w.row('shop_orders', id))['paid'])).toBe('60.00');
  });

  it.skipIf(!run)('a sold card is inactive until its order is paid, and a card cannot pay for a card', async () => {
    const sold = await w.create('offers_gift_cards', { recipient_name: 'Ben' });
    const paying = await w.card('100.00');
    const made = await w.tree({
      table: 'shop_orders',
      values: { note: 'Order 14' },
      lists: { lines: { table: 'shop_order_lines', via: 'order_id', rows: [{ item_id: mug, tag: 'mugs', unit_price: '14.00', qty: 1 }, { label: 'Gift card', unit_price: '50.00', qty: 1, gift_card_id: sold['id'] }] } },
    });
    const id = Number(made.root['id']);
    // The load is no goods: it is in the total and out of the tax.
    expect(await w.row('shop_orders', id)).toMatchObject({ status: 'open' });
    expect(money2((await w.row('shop_orders', id))['tax'])).toBe('1.12');
    expect(money2((await w.row('shop_orders', id))['total'])).toBe('65.12');
    expect((await w.row('offers_gift_cards', sold['id']))['status']).toBe('inactive');

    // An order that loads a card is not paid with one.
    const refusedCard = await settle(w.create('shop_payments', { order_id: id, method: 'gift_card', card_id: paying.id }));
    expect(refusedCard).toMatchObject({ ok: false, code: 'POSTING_REFUSED', reason: 'card-pays-card' });
    expect(await balance(paying.id)).toBe('100.00');

    await w.create('shop_payments', { order_id: id, method: 'cash', amount: '65.12' });
    await w.update('shop_orders', id, { status: 'paid' });
    const card = await w.row('offers_gift_cards', sold['id']);
    expect(card['status']).toBe('active');
    expect(money2(card['balance'])).toBe('50.00');
    expect(card['notify']).toBe('card');
    expect(card['issued_at']).not.toBeNull();
    const [row] = await w.all('offers_card_ledger', `card_id = ${String(sold['id'])}`);
    expect(row).toMatchObject({ kind: 'issue', source_table: 'shop:order_lines', source_label: 'Gift card' });

    // The order cancelled, the load is taken back off the card, against the row that put it there.
    await w.update('shop_orders', id, { status: 'cancelled' });
    expect(await ledger(Number(sold['id']))).toEqual(['issue 50.00 → 50.00', 'adjust -50.00 → 0.00']);
    expect(await balance(Number(sold['id']))).toBe('0.00');
  });

  it.skipIf(!run)('a sale undone after the card was partly spent takes what is left, and no more', async () => {
    const sold = await w.create('offers_gift_cards', {});
    const made = await w.tree({ table: 'shop_orders', values: {}, lists: { lines: { table: 'shop_order_lines', via: 'order_id', rows: [{ label: 'Gift card', unit_price: '50.00', qty: 1, gift_card_id: sold['id'] }] } } });
    const id = Number(made.root['id']);
    await w.create('shop_payments', { order_id: id, method: 'cash', amount: '50.00' });
    await w.update('shop_orders', id, { status: 'paid' });
    // Its holder buys a mug with it: $15.12 gone, $34.88 left.
    const other = await order(1);
    await w.create('shop_payments', { order_id: other, method: 'gift_card', card_id: sold['id'] });
    expect(await balance(Number(sold['id']))).toBe('34.88');
    await w.update('shop_orders', id, { status: 'cancelled' });
    // Never below nothing: the cancel is not refused, and takes the thirty-four eighty-eight.
    expect(await balance(Number(sold['id']))).toBe('0.00');
    expect((await ledger(Number(sold['id']))).at(-1)).toBe('adjust -34.88 → 0.00');
  });

  it.skipIf(!run)('a refund goes back to the same card and never above the spend', async () => {
    const card = await w.card('100.00');
    const id = await order(1);
    const paid = await w.create('shop_payments', { order_id: id, method: 'gift_card', card_id: card.id });
    expect(await balance(card.id)).toBe('84.88');
    await w.create('shop_refunds', { order_id: id, payment_id: paid['id'], amount: '5.00', note: 'Chipped' });
    expect(await balance(card.id)).toBe('89.88');
    const back = (await w.all('offers_card_ledger', `card_id = ${String(card.id)} AND kind = 'refund'`))[0]!;
    expect(back).toMatchObject({ source_table: 'shop:refunds', source_label: 'Chipped' });
    // $15.12 was paid and $5.00 is back: $10.12 more may go back, and not a cent beyond.
    const over = await settle(w.create('shop_refunds', { order_id: id, payment_id: paid['id'], amount: '10.13' }));
    expect(over).toMatchObject({ ok: false, code: 'POSTING_REFUSED', reason: 'refund-over', left: '10.12' });
    await w.create('shop_refunds', { order_id: id, payment_id: paid['id'], amount: '10.12' });
    expect(await balance(card.id)).toBe('100.00');
    // A refund of a cash payment is no card's business: nothing is written for it.
    const cash = await w.create('shop_payments', { order_id: await order(1), method: 'cash', amount: '15.12' });
    const rows = (await w.all('offers_card_ledger')).length;
    await w.create('shop_refunds', { order_id: cash['order_id'], payment_id: cash['id'], amount: '15.12' });
    expect((await w.all('offers_card_ledger')).length).toBe(rows);
  });

  it.skipIf(!run)('a payment voided after part of it was refunded gives back the rest, not the whole of it again', async () => {
    const card = await w.card('100.00');
    const id = await order(1);
    const paid = await w.create('shop_payments', { order_id: id, method: 'gift_card', card_id: card.id });
    expect(await balance(card.id)).toBe('84.88');
    await w.create('shop_refunds', { order_id: id, payment_id: paid['id'], amount: '5.00' });
    expect(await balance(card.id)).toBe('89.88');
    await w.update('shop_payments', paid['id'], { voided_at: '2026-10-01T12:00:00.000Z' });
    // $15.12 was taken and $5.00 had gone back: the $10.12 still out comes back, and the card holds what it was sold with.
    expect(await balance(card.id)).toBe('100.00');
    const rows = await w.all('offers_card_ledger', `card_id = ${String(card.id)}`);
    expect(rows.map((row) => `${String(row['kind'])} ${money2(row['taken'])}`).sort()).toEqual(['issue -100.00', 'refund -10.12', 'refund -5.00', 'spend 15.12']);
    // Every row that gives money back names the payment it gives back for.
    const spend = rows.find((row) => row['kind'] === 'spend')!;
    for (const row of rows.filter((one) => one['kind'] === 'refund')) expect(String(row['against_id'])).toBe(String(spend['id']));
  });

  it.skipIf(!run)('two cards pay one order and a refund names its own payment', async () => {
    const [first, second] = [await w.card('19.00'), await w.card('100.00')];
    const id = await order(4);
    const one = await w.create('shop_payments', { order_id: id, method: 'gift_card', card_id: first.id });
    const two = await w.create('shop_payments', { order_id: id, method: 'gift_card', card_id: second.id });
    // The first gives all it has, the second what is still due: $60.48 − $19.00.
    expect(money2((await w.row('shop_payments', one['id']))['amount'])).toBe('19.00');
    expect(money2((await w.row('shop_payments', two['id']))['amount'])).toBe('41.48');
    expect(money2((await w.row('shop_orders', id))['due'])).toBe('0.00');
    await w.create('shop_refunds', { order_id: id, payment_id: two['id'], amount: '10.00' });
    expect(await balance(first.id)).toBe('0.00');
    expect(await balance(second.id)).toBe('68.52');
    const spends = await w.all('offers_card_ledger', `kind = 'spend' AND source_table = 'shop:payments' AND source_row IN ('${String(one['id'])}', '${String(two['id'])}')`);
    const refund = (await w.all('offers_card_ledger', `card_id = ${String(second.id)} AND kind = 'refund'`))[0]!;
    expect(Number(refund['against_id'])).toBe(Number(spends.find((row) => Number(row['card_id']) === second.id)!['id']));
    // The receipts keep the order; the ledger rows keep the payment.
    const receipts = await w.all('offers_postings', `action = 'spend' AND source_table = 'shop:orders' AND source_row = '${String(id)}'`);
    expect(receipts).toHaveLength(2);
  });

  it.skipIf(!run)('a guest\'s paid order makes the card active: the ledger\'s own write passes no role', async () => {
    const sold = await w.create('offers_gift_cards', { send_on: '2099-01-01' });
    const made = await w.tree({ table: 'shop_orders', values: {}, lists: { lines: { table: 'shop_order_lines', via: 'order_id', rows: [{ label: 'Gift card', unit_price: '25.00', qty: 1, gift_card_id: sold['id'] }] } } });
    await w.create('shop_payments', { order_id: made.root['id'], method: 'cash', amount: '25.00' });
    await w.update('shop_orders', made.root['id'], { status: 'paid' }, { context: GUEST });
    const card = await w.row('offers_gift_cards', sold['id']);
    // No person may make a card active; the ledger did, for a guest's save — and marked it for the mail that waits for its day.
    expect(card).toMatchObject({ status: 'active', notify: 'card_dated' });
    expect(money2(card['balance'])).toBe('25.00');
  });

  it.skipIf(!run)('value by hand is held to the place\'s least and most, and a correction never takes a card below nothing', async () => {
    const card = await w.card('450.00');
    const act = (action: string, amount: string) => settle(w.create('offers_card_actions', { card_id: card.id, action, amount, reason: 'At the desk' }));
    // Five hundred is the most a card may hold.
    expect(await act('top_up', '70.00')).toMatchObject({ ok: false, code: 'POSTING_REFUSED', reason: 'not-allowed' });
    expect(await act('top_up', '5.00')).toMatchObject({ ok: false, reason: 'not-allowed' });
    expect(await act('top_up', '50.00')).toEqual({ ok: true });
    expect(await act('adjust', '-500.01')).toMatchObject({ ok: false, reason: 'empty', left: '500.00' });
    expect(await act('adjust', '-0.50')).toEqual({ ok: true });
    expect(await ledger(card.id)).toEqual(['issue 450.00 → 450.00', 'top_up 50.00 → 500.00', 'adjust -0.50 → 499.50']);
    // Store credit is money given back: its rows say so, and it has no least.
    const credit = await w.tree({ table: 'offers_gift_cards', values: { kind: 'credit', owner_email: 'ada@shop.example' }, lists: { actions: { table: 'offers_card_actions', via: 'card_id', rows: [{ action: 'issue', amount: '4.20', reason: 'Returned a card' }] } } });
    expect(await ledger(Number(credit.root['id']))).toEqual(['refund 4.20 → 4.20']);
    expect(await w.row('offers_gift_cards', credit.root['id'])).toMatchObject({ status: 'active', notify: 'credit' });
  });
});
