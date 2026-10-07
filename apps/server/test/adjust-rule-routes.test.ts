// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE OWNER'S PRICE RULE, through the whole server: an app's rule is switched
 * and never changed; a table of the owner's own is given a rule, which then
 * prices its orders; the add-on's rules page reads every rule with whose it
 * is and whether it runs. Switched off, a rule asks nothing and refuses
 * nothing — but a code typed on an order, which is never taken in silence at
 * the full price.
 */
import { parseDatabaseModel } from '@adminium/engine';
import { auditRepo, overridesRepo, permissionsRepo, rolesRepo, snapshotsRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { priceWorld, seedOffers, type PriceWorld } from './adjust.helpers.js';
import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from './auth-helpers.js';
import { CATEGORY, MARKET, PRICES, PRICE_KIT, type Item } from './fixtures/price-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Doc = Record<string, unknown>;
const money = (value: unknown): string => Number(value).toFixed(2);

describe.each(LEGS)('the owner\'s price rule — %s', (dialect, available) => {
  let w: PriceWorld;
  let served: Served;
  let boss = '';
  let clerk = '';
  const trusted = process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
  const ids = new Map<string, string>();
  const api = (method: string, url: string, payload?: Doc, cookie = boss) =>
    served.composed.app.inject({ method: method as 'POST', url: `/api/v1${url}`, headers: cookie === '' ? {} : { cookie }, ...(payload === undefined ? {} : { payload: payload as never }) });
  const rule = (table: string) => `/connections/${w.h.connectionId}/tables/${encodeURIComponent(ids.get(table)!)}/adjust`;
  const data = (table: string) => `/data/${w.h.connectionId}/${encodeURIComponent(ids.get(table)!)}`;
  const adjusts = async (cookie = boss) => {
    const res = await api('GET', `/add-ons/${PRICE_KIT}/adjusts?connectionId=${w.h.connectionId}`, undefined, cookie);
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as { adjusts: (Doc & { table: string; adjust: Doc })[]; canChange: boolean };
  };
  const line = (item: Item, qty: number): Doc => ({ item_id: w.items[item], category_id: w.categories[CATEGORY[item]], unit_price: PRICES[item], qty });
  const order = async (): Promise<number> => {
    const made = await api('POST', data('market_orders'), { values: { note: 'at the desk' } });
    expect(made.statusCode, made.body).toBe(201);
    return Number((made.json() as { data: Doc }).data['id']);
  };
  const audited = async (action: string) => (await auditRepo(w.h.meta).list({ limit: 200 })).filter((entry) => entry.action === action).length;

  beforeAll(async () => {
    if (!available) return;
    w = await priceWorld(dialect);
    await seedOffers(w, { timeless: true });
    // A shop the owner built before any app: two tables of their own.
    const id = dialect === 'postgres' ? 'SERIAL PRIMARY KEY' : dialect === 'mysql' ? 'INT AUTO_INCREMENT PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    await w.rows(`CREATE TABLE own_sales (id ${id}, note VARCHAR(80), subtotal NUMERIC(12,2) DEFAULT 0, discount NUMERIC(12,2) DEFAULT 0, total NUMERIC(12,2))`);
    await w.rows(`CREATE TABLE own_sale_lines (id ${id}, sale_id INT NOT NULL REFERENCES own_sales(id), label VARCHAR(80), price NUMERIC(12,2) DEFAULT 0, qty INT DEFAULT 1, amount NUMERIC(12,2), discount NUMERIC(12,2) DEFAULT 0)`);
    await w.h.introspect();
    for (const table of parseDatabaseModel((await snapshotsRepo(w.h.meta).latest(w.h.connectionId))!.schema).tables) ids.set(table.name, table.id);
    // The totals the owner drew in Studio: a line's amount, the sale's subtotal over them, and its total.
    const own = (tableName: string, columnName: string, op: string, value: Doc) => overridesRepo(w.h.meta).create({ connectionId: w.h.connectionId, op, tableName: ids.get(tableName)!, columnName, value, origin: 'user' } as never);
    await own('own_sale_lines', 'amount', 'column.formula', { formula: { mul: ['price', 'qty'] } });
    await own('own_sales', 'subtotal', 'column.rollup', { from: ids.get('own_sale_lines')!, via: 'sale_id', sum: 'amount' });
    await own('own_sales', 'total', 'column.formula', { formula: { sub: ['subtotal', 'discount'] } });
    process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = PRICE_KIT;
    served = await servePublic(w.h as never, null, { ADMINIUM_DATA_DIR: w.h.dataDir });
    const login = async (name: string, grant: (userId: string) => Promise<void>) => {
      const user = await usersRepo(w.h.meta).create({ email: `${name}@market.example`, name, passwordHash: await adminPasswordHash(), status: 'active' });
      await grant(user.id);
      return sessionCookie((await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: name === 'boss' ? '10.4.0.1' : '10.4.0.2', payload: { email: `${name}@market.example`, password: ADMIN_PASSWORD } })).headers['set-cookie']);
    };
    boss = await login('boss', async (userId) => rolesRepo(w.h.meta).assignToUser(userId, (await rolesRepo(w.h.meta).findBySlug('super-admin'))!.id));
    // Reads and writes orders, and may not change what a table's columns mean.
    clerk = await login('clerk', async (userId) => {
      const role = await rolesRepo(w.h.meta).create({ slug: 'clerk-role', name: 'Clerk' } as never);
      await permissionsRepo(w.h.meta).grant(role.id, 'table', `${w.h.connectionId}/${ids.get('market_orders')!}`, { read: true, create: true, update: true, delete: false, export: false, import: false } as never);
      await rolesRepo(w.h.meta).assignToUser(userId, role.id);
    });
  }, 240_000);
  afterAll(async () => {
    if (trusted === undefined) delete process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
    else process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = trusted;
    await served?.close();
    if (available) await w.close();
  });

  it.skipIf(!available)('the rules page reads an app\'s rule: whose it is, that it runs, what its lines sell by', async () => {
    const read = await adjusts();
    expect(read.canChange).toBe(true);
    expect(read.adjusts).toHaveLength(1);
    expect(read.adjusts[0]).toMatchObject({ table: ids.get('market_orders'), owner: MARKET, ownerName: 'Market', enabled: true, state: 'live', holding: 0 });
    expect((read.adjusts[0]!['what'] as { table: string; as: string }[]).map((one) => `${one.as} ${one.table}`).sort()).toEqual([`category ${ids.get('market_categories')!}`, `item ${ids.get('market_items')!}`]);
    expect((read.adjusts[0]!.adjust['order'] as Doc)['discount']).toBe('discount');
    // Anybody signed in reads the rules; only somebody who may change what columns mean may change one.
    expect((await adjusts(clerk)).canChange).toBe(false);
    expect((await api('GET', `/add-ons/${PRICE_KIT}/adjusts?connectionId=${w.h.connectionId}`, undefined, '')).statusCode).toBe(401);
    expect((await api('GET', `/add-ons/no-such/adjusts?connectionId=${w.h.connectionId}`)).json()).toMatchObject({ adjusts: [] });
  });

  it.skipIf(!available)('an app\'s rule is switched off and on, never changed or taken away; off asks nothing and refuses only a typed code', async () => {
    const stored = (await adjusts()).adjusts[0]!.adjust;
    for (const refused of [await api('PUT', rule('market_orders'), { adjust: stored }), await api('DELETE', rule('market_orders'))]) {
      expect(refused.statusCode, refused.body).toBe(409);
      expect((refused.json() as { error: { code: string; details: Doc } }).error).toMatchObject({ code: 'CONFLICT', details: { reason: 'managed', app: MARKET } });
    }
    expect((await api('PATCH', `${rule('market_orders')}/switch`, { enabled: false }, clerk)).statusCode).toBe(403);
    // An order that has its code before the rule is switched off.
    const earlier = await order();
    for (const one of [line('Mug, speckled', 2), line('Canvas tote, natural', 2)]) expect((await api('POST', data('market_order_lines'), { values: { order_id: earlier, ...one } })).statusCode).toBe(201);
    const coded = await api('POST', data('market_order_codes'), { values: { order_id: earlier, typed: 'AUTUMN5' } });
    expect(coded.statusCode, coded.body).toBe(201);
    const codeRow = (coded.json() as { data: Doc }).data['id'];
    const before = await audited('ledger.rule.switched');
    const off = await api('PATCH', `${rule('market_orders')}/switch`, { enabled: false });
    expect(off.statusCode, off.body).toBe(200);
    expect(off.json()).toEqual({ enabled: false });
    // Said twice is done once.
    await api('PATCH', `${rule('market_orders')}/switch`, { enabled: false });
    expect(await audited('ledger.rule.switched')).toBe(before + 1);
    expect((await adjusts()).adjusts[0]).toMatchObject({ enabled: false, state: 'off' });

    // An order made now is priced by nobody: the pair of totes is charged in full, and nothing is refused.
    const id = await order();
    const totes = await api('POST', data('market_order_lines'), { values: { order_id: id, ...line('Canvas tote, natural', 2) } });
    expect(totes.statusCode, totes.body).toBe(201);
    expect(money((await w.rows(`SELECT discount FROM market_orders WHERE id = ${String(id)}`))[0]!['discount'])).toBe('0.00');
    // A code typed on it is refused: never taken in silence at the full price.
    const typed = await api('POST', data('market_order_codes'), { values: { order_id: id, typed: 'AUTUMN5' } });
    expect(typed.statusCode, typed.body).toBe(409);
    expect((typed.json() as { error: { code: string; details: Doc } }).error).toMatchObject({ code: 'POSTING_REFUSED', details: { reason: 'add-on-unavailable', column: 'typed' } });
    expect((await w.rows(`SELECT COUNT(*) AS n FROM market_order_codes WHERE order_id = ${String(id)}`))[0]!['n']).toBe(dialect === 'postgres' ? '0' : 0);
    // The code an order already had is not "typed" by a change that sends it back as it stands; another word in its place is.
    const kept = await api('PATCH', `${data('market_order_codes')}/${String(codeRow)}`, { values: { typed: 'AUTUMN5', removed_at: '2026-10-01T10:00:00Z' } });
    expect(kept.statusCode, kept.body).toBe(200);
    const swapped = await api('PATCH', `${data('market_order_codes')}/${String(codeRow)}`, { values: { typed: 'WELCOME10' } });
    expect(swapped.statusCode, swapped.body).toBe(409);
    expect((swapped.json() as { error: { details: Doc } }).error.details).toMatchObject({ reason: 'add-on-unavailable', column: 'typed' });
    // Nor is there anything to try.
    const tried = await api('POST', `${data('market_orders')}/try`, { row: id });
    expect(tried.statusCode, tried.body).toBe(422);
    expect((tried.json() as { error: { details: Doc } }).error.details).toMatchObject({ reason: 'no-adjust' });

    // On again: the next save of the order prices it, and the code is taken.
    expect((await api('PATCH', `${rule('market_orders')}/switch`, { enabled: true })).json()).toEqual({ enabled: true });
    expect((await adjusts()).adjusts[0]).toMatchObject({ enabled: true, state: 'live' });
    const again = await api('POST', data('market_order_lines'), { values: { order_id: id, ...line('Mug, speckled', 2) } });
    expect(again.statusCode, again.body).toBe(201);
    expect(money((await w.rows(`SELECT discount FROM market_orders WHERE id = ${String(id)}`))[0]!['discount'])).toBe('15.00');
    expect((await api('POST', data('market_order_codes'), { values: { order_id: id, typed: 'AUTUMN5' } })).statusCode).toBe(201);
    expect((await api('PATCH', `/connections/${w.h.connectionId}/tables/${encodeURIComponent(ids.get('market_items')!)}/adjust/switch`, { enabled: false })).statusCode).toBe(404);
  });

  it.skipIf(!available)('an owner draws a rule on a table of their own, and its orders are priced; a column another rule writes is refused; taken away, the columns stay', async () => {
    const own = (over: Doc = {}): Doc => ({
      by: { addOn: PRICE_KIT },
      lines: [{ table: ids.get('own_sale_lines'), via: 'sale_id', price: 'price', quantity: 'qty', discount: 'discount', what: [{ column: 'label', as: 'tag' }] }],
      order: { discount: 'discount' },
      expect: 'total',
      ...over,
    });
    expect((await api('PUT', rule('own_sales'), { adjust: own() }, clerk)).statusCode).toBe(403);
    // A reduction written where the sale's own total is added up: refused, with what writes it.
    const clash = await api('PUT', rule('own_sales'), { adjust: own({ order: { discount: 'subtotal' } }) });
    expect(clash.statusCode, clash.body).toBe(422);
    expect((clash.json() as { error: { details: Doc } }).error.details).toMatchObject({ reason: 'column-decided', column: 'subtotal', by: 'rollup' });
    // A reduction written into the link to the sale, into text, or where the rule itself reads a price: each refused by name.
    const line0 = (over: Doc) => ({ lines: [{ ...(own()['lines'] as Doc[])[0], ...over }] });
    const link = await api('PUT', rule('own_sales'), { adjust: own(line0({ discount: 'sale_id' })) });
    expect(link.statusCode, link.body).toBe(422);
    const read = await api('PUT', rule('own_sales'), { adjust: own(line0({ discount: 'price' })) });
    expect(read.statusCode, read.body).toBe(422);
    expect((read.json() as { error: { details: Doc } }).error.details).toMatchObject({ reason: 'column-decided', column: 'price', by: 'adjust' });
    const text = await api('PUT', rule('own_sales'), { adjust: own(line0({ discount: 'label', what: [{ column: 'qty', as: 'tag' }] })) });
    expect(text.statusCode, text.body).toBe(422);
    expect(text.body).toContain('decimal');
    // The add-on's own tables are priced by nobody, and are no part of anybody's order.
    const kitTable = await api('PUT', rule('price_kit_vouchers'), { adjust: own() });
    expect(kitTable.statusCode, kitTable.body).toBe(422);
    expect(kitTable.body).toContain('own tables');
    const kitLines = await api('PUT', rule('own_sales'), { adjust: own({ codes: { table: ids.get('price_kit_codes'), via: 'offer_id', typed: 'code', code: 'offer_id', voucher: 'max_uses' } }) });
    expect(kitLines.statusCode, kitLines.body).toBe(422);
    // A column that is not there; a shape that is no rule.
    expect((await api('PUT', rule('own_sales'), { adjust: own({ order: { discount: 'no_such' } }) })).statusCode).toBe(422);
    expect((await api('PUT', rule('own_sales'), { adjust: { by: { addOn: PRICE_KIT } } })).statusCode).toBe(422);
    expect((await api('PUT', rule('own_sales'), { adjust: own({ by: { addOn: 'no-such' } }) })).statusCode).toBe(422);
    expect((await adjusts()).adjusts).toHaveLength(1);

    const stored = await api('PUT', rule('own_sales'), { adjust: own() });
    expect(stored.statusCode, stored.body).toBe(200);
    expect(stored.json()).toMatchObject({ owner: null, adjust: { order: { discount: 'discount' } } });
    expect(await audited('ledger.rule.stored')).toBe(1);
    const listed = (await adjusts()).adjusts.find((one) => one.table === ids.get('own_sales'))!;
    expect(listed).toMatchObject({ owner: null, enabled: true, state: 'live', holding: 0 });
    expect(listed).not.toHaveProperty('ownerName');

    // A sale of the owner's own, priced: ten percent off everything today.
    await w.insert('price_kit_offers', { name: 'Tenth', kind: 'percent', value: '10.00', trigger: 'auto', scope: 'order' });
    const sale = await api('POST', data('own_sales'), { values: { note: 'first' } });
    expect(sale.statusCode, sale.body).toBe(201);
    const id = (sale.json() as { data: Doc }).data['id'];
    const made = await api('POST', data('own_sale_lines'), { values: { sale_id: id, label: 'Lamp', price: '40.00', qty: 2 } });
    expect(made.statusCode, made.body).toBe(201);
    const [row] = await w.rows(`SELECT subtotal, discount, total FROM own_sales WHERE id = ${String(id)}`);
    expect([money(row!['subtotal']), money(row!['discount']), money(row!['total'])]).toEqual(['80.00', '8.00', '72.00']);
    await w.rows(`UPDATE price_kit_offers SET status = 'ended' WHERE name = 'Tenth'`);

    // Stored again with a change; switched; taken away — the columns and what they hold stay.
    expect((await api('PUT', rule('own_sales'), { adjust: own({ expect: undefined }) })).statusCode).toBe(200);
    expect((await api('PATCH', `${rule('own_sales')}/switch`, { enabled: false })).json()).toEqual({ enabled: false });
    const gone = await api('DELETE', rule('own_sales'));
    expect(gone.statusCode, gone.body).toBe(204);
    expect(await audited('ledger.rule.removed')).toBe(1);
    expect((await adjusts()).adjusts.map((one) => one.table)).toEqual([ids.get('market_orders')]);
    expect((await api('DELETE', rule('own_sales'))).statusCode).toBe(404);
    expect(money((await w.rows(`SELECT discount FROM own_sales WHERE id = ${String(id)}`))[0]!['discount'])).toBe('8.00');
    // A rule stored anew is on: the switch of the one before went with it.
    expect((await api('PUT', rule('own_sales'), { adjust: own() })).statusCode).toBe(200);
    expect((await adjusts()).adjusts.find((one) => one.table === ids.get('own_sales'))).toMatchObject({ enabled: true, state: 'live' });
    await api('DELETE', rule('own_sales'));
  });
});
