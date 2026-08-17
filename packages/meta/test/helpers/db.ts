// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Dialect-parameterized test harness (07-meta-store.md 07-T07 / 15-quality.md):
 * every suite iterates TEST_DIALECTS with `describe.skipIf(!d.available)`.
 * SQLite (better-sqlite3, in-memory) always runs; PostgreSQL and MySQL join
 * in when TEST_POSTGRES_URL / TEST_MYSQL_URL are set (same env-var names the
 * rest of the wave uses — apps/e2e/tests/constants.ts, ci.yml). `pg` and
 * `mysql2` are dev dependencies of this package, so the `resolvable()` guard is
 * only a belt-and-braces check — the legs run whenever their URL is set, they
 * are not silently skipped for a missing driver.
 *
 * TEST_*_URL is a server-level DSN and may carry NO database path — CI's is
 * the bare `mysql://root:root@127.0.0.1:3306` (ci.yml). Pooling straight to a
 * bare MySQL URL means no schema is ever selected, and the very first
 * migration statement dies with ER_NO_DB_ERROR. So, exactly like
 * packages/adapter-mysql/test/harness.ts, `make()` provisions a dedicated
 * `adminium_test_meta_<rand>` database through a short-lived admin connection
 * on the server DSN, pools with that database selected, and `destroy()` drops
 * it. Per-test databases also keep vitest's parallel test files isolated —
 * a shared database + "drop adminium_* between tests" would race across
 * worker processes.
 */

import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

import type { MetaDb } from '../../src/index.js';
import {
  createMysqlMetaDb,
  createPostgresMetaDb,
  createSqliteMetaDb,
  initMetaDb,
  postgresInt8AsNumber,
} from '../../src/index.js';

const require = createRequire(import.meta.url);

function resolvable(pkg: string): boolean {
  try {
    require.resolve(pkg);
    return true;
  } catch {
    return false;
  }
}

export interface TestDb {
  meta: MetaDb;
  destroy: () => Promise<void>;
}

export interface TestDialect {
  name: 'sqlite' | 'postgres' | 'mysql';
  available: boolean;
  make: () => Promise<TestDb>;
}

/** Fresh per-test database name (adapter-mysql harness naming convention). */
export function testDatabaseName(): string {
  return `adminium_test_meta_${randomBytes(4).toString('hex')}`;
}

/**
 * Re-point a server-level DSN at `database`. Works whether the base URL is
 * bare (CI: `mysql://root:root@127.0.0.1:3306`) or already carries a path,
 * and preserves credentials, port, and query parameters.
 */
export function urlWithDatabase(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

/**
 * DSN for the Postgres ADMIN connection (CREATE/DROP DATABASE). MySQL happily
 * connects with no schema selected, but node-postgres always needs a database
 * — on a bare DSN it silently defaults to one named after the connecting user,
 * which usually does not exist. Keep the DSN's own database when it has one;
 * otherwise fall back to the standard `postgres` maintenance database.
 */
export function postgresAdminUrl(base: string): string {
  const url = new URL(base);
  if (url.pathname === '' || url.pathname === '/') url.pathname = '/postgres';
  return url.toString();
}

const sqliteDialect: TestDialect = {
  name: 'sqlite',
  available: resolvable('better-sqlite3'),
  async make() {
    const { default: BetterSqlite3 } = await import('better-sqlite3');
    const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await initMetaDb(meta);
    return { meta, destroy: () => meta.db.destroy() };
  },
};

const postgresDialect: TestDialect = {
  name: 'postgres',
  available: Boolean(process.env.TEST_POSTGRES_URL) && resolvable('pg'),
  async make() {
    const base = process.env.TEST_POSTGRES_URL as string;
    const { default: pg } = await import('pg');
    const database = testDatabaseName();
    const admin = new pg.Client({ connectionString: postgresAdminUrl(base) });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${database}"`);
    await admin.end();

    const meta = createPostgresMetaDb({
      // Per-pool, via the shared helper — not the process-global
      // `pg.types.setTypeParser(20, …)` this used to call. That global made
      // int8 parse correctly for everything in the process, which is precisely
      // how the product shipped a Postgres meta store whose every timestamp
      // came back as a string: the harnesses configured the driver and the
      // product never did.
      pool: new pg.Pool({
        connectionString: urlWithDatabase(base, database),
        max: 4,
        types: postgresInt8AsNumber(pg as unknown as Record<string, unknown>),
      }),
    });
    return {
      meta,
      destroy: async () => {
        await meta.db.destroy();
        const drop = new pg.Client({ connectionString: postgresAdminUrl(base) });
        await drop.connect();
        await drop.query(`DROP DATABASE IF EXISTS "${database}"`);
        await drop.end();
      },
    };
  },
};

const mysqlDialect: TestDialect = {
  name: 'mysql',
  available: Boolean(process.env.TEST_MYSQL_URL) && resolvable('mysql2'),
  async make() {
    const base = process.env.TEST_MYSQL_URL as string;
    const mysql = await import('mysql2/promise');

    const database = testDatabaseName();
    const admin = await mysql.createConnection({ uri: base });
    await admin.query(`CREATE DATABASE \`${database}\``);
    await admin.end();

    const { createPool } = await import('mysql2');
    const meta = createMysqlMetaDb({
      pool: createPool({ uri: urlWithDatabase(base, database), connectionLimit: 4 }),
    });
    return {
      meta,
      destroy: async () => {
        await meta.db.destroy();
        const drop = await mysql.createConnection({ uri: base });
        await drop.query(`DROP DATABASE IF EXISTS \`${database}\``);
        await drop.end();
      },
    };
  },
};

export const TEST_DIALECTS: readonly TestDialect[] = [sqliteDialect, postgresDialect, mysqlDialect];

/** Physical table names present in the database. */
export async function listTables(meta: MetaDb): Promise<string[]> {
  const tables = await meta.db.introspection.getTables();
  return tables.map((t) => t.name).sort();
}
