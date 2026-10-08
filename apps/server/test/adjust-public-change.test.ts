// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A SIGNED-IN GUEST, THROUGH THE REAL DOORS. Somebody who signed in by the
 * link sent to their address is a customer whose identity is proved: an offer
 * kept for one use a customer applies to their order, where a stranger typing
 * the same code is asked to sign in. And a guest who changes a booking of
 * their own — a night more — is quoted, and then charged, the price as it
 * moves, with what was taken off said in the reply.
 */
import { publicKeysRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { priceWorld, seedOffers, type PriceWorld } from './adjust.helpers.js';
import { CATEGORY, MARKET, PRICES, PRICE_KIT, marketManifest, type Item } from './fixtures/price-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';
import { guest, mailReady } from './person-fixture.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Doc = Record<string, unknown>;
type Reply = { statusCode: number; body: string; json: () => Doc };
const pk = { ref: 'id', type: 'int', role: 'pk' };
const money = (ref: string, extra: Doc = {}): Doc => ({ ref, type: 'money', scale: 2, ...extra });
const link = (table: string): Doc => ({ addOnLink: { addOn: PRICE_KIT, table } });
const fixed = (value: unknown): string => Number(value).toFixed(2);

/** The shop with rooms let by the night, a customer who signs in by a link, and what they may reach of their own. */
function inn(): Doc {
  const base = marketManifest({ frontends: [{ side: 'staff', kind: 'none' }, { side: 'customer', kind: 'none' }] }) as { requiredSchema: { prefixed: boolean; tables: Doc[] } };
  return {
    ...base,
    requiredSchema: {
      ...base.requiredSchema,
      tables: [
        ...base.requiredSchema.tables,
        { ref: 'room_types', columns: [pk, { ref: 'name', type: 'text', maxLength: 60 }, money('base_rate', { default: 0 })] },
        {
          ref: 'stays',
          adjust: {
            by: { addOn: PRICE_KIT },
            lines: [{ self: true, price: 'room_total', discount: 'room_discount', nights: { from: 'arrive', to: 'depart', rate: 'room_total' }, what: [{ column: 'room_type_id', as: 'item' }] }],
            order: { discount: 'discount', customer: { link: 'customer_id', address: 'email', proved: 'customer_proved' } },
            codes: { table: 'stay_codes', via: 'stay_id', typed: 'typed', code: 'code_id', voucher: 'voucher_id' },
            expect: 'total',
          },
          columns: [
            pk,
            { ref: 'customer_id', type: 'fk', references: 'customers', nullable: true },
            { ref: 'customer_proved', type: 'bool', nullable: true },
            { ref: 'room_type_id', type: 'fk', references: 'room_types' },
            { ref: 'arrive', type: 'date' },
            { ref: 'depart', type: 'date' },
            money('room_total', { nullable: true, rules: { perNight: { from: 'arrive', to: 'depart', rate: { via: 'room_type_id', column: 'base_rate' } } } }),
            money('room_discount', { default: 0 }),
            money('discount', { default: 0 }),
            money('total', { nullable: true, rules: { formula: { sub: ['room_total', 'discount'] } } }),
          ],
        },
        { ref: 'stay_codes', columns: [pk, { ref: 'stay_id', type: 'fk', references: 'stays' }, { ref: 'typed', type: 'text', maxLength: 40, nullable: true }, { ref: 'code_id', type: 'int', nullable: true, rules: link('codes') }, { ref: 'voucher_id', type: 'int', nullable: true, rules: link('vouchers') }] },
      ],
    },
    publicAccess: [
      { table: 'customers', methods: ['GET'], select: ['name', 'email'], claim: { verify: 'email-link', email: 'email' }, humanCheck: true },
      {
        table: 'orders',
        methods: ['POST'],
        humanCheck: true,
        level: 'verified',
        select: ['id', 'subtotal', 'discount', 'total'],
        writable: ['note'],
        claimedBy: { table: 'customers', column: 'customer_id' },
        children: {
          order_lines: { via: 'order_id', writable: ['item_id', 'category_id', 'unit_price', 'qty'], select: ['id', 'amount', 'discount'], min: 1, max: 20 },
          order_codes: { via: 'order_id', writable: ['typed'], select: ['typed'], max: 4 },
        },
        dryRun: true,
        expect: 'total',
      },
      { table: 'stays', methods: ['GET', 'PATCH'], level: 'verified', claimedBy: { table: 'customers', column: 'customer_id' }, select: ['id', 'arrive', 'depart', 'room_total', 'discount', 'total'], writable: ['depart'], dryRun: true, expect: 'total' },
      { table: 'items', methods: ['GET'], select: ['id', 'name', 'price'] },
      { table: 'categories', methods: ['GET'], select: ['id', 'name'] },
    ],
  };
}

describe.each(LEGS)('a signed-in guest, through the real doors — %s', (dialect, available) => {
  let w: PriceWorld;
  let served: Served;
  let g: ReturnType<typeof guest>;
  let ada = '';
  let adaId = 0;
  let double = 0;
  const trusted = process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
  const line = (item: Item, qty: number): Doc => ({ values: { item_id: w.items[item], category_id: w.categories[CATEGORY[item]], unit_price: PRICES[item], qty } });
  const basket = (codes: readonly string[]): Doc => ({ values: {}, children: { order_lines: [line('Mug, speckled', 2), line('Canvas tote, natural', 2), line('Notebook, A5', 1)], order_codes: codes.map((typed) => ({ values: { typed } })) } });
  const error = (res: Reply) => res.json()['error'] as { code: string; params?: Doc };

  beforeAll(async () => {
    if (!available) return;
    w = await priceWorld(dialect, { market: inn() });
    await seedOffers(w, { timeless: true });
    await mailReady(w.h.meta);
    adaId = await w.insert('market_customers', { name: 'Ada', email: 'ada@example.com' });
    double = await w.insert('market_room_types', { name: 'Double', base_rate: '185.00' });
    const ten = await w.insert('price_kit_offers', { name: 'Stay ten', kind: 'percent', value: '10.00', trigger: 'code', scope: 'order' });
    await w.insert('price_kit_codes', { code: 'STAY10', offer_id: ten });
    const [key] = (await publicKeysRepo(w.h.meta).listManagedBy(MARKET)).filter((one) => one.revokedAt === null);
    process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = PRICE_KIT;
    served = await servePublic(w.h as never, key!.id, { ADMINIUM_DATA_DIR: w.h.dataDir });
    g = guest(served, w.h as never);
    ada = await g.signIn('ada@example.com');
    // The server loads the add-on's deciding code after it is up.
    let first = '';
    for (let tries = 0; ; tries += 1) {
      const quoted = (await g.request('POST', '/records/market_orders_verified/dry-run', { payload: basket([]), session: ada })) as Reply;
      if (quoted.statusCode === 200) break;
      first ||= quoted.body;
      if (tries >= 20) throw new Error(`the price add-on never became ready: ${first}`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }, 240_000);
  afterAll(async () => {
    if (trusted === undefined) delete process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
    else process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = trusted;
    await served?.close();
    if (available) await w.close();
  });

  it.skipIf(!available)('a customer who signed in is proved: a code kept for one use each applies to their order, and is theirs once', async () => {
    const saved = (await g.request('POST', '/records/market_orders_verified', { payload: basket(['WELCOME10']), session: ada, proof: 'write' })) as Reply;
    expect(saved.statusCode, saved.body).toBe(201);
    const made = saved.json() as { data: Doc; applied: Doc[] };
    // The pair of totes, then ten percent of what is left: 48.11.
    expect(fixed(made.data['total'])).toBe('48.11');
    expect(made.applied).toContainEqual({ line: null, name: 'Welcome 10', kind: 'code', amount: '4.95', typed: true });
    const [stored] = await w.rows(`SELECT customer_id, customer_proved FROM market_orders WHERE id = ${String(made.data['id'])}`);
    expect(Number(stored!['customer_id'])).toBe(adaId);
    expect(stored!['customer_proved'] === true || stored!['customer_proved'] === 1).toBe(true);
  });

  it.skipIf(!available)('a guest who changes a stay of their own is quoted, and then charged, the price as it moves — with what was taken off', async () => {
    // Two nights with ten percent off, booked at the desk for Ada.
    const stay = await w.insert('market_stays', { customer_id: adaId, customer_proved: true, room_type_id: double, arrive: '2026-11-02', depart: '2026-11-04', room_total: '370.00', room_discount: '37.00', discount: '37.00', total: '333.00' });
    const code = (await w.rows(`SELECT id FROM price_kit_codes WHERE code = 'STAY10'`))[0]!['id'];
    await w.insert('market_stay_codes', { stay_id: stay, typed: 'STAY10', code_id: code });
    const change = { values: { depart: '2026-11-05' } };
    const quoted = (await g.request('POST', `/records/market_stays_verified/${String(stay)}/dry-run`, { payload: change, session: ada })) as Reply;
    expect(quoted.statusCode, quoted.body).toBe(200);
    const shown = quoted.json() as { data: Doc; applied: Doc[] };
    // Three nights: 555.00, ten percent off.
    expect([fixed(shown.data['room_total']), fixed(shown.data['discount']), fixed(shown.data['total'])]).toEqual(['555.00', '55.50', '499.50']);
    expect(shown.applied).toEqual([{ line: null, name: 'Stay ten', kind: 'code', amount: '55.50', typed: true }]);
    // Nothing was kept by the quote.
    expect(String((await w.rows(`SELECT depart FROM market_stays WHERE id = ${String(stay)}`))[0]!['depart'])).toContain('2026-11-04');
    // A price check against the price they were NOT shown: refused, with what the stay would cost and what is taken off.
    const stale = (await g.request('PATCH', `/records/market_stays_verified/${String(stay)}`, { payload: { ...change, expect: { total: '333.00' } }, session: ada })) as Reply;
    expect(stale.statusCode, stale.body).toBe(409);
    expect(error(stale)).toMatchObject({ code: 'PUBLIC_PRICE_CHANGED', params: { total: '499.50', applied: shown.applied } });
    const saved = (await g.request('PATCH', `/records/market_stays_verified/${String(stay)}`, { payload: { ...change, expect: { total: '499.50' } }, session: ada })) as Reply;
    expect(saved.statusCode, saved.body).toBe(200);
    expect((saved.json() as { applied: Doc[] }).applied).toEqual(shown.applied);
    expect(fixed((await w.rows(`SELECT total FROM market_stays WHERE id = ${String(stay)}`))[0]!['total'])).toBe('499.50');
    // Read again, the stay says the same.
    const read = (await g.request('GET', `/records/market_stays_verified/${String(stay)}`, { session: ada })) as Reply;
    expect((read.json() as { applied: Doc[] }).applied).toEqual(shown.applied);
    // Somebody else's stay is not theirs to change, or to be told the price of.
    const other = await w.insert('market_stays', { room_type_id: double, arrive: '2026-11-02', depart: '2026-11-04', room_total: '370.00', total: '370.00' });
    const theirs = (await g.request('POST', `/records/market_stays_verified/${String(other)}/dry-run`, { payload: change, session: ada })) as Reply;
    expect(theirs.statusCode).not.toBe(200);
    expect(theirs.body).not.toContain('555');
  });
});
