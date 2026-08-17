// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Live introspection tests, gated on the better-sqlite3 driver (the standing
 * rule: suites skip cleanly pre-install). The headline assertions: loading
 * `fixtures/northwind.sqlite.sql` into a temp file and introspecting yields
 * the golden shape — the same 14 tables/FKs as the postgres reference
 * fixture — plus the §4.3 SQLite-specific behaviors: exact small-file
 * counts, sqlite_stat1 estimates, CHECK-enum synthesis from DDL, generated
 * columns, WITHOUT ROWID / STRICT flags, and declared-type hints.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parseDatabaseModel, type DatabaseModel } from '@adminium/engine/adapter';

import {
  createTestDatabase,
  makeTempDir,
  removeTempDir,
  sqliteDriverAvailable,
} from './harness.js';

const driverReady = await sqliteDriverAvailable();

type AdapterModule = typeof import('../src/index.js');

describe.skipIf(!driverReady)('northwind fixture golden shape (file database)', () => {
  let mod: AdapterModule;
  let dir = '';
  let file = '';
  let model: DatabaseModel;

  beforeAll(async () => {
    mod = await import('../src/index.js');
    dir = makeTempDir();
    file = await createTestDatabase(dir, true);
    const adapter = new mod.SqliteAdapter<'introspect'>('introspect');
    await adapter.connect({ role: 'introspect', file });
    try {
      model = await adapter.introspect();
    } finally {
      await adapter.close();
    }
  }, 60_000);

  afterAll(() => {
    if (dir !== '') removeTempDir(dir);
  });

  const table = (name: string) => model.tables.find((t) => t.id === `main.${name}`);

  it('is a valid DatabaseModel per the engine Zod contract', () => {
    expect(() => parseDatabaseModel(JSON.stringify(model))).not.toThrow();
    expect(model).toMatchObject({
      dialect: 'sqlite',
      defaultSchema: 'main',
      schemas: ['main'],
    });
    expect(model.capabilities).toMatchObject({
      hasEnums: false,
      hasSchemas: false,
      hasComments: false,
      supportsReturning: true,
      maxIdentifierLength: 128,
    });
  });

  it('introspects all 14 northwind tables', () => {
    expect(model.tables).toHaveLength(14);
    expect(model.tables.map((t) => t.name)).toContain('order_details');
    expect(model.stats.tableCount).toBe(14);
  });

  it('maps composite PKs and declared types through the affinity rules', () => {
    expect(table('order_details')?.primaryKey).toEqual(['order_id', 'product_id']);
    const products = table('products');
    expect(products?.columns.find((c) => c.name === 'product_name')).toMatchObject({
      logicalType: 'varchar',
      maxLength: 40,
      dbType: 'varchar(40)',
    });
    expect(products?.columns.find((c) => c.name === 'unit_price')?.logicalType).toBe('float');
    expect(table('categories')?.columns.find((c) => c.name === 'picture')?.logicalType).toBe(
      'binary',
    );
    expect(table('orders')?.columns.find((c) => c.name === 'order_date')?.logicalType).toBe(
      'date',
    );
  });

  it('detects the self-referential employees.reports_to FK', () => {
    const selfFk = model.relations.find((r) => r.selfReferential);
    expect(selfFk?.id).toBe('fk:main.employees(reports_to)->main.employees(employee_id)');
  });

  it('mirrors declared FKs onto columns', () => {
    expect(table('orders')?.columns.find((c) => c.name === 'customer_id')?.references).toEqual({
      tableId: 'main.customers',
      column: 'customer_id',
    });
    expect(model.relations.filter((r) => r.kind === 'declared-fk').length).toBeGreaterThanOrEqual(
      10,
    );
  });

  it('collects EXACT small-file counts (the §4.3 exception, rowCountExact)', () => {
    expect(table('categories')).toMatchObject({ rowCountEstimate: 8, rowCountExact: true });
    expect(table('employees')).toMatchObject({ rowCountEstimate: 9, rowCountExact: true });
    expect(table('order_details')).toMatchObject({ rowCountEstimate: 52, rowCountExact: true });
  });

  it('honors collectRowEstimates=false (no COUNT statements)', async () => {
    const adapter = new mod.SqliteAdapter<'introspect'>('introspect');
    await adapter.connect({ role: 'introspect', file });
    try {
      const bare = await adapter.introspect({ collectRowEstimates: false });
      expect(bare.tables.every((t) => t.rowCountEstimate === null)).toBe(true);
    } finally {
      await adapter.close();
    }
  });

  it('honors tableFilter, skipping filtered FK targets with a warning', async () => {
    const adapter = new mod.SqliteAdapter<'introspect'>('introspect');
    await adapter.connect({ role: 'introspect', file });
    try {
      const filtered = await adapter.introspect({
        tableFilter: ({ name }) => name !== 'orders',
      });
      expect(filtered.tables.some((t) => t.name === 'orders')).toBe(false);
      expect(filtered.relations.some((r) => r.id.includes('main.orders'))).toBe(false);
      expect(filtered.warnings.some((w) => w.code === 'fk-target-excluded')).toBe(true);
    } finally {
      await adapter.close();
    }
  });
});

describe.skipIf(!driverReady)('§4.3 specifics (extras database)', () => {
  let mod: AdapterModule;
  let dir = '';
  let model: DatabaseModel;

  const EXTRAS_SQL = `
    CREATE TABLE tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL DEFAULT 'open'
        CONSTRAINT tickets_status_check CHECK (status IN ('open', 'pending', 'closed')),
      code varchar(12) NOT NULL UNIQUE,
      title TEXT NOT NULL,
      title_upper TEXT GENERATED ALWAYS AS (upper(title)) STORED,
      is_urgent BOOLEAN NOT NULL DEFAULT 0,
      due_on DATE,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      external_ref UUID,
      meta JSON,
      score DECIMAL(6,2),
      untyped
    );
    CREATE INDEX tickets_due_idx ON tickets (due_on);
    CREATE TABLE pairs (
      a TEXT NOT NULL,
      b TEXT NOT NULL,
      PRIMARY KEY (a, b)
    ) WITHOUT ROWID;
    CREATE TABLE strict_types (
      id INTEGER PRIMARY KEY,
      payload ANY,
      label TEXT
    ) STRICT;
    CREATE VIEW open_tickets AS SELECT id, title FROM tickets WHERE status = 'open';
    INSERT INTO tickets (status, code, title) VALUES ('open', 'T-1', 'First');
    ANALYZE;
  `;

  beforeAll(async () => {
    mod = await import('../src/index.js');
    dir = makeTempDir();
    const file = await createTestDatabase(dir, false, EXTRAS_SQL);
    const adapter = new mod.SqliteAdapter<'introspect'>('introspect');
    await adapter.connect({ role: 'introspect', file });
    try {
      model = await adapter.introspect();
    } finally {
      await adapter.close();
    }
  }, 60_000);

  afterAll(() => {
    if (dir !== '') removeTempDir(dir);
  });

  const ticketsColumn = (name: string) =>
    model.tables.find((t) => t.name === 'tickets')?.columns.find((c) => c.name === name);

  it('synthesizes a check EnumDef from the DDL (source check, hasEnums false)', () => {
    const def = model.enums.find((e) => e.id === 'main.tickets.status');
    expect(def).toMatchObject({
      name: 'status',
      values: ['open', 'pending', 'closed'],
      source: 'check',
    });
    expect(ticketsColumn('status')).toMatchObject({
      logicalType: 'text',
      enumRef: 'main.tickets.status',
      default: { kind: 'literal', text: "'open'" },
    });
    expect(
      model.tables.find((t) => t.name === 'tickets')?.checks.some(
        (c) => c.name === 'tickets_status_check',
      ),
    ).toBe(true);
  });

  it('AUTOINCREMENT / INTEGER PRIMARY KEY → autoincrement default', () => {
    expect(ticketsColumn('id')).toMatchObject({
      logicalType: 'integer',
      isPrimaryKey: true,
      default: { kind: 'autoincrement' },
    });
    // WITHOUT ROWID composite PK gets no synthetic autoincrement.
    const pairs = model.tables.find((t) => t.name === 'pairs');
    expect(pairs?.primaryKey).toEqual(['a', 'b']);
    expect(pairs?.columns.every((c) => c.default === null)).toBe(true);
  });

  it('maps declared-type hints: BOOLEAN, DATETIME, DATE, UUID, JSON', () => {
    expect(ticketsColumn('is_urgent')?.logicalType).toBe('boolean');
    expect(ticketsColumn('created_at')).toMatchObject({
      logicalType: 'timestamp',
      default: { kind: 'now' },
    });
    expect(ticketsColumn('due_on')?.logicalType).toBe('date');
    expect(ticketsColumn('external_ref')?.logicalType).toBe('uuid');
    expect(ticketsColumn('meta')?.logicalType).toBe('json');
    expect(ticketsColumn('score')).toMatchObject({
      logicalType: 'decimal',
      numericPrecision: 6,
      numericScale: 2,
    });
  });

  it('untyped columns become unknown with a Studio hint warning', () => {
    expect(ticketsColumn('untyped')?.logicalType).toBe('unknown');
    expect(model.warnings.some((w) => w.code === 'untyped-column')).toBe(true);
  });

  it('STRICT tables skip the hint layer; ANY maps to unknown', () => {
    const strictTable = model.tables.find((t) => t.name === 'strict_types');
    expect(strictTable?.columns.find((c) => c.name === 'payload')?.logicalType).toBe('unknown');
    expect(strictTable?.columns.find((c) => c.name === 'label')?.logicalType).toBe('text');
  });

  it('detects generated columns (table_xinfo hidden 2/3)', () => {
    expect(ticketsColumn('title_upper')).toMatchObject({ isGenerated: true, default: null });
  });

  it('captures uniques and indexes; UNIQUE column flag set', () => {
    const tickets = model.tables.find((t) => t.name === 'tickets');
    expect(ticketsColumn('code')?.isUnique).toBe(true);
    expect(tickets?.indexes.some((i) => i.name === 'tickets_due_idx')).toBe(true);
    expect(tickets?.uniques.length).toBe(1);
  });

  it('prefers sqlite_stat1 estimates after ANALYZE (rowCountExact false)', () => {
    const tickets = model.tables.find((t) => t.name === 'tickets');
    expect(tickets?.rowCountEstimate).toBe(1);
    expect(tickets?.rowCountExact).toBe(false);
  });

  it('lists views read-only-shaped (no PK, no estimate)', () => {
    expect(model.tables.find((t) => t.name === 'open_tickets')).toMatchObject({
      kind: 'view',
      primaryKey: [],
      rowCountEstimate: null,
    });
  });
});
