/**
 * Dialect-parameterized test harness (07-meta-store.md 07-T07 / 15-quality.md):
 * every suite iterates TEST_DIALECTS with `describe.skipIf(!d.available)`.
 * SQLite (better-sqlite3, in-memory) always runs; PostgreSQL and MySQL join
 * in when TEST_PG_URL / TEST_MYSQL_URL are set and the driver is installed.
 */

import { createRequire } from 'node:module';

import { sql } from 'kysely';

import type { MetaDb } from '../../src/index.js';
import {
  createMysqlMetaDb,
  createPostgresMetaDb,
  createSqliteMetaDb,
  initMetaDb,
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

/** Drop every adminium_* table so shared PG/MySQL databases start clean. */
async function dropAdminiumTables(meta: MetaDb): Promise<void> {
  const tables = await meta.db.introspection.getTables();
  const adminium = tables.map((t) => t.name).filter((n) => n.startsWith('adminium_'));
  if (adminium.length === 0) return;
  if (meta.dialect === 'mysql') {
    await sql`SET FOREIGN_KEY_CHECKS = 0`.execute(meta.db);
    for (const name of adminium) {
      await meta.db.schema.dropTable(name).ifExists().execute();
    }
    await sql`SET FOREIGN_KEY_CHECKS = 1`.execute(meta.db);
  } else {
    for (const name of adminium) {
      await sql.raw(`DROP TABLE IF EXISTS "${name}" CASCADE`).execute(meta.db);
    }
  }
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
  available: Boolean(process.env.TEST_PG_URL) && resolvable('pg'),
  async make() {
    const { default: pg } = await import('pg');
    // ts columns are int8: parse to JS number (values < 2^53).
    pg.types.setTypeParser(20, (v: string) => Number(v));
    const meta = createPostgresMetaDb({
      pool: new pg.Pool({ connectionString: process.env.TEST_PG_URL, max: 4 }),
    });
    await dropAdminiumTables(meta);
    return { meta, destroy: () => meta.db.destroy() };
  },
};

const mysqlDialect: TestDialect = {
  name: 'mysql',
  available: Boolean(process.env.TEST_MYSQL_URL) && resolvable('mysql2'),
  async make() {
    const { createPool } = await import('mysql2');
    const meta = createMysqlMetaDb({
      pool: createPool({ uri: process.env.TEST_MYSQL_URL, connectionLimit: 4 }),
    });
    await dropAdminiumTables(meta);
    return { meta, destroy: () => meta.db.destroy() };
  },
};

export const TEST_DIALECTS: readonly TestDialect[] = [sqliteDialect, postgresDialect, mysqlDialect];

/** Physical table names present in the database. */
export async function listTables(meta: MetaDb): Promise<string[]> {
  const tables = await meta.db.introspection.getTables();
  return tables.map((t) => t.name).sort();
}
