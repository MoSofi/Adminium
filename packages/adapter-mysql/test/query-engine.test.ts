// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `createQueryEngine()` pool wiring — the parts that do not need a live server.
 *
 * The live CRUD behaviour is covered by `adapter.live.test.ts`, which is gated
 * on `TEST_MYSQL_URL`; without it that suite skips and this factory was never
 * executed at all. What is pinned here is the CONTRACT the server composes
 * against: the DSN guard, the pool sizing, the identifier/serializer wiring,
 * and `destroy()`'s idempotence.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdapterError } from '@adminium/engine/adapter';

/** Every pool the module under test constructs, in construction order. */
const pools: FakePool[] = [];

/** A connection the fake pool hands out: what it was asked, and whether it was closed. */
class FakeConnection {
  readonly sql: string[] = [];
  destroyed = false;
  constructor(private readonly fail: boolean) {}
  query(sql: string, callback: (error: Error | null) => void): void {
    this.sql.push(sql);
    callback(this.fail ? new Error('Unknown or incorrect time zone') : null);
  }
  destroy(): void {
    this.destroyed = true;
  }
}

class FakePool {
  ended = false;
  endCalls = 0;
  /** Set to make `end()` invoke its callback with an error. */
  endError: Error | null = null;
  readonly listeners = new Map<string, (connection: FakeConnection) => void>();

  constructor(readonly options: { uri?: string; connectionLimit?: number; typeCast?: unknown }) {
    pools.push(this);
  }

  on(event: string, listener: (connection: FakeConnection) => void): void {
    this.listeners.set(event, listener);
  }

  /** Simulate mysql2 opening a fresh connection for the pool. */
  openConnection(fail = false): FakeConnection {
    const connection = new FakeConnection(fail);
    this.listeners.get('connection')?.(connection);
    return connection;
  }

  end(callback: (error?: Error | null) => void): void {
    this.endCalls += 1;
    if (this.endError !== null) {
      callback(this.endError);
      return;
    }
    this.ended = true;
    callback(null);
  }
}

vi.mock('mysql2', () => ({
  default: { createPool: (options: Record<string, unknown>) => new FakePool(options) },
}));

const { createQueryEngine } = await import('../src/query-engine.js');

const DSN = 'mysql://user:pw@127.0.0.1:3306/shop';

beforeEach(() => {
  pools.length = 0;
});

describe('createQueryEngine — DSN guard', () => {
  it.each([
    ['an empty string', ''],
    ['a config with an empty dsn', { role: 'data', dsn: '' }],
    ['a config with no dsn', { role: 'data' }],
  ] as const)('rejects %s instead of building an unusable pool', (_label, config) => {
    const failure = (() => {
      try {
        createQueryEngine(config as never);
        return null;
      } catch (error) {
        return error;
      }
    })();

    expect(failure).toBeInstanceOf(AdapterError);
    expect((failure as AdapterError).code).toBe('UNKNOWN');
    expect((failure as AdapterError).message).toMatch(/requires a DSN/);
    expect((failure as AdapterError).hint).toMatch(/mysql:\/\//);
    // Nothing was constructed, so nothing needs tearing down.
    expect(pools).toHaveLength(0);
  });
});

describe('createQueryEngine — pool construction', () => {
  it('passes the DSN through as the pool URI', () => {
    createQueryEngine(DSN);
    expect(pools).toHaveLength(1);
    expect(pools[0]!.options.uri).toBe(DSN);
  });

  it('defaults the connection limit to 10', () => {
    createQueryEngine(DSN);
    expect(pools[0]!.options.connectionLimit).toBe(10);
  });

  it('honors poolMax from the role-branded config', () => {
    createQueryEngine({ role: 'data', dsn: DSN, poolMax: 3 } as never);
    expect(pools[0]!.options.connectionLimit).toBe(3);
  });

  it('ignores a poolMax that cannot be supplied with a bare DSN string', () => {
    // A plain string carries no poolMax, so the default must apply rather than
    // some value left over from a previous engine.
    createQueryEngine({ role: 'data', dsn: DSN, poolMax: 3 } as never);
    createQueryEngine(DSN);
    expect(pools[1]!.options.connectionLimit).toBe(10);
  });

  it('puts every new connection in a UTC session before it serves a query', () => {
    // A TIMESTAMP speaks the session's zone; left at the server's default, an
    // instant was stored and compared hours off wherever that was not UTC.
    createQueryEngine(DSN);
    const connection = pools[0]!.openConnection();
    expect(connection.sql).toEqual(["SET time_zone = '+00:00'"]);
    expect(connection.destroyed).toBe(false);
  });

  it('closes a connection that cannot be put in UTC rather than let it answer in another zone', () => {
    createQueryEngine(DSN);
    const connection = pools[0]!.openConnection(true);
    expect(connection.destroyed).toBe(true);
  });

  it('reads a TIMESTAMP as UTC, and nothing else differently', async () => {
    const { readTimestampsAsUtc } = await import('../src/session.js');
    createQueryEngine(DSN);
    expect(pools[0]!.options.typeCast).toBe(readTimestampsAsUtc);
  });

  it('opens no connection at construction time', () => {
    // The pool is lazy: a bad host must not make `createQueryEngine` reject,
    // because the server builds these at composition time.
    expect(() => createQueryEngine('mysql://nobody@203.0.113.1:3306/x')).not.toThrow();
  });
});

describe('createQueryEngine — the QueryEngine contract', () => {
  it('exposes MySQL identifier quoting and the 64-character budget', async () => {
    const engine = createQueryEngine(DSN);
    expect(engine.identifiers.quote('order details')).toBe('`order details`');
    expect(engine.identifiers.quote('we`ird')).toBe('`we``ird`');
    expect(engine.identifiers.maxLength).toBe(64);
    await engine.destroy();
  });

  it('exposes the lossless serializers and omits binary', async () => {
    const engine = createQueryEngine(DSN);
    expect(engine.serializers.bigint).toBeDefined();
    expect(engine.serializers.decimal).toBeDefined();
    expect(engine.serializers.boolean).toBeDefined();
    // Blobs are out of CRUD v1 — the absence is the contract.
    expect(engine.serializers.binary).toBeUndefined();
    await engine.destroy();
  });

  it('hands over a kysely MysqlDialect', async () => {
    const { MysqlDialect } = await import('kysely');
    const engine = createQueryEngine(DSN);
    expect(engine.dialect).toBeInstanceOf(MysqlDialect);
    await engine.destroy();
  });
});

describe('createQueryEngine — destroy()', () => {
  it('ends the pool', async () => {
    const engine = createQueryEngine(DSN);
    await engine.destroy();
    expect(pools[0]!.ended).toBe(true);
  });

  it('is idempotent — a second destroy() does not re-end the pool', async () => {
    // The server may close a connection twice during shutdown; mysql2 throws
    // "Pool is closed" on a double end.
    const engine = createQueryEngine(DSN);
    await engine.destroy();
    await engine.destroy();
    expect(pools[0]!.endCalls).toBe(1);
  });

  it('rejects when the driver reports a teardown failure', async () => {
    const engine = createQueryEngine(DSN);
    pools[0]!.endError = new Error('Pool is closed.');

    await expect(engine.destroy()).rejects.toThrow('Pool is closed.');
  });

  it('does not retry after a failed teardown', async () => {
    // `destroyed` is set before the await, so a failure is terminal rather
    // than leaving the caller able to loop on a broken pool.
    const engine = createQueryEngine(DSN);
    pools[0]!.endError = new Error('Pool is closed.');
    await expect(engine.destroy()).rejects.toThrow();

    await expect(engine.destroy()).resolves.toBeUndefined();
    expect(pools[0]!.endCalls).toBe(1);
  });
});
