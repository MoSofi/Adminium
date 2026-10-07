// SPDX-License-Identifier: AGPL-3.0-only
/**
 * EVERY DOOR SAYS WHICH REDUCTIONS APPLIED — through the whole server: the
 * shop's own public key and a signed-in desk, the price add-on's real deciding
 * file loaded as a server loads it. A quote and the save after it say the
 * same; a code that does not stand is refused on the field it was typed
 * into, by the three reasons a customer may hear and no other; a miss spends
 * a guess and anything else hands it back; a save that moved a price has no
 * Undo.
 */
import { publicKeysRepo, rolesRepo, userPrefsRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPublicRateLimiter, type PublicRateLimiter } from '../src/public-api/limiter.js';
import { priceWorld, seedOffers, type PriceWorld } from './adjust.helpers.js';
import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from './auth-helpers.js';
import { CATEGORY, MARKET, PRICES, PRICE_KIT, marketManifest, type Item } from './fixtures/price-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';
import { guest } from './person-fixture.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Doc = Record<string, unknown>;
type Reply = { statusCode: number; body: string; json: () => Doc };

const publicMarket = (): Doc =>
  marketManifest({
    frontends: [
      { side: 'staff', kind: 'none' },
      { side: 'customer', kind: 'none' },
    ],
    publicAccess: [
      // What a guest's line may name is what a read of this key shows.
      { table: 'items', methods: ['GET'], select: ['id', 'name', 'price'] },
      { table: 'categories', methods: ['GET'], select: ['id', 'name'] },
      {
        table: 'orders',
        methods: ['POST'],
        select: ['id', 'subtotal', 'discount', 'net', 'tax', 'total'],
        writable: ['note'],
        children: {
          order_lines: { via: 'order_id', writable: ['item_id', 'category_id', 'unit_price', 'qty'], select: ['id', 'amount', 'discount'], min: 1, max: 20 },
          order_codes: { via: 'order_id', writable: ['typed'], select: ['typed'], max: 4 },
        },
        humanCheck: true,
        dryRun: true,
        expect: 'total',
      },
    ],
  });

describe.each(LEGS)('every door says which reductions applied — %s', (dialect, available) => {
  let w: PriceWorld;
  let served: Served;
  let cookie = '';
  let desk = '';
  const trusted = process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
  const guesses = { kept: 0, back: 0 };
  const watched = (): PublicRateLimiter => {
    const real = createPublicRateLimiter();
    return {
      ...real,
      reserveGuess(keyId, ip, codes, rung) {
        const held = real.reserveGuess(keyId, ip, codes, rung);
        if (!('ticket' in held)) return held;
        return {
          ticket: {
            keep: () => {
              guesses.kept += 1;
              held.ticket.keep();
            },
            giveBack: () => {
              guesses.back += 1;
              held.ticket.giveBack();
            },
          },
        };
      },
    };
  };
  const line = (item: Item, qty: number): Doc => ({ values: { item_id: w.items[item], category_id: w.categories[CATEGORY[item]], unit_price: PRICES[item], qty } });
  const basket = (codes: readonly string[] = [], lines: Doc[] = [line('Mug, speckled', 2), line('Canvas tote, natural', 2), line('Notebook, A5', 1)]): Doc => ({
    values: {},
    children: { order_lines: lines, ...(codes.length === 0 ? {} : { order_codes: codes.map((typed) => ({ values: { typed } })) }) },
  });
  let g: ReturnType<typeof guest>;
  const quote = (body: Doc): Promise<Reply> => g.request('POST', '/records/market_orders/dry-run', { payload: body }) as never;
  const save = (body: Doc): Promise<Reply> => g.request('POST', '/records/market_orders', { payload: body, proof: 'write' }) as never;
  const settled = async <T>(run: () => Promise<T>): Promise<{ out: T; kept: number; back: number }> => {
    const before = { ...guesses };
    const out = await run();
    return { out, kept: guesses.kept - before.kept, back: guesses.back - before.back };
  };
  const error = (res: Reply) => res.json()['error'] as { code: string; params?: Doc };
  const orders = async () => Number((await w.rows('SELECT COUNT(*) AS n FROM market_orders'))[0]!['n']);
  const staff = (method: string, url: string, payload?: Doc): Promise<Reply> =>
    served.composed.app.inject({ method: method as 'POST', url: `/api/v1/data/${w.h.connectionId}/${url}`, headers: { cookie }, ...(payload === undefined ? {} : { payload }) }) as never;
  const tableId = (name: string) => encodeURIComponent(w.table(name).id);

  // A code typed on an order may be a discount code or a voucher: a guess on both counts, each kept or handed back.
  const KEPT = [2, 0];
  const BACK = [0, 2];
  const PAIR = { line: 'order_lines/1', name: 'Tote pair', kind: 'offer', amount: '15.00', typed: false };
  const AUTUMN = { line: null, name: 'Autumn 5', kind: 'code', amount: '5.00', typed: true };

  beforeAll(async () => {
    if (!available) return;
    w = await priceWorld(dialect, { market: publicMarket() });
    await seedOffers(w, { timeless: true });
    const [key] = (await publicKeysRepo(w.h.meta).listManagedBy(MARKET)).filter((one) => one.revokedAt === null);
    process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = PRICE_KIT;
    served = await servePublic(w.h as never, key!.id, { ADMINIUM_DATA_DIR: w.h.dataDir }, { limiter: watched() });
    g = guest(served, w.h as never);
    const user = await usersRepo(w.h.meta).create({ email: 'desk@market.example', name: 'Desk', passwordHash: await adminPasswordHash(), status: 'active' });
    desk = user.id;
    await rolesRepo(w.h.meta).assignToUser(desk, (await rolesRepo(w.h.meta).findBySlug('super-admin'))!.id);
    const login = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'desk@market.example', password: ADMIN_PASSWORD } });
    cookie = sessionCookie(login.headers['set-cookie']);
  }, 240_000);
  afterAll(async () => {
    if (trusted === undefined) delete process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
    else process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = trusted;
    await served?.close();
    if (available) await w.close();
  });

  it.skipIf(!available)('a guest\'s quote and the save after it say the same figures and the same reductions', async () => {
    const before = await orders();
    const quoted = await settled(() => quote(basket(['AUTUMN5'])));
    expect(quoted.out.statusCode, quoted.out.body).toBe(200);
    const shown = quoted.out.json() as { data: Doc; applied: unknown; told?: unknown };
    expect(Number(shown.data['total'])).toBe(48.06);
    expect(shown.applied).toEqual([PAIR, AUTUMN]);
    expect(shown.told).toBeUndefined();
    expect(await orders()).toBe(before);
    // A code that worked is a guess handed back.
    expect([quoted.kept, quoted.back]).toEqual(BACK);
    const saved = await save({ ...basket(['AUTUMN5']), expect: { total: '48.06' } });
    expect(saved.statusCode, saved.body).toBe(201);
    const made = saved.json() as { data: Doc; applied: unknown };
    expect(Number(made.data['total'])).toBe(48.06);
    expect(made.applied).toEqual(shown.applied);
    expect(await orders()).toBe(before + 1);
    // Nothing of the add-on's own leaves: no id, no reason, no whole code.
    expect(JSON.stringify(made.applied)).not.toMatch(/AUTUMN5|offer_id|code_id|"offer":|"code":|reason/);
    // A guest who reads German is answered in German.
    const german = await served.composed.app.inject({ method: 'POST', url: '/api/v1/public/records/market_orders/dry-run', headers: served.headers(undefined, { 'accept-language': 'de-DE,de;q=0.9,en;q=0.5' }), payload: basket(['AUTUMN5']) });
    expect(german.statusCode, german.body).toBe(200);
    expect((german.json() as { applied: unknown }).applied).toEqual([PAIR, { ...AUTUMN, name: 'Herbst 5' }]);
  });

  it.skipIf(!available)('an order with no code says what was taken off all the same; one that takes nothing off says so', async () => {
    const pair = await quote(basket());
    expect(pair.json()['applied']).toEqual([PAIR]);
    const plain = await quote(basket([], [line('Mug, speckled', 1)]));
    expect(plain.statusCode, plain.body).toBe(200);
    expect(plain.json()['applied']).toEqual([]);
  });

  it.skipIf(!available)('a code under its minimum says the minimum on the field it was typed into, and spends no guess', async () => {
    const small = basket(['AUTUMN5'], [line('Mug, white', 1), line('Notebook, A5', 2)]);
    for (const ask of [quote, save]) {
      const under = await settled(() => ask(small));
      expect(under.out.statusCode, under.out.body).toBe(400);
      expect(error(under.out)).toMatchObject({ code: 'PUBLIC_WRITE_REFUSED', params: { child: 'order_codes', index: 0, column: 'typed', reason: 'needs-minimum', amount: '30.00' } });
      expect([under.kept, under.back]).toEqual(BACK);
    }
  });

  it.skipIf(!available)('a code that is used up, and one that never was, answer alike — not a valid code — and each spends a guess', async () => {
    const before = await orders();
    const answers: Doc[] = [];
    for (const typed of ['LAUNCH20', 'NOSUCHCODE']) {
      const missed = await settled(() => save(basket([typed])));
      expect(missed.out.statusCode, missed.out.body).toBe(400);
      answers.push(error(missed.out) as never);
      expect([missed.kept, missed.back], typed).toEqual(KEPT);
    }
    expect(answers[0]).toEqual(answers[1]);
    expect(answers[0]).toMatchObject({ code: 'PUBLIC_WRITE_REFUSED', params: { child: 'order_codes', index: 0, column: 'typed', reason: 'unknown' } });
    expect(JSON.stringify(answers)).not.toMatch(/used-up|over-limit|expired/);
    expect(await orders()).toBe(before);
  });

  it.skipIf(!available)('a code kept for one use a customer asks a guest to sign in, and spends no guess', async () => {
    const asked = await settled(() => quote(basket(['WELCOME10'])));
    expect(error(asked.out)).toMatchObject({ code: 'PUBLIC_WRITE_REFUSED', params: { column: 'typed', reason: 'needs-sign-in' } });
    expect([asked.kept, asked.back]).toEqual(BACK);
  });

  it.skipIf(!available)('the code ran out between the quote and the save: the price changed, with what the order would have, and one guess is spent', async () => {
    const before = await orders();
    // Shown 42.77 while LAUNCH20 still had a use; it has none now.
    const changed = await settled(() => save({ ...basket(['LAUNCH20']), expect: { total: '42.77' } }));
    expect(changed.out.statusCode, changed.out.body).toBe(409);
    expect(error(changed.out)).toMatchObject({ code: 'PUBLIC_PRICE_CHANGED', params: { total: '53.46', applied: [PAIR] } });
    expect([changed.kept, changed.back]).toEqual(KEPT);
    // Shown the price the order has without it: the code was worth nothing, and is refused as any code that does not stand.
    const worthless = await settled(() => save({ ...basket(['LAUNCH20']), expect: { total: '53.46' } }));
    expect(error(worthless.out)).toMatchObject({ code: 'PUBLIC_WRITE_REFUSED', params: { column: 'typed', reason: 'unknown' } });
    expect([worthless.kept, worthless.back]).toEqual(KEPT);
    // A code that never was is answered exactly as one that ran out: a price check sent on purpose tells the two apart no better than the refusal does.
    const never = await settled(() => save({ ...basket(['NOSUCHCODE']), expect: { total: '42.77' } }));
    // (But for the code itself, which the reply hands back as the caller typed it, and the keys of rows that were never kept.)
    const alike = (res: Reply, typed: string) => [res.statusCode, JSON.stringify(error(res)).split(typed).join('…').replace(/"id":\d+/g, '"id":0')];
    expect(alike(never.out, 'NOSUCHCODE')).toEqual(alike(changed.out, 'LAUNCH20'));
    expect([never.kept, never.back]).toEqual(KEPT);
    const neverWorth = await settled(() => save({ ...basket(['NOSUCHCODE']), expect: { total: '53.46' } }));
    expect(alike(neverWorth.out, 'NOSUCHCODE')).toEqual(alike(worthless.out, 'LAUNCH20'));
    expect([neverWorth.kept, neverWorth.back]).toEqual(KEPT);
    // A price that changed with no code held back is nobody's guess.
    const plain = await settled(() => save({ ...basket(['AUTUMN5']), expect: { total: '1.00' } }));
    expect(error(plain.out)).toMatchObject({ code: 'PUBLIC_PRICE_CHANGED', params: { total: '48.06', applied: [PAIR, AUTUMN] } });
    expect([plain.kept, plain.back]).toEqual(BACK);
    expect(await orders()).toBe(before);
  });

  it.skipIf(!available)('the desk\'s saves say what the order has, whichever row was written — and a save that moved a price has no Undo', async () => {
    const made = await staff('POST', tableId('market_orders'), { values: { note: 'desk' } });
    expect(made.statusCode, made.body).toBe(201);
    const order = (made.json()['data'] as Doc)['id'];
    // An order with nothing on it asked its price, and nothing came off.
    expect(made.json()).toMatchObject({ applied: [], undoToken: null });
    const lines: unknown[] = [];
    for (const [item, qty] of [['Mug, speckled', 2], ['Canvas tote, natural', 2], ['Notebook, A5', 1]] as const) {
      const added = await staff('POST', tableId('market_order_lines'), { values: { order_id: order, ...(line(item, qty)['values'] as Doc) } });
      expect(added.statusCode, added.body).toBe(201);
      expect(added.json()['undoToken']).toBeNull();
      lines.push((added.json()['data'] as Doc)['id']);
      if (item === 'Canvas tote, natural') expect(added.json()['applied']).toEqual([{ ...PAIR, line: `market_order_lines:${String(lines[1])}` }]);
    }
    const typed = await staff('POST', tableId('market_order_codes'), { values: { order_id: order, typed: 'AUTUMN5' } });
    expect(typed.statusCode, typed.body).toBe(201);
    expect(typed.json()).toMatchObject({ undoToken: null, applied: [{ name: 'Tote pair', amount: '15.00' }, { line: null, name: 'Autumn 5', kind: 'code', amount: '5.00', typed: true }] });
    // A change of what the price reads, and a line taken away.
    const more = await staff('PATCH', `${tableId('market_order_lines')}/${String(lines[0])}`, { values: { qty: 3 } });
    expect(more.statusCode, more.body).toBe(200);
    expect(more.json()).toMatchObject({ undoToken: null, applied: [{ name: 'Tote pair' }, { name: 'Autumn 5', amount: '5.00' }] });
    const gone = await staff('DELETE', `${tableId('market_order_lines')}/${String(lines[2])}`);
    expect(gone.statusCode, gone.body).toBe(200);
    expect(gone.json()).toMatchObject({ undoToken: null, applied: [{ name: 'Tote pair' }, { name: 'Autumn 5' }] });
    // A change the price does not read is undone as ever, and says nothing of a price.
    const note = await staff('PATCH', `${tableId('market_order_lines')}/${String(lines[0])}`, { values: { note: 'no handle' } });
    expect(note.statusCode, note.body).toBe(200);
    expect(typeof note.json()['undoToken'], note.body).toBe('string');
    expect(note.json()).not.toHaveProperty('applied');
    // The desk hears a refused code by its reason.
    const used = await staff('POST', tableId('market_order_codes'), { values: { order_id: order, typed: 'LAUNCH20' } });
    expect(used.statusCode, used.body).toBe(409);
    expect(used.json()['error']).toMatchObject({ code: 'ADJUST_REFUSED', details: { column: 'typed', reason: 'used-up' } });
  });

  it.skipIf(!available)('of two codes typed the better one applies, and the other is told so beside its own field — in the reader\'s language', async () => {
    const customer = await staff('POST', tableId('market_customers'), { values: { name: 'Ada', email: 'ada@example.com' } });
    expect(customer.statusCode, customer.body).toBe(201);
    // Two codes that do not combine with one another: each is tried beside the offers that do.
    await w.rows(`UPDATE price_kit_offers SET combinable = ${w.flag(false)} WHERE name IN ('Welcome 10', 'Autumn 5')`);
    // The desk names a list by the relation its rows hang by.
    const listOf = (child: string): string => w.view().model.relations.find((r) => r.through === null && r.from.tableId === w.table(child).id && r.to.tableId === w.table('market_orders').id)!.id;
    const [linesList, codesList] = [listOf('market_order_lines'), listOf('market_order_codes')];
    const body = {
      values: { customer_id: (customer.json()['data'] as Doc)['id'] },
      children: { [linesList]: (basket()['children'] as Doc)['order_lines'], [codesList]: [{ values: { typed: 'WELCOME10' } }, { values: { typed: 'AUTUMN5' } }] },
    };
    const quoted = await staff('POST', `${tableId('market_orders')}/dry-run`, body);
    expect(quoted.statusCode, quoted.body).toBe(200);
    // Five dollars is more than a tenth of 49.50: the customer's own code was not needed.
    expect(quoted.json()).toMatchObject({
      applied: [{ line: `${linesList}/1`, name: 'Tote pair' }, { line: null, name: 'Autumn 5', kind: 'code', amount: '5.00', typed: true }],
      told: [{ column: `${codesList}/0/typed`, note: 'better-offer-applied', name: 'Autumn 5' }],
    });
    const saved = await staff('POST', tableId('market_orders'), body);
    expect(saved.statusCode, saved.body).toBe(201);
    expect(saved.json()).toMatchObject({ applied: quoted.json()['applied'], told: quoted.json()['told'], undoToken: null });
    // The customer's own code alone, by a desk that reads the dashboard in German — whatever language its browser asks for.
    await userPrefsRepo(w.h.meta).set(desk, { locale: 'de_DE' });
    try {
      const alone = await served.composed.app.inject({
        method: 'POST',
        url: `/api/v1/data/${w.h.connectionId}/${tableId('market_orders')}/dry-run`,
        headers: { cookie, 'accept-language': 'fr-FR' },
        payload: { ...body, children: { ...body.children, [codesList]: [{ values: { typed: 'WELCOME10' } }] } },
      });
      expect(alone.statusCode, alone.body).toBe(200);
      expect((alone.json() as Doc)['applied']).toMatchObject([{ name: 'Tote pair' }, { name: 'Willkommen 10', kind: 'code', amount: '4.95' }]);
    } finally {
      await userPrefsRepo(w.h.meta).set(desk, { locale: 'en_US' });
    }
  });

  it.skipIf(!available)('the desk\'s price check compares the figure the price rule names, and says what the order would have', async () => {
    const made = await staff('POST', tableId('market_orders'), { values: { note: 'checked' } });
    expect(made.statusCode, made.body).toBe(201);
    const order = (made.json()['data'] as Doc)['id'];
    for (const [item, qty] of [['Mug, speckled', 2], ['Canvas tote, natural', 2]] as const) await staff('POST', tableId('market_order_lines'), { values: { order_id: order, ...(line(item, qty)['values'] as Doc) } });
    // 58.00 of goods, the pair off: 43.00 and its tax. A reduction by hand of 10 %, checked against a figure it does not come to.
    const off = await staff('PATCH', `${tableId('market_orders')}/${String(order)}`, { values: { staff_kind: 'percent', staff_value: '10' }, expect: { total: '1.00' } });
    expect(off.statusCode, off.body).toBe(409);
    expect(off.json()['error']).toMatchObject({ code: 'PRICE_CHANGED', details: { column: 'total', total: '41.80', applied: [{ name: 'Tote pair', amount: '15.00' }, { kind: 'staff', amount: '4.30' }] } });
    const kept = await staff('PATCH', `${tableId('market_orders')}/${String(order)}`, { values: { staff_kind: 'percent', staff_value: '10' }, expect: { total: '41.80' } });
    expect(kept.statusCode, kept.body).toBe(200);
    expect(kept.json()).toMatchObject({ applied: [{ name: 'Tote pair' }, { kind: 'staff', amount: '4.30' }], undoToken: null });
  });
});
