// SPDX-License-Identifier: AGPL-3.0-only
/**
 * estimatedTotal() against real engines (05 §10 semantics): postgres reads
 * pg_class.reltuples, mysql reads information_schema TABLE_ROWS, sqlite always
 * refuses. Every refusal — below-threshold, missing statistics, missing table,
 * probe failure — returns null so the list pipeline runs its exact count.
 * Engine legs gate on the same availability probes as the other live suites
 * and skip green when the engine is absent.
 */

import { randomBytes } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Kysely, MysqlDialect, PostgresDialect, SqliteDialect, sql } from 'kysely';

import { estimatedTotal } from '../src/crud/list.js';
import type { SourceDatabase } from '../src/connections/manager.js';
import { createNorthwindDb, pgAvailable, psql, type TestPg } from './connections-helpers.js';

type AnyDb = Kysely<SourceDatabase>;

describe.skipIf(!pgAvailable())('estimatedTotal (live postgres, Northwind)', () => {
  let pg: TestPg;
  let db: AnyDb;

  beforeAll(async () => {
    pg = createNorthwindDb();
    const { Pool } = await import('pg');
    db = new Kysely({
      dialect: new PostgresDialect({ pool: new Pool({ connectionString: pg.dsn }) }),
    }) as AnyDb;
    // ANALYZE fully scans a table this small, so reltuples equals the exact
    // count and the threshold-1 assertion below is deterministic.
    psql(pg.database, 'ANALYZE');
  });

  afterAll(async () => {
    await db.destroy();
    pg.drop();
  });

  it('uses reltuples above the threshold and refuses below it', async () => {
    const exactRow = await sql<{ n: unknown }>`SELECT count(*)::int8 AS n FROM products`.execute(db);
    const exact = Number(exactRow.rows[0]?.n);
    expect(exact).toBeGreaterThan(0);

    await expect(estimatedTotal(db, { schema: 'public', name: 'products' }, 'postgres', 1)).resolves.toBe(
      exact,
    );
    // Default threshold (50k) dwarfs Northwind → refuse → caller runs exact.
    await expect(estimatedTotal(db, { schema: 'public', name: 'products' }, 'postgres')).resolves.toBeNull();
    await expect(
      estimatedTotal(db, { schema: 'public', name: 'no_such_table' }, 'postgres', 1),
    ).resolves.toBeNull();
  });
});

const MYSQL_URL = process.env.TEST_MYSQL_URL;

describe.skipIf(MYSQL_URL === undefined)('estimatedTotal (live mysql)', () => {
  const database = `adminium_test_est_${randomBytes(4).toString('hex')}`;
  let admin: import('mysql2/promise').Connection;
  let db: AnyDb;

  beforeAll(async () => {
    const mysqlPromise = await import('mysql2/promise');
    admin = await mysqlPromise.createConnection(MYSQL_URL as string);
    await admin.query(`CREATE DATABASE \`${database}\``);
    await admin.query(`CREATE TABLE \`${database}\`.things (id INT PRIMARY KEY)`);
    await admin.query(`INSERT INTO \`${database}\`.things (id) VALUES (1), (2), (3)`);
    // InnoDB TABLE_ROWS is an estimate; for a 3-row static table ANALYZE
    // makes it exact, keeping the threshold-1 assertion deterministic.
    await admin.query(`ANALYZE TABLE \`${database}\`.things`);

    const mysql = await import('mysql2');
    db = new Kysely({
      dialect: new MysqlDialect({ pool: mysql.default.createPool(`${MYSQL_URL}/${database}`) }),
    }) as AnyDb;
  });

  afterAll(async () => {
    await db.destroy();
    await admin.query(`DROP DATABASE \`${database}\``);
    await admin.end();
  });

  it('uses TABLE_ROWS above the threshold and refuses below it', async () => {
    await expect(estimatedTotal(db, { schema: database, name: 'things' }, 'mysql', 1)).resolves.toBe(3);
    await expect(estimatedTotal(db, { schema: database, name: 'things' }, 'mysql')).resolves.toBeNull();
    await expect(estimatedTotal(db, { schema: database, name: 'missing' }, 'mysql', 1)).resolves.toBeNull();
    // Empty schema resolves via DATABASE() on the connection.
    await expect(estimatedTotal(db, { schema: '', name: 'things' }, 'mysql', 1)).resolves.toBe(3);
  });
});

describe('estimatedTotal (sqlite)', () => {
  it('always refuses — sqlite keeps no catalog statistics', async () => {
    const BetterSqlite3 = (await import('better-sqlite3')).default;
    const db = new Kysely({
      dialect: new SqliteDialect({ database: new BetterSqlite3(':memory:') }),
    }) as AnyDb;
    await sql`CREATE TABLE t (id INTEGER PRIMARY KEY)`.execute(db);
    await sql`INSERT INTO t (id) VALUES (1), (2)`.execute(db);
    await expect(estimatedTotal(db, { schema: 'main', name: 't' }, 'sqlite', 1)).resolves.toBeNull();
    await db.destroy();
  });
});
