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
