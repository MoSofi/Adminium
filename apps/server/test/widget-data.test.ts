/**
 * Live widget-data API suite against real PostgreSQL + the real postgres
 * adapter, seeded with the Northwind fixture (04-widget-registry.md §5.2).
 * Skips (green) when psql, the fixture, or the adapter is unavailable.
 *
 * Covers the M4 acceptance slice: monthly revenue timeseries over
 * `orders.freight` (values cross-checked with psql), customer counts,
 * categorical breakdowns, record-list envelopes with PII masking, RBAC
 * table denial, PII column refusal, single-round-trip `/batch` with
 * per-item error isolation, and the 30 s response cache.
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

interface QueryReply {
  result: Record<string, unknown>;
  cached: boolean;
}

describe.skipIf(!AVAILABLE)('widget-data API (live PG, Northwind)', () => {
  let pg: TestPg;
  let t: DataTestContext;
  let connId: string;

  function ordersDescriptor(extra: Record<string, unknown>): Record<string, unknown> {
    return {
      connectionId: connId,
      source: { name: 'orders', schema: 'public' },
      ...extra,
    };
  }

  async function query(
    descriptor: Record<string, unknown>,
    user = t.users.viewer,
  ): Promise<{ statusCode: number; body: QueryReply }> {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/widget-data/query',
      headers: asUser(user),
      payload: { descriptor },
    });
    return { statusCode: res.statusCode, body: res.json() as QueryReply };
  }

  beforeAll(async () => {
    pg = createNorthwindDb();
    t = await buildDataTestApp();
    connId = await createConnectionViaApi(t, pg.dsn);
    await introspectViaApi(t, connId);
    await t.grantTable(t.roles.admin, connId, '*', { read: true });
    // Viewer: orders + customers only — products stays denied for RBAC tests.
    await t.grantTable(t.roles.viewer, connId, 'public.orders', { read: true });
    await t.grantTable(t.roles.viewer, connId, 'public.customers', { read: true });
  }, 120_000);

  afterAll(async () => {
    await t.app.close();
    pg.drop();
  });

  it('computes revenue (sum of freight) by month as a timeseries, matching psql', async () => {
    const { statusCode, body } = await query(
      ordersDescriptor({
        shape: 'timeseries',
        aggregations: [{ fn: 'sum', column: 'freight', alias: 'revenue' }],
        bucket: { column: 'order_date', unit: 'month' },
      }),
    );
    expect(statusCode).toBe(200);
    const result = body.result as unknown as { shape: string; points: { t: string; v: number }[] };
    expect(result.shape).toBe('timeseries');

    const expectedMonths = Number(
      psql(pg.database, "SELECT count(DISTINCT date_trunc('month', order_date)) FROM orders").trim(),
    );
    expect(result.points.length).toBe(expectedMonths);

    // First ascending bucket's revenue — compared by position, not by month
    // string, so driver timestamp-parsing timezones cannot skew the test.
    const first = result.points[0]!;
    const expectedFirst = Number(
      psql(
        pg.database,
        `SELECT round(sum(freight)::numeric, 2) FROM orders GROUP BY date_trunc('month', order_date) ORDER BY date_trunc('month', order_date) LIMIT 1`,
      ).trim(),
    );
    expect(first.v).toBeCloseTo(expectedFirst, 1);
    // Buckets arrive in ascending time order.
    const ts = result.points.map((p) => new Date(p.t).getTime());
    expect([...ts].sort((a, b) => a - b)).toEqual(ts);
  });

  it('counts customers as a single-metric envelope', async () => {
    const { statusCode, body } = await query({
      connectionId: connId,
      source: { name: 'customers', schema: 'public' },
      shape: 'single-metric',
      aggregations: [{ fn: 'count', alias: 'total' }],
    });
    expect(statusCode).toBe(200);
    const expected = Number(psql(pg.database, 'SELECT count(*) FROM customers').trim());
    expect(body.result).toMatchObject({ shape: 'single-metric', value: expected });
  });

  it('groups orders per customer as categorical items with a total', async () => {
    const { statusCode, body } = await query(
      ordersDescriptor({
        shape: 'categorical',
        aggregations: [{ fn: 'count', alias: 'orders' }],
        groupBy: ['customer_id'],
        limit: 5,
      }),
    );
    expect(statusCode).toBe(200);
    const result = body.result as unknown as {
      shape: string;
      items: { key: string; value: number }[];
    };
    expect(result.shape).toBe('categorical');
    expect(result.items.length).toBe(5);
    // Compiler orders buckets by value desc — the first is the top customer.
    const top = psql(
      pg.database,
      'SELECT customer_id FROM orders GROUP BY customer_id ORDER BY count(*) DESC, customer_id LIMIT 1',
    ).trim();
    const values = result.items.map((i) => i.value);
    expect([...values].sort((a, b) => b - a)).toEqual(values);
    expect(result.items.map((i) => i.key)).toContain(top);
  });

  it('returns record-list envelopes with column metadata and PII masking', async () => {
    const { statusCode, body } = await query({
      connectionId: connId,
      source: { name: 'customers', schema: 'public' },
      shape: 'record-list',
      orderBy: [{ column: 'customer_id', dir: 'asc' }],
      limit: 3,
    });
    expect(statusCode).toBe(200);
    const result = body.result as unknown as {
      shape: string;
      rows: Record<string, unknown>[];
      columns: { name: string }[];
      total: number;
    };
    expect(result.shape).toBe('record-list');
    expect(result.rows.length).toBe(3);
    expect(result.total).toBe(Number(psql(pg.database, 'SELECT count(*) FROM customers').trim()));
    expect(result.columns.map((c) => c.name)).toContain('customer_id');
    // The classifier auto-masks customers.phone — viewers get null + marker.
    expect(result.rows[0]!.phone).toBeNull();
    expect(result.rows[0]!._masked).toContain('phone');
  });

  it('denies tables outside the caller grants with 403 TABLE_FORBIDDEN', async () => {
    const { statusCode, body } = await query({
      connectionId: connId,
      source: { name: 'products', schema: 'public' },
      shape: 'single-metric',
      aggregations: [{ fn: 'count', alias: 'n' }],
    });
    expect(statusCode).toBe(403);
    expect((body as unknown as { error: { code: string } }).error.code).toBe('TABLE_FORBIDDEN');
  });

  it('refuses PII-masked columns in aggregations with 403 COLUMN_FORBIDDEN; admin may aggregate', async () => {
    const descriptor = {
      connectionId: connId,
      source: { name: 'customers', schema: 'public' },
      shape: 'single-metric',
      aggregations: [{ fn: 'count_distinct', column: 'phone', alias: 'phones' }],
    };
    const denied = await query(descriptor);
    expect(denied.statusCode).toBe(403);
    expect((denied.body as unknown as { error: { code: string } }).error.code).toBe('COLUMN_FORBIDDEN');

    const allowed = await query(descriptor, t.users.admin);
    expect(allowed.statusCode).toBe(200);
    expect((allowed.body.result as { value: number }).value).toBeGreaterThan(0);
  });

  it('rejects unknown identifiers with 422 UNKNOWN_IDENTIFIER', async () => {
    const { statusCode, body } = await query(
      ordersDescriptor({
        shape: 'single-metric',
        aggregations: [{ fn: 'sum', column: 'no_such_column', alias: 'x' }],
      }),
    );
    expect(statusCode).toBe(422);
    expect((body as unknown as { error: { code: string } }).error.code).toBe('UNKNOWN_IDENTIFIER');
  });

  it('resolves a dashboard batch in one round trip with per-item error isolation', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/widget-data/batch',
      headers: asUser(t.users.viewer),
      payload: {
        requests: [
          {
            instanceId: 'kpi-orders',
            descriptor: ordersDescriptor({
              shape: 'single-metric',
              aggregations: [{ fn: 'count', alias: 'n' }],
            }),
          },
          {
            instanceId: 'hero-revenue',
            descriptor: ordersDescriptor({
              shape: 'timeseries',
              aggregations: [{ fn: 'sum', column: 'freight', alias: 'revenue' }],
              bucket: { column: 'order_date', unit: 'month' },
            }),
          },
          {
            // Denied table — must fail alone, not the whole batch.
            instanceId: 'forbidden-products',
            descriptor: {
              connectionId: connId,
              source: { name: 'products', schema: 'public' },
              shape: 'single-metric',
              aggregations: [{ fn: 'count', alias: 'n' }],
            },
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const { results } = res.json() as {
      results: Record<string, { ok: boolean; result?: { shape: string }; error?: { code: string } }>;
    };
    expect(results['kpi-orders']!.ok).toBe(true);
    expect(results['kpi-orders']!.result!.shape).toBe('single-metric');
    expect(results['hero-revenue']!.ok).toBe(true);
    expect(results['hero-revenue']!.result!.shape).toBe('timeseries');
    expect(results['forbidden-products']!.ok).toBe(false);
    expect(results['forbidden-products']!.error!.code).toBe('TABLE_FORBIDDEN');
  });

  it('serves repeated identical descriptors from the cache within the TTL', async () => {
    const descriptor = ordersDescriptor({
      shape: 'single-metric',
      aggregations: [{ fn: 'max', column: 'freight', alias: 'top' }],
    });
    const first = await query(descriptor);
    expect(first.statusCode).toBe(200);
    expect(first.body.cached).toBe(false);
    const second = await query(descriptor);
    expect(second.body.cached).toBe(true);
    expect(second.body.result).toEqual(first.body.result);

    // Mutation invalidation hook: dropping the table's entries misses next time.
    t.widgetCache.invalidateTable(connId, 'public.orders');
    const third = await query(descriptor);
    expect(third.body.cached).toBe(false);
  });

  it('requires authentication (401 without a principal)', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/widget-data/query',
      payload: {
        descriptor: ordersDescriptor({
          shape: 'single-metric',
          aggregations: [{ fn: 'count', alias: 'n' }],
        }),
      },
    });
    expect(res.statusCode).toBe(401);
  });
});
