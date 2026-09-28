// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A guest's order with its lines and options, over the public API of an
 * installed app: one write, every row or none, the rows a guest points at
 * checked against what the key's reads show them, each option agreeing with
 * its dish and each size chosen, the price they were shown checked, a retry
 * answered with the order already made, and a dry run that works out every
 * figure and keeps nothing. On every engine.
 */
import BetterSqlite3 from 'better-sqlite3';
import pg from 'pg';
import { connectionTenantConfig } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { createEndpointService } from '../src/public-api/endpoint-service.js';
import { generatePublishableKey, sealPublishableKey } from '../src/public-api/keys.js';
import { solveProof } from '../src/public-api/proof.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { TEST_SECRET } from './helpers.js';
import { installInvoicing, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { cents, MENU, orderPublicManifest } from './order-tree-fixture.js';
import { servePublic, type Served } from './public-lane.helpers.js';

interface Line {
  item: number;
  qty?: number;
  mods?: number[];
  note?: string;
}

const prepare = BetterSqlite3.prototype.prepare;
const query = pg.Client.prototype.query;

const body = (lines: readonly Line[], values: Record<string, unknown> = { email: 'ada@example.com', name: 'Ada' }, more: Record<string, unknown> = {}) => ({
  values,
  children: {
    order_items: lines.map((line) => ({
      values: { menu_item_id: line.item, qty: line.qty ?? 1, ...(line.note === undefined ? {} : { note: line.note }) },
      ...(line.mods === undefined ? {} : { children: { order_item_modifiers: line.mods.map((modifier) => ({ values: { modifier_id: modifier } })) } }),
    })),
  },
  ...more,
});

/** An order of $62.00: two Large Margheritas, two Salads with feta and olives, three Sodas. */
const SIXTY_TWO: Line[] = [
  { item: 1, qty: 2, mods: [2] },
  { item: 2, qty: 2, mods: [3, 4] },
  { item: 4, qty: 3 },
];

describe.each(LEGS)('a guest order with its lines, over the public API — %s', (dialect, available) => {
  let h: (InvoicingHarness & { reply: Record<string, unknown> }) | undefined;
  let served: Served;
  let ip = 0;
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, orderPublicManifest());
    for (const statement of MENU) await h.rows(statement);
    served = await servePublic(h, (h.reply['publicAccess'] as { keyId: string }).keyId);
  }, 180_000);
  afterAll(async () => {
    await served?.close();
    await h?.close();
  });

  const from = () => {
    ip += 1;
    return `10.9.${String((ip >> 8) & 255)}.${String(ip & 255)}`;
  };
  const proof = async (address: string) => {
    const res = await served.composed.app.inject({ method: 'GET', url: '/api/v1/public/challenge?purpose=write', remoteAddress: address, headers: served.headers() });
    const c = (res.json() as { data: { id: string; salt: string; difficulty: number } }).data;
    return `${c.id}.${solveProof(c.salt, c.difficulty)}`;
  };
  const save = async (payload: Record<string, unknown>, opts: { proof?: boolean } = {}) => {
    const address = from();
    return served.composed.app.inject({
      method: 'POST',
      url: '/api/v1/public/records/kitchen_orders',
      remoteAddress: address,
      headers: served.headers(undefined, opts.proof === false ? {} : { 'x-adminium-proof': await proof(address) }),
      payload,
    });
  };
  const quote = (payload: Record<string, unknown>) =>
    served.composed.app.inject({ method: 'POST', url: '/api/v1/public/records/kitchen_orders/dry-run', remoteAddress: from(), headers: served.headers(), payload });
  const counts = async () => {
    const out: Record<string, number> = {};
    for (const ref of ['orders', 'order_items', 'order_item_modifiers']) out[ref] = Number((await h!.rows(`select count(*) as n from ${h!.real(ref)}`))[0]!['n']);
    out['top'] = Number((await h!.rows(`select coalesce(max(number), 0) as n from ${h!.real('orders')}`))[0]!['n']);
    return out;
  };
  const refusal = (res: { json: () => unknown }) => (res.json() as { error: { code: string; params?: Record<string, unknown> } }).error;

  it.runIf(available)('three lines and four options are one write: every figure settled, lines numbered in order', async () => {
    const res = await save(body([{ item: 1, mods: [2] }, { item: 2, qty: 2, mods: [3, 4] }, { item: 1, mods: [1] }]));
    expect(res.statusCode, res.body).toBe(201);
    const reply = res.json() as { data: Record<string, unknown>; children: { order_items: { data: Record<string, unknown>; children?: { order_item_modifiers: { data: Record<string, unknown> }[] } }[] } };
    expect([cents(reply.data['subtotal']), Number(reply.data['item_count']), cents(reply.data['tax']), cents(reply.data['total'])]).toEqual(['52.00', 3, '4.29', '56.29']);
    const lines = reply.children.order_items;
    expect(lines.map((line) => [Number(line.data['position']), cents(line.data['unit_price']), cents(line.data['options_total']), cents(line.data['line_total'])])).toEqual([
      [1, '12.00', '4.00', '16.00'],
      [2, '9.00', '3.00', '24.00'],
      [3, '12.00', '0.00', '12.00'],
    ]);
    expect(lines.map((line) => line.children?.order_item_modifiers.map((option) => cents(option.data['price'])))).toEqual([['4.00'], ['1.50', '1.50'], ['0.00']]);
  });

  it.runIf(available)('a dish that is off today, an option of another dish, a size left out, too many extras: each refused by its row, nothing written', async () => {
    const before = await counts();
    const cases: [Line[], Record<string, unknown>][] = [
      // Tiramisu is not on today's menu: no read of this key shows it.
      [[{ item: 1, mods: [1] }, { item: 3 }], { child: 'order_items', index: 1, path: ['order_items', 1], column: 'menu_item_id', reason: 'not-offered' }],
      // Feta belongs to the salad, not the pizza.
      [[{ item: 1, mods: [3] }], { child: 'order_item_modifiers', index: 0, path: ['order_items', 0, 'order_item_modifiers', 0], column: 'modifier_id', reason: 'not-offered' }],
      // A Margherita with no size: the size group needs one.
      [[{ item: 4 }, { item: 1 }], { child: 'order_items', index: 1, path: ['order_items', 1], reason: 'too-few', group: 1 }],
      // Three extras on a salad that takes two.
      [[{ item: 2, mods: [3, 4, 5] }], { child: 'order_items', index: 0, path: ['order_items', 0], reason: 'too-many', group: 2 }],
      // A minus quantity: the guest's own value, named.
      [[{ item: 4, qty: -1 }], { child: 'order_items', index: 0, path: ['order_items', 0], column: 'qty', reason: 'too-small' }],
      // Thirteen sodas in one line: no more than twelve items an order.
      [[{ item: 4, qty: 13 }], { child: 'order_items', column: 'qty', reason: 'too-many' }],
      // A link typed into a line's note.
      [[{ item: 4, note: 'see https://evil.example' }], { child: 'order_items', index: 0, path: ['order_items', 0], column: 'note' }],
    ];
    for (const [lines, params] of cases) {
      const res = await save(body(lines));
      expect(res.statusCode, res.body).toBe(400);
      expect(refusal(res)).toMatchObject({ code: 'PUBLIC_WRITE_REFUSED', params });
    }
    expect(await counts()).toEqual(before);
  });

  it.runIf(available)("the request's shape: a list it does not offer, too many rows, none where one is needed", async () => {
    const shapes: [Record<string, unknown>, Record<string, unknown>][] = [
      [{ values: { email: 'a@example.com', name: 'A' }, children: { order_items: [{ values: { menu_item_id: 4 } }], invoices: [{ values: {} }] } }, { child: 'invoices', reason: 'not-offered' }],
      [{ values: { email: 'a@example.com', name: 'A' }, children: { order_items: Array.from({ length: 41 }, () => ({ values: { menu_item_id: 4 } })) } }, { child: 'order_items', reason: 'too-many' }],
      [{ values: { email: 'a@example.com', name: 'A' } }, { child: 'order_items', reason: 'too-few' }],
            // A column Adminium decides: not the guest's to write, and not named.
      [{ values: { email: 'a@example.com', name: 'A' }, children: { order_items: [{ values: { menu_item_id: 4, unit_price: 0 } }] } }, { child: 'order_items', index: 0, path: ['order_items', 0] }],
    ];
    for (const [payload, params] of shapes) {
      const res = await save(payload);
      expect(res.statusCode, res.body).toBe(400);
      expect(refusal(res)).toEqual({ code: 'PUBLIC_WRITE_REFUSED', params, message: expect.any(String) });
    }
  });

  it.runIf(available)('the price the guest was shown: a different one writes nothing and says the new total, the same one saves', async () => {
    const before = await counts();
    const changed = await save(body(SIXTY_TWO, undefined, { expect: { total: '61.00' } }));
    expect(changed.statusCode, changed.body).toBe(409);
    const error = refusal(changed);
    expect(error.code).toBe('PUBLIC_PRICE_CHANGED');
    expect(error.params?.['total']).toBe('67.12');
    const lines = (error.params?.['lines'] as { order_items: { data: Record<string, unknown> }[] }).order_items;
    expect(lines.map((line) => cents(line.data['line_total']))).toEqual(['32.00', '24.00', '6.00']);
    expect(await counts()).toEqual(before);
    const same = await save(body(SIXTY_TWO, undefined, { expect: { total: '67.12' } }));
    expect(same.statusCode, same.body).toBe(201);
    expect(cents((same.json() as { data: Record<string, unknown> }).data['total'])).toBe('67.12');
  });

  it.runIf(available)('a dry run answers every figure the save writes, shows no key or number, and keeps nothing', async () => {
    const before = await counts();
    const res = await quote(body(SIXTY_TWO));
    expect(res.statusCode, res.body).toBe(200);
    const dry = res.json() as { data: Record<string, unknown>; children: { order_items: { data: Record<string, unknown>; children?: Record<string, { data: Record<string, unknown> }[]> }[] }; capacity: unknown[]; exact: boolean };
    expect(dry.exact).toBe(true);
    // The dishes' pools, as they stand: free, and never how much is left.
    expect(dry.capacity.length).toBeGreaterThan(0);
    for (const pool of dry.capacity as Record<string, unknown>[]) {
      expect(pool['state']).toBe('available');
      expect(pool['left']).toBeUndefined();
    }
    expect(await counts()).toEqual(before);
    // No key and no running number: the next of either is a count of sales.
    expect(Object.keys(dry.data).sort()).toEqual(['item_count', 'subtotal', 'tax', 'total']);
    expect(Object.keys(dry.children.order_items[0]!.data).sort()).toEqual(['line_total', 'options_total', 'position', 'unit_price']);
    const saved = (await save(body(SIXTY_TWO))).json() as typeof dry;
    const figures = (reply: typeof dry) => ({
      root: [cents(reply.data['subtotal']), Number(reply.data['item_count']), cents(reply.data['tax']), cents(reply.data['total'])],
      lines: reply.children.order_items.map((line) => [line.data['position'], cents(line.data['unit_price']), cents(line.data['options_total']), cents(line.data['line_total'])]),
    });
    expect(figures(dry)).toEqual(figures(saved));
    // The save took the next number; the dry run took none.
    expect((await counts())['top']).toBe(before['top']! + 1);
  });

  it.runIf(available)('a dry run checks no price: one sent with it is refused, the same quote without it answered', async () => {
    const before = await counts();
    const checked = await quote(body(SIXTY_TWO, undefined, { expect: { total: '67.12' } }));
    expect(checked.statusCode, checked.body).toBe(400);
    expect(refusal(checked).code).toBe('PUBLIC_WRITE_REFUSED');
    const plain = await quote(body(SIXTY_TWO));
    expect(plain.statusCode, plain.body).toBe(200);
    expect(await counts()).toEqual(before);
  });

  it.runIf(available)('a dry run prices before any details exist, and refuses what a save would', async () => {
    // No address and no name yet: the page shows a price in the cart.
    const bare = await quote(body(SIXTY_TWO, {}));
    expect(bare.statusCode, bare.body).toBe(200);
    expect(cents((bare.json() as { data: Record<string, unknown> }).data['total'])).toBe('67.12');
    const off = await quote(body([{ item: 3 }]));
    expect(off.statusCode).toBe(400);
    expect(refusal(off)).toMatchObject({ code: 'PUBLIC_WRITE_REFUSED', params: { child: 'order_items', index: 0, column: 'menu_item_id', reason: 'not-offered' } });
  });

  it.runIf(available)('a save proves a person is there; a dry run does not ask', async () => {
    const res = await save(body(SIXTY_TWO), { proof: false });
    expect(res.statusCode).toBe(403);
    expect(refusal(res).code).toBe('PUBLIC_PROOF_REQUIRED');
    expect((await quote(body(SIXTY_TWO))).statusCode).toBe(200);
  });

  it.runIf(available)('a retry with the same key answers the order already made, without its link; the key is kept only as a hash', async () => {
    const key = 'k3Y-0123456789abcdefghijklmn';
    const first = await save(body(SIXTY_TWO, { email: 'ada@example.com', name: 'Ada', client_key: key }));
    expect(first.statusCode, first.body).toBe(201);
    const before = await counts();
    const again = await save(body(SIXTY_TWO, { email: 'ada@example.com', name: 'Ada', client_key: key }));
    expect(again.statusCode, again.body).toBe(200);
    const made = first.json() as Record<string, unknown>;
    expect(again.json()).toEqual({ ...made, replayed: true });
    expect(await counts()).toEqual(before);
    const stored = await h!.rows(`select client_key from ${h!.real('orders')} where id = ${String((made['data'] as { id: unknown }).id)}`);
    expect(stored[0]!['client_key']).not.toBe(key);
    expect(String(stored[0]!['client_key'])).toHaveLength(43);
    // Another key is another order.
    const other = await save(body(SIXTY_TWO, { email: 'ada@example.com', name: 'Ada', client_key: 'another-key-0123456789abcd' }));
    expect(other.statusCode).toBe(201);
    // A key too short to be a secret is refused as the value it is.
    const short = await save(body(SIXTY_TWO, { email: 'ada@example.com', name: 'Ada', client_key: 'abc' }));
    expect(short.statusCode).toBe(400);
    expect(refusal(short)).toMatchObject({ params: { column: 'client_key', reason: 'format' } });
    // A dry run carries no key: twice with the same one keeps nothing and blocks nothing.
    for (let i = 0; i < 2; i += 1) expect((await quote(body(SIXTY_TWO, { email: 'ada@example.com', name: 'Ada', client_key: 'dry-key-0123456789abcdefgh' }))).statusCode).toBe(200);
  });

  /** An operator's own endpoints over the installed tables, and a key to them; the served key is switched to it. */
  const operatorKey = async (endpoints: { ref: string; table: string; methods: string[]; definition: Record<string, unknown> }[]) => {
    const views = createPublicViews(h!.meta);
    const service = createEndpointService({ meta: h!.meta, viewFor: views.viewFor, tenantConfigOf: async (cid) => (await connectionTenantConfig(h!.meta, cid)) ?? undefined });
    const view = (await views.viewFor(h!.connectionId))!;
    for (const endpoint of endpoints) {
      const saved = await service.saveEndpoint({
        connectionId: h!.connectionId,
        ref: endpoint.ref,
        origin: 'custom',
        definition: {
          path: `/${endpoint.ref}`,
          source: view.table(h!.real(endpoint.table)).id,
          methods: endpoint.methods,
          filters: [],
          pagination: { default_limit: 50, max_limit: 200, order: 'id.asc' },
          auth: { role: 'anon' },
          rate_limit: { requests: 60, window: '1m' },
          response: { shape: 'object', envelope: 'data' },
          ...endpoint.definition,
        } as never,
      });
      expect(saved).toBeDefined();
    }
    const secret = generatePublishableKey('browser');
    const { key } = await service.createKey({
      connectionId: h!.connectionId,
      name: `operator ${endpoints.map((e) => e.ref).join(' ')}`,
      access: endpoints.map((endpoint) => ({ ref: endpoint.ref, methods: endpoint.methods as never })),
      secret: { prefix: secret.prefix, tokenHash: secret.tokenHash, tokenEncrypted: sealPublishableKey(dsnCryptoFromSecret(TEST_SECRET), secret.token) },
      origins: [],
      kind: 'browser',
    });
    await served.useKey(key.id);
    return async () => served.useKey((h!.reply['publicAccess'] as { keyId: string }).keyId);
  };

  it.runIf(available)("a guest's change tried first: the dry run shows the new figure and keeps nothing; a save at another price is refused", async () => {
    const made = (await save(body([{ item: 4, qty: 1 }]))).json() as { data: { id: unknown }; children: { order_items: { data: { id: unknown } }[] } };
    const line = made.children.order_items[0]!.data.id;
    const back = await operatorKey([{ ref: 'line_change', table: 'order_items', methods: ['PATCH'], definition: { select: ['id', 'qty', 'line_total'], writable: ['qty'], dry_run: true, expect: 'line_total' } }]);
    try {
      const patch = (url: string, payload: Record<string, unknown>, method: 'PATCH' | 'POST' = 'PATCH') =>
        served.composed.app.inject({ method, url: `/api/v1/public/records/line_change/${String(line)}${url}`, remoteAddress: from(), headers: served.headers(), payload });
      const lineRow = async () => (await h!.rows(`select qty, line_total from ${h!.real('order_items')} where id = ${String(line)}`))[0]!;
      const orderTotal = async () => cents((await h!.rows(`select total from ${h!.real('orders')} where id = ${String(made.data.id)}`))[0]!['total']);
      const total = await orderTotal();
      const dry = await patch('/dry-run', { values: { qty: 3 } }, 'POST');
      expect(dry.statusCode, dry.body).toBe(200);
      const data = (dry.json() as { data: Record<string, unknown> }).data;
      expect([Number(data['qty']), cents(data['line_total'])]).toEqual([3, '6.00']);
      // The quote shows figures, not the row's key.
      expect(data['id']).toBeUndefined();
      // A price check goes with the save, never with a quote: refused, as a new order's quote refuses one.
      const checked = await patch('/dry-run', { values: { qty: 3 }, expect: { total: '6.00' } }, 'POST');
      expect(checked.statusCode, checked.body).toBe(400);
      expect(refusal(checked).code).toBe('PUBLIC_WRITE_REFUSED');
      expect([Number((await lineRow())['qty']), await orderTotal()]).toEqual([1, total]);
      // Saved at a price the guest was not shown: refused, with the price it would be.
      const changed = await patch('', { values: { qty: 3 }, expect: { total: '4.00' } });
      expect(changed.statusCode, changed.body).toBe(409);
      expect(refusal(changed)).toMatchObject({ code: 'PUBLIC_PRICE_CHANGED', params: { total: '6.00' } });
      expect(Number((await lineRow())['qty'])).toBe(1);
      // At the price shown: saved, and the order above it settled in the same write.
      const saved = await patch('', { values: { qty: 3 }, expect: { total: '6.00' } });
      expect(saved.statusCode, saved.body).toBe(200);
      expect(Number((await lineRow())['qty'])).toBe(3);
      expect(await orderTotal()).toBe((Number(total) + 4 * 1.0825).toFixed(2));
    } finally {
      await back();
    }
  });

  it.runIf(available)('an entry with a price check or a retry key and no child rows goes the same one way', async () => {
    const back = await operatorKey([
      { ref: 'bare_order', table: 'orders', methods: ['POST'], definition: { select: ['id', 'total'], writable: ['email', 'name', 'client_key'], expect: 'total', client_key: 'client_key' } },
    ]);
    try {
      const post = (payload: Record<string, unknown>) =>
        served.composed.app.inject({ method: 'POST', url: '/api/v1/public/records/bare_order', remoteAddress: from(), headers: served.headers(), payload });
      const key = 'bare-order-key-0123456789ab';
      const values = { email: 'bo@example.com', name: 'Bo', client_key: key };
      const wrong = await post({ values, expect: { total: '1.00' } });
      expect(wrong.statusCode, wrong.body).toBe(409);
      expect(refusal(wrong)).toMatchObject({ code: 'PUBLIC_PRICE_CHANGED', params: { total: '0.00' } });
      const made = await post({ values, expect: { total: '0.00' } });
      expect(made.statusCode, made.body).toBe(201);
      const again = await post({ values, expect: { total: '0.00' } });
      expect(again.statusCode, again.body).toBe(200);
      expect(again.json()).toMatchObject({ replayed: true, data: (made.json() as { data: unknown }).data });
      const rows = await post({ values: { email: 'bo@example.com', name: 'Bo' }, children: { order_items: [{ values: { menu_item_id: 4 } }] } });
      expect(rows.statusCode).toBe(400);
      expect(refusal(rows)).toMatchObject({ params: { child: 'order_items', reason: 'not-offered' } });
    } finally {
      await back();
    }
  });

  it.runIf(available && dialect !== 'mysql')('a dry run issues the same statements for an address on file and one that is not, and never reads the people', async () => {
    const statements: string[] = [];
    const spy =
      dialect === 'sqlite'
        ? vi.spyOn(BetterSqlite3.prototype, 'prepare').mockImplementation(function (this: BetterSqlite3.Database, source: string) {
            statements.push(source);
            return prepare.call(this, source);
          } as never)
        : vi.spyOn(pg.Client.prototype, 'query').mockImplementation(function (this: pg.Client, ...args: unknown[]) {
            if (typeof args[0] === 'string') statements.push(args[0]);
            return (query as (...a: unknown[]) => unknown).apply(this, args);
          } as never);
    const run = async (email: string) => {
      statements.length = 0;
      const res = await quote(body(SIXTY_TWO, { email, name: 'Someone' }));
      expect(res.statusCode, res.body).toBe(200);
      return statements.filter((sql) => sql.includes('kitchen_'));
    };
    try {
      await run('warm@example.com');
      const known = await run('ada@example.com');
      const unknown = await run('nobody-here@example.com');
      expect(known.length).toBeGreaterThan(0);
      expect(unknown).toEqual(known);
      expect(known.some((sql) => sql.includes('kitchen_customers'))).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it.runIf(available)('a fourth line for a dish that is sold out refuses the whole order and names that line; the quote says so first', async () => {
    const before = await counts();
    const lines: Line[] = [{ item: 1, mods: [1] }, { item: 4 }, { item: 2 }, { item: 5, qty: 3 }];
    const quoted = await quote(body(lines));
    expect(quoted.statusCode, quoted.body).toBe(409);
    expect(refusal(quoted)).toMatchObject({ code: 'PUBLIC_SOLD_OUT', params: { child: 'order_items', index: 3, path: ['order_items', 3] } });
    const res = await save(body(lines));
    expect(res.statusCode, res.body).toBe(409);
    expect(refusal(res)).toMatchObject({ code: 'PUBLIC_SOLD_OUT', params: { child: 'order_items', index: 3, path: ['order_items', 3] } });
    // Never how many are left.
    expect(refusal(res).params?.['left']).toBeUndefined();
    expect(await counts()).toEqual(before);
    // The two that are left sell.
    const two = await save(body([{ item: 5, qty: 2 }]));
    expect(two.statusCode, two.body).toBe(201);
  });
});
