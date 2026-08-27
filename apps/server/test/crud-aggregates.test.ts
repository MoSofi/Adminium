// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Reverse-link aggregate columns on the CRUD read endpoints (`agg=` params,
 * src/crud/aggregates.ts) over the fake SQLite-backed adapter: per-row counts
 * over an inbound FK (including zero rows and a self-referential FK),
 * coexistence with lookups/filters/order/offset/keyset paging, the
 * single-record GET, the 422 grammar (malformed specs, unsupported
 * aggregates, unknown identifiers, non-inbound-FK columns, alias collisions
 * with base columns / lookup aliases / other aggregates, the 12-param cap),
 * and the degrade-don't-break rule — an unreadable referencing table resolves
 * to `null` + `_masked` instead of failing the request.
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
    CREATE TABLE companies (
      company_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE clients (
      client_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      company_id INTEGER REFERENCES companies(company_id)
    );
    CREATE TABLE invoices (
      invoice_id INTEGER PRIMARY KEY,
      title TEXT,
      amount REAL,
      client_id INTEGER REFERENCES clients(client_id),
      status TEXT
    );
    CREATE TABLE employees (
      employee_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      manager_id INTEGER REFERENCES employees(employee_id)
    );
    INSERT INTO companies VALUES (1, 'Acme Holdings'), (2, 'Globex');
    INSERT INTO clients VALUES
      (1, 'Ada Lovelace', 1),
      (2, 'Grace Hopper', 2),
      (3, 'Lone Wolf', NULL);
    INSERT INTO invoices VALUES
      (10, 'Website build', 1200, 1, 'paid'),
      (11, 'Hosting', 300, 2, 'pending'),
      (12, 'Orphan work', 50, NULL, 'draft'),
      (13, 'Retainer', 900, 1, 'paid');
    INSERT INTO employees VALUES
      (1, 'Root Boss', NULL),
      (2, 'Middle Manager', 1),
      (3, 'Leaf Worker', 2),
      (4, 'New Starter', 1);
  `);
  return db;
}

function fakeModel(): DatabaseModel {
  return parseDatabaseModel({
    dialect: 'postgres',
    name: 'aggdb',
    defaultSchema: 'main',
    schemas: ['main'],
    tables: [
      {
        schema: 'main',
        name: 'companies',
        primaryKey: ['company_id'],
        columns: [
          { name: 'company_id', logicalType: 'integer', nullable: false, isPrimaryKey: true },
          { name: 'name', logicalType: 'varchar', nullable: false },
        ],
      },
      {
        schema: 'main',
        name: 'clients',
        primaryKey: ['client_id'],
        columns: [
          { name: 'client_id', logicalType: 'integer', nullable: false, isPrimaryKey: true },
          { name: 'name', logicalType: 'varchar', nullable: false },
          {
            name: 'company_id',
            logicalType: 'integer',
            nullable: true,
            references: { tableId: 'main.companies', column: 'company_id' },
          },
        ],
      },
      {
        schema: 'main',
        name: 'invoices',
        primaryKey: ['invoice_id'],
        columns: [
          { name: 'invoice_id', logicalType: 'integer', nullable: false, isPrimaryKey: true },
          { name: 'title', logicalType: 'varchar', nullable: true },
          { name: 'amount', logicalType: 'decimal', nullable: true },
          {
            name: 'client_id',
            logicalType: 'integer',
            nullable: true,
            references: { tableId: 'main.clients', column: 'client_id' },
          },
          { name: 'status', logicalType: 'varchar', nullable: true },
        ],
      },
      {
        schema: 'main',
        name: 'employees',
        primaryKey: ['employee_id'],
        columns: [
          { name: 'employee_id', logicalType: 'integer', nullable: false, isPrimaryKey: true },
          { name: 'name', logicalType: 'varchar', nullable: false },
          {
            name: 'manager_id',
            logicalType: 'integer',
            nullable: true,
            references: { tableId: 'main.employees', column: 'employee_id' },
          },
        ],
      },
    ],
    relations: [
      {
        id: 'fk_clients_companies',
        kind: 'declared-fk',
        cardinality: 'one-to-many',
        from: { tableId: 'main.clients', columns: ['company_id'] },
        to: { tableId: 'main.companies', columns: ['company_id'] },
      },
      {
        id: 'fk_invoices_clients',
        kind: 'declared-fk',
        cardinality: 'one-to-many',
        from: { tableId: 'main.invoices', columns: ['client_id'] },
        to: { tableId: 'main.clients', columns: ['client_id'] },
      },
      {
        id: 'fk_employees_employees',
        kind: 'declared-fk',
        cardinality: 'one-to-many',
        from: { tableId: 'main.employees', columns: ['manager_id'] },
        to: { tableId: 'main.employees', columns: ['employee_id'] },
        selfReferential: true,
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

describe('CRUD reverse-link aggregates (fake adapter)', () => {
  let t: DataTestContext;
  let connId: string;

  beforeAll(async () => {
    t = await buildDataTestApp({ registry: makeFakeRegistry(seedSqlite()) });
    connId = await createConnectionViaApi(t, 'postgres://fake@fake-host:5432/aggdb');
    await introspectViaApi(t, connId);
    await t.grantTable(t.roles.admin, connId, '*', {
      read: true,
      create: true,
      update: true,
      delete: true,
    });
    await t.grantTable(t.roles.viewer, connId, '*', { read: true });
    // The editor can read clients but NOT invoices — the aggregate degrade case.
    await t.grantTable(t.roles.editor, connId, 'main.clients', { read: true });
  });

  afterAll(async () => {
    await t.app.close();
  });

  interface ListBody {
    data: Record<string, unknown>[];
    page?: { total: number | null };
    cursor?: { next: string | null };
  }

  const list = async (url: string, user = t.users.viewer): Promise<{ status: number; body: ListBody }> => {
    const res = await t.app.inject({ method: 'GET', url, headers: asUser(user) });
    return { status: res.statusCode, body: res.json() as ListBody };
  };

  const byId = (body: ListBody, key: string, id: number): Record<string, unknown> => {
    const row = body.data.find((entry) => entry[key] === id);
    expect(row).toBeDefined();
    return row as Record<string, unknown>;
  };

  const spec = (raw: string) => encodeURIComponent(raw);

  it('counts referencing rows per row, zero included, as plain numbers', async () => {
    const { status, body } = await list(
      `/api/v1/data/${connId}/main.clients?agg=${spec('invoice_count:main.invoices.client_id:count')}`,
    );
    expect(status).toBe(200);
    expect(byId(body, 'client_id', 1)['invoice_count']).toBe(2);
    expect(byId(body, 'client_id', 2)['invoice_count']).toBe(1);
    // No referencing rows → 0, not NULL — a count is always a number.
    expect(byId(body, 'client_id', 3)['invoice_count']).toBe(0);
    // Aggregates never leak into the count query.
    expect(body.page?.total).toBe(3);
  });

  it('resolves a bare table name against the default schema', async () => {
    const { status, body } = await list(
      `/api/v1/data/${connId}/main.clients?agg=${spec('n:invoices.client_id:count')}`,
    );
    expect(status).toBe(200);
    expect(byId(body, 'client_id', 1)['n']).toBe(2);
  });

  it('handles self-referential FKs (direct reports)', async () => {
    const { status, body } = await list(
      `/api/v1/data/${connId}/main.employees?agg=${spec('direct_reports:main.employees.manager_id:count')}`,
    );
    expect(status).toBe(200);
    expect(byId(body, 'employee_id', 1)['direct_reports']).toBe(2);
    expect(byId(body, 'employee_id', 2)['direct_reports']).toBe(1);
    expect(byId(body, 'employee_id', 3)['direct_reports']).toBe(0);
    expect(byId(body, 'employee_id', 4)['direct_reports']).toBe(0);
  });

  it('coexists with lookups, where, order and offset paging', async () => {
    const where = encodeURIComponent(JSON.stringify({ column: 'company_id', op: 'not_null' }));
    const { status, body } = await list(
      `/api/v1/data/${connId}/main.clients?lookup=${spec('company:company_id.name')}&agg=${spec(
        'invoice_count:main.invoices.client_id:count',
      )}&where=${where}&order=name.asc&offset=0&limit=10`,
    );
    expect(status).toBe(200);
    expect(body.data).toHaveLength(2);
    expect(body.data.map((row) => row['name'])).toEqual(['Ada Lovelace', 'Grace Hopper']);
    expect(body.data[0]?.['company']).toBe('Acme Holdings');
    expect(body.data[0]?.['invoice_count']).toBe(2);
    expect(body.data[1]?.['company']).toBe('Globex');
    expect(body.data[1]?.['invoice_count']).toBe(1);
    expect(body.page?.total).toBe(2);
  });

  it('rides keyset pagination', async () => {
    const first = await list(
      `/api/v1/data/${connId}/main.clients?cursor=&limit=2&agg=${spec('invoice_count:main.invoices.client_id:count')}`,
    );
    expect(first.status).toBe(200);
    expect(first.body.data).toHaveLength(2);
    expect(first.body.data.every((row) => typeof row['invoice_count'] === 'number')).toBe(true);
    const next = first.body.cursor?.next;
    expect(next).toBeTruthy();
    const second = await list(
      `/api/v1/data/${connId}/main.clients?cursor=${encodeURIComponent(next as string)}&limit=2&agg=${spec(
        'invoice_count:main.invoices.client_id:count',
      )}`,
    );
    expect(second.status).toBe(200);
    expect(second.body.data).toHaveLength(1);
    expect(second.body.data[0]?.['invoice_count']).toBe(0);
  });

  it('serves aggregates (with lookups) on the single-record GET', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/v1/data/${connId}/main.clients/1?agg=${spec('invoice_count:main.invoices.client_id:count')}&lookup=${spec(
        'company:company_id.name',
      )}`,
      headers: asUser(t.users.viewer),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Record<string, unknown> };
    expect(body.data['name']).toBe('Ada Lovelace');
    expect(body.data['company']).toBe('Acme Holdings');
    expect(body.data['invoice_count']).toBe(2);
  });

  it('degrades (null + _masked) when the caller cannot read the referencing table', async () => {
    const { status, body } = await list(
      `/api/v1/data/${connId}/main.clients?agg=${spec('invoice_count:main.invoices.client_id:count')}`,
      t.users.editor,
    );
    expect(status).toBe(200); // the base table still serves
    const row = byId(body, 'client_id', 1);
    expect(row['invoice_count']).toBeNull();
    expect(row['_masked']).toContain('invoice_count');
  });

  it('refuses malformed and misaddressed aggregates with 422', async () => {
    const cases = [
      'noalias', // malformed — no colon at all
      'x:main.invoices.client_id', // malformed — no aggregate token
      'x:invoices:count', // malformed — no fk column
      'bad alias:main.invoices.client_id:count', // alias fails the identifier pattern
      'x:main.invoices.client_id:sum', // unsupported aggregate (reserved for later)
      'x:main.nope.client_id:count', // unknown table
      'x:main.invoices.nope:count', // unknown column
      'x:main.invoices.status:count', // column is not an FK onto the base table
      'name:main.invoices.client_id:count', // alias collides with a base column
    ];
    for (const raw of cases) {
      const { status } = await list(`/api/v1/data/${connId}/main.clients?agg=${spec(raw)}`);
      expect(status, raw).toBe(422);
    }
    // An FK that exists but points at a DIFFERENT table than the one listed.
    const wrongTarget = await list(
      `/api/v1/data/${connId}/main.companies?agg=${spec('x:main.invoices.client_id:count')}`,
    );
    expect(wrongTarget.status).toBe(422);
    // Duplicate aliases across two agg params.
    const dup = await list(
      `/api/v1/data/${connId}/main.clients?agg=${spec('x:main.invoices.client_id:count')}&agg=${spec(
        'x:main.invoices.client_id:count',
      )}`,
    );
    expect(dup.status).toBe(422);
    // An aggregate alias colliding with a lookup alias in the same request.
    const cross = await list(
      `/api/v1/data/${connId}/main.clients?lookup=${spec('x:company_id.name')}&agg=${spec(
        'x:main.invoices.client_id:count',
      )}`,
    );
    expect(cross.status).toBe(422);
  });

  it('caps the number of aggregates per request', async () => {
    const params = Array.from(
      { length: 13 },
      (_, i) => `agg=${spec(`n${String(i)}:main.invoices.client_id:count`)}`,
    ).join('&');
    const { status } = await list(`/api/v1/data/${connId}/main.clients?${params}`);
    expect(status).toBe(422);
  });
});
