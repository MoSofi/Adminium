/**
 * Meta-store Kysely factories (07-meta-store.md §1 connect.ts, §5.2).
 *
 * Database drivers are injected by the caller (apps/server or tests):
 * each factory accepts the corresponding Kysely dialect config carrying a
 * live driver instance/pool — this package declares no driver dependencies.
 *
 * The meta instance runs `CamelCasePlugin` (07-meta-store.md §2.2): TS models
 * are camelCase, physical columns snake_case. The dynamic source-DB instance
 * (owned by the server) keeps raw names and never touches adminium_* tables.
 */

import {
  CamelCasePlugin,
  Kysely,
  MysqlDialect,
  PostgresDialect,
  SqliteDialect,
  type Dialect,
  type MysqlDialectConfig,
  type PostgresDialectConfig,
  type SqliteDialectConfig,
} from 'kysely';

import type { MetaDialect } from './columns.js';
import { enableSqliteForeignKeys } from './migrator.js';
import type { MetaDB } from './schema/tables.js';

/** The single handle every repo and the migrator operate on. */
export interface MetaDb {
  db: Kysely<MetaDB>;
  dialect: MetaDialect;
}

function build(dialect: MetaDialect, kyselyDialect: Dialect): MetaDb {
  return {
    db: new Kysely<MetaDB>({
      dialect: kyselyDialect,
      // Case-mapping is for COLUMN names only. Without maintainNestedObjectKeys
      // the plugin also recursively camelCases plain-object VALUES — which
      // silently corrupts driver-decoded JSON payloads (pg `jsonb` and mysql2
      // `json` return parsed objects): a stored {"en_US": …} label came back
      // {"enUS": …}. SQLite never hit it because its JSON is text.
      plugins: [new CamelCasePlugin({ maintainNestedObjectKeys: true })],
    }),
    dialect,
  };
}

/**
 * SQLite meta-store around an injected better-sqlite3-compatible database.
 * Call {@link initMetaDb} (or `applyMigrations`/`firstRun`, which do it for
 * you) before FK-dependent work — SQLite needs `PRAGMA foreign_keys = ON`
 * per connection (07-meta-store.md §2.2).
 */
export function createSqliteMetaDb(config: SqliteDialectConfig): MetaDb {
  return build('sqlite', new SqliteDialect(config));
}

/**
 * PostgreSQL meta-store around an injected `pg` Pool. The pool must parse
 * int8 as JS number (all ts values < 2^53 — 07-meta-store.md §2.1).
 */
export function createPostgresMetaDb(config: PostgresDialectConfig): MetaDb {
  return build('postgres', new PostgresDialect(config));
}

/** MySQL/MariaDB meta-store around an injected `mysql2` pool. */
export function createMysqlMetaDb(config: MysqlDialectConfig): MetaDb {
  return build('mysql', new MysqlDialect(config));
}

/** One-time per-connection setup (currently: SQLite FK pragma). */
export async function initMetaDb(meta: MetaDb): Promise<void> {
  if (meta.dialect === 'sqlite') await enableSqliteForeignKeys(meta.db);
}

/** Release the underlying pool/connection. */
export async function destroyMetaDb(meta: MetaDb): Promise<void> {
  await meta.db.destroy();
}
