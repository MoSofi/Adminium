// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Test harness for the MySQL adapter live suites.
 *
 * Everything is env-gated (the standing rule: no local MySQL on dev
 * machines): set TEST_MYSQL_URL to a superuser-ish DSN, e.g.
 * `mysql://root:root@127.0.0.1:3306` — CI provides it from a `mysql:8.4`
 * service container; without it the live suites skip cleanly. Test databases
 * are named `adminium_test_adapter_<rand>` and always dropped in afterAll.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const TEST_MYSQL_URL = process.env['TEST_MYSQL_URL'] ?? '';

export const NORTHWIND_SQL_PATH = fileURLToPath(
  new URL('../fixtures/northwind.mysql.sql', import.meta.url),
);

/** True when the mysql2 driver package resolves (post-install). */
export async function mysqlDriverAvailable(): Promise<boolean> {
  try {
    await import('mysql2/promise');
    return true;
  } catch {
    return false;
  }
}

export function testDatabaseName(): string {
  return `adminium_test_adapter_${randomBytes(4).toString('hex')}`;
}

type MysqlModule = typeof import('mysql2/promise');

async function withConnection<T>(
  database: string | null,
  fn: (connection: import('mysql2/promise').Connection) => Promise<T>,
): Promise<T> {
  const mysql: MysqlModule = await import('mysql2/promise');
  const url = new URL(TEST_MYSQL_URL);
  if (database !== null) url.pathname = `/${database}`;
  const connection = await mysql.createConnection({
    uri: url.toString(),
    multipleStatements: true,
  });
  try {
    return await fn(connection);
  } finally {
    await connection.end();
  }
}

/** Run one (or many, `;`-separated) statements against `database`. */
export async function runSql(sql: string, database: string | null = null): Promise<void> {
  await withConnection(database, async (connection) => {
    await connection.query(sql);
  });
}

export async function createTestDatabase(loadNorthwind: boolean): Promise<string> {
  const db = testDatabaseName();
  await runSql(`CREATE DATABASE \`${db}\``);
  if (loadNorthwind) {
    await runSql(readFileSync(NORTHWIND_SQL_PATH, 'utf8'), db);
  }
  return db;
}

export async function dropTestDatabase(db: string): Promise<void> {
  await runSql(`DROP DATABASE IF EXISTS \`${db}\``);
}

/** DSN pointing the adapter at a specific test database. */
export function dsnFor(db: string): string {
  const url = new URL(TEST_MYSQL_URL);
  url.pathname = `/${db}`;
  return url.toString();
}

/**
 * A statement-counting `CatalogExecutor` over a dedicated connection, so
 * budget tests can assert on `count` (≤ 10 statements — 05 §10).
 */
export async function countingExecutor(db: string): Promise<{
  exec: (sql: string) => Promise<Record<string, unknown>[]>;
  count: () => number;
  close: () => Promise<void>;
}> {
  const mysql: MysqlModule = await import('mysql2/promise');
  const connection = await mysql.createConnection({ uri: dsnFor(db) });
  let statements = 0;
  return {
    exec: async (sql: string) => {
      statements += 1;
      const [rows] = await connection.query(sql);
      return rows as unknown as Record<string, unknown>[];
    },
    count: () => statements,
    close: async () => {
      await connection.end();
    },
  };
}
