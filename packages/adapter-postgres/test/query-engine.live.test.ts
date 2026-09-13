// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A dropped connection never takes the process down — against a real server.
 *
 * `query-engine.test.ts` pins the listeners on a fake pool. What a fake cannot
 * show is WHICH emitter `pg` reports a dead connection on, and that depends on
 * where the client was when it died:
 *
 * - idle in the pool — pg-pool discards it and re-emits the error on the POOL;
 * - checked out — the error fires on the CLIENT. pg-pool detaches its own
 *   listener for the checkout and kysely attaches none, so a connection that
 *   died under a running statement, between two statements of a transaction,
 *   or before the pool noticed and handed it out again, had nobody listening.
 *
 * An 'error' event nobody hears is an uncaught exception, which ends the
 * process. The pool-level guard alone left the second case open: every test
 * below except the idle one crashed with only that guard in place.
 *
 * The drops are RSTs from a relay in front of the server — a network failure as
 * the driver sees it, the same shape as the `read EADDRNOTAVAIL` a laptop raises
 * when its network changes — rather than a server-side `pg_terminate_backend`,
 * which says goodbye first.
 */
import { connect, createServer, type AddressInfo, type Socket } from 'node:net';

import { Kysely, sql, type Dialect } from 'kysely';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryEngine } from '../src/query-engine.js';
import {
  PG_HOST,
  PG_PORT,
  createTestDatabase,
  dropTestDatabase,
  dsnFor,
  pgDriverAvailable,
  psqlAvailable,
} from './harness.js';

const driverReady = psqlAvailable && (await pgDriverAvailable());

/**
 * How long to keep retrying, not a measurement. CI runs this beside every other
 * package's suite, where opening a connection takes far longer than on a laptop.
 */
const PATIENCE = { timeout: 10_000 };

/**
 * Outlasts {@link PATIENCE}, so the statement is still running when it is seen
 * to start. The data role's 15 s statement budget ends it on the server.
 */
const SLOW = 'select pg_sleep(20)';

interface Relay {
  port: number;
  /** Cut every connection through the relay with a RST. */
  reset(): void;
  close(): Promise<void>;
}

async function startRelay(): Promise<Relay> {
  const clientSides = new Set<Socket>();
  const server = createServer((clientSide) => {
    const upstream = connect(Number(PG_PORT), PG_HOST);
    clientSides.add(clientSide);
    const drop = (): void => {
      clientSides.delete(clientSide);
      upstream.destroy();
      clientSide.destroy();
    };
    clientSide.on('error', drop).on('close', drop);
    upstream.on('error', drop).on('close', drop);
    clientSide.pipe(upstream).pipe(clientSide);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const reset = (): void => {
    for (const socket of clientSides) socket.resetAndDestroy();
  };
  return {
    port: (server.address() as AddressInfo).port,
    reset,
    async close() {
      reset();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

describe.skipIf(!driverReady)('createQueryEngine survives a dropped connection', () => {
  let database: string;
  /** Watches the server directly, never through the relay. */
  let side: import('pg').Client;
  let relay: Relay;
  let db: Kysely<unknown>;
  const uncaught: unknown[] = [];
  const collect = (error: unknown): void => {
    uncaught.push(error);
  };

  beforeAll(async () => {
    const pg = (await import('pg')).default;
    database = await createTestDatabase(false);
    side = new pg.Client({ connectionString: dsnFor(database) });
    await side.connect();
  });
  afterAll(async () => {
    await side.end();
    await dropTestDatabase(database);
  });

  beforeEach(async () => {
    uncaught.length = 0;
    process.on('uncaughtException', collect);
    relay = await startRelay();
    const engine = createQueryEngine(`postgres://${PG_HOST}:${relay.port}/${database}`);
    db = new Kysely({ dialect: engine.dialect as Dialect });
  });
  afterEach(async () => {
    await db.destroy();
    await relay.close();
    process.off('uncaughtException', collect);
  });

  /**
   * The pool may hand the dead client out once more before it has read the RST,
   * so the first statement after a drop is allowed to fail; one after it is not.
   */
  async function nextStatementWorks(): Promise<void> {
    await vi.waitFor(async () => {
      await sql`select 1`.execute(db);
    }, PATIENCE);
  }

  it('while the connection is idle in the pool', async () => {
    await sql`select 1`.execute(db);

    relay.reset();
    // Let the client read the RST while it is still idle. Without the wait the
    // next statement checks the dead client out first and fails its write with
    // EPIPE, which is the checked-out case again rather than this one.
    await new Promise((resolve) => setTimeout(resolve, 100));

    await nextStatementWorks();
    expect(uncaught).toEqual([]);
  });

  it('when the next statement checks the dead connection out before the pool noticed', async () => {
    await sql`select 1`.execute(db);

    relay.reset();

    await nextStatementWorks();
    expect(uncaught).toEqual([]);
  });

  it('while a statement is running on it', async () => {
    const running = sql.raw(SLOW).execute(db).then(
      () => null,
      (error: unknown) => error,
    );
    await vi.waitFor(async () => {
      // This database only: the server's meta-store twin of this test sends the
      // same statement to the same CI Postgres, possibly at the same moment.
      const { rows } = await side.query<{ active: number }>(
        "SELECT count(*)::int AS active FROM pg_stat_activity WHERE datname = current_database() AND state = 'active' AND query = $1",
        [SLOW],
      );
      expect(rows[0]?.active).toBe(1);
    }, PATIENCE);

    relay.reset();

    expect(await running).toBeInstanceOf(Error);
    await nextStatementWorks();
    expect(uncaught).toEqual([]);
  });

  it('between two statements of a transaction', async () => {
    const failure = await db
      .transaction()
      .execute(async (trx) => {
        await sql`select 1`.execute(trx);
        relay.reset();
        // Let the client read the RST while it holds the connection and runs nothing.
        await new Promise((resolve) => setTimeout(resolve, 100));
        await sql`select 2`.execute(trx);
      })
      .then(
        () => null,
        (error: unknown) => error,
      );

    expect(failure).toBeInstanceOf(Error);
    await nextStatementWorks();
    expect(uncaught).toEqual([]);
  });
});
