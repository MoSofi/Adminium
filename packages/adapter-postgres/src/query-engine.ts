// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `createQueryEngine()` — the Kysely dialect factory for the pooled data
 * connection (`QueryEngine`).
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
import { buildSessionSettings, isPoolerStartupRejection, splitDsnOptions } from './session.js';

const DEFAULT_DATA_POOL_MAX = 10;
const DEFAULT_STATEMENT_TIMEOUT_MS = 15_000;

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

  // The statement budget, on the pool that reads ROWS — the one place it was
  // missing. The adapter's pools have carried it since M3; this one was built
  // bare, so a runaway CRUD query had no server-side bound at all: no
  // `statement_timeout`, nothing to stop a bad filter from scanning until the
  // client gave up. `buildSessionSettings(_, false)` is the same call the
  // adapter's data role makes, so the two cannot drift apart.
  //
  // `SET LOCAL` is NOT available as the pooler fallback here. Kysely speaks the
  // extended query protocol, one statement per Parse, so there is no
  // multi-statement message to hide a prelude in — the trick `PostgresAdapter`
  // uses does not transfer. `query_timeout` is not a substitute either:
  // measured against a real server it abandons the client's wait and leaves the
  // backend running, which is the opposite of the guarantee wanted.
  //
  // So on a transaction pooler this pool keeps working, without a server-side
  // budget, exactly as it did before. Every mechanism that would impose one
  // there (a session-level `SET` on a checkout) leaks the setting onto whatever
  // backend the pooler hands the next tenant, which is precisely what
  // refuses to do. Direct endpoints — every non-pooled host, plus session
  // poolers — get the budget.
  const statementTimeoutMs = Math.floor(
    (typeof config === 'string' ? undefined : config.statementTimeoutMs) ??
      DEFAULT_STATEMENT_TIMEOUT_MS,
  );
  const split = splitDsnOptions(dsn);
  const base = { connectionString: split.dsn, max: poolMax ?? DEFAULT_DATA_POOL_MAX };
  /** Ours last, so a `-c statement_timeout` in the DSN loses to the budget. */
  const compose = (ours: string): string =>
    [split.options, ours === '' ? null : ours].filter((part) => part !== null).join(' ');

  let ourOptions = buildSessionSettings(statementTimeoutMs, false).startupOptions;
  let pool = buildDataPool(base, compose(ourOptions));

  /**
   * What kysely actually holds: a facade that can swap the pool underneath it.
   *
   * The dialect only ever calls `connect()` and `end()`, and the pooler refusal
   * lands inside `connect()` — so this is where the one-time downgrade belongs.
   * Handing kysely the raw pool instead would make the refusal a hard failure
   * and stop Adminium reading rows from a Neon database at all.
   */
  let downgrade: Promise<void> | null = null;
  const facade = {
    get Client(): unknown {
      return (pool as unknown as { Client?: unknown }).Client;
    },
    async connect(): Promise<unknown> {
      // Which pool this attempt used, so a refusal can be attributed. Comparing
      // against `pool` afterwards is what separates "the pool I used still
      // carries our options, downgrade it" from "somebody already rebuilt while
      // I was connecting, just use theirs" — the second case is a concurrent
      // checkout, and treating it as unfixable failed those queries outright.
      const used = pool;
      try {
        return await used.connect();
      } catch (error) {
        if (!isPoolerStartupRejection(error)) throw error;
        if (used !== pool) {
          if (downgrade !== null) await downgrade;
          return await pool.connect();
        }
        // Only ours can be dropped; an `options=` the operator put in the DSN
        // stays, exactly as on the adapter's pool, so their setting is never
        // discarded behind their back. Nothing of ours left means the refusal is
        // not this layer's to fix.
        if (ourOptions === '') throw error;
        const stale = pool;
        ourOptions = '';
        pool = buildDataPool(base, compose(ourOptions));
        downgrade = stale.end().catch(() => undefined);
        await downgrade;
        return await pool.connect();
      }
    },
    async end(): Promise<void> {
      await pool.end();
    },
  };

  // Structural cast: kysely's `PostgresPool` narrows `QueryResult.command`
  // to a command-name union while `pg` types it as `string`. The runtime
  // shapes are identical (kysely's own docs pass a `pg.Pool` here), and the
  // dialect crosses the `QueryEngine` boundary as `unknown` anyway.
  const kyselyPool = facade as unknown as PostgresDialectConfig['pool'];

  let destroyed = false;
  return {
    dialect: new PostgresDialect({ pool: kyselyPool }),
    identifiers: { quote: quoteIdentifier, maxLength: PG_MAX_IDENTIFIER_LENGTH },
    serializers: postgresSerializers,
    async destroy(): Promise<void> {
      if (destroyed) return;
      destroyed = true;
      await facade.end();
    },
  };
}

/**
 * One data pool, with the pool-level 'error' guard every long-lived pool needs.
 *
 * `pg` emits 'error' on the POOL when a client dies while idle in it (nobody is
 * awaiting a query, so there is no promise to reject). An EventEmitter 'error'
 * with no listener is rethrown as an uncaught exception, so a Postgres-side
 * termination of an idle connection — failover, a restart, an admin
 * `pg_terminate_backend`, `DROP DATABASE ... WITH (FORCE)`, or a server idle
 * timeout — would take the whole Node process down rather than being retried on
 * the next checkout. Every one of those is routine operational life for a data
 * pool, and the pool recovers on its own: the dead client is discarded and the
 * next `connect()` opens a fresh one.
 *
 * Found by the M7 Wave 4 verification pass: apps/server's crud.test.ts drops its
 * test database WITH (FORCE) in `afterAll`, which terminates any client still
 * closing (57P01). That surfaced as a *rare* unhandled error failing the whole
 * `pnpm test` run — the harness merely reproduced, under load, what a production
 * failover does on purpose.
 *
 * That guard alone covered only IDLE clients. A checked-out client reports its
 * death on itself: pg-pool detaches its listener for the checkout and kysely
 * never attaches one. So a network failure under a running statement, between
 * two statements of a transaction, or on a dead client handed out before the
 * pool noticed still crashed the process (query-engine.live.test.ts). Each
 * client therefore gets one listener of its own on its first connect. The
 * statement it was running rejects with the same error, which is where that
 * error is reported.
 */
function buildDataPool(
  base: { connectionString: string; max: number },
  options: string,
): pg.Pool {
  const pool = new pg.Pool({ ...base, ...(options === '' ? {} : { options }) });
  pool.on('error', () => {
    /* mapped when the next query fails */
  });
  pool.on('connect', (client) => {
    client.on('error', () => {
      /* the statement it was running rejects with it */
    });
  });
  return pool;
}
