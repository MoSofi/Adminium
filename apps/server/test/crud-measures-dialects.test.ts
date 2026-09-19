// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE SAME NUMBERS ON EVERY DIALECT.
 *
 * A derived money value is only trustworthy if it does not depend on which
 * database it came out of, and the measurements this wave was designed against
 * say that is not free: Postgres truncates integer division, SQLite's per-ROW
 * storage class decides whether `sum(a*b*c/100)` loses 13 %, and pg/mysql hand
 * every aggregate back as a string while SQLite hands back a JS number. The
 * design answers each of those (no division in a fold, a post-fetch BigInt
 * factor, a canonical decimal normalizer) — this file is where the answer is
 * checked rather than argued.
 *
 * The seed varies the STORED VALUES rather than the declared types, which is
 * the SQLite trap: `100.00` is stored as an INTEGER and takes the truncating
 * path while `12.90` beside it does not, in the same column of the same query.
 *
 * Postgres and MySQL legs gate on TEST_POSTGRES_URL / TEST_MYSQL_URL, exactly
 * like every other engine leg in this suite. SQLite always runs.
 */

import { randomBytes } from 'node:crypto';

import BetterSqlite3 from 'better-sqlite3';
import { Kysely, MysqlDialect, PostgresDialect, SqliteDialect } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parseDatabaseModel, type Dialect } from '@adminium/engine/adapter';

import { applyOverrides } from '../src/connections/effective-schema.js';
import type { SourceDatabase } from '../src/connections/manager.js';
import { applyDerivedFields } from '../src/crud/derive.js';
import { SnapshotView } from '../src/crud/identifiers.js';
import { runList } from '../src/crud/list.js';
import { resolveMeasures } from '../src/crud/measures.js';
import { parseComputeParam } from '../src/crud/compute.js';

type AnyDb = Kysely<SourceDatabase>;

/** The owner's block: two folds, then the four numbers over them. */
const COMPUTE = JSON.stringify({
  measures: [
    {
      id: 'subtotal',
      table: 'public.invoice_items',
      fkColumn: 'invoice_id',
      fn: 'sum',
      of: { terms: [{ sign: 'plus', factors: ['line_total'] }] },
    },
    {
      id: 'gross',
      table: 'public.invoice_items',
      fkColumn: 'invoice_id',
      fn: 'sum',
      of: { terms: [{ sign: 'plus', factors: ['qty', 'rate'] }] },
    },
    {
      id: 'discount_fold',
      table: 'public.invoice_items',
      fkColumn: 'invoice_id',
      fn: 'sum',
      // The factor rides POST-fetch: `/100` inside this fold is what loses 13 %
      // on SQLite integer storage and truncates to 0 on Postgres.
      of: { terms: [{ sign: 'plus', factors: ['qty', 'rate', 'discount_pct'] }], factor: '0.01' },
    },
  ],
  fields: [
    {
      id: 'discount_total',
      scale: 2,
      expr: { op: 'sub', args: [{ measure: 'gross' }, { measure: 'subtotal' }] },
    },
    {
      id: 'tax_amount',
      scale: 2,
      expr: {
        op: 'mul',
        args: [{ measure: 'subtotal' }, { op: 'div', args: [{ col: 'tax_rate' }, { lit: '100' }] }],
      },
    },
    {
      id: 'total',
      scale: 2,
      expr: { op: 'add', args: [{ measure: 'subtotal' }, { field: 'tax_amount' }] },
    },
    {
      id: 'shipping',
      scale: 2,
      expr: {
        cases: [
          { when: { left: { field: 'total' }, cmp: 'gte', right: { lit: '500' } }, then: { lit: '0' } },
        ],
        else: { lit: '12.50' },
      },
    },
  ],
});

/**
 * One model for all three dialects — the identifiers a measure resolves
 * against are the snapshot's, not the driver's.
 */
function model(dialect: Dialect, schema: string) {
  return parseDatabaseModel({
    dialect,
    name: 'invdb',
    defaultSchema: schema,
    schemas: [schema],
    tables: [
      {
        schema,
        name: 'invoices',
        primaryKey: ['invoice_id'],
        columns: [
          { name: 'invoice_id', logicalType: 'integer', nullable: false, isPrimaryKey: true },
          { name: 'tax_rate', logicalType: 'decimal', nullable: false },
        ],
      },
      {
        schema,
        name: 'invoice_items',
        primaryKey: ['item_id'],
        columns: [
          { name: 'item_id', logicalType: 'integer', nullable: false, isPrimaryKey: true },
          {
            name: 'invoice_id',
            logicalType: 'integer',
            nullable: true,
            references: { tableId: `${schema}.invoices`, column: 'invoice_id' },
          },
          { name: 'qty', logicalType: 'decimal', nullable: true },
          { name: 'rate', logicalType: 'decimal', nullable: true },
          { name: 'discount_pct', logicalType: 'decimal', nullable: true },
          { name: 'line_total', logicalType: 'decimal', nullable: true },
        ],
      },
    ],
    relations: [
      {
        id: 'fk_items_invoices',
        kind: 'declared-fk',
        cardinality: 'one-to-many',
        from: { tableId: `${schema}.invoice_items`, columns: ['invoice_id'] },
        to: { tableId: `${schema}.invoices`, columns: ['invoice_id'] },
      },
    ],
  });
}

/**
 * The invoices whose numbers must match. Row 7 mirrors the real `rec30` seed;
 * row 9 has no line items (the empty-fold lattice); row 8 sits BELOW the
 * shipping threshold so the conditional takes its other branch. Values are
 * deliberately a mix of whole and fractional — that is the SQLite storage
 * class the design had to survive.
 */
const INVOICES: [number, string][] = [
  [7, '8.00'],
  [8, '8.00'],
  [9, '0'],
];
const ITEMS: [number, number, string, string, string, string][] = [
  [1, 7, '2', '500.00', '0', '1000.00'],
  [2, 7, '1', '300.00', '11.3333', '266.00'],
  [3, 8, '3', '40.00', '0', '120.00'],
];

/** What every dialect must answer, character for character. */
const EXPECTED = [
  {
    invoice_id: 7,
    subtotal: '1266',
    gross: '1300',
    discount_fold: '33.9999',
    discount_total: '34.00',
    tax_amount: '101.28',
    total: '1367.28',
    shipping: '0.00',
  },
  {
    invoice_id: 8,
    subtotal: '120',
    gross: '120',
    discount_fold: '0',
    discount_total: '0.00',
    tax_amount: '9.60',
    total: '129.60',
    shipping: '12.50',
  },
  {
    invoice_id: 9,
    subtotal: '0',
    gross: '0',
    discount_fold: '0',
    discount_total: '0.00',
    tax_amount: '0.00',
    total: '0.00',
    shipping: '12.50',
  },
];

/** Run the whole read path — measures, masking, derived fields — and shape it. */
async function computeRows(db: AnyDb, dialect: Dialect, schema: string) {
  const view = new SnapshotView('conn_test', applyOverrides(model(dialect, schema), []));
  const table = view.table(`${schema}.invoices`);
  const compute = parseComputeParam(COMPUTE.replaceAll('public.', `${schema}.`), { view, table });
  const measures = await resolveMeasures({
    view,
    table,
    specs: compute.measures,
    canReadPii: true,
    canReadTable: () => Promise.resolve(true),
  });
  const result = await runList({
    db,
    view,
    table,
    params: { order: 'invoice_id.asc', count: 'none' },
    canReadPii: true,
    dialect,
    measures,
    derivedFields: compute.fields,
    requiredColumns: compute.requiredColumns,
  });
  void applyDerivedFields; // wired inside runList; referenced so the import is honest
  return result.data.map((row) => ({
    invoice_id: Number(row['invoice_id']),
    subtotal: row['subtotal'],
    gross: row['gross'],
    discount_fold: row['discount_fold'],
    discount_total: row['discount_total'],
    tax_amount: row['tax_amount'],
    total: row['total'],
    shipping: row['shipping'],
  }));
}

// --- sqlite (always) ---------------------------------------------------------

describe('derived numbers on sqlite', () => {
  let db: AnyDb;

  beforeAll(() => {
    const sqlite = new BetterSqlite3(':memory:');
    sqlite.exec(`
      CREATE TABLE invoices (invoice_id INTEGER PRIMARY KEY, tax_rate NUMERIC NOT NULL);
      CREATE TABLE invoice_items (
        item_id INTEGER PRIMARY KEY,
        invoice_id INTEGER REFERENCES invoices(invoice_id),
        qty NUMERIC, rate NUMERIC, discount_pct NUMERIC, line_total NUMERIC
      );
    `);
    for (const [id, tax] of INVOICES) {
      sqlite.prepare('INSERT INTO invoices VALUES (?, ?)').run(id, tax);
    }
    for (const item of ITEMS) sqlite.prepare('INSERT INTO invoice_items VALUES (?,?,?,?,?,?)').run(...item);
    db = new Kysely<SourceDatabase>({ dialect: new SqliteDialect({ database: sqlite }) });
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('answers the owner’s numbers', async () => {
    await expect(computeRows(db, 'sqlite', 'main')).resolves.toEqual(EXPECTED);
  });
});

// --- postgres (TEST_POSTGRES_URL) -------------------------------------------

const POSTGRES_URL = process.env.TEST_POSTGRES_URL;

describe.skipIf(POSTGRES_URL === undefined)('derived numbers on postgres', () => {
  const schema = `adminium_test_derived_${randomBytes(4).toString('hex')}`;
  let db: AnyDb;

  beforeAll(async () => {
    const pg = await import('pg');
    db = new Kysely<SourceDatabase>({
      dialect: new PostgresDialect({ pool: new pg.default.Pool({ connectionString: POSTGRES_URL }) }),
    });
    await db.schema.createSchema(schema).execute();
    await db.executeQuery({
      sql: `CREATE TABLE ${schema}.invoices (invoice_id int PRIMARY KEY, tax_rate numeric(5,2) NOT NULL)`,
      parameters: [],
      query: { kind: 'RawNode' } as never,
      queryId: { queryId: 'x' } as never,
    });
    await db.executeQuery({
      sql: `CREATE TABLE ${schema}.invoice_items (item_id int PRIMARY KEY, invoice_id int REFERENCES ${schema}.invoices(invoice_id), qty numeric(10,2), rate numeric(12,2), discount_pct numeric(10,4), line_total numeric(12,2))`,
      parameters: [],
      query: { kind: 'RawNode' } as never,
      queryId: { queryId: 'x' } as never,
    });
    for (const [id, tax] of INVOICES) {
      await db.insertInto(`${schema}.invoices`).values({ invoice_id: id, tax_rate: tax } as never).execute();
    }
    for (const [itemId, invoiceId, qty, rate, discount, lineTotal] of ITEMS) {
      await db
        .insertInto(`${schema}.invoice_items`)
        .values({
          item_id: itemId,
          invoice_id: invoiceId,
          qty,
          rate,
          discount_pct: discount,
          line_total: lineTotal,
        } as never)
        .execute();
    }
  });

  afterAll(async () => {
    await db.schema.dropSchema(schema).cascade().execute();
    await db.destroy();
  });

  it('answers the same numbers sqlite does', async () => {
    await expect(computeRows(db, 'postgres', schema)).resolves.toEqual(EXPECTED);
  });
});

// --- mysql (TEST_MYSQL_URL) --------------------------------------------------

// `''` means absent: CI leaves this empty on a push, where mysql runs nightly.
const MYSQL_URL = process.env.TEST_MYSQL_URL || undefined;

describe.skipIf(MYSQL_URL === undefined)('derived numbers on mysql', () => {
  const database = `adminium_test_derived_${randomBytes(4).toString('hex')}`;
  let admin: import('mysql2/promise').Connection;
  let db: AnyDb;

  beforeAll(async () => {
    const mysqlPromise = await import('mysql2/promise');
    admin = await mysqlPromise.createConnection(MYSQL_URL as string);
    await admin.query(`CREATE DATABASE \`${database}\``);
    await admin.query(
      `CREATE TABLE \`${database}\`.invoices (invoice_id INT PRIMARY KEY, tax_rate DECIMAL(5,2) NOT NULL)`,
    );
    await admin.query(
      `CREATE TABLE \`${database}\`.invoice_items (item_id INT PRIMARY KEY, invoice_id INT, qty DECIMAL(10,2), rate DECIMAL(12,2), discount_pct DECIMAL(10,4), line_total DECIMAL(12,2))`,
    );
    for (const [id, tax] of INVOICES) {
      await admin.query(`INSERT INTO \`${database}\`.invoices VALUES (?, ?)`, [id, tax]);
    }
    for (const item of ITEMS) {
      await admin.query(`INSERT INTO \`${database}\`.invoice_items VALUES (?,?,?,?,?,?)`, item);
    }
    const mysql = await import('mysql2');
    db = new Kysely<SourceDatabase>({
      dialect: new MysqlDialect({ pool: mysql.default.createPool(`${MYSQL_URL}/${database}`) }),
    });
  });

  afterAll(async () => {
    await db.destroy();
    await admin.query(`DROP DATABASE \`${database}\``);
    await admin.end();
  });

  it('answers the same numbers sqlite does', async () => {
    await expect(computeRows(db, 'mysql', database)).resolves.toEqual(EXPECTED);
  });
});
