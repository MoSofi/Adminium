// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Full-stack CRUD API suite over a FAKE adapter provider (SQLite-backed
 * QueryEngine behind an in-process AdapterProvider). Runs everywhere — no
 * PostgreSQL needed — and exercises the complete HTTP path: connection
 * create → introspect (classify + auto-PII) → snapshot-allowlisted CRUD,
 * keyset pagination, per-table RBAC, PII masking, references preflight,
 * bulk ops, and the undo-token pattern end to end.
 *
 * Dialect-specific behavior (ILIKE quick search, PG constraint mapping,
 * read-only-role probes) lives in crud.test.ts / connections.test.ts
 * against real PostgreSQL.
 */

import BetterSqlite3 from 'better-sqlite3';
import { SqliteDialect } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  AdapterRegistry,
  adapterCapabilitiesSchema,
  parseDatabaseModel,
  type AdapterProvider,
  type DatabaseAdapter,
  type DatabaseModel,
} from '@adminium/engine/adapter';

import {
  asUser,
  buildDataTestApp,
  createConnectionViaApi,
  introspectViaApi,
  type DataTestContext,
} from './connections-helpers.js';

// --- fake source database ----------------------------------------------------

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
    dialect: 'postgres',
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

function makeFakeRegistry(sqlite: BetterSqlite3.Database): AdapterRegistry<AdapterProvider> {
  const capabilities = adapterCapabilitiesSchema.parse({});
  const makeAdapter = (role: string): DatabaseAdapter =>
    ({
      dialect: 'postgres',
      capabilities,
      role,
      connect: async () => undefined,
      test: async () => ({
        ok: true,
        latencyMs: 1,
        serverVersion: 'FakeSQL 1.0',
        currentUser: 'fake',
        canWrite: true,
        ssl: false,
      }),
      probeCapabilities: async () => ({
        capabilities,
        privileges: { canReadSchema: true, canRead: true, canWrite: true, canDDL: true },
        serverVersion: 'FakeSQL 1.0',
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
    dialect: 'postgres',
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

// --- suite --------------------------------------------------------------------

describe('CRUD API end-to-end (fake adapter)', () => {
  let t: DataTestContext;
  let connId: string;
  let clock: { now: number };

  beforeAll(async () => {
    clock = { now: Date.now() };
    t = await buildDataTestApp({
      registry: makeFakeRegistry(seedSqlite()),
      now: () => clock.now,
    });
    connId = await createConnectionViaApi(t, 'postgres://fake@fake-host:5432/fakedb');
    const result = await introspectViaApi(t, connId);
    expect(result.noop).toBe(false);
    // phone classified as PII → auto-proposed column.pii mask (05 §7.2)
    expect(result.proposedMasks).toBeGreaterThan(0);

    // Grants: admin full table access; viewer reads everything; editor works
    // products (+ limited customers) only.
    await t.grantTable(t.roles.admin, connId, '*', {
      read: true,
      create: true,
      update: true,
      delete: true,
    });
    await t.grantTable(t.roles.viewer, connId, '*', { read: true });
    await t.grantTable(t.roles.editor, connId, 'main.products', {
      read: true,
      create: true,
      update: true,
      delete: true,
    });
    await t.grantTable(t.roles.editor, connId, 'main.customers', {
      read: true,
      create: true,
      delete: true,
    });
  });

  afterAll(async () => {
    await t.app.close();
  });

  const list = async (
    url: string,
    user = t.users.viewer,
  ): Promise<{ status: number; body: { data: Record<string, unknown>[]; page?: { total: number | null }; cursor?: { next: string | null } } }> => {
    const res = await t.app.inject({ method: 'GET', url, headers: asUser(user) });
    return { status: res.statusCode, body: res.json() };
  };

  it('lists with filters, sorting, and exact counts', async () => {
    const all = await list(`/api/v1/data/${connId}/main.products`);
    expect(all.status).toBe(200);
    expect(all.body.data).toHaveLength(5);
    expect(all.body.page?.total).toBe(5);

    const where = encodeURIComponent(
      JSON.stringify({
        and: [
          { column: 'unit_price', op: 'gte', value: 18 },
          { column: 'product_name', op: 'neq', value: 'Chang' },
        ],
      }),
    );
    const filtered = await list(
      `/api/v1/data/${connId}/main.products?where=${where}&order=unit_price.desc`,
    );
    expect(filtered.body.data.map((row) => row.product_name)).toEqual(['Ikura', 'Tofu', 'Chai']);
    expect(filtered.body.page?.total).toBe(3);
  });

  it('serves count=estimated as the exact fallback when statistics refuse', async () => {
    // sqlite has no catalog statistics, and the filtered variant can never use
    // table-level statistics — both must degrade to the exact count, not 500.
    const estimated = await list(`/api/v1/data/${connId}/main.products?count=estimated`);
    expect(estimated.status).toBe(200);
    expect(estimated.body.page?.total).toBe(5);

    const where = encodeURIComponent(
      JSON.stringify({ and: [{ column: 'unit_price', op: 'gte', value: 18 }] }),
    );
    const filtered = await list(
      `/api/v1/data/${connId}/main.products?count=estimated&where=${where}`,
    );
    expect(filtered.status).toBe(200);
    expect(filtered.body.page?.total).toBe(4);

    const none = await list(`/api/v1/data/${connId}/main.products?count=none`);
    expect(none.body.page?.total).toBeNull();
  });

  it('paginates by keyset cursor, consistent with the sort and disjoint across pages', async () => {
    const page1 = await list(
      `/api/v1/data/${connId}/main.products?order=unit_price.desc&limit=2&cursor=`,
    );
    expect(page1.body.data.map((row) => row.product_name)).toEqual(['Ikura', 'Tofu']);
    const next = page1.body.cursor?.next;
    expect(next).toBeTruthy();

    const page2 = await list(
      `/api/v1/data/${connId}/main.products?order=unit_price.desc&limit=2&cursor=${encodeURIComponent(next as string)}`,
    );
    expect(page2.body.data.map((row) => row.product_name)).toEqual(['Chang', 'Chai']);

    const page3 = await list(
      `/api/v1/data/${connId}/main.products?order=unit_price.desc&limit=2&cursor=${encodeURIComponent(page2.body.cursor?.next as string)}`,
    );
    expect(page3.body.data.map((row) => row.product_name)).toEqual(['Aniseed Syrup']);
    expect(page3.body.cursor?.next).toBeNull();
  });

  it('rejects unknown/hostile identifiers with 422 UNKNOWN_IDENTIFIER', async () => {
    const badTable = await list(`/api/v1/data/${connId}/${encodeURIComponent('products; DROP TABLE x')}`);
    expect(badTable.status).toBe(422);

    const badColumn = await list(
      `/api/v1/data/${connId}/main.products?order=${encodeURIComponent('nope.asc')}`,
    );
    expect(badColumn.status).toBe(422);
  });

  it('masks PII columns for non-privileged readers and refuses masked selects (§5.3)', async () => {
    const viewerRows = await list(`/api/v1/data/${connId}/main.customers`);
    expect(viewerRows.status).toBe(200);
    const alfki = viewerRows.body.data.find((row) => row.customer_id === 'ALFKI')!;
    expect(alfki.phone).toBeNull();
    expect(alfki._masked).toContain('phone');

    const select = await list(`/api/v1/data/${connId}/main.customers?select=phone`);
    expect(select.status).toBe(403);

    const where = encodeURIComponent(JSON.stringify({ column: 'phone', op: 'eq', value: 'x' }));
    const filter = await list(`/api/v1/data/${connId}/main.customers?where=${where}`);
    expect(filter.status).toBe(403);

    // system:connections:manage holders unmask (admin).
    const adminRows = await list(`/api/v1/data/${connId}/main.customers`, t.users.admin);
    const adminAlfki = adminRows.body.data.find((row) => row.customer_id === 'ALFKI')!;
    expect(adminAlfki.phone).toBe('030-0074321');
    expect(adminAlfki._masked).toBeUndefined();
  });

  it('enforces per-table RBAC after identifier resolution (§5.2)', async () => {
    // Viewer holds read only → writes are TABLE_FORBIDDEN.
    const write = await t.app.inject({
      method: 'POST',
      url: `/api/v1/data/${connId}/main.products`,
      headers: asUser(t.users.viewer),
      payload: { values: { product_id: 50, product_name: 'Nope' } },
    });
    expect(write.statusCode).toBe(403);
    expect((write.json() as { error: { code: string } }).error.code).toBe('TABLE_FORBIDDEN');

    // Editor has no grant on orders at all.
    const denied = await t.app.inject({
      method: 'GET',
      url: `/api/v1/data/${connId}/main.orders`,
      headers: asUser(t.users.editor),
    });
    expect(denied.statusCode).toBe(403);
  });

  it('GET record + inboundCounts and the references preflight', async () => {
    const record = await t.app.inject({
      method: 'GET',
      url: `/api/v1/data/${connId}/main.customers/ALFKI?include=inboundCounts`,
      headers: asUser(t.users.viewer),
    });
    expect(record.statusCode).toBe(200);
    const body = record.json() as {
      data: Record<string, unknown>;
      inboundCounts: { table: string; count: number }[];
    };
    expect(body.data.company_name).toBe('Alfreds Futterkiste');
    expect(body.inboundCounts).toEqual([
      { relationId: 'fk_orders_customers', table: 'main.orders', column: 'customer_id', count: 2 },
    ]);

    const refs = await t.app.inject({
      method: 'GET',
      url: `/api/v1/data/${connId}/main.customers/ALFKI/references`,
      headers: asUser(t.users.viewer),
    });
    expect((refs.json() as { references: { count: number }[] }).references[0]?.count).toBe(2);

    const missing = await t.app.inject({
      method: 'GET',
      url: `/api/v1/data/${connId}/main.customers/NOPE1`,
      headers: asUser(t.users.viewer),
    });
    expect(missing.statusCode).toBe(404);
  });

  it('create → undo deletes the inserted row', async () => {
    const created = await t.app.inject({
      method: 'POST',
      url: `/api/v1/data/${connId}/main.products`,
      headers: asUser(t.users.editor),
      payload: { values: { product_id: 60, product_name: 'Undo Me', unit_price: 5 } },
    });
    expect(created.statusCode).toBe(201);
    const { data, undoToken } = created.json() as {
      data: Record<string, unknown>;
      undoToken: string;
    };
    expect(data.product_name).toBe('Undo Me');
    expect(undoToken).toMatch(/^undo_/);

    const undo = await t.app.inject({
      method: 'POST',
      url: `/api/v1/data/undo/${undoToken}`,
      headers: asUser(t.users.editor),
      payload: {},
    });
    expect(undo.statusCode).toBe(200);

    const gone = await t.app.inject({
      method: 'GET',
      url: `/api/v1/data/${connId}/main.products/60`,
      headers: asUser(t.users.editor),
    });
    expect(gone.statusCode).toBe(404);
  });

  it('update → undo restores the exact before-image; hostile value keys are 422', async () => {
    const bad = await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/data/${connId}/main.products/1`,
      headers: asUser(t.users.editor),
      payload: { values: { 'unit_price"; DROP TABLE products; --': 1 } },
    });
    expect(bad.statusCode).toBe(422);

    const updated = await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/data/${connId}/main.products/1`,
      headers: asUser(t.users.editor),
      payload: { values: { unit_price: 99.5 } },
    });
    expect(updated.statusCode).toBe(200);
    const { data, undoToken } = updated.json() as {
      data: Record<string, unknown>;
      undoToken: string;
    };
    expect(data.unit_price).toBe(99.5);

    // Only the issuing user may undo (§2.7.3 step 4).
    const wrongUser = await t.app.inject({
      method: 'POST',
      url: `/api/v1/data/undo/${undoToken}`,
      headers: asUser(t.users.admin),
      payload: {},
    });
    expect(wrongUser.statusCode).toBe(403);
    // The token is single-use — re-issue by repeating the mutation.
    const again = await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/data/${connId}/main.products/1`,
      headers: asUser(t.users.editor),
      payload: { values: { unit_price: 42 } },
    });
    const secondToken = (again.json() as { undoToken: string }).undoToken;

    const undo = await t.app.inject({
      method: 'POST',
      url: `/api/v1/data/undo/${secondToken}`,
      headers: asUser(t.users.editor),
      payload: {},
    });
    expect(undo.statusCode).toBe(200);
    const restored = await t.app.inject({
      method: 'GET',
      url: `/api/v1/data/${connId}/main.products/1`,
      headers: asUser(t.users.editor),
    });
    expect((restored.json() as { data: { unit_price: number } }).data.unit_price).toBe(99.5);
  });

  it('delete: ?dryRun=false / ?confirm=false mean false, and a non-boolean word is a 422', async () => {
    // Regression: these were `z.coerce.boolean()`, i.e. `Boolean(queryString)`,
    // so every non-empty value — `false` included — arrived as `true`.
    // `?confirm=false` therefore SATISFIED the cascade gate and deleted.
    const confirmFalse = await t.app.inject({
      method: 'DELETE',
      url: `/api/v1/data/${connId}/main.customers/ALFKI?confirm=false`,
      headers: asUser(t.users.editor),
    });
    expect(confirmFalse.statusCode).toBe(409);
    expect((confirmFalse.json() as { error: { code: string } }).error.code).toBe('CONFLICT');

    // `?dryRun=false` must fall through to the real delete path (which the
    // confirm gate then stops), not return the 200 cascade preview.
    const dryRunFalse = await t.app.inject({
      method: 'DELETE',
      url: `/api/v1/data/${connId}/main.customers/ALFKI?dryRun=false`,
      headers: asUser(t.users.editor),
    });
    expect(dryRunFalse.statusCode).toBe(409);
    expect((dryRunFalse.json() as { error: { code: string } }).error.code).toBe('CONFLICT');

    // Anything that is not `true`/`false` is rejected rather than coerced.
    const garbage = await t.app.inject({
      method: 'DELETE',
      url: `/api/v1/data/${connId}/main.customers/ALFKI?confirm=yes`,
      headers: asUser(t.users.editor),
    });
    expect(garbage.statusCode).toBe(422);

    // ALFKI is still there — none of the three deleted anything.
    const stillThere = await t.app.inject({
      method: 'GET',
      url: `/api/v1/data/${connId}/main.customers/ALFKI`,
      headers: asUser(t.users.editor),
    });
    expect(stillThere.statusCode).toBe(200);
  });

  it('delete: cascade preflight, confirm contract, FK mapping, and undo with the original PK', async () => {
    // Referenced record → preflight demands confirmation.
    const dryRun = await t.app.inject({
      method: 'DELETE',
      url: `/api/v1/data/${connId}/main.customers/ALFKI?dryRun=true`,
      headers: asUser(t.users.editor),
    });
    expect(dryRun.statusCode).toBe(200);
    expect(dryRun.json()).toMatchObject({ requiresConfirm: true });

    const unconfirmed = await t.app.inject({
      method: 'DELETE',
      url: `/api/v1/data/${connId}/main.customers/ALFKI`,
      headers: asUser(t.users.editor),
    });
    expect(unconfirmed.statusCode).toBe(409);
    expect((unconfirmed.json() as { error: { code: string } }).error.code).toBe('CONFLICT');

    // Even confirmed, the DB's FK constraint wins → 409 FK_VIOLATION.
    const fkBlocked = await t.app.inject({
      method: 'DELETE',
      url: `/api/v1/data/${connId}/main.customers/ALFKI?confirm=true`,
      headers: asUser(t.users.editor),
    });
    expect(fkBlocked.statusCode).toBe(409);
    expect((fkBlocked.json() as { error: { code: string } }).error.code).toBe('FK_VIOLATION');

    // Unreferenced record: create → delete (no confirm needed) → undo restores it.
    const created = await t.app.inject({
      method: 'POST',
      url: `/api/v1/data/${connId}/main.customers`,
      headers: asUser(t.users.editor),
      payload: { values: { customer_id: 'ZZTOP', company_name: 'ZZ Top Ltd', phone: '555-0000' } },
    });
    expect(created.statusCode).toBe(201);

    const deleted = await t.app.inject({
      method: 'DELETE',
      url: `/api/v1/data/${connId}/main.customers/ZZTOP`,
      headers: asUser(t.users.editor),
    });
    expect(deleted.statusCode).toBe(200);
    const { undoToken } = deleted.json() as { undoToken: string };

    const undo = await t.app.inject({
      method: 'POST',
      url: `/api/v1/data/undo/${undoToken}`,
      headers: asUser(t.users.editor),
      payload: {},
    });
    expect(undo.statusCode).toBe(200);
    const restored = await t.app.inject({
      method: 'GET',
      url: `/api/v1/data/${connId}/main.customers/ZZTOP`,
      headers: asUser(t.users.admin),
    });
    expect(restored.statusCode).toBe(200);
    expect((restored.json() as { data: Record<string, unknown> }).data).toMatchObject({
      customer_id: 'ZZTOP',
      company_name: 'ZZ Top Ltd',
      phone: '555-0000', // exact row back, PII included
    });
  });

  it('bulk update/delete run in one transaction with per-item results and one undo token', async () => {
    const bulkUpdate = await t.app.inject({
      method: 'POST',
      url: `/api/v1/data/${connId}/main.products/bulk`,
      headers: asUser(t.users.editor),
      payload: { action: 'update', ids: [2, 3, 999], values: { units_in_stock: 0 } },
    });
    expect(bulkUpdate.statusCode).toBe(200);
    const updateBody = bulkUpdate.json() as {
      results: { id: unknown; ok: boolean; error?: string }[];
      undoToken: string;
    };
    expect(updateBody.results).toEqual([
      { id: 2, ok: true },
      { id: 3, ok: true },
      { id: 999, ok: false, error: 'NOT_FOUND' },
    ]);

    const undoUpdate = await t.app.inject({
      method: 'POST',
      url: `/api/v1/data/undo/${updateBody.undoToken}`,
      headers: asUser(t.users.editor),
      payload: {},
    });
    expect(undoUpdate.statusCode).toBe(200);
    expect((undoUpdate.json() as { restoredIds: unknown[] }).restoredIds).toHaveLength(2);
    const chang = await t.app.inject({
      method: 'GET',
      url: `/api/v1/data/${connId}/main.products/2`,
      headers: asUser(t.users.editor),
    });
    expect((chang.json() as { data: { units_in_stock: number } }).data.units_in_stock).toBe(17);

    const bulkDelete = await t.app.inject({
      method: 'POST',
      url: `/api/v1/data/${connId}/main.products/bulk`,
      headers: asUser(t.users.editor),
      payload: { action: 'delete', ids: [4, 5] },
    });
    const deleteBody = bulkDelete.json() as { undoToken: string };
    expect((await list(`/api/v1/data/${connId}/main.products`)).body.page?.total).toBe(3);

    const undoDelete = await t.app.inject({
      method: 'POST',
      url: `/api/v1/data/undo/${deleteBody.undoToken}`,
      headers: asUser(t.users.editor),
      payload: {},
    });
    expect(undoDelete.statusCode).toBe(200);
    expect((await list(`/api/v1/data/${connId}/main.products`)).body.page?.total).toBe(5);
  });

  it('undo tokens expire after 60 s (410 UNDO_EXPIRED) and unknown tokens are 404', async () => {
    const mutation = await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/data/${connId}/main.products/1`,
      headers: asUser(t.users.editor),
      payload: { values: { units_in_stock: 1 } },
    });
    const { undoToken } = mutation.json() as { undoToken: string };

    clock.now += 60_001;
    const expired = await t.app.inject({
      method: 'POST',
      url: `/api/v1/data/undo/${undoToken}`,
      headers: asUser(t.users.editor),
      payload: {},
    });
    expect(expired.statusCode).toBe(410);
    expect((expired.json() as { error: { code: string } }).error.code).toBe('UNDO_EXPIRED');

    const unknown = await t.app.inject({
      method: 'POST',
      url: `/api/v1/data/undo/undo_ffffffffffffffffffffffffffffffff`,
      headers: asUser(t.users.editor),
      payload: {},
    });
    expect(unknown.statusCode).toBe(404);
  });

  it('undo conflicts when the row changed since the mutation (409 UNDO_CONFLICT)', async () => {
    const first = await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/data/${connId}/main.products/2`,
      headers: asUser(t.users.editor),
      payload: { values: { unit_price: 11 } },
    });
    const { undoToken } = first.json() as { undoToken: string };

    // A second write lands on the same column before the undo.
    await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/data/${connId}/main.products/2`,
      headers: asUser(t.users.editor),
      payload: { values: { unit_price: 12 } },
    });

    const conflicted = await t.app.inject({
      method: 'POST',
      url: `/api/v1/data/undo/${undoToken}`,
      headers: asUser(t.users.editor),
      payload: {},
    });
    expect(conflicted.statusCode).toBe(409);
  });

  it('audits every mutation with a RecordRef (category data)', async () => {
    const rows = await t.meta.db
      .selectFrom('adminium_audit_log')
      .selectAll()
      .where('category', '=', 'data')
      .execute();
    expect(rows.length).toBeGreaterThan(0);
    const actions = new Set(rows.map((row) => row.action));
    for (const action of ['record.create', 'record.update', 'record.delete', 'record.undo']) {
      expect(actions).toContain(action);
    }
    const create = rows.find((row) => row.action === 'record.create')!;
    const entity = JSON.parse(String(create.entity)) as { connectionId: string; table: string; pk: unknown };
    expect(entity.connectionId).toBe(connId);
    expect(entity.table).toBe('main.products');
    expect(entity.pk).toBeDefined();
  });
});
