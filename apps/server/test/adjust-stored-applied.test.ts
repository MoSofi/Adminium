// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A STORED ORDER SAYS WHICH REDUCTIONS IT TOOK — through the whole server. A
 * guest who opens their order again is told what its save told them, from the
 * rows kept for it: the same names in their language, the same amounts, the
 * last four of a voucher — and nothing a save does not tell. A create sent
 * twice answers as the first did. A list tells none; a table no price rule
 * reads tells none.
 */
import { publicKeysRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { storedReductions } from '../src/crud/adjust/stored.js';
import { priceWorld, seedOffers, type PriceWorld } from './adjust.helpers.js';
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
      { table: 'items', methods: ['GET'], select: ['id', 'name', 'price'] },
      { table: 'categories', methods: ['GET'], select: ['id', 'name'] },
      {
        table: 'orders',
        methods: ['POST'],
        select: ['id', 'subtotal', 'discount', 'net', 'tax', 'total'],
        writable: ['note', 'client_key'],
        children: {
          order_lines: { via: 'order_id', writable: ['item_id', 'category_id', 'unit_price', 'qty'], select: ['id', 'amount', 'discount'], min: 1, max: 20 },
          order_codes: { via: 'order_id', writable: ['typed'], select: ['typed'], max: 4 },
        },
        humanCheck: true,
        dryRun: true,
        expect: 'total',
        clientKey: 'client_key',
      },
      // An order is read again by whoever proves they know its number and its own code, and by nobody else.
      { table: 'orders', methods: ['GET'], claim: { match: ['id', 'link_code'] }, select: ['id', 'subtotal', 'discount', 'net', 'tax', 'total'] },
    ],
  });

describe.each(LEGS)('a stored order says which reductions it took — %s', (dialect, available) => {
  let w: PriceWorld;
  let served: Served;
  let g: ReturnType<typeof guest>;
  const trusted = process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
  const line = (item: Item, qty: number): Doc => ({ values: { item_id: w.items[item], category_id: w.categories[CATEGORY[item]], unit_price: PRICES[item], qty } });
  const basket = (codes: readonly string[], values: Doc = {}): Doc => ({
    values,
    children: { order_lines: [line('Mug, speckled', 2), line('Canvas tote, natural', 2), line('Notebook, A5', 1)], ...(codes.length === 0 ? {} : { order_codes: codes.map((typed) => ({ values: { typed } })) }) },
  });
  const save = (body: Doc): Promise<Reply> => g.request('POST', '/records/market_orders', { payload: body, proof: 'write' }) as never;
  /** The session of a guest who proved an order is theirs: its number and its own code (looked up here, as their link would carry it). */
  const sessions = new Map<string, string>();
  const claimed = async (id: string): Promise<string> => {
    const known = sessions.get(id);
    if (known !== undefined) return known;
    const code = String((await w.rows(`SELECT link_code FROM market_orders WHERE id = ${id}`))[0]!['link_code']);
    const res = await served.composed.app.inject({ method: 'POST', url: '/api/v1/public/claim', headers: served.headers(), payload: { match: { id: Number(id), link_code: code } } });
    expect(res.statusCode, res.body).toBe(200);
    const session = (res.json() as { data: { session: string } }).data.session;
    sessions.set(id, session);
    return session;
  };
  /** A read; of an order, as the guest whose order `as` is (the order read itself, when not said). */
  const read = async (path: string, language?: string, as?: string | null): Promise<Reply> => {
    const [table, id] = path.split('/');
    const owner = as !== undefined ? as : table === 'market_orders' && id !== undefined && /^\d+$/.test(id) && Number(id) < 900000 ? id : null;
    const session = owner === null ? undefined : await claimed(owner);
    // (The entry a guest reads their own order through has a name of its own.)
    return served.composed.app.inject({ method: 'GET', url: `/api/v1/public/records/${path.replace(/^market_orders/, 'market_orders_claimed')}`, headers: served.headers(session, language === undefined ? {} : { 'accept-language': language }) }) as never;
  };

  beforeAll(async () => {
    if (!available) return;
    w = await priceWorld(dialect, { market: publicMarket() });
    await seedOffers(w, { timeless: true });
    const [key] = (await publicKeysRepo(w.h.meta).listManagedBy(MARKET)).filter((one) => one.revokedAt === null);
    process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = PRICE_KIT;
    served = await servePublic(w.h as never, key!.id, { ADMINIUM_DATA_DIR: w.h.dataDir });
    g = guest(served, w.h as never);
    // The server loads the add-on's deciding code after it is up: a price asked at once would find nobody to ask.
    const deadline = Date.now() + 30_000;
    for (;;) {
      const quoted = (await g.request('POST', '/records/market_orders/dry-run', { payload: basket([]) })) as Reply;
      if (quoted.statusCode === 200) break;
      if (Date.now() > deadline) throw new Error(`the price add-on never became ready: ${quoted.body}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }, 240_000);
  afterAll(async () => {
    if (trusted === undefined) delete process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
    else process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = trusted;
    await served?.close();
    if (available) await w.close();
  });

  it.skipIf(!available)('a guest reads the reductions of the order they may read: what the save said, in their language, and nothing more', async () => {
    const saved = await save(basket(['AUTUMN5']));
    expect(saved.statusCode, saved.body).toBe(201);
    const made = saved.json() as { data: Doc; applied: Doc[] };
    const id = String(made.data['id']);
    const got = await read(`market_orders/${id}`);
    expect(got.statusCode, got.body).toBe(200);
    const stored = got.json() as { data: Doc; applied: Doc[] };
    expect(Number(stored.data['total'])).toBe(48.06);
    // What the save said — but a line is not named by a table or a key: a read was sent no lines to name it by.
    expect(stored.applied).toEqual(made.applied.map((entry) => ({ ...entry, line: null })));
    expect(stored.applied).toEqual([
      { line: null, name: 'Tote pair', kind: 'offer', amount: '15.00', typed: false },
      { line: null, name: 'Autumn 5', kind: 'code', amount: '5.00', typed: true },
    ]);
    // Nothing of the add-on's own leaves: no id, no reason, no whole code.
    expect(JSON.stringify(stored)).not.toMatch(/AUTUMN5|offer_id|code_id|"offer":|"code":|reason|source_/);
    // In German, the name it was kept under for German.
    expect(((await read(`market_orders/${id}`, 'de-DE,de;q=0.9')).json() as { applied: Doc[] }).applied.map((entry) => entry['name'])).toEqual(['Tote pair', 'Herbst 5']);
    // Later the offer is renamed and the code switched off: the order still says what it took, under the name it had.
    await w.rows(`UPDATE price_kit_offers SET name = 'Renamed', public_name = NULL WHERE name = 'Autumn 5'`);
    await w.rows(`UPDATE price_kit_codes SET active = ${w.flag(false)} WHERE code = 'AUTUMN5'`);
    expect(((await read(`market_orders/${id}`)).json() as { applied: Doc[] }).applied).toEqual(stored.applied);
    await w.rows(`UPDATE price_kit_offers SET name = 'Autumn 5' WHERE name = 'Renamed'`);
    await w.rows(`UPDATE price_kit_codes SET active = ${w.flag(true)} WHERE code = 'AUTUMN5'`);

    // Nobody else's: without the order's own code, or with another order's, there is no such record — and nothing of its reductions.
    const other = await save(basket([]));
    for (const wrong of [null, String((other.json() as { data: Doc }).data['id'])]) {
      const shut = await read(`market_orders/${id}`, undefined, wrong);
      expect(shut.statusCode, shut.body).not.toBe(200);
      expect(shut.body).not.toContain('Autumn 5');
    }
    // A table no price rule reads tells none; an order that took nothing says so.
    expect((await read(`market_items/${String(w.items['Notebook, A5'])}`)).json()).not.toHaveProperty('applied');
    const plain = await save({ values: {}, children: { order_lines: [line('Notebook, A5', 1)] } });
    expect(((await read(`market_orders/${String((plain.json() as { data: Doc }).data['id'])}`)).json() as Doc)['applied']).toEqual([]);
    expect((await read('market_orders/999999', undefined, id)).statusCode).toBe(404);
  });

  it.skipIf(!available)('a voucher is told by the last four of what was typed, and what staff took off by hand by no name', async () => {
    await w.insert('price_kit_vouchers', { code: '9QXA41TR7K2M', worth: 'amount', value: '4.00', public_name: 'Thank you' });
    const saved = await save(basket(['vc-9qxa-41tr-7k2m']));
    expect(saved.statusCode, saved.body).toBe(201);
    const id = (saved.json() as { data: Doc }).data['id'];
    // The desk takes two more off by hand afterwards.
    await w.rows(`UPDATE market_orders SET staff_kind = 'amount', staff_value = 2, staff_reason = 'regular customer', staff_by = 'usr_ivy' WHERE id = ${String(id)}`);
    await w.insert('price_kit_applied', { source_table: 'market:orders', source_row: String(id), source_line: 'p0:0', name: JSON.stringify('Staff · regular customer'), kind: 'staff', amount: '2.00', reason: 'regular customer', typed: false, applied_at: '2026-09-30 10:00:00' });
    const stored = ((await read(`market_orders/${String(id)}`)).json() as { applied: Doc[] }).applied;
    expect(stored).toContainEqual({ line: null, name: 'Voucher · Thank you', kind: 'voucher', amount: '4.00', typed: true, codeLast4: '7K2M' });
    expect(stored).toContainEqual({ line: null, name: '', kind: 'staff', amount: '2.00', typed: false });
    expect(JSON.stringify(stored)).not.toMatch(/9QXA41TR|regular customer/);
  });

  it.skipIf(!available)('a create sent twice answers as the first did, its reductions and their places included', async () => {
    const body = basket(['AUTUMN5'], { client_key: 'k3Y-0123456789abcdefghijklmn' });
    const first = await save(body);
    expect(first.statusCode, first.body).toBe(201);
    const again = await save(body);
    expect(again.statusCode, again.body).toBe(200);
    const made = first.json() as Doc;
    expect(again.json()).toEqual({ ...made, replayed: true });
    expect((made['applied'] as Doc[]).map((entry) => entry['line'])).toEqual(['order_lines/1', null]);
  });

  it.skipIf(!available)('with the price rule switched off, a read tells nothing of reductions', async () => {
    const saved = await save(basket([]));
    const id = (saved.json() as { data: Doc }).data['id'];
    const { overridesRepo } = await import('@adminium/meta');
    const off = await overridesRepo(w.h.meta).create({ connectionId: w.h.connectionId, op: 'table.switchedOff', tableName: w.table('market_orders').id, columnName: null, value: { postings: [], adjust: true }, origin: 'user' } as never);
    const quiet = (await read(`market_orders/${String(id)}`)).json() as Doc;
    await overridesRepo(w.h.meta).delete(off.id);
    expect(quiet).not.toHaveProperty('applied');
    expect(quiet['data']).toMatchObject({ id });
  });
});

describe('an entry that shows anybody an order, or shows nothing of its price', () => {
  it('tells nothing of the order\'s reductions: only an entry a person proves an order is theirs by, and that shows its reduction, does', async () => {
    const trusted = process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
    // A pick-up board: anybody with the key reads an order's status. And a claimed entry that shows the status alone.
    const w = await priceWorld('sqlite', {
      market: marketManifest({
        frontends: [{ side: 'staff', kind: 'none' }, { side: 'customer', kind: 'none' }],
        publicAccess: [
          { table: 'orders', methods: ['GET'], select: ['id', 'status'] },
          { table: 'orders', methods: ['GET'], claim: { match: ['id', 'link_code'] }, select: ['id', 'status'] },
        ],
      }),
    });
    process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = PRICE_KIT;
    const [key] = (await publicKeysRepo(w.h.meta).listManagedBy(MARKET)).filter((one) => one.revokedAt === null);
    const served = await servePublic(w.h as never, key!.id, { ADMINIUM_DATA_DIR: w.h.dataDir });
    try {
      const id = await w.insert('market_orders', { status: 'placed', link_code: 'ABCDEFGH2345', discount: '15.00' });
      await w.insert('price_kit_offers', { name: 'Members ten', kind: 'percent', value: '10.00', trigger: 'auto', scope: 'order' });
      await w.insert('price_kit_applied', { source_table: 'market:orders', source_row: String(id), source_line: 'p0:1', offer_id: 1, name: JSON.stringify('Members ten'), kind: 'offer', amount: '15.00', typed: false, applied_at: '2026-09-30 10:00:00' });
      const refs = Object.keys(((await served.composed.app.inject({ method: 'GET', url: '/api/v1/public/config', headers: served.headers() })).json() as { data: { refs: Doc } }).data.refs);
      const claim = await served.composed.app.inject({ method: 'POST', url: '/api/v1/public/claim', headers: served.headers(), payload: { match: { id, link_code: 'ABCDEFGH2345' } } });
      const session = (claim.json() as { data: { session: string } }).data.session;
      let read = 0;
      for (const ref of refs) {
        const got = await served.composed.app.inject({ method: 'GET', url: `/api/v1/public/records/${ref}/${String(id)}`, headers: served.headers(session) });
        if (got.statusCode !== 200) continue;
        read += 1;
        expect(got.json()).not.toHaveProperty('applied');
        expect(got.body).not.toContain('Members ten');
      }
      expect(read).toBe(2);
    } finally {
      if (trusted === undefined) delete process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
      else process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = trusted;
      await served.close();
      await w.close();
    }
  }, 240_000);
});

describe('rows of what was applied, told again', () => {
  const columns = { line: 'source_line', offer: 'offer_id', code: 'code_id', voucher: 'voucher_id', name: 'name', kind: 'kind', amount: 'amount', typed: 'typed' };
  const row = (over: Doc): Doc => ({ source_line: 'p0:1', offer_id: null, code_id: null, voucher_id: null, name: 'x', kind: 'offer', amount: '1.00', typed: 0, ...over });
  const told = (rows: Doc[], more: Partial<Parameters<typeof storedReductions>[0]> = {}) => storedReductions({ rows, columns, codes: [], locale: 'en-US', places: 2, guest: true, ...more });

  it('one entry for each thing applied, its lines added up; a name per language as text or as it was parsed', () => {
    expect(
      told([
        row({ offer_id: 3, code_id: 9, name: '{"en-US":"Welcome 10","de-DE":"Willkommen 10"}', kind: 'code', amount: '2.80', typed: 1 }),
        row({ source_line: 'p0:2', offer_id: 3, code_id: 9, name: { 'en-US': 'Welcome 10', 'de-DE': 'Willkommen 10' }, kind: 'code', amount: '1.50', typed: true }),
        row({ offer_id: 4, name: 'Tote pair', amount: '15.00' }),
      ]),
    ).toEqual([
      { line: null, name: 'Welcome 10', kind: 'code', amount: '4.30', typed: true },
      { line: null, name: 'Tote pair', kind: 'offer', amount: '15.00', typed: false },
    ]);
    expect(told([row({ offer_id: 3, name: '{"en-US":"Welcome 10","de-DE":"Willkommen 10"}' })], { locale: 'de-DE' })[0]!.name).toBe('Willkommen 10');
    // A row of a kind nobody knows is told to nobody.
    expect(told([row({ kind: 'gift' })])).toEqual([]);
  });

  it('staff are told a reduction by hand by its name; a line where the caller says how', () => {
    const staff = [row({ kind: 'staff', name: 'Staff · regular' })];
    expect(told(staff)[0]!.name).toBe('');
    expect(told(staff, { guest: false })[0]!.name).toBe('Staff · regular');
    expect(told([row({ offer_id: 4 })], { lineOf: (line) => `lines/${line.slice(3)}` })[0]!.line).toBe('lines/1');
  });
});
