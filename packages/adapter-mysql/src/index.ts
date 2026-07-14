/**
 * @adminium/adapter-mysql — the `mysql2`-driver implementation of the
 * `DatabaseAdapter` contract (05-introspection-engine.md §3/§4.2, M9/05-T13).
 *
 * Mirrors the postgres reference adapter: connect/test/probeCapabilities,
 * `introspect()` (schema only — never rows, via `information_schema`), the
 * Kysely query-engine factory, and the boot registration helper. The
 * data-role methods (`query`/`mutate`/`sample`/`count`) follow the same
 * 05-T05 pattern and currently reject with a typed `UNSUPPORTED` error after
 * their role guard runs — CRUD goes through `createQueryEngine()`.
 *
 * Supported servers: MySQL ≥ 8.0, MariaDB ≥ 10.5 (feature-detected via
 * `VERSION()`; older versions → `UNSUPPORTED` with an upgrade hint).
 */
import { createPool, type Pool } from 'mysql2/promise';
import type { PoolConnection as CallbackPoolConnection } from 'mysql2';

import {
  AdapterError,
  adapterRegistry,
  registerAdapter,
  type AdapterProvider,
  type AdapterRegistry,
  type CapabilityProbeResult,
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
  type TableRef,
  type TestResult,
} from '@adminium/engine/adapter';

import { toAdapterError } from './errors.js';
import {
  GRANTS_SQL,
  interpretGrants,
  interpretProbe,
  introspectMysql,
  MYSQL_CAPABILITIES,
  PROBE_SQL,
  SSL_SQL,
  type CatalogRow,
  type GrantsResult,
  type ProbeResult,
} from './introspect.js';
import { createQueryEngine } from './query-engine.js';

const INTROSPECT_POOL_MAX = 5;
const DATA_POOL_MAX = 10;
const DEFAULT_STATEMENT_TIMEOUT_MS = 15_000;

export class MysqlAdapter<Role extends ConnectionRole = ConnectionRole>
  implements DatabaseAdapter<Role>
{
  readonly dialect: Dialect = 'mysql';
  readonly capabilities = { ...MYSQL_CAPABILITIES };
  readonly role: Role;

  #pool: Pool | null = null;
  #closed = false;

  constructor(role: Role) {
    this.role = role;
  }

  /** Lazy pool — no socket is opened until the first query. */
  async connect(config: ConnectionConfig<Role>): Promise<void> {
    if (config.role !== this.role) {
      throw new AdapterError(
        'PERMISSION',
        `connection config is branded "${config.role}" but this adapter instance is "${this.role}"`,
        { hint: 'the three logical connections are never interchangeable (01-architecture.md §3)' },
      );
    }
    if (config.dsn === undefined || config.dsn.length === 0) {
      throw new AdapterError('UNKNOWN', 'mysql connections require a DSN', {
        hint: 'pass a mysql:// connection string naming the database to introspect',
      });
    }
    const statementTimeoutMs = Math.floor(
      config.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS,
    );
    const pool = createPool({
      uri: config.dsn,
      connectionLimit:
        config.poolMax ?? (this.role === 'introspect' ? INTROSPECT_POOL_MAX : DATA_POOL_MAX),
    });
    // Session timeout setup on every new connection — 05 §4.2. MySQL takes
    // milliseconds (max_execution_time); MariaDB takes seconds
    // (max_statement_time) — feature-detected by trying both in order.
    const mariadbSeconds = Math.max(1, Math.ceil(statementTimeoutMs / 1000));
    // mysql2 3.22's mixin-based .d.ts don't surface query() under NodeNext
    // (TS2339 on a method that exists at runtime) — structural casts pin the
    // two callback-API signatures we use.
    type CallbackQueryable = {
      query(sql: string, cb: (error: Error | null) => void): void;
    };
    pool.pool.on('connection', (connection: CallbackPoolConnection) => {
      const conn = connection as unknown as CallbackQueryable;
      conn.query(`SET SESSION max_execution_time = ${statementTimeoutMs}`, (error) => {
        if (error !== null && error !== undefined) {
          conn.query(`SET SESSION max_statement_time = ${mariadbSeconds}`, () => {
            /* neither supported — introspection still bounded by timeoutMs */
          });
        }
      });
    });
    this.#pool = pool;
    this.#closed = false;
  }

  #requirePool(): Pool {
    if (this.#pool === null || this.#closed) {
      throw new AdapterError('UNKNOWN', 'adapter is not connected — call connect() first');
    }
    return this.#pool;
  }

  async #query(sql: string): Promise<CatalogRow[]> {
    const pool = this.#requirePool();
    try {
      // Same NodeNext mixin-typing workaround as the connection listener above.
      const queryable = pool as unknown as { query(sql: string): Promise<[unknown, unknown]> };
      const [rows] = await queryable.query(sql);
      return rows as CatalogRow[];
    } catch (error) {
      throw toAdapterError(error, 'mysql query failed');
    }
  }

  async #probe(): Promise<ProbeResult> {
    const rows = await this.#query(PROBE_SQL);
    const probe = interpretProbe(rows[0] ?? {});
    if (!probe.flavor.supported) {
      throw new AdapterError(
        'UNSUPPORTED',
        `unsupported server version "${probe.serverVersion}"`,
        {
          detail: `${probe.flavor.flavor} ${probe.flavor.major}.${probe.flavor.minor}`,
          hint: 'Adminium supports MySQL ≥ 8.0 and MariaDB ≥ 10.5 — upgrade the server to connect',
        },
      );
    }
    return probe;
  }

  /** `SHOW GRANTS` refinement — guarded, degrades to server-level read_only. */
  async #grants(databaseName: string | null): Promise<GrantsResult | null> {
    if (databaseName === null) return null;
    try {
      return interpretGrants(await this.#query(GRANTS_SQL), databaseName);
    } catch {
      return null;
    }
  }

  async #ssl(): Promise<boolean> {
    try {
      const rows = await this.#query(SSL_SQL);
      const value = rows[0]?.['Value'];
      return typeof value === 'string' && value.length > 0;
    } catch {
      return false;
    }
  }

  async test(): Promise<TestResult> {
    const startedAt = Date.now();
    try {
      const probe = await this.#probe();
      const grants = await this.#grants(probe.databaseName);
      return {
        ok: true,
        latencyMs: Date.now() - startedAt,
        serverVersion: probe.serverVersion,
        currentUser: probe.roleName,
        canWrite: !probe.readOnly && (grants?.canWrite ?? true),
        ssl: await this.#ssl(),
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
    const probe = await this.#probe();
    const grants = await this.#grants(probe.databaseName);
    const canWrite = !probe.readOnly && (grants?.canWrite ?? true);
    return {
      capabilities: {
        ...MYSQL_CAPABILITIES,
        // MariaDB ≥ 10.5 supports INSERT/DELETE … RETURNING (05 §4.2).
        supportsReturning: probe.flavor.flavor === 'mariadb',
      },
      privileges: {
        canReadSchema: true,
        canRead: grants?.canSelect ?? true,
        canWrite,
        canDDL: !probe.readOnly && (grants?.canDDL ?? false),
      },
      serverVersion: probe.serverVersion,
      currentRole: { name: probe.roleName, readOnly: !canWrite },
    };
  }

  /** SCHEMA ONLY — reads `information_schema` exclusively (05 §10). */
  async introspect(
    this: DatabaseAdapter<'introspect'>,
    opts?: IntrospectOptions,
  ): Promise<DatabaseModel> {
    const self = this as MysqlAdapter<'introspect'>;
    // Runtime guard behind the compile-time role brand (05 §3).
    if ((self.role as ConnectionRole) !== 'introspect') {
      throw new AdapterError(
        'PERMISSION',
        'introspect() is only available on the introspect-role instance',
      );
    }
    const probe = await self.#probe();
    if (probe.databaseName === null) {
      throw new AdapterError('UNKNOWN', 'the DSN names no database to introspect', {
        hint: 'add the database to the connection string path (mysql://host/db)',
      });
    }
    return introspectMysql(
      async (sql) => self.#query(sql),
      { connectionId: probe.databaseName, databaseName: probe.databaseName },
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
    return (this as MysqlAdapter<'data'>).#guardDataRole('count');
  }

  async sample(
    this: DatabaseAdapter<'data'>,
    _table: TableRef,
    _opts: SampleOptions,
  ): Promise<Row[]> {
    return (this as MysqlAdapter<'data'>).#guardDataRole('sample');
  }

  async sampleColumn(
    this: DatabaseAdapter<'data'>,
    _table: TableRef,
    _column: string,
    _opts: ColumnSampleOptions,
  ): Promise<unknown[]> {
    return (this as MysqlAdapter<'data'>).#guardDataRole('sampleColumn');
  }

  async query(this: DatabaseAdapter<'data'>, _spec: QuerySpec): Promise<QueryResult> {
    return (this as MysqlAdapter<'data'>).#guardDataRole('query');
  }

  async mutate(this: DatabaseAdapter<'data'>, _spec: MutationSpec): Promise<MutationResult> {
    return (this as MysqlAdapter<'data'>).#guardDataRole('mutate');
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */

  /** Release the pool; idempotent. */
  async close(): Promise<void> {
    if (this.#pool === null || this.#closed) return;
    this.#closed = true;
    const pool = this.#pool;
    this.#pool = null;
    await pool.end();
  }
}

/** What the server registers at boot (01-architecture.md §2.3.1). */
export const mysqlAdapter: AdapterProvider = {
  dialect: 'mysql',
  async create<Role extends ConnectionRole>(
    config: ConnectionConfig<Role>,
  ): Promise<DatabaseAdapter<Role>> {
    const adapter = new MysqlAdapter<Role>(config.role);
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
    registerAdapter(mysqlAdapter);
    return;
  }
  registry.register(mysqlAdapter);
}

export { createQueryEngine } from './query-engine.js';
export {
  checkConstraintsSql,
  columnsSql,
  detectServerFlavor,
  foreignKeysSql,
  GRANTS_SQL,
  interpretGrants,
  interpretProbe,
  introspectionStatements,
  introspectMysql,
  MYSQL_CAPABILITIES,
  parseCheckEnum,
  PROBE_SQL,
  SSL_SQL,
  statisticsSql,
  tableConstraintsSql,
  tablesSql,
  type CatalogExecutor,
  type CatalogRow,
  type GrantsResult,
  type IntrospectContext,
  type ProbeResult,
  type ServerFlavor,
} from './introspect.js';
export {
  classifyMysqlDefault,
  mapMysqlType,
  parseEnumValues,
  type MappedMysqlType,
} from './type-map.js';
export {
  MYSQL_MAX_IDENTIFIER_LENGTH,
  mysqlSerializers,
  quoteIdentifier,
} from './serialization.js';
export { toAdapterError } from './errors.js';

/** @deprecated M0 scaffold export; kept so early imports keep compiling. */
export const PACKAGE_NAME = '@adminium/adapter-mysql';
