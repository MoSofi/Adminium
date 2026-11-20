// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A SHOPPER'S LISTS ON A CATALOGUE ENTRY, on SQLite, Postgres and MySQL.
 *
 * A manifest's list anyone reads may now say what a visitor may filter it
 * by (each column with its own operators), search, order it by, ask of
 * another list's rows that point at it (a product's variants, `via`), and
 * whether its first page counts. Everything asked is ANDed after the entry's
 * own filters, so it only narrows; anything the entry does not name is
 * refused, naming only the parameter.
 *
 * What these prove, on each engine alike:
 *  - the same filter and order give the same rows in the same order for
 *    numbers, dates and yes/no columns, and a cursor pages them to the end;
 *  - a search for `100%` finds that text and nothing else, `_` is a letter
 *    (`escape '!'`), and a search is at least two characters;
 *  - "Slate and M" holds on ONE variant the variants list shows: a product
 *    whose only Slate/M variant is inactive, or whose Slate and M are two
 *    variants, is not found;
 *  - a column or operator the entry does not name, an `or`, a long `in`, a
 *    deep offset are refused; a search has its own counter;
 *  - the first page says how many rows match, to a thousand.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { installInvoicing, invoicingManifest, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.67' }));

const id = { ref: 'id', type: 'int', role: 'pk' };

function shop(): Record<string, unknown> {
  const manifest = invoicingManifest([
    {
      ref: 'products',
      columns: [
        id,
        { ref: 'name', type: 'text', maxLength: 80 },
        { ref: 'category', type: 'text', maxLength: 40 },
        { ref: 'price', type: 'decimal', scale: 2 },
        { ref: 'created_at', type: 'timestamptz' },
        { ref: 'featured', type: 'bool', default: false },
        { ref: 'status', type: 'enum', enum: ['active', 'draft'], default: 'active' },
      ],
    },
    {
      ref: 'variants',
      columns: [
        id,
        { ref: 'product_id', type: 'fk', references: 'products' },
        { ref: 'colour_code', type: 'text', maxLength: 20 },
        { ref: 'size_code', type: 'text', maxLength: 20 },
        { ref: 'active', type: 'bool', default: true },
      ],
    },
  ]);
  manifest['key'] = 'outdoor';
  manifest['compatibility'] = { minAdminiumVersion: '0.3.67' };
  (manifest['pages'] as { bindings: Record<string, string> }[])[0]!.bindings = { rows: 'products' };
  manifest['frontends'] = [
    { side: 'staff', kind: 'spa', entry: 'index.html' },
    { side: 'customer', kind: 'spa', entry: 'index.html' },
  ];
  manifest['publicAccess'] = [
    {
      table: 'products',
      methods: ['GET'],
      select: ['id', 'name', 'category', 'price', 'created_at', 'featured'],
      filters: [{ column: 'status', op: 'eq', value: 'active' }],
      filterable: ['category', { column: 'price', ops: ['gte', 'lte'] }, 'featured', { column: 'created_at', ops: ['gte', 'lt'] }],
      searchable: ['name'],
      orderable: ['price', 'created_at', 'featured', 'name'],
      via: { entry: 'variants', on: 'product_id', columns: ['colour_code', 'size_code'] },
      count: true,
      pagination: { defaultLimit: 3, maxLimit: 50, order: 'created_at.desc' },
    },
    { table: 'variants', methods: ['GET'], select: ['id', 'product_id', 'colour_code', 'size_code'], filters: [{ column: 'active', op: 'eq', value: true }] },
  ];
  return manifest;
}

describe.each(LEGS)("a shopper's lists on a catalogue entry — %s", (dialect, available) => {
  let h: (InvoicingHarness & { reply: Record<string, unknown> }) | undefined;
  let served: Served;
  const yes = dialect === 'postgres' ? 'true' : '1';
  const no = dialect === 'postgres' ? 'false' : '0';
  /** A moment as each engine takes it in a plain INSERT. */
  const at = (iso: string) => (dialect === 'mysql' ? `'${iso.replace('T', ' ').replace('Z', '')}'` : `'${iso}'`);

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, shop());
    const products: [number, string, string, string, string, string, string][] = [
      [1, 'Ridge Shell', 'jackets', '189.00', '2026-01-05T10:00:00Z', yes, 'active'],
      [2, 'Trail Fleece', 'jackets', '95.50', '2026-02-10T10:00:00Z', no, 'active'],
      [3, '100% wool beanie', 'hats', '24.00', '2026-03-01T10:00:00Z', yes, 'active'],
      [4, '1000 mile sock', 'socks', '18.00', '2026-03-02T10:00:00Z', no, 'active'],
      [5, 'Wool_Blend cap', 'hats', '24.00', '2026-03-03T10:00:00Z', no, 'active'],
      [6, 'Draft pack', 'packs', '120.00', '2026-03-04T10:00:00Z', no, 'draft'],
      [7, 'Summit Pack', 'packs', '140.00', '2026-01-20T10:00:00Z', yes, 'active'],
    ];
    for (const [pid, name, category, price, created, featured, status] of products) {
      await h.rows(`insert into outdoor_products (id, name, category, price, created_at, featured, status) values (${String(pid)}, '${name}', '${category}', ${price}, ${at(created)}, ${featured}, '${status}')`);
    }
    const variants: [number, number, string, string, string][] = [
      // Ridge Shell: Slate/M on one variant.
      [1, 1, 'slate', 'm', yes],
      [2, 1, 'ember', 's', yes],
      // Trail Fleece: Slate and M, but on two variants.
      [3, 2, 'slate', 's', yes],
      [4, 2, 'ember', 'm', yes],
      // The beanie: Slate/M.
      [5, 3, 'slate', 'm', yes],
      // A draft product's Slate/M: the product is never shown.
      [6, 6, 'slate', 'm', yes],
      // Summit Pack: its only Slate/M is inactive.
      [7, 7, 'slate', 'm', no],
      [8, 7, 'slate', 'l', yes],
    ];
    for (const [vid, pid, colour, size, active] of variants) {
      await h.rows(`insert into outdoor_variants (id, product_id, colour_code, size_code, active) values (${String(vid)}, ${String(pid)}, '${colour}', '${size}', ${active})`);
    }
    served = await servePublic(h, (h.reply['publicAccess'] as { keyId: string }).keyId);
  }, 180_000);
  afterAll(async () => {
    await served?.close();
    await h?.close();
  });

  const list = async (query: Record<string, string>) => {
    const res = await served.get(`/records/outdoor_products?${new URLSearchParams(query).toString()}`);
    return { res, ids: res.statusCode === 200 ? (res.json() as { data: { id: number | string }[] }).data.map((row) => Number(row.id)) : [], body: res.json() as Record<string, unknown> };
  };
  const where = (filter: unknown) => JSON.stringify(filter);

  it.skipIf(!available)('tells the page what it may ask: each column with its operators, the filter through the variants, the count', async () => {
    const res = await served.get('/config');
    expect(res.statusCode, res.body).toBe(200);
    const ref = (res.json() as { data: { refs: Record<string, Record<string, unknown>> } }).data.refs['outdoor_products']!;
    expect(ref['filterable']).toEqual(['category', 'price', 'featured', 'created_at']);
    expect(ref['shopper']).toEqual({
      ops: { category: ['eq', 'in', 'gte', 'lte'], price: ['gte', 'lte'], featured: ['eq', 'in', 'gte', 'lte'], created_at: ['gte', 'lt'] },
      via: { ref: 'outdoor_variants', ops: { colour_code: ['eq', 'in', 'gte', 'lte'], size_code: ['eq', 'in', 'gte', 'lte'] } },
      count: true,
    });
  });

  it.skipIf(!available)('orders numbers, dates and yes/no alike on every engine, the key breaking a tie', async () => {
    // By price: two at 24.00, by key between them.
    expect((await list({ order: 'price.asc', limit: '10' })).ids).toEqual([4, 3, 5, 2, 7, 1]);
    // Featured first, then oldest.
    expect((await list({ order: 'featured.desc,created_at.asc', limit: '10' })).ids).toEqual([1, 7, 3, 2, 4, 5]);
    // The entry's own order: newest first (a draft is never in it).
    expect((await list({ limit: '10' })).ids).toEqual([5, 4, 3, 2, 7, 1]);
  });

  it.skipIf(!available)('filters numbers, dates and yes/no with the operators each column takes', async () => {
    expect((await list({ where: where({ and: [{ column: 'price', op: 'gte', value: 24 }, { column: 'price', op: 'lte', value: 100 }] }) })).ids).toEqual([5, 3, 2]);
    expect((await list({ where: where({ and: [{ column: 'created_at', op: 'gte', value: '2026-03-01T00:00:00Z' }, { column: 'created_at', op: 'lt', value: '2026-03-03T00:00:00Z' }] }), limit: '10' })).ids).toEqual([4, 3]);
    expect((await list({ where: where({ column: 'featured', op: 'eq', value: true }), order: 'price.asc' })).ids).toEqual([3, 7, 1]);
    expect((await list({ where: where({ column: 'category', op: 'in', value: ['hats', 'socks'] }), order: 'price.desc' })).ids).toEqual([3, 5, 4]);
  });

  it.skipIf(!available)('pages by cursor to the end, in the same order', async () => {
    const first = await list({ cursor: '' });
    expect(first.res.statusCode, first.res.body).toBe(200);
    expect(first.ids).toEqual([5, 4, 3]);
    const next = (first.body['cursor'] as { next: string | null }).next;
    expect(next).not.toBeNull();
    const second = await list({ cursor: next! });
    expect(second.ids).toEqual([2, 7, 1]);
    expect((second.body['cursor'] as { next: string | null }).next).toBeNull();
    // A later page does not count again.
    expect(second.body['count']).toBeUndefined();
  });

  it.skipIf(!available)('finds "100%" and "l_b" as typed, and nothing a wildcard would', async () => {
    expect((await list({ q: '100%' })).ids).toEqual([3]);
    // `_` is a letter: "Wool_Blend", never "wool beanie" ("l b").
    expect((await list({ q: 'l_b' })).ids).toEqual([5]);
    // Any case.
    expect((await list({ q: 'SUMMIT', limit: '10' })).ids).toEqual([7]);
    const short = await list({ q: 'a' });
    expect(short.res.statusCode).toBe(400);
    expect(short.body['error']).toMatchObject({ code: 'PUBLIC_QUERY_REFUSED', params: { parameter: 'q' } });
  });

  it.skipIf(!available)('finds a product by colour and size only when ONE variant the variants list shows has both', async () => {
    const slateM = where({ and: [{ column: 'colour_code', op: 'eq', value: 'slate' }, { column: 'size_code', op: 'eq', value: 'm' }] });
    // Ridge Shell and the beanie; never Trail Fleece (two variants), Summit Pack (its Slate/M is inactive) or the draft.
    expect((await list({ via: slateM, limit: '10' })).ids).toEqual([3, 1]);
    // ANDed with the product's own filters and the shopper's.
    expect((await list({ via: slateM, where: where({ column: 'category', op: 'eq', value: 'jackets' }) })).ids).toEqual([1]);
    // Slate in any size: Summit Pack's active Slate/L counts.
    expect((await list({ via: where({ column: 'colour_code', op: 'eq', value: 'slate' }), limit: '10' })).ids).toEqual([3, 2, 7, 1]);
    // The count follows the filter.
    expect((await list({ via: slateM })).body['count']).toEqual({ rows: 2, atLeast: false });
  });

  it.skipIf(!available)('refuses what the entry does not name, naming only the parameter', async () => {
    const refused = async (query: Record<string, string>, parameter: string) => {
      const { res, body } = await list(query);
      expect(res.statusCode, `${JSON.stringify(query)}: ${res.body}`).toBe(400);
      expect(body['error']).toMatchObject({ code: 'PUBLIC_QUERY_REFUSED', params: { parameter } });
    };
    // A column the entry does not name, shown or not.
    await refused({ where: where({ column: 'name', op: 'eq', value: 'Ridge Shell' }) }, 'where');
    await refused({ where: where({ column: 'status', op: 'eq', value: 'draft' }) }, 'where');
    // An operator the column does not take, a pattern, an `or`, a long `in`.
    await refused({ where: where({ column: 'price', op: 'eq', value: 24 }) }, 'where');
    await refused({ where: where({ column: 'category', op: 'like', value: '%a%' }) }, 'where');
    await refused({ where: where({ or: [{ column: 'category', op: 'eq', value: 'hats' }, { column: 'category', op: 'eq', value: 'socks' }] }) }, 'where');
    await refused({ where: where({ column: 'category', op: 'in', value: Array.from({ length: 51 }, (_, n) => `c${String(n)}`) }) }, 'where');
    // Through the variants: only what they name, and no `or` there either.
    await refused({ via: where({ column: 'active', op: 'eq', value: false }) }, 'via');
    await refused({ via: where({ or: [{ column: 'colour_code', op: 'eq', value: 'slate' }, { column: 'size_code', op: 'eq', value: 'm' }] }) }, 'via');
    // An order by a column not named.
    await refused({ order: 'category.asc' }, 'order');
    // Deep offsets page by cursor.
    await refused({ offset: '1001' }, 'offset');
    expect((await list({ offset: '1000' })).res.statusCode).toBe(200);
    // The variants list itself takes none of it.
    const plain = await served.get(`/records/outdoor_variants?via=${encodeURIComponent(where({ column: 'size_code', op: 'eq', value: 'm' }))}`);
    expect(plain.statusCode).toBe(400);
  });

  it.skipIf(!available)('counts its first page to a thousand, then says "a thousand or more"', async () => {
    expect((await list({})).body['count']).toEqual({ rows: 6, atLeast: false });
    const values = Array.from({ length: 1_001 }, (_, n) => `(${String(1_000 + n)}, 'Bulk ${String(n)}', 'bulk', 1.00, ${at('2025-06-01T00:00:00Z')}, ${no}, 'active')`);
    await h!.rows(`insert into outdoor_products (id, name, category, price, created_at, featured, status) values ${values.join(', ')}`);
    expect((await list({ where: where({ column: 'category', op: 'eq', value: 'bulk' }) })).body['count']).toEqual({ rows: 1_000, atLeast: true });
    expect((await list({ where: where({ column: 'category', op: 'eq', value: 'hats' }) })).body['count']).toEqual({ rows: 2, atLeast: false });
  });

  it.skipIf(!available)('counts searches on their own counter, thirty a minute', async () => {
    const search = (q: string) => served.composed.app.inject({ method: 'GET', url: `/api/v1/public/records/outdoor_products?q=${q}`, remoteAddress: '10.77.0.1', headers: served.headers() });
    for (let n = 0; n < 30; n += 1) expect((await search('wo')).statusCode).toBe(200);
    expect((await search('wo')).statusCode).toBe(429);
    // Browsing from the same address is not spent by it.
    const browse = await served.composed.app.inject({ method: 'GET', url: '/api/v1/public/records/outdoor_products', remoteAddress: '10.77.0.1', headers: served.headers() });
    expect(browse.statusCode, browse.body).toBe(200);
  });
});
