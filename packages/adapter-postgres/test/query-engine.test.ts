// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `createQueryEngine()` pool wiring — the guards that do not need a live server.
 *
 * The live CRUD behaviour is covered by `adapter.live.test.ts`; this suite pins
 * the pool's ERROR CONTRACT, which a live test cannot reach without terminating
 * backends out from under itself.
 */
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Every pool the module under test constructs, in construction order. */
const pools: FakePool[] = [];

class FakePool extends EventEmitter {
  ended = false;
  connects = 0;
  /** Thrown by the next `connect()` only, so a retry can succeed. */
  failNextConnect: Error | null = null;
  constructor(readonly options: { connectionString?: string; max?: number; options?: string }) {
    super();
    pools.push(this);
  }
  async connect(): Promise<unknown> {
    this.connects += 1;
    const failure = this.failNextConnect;
    if (failure !== null) {
      this.failNextConnect = null;
      throw failure;
    }
    return { query: async () => ({ rows: [] }), release: () => undefined };
  }
  async end(): Promise<void> {
    this.ended = true;
  }
}

/** The pooler's refusal, in the wording Neon actually sends. */
function poolerRefusal(): Error {
  return Object.assign(
    new Error('unsupported startup parameter in options: statement_timeout'),
    { code: '08P01' },
  );
}

/**
 * Reach the facade `createQueryEngine` hands kysely.
 *
 * The downgrade lives in its `connect()`, and the dialect's driver is the only
 * caller — so driving the driver is what actually exercises it. Asserting on the
 * constructed pool options alone would miss the rebuild entirely.
 */
async function acquireVia(engine: { dialect: unknown }): Promise<unknown> {
  const driver = (
    engine.dialect as {
      createDriver(): { init(): Promise<void>; acquireConnection(): Promise<unknown> };
    }
  ).createDriver();
  await driver.init();
  return driver.acquireConnection();
}

vi.mock('pg', () => ({ default: { Pool: FakePool } }));

const { createQueryEngine } = await import('../src/query-engine.js');

const DSN = 'postgres://user:pw@127.0.0.1:5432/db';

describe('createQueryEngine pool error contract', () => {
  beforeEach(() => {
    pools.length = 0;
  });

  /**
   * THE REGRESSION THIS FILE EXISTS FOR.
   *
   * `pg` emits 'error' on the POOL when a client dies while idle — no query is
   * in flight, so there is no promise to reject. Node rethrows an 'error' event
   * with no listener as an uncaught exception, so without this handler a routine
   * Postgres-side termination (failover, restart, `pg_terminate_backend`, an
   * idle timeout, or `DROP DATABASE ... WITH (FORCE)`) takes the whole process
   * down instead of being retried on the next checkout.
   *
   * `createAdapter`'s pool in ../src/index.ts has always carried this guard;
   * this pool was missing it until the M7 Wave 4 verification pass, where it
   * showed up as a rare unhandled error failing the entire `pnpm test` run.
   */
  it('attaches an error listener so a dead idle client never crashes the process', () => {
    createQueryEngine(DSN);
    const pool = pools.at(0);
    expect(pool).toBeDefined();
    expect(pool!.listenerCount('error')).toBeGreaterThan(0);
  });

  it('swallows an idle-client error rather than rethrowing it', () => {
    createQueryEngine(DSN);
    const pool = pools.at(0)!;
    // An EventEmitter with a listener returns true and does NOT throw; the same
    // emit against an unguarded pool is what took the process down.
    const terminated = Object.assign(new Error('terminating connection due to administrator command'), {
      code: '57P01',
    });
    expect(() => pool.emit('error', terminated)).not.toThrow();
    expect(pool.emit('error', terminated)).toBe(true);
  });

  it('gives every client its own error listener, for a death while checked out', () => {
    // The pool guard above never hears a checked-out client: pg-pool detaches
    // its listener for the checkout, so the error fires on the client alone.
    // query-engine.live.test.ts shows the crash against a real server.
    createQueryEngine(DSN);
    const pool = pools.at(0)!;
    const client = new EventEmitter();
    pool.emit('connect', client);

    const reset = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    expect(() => client.emit('error', reset)).not.toThrow();
  });

  describe('the statement budget on the pool that reads rows', () => {
    // This pool was built bare while the adapter's carried 05 §4.1's rails since
    // M3, so a runaway CRUD query had no server-side bound at all.
    it('sends the data role’s session settings', () => {
      createQueryEngine({ role: 'data', dsn: DSN } as never);
      expect(pools.at(0)!.options.options).toBe('-c statement_timeout=15000');
    });

    it('honours an explicit statementTimeoutMs, floored', () => {
      createQueryEngine({ role: 'data', dsn: DSN, statementTimeoutMs: 2500.9 } as never);
      expect(pools.at(0)!.options.options).toBe('-c statement_timeout=2500');
    });

    it('carries no introspect-only limits — it is a data connection', () => {
      createQueryEngine(DSN);
      const options = String(pools.at(0)!.options.options);
      expect(options).not.toContain('lock_timeout');
      expect(options).not.toContain('idle_in_transaction_session_timeout');
    });

    it('appends ours after an `options=` in the DSN, and strips it from the string', () => {
      const dsn = `${DSN}?options=${encodeURIComponent('-c search_path=reporting')}`;
      createQueryEngine({ role: 'data', dsn } as never);
      expect(pools.at(0)!.options.connectionString).toBe(DSN);
      expect(pools.at(0)!.options.options).toBe(
        '-c search_path=reporting -c statement_timeout=15000',
      );
    });
  });

  describe('the pooler downgrade', () => {
    it('rebuilds without our options and still hands back a connection', async () => {
      // Without this the refusal would be a hard failure and Adminium could not
      // read rows from a Neon database at all.
      const engine = createQueryEngine({ role: 'data', dsn: DSN } as never);
      pools.at(0)!.failNextConnect = poolerRefusal();

      await expect(acquireVia(engine)).resolves.toBeDefined();

      expect(pools).toHaveLength(2);
      expect(pools.at(0)!.ended).toBe(true);
      expect(pools.at(1)!.options.options).toBeUndefined();
    });

    it('keeps the operator’s own options while dropping only ours', async () => {
      const dsn = `${DSN}?options=${encodeURIComponent('-c search_path=reporting')}`;
      const engine = createQueryEngine({ role: 'data', dsn } as never);
      pools.at(0)!.failNextConnect = poolerRefusal();

      await acquireVia(engine);

      expect(pools.at(1)!.options.options).toBe('-c search_path=reporting');
    });

    it('does not downgrade on an unrelated connection failure', async () => {
      // A downgrade on the wrong error would silently drop the budget forever.
      const engine = createQueryEngine({ role: 'data', dsn: DSN } as never);
      pools.at(0)!.failNextConnect = Object.assign(new Error('password authentication failed'), {
        code: '28P01',
      });

      await expect(acquireVia(engine)).rejects.toThrow(/password authentication/);
      expect(pools).toHaveLength(1);
    });

    it('rebuilds once for concurrent checkouts, not once each', async () => {
      const engine = createQueryEngine({ role: 'data', dsn: DSN } as never);
      const first = pools.at(0)!;
      // Both waiters see a refusal before either rebuild completes.
      first.connect = async () => {
        first.connects += 1;
        throw poolerRefusal();
      };

      await Promise.all([acquireVia(engine), acquireVia(engine)]);

      expect(pools).toHaveLength(2);
    });

    it('destroy() ends the rebuilt pool, not the discarded one', async () => {
      const engine = createQueryEngine({ role: 'data', dsn: DSN } as never);
      pools.at(0)!.failNextConnect = poolerRefusal();
      await acquireVia(engine);

      await engine.destroy();

      expect(pools.at(1)!.ended).toBe(true);
    });
  });

  it('rejects a missing/empty DSN instead of building an unusable pool', () => {
    expect(() => createQueryEngine('')).toThrow(/requires a DSN/);
    expect(pools).toHaveLength(0);
  });

  it('destroy() ends the pool once and stays idempotent', async () => {
    const engine = createQueryEngine(DSN);
    await engine.destroy();
    await engine.destroy();
    expect(pools.at(0)!.ended).toBe(true);
  });
});
