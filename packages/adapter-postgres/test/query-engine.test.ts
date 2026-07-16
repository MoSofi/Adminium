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
  constructor(readonly options: { connectionString?: string; max?: number }) {
    super();
    pools.push(this);
  }
  async end(): Promise<void> {
    this.ended = true;
  }
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
