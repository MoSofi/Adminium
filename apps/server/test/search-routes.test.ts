// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `GET /api/v1/search` (08-server-api.md §2.9, M4-T06) over the fake-adapter
 * harness registered as a SQLITE engine — so the record search exercises the
 * real `LOWER(...) LIKE LOWER(...)` lowering of `compileILike` against a real
 * BetterSqlite3 engine (the same dialect seam the crud `q=` search uses; the
 * live-PG `ILIKE` variant lives in the companion suite below).
 *
 * What this pins:
 *  - grants filter results: no `table:<conn>:<t>:read` → that table's hits
 *    NEVER appear; no `page:<id>:view` → neither the page hit nor the record
 *    group backed by that page appear;
 *  - PII: masked columns neither match nor label hits — for ANY caller,
 *    including unmask-grant holders (the search context pins canReadPii=false);
 *  - reply shape: grouped, capped counts, per-table record groups carrying the
 *    navigable pageSlug, labels from the classifier's displayColumn.
 */

import BetterSqlite3 from 'better-sqlite3';
import { SqliteDialect } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pagesRepo, permissionsRepo } from '@adminium/meta';

import {
  AdapterRegistry,
  adapterCapabilitiesSchema,
  parseDatabaseModel,
  type AdapterProvider,
  type DatabaseAdapter,
  type DatabaseModel,
} from '@adminium/engine/adapter';

import { providerFromModule } from '../src/connections/register-adapters.js';
import { searchRoutes } from '../src/routes/search/index.js';
import type { SearchGroup, SearchRecordGroup } from '../src/routes/search/schema.js';
import {
  asUser,
  buildDataTestApp,
  createConnectionViaApi,
  createNorthwindDb,
  introspectViaApi,
  pgAvailable,
  type DataTestContext,
  type TestPg,
} from './connections-helpers.js';

// --- fake sqlite-engine source database (crud-e2e's shape, sqlite dialect) ----

function seedSqlite(): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:');
  db.exec(`
    CREATE TABLE products (
      product_id INTEGER PRIMARY KEY,
      product_name TEXT NOT NULL,
      unit_price REAL,
      units_in_stock INTEGER
    );
    CREATE TABLE customers (
      customer_id TEXT PRIMARY KEY,
      company_name TEXT NOT NULL,
      phone TEXT
    );
    CREATE TABLE orders (
      order_id INTEGER PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customers(customer_id),
      status TEXT
    );
    INSERT INTO products VALUES
      (1, 'Chai', 18, 39), (2, 'Chang', 19, 17), (3, 'Aniseed Syrup', 10, 13),
      (4, 'Ikura', 31, 31), (5, 'Tofu', 23.25, 35);
    INSERT INTO customers VALUES
      ('ALFKI', 'Alfreds Futterkiste', '030-0074321'),
      ('ANATR', 'Ana Trujillo', '(5) 555-4729');
    INSERT INTO orders VALUES
      (100, 'ALFKI', 'shipped'), (101, 'ALFKI', 'pending'), (102, 'ANATR', 'shipped');
  `);
  return db;
}

function fakeModel(): DatabaseModel {
  return parseDatabaseModel({
    dialect: 'sqlite',
    name: 'fakedb',
    defaultSchema: 'main',
    schemas: ['main'],
    tables: [
      {
        schema: 'main',
        name: 'products',
        primaryKey: ['product_id'],
        columns: [
          { name: 'product_id', logicalType: 'integer', nullable: false, isPrimaryKey: true },
          { name: 'product_name', logicalType: 'varchar', nullable: false },
          { name: 'unit_price', logicalType: 'decimal', nullable: true },
          { name: 'units_in_stock', logicalType: 'integer', nullable: true },
        ],
      },
      {
        schema: 'main',
        name: 'customers',
        primaryKey: ['customer_id'],
        columns: [
          { name: 'customer_id', logicalType: 'varchar', nullable: false, isPrimaryKey: true },
          { name: 'company_name', logicalType: 'varchar', nullable: false },
          { name: 'phone', logicalType: 'varchar', nullable: true },
        ],
      },
      {
        schema: 'main',
        name: 'orders',
        primaryKey: ['order_id'],
        columns: [
          { name: 'order_id', logicalType: 'integer', nullable: false, isPrimaryKey: true },
          {
            name: 'customer_id',
            logicalType: 'varchar',
            nullable: false,
            references: { tableId: 'main.customers', column: 'customer_id' },
          },
          { name: 'status', logicalType: 'varchar', nullable: true },
        ],
      },
    ],
    relations: [
      {
        id: 'fk_orders_customers',
        kind: 'declared-fk',
        cardinality: 'one-to-many',
        from: { tableId: 'main.orders', columns: ['customer_id'] },
        to: { tableId: 'main.customers', columns: ['customer_id'] },
      },
    ],
  });
}

function makeFakeSqliteRegistry(sqlite: BetterSqlite3.Database): AdapterRegistry<AdapterProvider> {
  const capabilities = adapterCapabilitiesSchema.parse({});
  const makeAdapter = (role: string): DatabaseAdapter =>
    ({
      dialect: 'sqlite',
      capabilities,
      role,
      connect: async () => undefined,
      test: async () => ({
        ok: true,
        latencyMs: 1,
        serverVersion: 'FakeSQLite 1.0',
        currentUser: 'fake',
        canWrite: true,
        ssl: false,
      }),
      probeCapabilities: async () => ({
        capabilities,
        privileges: { canReadSchema: true, canRead: true, canWrite: true, canDDL: true },
        serverVersion: 'FakeSQLite 1.0',
        currentRole: { name: 'fake', readOnly: false },
      }),
      introspect: async () => fakeModel(),
      count: async () => ({ value: 0, capped: false }),
      sample: async () => [],
      query: async () => ({ rows: [], columns: [] }),
      mutate: async () => ({ affected: 0, returning: null }),
      close: async () => undefined,
    }) as unknown as DatabaseAdapter;

  const registry = new AdapterRegistry<AdapterProvider>();
  registry.register({
    dialect: 'sqlite',
    create: (config) => makeAdapter(config.role) as never,
    createQueryEngine: () => ({
      dialect: new SqliteDialect({ database: sqlite }),
      identifiers: { quote: (identifier: string) => `"${identifier}"`, maxLength: 63 },
      serializers: {},
      destroy: async () => undefined,
    }),
  });
  return registry;
}

type SearchBody = { data: { groups: SearchGroup[] } };

function recordGroups(body: SearchBody): SearchRecordGroup[] {
  return body.data.groups.filter((g): g is SearchRecordGroup => g.type === 'record');
}

function groupFor(body: SearchBody, table: string): SearchRecordGroup | undefined {
  return recordGroups(body).find((g) => g.table === table);
}

describe('GET /api/v1/search (fake sqlite engine)', () => {
  let t: DataTestContext;
  let connId: string;
  let pageIds: { customers: string; products: string; orders: string };

  const search = async (q: string, user = t.users.viewer, extra = '') => {
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/v1/search?q=${encodeURIComponent(q)}${extra}`,
      headers: asUser(user),
    });
    return { status: res.statusCode, body: res.json() as SearchBody };
  };

  beforeAll(async () => {
    t = await buildDataTestApp({
      registry: makeFakeSqliteRegistry(seedSqlite()),
      extraRoutes: async (api, ctx) => {
        await api.register(searchRoutes({ manager: ctx.manager as never, meta: ctx.meta }));
      },
    });
    // Engine `sqlite` so `manager.data()` reports the sqlite dialect and the
    // quick-search compiles the LOWER(...) LIKE LOWER(...) lowering.
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/connections',
      headers: asUser(t.users.admin),
      payload: { name: 'fakedb', engine: 'sqlite', dsn: 'sqlite:fake.db' },
    });
    expect(res.statusCode).toBe(201);
    connId = (res.json() as { id: string }).id;
    await introspectViaApi(t, connId);

    // One page per table — the page's slug is the record hit's nav target.
    const pages = pagesRepo(t.meta);
    const envelope = (id: string, table: string) => ({
      v: 1,
      kind: 'page',
      id,
      template: 'page-crud',
      source: { connectionId: connId, table },
      config: {},
    });
    const customersPage = await pages.create({
      connectionId: connId,
      slug: 'customers',
      type: 'page-crud',
      title: 'Customers',
      config: envelope('page_customers', 'main.customers'),
    });
    const productsPage = await pages.create({
      connectionId: connId,
      slug: 'products',
      type: 'page-crud',
      title: 'Products',
      config: envelope('page_products', 'main.products'),
    });
    const ordersPage = await pages.create({
      connectionId: connId,
      slug: 'orders',
      type: 'page-crud',
      title: 'Orders',
      config: envelope('page_orders', 'main.orders'),
    });
    pageIds = { customers: customersPage.id, products: productsPage.id, orders: ordersPage.id };

    const permissions = permissionsRepo(t.meta);
    // admin: everything.
    await t.grantTable(t.roles.admin, connId, '*', { read: true });
    for (const id of Object.values(pageIds)) {
      await permissions.grant(t.roles.admin.id, 'page', id, { view: true, edit: false });
    }
    // viewer: reads every table, but may NOT view the orders page.
    await t.grantTable(t.roles.viewer, connId, '*', { read: true });
    await permissions.grant(t.roles.viewer.id, 'page', pageIds.customers, { view: true, edit: false });
    await permissions.grant(t.roles.viewer.id, 'page', pageIds.products, { view: true, edit: false });
    // editor: views customers+products pages but reads ONLY main.customers.
    await t.grantTable(t.roles.editor, connId, 'main.customers', { read: true });
    await permissions.grant(t.roles.editor.id, 'page', pageIds.customers, { view: true, edit: false });
    await permissions.grant(t.roles.editor.id, 'page', pageIds.products, { view: true, edit: false });
  });

  afterAll(async () => {
    await t.app.close();
  });

  it('401s without a principal and 422s below the 2-char minimum', async () => {
    const anon = await t.app.inject({ method: 'GET', url: '/api/v1/search?q=cha' });
    expect(anon.statusCode).toBe(401);

    // Schema validation maps to the §1.4 envelope's 422 VALIDATION_FAILED.
    const short = await t.app.inject({
      method: 'GET',
      url: '/api/v1/search?q=c',
      headers: asUser(t.users.viewer),
    });
    expect(short.statusCode).toBe(422);
  });

  it('returns record hits with displayColumn labels, pageSlug, and recordId', async () => {
    const { status, body } = await search('cha');
    expect(status).toBe(200);
    const products = groupFor(body, 'main.products');
    expect(products).toBeDefined();
    expect(products?.pageSlug).toBe('products');
    expect(products?.count).toBe(2);
    expect(products?.hits.map((h) => h.label)).toEqual(['Chai', 'Chang']);
    expect(products?.hits.map((h) => h.recordId)).toEqual(['1', '2']);
    expect(products?.hits[0]).toMatchObject({
      connectionId: connId,
      table: 'main.products',
      pageSlug: 'products',
    });
  });

  it('ships §2.9 row context from readable non-label columns — never masked ones', async () => {
    // products: beyond the PK and the label, the two readable scalar columns
    // are unit_price + units_in_stock — exactly the context pair, in order.
    const { body } = await search('chai');
    const hit = groupFor(body, 'main.products')?.hits[0];
    expect(hit?.label).toBe('Chai');
    expect(hit?.context).toBe('unit_price 18 · units_in_stock 39');

    // customers: the only non-label, non-PK column is the PII-masked phone.
    // Masked columns never surface in context (§5.3) — not even for a caller
    // holding the unmask grant — so the field is omitted entirely.
    const named = await search('alfreds', t.users.admin);
    const customer = groupFor(named.body, 'main.customers')?.hits[0];
    expect(customer?.label).toBe('Alfreds Futterkiste');
    expect(customer?.context).toBeUndefined();
  });

  it('matches case-insensitively via the sqlite LOWER(...) LIKE lowering', async () => {
    const upper = await search('CHAI');
    expect(groupFor(upper.body, 'main.products')?.hits.map((h) => h.label)).toEqual(['Chai']);

    const mixed = await search('aLfReDs');
    expect(groupFor(mixed.body, 'main.customers')?.hits.map((h) => h.label)).toEqual([
      'Alfreds Futterkiste',
    ]);
  });

  it('NEVER returns hits from tables the caller lacks table:read on', async () => {
    // editor reads only main.customers — 'cha' matches products rows for
    // others, but the editor's reply must not contain a products group.
    const { body } = await search('cha', t.users.editor);
    expect(groupFor(body, 'main.products')).toBeUndefined();
    expect(recordGroups(body)).toHaveLength(0);

    // …while the same grant still surfaces the tables they CAN read.
    const readable = await search('alfreds', t.users.editor);
    expect(groupFor(readable.body, 'main.customers')?.hits.map((h) => h.label)).toEqual([
      'Alfreds Futterkiste',
    ]);
  });

  it('drops record groups whose backing page the caller cannot view', async () => {
    // viewer has table read on '*', but no page:view on the orders page — a
    // hit there would navigate into a 403, so it must not exist.
    const { body } = await search('shipped');
    expect(groupFor(body, 'main.orders')).toBeUndefined();

    // admin (page view granted) sees the same query hit orders.
    const admin = await search('shipped', t.users.admin);
    expect(groupFor(admin.body, 'main.orders')?.count).toBe(2);
  });

  it('PII-masked columns never match nor label hits — for any caller (§5.3)', async () => {
    // `phone` is auto-masked by the introspection PII scan. Its VALUES must
    // not be reachable through search…
    const viewer = await search('0074321');
    expect(recordGroups(viewer.body)).toHaveLength(0);

    // …not even for a caller holding the unmask grant (admin holds
    // system:connections:manage): search pins canReadPii=false because
    // labels outlive the request in the palette's Recent list.
    const admin = await search('0074321', t.users.admin);
    expect(recordGroups(admin.body)).toHaveLength(0);

    // And no hit label is ever a phone value.
    const named = await search('alfreds', t.users.admin);
    const labels = recordGroups(named.body).flatMap((g) => g.hits.map((h) => h.label));
    expect(labels).toEqual(['Alfreds Futterkiste']);
  });

  it('matches pages by title, filtered by the page:view grant', async () => {
    const viewer = await search('orders');
    const viewerPages = viewer.body.data.groups.find((g) => g.type === 'page');
    expect(viewerPages?.hits).toEqual([]); // viewer may not view the orders page

    const admin = await search('orders', t.users.admin);
    const adminPages = admin.body.data.groups.find((g) => g.type === 'page');
    expect(adminPages?.count).toBe(1);
    expect(adminPages?.hits[0]).toMatchObject({ slug: 'orders', title: 'Orders' });
  });

  it('honors limit per group and the types filter', async () => {
    const limited = await search('cha', t.users.viewer, '&limit=1');
    expect(groupFor(limited.body, 'main.products')?.hits).toHaveLength(1);
    expect(groupFor(limited.body, 'main.products')?.count).toBe(1);

    const pagesOnly = await search('cha', t.users.viewer, '&types=page');
    expect(recordGroups(pagesOnly.body)).toHaveLength(0);
    expect(pagesOnly.body.data.groups.some((g) => g.type === 'page')).toBe(true);

    const recordsOnly = await search('customers', t.users.viewer, '&types=record');
    expect(recordsOnly.body.data.groups.some((g) => g.type === 'page')).toBe(false);
  });

  it('restricts record search via connectionId / tables filters', async () => {
    const wrongConn = await search('cha', t.users.viewer, '&connectionId=conn_nope');
    expect(recordGroups(wrongConn.body)).toHaveLength(0);

    const onlyCustomers = await search('an', t.users.viewer, '&tables=main.customers');
    expect(recordGroups(onlyCustomers.body).map((g) => g.table)).toEqual(['main.customers']);
  });
});

// --- live PG: the native ILIKE path over Northwind ----------------------------

const adapterReady = await (async () => {
  try {
    return providerFromModule(await import('@adminium/adapter-postgres')) !== null;
  } catch {
    return false;
  }
})();

describe.skipIf(!(adapterReady && pgAvailable()))('GET /api/v1/search (live PG, Northwind)', () => {
  let pg: TestPg;
  let t: DataTestContext;
  let connId: string;

  beforeAll(async () => {
    pg = createNorthwindDb();
    t = await buildDataTestApp({
      extraRoutes: async (api, ctx) => {
        await api.register(searchRoutes({ manager: ctx.manager as never, meta: ctx.meta }));
      },
    });
    connId = await createConnectionViaApi(t, pg.dsn);
    await introspectViaApi(t, connId);
    await t.grantTable(t.roles.viewer, connId, '*', { read: true });
    const page = await pagesRepo(t.meta).create({
      connectionId: connId,
      slug: 'customers',
      type: 'page-crud',
      title: 'Customers',
      config: {
        v: 1,
        kind: 'page',
        id: 'page_customers',
        template: 'page-crud',
        source: { connectionId: connId, table: 'public.customers' },
        config: {},
      },
    });
    await permissionsRepo(t.meta).grant(t.roles.viewer.id, 'page', page.id, {
      view: true,
      edit: false,
    });
  });

  afterAll(async () => {
    await t.app.close();
    pg.drop();
  });

  it('matches case-insensitively via native ILIKE and maps the record route', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/v1/search?q=CACTUS',
      headers: asUser(t.users.viewer),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as SearchBody;
    const customers = groupFor(body, 'public.customers');
    expect(customers?.pageSlug).toBe('customers');
    expect(customers?.hits.map((h) => h.label)).toEqual(['Cactus Comidas para llevar']);
    expect(customers?.hits[0]?.recordId).toBe('CACTU');
  });
});
