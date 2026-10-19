// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A CODE TYPED ON AN ORDER WHOSE PRICE ADD-ON IS NOT THERE.
 *
 * Found building a shop from a website template: Offers was suggested and not
 * installed, the page sent the coupon row with the order, and the answer was
 * "That write was refused." with nothing beside it — not to the guest, and not
 * in the server's log either, so the person building the app guessed at every
 * column before finding it. The guest is still told no more (a posting's
 * refusal has no name on this surface, but for stock and a card); the log
 * says which column and why. Without a code the same order goes through.
 */
import { publicKeysRepo } from '@adminium/meta';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { priceWorld, type PriceWorld } from './adjust.helpers.js';
import { CATEGORY, MARKET, PRICES, marketManifest, type Item } from './fixtures/price-kit/index.js';
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

describe.each(LEGS)('a code typed with no add-on to read it — %s', (dialect, available) => {
  let w: PriceWorld;
  let served: Served;
  let g: ReturnType<typeof guest>;
  const log: Doc[] = [];

  beforeAll(async () => {
    if (!available) return;
    w = await priceWorld(dialect, { market: publicMarket(), noKit: true });
    const [key] = (await publicKeysRepo(w.h.meta).listManagedBy(MARKET)).filter((one) => one.revokedAt === null);
    served = await servePublic(w.h as never, key!.id, { ADMINIUM_DATA_DIR: w.h.dataDir }, { logger: pino({ level: 'info' }, { write: (line: string) => void log.push(JSON.parse(line) as Doc) }) });
    g = guest(served, w.h as never);
  }, 240_000);
  afterAll(async () => {
    await served?.close();
    if (available) await w.close();
  });

  const line = (item: Item, qty: number): Doc => ({ values: { item_id: w.items[item], category_id: w.categories[CATEGORY[item]], unit_price: PRICES[item], qty } });
  const basket = (codes: readonly string[] = []): Doc => ({
    values: {},
    children: { order_lines: [line('Mug, speckled', 2)], ...(codes.length === 0 ? {} : { order_codes: codes.map((typed) => ({ values: { typed } })) }) },
  });
  const save = (body: Doc): Promise<Reply> => g.request('POST', '/records/market_orders', { payload: body, proof: 'write' }) as never;

  it.skipIf(!available)('an order without a code goes through', async () => {
    const res = await save(basket());
    expect(res.statusCode, res.body).toBe(201);
  });

  it.skipIf(!available)('an order with a code is refused, and the log says it is the code with no add-on to read it', async () => {
    log.length = 0;
    const res = await save(basket(['AUTUMN5']));
    expect(res.statusCode).toBe(400);
    expect(res.json()['error']).toEqual({ code: 'PUBLIC_WRITE_REFUSED', message: 'That write was refused.' });
    const logged = log.find((entry) => String(entry['msg']).startsWith('a public write was refused'));
    expect(logged).toMatchObject({ ref: 'market_orders', reason: 'add-on-unavailable', column: 'typed' });
    expect(JSON.stringify(logged)).not.toContain('AUTUMN5');
  });
});
