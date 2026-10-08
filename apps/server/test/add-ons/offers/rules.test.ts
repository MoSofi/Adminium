// SPDX-License-Identifier: AGPL-3.0-only
/**
 * OFFERS ON A SHOP NOBODY WROTE AN APP FOR.
 *
 * Two plain tables of an owner's own — orders and their lines, with nothing
 * but what was sold — and the Offer rules screen's own requests, in the
 * order it sends them: a dry run that says what would be made, the rule
 * that records what an order used, then the price rule with the dry run's
 * checksum. After that an order is priced by the add-on's own built file, a
 * typed code comes off it, and what it used is counted when it is paid. A
 * second rule on the lines marks a voucher as sold when its order is paid.
 */
import { parseDatabaseModel } from '@adminium/engine';
import { rolesRepo, snapshotsRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { installCustomerKey } from '../../../src/public-api/customer-key.js';
import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from '../../auth-helpers.js';
import { LEGS } from '../../invoicing-install.helpers.js';
import { servePublic, type Served } from '../../public-lane.helpers.js';
import { builtAddOn, installBuilt, writing, type Writing } from '../harness.js';

const offers = builtAddOn('offers');
type Doc = Record<string, unknown>;
const money = (value: unknown): string => Number(value).toFixed(2);
const INTO = (action: string) => ({ addOn: 'offers', ledger: 'value', action });

describe.each(LEGS)('Offers on a plain pair of tables — %s', (dialect, available) => {
  const run = available && offers !== null;
  let w: Writing;
  let served: Served;
  let boss = '';
  const ids = new Map<string, string>();
  const trusted = process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
  const api = (method: string, url: string, payload?: Doc) => served.composed.app.inject({ method: method as 'POST', url: `/api/v1${url}`, headers: { cookie: boss }, ...(payload === undefined ? {} : { payload: payload as never }) });
  const tableAt = (table: string) => `/connections/${w.h.connectionId}/tables/${encodeURIComponent(ids.get(table)!)}`;
  const data = (table: string) => `/data/${w.h.connectionId}/${encodeURIComponent(ids.get(table)!)}`;
  const read = async () => {
    await w.h.introspect();
    for (const table of parseDatabaseModel((await snapshotsRepo(w.h.meta).latest(w.h.connectionId))!.schema).tables) ids.set(table.name, table.id);
  };
  const made = async (table: string, values: Doc): Promise<Doc> => {
    const res = await api('POST', data(table), { values });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: Doc }).data;
  };
  const figures = async (id: unknown) => {
    const [row] = await w.h.rows(`SELECT subtotal, discount, total FROM plain_orders WHERE id = ${String(id)}`);
    return [money(row!['subtotal']), money(row!['discount']), money(row!['total'])];
  };

  beforeAll(async () => {
    installCustomerKey('a secret only this test server knows, long enough');
    if (!run) return;
    w = await writing(
      await installBuilt(dialect, offers, {}, {
        plain_orders: { columns: "note VARCHAR(80), status VARCHAR(16) DEFAULT 'open'", postings: [] },
        plain_lines: { columns: "order_id INT NOT NULL, label VARCHAR(80), item VARCHAR(40), price DECIMAL(12,2) DEFAULT 0, qty INT DEFAULT 1, voucher_id INT, line_status VARCHAR(16) DEFAULT 'open', FOREIGN KEY (order_id) REFERENCES plain_orders(id)", postings: [] },
      }),
    );
    await read();
    process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = 'offers';
    served = await servePublic(w.h as never, null, { ADMINIUM_DATA_DIR: w.h.dataDir });
    const user = await usersRepo(w.h.meta).create({ email: 'boss@offers.dev', name: 'boss', passwordHash: await adminPasswordHash(), status: 'active' } as never);
    await rolesRepo(w.h.meta).assignToUser(user.id, (await rolesRepo(w.h.meta).findBySlug('super-admin'))!.id);
    boss = sessionCookie((await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: '10.4.0.1', payload: { email: 'boss@offers.dev', password: ADMIN_PASSWORD } })).headers['set-cookie']);
  }, 600_000);
  afterAll(async () => {
    if (trusted === undefined) delete process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
    else process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = trusted;
    if (!run) return;
    await served?.close();
    await w.h.close();
  });

  it.skipIf(!run)('on a plain orders and order_lines pair the page\'s rule makes the columns and a code reduces the total', async () => {
    // What the screen reads first: the pair is on offer, and nothing is ruled yet.
    const sources = (await api('GET', `/ledgers/offers/value/sources?connectionId=${w.h.connectionId}`)).json() as { tables: { table: string; lineOf?: { table: string; via: string }[] }[] };
    expect(sources.tables.map((one) => one.table)).toEqual(expect.arrayContaining([ids.get('plain_orders'), ids.get('plain_lines')]));
    const before = (await api('GET', `/add-ons/offers/adjusts?connectionId=${w.h.connectionId}`)).json() as { adjusts: Doc[]; canChange: boolean };
    expect(before).toMatchObject({ adjusts: [], canChange: true });

    // The sheet, filled in: lines, their price, how many, what was sold; "make the rest for me"; final when it is paid.
    const adjust = {
      by: { addOn: 'offers' },
      lines: [{ table: ids.get('plain_lines'), via: 'order_id', price: 'price', quantity: 'qty', discount: 'discount', what: [{ column: 'item', as: 'item' }] }],
      order: { discount: 'discount' },
      codes: { table: 'order_codes', via: 'order_id', typed: 'typed', code: 'code_id', voucher: 'voucher_id', removed: 'removed_at' },
      uses: 'offers-uses',
      frozen: { column: 'status', in: ['paid'] },
      expect: 'total',
    };
    const make = { lineAmount: true, subtotal: true, discount: true, total: true, codes: { table: 'order_codes' } };
    const dry = await api('PUT', `${tableAt('plain_orders')}/adjust`, { adjust, make, dryRun: true });
    expect(dry.statusCode, dry.body).toBe(200);
    const planned = dry.json() as { checksum: string; made: { columns: { table: string; column: string }[]; tables: string[] }; refusals: unknown[] };
    expect(planned.refusals).toEqual([]);
    expect(planned.made.tables).toEqual(['order_codes']);
    // Asked, nothing is made yet.
    expect(await w.h.rows('SELECT * FROM plain_orders')).toEqual([]);
    const uses = await api('PUT', `${tableAt('plain_orders')}/postings/offers-uses`, { into: INTO('redeem'), post: { on: { column: 'status', in: ['paid'] } }, reverse: { on: { column: 'status', in: ['cancelled'] } }, map: {} });
    expect(uses.statusCode, uses.body).toBeLessThan(300);
    const stored = await api('PUT', `${tableAt('plain_orders')}/adjust`, { adjust, make, checksum: planned.checksum });
    expect(stored.statusCode, stored.body).toBe(200);
    await read();
    const after = (await api('GET', `/add-ons/offers/adjusts?connectionId=${w.h.connectionId}`)).json() as { adjusts: Doc[] };
    expect(after.adjusts).toHaveLength(1);
    expect(after.adjusts[0]).toMatchObject({ table: ids.get('plain_orders'), owner: null, state: 'live' });

    // An offer and a code, made as a manager makes them.
    const tenth = (await w.create('offers', { name: 'Tenth', public_name: { 'en-US': 'Ten percent off' }, gives: 'percent', value: '10', applies_to: 'order', trigger: 'code' })).row;
    await w.update('offers', tenth['id'], { status: 'active' });
    await w.create('codes', { offer_id: tenth['id'], code: 'TENTH', active: true });

    // An order through the same doors the dashboard uses.
    const order = await made('plain_orders', { note: 'first' });
    await made('plain_lines', { order_id: order['id'], label: 'Lamp', item: 'lamp', price: '40.00', qty: 2 });
    expect(await figures(order['id'])).toEqual(['80.00', '0.00', '80.00']);
    await made('order_codes', { order_id: order['id'], typed: 'tenth' });
    expect(await figures(order['id'])).toEqual(['80.00', '8.00', '72.00']);
    expect(await w.rowsOf('redemptions')).toEqual([]);

    // Paid: what it used is counted, once, under the name the order goes by.
    const paid = await api('PATCH', `${data('plain_orders')}/${String(order['id'])}`, { values: { status: 'paid' } });
    expect(paid.statusCode, paid.body).toBe(200);
    const counted = await w.rowsOf('redemptions');
    expect(counted.map((row) => `${String(row['kind'])} ${money(row['amount'])} ${String(row['state'])}`)).toEqual(['code 8.00 counted']);
    expect(Number((await w.one('offers', tenth['id']))['uses'])).toBe(1);
    // Cancelled: given back.
    const back = await api('PATCH', `${data('plain_orders')}/${String(order['id'])}`, { values: { status: 'cancelled' } });
    expect(back.statusCode, back.body).toBe(200);
    expect((await w.rowsOf('redemptions')).map((row) => String(row['state']))).toEqual(['given_back']);
    expect(Number((await w.one('offers', tenth['id']))['uses'])).toBe(0);
  });

  it.skipIf(!run)('on the same pair a sold pack is marked sold when its line is paid', async () => {
    // The screen's "sells a voucher or a pack": the line names the voucher, its amount is what it sold for, and it
    // counts when the line itself is marked paid. A rule drawn on a sheet hears its own row only: one that reads its
    // rows as lines of an order is an app's, drawn in its file, and the sheet is refused it.
    const sell = { into: INTO('sell'), post: { on: { column: 'line_status', in: ['paid'] } }, reverse: { on: { column: 'line_status', in: ['cancelled'] } }, map: { voucher: 'voucher_id', amount: 'amount' } };
    const linked = await api('PUT', `${tableAt('plain_lines')}/postings/offers-voucher-sold`, { ...sell, via: 'order_id' });
    expect(linked.statusCode, linked.body).toBe(422);
    const rule = await api('PUT', `${tableAt('plain_lines')}/postings/offers-voucher-sold`, sell);
    expect(rule.statusCode, rule.body).toBeLessThan(300);
    const listed = (await api('GET', `/ledgers/offers/value/postings?connectionId=${w.h.connectionId}`)).json() as { postings: { id: string; action: string; state: string; owner: string | null }[] };
    // The owner's own two, beside the add-on's.
    expect(listed.postings.filter((one) => one.owner === null).map((one) => `${one.id} ${one.action} ${one.state}`).sort()).toEqual(['offers-uses redeem live', 'offers-voucher-sold sell live']);

    const pack = (await w.create('vouchers', { worth: 'pack', what: 'tag', source_row: 'classes', public_name: '10 classes', uses_total: 10, awaiting_sale: true })).row;
    const order = await made('plain_orders', { note: 'a pack' });
    const line = await made('plain_lines', { order_id: order['id'], label: '10 classes', item: 'pack-10', price: '120.00', qty: 1, voucher_id: pack['id'] });
    const mark = (status: string) => api('PATCH', `${data('plain_lines')}/${String(line['id'])}`, { values: { line_status: status } });
    const waiting = await w.one('vouchers', pack['id']);
    expect(Number(waiting['sale_price'] ?? 0)).toBe(0);
    const paid = await mark('paid');
    expect(paid.statusCode, paid.body).toBe(200);
    const sold = await w.one('vouchers', pack['id']);
    expect(money(sold['sale_price'])).toBe('120.00');
    expect([true, 1]).toContain(sold['sold']);
    expect([false, 0]).toContain(sold['awaiting_sale']);
    // The line cancelled before any class was taken: the pack waits to be sold again.
    const back = await mark('cancelled');
    expect(back.statusCode, back.body).toBe(200);
    const again = await w.one('vouchers', pack['id']);
    expect([false, 0]).toContain(again['sold']);
    expect([true, 1]).toContain(again['awaiting_sale']);
  });
});
