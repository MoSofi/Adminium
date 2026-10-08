// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE WALK: WHAT OFFERS PROMISES, ONE ORDER AT A TIME.
 *
 * The promises a shop is sold on, each kept through its own orders and none
 * of them proved by a stand-in: the worked order paid in part by a gift card
 * and then cancelled; a card sold on an order that takes a code; a pack used
 * up by bookings and opened again by a cancelled one; a voucher for one named
 * thing beside other goods; credit given to an address twice; and a batch of
 * codes made in parts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { refused } from '../../adjust-save.helpers.js';
import { LEGS } from '../../invoicing-install.helpers.js';
import { money2, offers, offersWorld, type OffersWorld } from './world.js';

type Doc = Record<string, unknown>;
const said = (text: string) => ({ 'en-US': text });
const grouped = (word: string, code: string) => `${word}-${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;

describe.each(LEGS)('the walk through Offers — %s', (dialect, available) => {
  const run = available && offers !== null;
  let w: OffersWorld;
  const item: Record<string, number> = {};
  let welcome = 0;

  beforeAll(async () => {
    if (!run) return;
    w = await offersWorld(dialect);
    for (const [name, price, tag] of [['Mug, speckled', '14.00', 'mugs'], ['Canvas tote, natural', '15.00', 'bags'], ['Notebook, A5', '6.50', null], ['Massage 60 min', '80.00', null], ['Class', '15.00', null]] as const) {
      item[name] = await w.insert('shop_items', { name, price, tag });
    }
    const base = { applies_to: 'order', trigger: 'automatic', status: 'active', budget_open: true, combinable: true, first_order_only: false, used_up: false };
    welcome = await w.insert('offers_offers', { ...base, name: 'Welcome 10', public_name: said('10 % off your first order'), gives: 'percent', value: '10', trigger: 'code', first_order_only: true, max_per_customer: 1 });
    const pair = await w.insert('offers_offers', { ...base, name: 'Tote pair', public_name: said('Two totes, the cheaper one on us'), gives: 'bonus_item', buy_qty: 2, bonus_qty: 1, applies_to: 'lines' });
    const launch = await w.insert('offers_offers', { ...base, name: 'Launch week', public_name: said('20 % off'), gives: 'percent', value: '20', trigger: 'code' });
    await w.insert('offers_offer_targets', { offer_id: pair, kind: 'tag', source_table: '', source_row: 'bags', label: 'Bags' });
    await w.insert('offers_codes', { offer_id: welcome, code: 'WELCOME10', active: true });
    await w.insert('offers_codes', { offer_id: launch, code: 'LAUNCH20', active: true });
  }, 240_000);
  afterAll(async () => {
    if (run) await w.close();
  });

  const lineOf = (name: string, qty: number, price: string): Doc => ({ item_id: item[name], tag: name.startsWith('Mug') ? 'mugs' : name.startsWith('Canvas') ? 'bags' : null, unit_price: price, qty });
  const tree = (values: Doc, lines: Doc[], codes: string[] = []) => ({
    table: 'shop_orders',
    values,
    lists: { lines: { table: 'shop_order_lines', via: 'order_id', rows: lines }, ...(codes.length === 0 ? {} : { codes: { table: 'shop_order_codes', via: 'order_id', rows: codes.map((typed) => ({ typed })) } }) },
  });
  const order = async (values: Doc, lines: Doc[], codes: string[] = []): Promise<number> => Number((await w.tree(tree(values, lines, codes))).root['id']);
  const figure = async (id: number, name: string) => money2((await w.row('shop_orders', id))[name]);
  const lineDiscounts = async (id: number) => (await w.all('shop_order_lines', `order_id = ${String(id)}`)).map((row) => money2(row['discount']));
  const balance = async (card: number) => money2((await w.row('offers_gift_cards', card))['balance']);
  const ledger = async (card: number) => (await w.all('offers_card_ledger', `card_id = ${String(card)}`)).map((row) => `${String(row['kind'])} ${money2(row['amount'])} → ${money2(row['balance_after'])}`);
  const uses = async (id: number) => (await w.all('offers_redemptions', `source_table = 'shop:orders' AND source_row = '${String(id)}'`)).map((row) => `${String(row['kind'])} ${money2(row['amount'])} ${String(row['state'])}`).sort();
  const pay = async (id: number) => {
    const due = await figure(id, 'due');
    if (due !== '0.00') await w.create('shop_payments', { order_id: id, method: 'cash', amount: due });
    await w.update('shop_orders', id, { status: 'paid' });
  };
  const voucherOf = async (id: unknown) => w.row('offers_vouchers', id);

  it.skipIf(!run)('the card pays 19.00, keeps 0.00 and leaves 29.11 to pay; cancelling the order returns 19.00 and the WELCOME10 use', async () => {
    const ada = await w.insert('shop_customers', { name: 'Ada', email: 'ada@shop.example' });
    const card = await w.card('19.00');
    const id = await order({ customer_id: ada, note: 'Order 125' }, [lineOf('Mug, speckled', 2, '14.00'), lineOf('Canvas tote, natural', 2, '15.00'), lineOf('Notebook, A5', 1, '6.50')], ['WELCOME10']);
    expect(await figure(id, 'total')).toBe('48.11');
    // Typed as it is printed on the card, in fours.
    const paid = await w.create('shop_payments', { order_id: id, method: 'gift_card', card_code: grouped('GC', card.code.slice(3)) });
    const payment = await w.row('shop_payments', paid['id']);
    expect(money2(payment['amount'])).toBe('19.00');
    expect(money2(payment['card_balance_after'])).toBe('0.00');
    expect(await balance(card.id)).toBe('0.00');
    expect(await figure(id, 'due')).toBe('29.11');
    await pay(id);
    expect(await uses(id)).toEqual(['code 4.95 counted', 'offer 15.00 counted']);
    expect(Number((await w.row('offers_offers', welcome))['uses'])).toBe(1);

    // Cancelled, as an app cancels: the order goes back and its card payment is voided.
    await w.update('shop_orders', id, { status: 'cancelled' });
    await w.update('shop_payments', paid['id'], { voided_at: '2026-10-01T12:00:00.000Z' });
    expect(await balance(card.id)).toBe('19.00');
    expect(await ledger(card.id)).toEqual(['issue 19.00 → 19.00', 'spend -19.00 → 0.00', 'refund 19.00 → 19.00']);
    expect(await uses(id)).toEqual(['code 4.95 given_back', 'offer 15.00 given_back']);
    expect(Number((await w.row('offers_offers', welcome))['uses'])).toBe(0);
  });

  it.skipIf(!run)('no reduction touches a card sale line', async () => {
    const sold = await w.create('offers_gift_cards', { recipient_name: 'Ben' });
    // Twenty percent off the order — and the order is a mug and a fifty-dollar card.
    const id = await order({ note: 'Order 126' }, [lineOf('Mug, speckled', 1, '14.00'), { label: 'Gift card', unit_price: '50.00', qty: 1, gift_card_id: sold['id'] }], ['LAUNCH20']);
    expect(await lineDiscounts(id)).toEqual(['2.80', '0.00']);
    expect(await figure(id, 'discount')).toBe('2.80');
    // The mug at 11.20 with eight percent, and the card's fifty in full.
    expect(await figure(id, 'total')).toBe('62.10');
    await pay(id);
    expect(await balance(Number(sold['id']))).toBe('50.00');
    // What staff take off by hand leaves the card alone too.
    const again = await w.create('offers_gift_cards', { recipient_name: 'Cy' });
    const reason = await w.insert('offers_reasons', { label: 'Goodwill', active: true, position: 1 });
    const byHand = await order({ discount_kind: 'percent', discount_value: '50', discount_reason: reason }, [lineOf('Mug, speckled', 1, '14.00'), { label: 'Gift card', unit_price: '50.00', qty: 1, gift_card_id: again['id'] }]);
    expect(await lineDiscounts(byHand)).toEqual(['7.00', '0.00']);
  });

  it.skipIf(!run)('a cancelled booking gives its use back and re-opens a used-up pack', async () => {
    const pack = await w.create('offers_vouchers', { worth: 'pack', what: 'item', source_table: 'shop:items', source_row: String(item['Class']), public_name: '2 classes', uses_total: 2 });
    const code = String((await voucherOf(pack['id']))['code']);
    const booking = async () => order({}, [lineOf('Class', 1, '15.00')], [grouped('PK', code)]);
    const first = await booking();
    // The pack pays the class: nothing is due.
    expect(await figure(first, 'total')).toBe('0.00');
    await pay(first);
    expect(Number((await voucherOf(pack['id']))['uses_left'])).toBe(1);
    const second = await booking();
    await pay(second);
    expect(await voucherOf(pack['id'])).toMatchObject({ status: 'used' });
    expect(Number((await voucherOf(pack['id']))['uses_left'])).toBe(0);
    // Used up: a third booking is told so.
    const third = await refused(w.tree(tree({}, [lineOf('Class', 1, '15.00')], [code])));
    expect(third.details).toMatchObject({ reason: 'used-up' });
    // The second booking cancelled: one use back, and the pack takes bookings again.
    await w.update('shop_orders', second, { status: 'cancelled' });
    expect(await voucherOf(pack['id'])).toMatchObject({ status: 'issued' });
    expect(Number((await voucherOf(pack['id']))['uses_left'])).toBe(1);
    const fourth = await booking();
    expect(await figure(fourth, 'total')).toBe('0.00');
  });

  it.skipIf(!run)('a voucher for Massage 60 min takes that line to zero and no other', async () => {
    const voucher = await w.create('offers_vouchers', { worth: 'thing', what: 'item', source_table: 'shop:items', source_row: String(item['Massage 60 min']), public_name: 'Massage 60 min' });
    const code = String((await voucherOf(voucher['id']))['code']);
    const id = await order({}, [lineOf('Mug, speckled', 1, '14.00'), lineOf('Massage 60 min', 1, '80.00'), lineOf('Notebook, A5', 1, '6.50')], [grouped('VC', code)]);
    expect(await lineDiscounts(id)).toEqual(['0.00', '80.00', '0.00']);
    expect(await figure(id, 'net')).toBe('20.50');
    // With no massage on the order it takes nothing off, and says why.
    const none = await refused(w.tree(tree({}, [lineOf('Mug, speckled', 1, '14.00')], [code])));
    expect(none.code, none.message).toBe('ADJUST_REFUSED');
  });

  it.skipIf(!run)('credit given by hand opens a credit for the customer\'s address, as a refund row, and a second one adds to it', async () => {
    const made = await w.tree({ table: 'offers_gift_cards', values: { kind: 'credit', owner_email: 'dana@shop.example' }, lists: { actions: { table: 'offers_card_actions', via: 'card_id', rows: [{ action: 'issue', amount: '12.00', reason: 'A late delivery' }] } } });
    const id = Number(made.root['id']);
    expect(await w.row('offers_gift_cards', id)).toMatchObject({ kind: 'credit', status: 'active', notify: 'credit' });
    expect(await ledger(id)).toEqual(['refund 12.00 → 12.00']);
    await w.create('offers_card_actions', { card_id: id, action: 'top_up', amount: '8.00', reason: 'And a broken mug' });
    expect(await balance(id)).toBe('20.00');
    expect(await ledger(id)).toEqual(['refund 12.00 → 12.00', 'refund 8.00 → 20.00']);
    // It is the address that owns it, kept as it is compared.
    expect((await w.row('offers_gift_cards', id))['owner_email']).toBe('dana@shop.example');
  });

  it.skipIf(!run)('a batch of 200 makes 200 codes, no two alike; a batch of 1,200 is three parts, and a part past the count is refused', async () => {
    const batch = await w.create('offers_voucher_batches', { name: 'Autumn leaflets', count: 200, worth: 'amount', value: '5', public_name: 'Autumn leaflets' });
    await w.create('offers_batch_chunks', { batch_id: batch['id'], size: 200 });
    const made = await w.all('offers_vouchers', `batch_id = ${String(batch['id'])}`);
    expect(made).toHaveLength(200);
    expect(new Set(made.map((row) => String(row['code']))).size).toBe(200);
    for (const row of made) expect(String(row['code'])).toMatch(/^[0-9A-Z]{12}$/);
    // One typed with its word, as it is printed; another bare, as a scan reads it.
    const typed = await order({}, [lineOf('Mug, speckled', 1, '14.00')], [grouped('VC', String(made[0]!['code']))]);
    expect(await figure(typed, 'discount')).toBe('5.00');
    const scanned = await order({}, [lineOf('Mug, speckled', 1, '14.00')], [String(made[1]!['code'])]);
    expect(await figure(scanned, 'discount')).toBe('5.00');

    const large = await w.create('offers_voucher_batches', { name: 'Winter leaflets', count: 1200, worth: 'amount', value: '5', public_name: 'Winter leaflets' });
    // No part is larger than five hundred.
    expect((await refused(w.create('offers_batch_chunks', { batch_id: large['id'], size: 501 }))).code).toBe('VALIDATION_FAILED');
    for (const size of [500, 500, 200]) await w.create('offers_batch_chunks', { batch_id: large['id'], size });
    const over = await refused(w.create('offers_batch_chunks', { batch_id: large['id'], size: 1 }));
    expect(over.code, over.message).toBeDefined();
    const all = await w.all('offers_vouchers', `batch_id = ${String(large['id'])}`);
    expect(all).toHaveLength(1200);
    expect(new Set(all.map((row) => String(row['code']))).size).toBe(1200);
    const row = await w.row('offers_voucher_batches', large['id']);
    expect([Number(row['made']), Number(row['to_make'])]).toEqual([1200, 0]);
  }, 600_000);
});
