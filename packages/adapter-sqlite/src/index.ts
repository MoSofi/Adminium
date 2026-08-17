// SPDX-License-Identifier: AGPL-3.0-only
/**
 * @adminium/adapter-sqlite — the `better-sqlite3` implementation of the
 * `DatabaseAdapter` contract (05-introspection-engine.md §3/§4.3, M9/05-T14).
 *
 * Mirrors the postgres reference adapter: connect/test/probeCapabilities,
 * `introspect()` (schema only — pragma/sqlite_master, plus the documented
 * §4.3 small-file COUNT exception), the Kysely query-engine factory with
 * better-sqlite3 instance injection, and the boot registration helper. The
 * data-role methods (`query`/`mutate`/`sample`/`count`) follow the same
 * 05-T05 pattern and currently reject with a typed `UNSUPPORTED` error after
 * their role guard runs — CRUD goes through `createQueryEngine()`.
 *
 * The connection config is a FILE PATH (`{ file }`, `:memory:` allowed) —
 * this is the Electron/offline engine (11-electron.md). The introspect
 * instance opens `{ readonly: true, fileMustExist: true }`; the data
 * instance opens read-write with WAL/foreign_keys/busy_timeout pragmas.
 *
 * NOTE (05 §4.3): the worker-thread pool that keeps the synchronous driver
 * off the Fastify event loop is an integration follow-up — the adapter
 * facade is already Promise-based, so the pool slots in behind `#exec`
 * without any contract change.
 */
import { accessSync, constants, statSync } from 'node:fs';
import { basename } from 'node:path';

import Database from 'better-sqlite3';

import {
  AdapterError,
  adapterRegistry,
  registerAdapter,
  type AdapterProvider,
  type AdapterRegistry,
  type CapabilityProbeResult,
  type CollectStatsOptions,
  type ColumnSampleOptions,
  type ConnectionConfig,
  type ConnectionRole,
  type DatabaseAdapter,
  type DatabaseModel,
  type Dialect,
  type FilterSpec,
  type IntrospectOptions,
  type MutationResult,
  type MutationSpec,
  type QueryResult,
  type QuerySpec,
  type Row,
  type SampleOptions,
  type StatsResult,
  type TableRef,
  type TestResult,
} from '@adminium/engine/adapter';

import { toAdapterError } from './errors.js';
import { normalizeSqliteFile } from './file.js';
import {
  introspectSqlite,
  SQLITE_CAPABILITIES,
  type CatalogRow,
} from './introspect.js';
import { applyDataPragmas, createQueryEngine } from './query-engine.js';
import { collectSqliteStats } from './stats.js';

export class SqliteAdapter<Role extends ConnectionRole = ConnectionRole>
  implements DatabaseAdapter<Role>
{
  readonly dialect: Dialect = 'sqlite';
  readonly capabilities = { ...SQLITE_CAPABILITIES };
  readonly role: Role;

  #file: string | null = null;
  /** How this role's handle is actually opened (introspect is forced readonly). */
  #mode: 'readonly' | 'readwrite' = 'readwrite';
  /** What the config asked for — the read-only DETECTION signal (see connect). */
  #requestedMode: 'readonly' | 'readwrite' = 'readwrite';
  #db: Database.Database | null = null;
  #closed = false;

  constructor(role: Role) {
    this.role = role;
  }

  /** Lazy handle — the file is not opened until the first statement. */
  async connect(config: ConnectionConfig<Role>): Promise<void> {
    if (config.role !== this.role) {
      throw new AdapterError(
        'PERMISSION',
        `connection config is branded "${config.role}" but this adapter instance is "${this.role}"`,
        { hint: 'the three logical connections are never interchangeable (01-architecture.md §3)' },
      );
    }
    const file = normalizeSqliteFile(config);
    if (file === null) {
      throw new AdapterError('UNKNOWN', 'sqlite connections require a file path', {
        hint: "pass { file: '/abs/path.db' } (or ':memory:' for demo/test)",
      });
    }
    this.#file = file;
    // The introspect handle ALWAYS opens readonly (05 §4.3) — a safety measure
    // so introspection can never write, NOT a statement about whether the
    // underlying database is writable. Keep the config-requested mode separately
    // so read-only DETECTION reflects the CONNECTION, not the forced open mode:
    // otherwise every introspect probe would report the whole connection
    // read-only and block all CRUD (the data role opens readwrite).
    this.#requestedMode = config.mode ?? 'readwrite';
    this.#mode = this.role === 'introspect' ? 'readonly' : this.#requestedMode;
    this.#closed = false;
  }

  #requireDb(): Database.Database {
    if (this.#closed || this.#file === null) {
      throw new AdapterError('UNKNOWN', 'adapter is not connected — call connect() first');
    }
    if (this.#db !== null) return this.#db;
    const file = this.#file;
    try {
      if (this.#mode === 'readonly' && file !== ':memory:') {
        this.#db = new Database(file, { readonly: true, fileMustExist: true });
      } else {
        this.#db = new Database(file, { fileMustExist: file !== ':memory:' });
        if (this.role === 'data') applyDataPragmas(this.#db, file);
      }
    } catch (error) {
      throw toAdapterError(error, 'sqlite open failed');
    }
    return this.#db;
  }

  /**
   * The Promise-based executor facade over the synchronous driver — the
   * 05 §4.3 worker pool slots in behind this method without contract change.
   */
  async #exec(sql: string): Promise<CatalogRow[]> {
    const db = this.#requireDb();
    try {
      return db.prepare(sql).all() as CatalogRow[];
    } catch (error) {
      throw toAdapterError(error, 'sqlite query failed');
    }
  }

  /**
   * Read-only detection — 05 §4.3. Reflects whether the CONNECTION (the
   * underlying database file) is writable, NOT how this role opened its handle:
   * the introspect handle always opens readonly for safety, yet the connection
   * may be fully writable via the data role. Genuine read-only signals are an
   * explicit `mode: 'readonly'` config, a file the process cannot write
   * (`W_OK`), or `PRAGMA query_only = 1`.
   */
  #detectReadOnly(): boolean {
    if (this.#requestedMode === 'readonly') return true;
    const file = this.#file;
    if (file !== null && file !== ':memory:') {
      try {
        accessSync(file, constants.W_OK);
      } catch {
        return true;
      }
    }
    try {
      const queryOnly = this.#requireDb().pragma('query_only', { simple: true });
      if (queryOnly === 1 || queryOnly === '1') return true;
    } catch {
      // pragma failure never blocks detection
    }
    return false;
  }

  #serverVersion(): string {
    const row = this.#requireDb()
      .prepare('SELECT sqlite_version() AS version')
      .get() as { version?: unknown } | undefined;
    return String(row?.version ?? '');
  }

  async test(): Promise<TestResult> {
    const startedAt = Date.now();
    try {
      const version = this.#serverVersion();
      return {
        ok: true,
        latencyMs: Date.now() - startedAt,
        serverVersion: version,
        currentUser: null, // SQLite has no users
        canWrite: !this.#detectReadOnly(),
        ssl: false, // local file — no transport
      };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        serverVersion: null,
        currentUser: null,
        canWrite: false,
        ssl: false,
        error: toAdapterError(error, 'connection test failed'),
      };
    }
  }

  /** Runs on every connect/test; results persist on the connection row. */
  async probeCapabilities(): Promise<CapabilityProbeResult> {
    const version = this.#serverVersion();
    const readOnly = this.#detectReadOnly();
    return {
      capabilities: { ...SQLITE_CAPABILITIES },
      privileges: {
        canReadSchema: true,
        canRead: true,
        canWrite: !readOnly,
        canDDL: !readOnly,
      },
      serverVersion: version,
      currentRole: { name: 'local', readOnly },
    };
  }

  /** SCHEMA ONLY — pragma/sqlite_master (+ §4.3 small-file COUNT exception). */
  async introspect(
    this: DatabaseAdapter<'introspect'>,
    opts?: IntrospectOptions,
  ): Promise<DatabaseModel> {
    const self = this as SqliteAdapter<'introspect'>;
    // Runtime guard behind the compile-time role brand (05 §3).
    if ((self.role as ConnectionRole) !== 'introspect') {
      throw new AdapterError(
        'PERMISSION',
        'introspect() is only available on the introspect-role instance',
      );
    }
    const file = self.#file ?? ':memory:';
    let fileSizeBytes: number | null = null;
    if (file === ':memory:') {
      fileSizeBytes = 0; // in-memory databases always qualify for exact counts
    } else {
      try {
        fileSizeBytes = statSync(file).size;
      } catch {
        fileSizeBytes = null;
      }
    }
    const databaseName =
      file === ':memory:' ? 'memory' : basename(file).replace(/\.[^.]+$/, '');
    return introspectSqlite(
      async (sql) => self.#exec(sql),
      { connectionId: databaseName, databaseName, fileSizeBytes },
      opts,
    );
  }

  #guardDataRole(method: string): never {
    if ((this.role as ConnectionRole) !== 'data') {
      throw new AdapterError(
        'PERMISSION',
        `${method}() is only available on the data-role instance`,
        { hint: 'row-touching methods never run on the introspect connection (05 §10)' },
      );
    }
    throw new AdapterError('UNSUPPORTED', `${method}() lands with 05-T05 (dynamic Kysely CRUD)`, {
      hint: 'use createQueryEngine() for the CRUD query port in the meantime',
    });
  }

  /* eslint-disable @typescript-eslint/no-unused-vars -- 05-T05 stubs: the
     parameter lists must match the DatabaseAdapter contract exactly. */
  async count(
    this: DatabaseAdapter<'data'>,
    _table: TableRef,
    _filter?: FilterSpec,
    _opts?: { cap?: number },
  ): Promise<{ value: number; capped: boolean }> {
    return (this as SqliteAdapter<'data'>).#guardDataRole('count');
  }

  async sample(
    this: DatabaseAdapter<'data'>,
    _table: TableRef,
    _opts: SampleOptions,
  ): Promise<Row[]> {
    return (this as SqliteAdapter<'data'>).#guardDataRole('sample');
  }

  async sampleColumn(
    this: DatabaseAdapter<'data'>,
    _table: TableRef,
    _column: string,
    _opts: ColumnSampleOptions,
  ): Promise<unknown[]> {
    return (this as SqliteAdapter<'data'>).#guardDataRole('sampleColumn');
  }

  async query(this: DatabaseAdapter<'data'>, _spec: QuerySpec): Promise<QueryResult> {
    return (this as SqliteAdapter<'data'>).#guardDataRole('query');
  }

  async mutate(this: DatabaseAdapter<'data'>, _spec: MutationSpec): Promise<MutationResult> {
    return (this as SqliteAdapter<'data'>).#guardDataRole('mutate');
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */

  /** Aggregate statistics for LLM enrichment (06 §4.2); sample-free by default. */
  async collectTableStats(
    this: DatabaseAdapter<'data'>,
    table: TableRef,
    opts?: CollectStatsOptions,
  ): Promise<StatsResult> {
    const self = this as SqliteAdapter<'data'>;
    if ((self.role as ConnectionRole) !== 'data') {
      throw new AdapterError(
        'PERMISSION',
        'collectTableStats() is only available on the data-role instance',
        { hint: 'statistics touch user rows and never run on the introspect connection (05 §10)' },
      );
    }
    return collectSqliteStats((sql) => self.#exec(sql), table, opts);
  }

  /** Close the handle; idempotent. */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    const db = this.#db;
    this.#db = null;
    if (db !== null) db.close();
  }
}

/** What the server registers at boot (01-architecture.md §2.3.1). */
export const sqliteAdapter: AdapterProvider = {
  dialect: 'sqlite',
  async create<Role extends ConnectionRole>(
    config: ConnectionConfig<Role>,
  ): Promise<DatabaseAdapter<Role>> {
    const adapter = new SqliteAdapter<Role>(config.role);
    await adapter.connect(config);
    return adapter;
  },
  createQueryEngine,
};

/**
 * Boot registration helper — `@adminium/server` calls `register()` once at
 * startup; tests may pass their own registry instance.
 */
export function register(registry: AdapterRegistry<AdapterProvider> = adapterRegistry): void {
  if (registry === adapterRegistry) {
    registerAdapter(sqliteAdapter);
    return;
  }
  registry.register(sqliteAdapter);
}

export {
  applyDataPragmas,
  createQueryEngine,
  type InjectableDatabase,
  type SqliteQueryEngineOptions,
} from './query-engine.js';
export { normalizeSqliteFile, type SqliteFileConfig } from './file.js';
export { collectSqliteStats, type StatsExecutor } from './stats.js';
export {
  COLUMNS_SQL,
  EXACT_COUNT_MAX_FILE_BYTES,
  exactCountsSql,
  FOREIGN_KEYS_SQL,
  INDEX_COLUMNS_SQL,
  INDEX_LIST_SQL,
  introspectSqlite,
  MASTER_SQL,
  parseCheckEnum,
  scanCheckConstraints,
  SQLITE_CAPABILITIES,
  STAT1_SQL,
  TABLE_LIST_SQL,
  type CatalogExecutor,
  type CatalogRow,
  type IntrospectContext,
} from './introspect.js';
export {
  classifyDefault,
  mapSqliteType,
  sqliteAffinity,
  type MappedType,
  type SqliteAffinity,
} from './type-map.js';
export {
  SQLITE_MAX_IDENTIFIER_LENGTH,
  quoteIdentifier,
  sqliteSerializers,
} from './serialization.js';
export { toAdapterError } from './errors.js';

/** @deprecated M0 scaffold export; kept so early imports keep compiling. */
export const PACKAGE_NAME = '@adminium/adapter-sqlite';
