// SPDX-License-Identifier: AGPL-3.0-only
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
 * int8 as JS number (all ts values < 2^53 — 07-meta-store.md §2.1); build it
 * with {@link postgresInt8AsNumber}.
 */
export function createPostgresMetaDb(config: PostgresDialectConfig): MetaDb {
  return build('postgres', new PostgresDialect(config));
}

/** `pg`'s OID for `bigint`/`int8`. */
const PG_INT8_OID = 20;

/**
 * The `types` option that satisfies {@link createPostgresMetaDb}'s requirement:
 * `new Pool({ …, types: postgresInt8AsNumber(pg) })`.
 *
 * The requirement was stated here and satisfiable nowhere, so every caller
 * either forgot it (the product: each `ts` column arrived as a string and
 * `GET /api/v1/bootstrap` 500'd on its own reply schema) or met it with a
 * process-global `pg.types.setTypeParser`, which papered over the callers that
 * had forgotten. Now there is one implementation, next to the contract.
 *
 * `node-postgres` decodes int8 as a string by default and is right to — int64
 * outruns `Number.MAX_SAFE_INTEGER`. The META schema does not: `columns.ts`
 * pins `ts` to epoch milliseconds and `bigint` to "values always < 2^53". So
 * this is scoped to one pool ON PURPOSE. The global equivalent is a
 * data-integrity bug waiting to happen: the server reads the USER's tables
 * through the same `pg` module, and their `bigint` ids are under no such
 * promise.
 *
 * Structurally typed over the module so this package still declares no driver
 * dependency — the caller that imports `pg` passes it in.
 */
export function postgresInt8AsNumber(pgModule: Record<string, unknown>): {
  getTypeParser: (oid: number, format?: unknown) => unknown;
} {
  const types = (pgModule.types ??
    (pgModule.default as Record<string, unknown> | undefined)?.types) as
    | { getTypeParser: (oid: number, format?: unknown) => unknown }
    | undefined;
  return {
    getTypeParser: (oid, format) =>
      oid === PG_INT8_OID ? Number : (types?.getTypeParser(oid, format) ?? String),
  };
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
