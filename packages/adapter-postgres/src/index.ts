/**
 * @adminium/adapter-postgres — the `pg`-driver implementation of the
 * `DatabaseAdapter` contract (05-introspection-engine.md §3/§4.1, M3-T01).
 *
 * Scope in this milestone: connect/test/probeCapabilities, `introspect()`
 * (schema only — never rows), the Kysely query-engine factory, and the boot
 * registration helper. The data-role methods (`query`/`mutate`/`sample`/
 * `count`) land with 05-T05 and currently reject with a typed `UNSUPPORTED`
 * error after their role guard runs.
 */
import pg from 'pg';

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
import {
  interpretProbe,
  introspectPostgres,
  POSTGRES_CAPABILITIES,
  PROBE_SQL,
  type CatalogRow,
  type ProbeResult,
} from './introspect.js';
import { createQueryEngine } from './query-engine.js';
import { collectPostgresStats } from './stats.js';

const INTROSPECT_POOL_MAX = 5;
const DATA_POOL_MAX = 10;
const DEFAULT_STATEMENT_TIMEOUT_MS = 15_000;

export class PostgresAdapter<Role extends ConnectionRole = ConnectionRole>
  implements DatabaseAdapter<Role>
{
  readonly dialect: Dialect = 'postgres';
  readonly capabilities = { ...POSTGRES_CAPABILITIES };
  readonly role: Role;

  #pool: pg.Pool | null = null;
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
      throw new AdapterError('UNKNOWN', 'postgres connections require a DSN', {
        hint: 'pass a postgres:// connection string; TLS is honored from sslmode',
      });
    }
    const statementTimeoutMs = Math.floor(
      config.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS,
    );
    // Session setup on every new connection — 05 §4.1. Sent in the startup
    // packet (`options`) rather than an on-connect `client.query()`: the pool
    // hands a freshly-connected client to its pending waiter in the same
    // ready-for-query tick as the 'connect' event, so a fire-and-forget setup
    // query would still be in the client's queue when the waiter's query is
    // pushed — pg 8.22 deprecates that (removed in pg@9). Startup options cost
    // zero extra round trips and cannot race. Trade-offs: an explicit
    // `options` overrides any `options=` in the user DSN (rare), and
    // transaction-pooling pgbouncer rejects startup options (the previous
    // per-connection SET was equally broken there).
    const sessionOptions =
      `-c statement_timeout=${statementTimeoutMs}` +
      (this.role === 'introspect'
        ? ' -c lock_timeout=2s -c idle_in_transaction_session_timeout=10s'
        : '');
    const pool = new pg.Pool({
      connectionString: config.dsn,
      max: config.poolMax ?? (this.role === 'introspect' ? INTROSPECT_POOL_MAX : DATA_POOL_MAX),
      options: sessionOptions,
    });
    // Surface idle-client failures as pool-level noise, not process crashes.
    pool.on('error', () => {
      /* mapped when the next query fails */
    });
    this.#pool = pool;
    this.#closed = false;
  }

  #requirePool(): pg.Pool {
    if (this.#pool === null || this.#closed) {
      throw new AdapterError('UNKNOWN', 'adapter is not connected — call connect() first');
    }
    return this.#pool;
  }

  async #query(sql: string): Promise<CatalogRow[]> {
    const pool = this.#requirePool();
    try {
      const result = await pool.query(sql);
      return result.rows as CatalogRow[];
    } catch (error) {
      throw toAdapterError(error, 'postgres query failed');
    }
  }

  async #probe(): Promise<ProbeResult> {
    const rows = await this.#query(PROBE_SQL);
    return interpretProbe(rows[0] ?? {});
  }

  async test(): Promise<TestResult> {
    const startedAt = Date.now();
    try {
      const probe = await this.#probe();
      return {
        ok: true,
        latencyMs: Date.now() - startedAt,
        serverVersion: probe.serverVersion,
        currentUser: probe.roleName,
        canWrite: !probe.readOnly,
        ssl: probe.ssl,
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
    return {
      capabilities: { ...POSTGRES_CAPABILITIES },
      privileges: {
        canReadSchema: true,
        canRead: true,
        canWrite: !probe.readOnly,
        canDDL: probe.canCreate,
      },
      serverVersion: probe.serverVersion,
      currentRole: { name: probe.roleName, readOnly: probe.readOnly },
    };
  }

  /** SCHEMA ONLY — reads `pg_catalog` exclusively (05 §10). */
  async introspect(
    this: DatabaseAdapter<'introspect'>,
    opts?: IntrospectOptions,
  ): Promise<DatabaseModel> {
    const self = this as PostgresAdapter<'introspect'>;
    // Runtime guard behind the compile-time role brand (05 §3).
    if ((self.role as ConnectionRole) !== 'introspect') {
      throw new AdapterError(
        'PERMISSION',
        'introspect() is only available on the introspect-role instance',
      );
    }
    const probe = await self.#probe();
    return introspectPostgres(
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
    return (this as PostgresAdapter<'data'>).#guardDataRole('count');
  }

  async sample(
    this: DatabaseAdapter<'data'>,
    _table: TableRef,
    _opts: SampleOptions,
  ): Promise<Row[]> {
    return (this as PostgresAdapter<'data'>).#guardDataRole('sample');
  }

  async sampleColumn(
    this: DatabaseAdapter<'data'>,
    _table: TableRef,
    _column: string,
    _opts: ColumnSampleOptions,
  ): Promise<unknown[]> {
    return (this as PostgresAdapter<'data'>).#guardDataRole('sampleColumn');
  }

  async query(this: DatabaseAdapter<'data'>, _spec: QuerySpec): Promise<QueryResult> {
    return (this as PostgresAdapter<'data'>).#guardDataRole('query');
  }

  async mutate(this: DatabaseAdapter<'data'>, _spec: MutationSpec): Promise<MutationResult> {
    return (this as PostgresAdapter<'data'>).#guardDataRole('mutate');
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */

  /** Aggregate statistics for LLM enrichment (06 §4.2); sample-free by default. */
  async collectTableStats(
    this: DatabaseAdapter<'data'>,
    table: TableRef,
    opts?: CollectStatsOptions,
  ): Promise<StatsResult> {
    const self = this as PostgresAdapter<'data'>;
    if ((self.role as ConnectionRole) !== 'data') {
      throw new AdapterError(
        'PERMISSION',
        'collectTableStats() is only available on the data-role instance',
        { hint: 'statistics touch user rows and never run on the introspect connection (05 §10)' },
      );
    }
    return collectPostgresStats((sql) => self.#query(sql), table, opts);
  }

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
export const postgresAdapter: AdapterProvider = {
  dialect: 'postgres',
  async create<Role extends ConnectionRole>(
    config: ConnectionConfig<Role>,
  ): Promise<DatabaseAdapter<Role>> {
    const adapter = new PostgresAdapter<Role>(config.role);
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
    registerAdapter(postgresAdapter);
    return;
  }
  registry.register(postgresAdapter);
}

export { createQueryEngine } from './query-engine.js';
export {
  interpretProbe,
  introspectPostgres,
  parseCheckEnum,
  POSTGRES_CAPABILITIES,
  PROBE_SQL,
  type CatalogExecutor,
  type CatalogRow,
  type IntrospectContext,
  type ProbeResult,
} from './introspect.js';
export { classifyDefault, mapPostgresType, type MappedType } from './type-map.js';
export { collectPostgresStats, normalizePgDistinct, type StatsExecutor } from './stats.js';
export {
  PG_MAX_IDENTIFIER_LENGTH,
  postgresSerializers,
  quoteIdentifier,
} from './serialization.js';
export { toAdapterError } from './errors.js';

/** @deprecated M0 scaffold export; kept so early imports keep compiling. */
export const PACKAGE_NAME = '@adminium/adapter-postgres';
