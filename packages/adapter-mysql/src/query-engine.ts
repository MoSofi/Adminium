// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `createQueryEngine()` — the Kysely dialect factory for the pooled data
 * connection (`QueryEngine`).
 *
 * `@adminium/engine` does not depend on `kysely`, so `QueryEngine.dialect`
 * is typed opaquely there; `@adminium/server` casts it to `kysely.Dialect`
 * at the composition boundary. This package owns the concrete dependency.
 */
import { MysqlDialect, type MysqlDialectConfig } from 'kysely';
import mysql from 'mysql2';

import {
  AdapterError,
  type DataConnectionConfig,
  type QueryEngine,
} from '@adminium/engine/adapter';

import {
  MYSQL_MAX_IDENTIFIER_LENGTH,
  mysqlSerializers,
  quoteIdentifier,
} from './serialization.js';
import { readTimestampsAsUtc, UTC_SESSION_SQL } from './session.js';

const DEFAULT_DATA_POOL_MAX = 10;

/**
 * Build the CRUD query port for a data-role connection. Accepts a DSN string
 * or the role-branded config (which must carry a `dsn`). Kysely's
 * `MysqlDialect` consumes the callback-flavored mysql2 pool; connections are
 * only opened on first query, and `destroy()` tears the pool down
 * idempotently. Every connection's session runs in UTC and a `TIMESTAMP`
 * reads back as UTC (`session.ts`).
 */
export function createQueryEngine(config: DataConnectionConfig | string): QueryEngine {
  const dsn = typeof config === 'string' ? config : config.dsn;
  if (dsn === undefined || dsn.length === 0) {
    throw new AdapterError('UNKNOWN', 'mysql query engine requires a DSN', {
      hint: 'pass a mysql:// connection string (TLS options honored from the ssl params)',
    });
  }
  const poolMax = typeof config === 'string' ? undefined : config.poolMax;
  const pool = mysql.createPool({
    uri: dsn,
    connectionLimit: poolMax ?? DEFAULT_DATA_POOL_MAX,
    typeCast: readTimestampsAsUtc,
  });
  // Queued on the connection before the query that asked for it, so no
  // statement ever runs in the server's default zone. A connection that
  // cannot be put in UTC is closed rather than left to answer in another
  // zone: the query waiting on it fails, and the pool opens a fresh one.
  // mysql2's mixin-typed .d.ts do not surface query() under NodeNext; the
  // callback signature used here is pinned structurally.
  pool.on('connection', (connection) => {
    const conn = connection as unknown as {
      query(sql: string, cb: (error: Error | null) => void): void;
      destroy(): void;
    };
    conn.query(UTC_SESSION_SQL, (error) => {
      if (error !== null && error !== undefined) conn.destroy();
    });
  });

  // Structural cast: kysely ships its own minimal `MysqlPool` interface to
  // avoid a dependency on mysql2 — the runtime shape of a mysql2 callback
  // pool matches it exactly (kysely's own docs pass one here), and the
  // dialect crosses the `QueryEngine` boundary as `unknown` anyway.
  const kyselyPool = pool as unknown as MysqlDialectConfig['pool'];

  let destroyed = false;
  return {
    dialect: new MysqlDialect({ pool: kyselyPool }),
    identifiers: { quote: quoteIdentifier, maxLength: MYSQL_MAX_IDENTIFIER_LENGTH },
    serializers: mysqlSerializers,
    async destroy(): Promise<void> {
      if (destroyed) return;
      destroyed = true;
      await new Promise<void>((resolve, reject) => {
        pool.end((error) => {
          if (error === undefined || error === null) resolve();
          else reject(error);
        });
      });
    },
  };
}
