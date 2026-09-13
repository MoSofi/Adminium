// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A dropped Postgres connection never takes the server down through the META
 * store's pool.
 *
 * Reported against 0.2.6: onboarding moved the meta store onto a remote
 * Postgres, and some time later the process died with
 *
 *   Error: read EADDRNOTAVAIL
 *   Emitted 'error' event on BoundPool instance at: Client.idleListener
 *
 * macOS raises EADDRNOTAVAIL on a socket whose network went away (sleep, a
 * Wi-Fi or VPN change). adapter-postgres's data pool had listened for pool
 * errors since M7. `connectMetaStore` built its pool bare, so the first idle
 * connection to die ended the process. A provider's idle cutoff or a failover
 * does the same thing without any laptop involved.
 *
 * `pg` reports the loss on the POOL when the client was idle in it, and on the
 * CLIENT when it was checked out, where neither pg-pool nor kysely listens.
 * The meta store checks clients out for long stretches: a migration pass and a
 * relocation's copy each run inside one transaction. So each moment is covered
 * here, with the same relay that
 * adapter-postgres's `query-engine.live.test.ts` uses: a RST in front of the
 * server, a network failure as the driver sees one. Before the fix all four
 * tests failed.
 *
 * Gated on `TEST_POSTGRES_URL` like every other engine leg; CI always sets it.
 */
import { randomBytes } from 'node:crypto';
import { connect, createServer, type AddressInfo, type Socket } from 'node:net';

import { sql } from 'kysely';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { connectMetaStore, type MetaStoreHandle } from '../src/meta/store.js';

const POSTGRES_URL = process.env.TEST_POSTGRES_URL;

/**
 * How long to keep retrying, not a measurement. CI runs this beside every other
 * package's suite, where opening a connection takes far longer than on a laptop.
 */
const PATIENCE = { timeout: 10_000 };

/**
 * Outlasts {@link PATIENCE}, so the statement is still running when it is seen
 * to start. Whatever is left of it ends with the database in `afterAll`.
 */
const SLOW = 'select pg_sleep(20)';

interface Relay {
  port: number;
  /** Cut every connection through the relay with a RST. */
  reset(): void;
  close(): Promise<void>;
}

async function startRelay(target: URL): Promise<Relay> {
  const clientSides = new Set<Socket>();
  const server = createServer((clientSide) => {
    const upstream = connect(Number(target.port || 5432), target.hostname);
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

describe.skipIf(POSTGRES_URL === undefined)('the meta store survives a dropped Postgres connection', () => {
  const database = `adminium_meta_drop_${randomBytes(4).toString('hex')}`;
  let pg: typeof import('pg').default;
  let admin: import('pg').Client;
  let relay: Relay;
  let store: MetaStoreHandle;
  const uncaught: unknown[] = [];
  const collect = (error: unknown): void => {
    uncaught.push(error);
  };

  beforeAll(async () => {
    ({ default: pg } = await import('pg'));
    admin = new pg.Client({ connectionString: POSTGRES_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${database}"`);
  });
  afterAll(async () => {
    await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    await admin.end();
  });

  beforeEach(async () => {
    uncaught.length = 0;
    process.on('uncaughtException', collect);
    const target = new URL(POSTGRES_URL as string);
    relay = await startRelay(target);
    const url = new URL(target);
    url.hostname = '127.0.0.1';
    url.port = String(relay.port);
    url.pathname = `/${database}`;
    store = await connectMetaStore({ url: url.toString(), engine: 'postgres', source: 'env' }, { poolSize: 2 });
  });
  afterEach(async () => {
    await store.close();
    await relay.close();
    process.off('uncaughtException', collect);
  });

  /**
   * The pool may hand the dead client out once more before it has read the RST,
   * so the first statement after a drop is allowed to fail; one after it is not.
   */
  async function nextStatementWorks(): Promise<void> {
    await vi.waitFor(async () => {
      await sql`select 1`.execute(store.meta.db);
    }, PATIENCE);
  }

  it('while the connection is idle in the pool', async () => {
    await sql`select 1`.execute(store.meta.db);

    relay.reset();
    // Let the client read the RST while it is still idle: the reported crash.
    await new Promise((resolve) => setTimeout(resolve, 100));

    await nextStatementWorks();
    expect(uncaught).toEqual([]);
  });

  it('when the next statement checks the dead connection out before the pool noticed', async () => {
    await sql`select 1`.execute(store.meta.db);

    relay.reset();

    await nextStatementWorks();
    expect(uncaught).toEqual([]);
  });

  it('while a statement is running on it', async () => {
    const running = sql.raw(SLOW).execute(store.meta.db).then(
      () => null,
      (error: unknown) => error,
    );
    await vi.waitFor(async () => {
      // This database only: adapter-postgres's twin of this test sends the same
      // statement to the same CI Postgres, possibly at the same moment.
      const { rows } = await admin.query<{ active: number }>(
        "SELECT count(*)::int AS active FROM pg_stat_activity WHERE datname = $1 AND state = 'active' AND query = $2",
        [database, SLOW],
      );
      expect(rows[0]?.active).toBe(1);
    }, PATIENCE);

    relay.reset();

    expect(await running).toBeInstanceOf(Error);
    await nextStatementWorks();
    expect(uncaught).toEqual([]);
  });

  it('between two statements of a transaction', async () => {
    const failure = await store.meta.db
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
