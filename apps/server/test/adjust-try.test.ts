// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A PRICE TRIED BEFORE IT IS SAVED — through the whole server, with the price
 * add-on's real deciding file. A saved order is asked about with an offer
 * that is not stored yet, with other codes in place of its own, as a guest
 * and as a signed-in customer; every offer gets a reason; and nothing at all
 * is written: no row, no transaction, no lock. What a try shows is what the
 * save then stores.
 */
import { auditRepo, permissionsRepo, rolesRepo, usersRepo } from '@adminium/meta';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { orderFigures } from '../src/crud/adjust/figures.js';
import { priceWorld, seedOffers, lineOf, type PriceWorld } from './adjust.helpers.js';
import { saveWorld } from './adjust-save.helpers.js';
import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from './auth-helpers.js';
import { CATEGORY, MARKET_ADJUST, PRICE_KIT, PRICES, WIDE_ADJUST, marketManifest, type Item } from './fixtures/price-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Doc = Record<string, unknown>;
type Tried = {
  data: Doc;
  lines: { table: string; key: string; discount: string }[];
  applied: { line: string | null; name: string; kind: string; amount: string; typed: boolean }[];
  told: unknown[];
  refused: { typed: string; reason: string; params?: Doc }[];
  explain?: { offer: string; name: string; applies: boolean; reason?: string; amount?: string }[];
};

const BASKET: readonly (readonly [Item, number])[] = [
  ['Mug, speckled', 2],
  ['Canvas tote, natural', 2],
  ['Notebook, A5', 1],
];
const money = (value: unknown): string => Number(value).toFixed(2);
const figuresOf = (data: Doc): Record<string, string> => Object.fromEntries(['subtotal', 'discount', 'net', 'tax', 'total'].map((column) => [column, money(data[column])]));

describe.each(LEGS)('a price tried before it is saved — %s', (dialect, available) => {
  let w: PriceWorld;
  let served: Served;
  let offers: Record<string, number>;
  const cookies = new Map<string, string>();
  const trusted = process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
  const tableId = (name: string) => w.table(name).id;
  const tryIt = (body: Doc, as = 'boss', table = 'market_orders') =>
    served.composed.app.inject({ method: 'POST', url: `/api/v1/data/${w.h.connectionId}/${encodeURIComponent(tableId(table))}/try`, headers: as === '' ? {} : { cookie: cookies.get(as)! }, payload: body as never });
  const tried = async (body: Doc, as = 'boss'): Promise<Tried> => {
    const res = await tryIt(body, as);
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as Tried;
  };
  /** An order put straight into the shop's tables: nobody priced it. */
  const place = async (codes: readonly string[] = [], over: Doc = {}): Promise<number> => {
    const subtotal = BASKET.reduce((sum, [item, qty]) => sum + Number(lineOf(w, item, qty)['amount']), 0).toFixed(2);
    const id = await w.insert('market_orders', { status: 'open', subtotal, net: subtotal, tax: (Number(subtotal) * 0.08).toFixed(2), total: (Number(subtotal) * 1.08).toFixed(2), ...over });
    for (const [item, qty] of BASKET) await w.insert('market_order_lines', { order_id: id, ...lineOf(w, item, qty) });
    for (const typed of codes) await w.insert('market_order_codes', { order_id: id, typed });
    return id;
  };
  /** Every row a try could have written, as text: the same before and after. */
  const everything = async (): Promise<string> =>
    JSON.stringify(
      await Promise.all(
        ['market_orders', 'market_order_lines', 'market_order_codes', 'price_kit_applied', 'price_kit_redemptions', 'price_kit_offers', 'price_kit_codes', 'price_kit_uses_receipts'].map(async (name) => {
          try {
            return await w.rows(`SELECT * FROM ${name} ORDER BY id`);
          } catch {
            return name;
          }
        }),
      ),
    );

  async function person(name: string, grants: 'super-admin' | Record<string, Doc>): Promise<void> {
    const user = await usersRepo(w.h.meta).create({ email: `${name}@market.example`, name, passwordHash: await adminPasswordHash(), status: 'active' });
    const roles = rolesRepo(w.h.meta);
    if (grants === 'super-admin') await roles.assignToUser(user.id, (await roles.findBySlug('super-admin'))!.id);
    else {
      const role = await roles.create({ slug: `${name}-role`, name } as never);
      for (const [table, actions] of Object.entries(grants)) {
        await permissionsRepo(w.h.meta).grant(role.id, 'table', `${w.h.connectionId}/${tableId(table)}`, { read: false, create: false, update: false, delete: false, export: false, import: false, ...actions } as never);
      }
      await roles.assignToUser(user.id, role.id);
    }
    const login = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.2.0.${String(cookies.size + 1)}`, payload: { email: `${name}@market.example`, password: ADMIN_PASSWORD } });
    cookies.set(name, sessionCookie(login.headers['set-cookie']));
  }

  beforeAll(async () => {
    if (!available) return;
    w = await priceWorld(dialect, { market: marketManifest({}, MARKET_ADJUST, { uses: 'held' }) });
    ({ offers } = await seedOffers(w, { timeless: true }));
    process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = PRICE_KIT;
    served = await servePublic(w.h as never, null, { ADMINIUM_DATA_DIR: w.h.dataDir });
    await person('boss', 'super-admin');
    const reads = { read: true };
    // Reads the order, its lines and its codes, and may not change an offer.
    await person('till', { market_orders: reads, market_order_lines: reads, market_order_codes: reads, price_kit_offers: reads });
    // Reads orders and offers and may change offers, and reads none of the add-on's codes.
    await person('blind', { market_orders: reads, market_order_lines: reads, market_order_codes: reads, price_kit_offers: { read: true, update: true } });
    // May change offers, and reads orders without their lines.
    await person('planner', { market_orders: reads, market_order_codes: reads, price_kit_offers: { read: true, update: true } });
    const all = { market_orders: reads, market_order_lines: reads, market_order_codes: reads, price_kit_offers: { read: true, update: true }, price_kit_codes: reads, price_kit_vouchers: reads };
    await person('owner', all);
    await person('eager', all);
    // Reads an order's figures and not its note; changes offers without reading what they are called.
    await person('narrow', {
      market_orders: { read: true, readLimit: { readable: ['id', 'status', 'subtotal', 'discount', 'net', 'tax', 'total'] } },
      market_order_lines: reads,
      market_order_codes: reads,
      price_kit_offers: { read: true, update: true, readLimit: { readable: ['id', 'status', 'kind', 'value'] } },
    });
  }, 240_000);
  afterAll(async () => {
    if (trusted === undefined) delete process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
    else process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = trusted;
    await served?.close();
    if (available) await w.close();
  });

  it.skipIf(!available)('an unsaved offer is tried on a saved order and every offer gets a reason', async () => {
    const order = await place();
    const before = await everything();
    const out = await tried({ row: order, draft: { name: 'Flash 10', kind: 'percent', value: '10.00', trigger: 'auto', scope: 'order' }, explain: true });
    // The pair of totes, then ten percent of what is left: 64.50 − 15.00 − 4.95, tax on the net.
    expect(figuresOf(out.data)).toEqual({ subtotal: '64.50', discount: '19.95', net: '44.55', tax: '3.56', total: '48.11' });
    expect(out.applied).toEqual([
      { line: `market_order_lines:${String(out.lines[1]!.key)}`, name: 'Tote pair', kind: 'offer', amount: '15.00', typed: false },
      { line: null, name: 'Flash 10', kind: 'offer', amount: '4.95', typed: false },
    ]);
    expect(out.lines.map((line) => line.table)).toEqual(['market_order_lines', 'market_order_lines', 'market_order_lines']);
    expect(out.lines.reduce((sum, line) => sum + Number(line.discount), 0).toFixed(2)).toBe('19.95');
    expect(out.refused).toEqual([]);
    // One entry for every offer of the shop — the ended and the paused ones too — and for the one being tried.
    const why = new Map(out.explain!.map((entry) => [entry.name, entry]));
    expect([...why.keys()].sort()).toEqual(['Autumn 5', 'Flash 10', 'Launch week', 'Monday mugs', 'Summer close-out', 'Tote pair', 'Welcome 10']);
    expect(why.get('Summer close-out')).toMatchObject({ offer: String(offers['Summer close-out']), applies: false, reason: 'ended' });
    expect(why.get('Monday mugs')).toMatchObject({ applies: false, reason: 'paused' });
    expect(why.get('Autumn 5')).toMatchObject({ applies: false, reason: 'no-code-typed' });
    expect(why.get('Tote pair')).toMatchObject({ applies: true, amount: '15.00' });
    expect(why.get('Flash 10')).toMatchObject({ offer: 'draft', applies: true, amount: '4.95' });
    // Nothing was written anywhere: the order stands unpriced, as it was put in.
    expect(await everything()).toBe(before);

    // An offer being edited stands in for the stored one of its key, and is judged as if it were on.
    const again = await tried({ row: order, draft: { id: offers['Summer close-out'], name: 'Summer, again', kind: 'percent', value: '25.00', trigger: 'auto', scope: 'order' }, explain: true });
    expect(again.explain!.find((entry) => entry.offer === String(offers['Summer close-out']))).toMatchObject({ name: 'Summer, again', applies: true });
    expect(again.explain!.some((entry) => entry.offer === 'draft')).toBe(false);
    // Without the question, no reasons; and without a draft, the order as its stored offers price it.
    const plain = await tried({ row: order });
    expect(plain.explain).toBeUndefined();
    expect(figuresOf(plain.data)).toMatchObject({ discount: '15.00', total: '53.46' });
    // A draft holds only what an offer holds.
    const stray = await tryIt({ row: order, draft: { name: 'x', no_such_column: 1 } });
    expect(stray.statusCode, stray.body).toBe(422);
    expect(await everything()).toBe(before);
  });

  it.skipIf(!available)('a guest and a signed-in buyer are tried apart', async () => {
    const order = await place();
    const guest = await tried({ row: order, codes: ['WELCOME10'] });
    expect(guest.refused).toEqual([{ typed: 'WELCOME10', reason: 'needs-sign-in' }]);
    expect(figuresOf(guest.data).total).toBe('53.46');
    expect(guest.applied.map((entry) => entry.name)).toEqual(['Tote pair']);
    const customer = await tried({ row: order, codes: ['WELCOME10'], buyer: 'customer' });
    expect(customer.refused).toEqual([]);
    expect(figuresOf(customer.data)).toEqual({ subtotal: '64.50', discount: '19.95', net: '44.55', tax: '3.56', total: '48.11' });
    expect(customer.applied).toContainEqual({ line: null, name: 'Welcome 10', kind: 'code', amount: '4.95', typed: true });
    // Nobody real was read: the order names no customer, and none was looked for.
    expect((await w.rows(`SELECT customer_id FROM market_orders WHERE id = ${String(order)}`))[0]!['customer_id']).toBeNull();
  });

  it.skipIf(!available)('typed codes replace the stored ones, a code that does not stand is listed, and an order whose price stands can be tried', async () => {
    const order = await place(['AUTUMN5']);
    // Its own code, as stored.
    expect(figuresOf((await tried({ row: order })).data).total).toBe('48.06');
    // No code at all, in its place.
    expect(figuresOf((await tried({ row: order, codes: [] })).data).total).toBe('53.46');
    // Two that do not stand beside one that does: each listed with why, and the price is what the one that stands gives.
    const mixed = await tried({ row: order, codes: ['NOSUCHCODE', 'AUTUMN5', 'LAUNCH20'] });
    expect(mixed.refused).toEqual([
      { typed: 'NOSUCHCODE', reason: 'unknown' },
      { typed: 'LAUNCH20', reason: 'used-up' },
    ]);
    expect(figuresOf(mixed.data).total).toBe('48.06');
    // Judged at another moment: a code that ended since.
    await w.rows(`UPDATE price_kit_codes SET valid_until = '2026-09-26' WHERE code = 'AUTUMN5'`);
    const late = await tried({ row: order });
    const early = await tried({ row: order, at: '2026-09-25T12:00:00Z' });
    await w.rows(`UPDATE price_kit_codes SET valid_until = NULL WHERE code = 'AUTUMN5'`);
    expect(late.refused).toEqual([{ typed: 'AUTUMN5', reason: 'expired' }]);
    expect(early.refused).toEqual([]);
    expect(figuresOf(early.data).total).toBe('48.06');
    // A value typed longer than any code is: listed as no code, and the try still answers.
    const long = await w.insert('market_order_codes', { order_id: order, typed: 'X'.repeat(70) }).catch(() => null);
    if (long !== null) {
      const listed = await tried({ row: order });
      expect(listed.refused).toEqual([{ typed: 'X'.repeat(64), reason: 'unknown' }]);
      expect(figuresOf(listed.data).total).toBe('48.06');
      await w.rows(`DELETE FROM market_order_codes WHERE id = ${String(long)}`);
    }
    // Paid: its price stands for good, and a save of anything it rests on is refused — a try is not.
    await w.rows(`UPDATE market_orders SET status = 'paid' WHERE id = ${String(order)}`);
    expect(figuresOf((await tried({ row: order, codes: ['AUTUMN5'] })).data).total).toBe('48.06');
  });

  it.skipIf(!available)('what a try shows is what the save then stores', async () => {
    const order = await place();
    const shown = await tried({ row: order, codes: ['AUTUMN5'] });
    const staff = (method: string, url: string, payload?: Doc) =>
      served.composed.app.inject({ method: method as 'POST', url: `/api/v1/data/${w.h.connectionId}/${url}`, headers: { cookie: cookies.get('boss')! }, ...(payload === undefined ? {} : { payload }) });
    const saved = await staff('POST', encodeURIComponent(tableId('market_order_codes')), { values: { order_id: order, typed: 'AUTUMN5' } });
    expect(saved.statusCode, saved.body).toBe(201);
    const [stored] = await w.rows(`SELECT subtotal, discount, net, tax, total FROM market_orders WHERE id = ${String(order)}`);
    expect(figuresOf(stored!)).toEqual(figuresOf(shown.data));
    const lines = await w.rows(`SELECT id, discount FROM market_order_lines WHERE order_id = ${String(order)} ORDER BY id`);
    expect(lines.map((line) => ({ key: String(line['id']), discount: money(line['discount']) }))).toEqual(shown.lines.map((line) => ({ key: line.key, discount: money(line.discount) })));
  });

  it.skipIf(!available)('an order\'s own held use does not count against it in a try', async () => {
    const save = saveWorld(w);
    // One use of the code in all, and this order holds it from the moment it was placed.
    const offer = await w.insert('price_kit_offers', { name: 'Once', kind: 'amount', value: '2.00', trigger: 'code', scope: 'order', max_uses: 1 });
    await w.insert('price_kit_codes', { code: 'ONCE2', offer_id: offer });
    const made = await save.create('market_orders', { status: 'open' });
    const id = made['id'];
    for (const [item, qty] of BASKET) await save.create('market_order_lines', { order_id: id, item_id: w.items[item], category_id: w.categories[CATEGORY[item]], unit_price: PRICES[item], qty });
    await save.create('market_order_codes', { order_id: id, typed: 'ONCE2' });
    await save.update('market_orders', id, { status: 'placed' });
    expect(Number((await w.rows(`SELECT uses FROM price_kit_offers WHERE id = ${String(offer)}`))[0]!['uses'])).toBe(1);
    const own = await tried({ row: Number(id) });
    expect(own.refused).toEqual([]);
    expect(own.applied.map((entry) => entry.name)).toContain('Once');
    // Another order is told the code is used up.
    const other = await place();
    expect((await tried({ row: other, codes: ['ONCE2'] })).refused).toEqual([{ typed: 'ONCE2', reason: 'used-up' }]);
  });

  it.skipIf(!available)('a try opens no transaction, issues no statement that writes, and waits for no lock', async () => {
    const order = await place(['AUTUMN5']);
    const save = saveWorld(w);
    const target = w.target('market_orders');
    let writes = 0;
    const watched = target.db.withPlugin({
      transformQuery: (query) => {
        if (query.node.kind !== 'SelectQueryNode') writes += 1;
        return query.node;
      },
      transformResult: async (query) => query.result,
    });
    const guarded = new Proxy(watched, {
      get(db, name) {
        if (name === 'transaction' || name === 'startTransaction') throw new Error('a try opened a transaction');
        const value = Reflect.get(db, name) as unknown;
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(db) : value;
      },
    });
    const out = await save.writes.tryPrice({
      target: { ...target, db: guarded },
      order: async () => (await w.rows(`SELECT * FROM market_orders WHERE id = ${String(order)}`))[0]!,
      explain: true,
      locale: 'en-US',
      may: async () => undefined,
    });
    expect(money(out.order['total'])).toBe('48.06');
    expect(writes).toBe(0);
    if (dialect === 'sqlite') return;
    // Somebody is in the middle of saving this very order: the try answers all the same, and their save is not kept waiting by it.
    await w.db.transaction().execute(async (trx) => {
      await sql`SELECT id FROM market_orders WHERE id = ${order} FOR UPDATE`.execute(trx);
      await sql`UPDATE market_order_lines SET note = 'held' WHERE order_id = ${order}`.execute(trx);
      const answered = await Promise.race([tried({ row: order }), new Promise<'waited'>((resolve) => setTimeout(() => resolve('waited'), 8_000))]);
      expect(answered).not.toBe('waited');
    });
  });

  it.skipIf(!available)('a try is judged where the venue is: a weekday\'s offer by the venue\'s weekday', async () => {
    const order = await place();
    await w.insert('price_kit_offers', { name: 'Monday tenth', kind: 'percent', value: '10.00', trigger: 'auto', scope: 'order', weekdays: '1' });
    const save = saveWorld(w);
    // The table itself reads no clock: where the venue is comes from the connection.
    const target = { ...w.target('market_orders'), timezone: undefined };
    const at = new Date('2026-09-28T20:00:00.000Z');
    const ask = (service: typeof save.writes) =>
      service.tryPrice({ target, order: async () => (await w.rows(`SELECT * FROM market_orders WHERE id = ${String(order)}`))[0]!, at, locale: 'en-US', may: async () => undefined });
    // Monday evening in London; Tuesday morning in Auckland.
    const london = await ask(save.service(undefined, { timezoneOf: async () => 'Europe/London' }));
    const auckland = await ask(save.service(undefined, { timezoneOf: async () => 'Pacific/Auckland' }));
    await w.rows(`DELETE FROM price_kit_offers WHERE name = 'Monday tenth'`);
    expect(london.applied.map((entry) => entry.name)).toContain('Monday tenth');
    expect(auckland.applied.map((entry) => entry.name)).not.toContain('Monday tenth');
    expect(money(auckland.order['total'])).toBe('53.46');
  });

  it.skipIf(!available)('only somebody who reads the order with its lines and may change the offers is answered', async () => {
    const order = await place();
    expect((await tryIt({ row: order }, '')).statusCode).toBe(401);
    // Reads everything, and may not change an offer.
    const till = await tryIt({ row: order }, 'till');
    expect(till.statusCode, till.body).toBe(403);
    // May change offers, and does not read the order's lines.
    const planner = await tryIt({ row: order }, 'planner');
    expect(planner.statusCode, planner.body).toBe(403);
    expect(planner.body).not.toContain('64.50');
    // …and is not told whether a row is there before that.
    expect((await tryIt({ row: 999_999 }, 'planner')).statusCode).toBe(403);
    expect((await tried({ row: order }, 'owner')).applied.map((entry) => entry.name)).toEqual(['Tote pair']);
    // A role that reads part of an order is shown that part worked out, and nothing it does not read; nor an offer's name it may not read.
    await w.rows(`UPDATE market_orders SET note = 'call before delivery' WHERE id = ${String(order)}`);
    const narrow = await tried({ row: order, explain: true }, 'narrow');
    expect(figuresOf(narrow.data).total).toBe('53.46');
    expect(narrow.data).not.toHaveProperty('note');
    expect(JSON.stringify(narrow)).not.toContain('call before delivery');
    expect(narrow.explain!.every((entry) => entry.name === '')).toBe(true);
    expect((await tried({ row: order, explain: true }, 'owner')).explain!.some((entry) => entry.name === 'Tote pair')).toBe(true);
    expect((await tryIt({ row: 999_999 }, 'owner')).statusCode).toBe(404);
    // Codes of the caller's own choosing are tried only by somebody who reads the add-on's codes: a try says why one does not stand.
    expect((await tryIt({ row: order }, 'blind')).statusCode).toBe(200);
    const probed = await tryIt({ row: order, codes: ['LAUNCH20'] }, 'blind');
    expect(probed.statusCode, probed.body).toBe(403);
    expect(probed.body).not.toContain('used-up');
    expect((await tried({ row: order, codes: ['LAUNCH20'] }, 'owner')).refused).toEqual([{ typed: 'LAUNCH20', reason: 'used-up' }]);
    // A refusal is written down, as any refused read of a table is.
    const denied = (await auditRepo(w.h.meta).list({ limit: 200 })).filter((entry) => entry.action === 'permission.denied' && JSON.stringify(entry.changes).includes('/try'));
    expect(denied.length).toBeGreaterThanOrEqual(3);
    // A table whose rows nothing lowers the price of.
    const none = await tryIt({ row: 1 }, 'boss', 'market_items');
    expect(none.statusCode, none.body).toBe(422);
    expect((none.json() as { error: { details?: { reason?: string } } }).error.details?.reason).toBe('no-adjust');
    // A body that asks for anything else is refused whole.
    expect((await tryIt({ row: order, codes: Array.from({ length: 13 }, (_, n) => `C${String(n)}`) })).statusCode).toBe(422);
    expect((await tryIt({ row: order, buyer: 'somebody' })).statusCode).toBe(422);
    expect((await tryIt({ row: order, lines: [] })).statusCode).toBe(422);
  });

  it.skipIf(!available)('an add-on that cannot answer is said to be so, and never a price worked out by nobody', async () => {
    const order = await place();
    await w.rows(`UPDATE price_kit_settings SET misbehave = 'throw'`);
    const failed = await tryIt({ row: order });
    await w.rows(`UPDATE price_kit_settings SET misbehave = NULL`);
    expect(failed.statusCode, failed.body).toBe(409);
    expect((failed.json() as { error: { code: string; details?: { reason?: string } } }).error).toMatchObject({ code: 'POSTING_REFUSED', details: { reason: 'planner-failed' } });
    expect(failed.body).not.toContain('told to throw');
    // An answer that is wrong is no answer either.
    await w.rows(`UPDATE price_kit_settings SET misbehave = 'wrong-sum'`);
    const wrong = await tryIt({ row: order });
    await w.rows(`UPDATE price_kit_settings SET misbehave = NULL`);
    expect((wrong.json() as { error: { details?: { reason?: string } } }).error.details?.reason).toBe('planner-failed');
    // Its code is not loaded: nobody can be asked.
    const save = saveWorld(w);
    const ask = (service = save.writes) =>
      service.tryPrice({ target: w.target('market_orders'), order: async () => (await w.rows(`SELECT * FROM market_orders WHERE id = ${String(order)}`))[0]!, locale: 'en-US', may: async () => undefined });
    await expect(ask(save.service(w.runtimeWith({ adjustDecider: () => null })))).rejects.toMatchObject({ code: 'POSTING_REFUSED', details: { reason: 'add-on-unavailable' } });
    await expect(ask(save.service(null))).rejects.toMatchObject({ code: 'POSTING_REFUSED', details: { reason: 'add-on-unavailable' } });
    // Changed under the try (an update half way): try again, never an answer from half of two versions.
    await w.h.meta.db.updateTable('adminium_manifests').set({ status: 'updating' } as never).where('manifestKey', '=', PRICE_KIT).execute();
    const moved = await ask().catch((error: unknown) => error);
    await w.h.meta.db.updateTable('adminium_manifests').set({ status: 'installed' } as never).where('manifestKey', '=', PRICE_KIT).execute();
    expect(moved).toMatchObject({ statusCode: 409 });
    expect(await ask()).toMatchObject({ refused: [] });
  });

  it.skipIf(!available || dialect !== 'sqlite')('the 61st try in a minute is refused, per person', async () => {
    const order = await place();
    for (let n = 0; n < 60; n += 1) expect((await tryIt({ row: order }, 'eager')).statusCode, String(n)).toBe(200);
    const over = await tryIt({ row: order }, 'eager');
    expect(over.statusCode, over.body).toBe(429);
    expect((over.json() as { error: { details?: { bucket?: string } } }).error.details?.bucket).toBe('price-try');
    expect((await tryIt({ row: order }, 'owner')).statusCode).toBe(200);
  });
});

describe('a try of an order whose lines keep a net of their own', () => {
  it('each line\'s net follows its reduction, and the order\'s total over them with it', async () => {
    const w = await priceWorld('sqlite', { market: marketManifest({}, WIDE_ADJUST, { wide: true }) });
    try {
      await seedOffers(w, { timeless: true });
      const id = await w.insert('market_orders', { status: 'open', subtotal: '64.50', lines_net: '64.50', net: '64.50' });
      for (const [item, qty] of BASKET) await w.insert('market_order_lines', { order_id: id, ...lineOf(w, item, qty), net: lineOf(w, item, qty)['amount'] });
      const out = await saveWorld(w).writes.tryPrice({ target: w.target('market_orders'), order: async () => (await w.rows(`SELECT * FROM market_orders WHERE id = ${String(id)}`))[0]!, locale: 'en-US', may: async () => undefined });
      // The pair of totes: 15.00 off the totes' line, and off what the lines come to.
      expect(out.lines.map((line) => line.discount)).toEqual(['0.00', '15.00', '0.00']);
      expect(money(out.order['lines_net'])).toBe('49.50');
      expect(money(out.order['net'])).toBe('49.50');
      // Nothing of it was stored.
      expect(money((await w.rows(`SELECT lines_net FROM market_orders WHERE id = ${String(id)}`))[0]!['lines_net'])).toBe('64.50');
    } finally {
      await w.close();
    }
  }, 240_000);
});

describe('an order worked out in memory', () => {
  const rollup = (over: Doc): never => ({ parent: 'orders', parentKey: 'id', child: 'lines', via: 'order_id', scale: 2, balances: [], formulas: [], derived: [], capped: false, siblings: [], climbs: [], ...over }) as never;
  const formula = (column: string, expr: unknown, reads: string[]): never => ({ column, expr, scale: 2, reads }) as never;
  const lineRules = { fills: [], checks: [], formulas: [formula('net', { sub: ['amount', 'discount'] }, ['amount', 'discount'])] } as never;
  const orderRules = {
    fills: [],
    checks: [],
    ownRollups: [
      rollup({ column: 'subtotal', sum: 'amount' }),
      rollup({ column: 'lines_net', sum: 'net' }),
      rollup({ column: 'kept', sum: '', count: true, unlessSet: 'voided_at' }),
      rollup({ column: 'extras', sum: 'amount', where: { column: 'kind', eq: 'extra' } }),
      rollup({ column: 'paid', child: 'payments', sum: 'amount' }),
    ],
    formulas: [
      formula('net', { sub: ['subtotal', 'discount'] }, ['subtotal', 'discount']),
      formula('tax', { round: [{ div: [{ mul: ['net', 'tax_rate'] }, 100] }, 2] }, ['net', 'tax_rate']),
      formula('total', { add: ['net', 'tax'] }, ['net', 'tax']),
      formula('goods', { add: ['lines_net', 0] }, ['lines_net']),
      formula('label', { add: ['tax_rate', 0] }, ['tax_rate']),
    ],
    balances: [{ column: 'due', of: 'total', minus: [], total: 'paid', scale: 2, cappedBy: [] }],
  } as never;
  const order = { id: 1, subtotal: '49.50', lines_net: '49.50', kept: 3, extras: '0.00', goods: '49.50', discount: '0.00', net: '49.50', tax_rate: '8.00', tax: '3.96', total: '53.46', paid: '20.00', due: '33.46', label: 'as stored' };
  const line = (id: number, amount: string, over: Doc = {}) => ({ table: 'lines', rules: lineRules, row: { id, order_id: 1, kind: 'item', amount, discount: '0.00', net: amount, voided_at: null, ...over } });

  it('each line\'s formulas, the order\'s totals over them, its formulas and its balances — and nothing else', () => {
    const out = orderFigures({
      order,
      orderRules,
      rows: [{ ...line(1, '28.00'), overlay: { discount: '2.80' } }, { ...line(2, '15.00'), overlay: { discount: '1.50' } }, { ...line(3, '6.50', { kind: 'extra' }), overlay: { discount: '0.65' } }, line(4, '9.00', { voided_at: '2026-09-30' })],
      overlay: { discount: '4.95' },
      currency: 'USD',
    });
    expect(out.rows.map((row) => row['net'])).toEqual(['25.20', '13.50', '5.85', '9.00']);
    // The totals are added up from the rows handed in — the voided one counted where a total says nothing of it, left out where it does.
    expect(out.order).toMatchObject({ subtotal: '58.50', lines_net: '53.55', kept: '3', discount: '4.95', net: '53.55', tax: '4.28', total: '57.83' });
    // A total kept for some rows only adds up those; a formula that reads a total follows it, whatever else was put in.
    expect(out.order).toMatchObject({ extras: '6.50', goods: '53.55' });
    // What was paid is not part of the question: a total over rows nobody handed in stays, and the balance is taken from it.
    expect(out.order).toMatchObject({ paid: '20.00', due: '37.83' });
    // A figure nothing reaches stays as it is stored.
    expect(out.order['label']).toBe('as stored');
    // Nothing handed in was changed.
    expect(order.discount).toBe('0.00');
    // Rows read through another link than a total adds up by are not that total's rows: it stays as stored.
    const other = orderFigures({ order, orderRules, rows: [{ ...line(1, '28.00'), via: 'moved_from_id' }], currency: 'USD' });
    expect(other.order).toMatchObject({ subtotal: '49.50', total: '53.46' });
    expect(orderFigures({ order, orderRules, rows: [{ ...line(1, '28.00'), via: 'order_id' }], currency: 'USD' }).order['subtotal']).toBe('28.00');
  });

  it('a tax on the order\'s net is rounded once, on the order', () => {
    // 3.564 on the order — never the lines' taxes added up.
    const out = orderFigures({ order: { ...order, subtotal: '49.50' }, orderRules: { ...(orderRules as object), ownRollups: [] } as never, rows: [], overlay: { discount: '4.95' }, currency: 'USD' });
    expect(out.order).toMatchObject({ net: '44.55', tax: '3.56', total: '48.11' });
  });
});

