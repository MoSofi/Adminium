// SPDX-License-Identifier: AGPL-3.0-only
/**
 * OFFERS, CODES AND VOUCHERS, THROUGH A SHOP'S OWN ORDERS.
 *
 * The built add-on answering a real price question: the worked order comes
 * to $48.11 from the dry run and from the save; what an order used is
 * recorded once, where it is paid, and given back when it is cancelled; a
 * code good for fifty uses takes fifty of fifty-one orders paid at once; a
 * pack of ten is used ten times; and a guest who types a code kept for a
 * known customer is told to sign in.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GUEST, refused } from '../../adjust-save.helpers.js';
import { LEGS } from '../../invoicing-install.helpers.js';
import { money2, offers, offersWorld, type OffersWorld } from './world.js';

type Doc = Record<string, unknown>;
const said = (text: string) => ({ 'en-US': text });

describe.each(LEGS)('offers through a shop — %s', (dialect, available) => {
  const run = available && offers !== null;
  let w: OffersWorld;
  const item: Record<string, number> = {};
  const offer: Record<string, number> = {};
  let ada = 0;
  let goodwill = 0;

  beforeAll(async () => {
    if (!run) return;
    w = await offersWorld(dialect);
    for (const [name, price, tag] of [['Mug, speckled', '14.00', 'mugs'], ['Canvas tote, natural', '15.00', 'bags'], ['Notebook, A5', '6.50', null], ['Candle, fig', '18.00', null], ['Class', '15.00', null]] as const) {
      item[name] = await w.insert('shop_items', { name, price, tag });
    }
    ada = await w.insert('shop_customers', { name: 'Ada', email: 'ada@shop.example' });
    const base = { applies_to: 'order', trigger: 'automatic', status: 'active', budget_open: true, combinable: true, first_order_only: false, used_up: false };
    offer['welcome'] = await w.insert('offers_offers', { ...base, name: 'Welcome 10', public_name: said('10 % off your first order'), gives: 'percent', value: '10', trigger: 'code', first_order_only: true, max_per_customer: 1 });
    offer['pair'] = await w.insert('offers_offers', { ...base, name: 'Tote pair', public_name: said('Two totes, the cheaper one on us'), gives: 'bonus_item', buy_qty: 2, bonus_qty: 1, applies_to: 'lines' });
    offer['launch'] = await w.insert('offers_offers', { ...base, name: 'Launch week', public_name: said('20 % off'), gives: 'percent', value: '20', trigger: 'code', max_uses: 50 });
    await w.insert('offers_offer_targets', { offer_id: offer['pair'], kind: 'tag', source_table: '', source_row: 'bags', label: 'Bags' });
    await w.insert('offers_codes', { offer_id: offer['welcome'], code: 'WELCOME10', active: true });
    await w.insert('offers_codes', { offer_id: offer['launch'], code: 'LAUNCH20', active: true, max_uses: 50 });
    goodwill = await w.insert('offers_reasons', { label: 'Goodwill', active: true, position: 1 });
  }, 240_000);
  afterAll(async () => {
    if (run) await w.close();
  });

  const lineOf = (name: string, qty: number, price: string): Doc => ({ item_id: item[name], tag: name.startsWith('Mug') ? 'mugs' : name.startsWith('Canvas') ? 'bags' : null, unit_price: price, qty });
  const WORKED = (): Doc[] => [lineOf('Mug, speckled', 2, '14.00'), lineOf('Canvas tote, natural', 2, '15.00'), lineOf('Notebook, A5', 1, '6.50')];
  const tree = (values: Doc, lines: Doc[], codes: string[] = []) => ({
    table: 'shop_orders',
    values,
    lists: { lines: { table: 'shop_order_lines', via: 'order_id', rows: lines }, ...(codes.length === 0 ? {} : { codes: { table: 'shop_order_codes', via: 'order_id', rows: codes.map((typed) => ({ typed })) } }) },
  });
  const figures = async (id: unknown) => {
    const row = await w.row('shop_orders', id);
    return Object.fromEntries(['subtotal', 'discount', 'net', 'tax', 'total'].map((name) => [name, money2(row[name])]));
  };
  const lineDiscounts = async (id: unknown) => (await w.all('shop_order_lines', `order_id = ${String(id)}`)).map((row) => money2(row['discount']));
  const applied = async (id: unknown) =>
    (await w.all('offers_applied', `source_table = 'shop:orders' AND source_row = '${String(id)}'`)).map((row) => `${String(row['kind'])} ${money2(row['amount'])}`).sort();
  const uses = async (id: unknown) =>
    (await w.all('offers_redemptions', `source_table = 'shop:orders' AND source_row = '${String(id)}'`)).map((row) => `${String(row['kind'])} ${money2(row['amount'])} ${String(row['state'])}`).sort();
  const settle = async (run_: Promise<unknown>): Promise<string> => {
    try {
      await run_;
      return 'ok';
    } catch (error) {
      const told = error as { code?: string; details?: { reason?: string } };
      return `${String(told.code)}:${String(told.details?.reason)}`;
    }
  };

  it.skipIf(!run)('the worked order comes to 48.11 from the dry run and the save', async () => {
    const order = tree({ customer_id: ada, note: 'Order 125' }, WORKED(), ['WELCOME10']);
    // The dry run first: the same figures, and nothing kept.
    const quoted = await w.tree(order, { mode: 'dry' });
    expect(money2(quoted.root['total'])).toBe('48.11');
    expect(money2(quoted.root['discount'])).toBe('19.95');
    expect((await w.all('shop_orders', "note = 'Order 125'")).length).toBe(0);
    expect((await w.all('offers_applied')).length).toBe(0);

    const made = await w.tree(order);
    const id = made.root['id'];
    // Tote pair −15.00 on the totes; ten percent of the $49.50 left, split 2.80 / 1.50 / 0.65; tax on the order's net.
    expect(await figures(id)).toEqual({ subtotal: '64.50', discount: '19.95', net: '44.55', tax: '3.56', total: '48.11' });
    expect(await lineDiscounts(id)).toEqual(['2.80', '16.50', '0.65']);
    expect(await applied(id)).toEqual(['code 0.65', 'code 1.50', 'code 2.80', 'offer 15.00']);
    // What was applied is kept as it read: the offer's own name, the line it was on.
    const rows = await w.all('offers_applied', `source_table = 'shop:orders' AND source_row = '${String(id)}' AND kind = 'offer'`);
    // (One database hands a json column over as text, another as what it holds.)
    const name = rows[0]!['name'];
    expect(typeof name === 'string' ? JSON.parse(name) : name).toEqual({ 'en-US': 'Two totes, the cheaper one on us' });
    // An open order has used nothing yet.
    expect(await uses(id)).toEqual([]);

    // Paid: one use for the pair, one for the code — the customer's, by a key and never by an address.
    await w.create('shop_payments', { order_id: id, method: 'cash', amount: '48.11' });
    await w.update('shop_orders', id, { status: 'paid' });
    expect(await uses(id)).toEqual(['code 4.95 counted', 'offer 15.00 counted']);
    const use = (await w.all('offers_redemptions', `source_row = '${String(id)}' AND kind = 'code'`))[0]!;
    expect(use['customer']).toBe(w.key('ada@shop.example'));
    expect(use['source_label']).toBe('Order 125');
    expect(JSON.stringify(await w.all('offers_redemptions'))).not.toContain('ada@shop.example');
    expect(Number((await w.row('offers_offers', offer['welcome']))['uses'])).toBe(1);

    // The same customer again: once each, and this was it.
    const again = await refused(w.tree(tree({ customer_id: ada }, WORKED(), ['WELCOME10'])));
    expect(again.code, again.message).toBe('ADJUST_REFUSED');
    expect(again.details).toMatchObject({ reason: 'over-limit' });
  });

  it.skipIf(!run)('a cancelled order gives its use back, once', async () => {
    const ben = await w.insert('shop_customers', { name: 'Ben', email: 'ben@shop.example' });
    const made = await w.tree(tree({ customer_id: ben }, WORKED(), ['WELCOME10']));
    const id = made.root['id'];
    await w.create('shop_payments', { order_id: id, method: 'cash', amount: '48.11' });
    await w.update('shop_orders', id, { status: 'paid' });
    const before = Number((await w.row('offers_offers', offer['welcome']))['uses']);
    await w.update('shop_orders', id, { status: 'cancelled' });
    expect(await uses(id)).toEqual(['code 4.95 given_back', 'offer 15.00 given_back']);
    expect(Number((await w.row('offers_offers', offer['welcome']))['uses'])).toBe(before - 1);
    for (const row of await w.all('offers_redemptions', `source_row = '${String(id)}'`)) expect(row['given_back_at']).not.toBeNull();
    // Given back, the code is this customer's to use again.
    const again = await w.tree(tree({ customer_id: ben }, [lineOf('Notebook, A5', 2, '6.50')], ['WELCOME10']));
    expect((await figures(again.root['id']))['discount']).toBe('1.30');
  });

  it.skipIf(!run)('a guest is told to sign in and nothing about the address', async () => {
    const typed = await refused(w.tree(tree({}, WORKED(), ['WELCOME10']), { context: GUEST }));
    // Said on the field the code was typed into.
    expect(typed.details).toMatchObject({ fields: { typed: { code: 'needs-sign-in' } } });
    // The same words whatever the guest claims to be: a customer named on the order proves nothing.
    const claimed = await refused(w.tree(tree({ customer_id: ada }, WORKED(), ['WELCOME10']), { context: GUEST }));
    expect(claimed.details).toEqual(typed.details);
    expect(claimed.code).toBe(typed.code);
    expect(JSON.stringify(typed.details)).not.toContain('shop.example');
    // Without the code the guest's order is priced, with what came by itself.
    const plain = await w.tree(tree({}, WORKED()), { context: GUEST });
    expect(await figures(plain.root['id'])).toMatchObject({ discount: '15.00', net: '49.50', total: '53.46' });
  });

  it.skipIf(!run)('a code nobody issued, and a gift card typed where a code goes, are not valid', async () => {
    for (const typed of ['NOSUCHCODE', 'GC-7K2M-W3HN-Q4XP']) {
      const refusal = await refused(w.tree(tree({ customer_id: ada }, WORKED(), [typed])));
      expect(refusal.code, typed).toBe('ADJUST_REFUSED');
      expect(refusal.details, typed).toMatchObject({ reason: 'unknown', column: 'typed' });
    }
  });

  it.skipIf(!run)('fifty-one uses of a fifty-use code give fifty', async () => {
    // Fifty-one open orders, each with the code: every one is priced with it — none has used it yet.
    const ids: unknown[] = [];
    for (let n = 0; n < 51; n += 1) {
      const made = await w.tree(tree({}, [lineOf('Mug, speckled', 1, '14.00')], ['LAUNCH20']));
      ids.push(made.root['id']);
      await w.create('shop_payments', { order_id: made.root['id'], method: 'cash', amount: '12.10' });
    }
    expect(await figures(ids[50])).toMatchObject({ discount: '2.80', total: '12.10' });
    // Paid at once: fifty are counted, and one is told the code has run out.
    const sent = await Promise.all(ids.map((id) => settle(w.update('shop_orders', id, { status: 'paid' }))));
    expect(sent.filter((one) => one === 'ok')).toHaveLength(50);
    expect(sent.filter((one) => one !== 'ok')).toEqual(['ADJUST_REFUSED:used-up']);
    const launch = await w.row('offers_offers', offer['launch']);
    expect(Number(launch['uses'])).toBe(50);
    expect([true, 1, '1']).toContain(launch['used_up']);
    expect((await w.all('offers_redemptions', `offer_id = ${String(offer['launch'])} AND state = 'counted'`)).length).toBe(50);
    // The fifty-second customer is told so before they pay.
    const late = await refused(w.tree(tree({}, [lineOf('Mug, speckled', 1, '14.00')], ['LAUNCH20'])));
    expect(late.details).toMatchObject({ reason: 'used-up' });
  });

  it.skipIf(!run)('a voucher for one candle takes one of two, and is used when its order is paid', async () => {
    const voucher = await w.create('offers_vouchers', { worth: 'thing', what: 'item', source_table: 'shop:items', source_row: String(item['Candle, fig']), public_name: 'One candle' });
    const code = String((await w.row('offers_vouchers', voucher['id']))['code']);
    // Typed with its word, as it is printed.
    const made = await w.tree(tree({}, [lineOf('Candle, fig', 2, '18.00')], [`VC-${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`]));
    const id = made.root['id'];
    expect(await figures(id)).toMatchObject({ subtotal: '36.00', discount: '18.00', net: '18.00', tax: '1.44', total: '19.44' });
    expect(await applied(id)).toEqual(['voucher 18.00']);
    await w.create('shop_payments', { order_id: id, method: 'cash', amount: '19.44' });
    await w.update('shop_orders', id, { status: 'paid' });
    expect(await uses(id)).toEqual(['voucher 18.00 counted']);
    expect(await w.row('offers_vouchers', voucher['id'])).toMatchObject({ status: 'used' });
    expect(Number((await w.row('offers_vouchers', voucher['id']))['uses_left'])).toBe(0);
    // Used: typed on another order, it is told so.
    const again = await refused(w.tree(tree({}, [lineOf('Candle, fig', 1, '18.00')], [code])));
    expect(again.details).toMatchObject({ reason: 'used-up' });
    // The first order cancelled: the use comes back, and the voucher with it.
    await w.update('shop_orders', id, { status: 'cancelled' });
    expect(await w.row('offers_vouchers', voucher['id'])).toMatchObject({ status: 'issued' });
    expect(Number((await w.row('offers_vouchers', voucher['id']))['uses_left'])).toBe(1);
  });

  it.skipIf(!run)('ten uses of a pack pass and the eleventh is refused', async () => {
    const pack = await w.create('offers_vouchers', { worth: 'pack', what: 'item', source_table: 'shop:items', source_row: String(item['Class']), public_name: '10 classes', uses_total: 10 });
    const sent = await Promise.all(Array.from({ length: 11 }, () => settle(w.create('offers_voucher_actions', { voucher_id: pack['id'], action: 'use' }))));
    expect(sent.filter((one) => one === 'ok')).toHaveLength(10);
    expect(sent.filter((one) => one !== 'ok')).toHaveLength(1);
    const row = await w.row('offers_vouchers', pack['id']);
    expect(Number(row['uses_left'])).toBe(0);
    expect(row['status']).toBe('used');
    // One given back by hand: nine taken, and the pack is in use again.
    await w.create('offers_voucher_actions', { voucher_id: pack['id'], action: 'give_back' });
    expect(await w.row('offers_vouchers', pack['id'])).toMatchObject({ status: 'issued' });
    expect(Number((await w.row('offers_vouchers', pack['id']))['uses_left'])).toBe(1);
    // Cancelled: no use is taken from it again.
    await w.create('offers_voucher_actions', { voucher_id: pack['id'], action: 'void', note: 'Bought twice' });
    expect(await w.row('offers_vouchers', pack['id'])).toMatchObject({ status: 'voided' });
    expect(await settle(w.create('offers_voucher_actions', { voucher_id: pack['id'], action: 'use' }))).toBe('POSTING_REFUSED:void');
  });

  it.skipIf(!run)('what staff take off by hand is a use with its reason, on the goods the offers left', async () => {
    const made = await w.tree(tree({ discount_kind: 'percent', discount_value: '10', discount_reason: goodwill, note: 'Table 4' }, WORKED()));
    const id = made.root['id'];
    // Tote pair first (−15.00), then ten percent of $49.50.
    expect(await figures(id)).toMatchObject({ discount: '19.95', net: '44.55' });
    expect(await applied(id)).toEqual(['offer 15.00', 'staff 0.65', 'staff 1.50', 'staff 2.80']);
    expect((await w.row('shop_orders', id))['discount_by']).not.toBeNull();
    await w.create('shop_payments', { order_id: id, method: 'cash', amount: '48.11' });
    await w.update('shop_orders', id, { status: 'paid' });
    const staff = (await w.all('offers_redemptions', `source_row = '${String(id)}' AND kind = 'staff'`))[0]!;
    expect(money2(staff['amount'])).toBe('4.95');
    expect(Number(staff['reason_id'])).toBe(goodwill);
    expect(staff['offer_id']).toBeNull();
  });

  it.skipIf(!run)('a batch makes its vouchers in parts, each with a code of its own, and no more than it was asked for', async () => {
    const batch = await w.create('offers_voucher_batches', { name: 'Leaflet drop', count: 120, worth: 'amount', value: '5', public_name: 'Leaflet drop', expires_on: '2026-11-30' });
    await w.create('offers_batch_chunks', { batch_id: batch['id'], size: 100 });
    const over = await settle(w.create('offers_batch_chunks', { batch_id: batch['id'], size: 21 }));
    expect(over).not.toBe('ok');
    await w.create('offers_batch_chunks', { batch_id: batch['id'], size: 20 });
    const made = await w.all('offers_vouchers', `batch_id = ${String(batch['id'])}`);
    expect(made).toHaveLength(120);
    expect(new Set(made.map((row) => String(row['code']))).size).toBe(120);
    for (const row of made.slice(0, 3)) {
      expect(String(row['code'])).toMatch(/^[0-9A-Z]{12}$/);
      expect(row).toMatchObject({ worth: 'amount', status: 'issued', public_name: 'Leaflet drop' });
      expect(row['code_last4']).toBe(String(row['code']).slice(-4));
    }
    const row = await w.row('offers_voucher_batches', batch['id']);
    expect([Number(row['made']), Number(row['to_make']), Number(row['asked'])]).toEqual([120, 0, 120]);
    // One of them, typed bare as a scan reads it, takes five dollars off.
    const order = await w.tree(tree({}, [lineOf('Mug, speckled', 1, '14.00')], [String(made[0]!['code'])]));
    expect((await figures(order.root['id']))['discount']).toBe('5.00');
  });
});
