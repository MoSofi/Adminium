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

/**
 * A connection pooler refusing the startup `options` packet.
 *
 * Neon (the pooled `…-pooler.…neon.tech` host its dashboard hands you by
 * default) answers `unsupported startup parameter in options: statement_timeout`;
 * pgbouncer in transaction mode says `unsupported startup parameter: options`.
 * Matching the shared prefix covers both without pinning either vendor's exact
 * wording, and the check is deliberately on the MESSAGE — the SQLSTATE varies
 * between poolers, and Neon reports this as a plain connection failure.
 */
const POOLER_REJECTS_STARTUP_OPTIONS = /unsupported startup parameter/i;

/** Does `error` (or anything it wraps) carry the pooler's refusal? */
export function isPoolerStartupRejection(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; current !== null && current !== undefined && depth < 5; depth += 1) {
    const message = (current as { message?: unknown }).message;
    if (typeof message === 'string' && POOLER_REJECTS_STARTUP_OPTIONS.test(message)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * The 05 §4.1 session settings, in both shapes: the startup-packet form (zero
 * round trips, preferred) and the `SET LOCAL` prelude used when a pooler
 * refuses it. They are built together so the two can never drift into
 * enforcing different limits.
 */
export function buildSessionSettings(
  statementTimeoutMs: number,
  introspect: boolean,
): { startupOptions: string; prelude: string } {
  const pairs: [string, string][] = [['statement_timeout', String(statementTimeoutMs)]];
  if (introspect) {
    pairs.push(['lock_timeout', '2s'], ['idle_in_transaction_session_timeout', '10s']);
  }
  return {
    startupOptions: pairs.map(([k, v]) => `-c ${k}=${v}`).join(' '),
    // Quoted values: `2s` is not a valid bare token for SET, unlike in `-c`.
    prelude: pairs.map(([k, v]) => `SET LOCAL ${k} = '${v}';`).join(' '),
  };
}

export class PostgresAdapter<Role extends ConnectionRole = ConnectionRole>
  implements DatabaseAdapter<Role>
{
  readonly dialect: Dialect = 'postgres';
  readonly capabilities = { ...POSTGRES_CAPABILITIES };
  readonly role: Role;

  #pool: pg.Pool | null = null;
  #closed = false;
  /** Rebuild inputs for the pooler fallback — see {@link PostgresAdapter.connect}. */
  #poolConfig: { connectionString: string; max: number } | null = null;
  /** The `-c …` string sent in the startup packet, or null once we stop trying. */
  #startupOptions: string | null = null;
  /** `SET LOCAL` prelude used instead of startup options on a pooled connection. */
  #sessionPrelude = '';

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
    //
    // …EXCEPT ON A CONNECTION POOLER, which refuses the startup packet outright
    // (see POOLER_REJECTS_STARTUP_OPTIONS). That is not an edge case: it is the
    // connection string Neon shows first, so this path failing meant Adminium
    // could not read a Neon database at all. `#query` therefore falls back on
    // the first rejection — rebuilding the pool without `options` and moving the
    // same settings into a `SET LOCAL` prelude (see {@link buildSessionSettings}).
    const settings = buildSessionSettings(statementTimeoutMs, this.role === 'introspect');
    this.#poolConfig = {
      connectionString: config.dsn,
      max: config.poolMax ?? (this.role === 'introspect' ? INTROSPECT_POOL_MAX : DATA_POOL_MAX),
    };
    this.#startupOptions = settings.startupOptions;
    this.#sessionPrelude = settings.prelude;
    this.#pool = this.#buildPool();
    this.#closed = false;
  }

  /** Open a pool, with the startup options only while {@link #startupOptions} stands. */
  #buildPool(): pg.Pool {
    if (this.#poolConfig === null) {
      throw new AdapterError('UNKNOWN', 'adapter is not connected — call connect() first');
    }
    const pool = new pg.Pool({
      ...this.#poolConfig,
      ...(this.#startupOptions === null ? {} : { options: this.#startupOptions }),
    });
    // Surface idle-client failures as pool-level noise, not process crashes.
    pool.on('error', () => {
      /* mapped when the next query fails */
    });
    return pool;
  }

  #requirePool(): pg.Pool {
    if (this.#pool === null || this.#closed) {
      throw new AdapterError('UNKNOWN', 'adapter is not connected — call connect() first');
    }
    return this.#pool;
  }

  async #query(sql: string): Promise<CatalogRow[]> {
    try {
      return await this.#run(sql);
    } catch (error) {
      // One-time downgrade: the server refused the startup packet, so this is a
      // pooler. Rebuild without `options` and carry the same settings per query
      // instead. Retried once, and only while #startupOptions is still set, so
      // a genuinely broken connection cannot loop.
      if (this.#startupOptions !== null && isPoolerStartupRejection(error)) {
        const stale = this.#pool;
        this.#startupOptions = null;
        this.#pool = this.#buildPool();
        // Best-effort: the stale pool never completed a connection.
        await stale?.end().catch(() => undefined);
        try {
          return await this.#run(sql);
        } catch (retryError) {
          throw toAdapterError(retryError, 'postgres query failed');
        }
      }
      throw toAdapterError(error, 'postgres query failed');
    }
  }

  /**
   * Run one statement, prefixed with the `SET LOCAL` prelude when the startup
   * packet was refused.
   *
   * `SET LOCAL` is correct precisely BECAUSE the prelude and the statement go
   * out as one simple-query message: Postgres wraps a multi-statement simple
   * query in an implicit transaction, so the setting is scoped to this batch
   * and cannot leak onto a backend that a transaction-pooling proxy hands to
   * somebody else. A bare `SET` would leak; a separate round trip would race
   * the pool's hand-off, which is what the startup packet avoided originally.
   */
  async #run(sql: string): Promise<CatalogRow[]> {
    const pool = this.#requirePool();
    const usePrelude = this.#startupOptions === null && this.#sessionPrelude !== '';
    const result = await pool.query(usePrelude ? `${this.#sessionPrelude} ${sql}` : sql);
    // A multi-statement query yields one Result per statement; ours is the last.
    const rows = Array.isArray(result) ? (result.at(-1)?.rows ?? []) : result.rows;
    return rows as CatalogRow[];
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
