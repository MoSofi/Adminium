// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `MysqlAdapter` lifecycle, probes and role guards, against a mocked `mysql2`.
 *
 * `adapter.live.test.ts` covers this class against a real server, but it is
 * gated on `TEST_MYSQL_URL` — which CI sets and a laptop does not. Without it
 * that suite skips and `src/index.ts` was executed by NOTHING: 252 statements
 * at 0%. The guards it contains are a security boundary (05 §10: row-touching
 * methods never run on the introspect connection) and the version check is the
 * difference between a clear "upgrade your server" and a confusing SQL error,
 * so both are pinned here where no server is required.
 *
 * Faking the pool also reaches what a live test cannot: the MariaDB timeout
 * fallback, a `SHOW GRANTS` that is denied, and a probe row from a server too
 * old to connect to on purpose.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AdapterError,
  AdapterRegistry,
  type AdapterProvider,
  type DatabaseAdapter,
} from '@adminium/engine/adapter';

interface FakeConnection {
  query(sql: string, callback: (error: Error | null) => void): void;
}

/** Every pool constructed by the module under test, in construction order. */
const pools: FakePool[] = [];

/** Swapped per test; returns rows, or throws when it returns an Error. */
let respond: (sql: string) => unknown = () => [];

class FakePool {
  ended = false;
  readonly queries: string[] = [];
  /** Listeners registered on the underlying callback pool. */
  readonly listeners = new Map<string, (connection: FakeConnection) => void>();
  /** Statements the session-setup listener sent, and which of them failed. */
  readonly sessionSql: string[] = [];
  sessionFailures = new Set<string>();

  readonly pool = {
    on: (event: string, listener: (connection: FakeConnection) => void): void => {
      this.listeners.set(event, listener);
    },
  };

  constructor(readonly options: { uri?: string; connectionLimit?: number }) {
    pools.push(this);
  }

  async query(sql: string): Promise<[unknown, unknown]> {
    this.queries.push(sql);
    const rows = respond(sql);
    if (rows instanceof Error) throw rows;
    return [rows, []];
  }

  async end(): Promise<void> {
    this.ended = true;
  }

  /** Simulate mysql2 handing out a freshly-opened connection. */
  openConnection(): void {
    const connection: FakeConnection = {
      query: (sql, callback) => {
        this.sessionSql.push(sql);
        callback(this.sessionFailures.has(sql.split(' ')[2] ?? '') ? new Error('unknown var') : null);
      },
    };
    this.listeners.get('connection')?.(connection);
  }
}

vi.mock('mysql2/promise', () => ({
  createPool: (options: Record<string, unknown>) => new FakePool(options),
}));

const mod = await import('../src/index.js');

const DSN = 'mysql://user:pw@127.0.0.1:3306/shop';

const PROBE_ROW = {
  server_version: '8.0.36',
  role_name: 'app@10.0.0.1',
  database_name: 'shop',
  read_only: 0,
};

/** Route the three probe statements; everything else answers empty. */
function defaultRespond(sql: string): unknown {
  if (sql.includes('VERSION()')) return [PROBE_ROW];
  if (sql.startsWith('SHOW GRANTS')) return [{ 'Grants for app': 'GRANT ALL PRIVILEGES ON `shop`.* TO `app`@`%`' }];
  if (sql.includes('Ssl_cipher')) return [{ Variable_name: 'Ssl_cipher', Value: 'TLS_AES_256_GCM_SHA384' }];
  return [];
}

async function connected(role: 'introspect' | 'data' = 'introspect'): Promise<
  InstanceType<typeof mod.MysqlAdapter>
> {
  const adapter = new mod.MysqlAdapter(role);
  await adapter.connect({ role, dsn: DSN } as never);
  return adapter;
}

beforeEach(() => {
  pools.length = 0;
  respond = defaultRespond;
});

describe('connect()', () => {
  it('rejects a config branded for a different role', async () => {
    const adapter = new mod.MysqlAdapter<'introspect'>('introspect');
    await expect(adapter.connect({ role: 'data', dsn: DSN } as never)).rejects.toMatchObject({
      name: 'AdapterError',
      code: 'PERMISSION',
    });
    expect(pools).toHaveLength(0);
  });

  it.each([
    ['an empty DSN', ''],
    ['a missing DSN', undefined],
  ] as const)('rejects %s without opening a pool', async (_label, dsn) => {
    const adapter = new mod.MysqlAdapter<'introspect'>('introspect');
    const failure = await adapter
      .connect({ role: 'introspect', dsn } as never)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AdapterError);
    expect((failure as AdapterError).code).toBe('UNKNOWN');
    expect((failure as AdapterError).message).toMatch(/require a DSN/);
    expect((failure as AdapterError).hint).toMatch(/mysql:\/\//);
    expect(pools).toHaveLength(0);
  });

  it('sizes the pool per role, and lets an explicit poolMax win', async () => {
    await connected('introspect');
    expect(pools[0]!.options.connectionLimit).toBe(5);
    await connected('data');
    expect(pools[1]!.options.connectionLimit).toBe(10);

    const adapter = new mod.MysqlAdapter<'data'>('data');
    await adapter.connect({ role: 'data', dsn: DSN, poolMax: 3 } as never);
    expect(pools[2]!.options.connectionLimit).toBe(3);
    expect(pools[2]!.options.uri).toBe(DSN);
  });
});

describe('connect() — per-connection statement timeout (05 §4.2)', () => {
  it('sets the MySQL variable on every new connection', async () => {
    await connected('introspect');
    pools[0]!.openConnection();
    expect(pools[0]!.sessionSql).toEqual(['SET SESSION max_execution_time = 15000']);
  });

  it('falls back to the MariaDB variable, converting ms to whole seconds', async () => {
    // MariaDB has no max_execution_time; it takes max_statement_time in
    // SECONDS. Trying MySQL's first and falling back is the feature detection.
    const adapter = new mod.MysqlAdapter<'data'>('data');
    await adapter.connect({ role: 'data', dsn: DSN, statementTimeoutMs: 4_500 } as never);
    pools[0]!.sessionFailures.add('max_execution_time');
    pools[0]!.openConnection();

    expect(pools[0]!.sessionSql).toEqual([
      'SET SESSION max_execution_time = 4500',
      'SET SESSION max_statement_time = 5', // ceil(4.5s)
    ]);
  });

  it('never asks MariaDB for a zero-second budget', async () => {
    // ceil(200ms / 1000) is 1, but a naive floor would send `= 0`, which means
    // NO LIMIT in MariaDB — silently removing the timeout it was setting.
    const adapter = new mod.MysqlAdapter<'data'>('data');
    await adapter.connect({ role: 'data', dsn: DSN, statementTimeoutMs: 200 } as never);
    pools[0]!.sessionFailures.add('max_execution_time');
    pools[0]!.openConnection();

    expect(pools[0]!.sessionSql[1]).toBe('SET SESSION max_statement_time = 1');
  });

  it('floors a fractional millisecond budget', async () => {
    const adapter = new mod.MysqlAdapter<'data'>('data');
    await adapter.connect({ role: 'data', dsn: DSN, statementTimeoutMs: 1500.7 } as never);
    pools[0]!.openConnection();
    expect(pools[0]!.sessionSql[0]).toBe('SET SESSION max_execution_time = 1500');
  });

  it('gives up quietly when neither variable exists', async () => {
    // An ancient or stripped-down server should still be introspectable; the
    // total budget in IntrospectOptions.timeoutMs still bounds the work.
    const adapter = await connected('introspect');
    pools[0]!.sessionFailures.add('max_execution_time');
    pools[0]!.sessionFailures.add('max_statement_time');
    expect(() => pools[0]!.openConnection()).not.toThrow();
    expect(pools[0]!.sessionSql).toHaveLength(2);
    await adapter.close();
  });
});

describe('lifecycle', () => {
  it('refuses to query before connect()', async () => {
    const adapter = new mod.MysqlAdapter<'introspect'>('introspect');
    const result = await adapter.test();
    expect(result.ok).toBe(false);
    expect(result.error?.message).toMatch(/not connected/);
  });

  it('refuses to query after close(), and close() is idempotent', async () => {
    const adapter = await connected('introspect');
    await adapter.close();
    await adapter.close();

    expect(pools[0]!.ended).toBe(true);
    const result = await adapter.test();
    expect(result.ok).toBe(false);
    expect(result.error?.message).toMatch(/not connected/);
  });

  it('close() before connect() is a no-op rather than a crash', async () => {
    const adapter = new mod.MysqlAdapter<'introspect'>('introspect');
    await expect(adapter.close()).resolves.toBeUndefined();
  });
});

describe('server version gate — MySQL >= 8.0, MariaDB >= 10.5', () => {
  it.each([
    ['MySQL 8.0.36', '8.0.36'],
    ['MySQL 9.1.0', '9.1.0'],
    ['MariaDB 10.5.0', '10.5.0-MariaDB'],
    ['MariaDB 11.4 behind the replication prefix', '5.5.5-11.4.2-MariaDB-log'],
  ] as const)('accepts %s', async (_label, version) => {
    const adapter = await connected('introspect');
    respond = (sql) =>
      sql.includes('VERSION()') ? [{ ...PROBE_ROW, server_version: version }] : defaultRespond(sql);

    const result = await adapter.test();
    expect(result.ok).toBe(true);
    expect(result.serverVersion).toBe(version);
  });

  it.each([
    ['MySQL 5.7', '5.7.44'],
    ['MariaDB 10.4', '10.4.32-MariaDB'],
    ['MariaDB 10.4 behind the replication prefix', '5.5.5-10.4.32-MariaDB'],
  ] as const)('refuses %s with an upgrade hint', async (_label, version) => {
    const adapter = await connected('introspect');
    respond = (sql) =>
      sql.includes('VERSION()') ? [{ ...PROBE_ROW, server_version: version }] : defaultRespond(sql);

    const result = await adapter.test();
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe('UNSUPPORTED');
    expect(result.error!.message).toContain(version);
    expect(result.error!.hint).toMatch(/MySQL ≥ 8\.0 and MariaDB ≥ 10\.5/);
  });

  it('refuses a server that answers the probe with nothing', async () => {
    const adapter = await connected('introspect');
    respond = (sql) => (sql.includes('VERSION()') ? [] : defaultRespond(sql));

    const result = await adapter.test();
    // An empty probe parses to version "" → major 0 → unsupported, rather than
    // being waved through as "probably fine".
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe('UNSUPPORTED');
  });
});

describe('test()', () => {
  it('reports latency, version, user, write access and TLS', async () => {
    const adapter = await connected('introspect');
    const result = await adapter.test();

    expect(result.ok).toBe(true);
    expect(result.serverVersion).toBe('8.0.36');
    expect(result.currentUser).toBe('app@10.0.0.1');
    expect(result.canWrite).toBe(true);
    expect(result.ssl).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('reports ssl false when the cipher is empty or the probe is denied', async () => {
    const adapter = await connected('introspect');

    respond = (sql) =>
      sql.includes('Ssl_cipher')
        ? [{ Variable_name: 'Ssl_cipher', Value: '' }]
        : defaultRespond(sql);
    expect((await adapter.test()).ssl).toBe(false);

    // A server that refuses SHOW SESSION STATUS must not fail the whole test.
    respond = (sql) =>
      sql.includes('Ssl_cipher') ? new Error('access denied') : defaultRespond(sql);
    const result = await adapter.test();
    expect(result.ok).toBe(true);
    expect(result.ssl).toBe(false);
  });

  it('maps a driver failure into the typed error instead of throwing', async () => {
    const adapter = await connected('introspect');
    respond = () => Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });

    const result = await adapter.test();
    expect(result.ok).toBe(false);
    expect(result.error).toBeInstanceOf(AdapterError);
    expect(result.error!.code).toBe('HOST_UNREACHABLE');
    expect(result.serverVersion).toBeNull();
    expect(result.canWrite).toBe(false);
    expect(result.ssl).toBe(false);
  });

  it('still reports write access when SHOW GRANTS is denied', async () => {
    // test() must not downgrade a perfectly usable connection just because the
    // user cannot introspect their own grants.
    const adapter = await connected('introspect');
    respond = (sql) =>
      sql.startsWith('SHOW GRANTS') ? new Error('command denied') : defaultRespond(sql);

    const result = await adapter.test();
    expect(result.ok).toBe(true);
    expect(result.canWrite).toBe(true);
  });

  it('reports a SELECT-only grant as not writable', async () => {
    const adapter = await connected('introspect');
    respond = (sql) =>
      sql.startsWith('SHOW GRANTS')
        ? [{ g: 'GRANT SELECT ON `shop`.* TO `ro`@`%`' }]
        : defaultRespond(sql);

    expect((await adapter.test()).canWrite).toBe(false);
  });

  it('reports a --read-only server as not writable', async () => {
    const adapter = await connected('introspect');
    respond = (sql) =>
      sql.includes('VERSION()') ? [{ ...PROBE_ROW, read_only: 1 }] : defaultRespond(sql);
    expect((await adapter.test()).canWrite).toBe(false);
  });
});

describe('probeCapabilities()', () => {
  it('derives privileges from SHOW GRANTS', async () => {
    const adapter = await connected('introspect');
    const probe = await adapter.probeCapabilities();

    expect(probe.privileges).toEqual({
      canReadSchema: true,
      canRead: true,
      canWrite: true,
      canDDL: true,
    });
    expect(probe.serverVersion).toBe('8.0.36');
    expect(probe.currentRole).toEqual({ name: 'app@10.0.0.1', readOnly: false });
  });

  it('reports a SELECT-only grant as readable but not writable', async () => {
    const adapter = await connected('introspect');
    respond = (sql) =>
      sql.startsWith('SHOW GRANTS')
        ? [{ g: 'GRANT SELECT ON `shop`.* TO `ro`@`%`' }]
        : defaultRespond(sql);

    const probe = await adapter.probeCapabilities();
    expect(probe.privileges.canRead).toBe(true);
    expect(probe.privileges.canWrite).toBe(false);
    expect(probe.privileges.canDDL).toBe(false);
    expect(probe.currentRole.readOnly).toBe(true);
  });

  it('assumes access when SHOW GRANTS itself is denied', async () => {
    // The grants probe is a refinement, not a gate: a user who cannot run
    // SHOW GRANTS must not be reported as unable to read.
    const adapter = await connected('introspect');
    respond = (sql) =>
      sql.startsWith('SHOW GRANTS') ? new Error('command denied') : defaultRespond(sql);

    const probe = await adapter.probeCapabilities();
    expect(probe.privileges.canRead).toBe(true);
    expect(probe.privileges.canWrite).toBe(true);
    // DDL is the exception — it defaults to false rather than being assumed.
    expect(probe.privileges.canDDL).toBe(false);
  });

  it('never claims write access on a read-only server, whatever the grants say', async () => {
    const adapter = await connected('introspect');
    respond = (sql) =>
      sql.includes('VERSION()') ? [{ ...PROBE_ROW, read_only: 'ON' }] : defaultRespond(sql);

    const probe = await adapter.probeCapabilities();
    expect(probe.privileges.canWrite).toBe(false);
    expect(probe.privileges.canDDL).toBe(false);
  });

  it('advertises RETURNING only on MariaDB', async () => {
    const adapter = await connected('introspect');

    expect((await adapter.probeCapabilities()).capabilities.supportsReturning).toBe(false);

    respond = (sql) =>
      sql.includes('VERSION()')
        ? [{ ...PROBE_ROW, server_version: '10.5.0-MariaDB' }]
        : defaultRespond(sql);
    expect((await adapter.probeCapabilities()).capabilities.supportsReturning).toBe(true);
  });

  it('skips the grants probe entirely when the DSN names no database', async () => {
    const adapter = await connected('introspect');
    respond = (sql) =>
      sql.includes('VERSION()') ? [{ ...PROBE_ROW, database_name: null }] : defaultRespond(sql);

    const probe = await adapter.probeCapabilities();
    expect(probe.privileges.canRead).toBe(true);
    expect(pools[0]!.queries.some((q) => q.startsWith('SHOW GRANTS'))).toBe(false);
  });
});

describe('introspect()', () => {
  it('refuses on the data-role instance', async () => {
    const adapter = await connected('data');
    const asIntrospect = adapter as unknown as DatabaseAdapter<'introspect'>;
    await expect(asIntrospect.introspect()).rejects.toMatchObject({ code: 'PERMISSION' });
  });

  it('refuses when the DSN names no database to introspect', async () => {
    const adapter = (await connected('introspect')) as unknown as DatabaseAdapter<'introspect'>;
    respond = (sql) =>
      sql.includes('VERSION()') ? [{ ...PROBE_ROW, database_name: null }] : defaultRespond(sql);

    const failure = await adapter.introspect().catch((error: unknown) => error);
    expect((failure as AdapterError).code).toBe('UNKNOWN');
    expect((failure as AdapterError).message).toMatch(/names no database/);
    expect((failure as AdapterError).hint).toMatch(/mysql:\/\/host\/db/);
  });

  it('runs the catalog against the probed database name', async () => {
    const adapter = (await connected('introspect')) as unknown as DatabaseAdapter<'introspect'>;
    const model = await adapter.introspect();

    expect(model.dialect).toBe('mysql');
    expect(model.name).toBe('shop');
    expect(model.source).toEqual({ kind: 'live', connectionId: 'shop' });
    expect(model.tables).toEqual([]);
    // Every catalog statement is scoped to the connected database.
    const catalogSql = pools[0]!.queries.filter((q) => q.includes('information_schema'));
    expect(catalogSql.length).toBeGreaterThan(0);
    for (const sql of catalogSql) expect(sql).toContain("'shop'");
  });
});

describe('role guards — 05 §10', () => {
  it('refuses every row-touching method on the introspect-role instance', async () => {
    const adapter = (await connected('introspect')) as unknown as DatabaseAdapter<'data'>;
    const table = { schema: null, name: 'orders' };

    const failures = await Promise.all(
      [
        adapter.count(table),
        adapter.sample(table, { purpose: 'preview' }),
        adapter.sampleColumn!(table, 'id', { optIn: true, purpose: 'preview' }),
        adapter.query({ table }),
        adapter.mutate({ kind: 'insert', table, values: {} } as never),
        adapter.collectTableStats(table),
      ].map(async (promise) => promise.catch((error: unknown) => error)),
    );

    for (const failure of failures) {
      expect(failure).toBeInstanceOf(AdapterError);
      expect((failure as AdapterError).code).toBe('PERMISSION');
    }
    // The guard runs before any I/O.
    expect(pools[0]!.queries).toHaveLength(0);
  });

  it('names the method in the guard message', async () => {
    const adapter = (await connected('introspect')) as unknown as DatabaseAdapter<'data'>;
    await expect(adapter.count({ schema: null, name: 't' })).rejects.toMatchObject({
      message: expect.stringContaining('count()'),
    });
  });

  it('reports the not-yet-implemented CRUD methods as UNSUPPORTED on the data role', async () => {
    const adapter = (await connected('data')) as unknown as DatabaseAdapter<'data'>;
    const table = { schema: null, name: 'orders' };

    for (const promise of [
      adapter.count(table),
      adapter.sample(table, { purpose: 'preview' }),
      adapter.sampleColumn!(table, 'id', { optIn: true, purpose: 'preview' }),
      adapter.query({ table }),
      adapter.mutate({ kind: 'insert', table, values: {} } as never),
    ]) {
      const failure = await promise.catch((error: unknown) => error);
      expect((failure as AdapterError).code).toBe('UNSUPPORTED');
      expect((failure as AdapterError).hint).toContain('createQueryEngine');
    }
  });

  it('allows collectTableStats on the data role', async () => {
    const adapter = (await connected('data')) as unknown as DatabaseAdapter<'data'>;
    respond = () => [{ table_rows: 0, n: 0 }];

    const stats = await adapter.collectTableStats({ schema: null, name: 'orders' });
    expect(stats.table).toEqual({ schema: null, name: 'orders' });
    expect(stats.sampled).toBe(false);
  });
});

describe('provider registration', () => {
  it('create() constructs a connected adapter for the requested role', async () => {
    const adapter = await mod.mysqlAdapter.create({ role: 'data', dsn: DSN } as never);
    expect(adapter).toBeInstanceOf(mod.MysqlAdapter);
    expect(adapter.role).toBe('data');
    expect(adapter.dialect).toBe('mysql');
    expect(pools).toHaveLength(1);
  });

  it('create() propagates a bad config instead of returning a half-built adapter', async () => {
    await expect(mod.mysqlAdapter.create({ role: 'data', dsn: '' } as never)).rejects.toThrow(
      AdapterError,
    );
  });

  it('register() wires the provider into a caller-supplied registry', () => {
    const registry = new AdapterRegistry<AdapterProvider>();
    mod.register(registry);
    expect(registry.get('mysql')).toBe(mod.mysqlAdapter);
    expect(registry.list()).toEqual(['mysql']);
  });

  it('register() with no argument targets the process-wide registry', async () => {
    const { adapterRegistry } = await import('@adminium/engine/adapter');
    expect(adapterRegistry.has('mysql')).toBe(false);

    mod.register();

    expect(adapterRegistry.has('mysql')).toBe(true);
    expect(adapterRegistry.get('mysql')).toBe(mod.mysqlAdapter);
    expect(() => mod.register()).toThrow(/already registered/);
    expect(adapterRegistry.unregister('mysql')).toBe(true);
  });
});
