// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Create-path regression suite for non-auto-generated primary keys, across
 * declared dialects (e2e c5, first mysql CI leg).
 *
 * The failure this pins down: kysely's MysqlQueryCompiler inherits
 * `visitReturning`, so the create route's `.returningAll()` compiled
 * `INSERT … RETURNING *` — a hard parse error on mysql:8.4 (ER_PARSE_ERROR
 * 1064, "near 'returning *'") → every generated-app create 500'd and no row
 * was written. The route now branches per dialect
 * (routes/data/index.ts `insertRow`): postgres/sqlite keep the one-round-trip
 * `RETURNING *`; mysql inserts bare and re-selects the stored row by key —
 * the client-provided PK values when the payload carries them (char and
 * composite PKs, where LAST_INSERT_ID is useless), falling back to the
 * driver's insertId for a single missing auto-increment column.
 *
 * Both branches run here over the same fake sqlite-backed adapter, declared
 * once as 'postgres' and once as 'mysql' (the manager derives the route's
 * dialect from connection.engine, and sqlite happily executes both SQL
 * shapes) — so the mysql branch is exercised by every local/CI vitest run
 * with no live server. The REAL engine is proven by the adapter-mysql live
 * suite (create-and-refetch semantics on mysql:8.4) and the e2e mysql leg.
 */

import BetterSqlite3 from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  AdapterRegistry,
  adapterCapabilitiesSchema,
  parseDatabaseModel,
  type AdapterProvider,
  type DatabaseAdapter,
  type DatabaseModel,
} from '@adminium/engine/adapter';

import { ConflictError } from '../src/errors.js';
import { insertRow, mapDbError } from '../src/routes/data/index.js';
import {
  asUser,
  buildDataTestApp,
  introspectViaApi,
  type DataTestContext,
} from './connections-helpers.js';

type Engine = 'postgres' | 'mysql';

// --- fake source database ----------------------------------------------------

/**
 * Mirrors the northwind shapes the e2e suite creates against: a char-PK
 * customers table (c5's `E2E01`), a composite-PK order_details, and an
 * auto-increment shippers. `status`/`quantity` carry DB defaults the create
 * payload omits — the 201 body containing them proves the STORED row came
 * back (RETURNING or refetch), not an echo of the payload.
 */
function seedSqlite(): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:');
  db.exec(`
    CREATE TABLE customers (
      customer_id TEXT PRIMARY KEY,
      company_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new'
    );
    CREATE TABLE order_details (
      order_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (order_id, product_id)
    );
    CREATE TABLE shippers (
      shipper_id INTEGER PRIMARY KEY,
      company_name TEXT NOT NULL
    );
    INSERT INTO customers (customer_id, company_name) VALUES ('ALFKI', 'Alfreds Futterkiste');
  `);
  return db;
}

function fakeModel(engine: Engine): DatabaseModel {
  return parseDatabaseModel({
    dialect: engine,
    name: 'fakedb',
    defaultSchema: 'main',
    schemas: ['main'],
    tables: [
      {
        schema: 'main',
        name: 'customers',
        primaryKey: ['customer_id'],
        columns: [
          { name: 'customer_id', logicalType: 'varchar', nullable: false, isPrimaryKey: true },
          { name: 'company_name', logicalType: 'varchar', nullable: false },
          { name: 'status', logicalType: 'varchar', nullable: false },
        ],
      },
      {
        schema: 'main',
        name: 'order_details',
        primaryKey: ['order_id', 'product_id'],
        columns: [
          { name: 'order_id', logicalType: 'integer', nullable: false, isPrimaryKey: true },
          { name: 'product_id', logicalType: 'integer', nullable: false, isPrimaryKey: true },
          { name: 'quantity', logicalType: 'integer', nullable: false },
        ],
      },
      {
        schema: 'main',
        name: 'shippers',
        primaryKey: ['shipper_id'],
        columns: [
          {
            name: 'shipper_id',
            logicalType: 'integer',
            nullable: false,
            isPrimaryKey: true,
            default: { kind: 'autoincrement' },
          },
          { name: 'company_name', logicalType: 'varchar', nullable: false },
        ],
      },
    ],
    relations: [],
  });
}

function makeFakeRegistry(engine: Engine, sqlite: BetterSqlite3.Database): AdapterRegistry<AdapterProvider> {
  const capabilities = adapterCapabilitiesSchema.parse({});
  const makeAdapter = (role: string): DatabaseAdapter =>
    ({
      dialect: engine,
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
      introspect: async () => fakeModel(engine),
      count: async () => ({ value: 0, capped: false }),
      sample: async () => [],
      query: async () => ({ rows: [], columns: [] }),
      mutate: async () => ({ affected: 0, returning: null }),
      close: async () => undefined,
    }) as unknown as DatabaseAdapter;

  const registry = new AdapterRegistry<AdapterProvider>();
  registry.register({
    dialect: engine,
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

describe.each<{ engine: Engine; path: string }>([
  { engine: 'postgres', path: 'RETURNING *' },
  { engine: 'mysql', path: 'insert + refetch-by-key' },
])('record create on declared engine $engine ($path path)', ({ engine }) => {
  let t: DataTestContext;
  let connId: string;

  beforeAll(async () => {
    t = await buildDataTestApp({ registry: makeFakeRegistry(engine, seedSqlite()) });
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/connections',
      headers: asUser(t.users.admin),
      payload: { name: `northwind-${engine}`, engine, dsn: `${engine}://fake@fake-host/fakedb` },
    });
    expect(res.statusCode).toBe(201);
    connId = (res.json() as { id: string }).id;
    await introspectViaApi(t, connId);
    await t.grantTable(t.roles.admin, connId, '*', {
      read: true,
      create: true,
      update: true,
      delete: true,
    });
  });

  afterAll(async () => {
    await t.app.close();
  });

  const create = async (
    table: string,
    values: Record<string, unknown>,
  ): Promise<{ status: number; body: { data: Record<string, unknown>; undoToken: string | null } }> => {
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/v1/data/${connId}/main.${table}`,
      headers: asUser(t.users.admin),
      payload: { values },
    });
    return { status: res.statusCode, body: res.json() };
  };

  const get = async (table: string, recordId: string): Promise<number> => {
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/v1/data/${connId}/main.${table}/${encodeURIComponent(recordId)}`,
      headers: asUser(t.users.admin),
    });
    return res.statusCode;
  };

  it('creates a row with a PROVIDED char PK and returns the stored row (e2e c5)', async () => {
    const { status, body } = await create('customers', {
      customer_id: 'E2E01',
      company_name: 'E2E Markets',
    });
    expect(status).toBe(201);
    // The stored row, not a payload echo: the DB-side default is present.
    expect(body.data).toMatchObject({
      customer_id: 'E2E01',
      company_name: 'E2E Markets',
      status: 'new',
    });
    expect(await get('customers', 'E2E01')).toBe(200);
  });

  it('maps a duplicate provided PK to 409 UNIQUE_VIOLATION, not 500', async () => {
    const { status } = await create('customers', {
      customer_id: 'ALFKI',
      company_name: 'Duplicate',
    });
    expect(status).toBe(409);
  });

  it('creates a row with a fully-provided COMPOSITE PK (order_details)', async () => {
    const { status, body } = await create('order_details', { order_id: 10, product_id: 20 });
    expect(status).toBe(201);
    expect(body.data).toMatchObject({ order_id: 10, product_id: 20, quantity: 1 });
    expect(await get('order_details', JSON.stringify({ order_id: 10, product_id: 20 }))).toBe(200);
  });

  it('creates a row with an OMITTED auto-increment PK via the driver insertId', async () => {
    const { status, body } = await create('shippers', { company_name: 'Speedy' });
    expect(status).toBe(201);
    expect(typeof body.data.shipper_id).toBe('number');
    expect(await get('shippers', String(body.data.shipper_id))).toBe(200);
  });

  it('treats an explicit NULL auto-PK payload value as "generate it"', async () => {
    // Forms serialize untouched fields as null — mysql's own auto-increment
    // trigger spelling. The refetch must not try `WHERE shipper_id IS NULL`.
    const { status, body } = await create('shippers', { shipper_id: null, company_name: 'Nully' });
    expect(status).toBe(201);
    expect(typeof body.data.shipper_id).toBe('number');
    expect(body.data.company_name).toBe('Nully');
  });

  it('issues a working undo token — the refetched PK addresses the new row', async () => {
    const { status, body } = await create('customers', {
      customer_id: 'UNDO1',
      company_name: 'Undo Me',
    });
    expect(status).toBe(201);
    expect(body.undoToken).toMatch(/^undo_/);

    const undo = await t.app.inject({
      method: 'POST',
      url: `/api/v1/data/undo/${body.undoToken}`,
      headers: asUser(t.users.admin),
      payload: {},
    });
    expect(undo.statusCode).toBe(200);
    expect(await get('customers', 'UNDO1')).toBe(404);
  });
});

// --- insertRow: the dialect branch itself ---------------------------------------
//
// The fake-adapter suite above can't tell the two SQL shapes apart (sqlite
// accepts RETURNING too), so pin the compiled SQL: the mysql branch must
// never emit a RETURNING clause, the postgres branch must keep it.

describe('insertRow compiles per dialect', () => {
  const table = {
    id: 'customers',
    schema: 'main',
    name: 'customers',
    primaryKey: ['customer_id'],
    columns: new Map(),
    readOnly: false,
  } as unknown as import('../src/crud/identifiers.js').ResolvedTable;

  const build = (): { db: Kysely<Record<string, Record<string, unknown>>>; sql: string[] } => {
    const sqlite = new BetterSqlite3(':memory:');
    sqlite.exec(
      "CREATE TABLE customers (customer_id TEXT PRIMARY KEY, company_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new')",
    );
    const sql: string[] = [];
    const db = new Kysely<Record<string, Record<string, unknown>>>({
      dialect: new SqliteDialect({ database: sqlite }),
      log(event) {
        if (event.level === 'query') sql.push(event.query.sql);
      },
    });
    return { db, sql };
  };

  it("mysql: bare INSERT (no RETURNING) + SELECT refetch by the provided PK", async () => {
    const { db, sql } = build();
    const row = await insertRow(
      db as never,
      'mysql',
      table,
      { customer_id: 'E2E01', company_name: 'E2E Markets' },
    );
    expect(row).toMatchObject({ customer_id: 'E2E01', status: 'new' });
    expect(sql).toHaveLength(2);
    expect(sql[0]).toMatch(/^insert into/i);
    expect(sql[0]?.toLowerCase()).not.toContain('returning');
    expect(sql[1]).toMatch(/^select/i);
    await db.destroy();
  });

  it('postgres: single INSERT … RETURNING * round trip', async () => {
    const { db, sql } = build();
    const row = await insertRow(
      db as never,
      'postgres',
      table,
      { customer_id: 'E2E02', company_name: 'E2E Markets' },
    );
    expect(row).toMatchObject({ customer_id: 'E2E02', status: 'new' });
    expect(sql).toHaveLength(1);
    expect(sql[0]?.toLowerCase()).toContain('returning');
    await db.destroy();
  });
});

// --- mapDbError: mysql driver error symbols -----------------------------------

describe('mapDbError maps mysql2 error codes to §1.4 envelope codes', () => {
  it('ER_DUP_ENTRY → 409 UNIQUE_VIOLATION', () => {
    const error = Object.assign(new Error("Duplicate entry 'E2E01' for key 'customers.PRIMARY'"), {
      code: 'ER_DUP_ENTRY',
      errno: 1062,
    });
    expect(() => mapDbError(error)).toThrowError(ConflictError);
    try {
      mapDbError(error);
    } catch (mapped) {
      expect(mapped).toMatchObject({ statusCode: 409, code: 'UNIQUE_VIOLATION' });
    }
  });

  it('ER_NO_REFERENCED_ROW_2 / ER_ROW_IS_REFERENCED_2 → 409 FK_VIOLATION', () => {
    for (const code of ['ER_NO_REFERENCED_ROW_2', 'ER_ROW_IS_REFERENCED_2']) {
      const error = Object.assign(new Error('Cannot add or update a child row'), { code });
      try {
        mapDbError(error);
        expect.unreachable('mapDbError must throw');
      } catch (mapped) {
        expect(mapped).toMatchObject({ statusCode: 409, code: 'FK_VIOLATION' });
      }
    }
  });

  it('unrecognized driver errors rethrow untouched (500 INTERNAL upstream)', () => {
    const error = Object.assign(new Error('boom'), { code: 'ER_PARSE_ERROR' });
    expect(() => mapDbError(error)).toThrowError('boom');
  });
});
