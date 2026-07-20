/**
 * Live MySQL tests — env-gated on TEST_MYSQL_URL (no local MySQL on dev
 * machines; CI provides a `mysql:8.4` service container) AND on the mysql2
 * driver being installed, so the suite skips cleanly everywhere else.
 * Mirrors the postgres live suite: northwind fixture introspection, probe
 * behavior, role guards, registration, and CRUD through the Kysely query
 * engine.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  AdapterError,
  AdapterRegistry,
  parseDatabaseModel,
  type AdapterProvider,
  type DatabaseAdapter,
  type DatabaseModel,
  type IntrospectConnectionConfig,
  type StatsColumnInput,
} from '@adminium/engine/adapter';

import {
  countingExecutor,
  createTestDatabase,
  dropTestDatabase,
  dsnFor,
  mysqlDriverAvailable,
  runSql,
  TEST_MYSQL_URL,
} from './harness.js';

const liveReady = TEST_MYSQL_URL !== '' && (await mysqlDriverAvailable());

type AdapterModule = typeof import('../src/index.js');

describe.skipIf(!liveReady)('MysqlAdapter (mysql2 driver, northwind fixture)', () => {
  let mod: AdapterModule;
  let db = '';
  let introspectAdapter: DatabaseAdapter<'introspect'>;
  let model: DatabaseModel;

  beforeAll(async () => {
    mod = await import('../src/index.js');
    db = await createTestDatabase(true);
    const config: IntrospectConnectionConfig = { role: 'introspect', dsn: dsnFor(db) };
    introspectAdapter = new mod.MysqlAdapter<'introspect'>('introspect');
    await introspectAdapter.connect(config);
    model = await introspectAdapter.introspect();
  }, 120_000);

  afterAll(async () => {
    await introspectAdapter?.close();
    if (db !== '') await dropTestDatabase(db);
  });

  it('introspects all 14 northwind tables into a Zod-valid model', () => {
    expect(() => parseDatabaseModel(JSON.stringify(model))).not.toThrow();
    expect(model.dialect).toBe('mysql');
    expect(model.defaultSchema).toBe(db);
    expect(model.tables).toHaveLength(14);
    expect(model.tables.map((t) => t.name)).toContain('order_details');
  });

  it('maps composite PKs and classic column types', () => {
    const orderDetails = model.tables.find((t) => t.name === 'order_details');
    expect(orderDetails?.primaryKey).toEqual(['order_id', 'product_id']);
    const products = model.tables.find((t) => t.name === 'products');
    expect(products?.columns.find((c) => c.name === 'product_name')).toMatchObject({
      logicalType: 'varchar',
      maxLength: 40,
    });
    expect(products?.columns.find((c) => c.name === 'unit_price')?.logicalType).toBe('float');
    const categories = model.tables.find((t) => t.name === 'categories');
    expect(categories?.columns.find((c) => c.name === 'picture')?.logicalType).toBe('binary');
  });

  it('detects the self-referential employees.reports_to FK', () => {
    const selfFk = model.relations.find((r) => r.selfReferential);
    expect(selfFk?.from).toMatchObject({
      tableId: `${db}.employees`,
      columns: ['reports_to'],
    });
    expect(selfFk?.to.columns).toEqual(['employee_id']);
  });

  it('mirrors declared FKs onto columns', () => {
    const orders = model.tables.find((t) => t.name === 'orders');
    expect(orders?.columns.find((c) => c.name === 'customer_id')?.references).toEqual({
      tableId: `${db}.customers`,
      column: 'customer_id',
    });
  });

  it('collects TABLE_ROWS estimates, never COUNT (schema-only invariant)', () => {
    const categories = model.tables.find((t) => t.name === 'categories');
    expect(categories?.rowCountEstimate).not.toBeNull();
    expect(categories?.rowCountExact).toBe(false);
  });

  it('stays within the statement budget (≤ 10, fixed set)', async () => {
    const counting = await countingExecutor(db);
    try {
      const { introspectMysql } = mod;
      await introspectMysql(counting.exec, { connectionId: db, databaseName: db });
      expect(counting.count()).toBe(6);
      expect(counting.count()).toBeLessThanOrEqual(10);
    } finally {
      await counting.close();
    }
  });

  it('test() reports latency, server version, user, and write access', async () => {
    const result = await introspectAdapter.test();
    expect(result.ok).toBe(true);
    expect(result.serverVersion).toMatch(/^\d+\./);
    expect(result.currentUser).not.toBeNull();
    expect(result.canWrite).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('probeCapabilities() reflects the dialect and the connected user', async () => {
    const probe = await introspectAdapter.probeCapabilities();
    expect(probe.capabilities).toMatchObject({
      hasSchemas: false,
      hasEnums: true,
      hasRLS: false,
      maxIdentifierLength: 64,
    });
    expect(probe.privileges.canReadSchema).toBe(true);
    expect(probe.currentRole.readOnly).toBe(false);
  });

  it('row-touching methods are runtime-guarded on the introspect role', async () => {
    const adapter = introspectAdapter as unknown as DatabaseAdapter<'data'>;
    await expect(
      adapter.query({ table: { schema: null, name: 'orders' } }),
    ).rejects.toMatchObject({ name: 'AdapterError', code: 'PERMISSION' });
    await expect(
      adapter.sample({ schema: null, name: 'orders' }, { purpose: 'preview' }),
    ).rejects.toMatchObject({ code: 'PERMISSION' });
  });

  it('introspect() is runtime-guarded on the data role', async () => {
    const adapter = new mod.MysqlAdapter<'data'>('data');
    await adapter.connect({ role: 'data', dsn: dsnFor(db) });
    try {
      const asIntrospect = adapter as unknown as DatabaseAdapter<'introspect'>;
      await expect(asIntrospect.introspect()).rejects.toMatchObject({ code: 'PERMISSION' });
      await expect(
        (adapter as DatabaseAdapter<'data'>).query({ table: { schema: null, name: 'orders' } }),
      ).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    } finally {
      await adapter.close();
    }
  });

  it('connect() rejects a mismatched role brand', async () => {
    const adapter = new mod.MysqlAdapter<'introspect'>('introspect');
    await expect(
      adapter.connect({ role: 'data', dsn: dsnFor(db) } as unknown as IntrospectConnectionConfig),
    ).rejects.toMatchObject({ code: 'PERMISSION' });
  });

  it('test() against an unreachable host maps to HOST_UNREACHABLE', async () => {
    const adapter = new mod.MysqlAdapter<'introspect'>('introspect');
    await adapter.connect({ role: 'introspect', dsn: 'mysql://root@127.0.0.1:59999/nope' });
    try {
      const result = await adapter.test();
      expect(result.ok).toBe(false);
      expect(result.error).toBeInstanceOf(AdapterError);
      expect(result.error?.code).toBe('HOST_UNREACHABLE');
    } finally {
      await adapter.close();
    }
  });

  it('close() is idempotent', async () => {
    const adapter = new mod.MysqlAdapter<'introspect'>('introspect');
    await adapter.connect({ role: 'introspect', dsn: dsnFor(db) });
    await adapter.close();
    await adapter.close();
  });

  it('register() wires the provider into a registry', () => {
    const registry = new AdapterRegistry<AdapterProvider>();
    mod.register(registry);
    expect(registry.get('mysql')).toBe(mod.mysqlAdapter);
    expect(registry.list()).toEqual(['mysql']);
  });
});

describe.skipIf(!liveReady)('enums, checks, generated columns (extras database)', () => {
  let mod: AdapterModule;
  let db = '';
  let model: DatabaseModel;

  beforeAll(async () => {
    mod = await import('../src/index.js');
    db = await createTestDatabase(false);
    await runSql(
      `CREATE TABLE tickets (
         id bigint unsigned NOT NULL AUTO_INCREMENT,
         status enum('open', 'pending', 'closed') NOT NULL DEFAULT 'open' COMMENT 'Workflow state',
         priority varchar(10) NOT NULL DEFAULT 'medium',
         labels set('bug', 'feature', 'chore'),
         is_urgent tinyint(1) NOT NULL DEFAULT 0,
         code varchar(12) NOT NULL,
         title text NOT NULL,
         title_upper varchar(255) GENERATED ALWAYS AS (upper(title)) STORED,
         meta json,
         created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
         score decimal(6,2),
         PRIMARY KEY (id),
         UNIQUE KEY tickets_code_key (code),
         CONSTRAINT tickets_priority_check CHECK (priority IN ('low', 'medium', 'high'))
       ) COMMENT = 'Support tickets';
       CREATE VIEW open_tickets AS SELECT id, title FROM tickets WHERE status = 'open';`,
      db,
    );
    const adapter = new mod.MysqlAdapter<'introspect'>('introspect');
    await adapter.connect({ role: 'introspect', dsn: dsnFor(db) });
    try {
      model = await adapter.introspect();
    } finally {
      await adapter.close();
    }
  }, 120_000);

  afterAll(async () => {
    if (db !== '') await dropTestDatabase(db);
  });

  const ticketsColumn = (name: string) =>
    model.tables.find((t) => t.name === 'tickets')?.columns.find((c) => c.name === name);

  it('maps enum columns with ordered values (source column-type)', () => {
    const def = model.enums.find((e) => e.id === `${db}.tickets.status`);
    expect(def).toMatchObject({
      values: ['open', 'pending', 'closed'],
      source: 'column-type',
    });
    expect(ticketsColumn('status')).toMatchObject({
      logicalType: 'enum',
      enumRef: `${db}.tickets.status`,
      comment: 'Workflow state',
    });
  });

  it('synthesizes a check EnumDef and keeps table/column comments', () => {
    const def = model.enums.find((e) => e.id === `${db}.tickets.priority`);
    expect(def).toMatchObject({ values: ['low', 'medium', 'high'], source: 'check' });
    expect(model.tables.find((t) => t.name === 'tickets')?.comment).toBe('Support tickets');
  });

  it('maps set(...) to text with a warning, tinyint(1) to boolean', () => {
    expect(ticketsColumn('labels')?.logicalType).toBe('text');
    expect(model.warnings.some((w) => w.code === 'set-as-text')).toBe(true);
    expect(ticketsColumn('is_urgent')?.logicalType).toBe('boolean');
  });

  it('classifies auto_increment / now defaults and generated columns', () => {
    expect(ticketsColumn('id')).toMatchObject({
      default: { kind: 'autoincrement' },
      isPrimaryKey: true,
    });
    expect(ticketsColumn('created_at')).toMatchObject({
      logicalType: 'timestamptz',
      default: { kind: 'now' },
    });
    expect(ticketsColumn('updated_at')).toMatchObject({
      logicalType: 'timestamp',
      default: { kind: 'now' },
    });
    expect(ticketsColumn('title_upper')).toMatchObject({ isGenerated: true, default: null });
  });

  it('captures uniques and lists the view read-only-shaped', () => {
    const tickets = model.tables.find((t) => t.name === 'tickets');
    expect(tickets?.uniques).toEqual([{ name: 'tickets_code_key', columns: ['code'] }]);
    expect(ticketsColumn('code')?.isUnique).toBe(true);
    expect(model.tables.find((t) => t.name === 'open_tickets')).toMatchObject({
      kind: 'view',
      primaryKey: [],
      rowCountEstimate: null,
    });
  });
});

describe.skipIf(!liveReady)('query engine (Kysely MysqlDialect CRUD)', () => {
  let mod: AdapterModule;
  let db = '';

  beforeAll(async () => {
    mod = await import('../src/index.js');
    db = await createTestDatabase(true);
  }, 120_000);

  afterAll(async () => {
    if (db !== '') await dropTestDatabase(db);
  });

  it('exposes the Kysely dialect, quoting, and serializers, and runs CRUD', async () => {
    const { Kysely, MysqlDialect } = await import('kysely');
    const engine = mod.createQueryEngine({ role: 'data', dsn: dsnFor(db) });
    try {
      expect(engine.dialect).toBeInstanceOf(MysqlDialect);
      expect(engine.identifiers.quote('order details')).toBe('`order details`');
      expect(engine.identifiers.maxLength).toBe(64);
      expect(engine.serializers.bigint).toBeDefined();
      expect(engine.serializers.binary).toBeUndefined();

      interface Shipper {
        shipper_id: number;
        company_name: string;
        phone: string | null;
      }
      const kysely = new Kysely<{ shippers: Shipper }>({
        dialect: engine.dialect as InstanceType<typeof MysqlDialect>,
      });
      // INSERT (no RETURNING on MySQL — re-select by key, 05 §4.2)
      await kysely
        .insertInto('shippers')
        .values({ shipper_id: 99, company_name: 'Test Freight', phone: null })
        .execute();
      const inserted = await kysely
        .selectFrom('shippers')
        .selectAll()
        .where('shipper_id', '=', 99)
        .executeTakeFirst();
      expect(inserted).toMatchObject({ company_name: 'Test Freight' });
      // UPDATE
      await kysely
        .updateTable('shippers')
        .set({ phone: '555-0000' })
        .where('shipper_id', '=', 99)
        .execute();
      const updated = await kysely
        .selectFrom('shippers')
        .select('phone')
        .where('shipper_id', '=', 99)
        .executeTakeFirst();
      expect(updated?.phone).toBe('555-0000');
      // DELETE
      const deleted = await kysely
        .deleteFrom('shippers')
        .where('shipper_id', '=', 99)
        .executeTakeFirst();
      expect(Number(deleted.numDeletedRows)).toBe(1);
      // NOTE: no kysely.destroy() — the engine owns the pool; destroying both
      // would double-end it. engine.destroy() below tears everything down.
    } finally {
      await engine.destroy();
      await engine.destroy(); // idempotent
    }
  });

  // The server's create route contract (apps/server routes/data insertRow):
  // MySQL has no RETURNING, so create is insert-bare + re-select by key. This
  // pins the driver semantics that contract rests on, against real mysql:8.4.
  it('create-and-refetch without RETURNING: provided, composite, and auto-increment PKs', async () => {
    const { Kysely } = await import('kysely');
    await runSql(
      `CREATE TABLE e2e_composite (
         a int NOT NULL,
         b int NOT NULL,
         note varchar(20) NOT NULL DEFAULT 'dflt',
         PRIMARY KEY (a, b)
       );
       CREATE TABLE e2e_auto (
         id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
         name varchar(20) NOT NULL,
         status varchar(8) NOT NULL DEFAULT 'new'
       );`,
      db,
    );
    const engine = mod.createQueryEngine({ role: 'data', dsn: dsnFor(db) });
    try {
      interface Customer {
        customer_id: string;
        company_name: string;
      }
      interface Composite {
        a: number;
        b: number;
        note?: string;
      }
      interface Auto {
        id?: number;
        name: string;
        status?: string;
      }
      const kysely = new Kysely<{ customers: Customer; e2e_composite: Composite; e2e_auto: Auto }>({
        dialect: engine.dialect as import('kysely').Dialect,
      });

      // 1. RETURNING is a parse error on MySQL — the exact e2e-c5 500 — and
      //    the failed statement must insert NOTHING.
      await expect(
        kysely
          .insertInto('customers')
          .values({ customer_id: 'E2E01', company_name: 'E2E Markets' })
          .returningAll()
          .executeTakeFirstOrThrow(),
      ).rejects.toMatchObject({ code: 'ER_PARSE_ERROR' });
      const afterFail = await kysely
        .selectFrom('customers')
        .selectAll()
        .where('customer_id', '=', 'E2E01')
        .executeTakeFirst();
      expect(afterFail).toBeUndefined();

      // 2. Provided char(5) PK: bare insert reports NO usable insertId (the
      //    packet says 0 — kysely maps that to undefined), so the refetch
      //    must key off the PROVIDED PK value.
      const insertResult = await kysely
        .insertInto('customers')
        .values({ customer_id: 'E2E01', company_name: 'E2E Markets' })
        .executeTakeFirstOrThrow();
      expect(insertResult.insertId).toBeUndefined();
      expect(Number(insertResult.numInsertedOrUpdatedRows)).toBe(1);
      const created = await kysely
        .selectFrom('customers')
        .selectAll()
        .where('customer_id', '=', 'E2E01')
        .executeTakeFirst();
      expect(created).toMatchObject({ customer_id: 'E2E01', company_name: 'E2E Markets' });

      // 3. Composite PK: both components provided → refetch by both; the
      //    stored row carries the column default the payload omitted.
      const compositeResult = await kysely
        .insertInto('e2e_composite')
        .values({ a: 7, b: 9 })
        .executeTakeFirstOrThrow();
      expect(compositeResult.insertId).toBeUndefined();
      const compositeRow = await kysely
        .selectFrom('e2e_composite')
        .selectAll()
        .where('a', '=', 7)
        .where('b', '=', 9)
        .executeTakeFirst();
      expect(compositeRow).toMatchObject({ a: 7, b: 9, note: 'dflt' });

      // 4. Auto-increment PK omitted → insertId addresses the new row.
      const autoResult = await kysely
        .insertInto('e2e_auto')
        .values({ name: 'first' })
        .executeTakeFirstOrThrow();
      expect(autoResult.insertId).toBeGreaterThan(0n);
      const autoRow = await kysely
        .selectFrom('e2e_auto')
        .selectAll()
        .where('id', '=', Number(autoResult.insertId))
        .executeTakeFirst();
      expect(autoRow).toMatchObject({ name: 'first', status: 'new' });

      // 5. Explicit NULL for the auto column is mysql's "generate it" —
      //    insertId must still address the row (the server treats NULL PK
      //    payload values as not-provided for exactly this reason).
      const nullResult = await kysely
        .insertInto('e2e_auto')
        .values({ id: null as unknown as number, name: 'second' })
        .executeTakeFirstOrThrow();
      expect(nullResult.insertId).toBeGreaterThan(autoResult.insertId as bigint);
    } finally {
      await engine.destroy();
    }
  });
});

describe.skipIf(!liveReady)('collectTableStats (data role — 06 §4.2 statistics)', () => {
  let mod: AdapterModule;
  let db = '';
  let dataAdapter: DatabaseAdapter<'data'>;

  const table = { schema: null, name: 'people' };
  const cols: StatsColumnInput[] = [
    { name: 'email', logicalType: 'varchar', piiSuspected: true },
    { name: 'city', logicalType: 'varchar' },
    { name: 'age', logicalType: 'integer' },
  ];

  beforeAll(async () => {
    mod = await import('../src/index.js');
    db = await createTestDatabase(false);
    await runSql(
      `CREATE TABLE people (id int AUTO_INCREMENT PRIMARY KEY, email varchar(255), city varchar(255), age int);
       INSERT INTO people (email, city, age) VALUES
         ('a@x.com', 'Paris', 30),
         ('b@x.com', 'Paris', NULL),
         ('c@x.com', 'Berlin', 40),
         (NULL, 'Berlin', 25),
         ('e@x.com', NULL, 50);`,
      db,
    );
    dataAdapter = new mod.MysqlAdapter<'data'>('data');
    await dataAdapter.connect({ role: 'data', dsn: dsnFor(db) });
  }, 120_000);

  afterAll(async () => {
    await dataAdapter?.close();
    if (db !== '') await dropTestDatabase(db);
  });

  it('is sample-free by default — aggregates only, no cell values leak', async () => {
    const stats = await dataAdapter.collectTableStats(table, { columns: cols });
    // TABLE_ROWS is below the estimate threshold → exact COUNT(*) fallback.
    expect(stats.rowCountEstimate).toBe(5);
    expect(stats.rowCountExact).toBe(true);
    expect(stats.sampled).toBe(false);
    for (const column of stats.columns) {
      expect(column.min).toBeUndefined();
      expect(column.max).toBeUndefined();
      expect(column.sampleValues).toBeUndefined();
    }
    const city = stats.columns.find((c) => c.column === 'city');
    expect(city?.nullFraction).toBeCloseTo(0.2);
    expect(city?.distinctCount).toBe(2);
    const json = JSON.stringify(stats);
    expect(json).not.toContain('Paris');
    expect(json).not.toContain('a@x.com');
  });

  it('under sampling opt-in, PII columns never contribute values', async () => {
    const stats = await dataAdapter.collectTableStats(table, {
      columns: cols,
      sampling: { maxValuesPerColumn: 10 },
    });
    expect(stats.sampled).toBe(true);

    const email = stats.columns.find((c) => c.column === 'email');
    expect(email?.sampleValues).toBeUndefined();
    expect(email?.min).toBeUndefined();
    expect(email?.max).toBeUndefined();

    const city = stats.columns.find((c) => c.column === 'city');
    expect(city?.sampleValues).toEqual(expect.arrayContaining(['Paris', 'Berlin']));

    const age = stats.columns.find((c) => c.column === 'age');
    expect(age?.min).toBe(25);
    expect(age?.max).toBe(50);

    expect(JSON.stringify(stats)).not.toContain('a@x.com');
  });

  it('is runtime-guarded on the introspect role', async () => {
    const introspect = new mod.MysqlAdapter<'introspect'>('introspect');
    await introspect.connect({ role: 'introspect', dsn: dsnFor(db) });
    try {
      await expect(
        (introspect as unknown as DatabaseAdapter<'data'>).collectTableStats(table),
      ).rejects.toMatchObject({ code: 'PERMISSION' });
    } finally {
      await introspect.close();
    }
  });
});
