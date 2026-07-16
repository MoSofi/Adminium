/**
 * `createQueryEngine()` — the Kysely dialect factory for the pooled data
 * connection (05-introspection-engine.md §3 `QueryEngine`, 08-server-api.md
 * §3.7 "query port").
 *
 * `@adminium/engine` does not depend on `kysely`, so `QueryEngine.dialect`
 * is typed opaquely there; `@adminium/server` casts it to `kysely.Dialect`
 * at the composition boundary. This package owns the concrete dependency.
 */
import { PostgresDialect, type PostgresDialectConfig } from 'kysely';
import pg from 'pg';

import {
  AdapterError,
  type DataConnectionConfig,
  type QueryEngine,
} from '@adminium/engine/adapter';

import {
  PG_MAX_IDENTIFIER_LENGTH,
  postgresSerializers,
  quoteIdentifier,
} from './serialization.js';

const DEFAULT_DATA_POOL_MAX = 10;

/**
 * Build the CRUD query port for a data-role connection. Accepts a DSN string
 * or the role-branded config (which must carry a `dsn`). The pool is lazy —
 * no connection is opened until the first query — and `destroy()` tears it
 * down idempotently.
 */
export function createQueryEngine(config: DataConnectionConfig | string): QueryEngine {
  const dsn = typeof config === 'string' ? config : config.dsn;
  if (dsn === undefined || dsn.length === 0) {
    throw new AdapterError('UNKNOWN', 'postgres query engine requires a DSN', {
      hint: 'pass a postgres:// connection string (TLS options honored from sslmode)',
    });
  }
  const poolMax = typeof config === 'string' ? undefined : config.poolMax;
  const pool = new pg.Pool({
    connectionString: dsn,
    max: poolMax ?? DEFAULT_DATA_POOL_MAX,
  });
  // Surface idle-client failures as pool-level noise, not process crashes —
  // the same guard `createAdapter`'s pool carries in ./index.ts, which this
  // pool was missing.
  //
  // `pg` emits 'error' on the POOL when a client dies while idle in the pool
  // (nobody is awaiting a query, so there is no promise to reject). An EventEmitter
  // 'error' event with no listener is rethrown as an uncaught exception, so a
  // Postgres-side termination of an idle connection — failover, a restart, an
  // admin `pg_terminate_backend`, `DROP DATABASE ... WITH (FORCE)`, or an idle
  // timeout on the server — would take the whole Node process down rather than
  // being retried on the next checkout. Every one of those is routine operational
  // life for a long-lived data pool, and the pool recovers on its own: the dead
  // client is discarded and the next `connect()` opens a fresh one.
  //
  // Found by the M7 Wave 4 verification pass: apps/server's crud.test.ts drops its
  // test database WITH (FORCE) in `afterAll`, which terminates any client still
  // closing (57P01). That surfaced as a *rare* unhandled error failing the whole
  // `pnpm test` run — the harness merely reproduced, under load, what a production
  // failover does on purpose.
  pool.on('error', () => {
    /* mapped when the next query fails */
  });

  // Structural cast: kysely's `PostgresPool` narrows `QueryResult.command`
  // to a command-name union while `pg` types it as `string`. The runtime
  // shapes are identical (kysely's own docs pass a `pg.Pool` here), and the
  // dialect crosses the `QueryEngine` boundary as `unknown` anyway.
  const kyselyPool = pool as unknown as PostgresDialectConfig['pool'];

  let destroyed = false;
  return {
    dialect: new PostgresDialect({ pool: kyselyPool }),
    identifiers: { quote: quoteIdentifier, maxLength: PG_MAX_IDENTIFIER_LENGTH },
    serializers: postgresSerializers,
    async destroy(): Promise<void> {
      if (destroyed) return;
      destroyed = true;
      await pool.end();
    },
  };
}
