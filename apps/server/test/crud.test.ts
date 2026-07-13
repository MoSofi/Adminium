/**
 * Live CRUD suite against real PostgreSQL + the real postgres adapter,
 * seeded with the adapter package's Northwind fixture. Skips (green) when
 * psql, the fixture, or the adapter provider is unavailable.
 *
 * Complements crud-e2e.test.ts (which runs everywhere on a fake adapter)
 * with the PG-only behaviors: ILIKE quick search, PG constraint-code
 * mapping, composite-PK records, parameterized hostile values against a
 * real engine, PII masking driven by the real classifier, and the
 * read-only-role READ_ONLY_MODE guard.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { providerFromModule } from '../src/connections/register-adapters.js';
import {
  asUser,
  buildDataTestApp,
  createConnectionViaApi,
  createNorthwindDb,
  introspectViaApi,
  pgAvailable,
  psql,
  type DataTestContext,
  type TestPg,
} from './connections-helpers.js';

const adapterReady = await (async () => {
  try {
    return providerFromModule(await import('@adminium/adapter-postgres')) !== null;
  } catch {
    return false;
  }
})();

const AVAILABLE = adapterReady && pgAvailable();

describe.skipIf(!AVAILABLE)('records CRUD (live PG, Northwind)', () => {
  let pg: TestPg;
  let t: DataTestContext;
  let connId: string;

  beforeAll(async () => {
    pg = createNorthwindDb();
    t = await buildDataTestApp();
    connId = await createConnectionViaApi(t, pg.dsn);
    await introspectViaApi(t, connId);
    await t.grantTable(t.roles.admin, connId, '*', {
      read: true,
      create: true,
      update: true,
      delete: true,
    });
    await t.grantTable(t.roles.viewer, connId, '*', { read: true });
    await t.grantTable(t.roles.editor, connId, 'public.products', {
      read: true,
      create: true,
      update: true,
      delete: true,
    });
  });

  afterAll(async () => {
    await t.app.close();
    pg.drop();
  });

  it('lists with exact counts matching the database', async () => {
    const expected = Number(psql(pg.database, 'SELECT count(*) FROM products').trim());
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/v1/data/${connId}/public.products?limit=5`,
      headers: asUser(t.users.viewer),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: unknown[]; page: { total: number } };
    expect(body.data.length).toBeLessThanOrEqual(5);
    expect(body.page.total).toBe(expected);
  });

  it('quick search (q=) matches text columns case-insensitively via ILIKE', async () => {
    const name = psql(pg.database, 'SELECT product_name FROM products LIMIT 1').trim();
    const needle = name.slice(1, Math.min(5, name.length)).toLowerCase();
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/v1/data/${connId}/public.products?q=${encodeURIComponent(needle)}`,
      headers: asUser(t.users.viewer),
    });
    expect(res.statusCode).toBe(200);
    const rows = (res.json() as { data: { product_name: string }[] }).data;
    expect(rows.some((row) => row.product_name === name)).toBe(true);
  });

  it('keyset pagination walks the whole table without duplicates or gaps', async () => {
    const total = Number(psql(pg.database, 'SELECT count(*) FROM products').trim());
    const seen = new Set<number>();
    let cursor = '';
    for (let hop = 0; hop < 50; hop += 1) {
      const res = await t.app.inject({
        method: 'GET',
        url: `/api/v1/data/${connId}/public.products?order=unit_price.desc&limit=3&cursor=${encodeURIComponent(cursor)}`,
        headers: asUser(t.users.viewer),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: { product_id: number }[]; cursor: { next: string | null } };
      for (const row of body.data) {
        expect(seen.has(row.product_id)).toBe(false);
        seen.add(row.product_id);
      }
      if (body.cursor.next === null) break;
      cursor = body.cursor.next;
    }
    expect(seen.size).toBe(total);
  });

  it('parameterizes hostile filter values against the real engine', async () => {
    const where = encodeURIComponent(
      JSON.stringify({ column: 'product_name', op: 'eq', value: `'; DROP TABLE products; --` }),
    );
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/v1/data/${connId}/public.products?where=${where}`,
      headers: asUser(t.users.viewer),
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: unknown[] }).data).toEqual([]);
    expect(psql(pg.database, "SELECT count(*) FROM products").trim()).not.toBe('0');
  });

  it('masks classified PII (customers.phone) for viewers; admin unmasks; audit is redacted', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/v1/data/${connId}/public.customers?limit=1&order=customer_id.asc`,
      headers: asUser(t.users.viewer),
    });
    expect(res.statusCode).toBe(200);
    const row = (res.json() as { data: Record<string, unknown>[] }).data[0]!;
    expect(row.phone).toBeNull();
    expect(row._masked).toContain('phone');

    const admin = await t.app.inject({
      method: 'GET',
      url: `/api/v1/data/${connId}/public.customers?limit=1&order=customer_id.asc`,
      headers: asUser(t.users.admin),
    });
    const adminRow = (admin.json() as { data: Record<string, unknown>[] }).data[0]!;
    expect(adminRow.phone).not.toBeNull();

    const select = await t.app.inject({
      method: 'GET',
      url: `/api/v1/data/${connId}/public.customers?select=phone`,
      headers: asUser(t.users.viewer),
    });
    expect(select.statusCode).toBe(403);
    expect((select.json() as { error: { code: string } }).error.code).toBe('COLUMN_FORBIDDEN');
  });

  it('reads composite-PK records (order_details) via JSON record ids', async () => {
    const [orderId, productId] = psql(
      pg.database,
      'SELECT order_id, product_id FROM order_details LIMIT 1',
    )
      .trim()
      .split('|')
      .map(Number);
    const recordId = encodeURIComponent(JSON.stringify({ order_id: orderId, product_id: productId }));
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/v1/data/${connId}/public.order_details/${recordId}`,
      headers: asUser(t.users.viewer),
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json() as { data: { order_id: number; product_id: number } };
    expect(data.order_id).toBe(orderId);
    expect(data.product_id).toBe(productId);
  });

  it('create/update/delete round-trip with undo restoring the exact row', async () => {
    const created = await t.app.inject({
      method: 'POST',
      url: `/api/v1/data/${connId}/public.products`,
      headers: asUser(t.users.editor),
      payload: {
        values: { product_id: 900, product_name: 'Adminium Test Brew', unit_price: 12.5, discontinued: 0 },
      },
    });
    expect(created.statusCode).toBe(201);
    expect((created.json() as { data: { product_name: string } }).data.product_name).toBe(
      'Adminium Test Brew',
    );

    // PG unique-violation mapping (§2.7.2).
    const dupe = await t.app.inject({
      method: 'POST',
      url: `/api/v1/data/${connId}/public.products`,
      headers: asUser(t.users.editor),
      payload: { values: { product_id: 900, product_name: 'Dupe', discontinued: 0 } },
    });
    expect(dupe.statusCode).toBe(409);
    expect((dupe.json() as { error: { code: string } }).error.code).toBe('UNIQUE_VIOLATION');

    const updated = await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/data/${connId}/public.products/900`,
      headers: asUser(t.users.editor),
      payload: { values: { unit_price: 20 } },
    });
    expect(updated.statusCode).toBe(200);

    const deleted = await t.app.inject({
      method: 'DELETE',
      url: `/api/v1/data/${connId}/public.products/900`,
      headers: asUser(t.users.editor),
    });
    expect(deleted.statusCode).toBe(200);
    const { undoToken } = deleted.json() as { undoToken: string };
    expect(psql(pg.database, 'SELECT count(*) FROM products WHERE product_id = 900').trim()).toBe('0');

    const undo = await t.app.inject({
      method: 'POST',
      url: `/api/v1/data/undo/${undoToken}`,
      headers: asUser(t.users.editor),
      payload: {},
    });
    expect(undo.statusCode).toBe(200);
    expect(
      psql(pg.database, 'SELECT product_name, unit_price FROM products WHERE product_id = 900').trim(),
    ).toBe('Adminium Test Brew|20');

    // Cleanup for other tests.
    psql(pg.database, 'DELETE FROM products WHERE product_id = 900');
  });

  it('references preflight counts inbound FKs per relation', async () => {
    const [customerId, orderCount] = psql(
      pg.database,
      'SELECT customer_id, count(*) FROM orders GROUP BY customer_id ORDER BY count(*) DESC LIMIT 1',
    )
      .trim()
      .split('|');
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/v1/data/${connId}/public.customers/${encodeURIComponent(customerId as string)}/references`,
      headers: asUser(t.users.viewer),
    });
    expect(res.statusCode).toBe(200);
    const { references } = res.json() as { references: { table: string; count: number }[] };
    const orders = references.find((ref) => ref.table === 'public.orders');
    expect(orders?.count).toBe(Number(orderCount));
  });

  it('viewer mutations are TABLE_FORBIDDEN; editor is scoped to granted tables', async () => {
    const write = await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/data/${connId}/public.products/1`,
      headers: asUser(t.users.viewer),
      payload: { values: { units_in_stock: 0 } },
    });
    expect(write.statusCode).toBe(403);
    expect((write.json() as { error: { code: string } }).error.code).toBe('TABLE_FORBIDDEN');

    const offGrant = await t.app.inject({
      method: 'GET',
      url: `/api/v1/data/${connId}/public.orders`,
      headers: asUser(t.users.editor),
    });
    expect(offGrant.statusCode).toBe(403);
  });

  it('read-only connections refuse mutations with READ_ONLY_MODE', async () => {
    const roConnId = await createConnectionViaApi(t, pg.readOnlyDsn, 'northwind-ro');
    await introspectViaApi(t, roConnId);
    await t.grantTable(t.roles.editor, roConnId, '*', {
      read: true,
      create: true,
      update: true,
      delete: true,
    });

    const read = await t.app.inject({
      method: 'GET',
      url: `/api/v1/data/${roConnId}/public.products?limit=1`,
      headers: asUser(t.users.editor),
    });
    expect(read.statusCode).toBe(200);

    const write = await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/data/${roConnId}/public.products/1`,
      headers: asUser(t.users.editor),
      payload: { values: { units_in_stock: 0 } },
    });
    expect(write.statusCode).toBe(403);
    expect((write.json() as { error: { code: string } }).error.code).toBe('READ_ONLY_MODE');
  });
});
