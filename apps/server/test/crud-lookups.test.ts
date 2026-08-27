// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Cross-table lookup columns on the CRUD read endpoints (`lookup=` params,
 * src/crud/lookups.ts) over the fake SQLite-backed adapter: single-hop and
 * two-hop chains, self-referential FKs, NULL FK propagation, coexistence with
 * filters/search/sort/keyset/counts, the single-record GET, the 422 grammar
 * (malformed specs, unknown identifiers, non-FK hops, alias collisions), and
 * the degrade-don't-break rules — masked targets and unreadable referenced
 * tables resolve to `null` + `_masked` instead of failing the request.
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
      email TEXT,
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
      (1, 'Ada Lovelace', 'ada@example.com', 1),
      (2, 'Grace Hopper', 'grace@example.com', 2),
      (3, 'Lone Wolf', 'wolf@example.com', NULL);
    INSERT INTO invoices VALUES
      (10, 'Website build', 1200, 1, 'paid'),
      (11, 'Hosting', 300, 2, 'pending'),
      (12, 'Orphan work', 50, NULL, 'draft');
    INSERT INTO employees VALUES (1, 'Root Boss', NULL), (2, 'Middle Manager', 1), (3, 'Leaf Worker', 2);
  `);
  return db;
}

function fakeModel(): DatabaseModel {
  return parseDatabaseModel({
    dialect: 'postgres',
    name: 'lookupdb',
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
          { name: 'email', logicalType: 'varchar', nullable: true },
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

describe('CRUD lookup columns (fake adapter)', () => {
  let t: DataTestContext;
  let connId: string;

  beforeAll(async () => {
    t = await buildDataTestApp({ registry: makeFakeRegistry(seedSqlite()) });
    connId = await createConnectionViaApi(t, 'postgres://fake@fake-host:5432/lookupdb');
    await introspectViaApi(t, connId);
    await t.grantTable(t.roles.admin, connId, '*', {
      read: true,
      create: true,
      update: true,
      delete: true,
    });
    await t.grantTable(t.roles.viewer, connId, '*', { read: true });
    // The editor can read invoices but NOT clients/companies — the lookup
    // degrade case.
    await t.grantTable(t.roles.editor, connId, 'main.invoices', { read: true });
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

  it('aliases a referenced-table column into every row (1 hop)', async () => {
    const { status, body } = await list(
      `/api/v1/data/${connId}/main.invoices?lookup=${encodeURIComponent('client_name:client_id.name')}`,
    );
    expect(status).toBe(200);
    expect(byId(body, 'invoice_id', 10)['client_name']).toBe('Ada Lovelace');
    expect(byId(body, 'invoice_id', 11)['client_name']).toBe('Grace Hopper');
    // NULL FK → NULL alias, like an unmatched LEFT JOIN.
    expect(byId(body, 'invoice_id', 12)['client_name']).toBeNull();
    // Lookups never leak into the count.
    expect(body.page?.total).toBe(3);
  });

  it('follows a two-hop chain into a third table', async () => {
    const { status, body } = await list(
      `/api/v1/data/${connId}/main.invoices?lookup=${encodeURIComponent('company:client_id.company_id.name')}`,
    );
    expect(status).toBe(200);
    expect(byId(body, 'invoice_id', 10)['company']).toBe('Acme Holdings');
    expect(byId(body, 'invoice_id', 11)['company']).toBe('Globex');
    expect(byId(body, 'invoice_id', 12)['company']).toBeNull();
  });

  it('handles self-referential FKs without ambiguity', async () => {
    const { status, body } = await list(
      `/api/v1/data/${connId}/main.employees?lookup=${encodeURIComponent('manager:manager_id.name')}`,
    );
    expect(status).toBe(200);
    expect(byId(body, 'employee_id', 1)['manager']).toBeNull();
    expect(byId(body, 'employee_id', 2)['manager']).toBe('Root Boss');
    expect(byId(body, 'employee_id', 3)['manager']).toBe('Middle Manager');
  });

  // `q=` is absent here on purpose: the fake adapter declares the postgres
  // dialect over a SQLite engine, so quick search compiles ILIKE this engine
  // cannot parse — the same reason crud-e2e leaves ILIKE to the live-PG suite.
  it('carries several lookups and coexists with where, order and offset paging', async () => {
    const where = encodeURIComponent(JSON.stringify({ column: 'status', op: 'neq', value: 'draft' }));
    const lookups = [
      `lookup=${encodeURIComponent('client_name:client_id.name')}`,
      `lookup=${encodeURIComponent('company:client_id.company_id.name')}`,
    ].join('&');
    const { status, body } = await list(
      `/api/v1/data/${connId}/main.invoices?${lookups}&where=${where}&order=amount.desc&offset=0&limit=10`,
    );
    expect(status).toBe(200);
    expect(body.data).toHaveLength(2);
    expect(body.data.map((row) => row['title'])).toEqual(['Website build', 'Hosting']);
    expect(body.data[1]?.['client_name']).toBe('Grace Hopper');
    expect(body.data[1]?.['company']).toBe('Globex');
    expect(body.page?.total).toBe(2);
  });

  it('rides keyset pagination', async () => {
    const first = await list(
      `/api/v1/data/${connId}/main.invoices?cursor=&limit=2&lookup=${encodeURIComponent('client_name:client_id.name')}`,
    );
    expect(first.status).toBe(200);
    expect(first.body.data).toHaveLength(2);
    expect(first.body.data.every((row) => 'client_name' in row)).toBe(true);
    const next = first.body.cursor?.next;
    expect(next).toBeTruthy();
    const second = await list(
      `/api/v1/data/${connId}/main.invoices?cursor=${encodeURIComponent(next as string)}&limit=2&lookup=${encodeURIComponent('client_name:client_id.name')}`,
    );
    expect(second.status).toBe(200);
    expect(second.body.data).toHaveLength(1);
    expect('client_name' in (second.body.data[0] ?? {})).toBe(true);
  });

  it('serves lookups on the single-record GET', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/v1/data/${connId}/main.invoices/10?lookup=${encodeURIComponent('client_name:client_id.name')}&lookup=${encodeURIComponent('company:client_id.company_id.name')}`,
      headers: asUser(t.users.viewer),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Record<string, unknown> };
    expect(body.data['title']).toBe('Website build');
    expect(body.data['client_name']).toBe('Ada Lovelace');
    expect(body.data['company']).toBe('Acme Holdings');
  });

  it('masks a PII target for callers without the unmask grant, serves it to admins', async () => {
    const url = `/api/v1/data/${connId}/main.invoices?lookup=${encodeURIComponent('client_email:client_id.email')}`;
    const masked = await list(url, t.users.viewer);
    expect(masked.status).toBe(200);
    const maskedRow = byId(masked.body, 'invoice_id', 10);
    expect(maskedRow['client_email']).toBeNull();
    expect(maskedRow['_masked']).toContain('client_email');

    const unmasked = await list(url, t.users.admin);
    expect(unmasked.status).toBe(200);
    const clearRow = byId(unmasked.body, 'invoice_id', 10);
    expect(clearRow['client_email']).toBe('ada@example.com');
    expect(((clearRow['_masked'] as string[] | undefined) ?? [])).not.toContain('client_email');
  });

  it('degrades (null + _masked) when the caller cannot read a reached table', async () => {
    const { status, body } = await list(
      `/api/v1/data/${connId}/main.invoices?lookup=${encodeURIComponent('client_name:client_id.name')}`,
      t.users.editor,
    );
    expect(status).toBe(200); // the base table still serves
    const row = byId(body, 'invoice_id', 10);
    expect(row['client_name']).toBeNull();
    expect(row['_masked']).toContain('client_name');
  });

  it('refuses malformed and misaddressed lookups with 422', async () => {
    const cases = [
      'nocolon.name', // malformed — no alias
      'x:', // malformed — empty path
      'x:client_id', // malformed — no target column
      'bad alias:client_id.name', // alias fails the identifier pattern
      'x:status.name', // hop is not an FK
      'x:client_id.nope', // unknown target column
      'x:nope.name', // unknown hop column
      'title:client_id.name', // alias collides with a base column
    ];
    for (const spec of cases) {
      const { status } = await list(
        `/api/v1/data/${connId}/main.invoices?lookup=${encodeURIComponent(spec)}`,
      );
      expect(status, spec).toBe(422);
    }
    // Duplicate aliases across two params.
    const dup = await list(
      `/api/v1/data/${connId}/main.invoices?lookup=${encodeURIComponent('x:client_id.name')}&lookup=${encodeURIComponent('x:client_id.email')}`,
    );
    expect(dup.status).toBe(422);
  });
});
