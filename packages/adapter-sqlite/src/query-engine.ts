// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `createQueryEngine()` — the Kysely dialect factory for the SQLite data
 * connection (05-introspection-engine.md §3 `QueryEngine`, 08-server-api.md
 * §3.7 "query port").
 *
 * `@adminium/engine` does not depend on `kysely`, so `QueryEngine.dialect`
 * is typed opaquely there; `@adminium/server` casts it to `kysely.Dialect`
 * at the composition boundary. This package owns the concrete dependency.
 *
 * Supports better-sqlite3 INSTANCE INJECTION (05-T14): callers that already
 * hold an open handle (the Electron main process, tests) pass it via
 * `options.database` — the engine then never opens its own and `destroy()`
 * leaves the injected handle to its owner.
 */
import Database from 'better-sqlite3';
import { SqliteDialect, type SqliteDialectConfig } from 'kysely';

import {
  AdapterError,
  type DataConnectionConfig,
  type QueryEngine,
} from '@adminium/engine/adapter';

import { toAdapterError } from './errors.js';
import { normalizeSqliteFile } from './file.js';
import {
  SQLITE_MAX_IDENTIFIER_LENGTH,
  quoteIdentifier,
  sqliteSerializers,
} from './serialization.js';

/** The subset of a better-sqlite3 Database kysely needs (structural). */
export type InjectableDatabase = Database.Database;

export interface SqliteQueryEngineOptions {
  /** Inject an already-open handle instead of opening `config.file`. */
  database?: InjectableDatabase;
}

/** Data-role session pragmas — 05 §4.3. */
export function applyDataPragmas(db: InjectableDatabase, file: string): void {
  if (file !== ':memory:') db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
}

/**
 * Build the CRUD query port for a data-role connection. Accepts a file path /
 * DSN string or the role-branded config. The database opens lazily on first
 * query (unless injected), and `destroy()` tears it down idempotently —
 * closing only handles this engine opened itself.
 */
export function createQueryEngine(
  config: DataConnectionConfig | string,
  options: SqliteQueryEngineOptions = {},
): QueryEngine {
  const injected = options.database ?? null;
  const file =
    injected !== null
      ? null
      : typeof config === 'string'
        ? normalizeSqliteFile({ file: config })
        : normalizeSqliteFile(config);

  let owned: InjectableDatabase | null = null;
  const open = (): InjectableDatabase => {
    if (injected !== null) return injected;
    if (owned !== null) return owned;
    if (file === null || file.length === 0) {
      throw new AdapterError('UNKNOWN', 'sqlite query engine requires a file path', {
        hint: "pass { file: '/abs/path.db' } (or ':memory:'), a sqlite:// DSN, or inject a database handle",
      });
    }
    try {
      owned = new Database(file, { fileMustExist: file !== ':memory:' });
      applyDataPragmas(owned, file);
    } catch (error) {
      throw toAdapterError(error, 'sqlite open failed');
    }
    return owned;
  };

  // Kysely's SqliteDialect accepts a thunk — resolved once on first query.
  const dialectConfig: SqliteDialectConfig = {
    database: () => Promise.resolve(open()),
  };

  let destroyed = false;
  return {
    dialect: new SqliteDialect(dialectConfig),
    identifiers: { quote: quoteIdentifier, maxLength: SQLITE_MAX_IDENTIFIER_LENGTH },
    serializers: sqliteSerializers,
    async destroy(): Promise<void> {
      if (destroyed) return;
      destroyed = true;
      // Injected handles belong to their owner (Electron main, tests).
      if (owned !== null) {
        owned.close();
        owned = null;
      }
    },
  };
}
