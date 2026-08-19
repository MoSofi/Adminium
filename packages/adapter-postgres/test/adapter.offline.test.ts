// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `PostgresAdapter` lifecycle and role guards, against a mocked `pg` pool.
 *
 * `adapter.live.test.ts` covers the same class against a real server, but it is
 * probe-gated: on a machine (or a CI job) with no Postgres it skips entirely and
 * every guard below goes unasserted. The guards are a SECURITY boundary — 05 §10
 * says row-touching methods never run on the introspect connection — so they
 * are pinned here too, where no server is required.
 *
 * The pool is faked rather than stubbed per-test so the assertions can be about
 * what the adapter SENT (startup options, pool size, the SET LOCAL prelude),
 * which is the part a live test cannot observe.
 */
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AdapterError,
  AdapterRegistry,
  type AdapterProvider,
  type DatabaseAdapter,
} from '@adminium/engine/adapter';

/** Every pool constructed by the module under test, in construction order. */
const pools: FakePool[] = [];

/** Swapped per test; returns a pg-shaped result, or throws when it returns an Error. */
let respond: (sql: string) => unknown = () => ({ rows: [] });

class FakePool extends EventEmitter {
  ended = false;
  readonly queries: string[] = [];
  constructor(readonly options: Record<string, unknown>) {
    super();
    pools.push(this);
  }
  async query(sql: string): Promise<unknown> {
    this.queries.push(sql);
    const result = respond(sql);
    if (result instanceof Error) throw result;
    return result;
  }
  async end(): Promise<void> {
    this.ended = true;
  }
}

vi.mock('pg', () => ({ default: { Pool: FakePool } }));

const mod = await import('../src/index.js');

const DSN = 'postgres://user:pw@127.0.0.1:5432/shop';

const PROBE_ROW = {
  server_version: '16.3',
  role_name: 'app',
  database_name: 'shop',
  in_recovery: false,
  default_read_only: 'off',
  can_create: true,
  ssl: true,
};

/** Answer the probe, and nothing else. */
function probeOnly(sql: string): unknown {
  return sql.includes('current_setting') ? { rows: [PROBE_ROW] } : { rows: [] };
}

async function connected(role: 'introspect' | 'data' = 'introspect'): Promise<
  InstanceType<typeof mod.PostgresAdapter>
> {
  const adapter = new mod.PostgresAdapter(role);
  await adapter.connect({ role, dsn: DSN } as never);
  return adapter;
}

beforeEach(() => {
  pools.length = 0;
  respond = probeOnly;
});

describe('connect()', () => {
  it('rejects a config branded for a different role', async () => {
    const adapter = new mod.PostgresAdapter<'introspect'>('introspect');
    await expect(adapter.connect({ role: 'data', dsn: DSN } as never)).rejects.toMatchObject({
      name: 'AdapterError',
      code: 'PERMISSION',
    });
    // The three logical connections are never interchangeable — and no pool
    // may be opened on the way to finding that out.
    expect(pools).toHaveLength(0);
  });

  it.each([
    ['an empty DSN', ''],
    ['a missing DSN', undefined],
  ] as const)('rejects %s without opening a pool', async (_label, dsn) => {
    const adapter = new mod.PostgresAdapter<'introspect'>('introspect');
    const failure = await adapter
      .connect({ role: 'introspect', dsn } as never)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AdapterError);
    expect((failure as AdapterError).code).toBe('UNKNOWN');
    expect((failure as AdapterError).message).toMatch(/require a DSN/);
    expect((failure as AdapterError).hint).toMatch(/postgres:\/\//);
    expect(pools).toHaveLength(0);
  });

  it('sends the session settings in the startup packet', async () => {
    await connected('introspect');
    const options = String(pools[0]!.options['options']);
    expect(options).toContain('-c statement_timeout=15000');
    // The introspect role also bounds lock waits and idle transactions (05 §4.1).
    expect(options).toContain('-c lock_timeout=2s');
    expect(options).toContain('-c idle_in_transaction_session_timeout=10s');
  });

  it('omits the introspect-only limits on a data connection', async () => {
    await connected('data');
    const options = String(pools[0]!.options['options']);
    expect(options).toBe('-c statement_timeout=15000');
  });

  it('floors a fractional statement timeout', async () => {
    // `-c statement_timeout=1500.7` is rejected by the server at startup.
    const adapter = new mod.PostgresAdapter<'data'>('data');
    await adapter.connect({ role: 'data', dsn: DSN, statementTimeoutMs: 1500.7 } as never);
    expect(String(pools[0]!.options['options'])).toBe('-c statement_timeout=1500');
  });

  it('sizes the pool per role, and lets an explicit poolMax win', async () => {
    await connected('introspect');
    expect(pools[0]!.options['max']).toBe(5);
    await connected('data');
    expect(pools[1]!.options['max']).toBe(10);

    const adapter = new mod.PostgresAdapter<'data'>('data');
    await adapter.connect({ role: 'data', dsn: DSN, poolMax: 3 } as never);
    expect(pools[2]!.options['max']).toBe(3);
  });

  it('attaches an error listener so a dead idle client never crashes the process', async () => {
    await connected('introspect');
    expect(pools[0]!.listenerCount('error')).toBeGreaterThan(0);
    expect(() => pools[0]!.emit('error', new Error('57P01'))).not.toThrow();
  });
});

describe('lifecycle', () => {
  it('refuses to query before connect()', async () => {
    const adapter = new mod.PostgresAdapter<'introspect'>('introspect');
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
    const adapter = new mod.PostgresAdapter<'introspect'>('introspect');
    await expect(adapter.close()).resolves.toBeUndefined();
  });
});

describe('test() and probeCapabilities()', () => {
  it('reports latency, version, user and write access on success', async () => {
    const adapter = await connected('introspect');
    const result = await adapter.test();

    expect(result.ok).toBe(true);
    expect(result.serverVersion).toBe('16.3');
    expect(result.currentUser).toBe('app');
    expect(result.canWrite).toBe(true);
    expect(result.ssl).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
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
  });

  it('degrades an empty probe result rather than throwing', async () => {
    const adapter = await connected('introspect');
    respond = () => ({ rows: [] });

    const result = await adapter.test();
    expect(result.ok).toBe(true);
    expect(result.serverVersion).toBe('');
    // No CREATE privilege could be proven → treated as not writable.
    expect(result.canWrite).toBe(false);
  });

  it('derives privileges from the probe', async () => {
    const adapter = await connected('introspect');
    const probe = await adapter.probeCapabilities();

    expect(probe.capabilities.maxIdentifierLength).toBe(63);
    expect(probe.privileges).toEqual({
      canReadSchema: true,
      canRead: true,
      canWrite: true,
      canDDL: true,
    });
    expect(probe.currentRole).toEqual({ name: 'app', readOnly: false });
  });

  it('reports a read-only standby as neither writable nor DDL-capable', async () => {
    const adapter = await connected('introspect');
    respond = () => ({ rows: [{ ...PROBE_ROW, in_recovery: true, can_create: false }] });

    const probe = await adapter.probeCapabilities();
    expect(probe.privileges.canWrite).toBe(false);
    expect(probe.privileges.canDDL).toBe(false);
    expect(probe.currentRole.readOnly).toBe(true);
  });
});

describe('role guards — 05 §10', () => {
  it('refuses introspect() on the data-role instance', async () => {
    const adapter = await connected('data');
    const asIntrospect = adapter as unknown as DatabaseAdapter<'introspect'>;
    await expect(asIntrospect.introspect()).rejects.toMatchObject({ code: 'PERMISSION' });
  });

  it('refuses every row-touching method on the introspect-role instance', async () => {
    const adapter = (await connected('introspect')) as unknown as DatabaseAdapter<'data'>;
    const table = { schema: 'public', name: 'orders' };

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

    expect(failures).toHaveLength(6);
    for (const failure of failures) {
      expect(failure).toBeInstanceOf(AdapterError);
      // PERMISSION, not UNSUPPORTED: the role is wrong, not the feature missing.
      expect((failure as AdapterError).code).toBe('PERMISSION');
    }
    // No statement reached the pool — the guard runs before any I/O.
    expect(pools[0]!.queries).toHaveLength(0);
  });

  it('names the method in the guard message so the caller can find it', async () => {
    const adapter = (await connected('introspect')) as unknown as DatabaseAdapter<'data'>;
    await expect(
      adapter.sampleColumn!({ schema: 'public', name: 't' }, 'c', {
        optIn: true,
        purpose: 'preview',
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining('sampleColumn()') });
  });

  it('reports the not-yet-implemented CRUD methods as UNSUPPORTED on the data role', async () => {
    const adapter = (await connected('data')) as unknown as DatabaseAdapter<'data'>;
    const table = { schema: 'public', name: 'orders' };

    for (const promise of [
      adapter.count(table),
      adapter.sample(table, { purpose: 'preview' }),
      adapter.sampleColumn!(table, 'id', { optIn: true, purpose: 'preview' }),
      adapter.query({ table }),
      adapter.mutate({ kind: 'insert', table, values: {} } as never),
    ]) {
      const failure = await promise.catch((error: unknown) => error);
      expect((failure as AdapterError).code).toBe('UNSUPPORTED');
      // The hint must point at the port that DOES work today.
      expect((failure as AdapterError).hint).toContain('createQueryEngine');
    }
  });

  it('allows collectTableStats on the data role', async () => {
    const adapter = (await connected('data')) as unknown as DatabaseAdapter<'data'>;
    respond = (sql) =>
      sql.includes('reltuples') ? { rows: [{ reltuples: 0 }] } : { rows: [{ n: 0 }] };

    const stats = await adapter.collectTableStats({ schema: 'public', name: 'orders' });
    expect(stats.table).toEqual({ schema: 'public', name: 'orders' });
    expect(stats.sampled).toBe(false);
  });

  it('allows introspect() on the introspect role and reaches the catalog', async () => {
    const adapter = (await connected('introspect')) as unknown as DatabaseAdapter<'introspect'>;
    const model = await adapter.introspect();

    expect(model.dialect).toBe('postgres');
    // The probe supplies both the connection id and the model name.
    expect(model.name).toBe('shop');
    expect(model.source).toEqual({ kind: 'live', connectionId: 'shop' });
    expect(model.tables).toEqual([]);
  });
});

describe('connection-pooler fallback', () => {
  const REJECTION = 'unsupported startup parameter in options: statement_timeout';

  it('rebuilds without startup options and retries once', async () => {
    const adapter = await connected('introspect');
    let attempt = 0;
    respond = (sql) => {
      attempt += 1;
      if (attempt === 1) return new Error(REJECTION);
      return probeOnly(sql);
    };

    const result = await adapter.test();

    expect(result.ok).toBe(true);
    expect(pools).toHaveLength(2);
    // The rebuilt pool carries no startup options...
    expect(pools[1]!.options['options']).toBeUndefined();
    // ...and the stale one is torn down.
    expect(pools[0]!.ended).toBe(true);
    // ...with the same settings moved into a SET LOCAL prelude on the statement.
    expect(pools[1]!.queries[0]).toContain("SET LOCAL statement_timeout = '15000';");
    expect(pools[1]!.queries[0]).toContain('current_setting');
  });

  it('downgrades only once — a second failure is reported, not retried forever', async () => {
    const adapter = await connected('introspect');
    respond = () => new Error(REJECTION);

    const result = await adapter.test();

    expect(result.ok).toBe(false);
    expect(result.error).toBeInstanceOf(AdapterError);
    // Exactly one rebuild: the original pool plus one replacement.
    expect(pools).toHaveLength(2);
  });

  it('does not downgrade on an unrelated failure', async () => {
    const adapter = await connected('introspect');
    respond = () => Object.assign(new Error('password authentication failed'), { code: '28P01' });

    const result = await adapter.test();

    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe('AUTH');
    // The startup-packet fast path must survive an ordinary auth error.
    expect(pools).toHaveLength(1);
  });

  it('degrades an empty multi-statement batch to no rows', async () => {
    const adapter = await connected('introspect');
    let attempt = 0;
    respond = () => {
      attempt += 1;
      return attempt === 1 ? new Error(REJECTION) : [];
    };

    const result = await adapter.test();
    // `result.at(-1)` is undefined here; without the `?? []` this would throw
    // reading `.rows` of undefined and turn a thin answer into a crash.
    expect(result.ok).toBe(true);
    expect(result.serverVersion).toBe('');
  });

  it('reads the LAST result of the multi-statement prelude batch', async () => {
    const adapter = await connected('introspect');
    let attempt = 0;
    respond = (sql) => {
      attempt += 1;
      if (attempt === 1) return new Error(REJECTION);
      // A simple query with N statements yields N results; the prelude's own
      // (empty) result comes first and must not be mistaken for the payload.
      return sql.includes('current_setting')
        ? [{ rows: [] }, { rows: [PROBE_ROW] }]
        : [{ rows: [] }, { rows: [] }];
    };

    const result = await adapter.test();
    expect(result.ok).toBe(true);
    expect(result.serverVersion).toBe('16.3');
  });
});

describe('provider registration', () => {
  it('create() constructs a connected adapter for the requested role', async () => {
    const adapter = await mod.postgresAdapter.create({ role: 'data', dsn: DSN } as never);
    expect(adapter).toBeInstanceOf(mod.PostgresAdapter);
    expect(adapter.role).toBe('data');
    expect(adapter.dialect).toBe('postgres');
    expect(pools).toHaveLength(1);
  });

  it('create() propagates a bad config instead of returning a half-built adapter', async () => {
    await expect(mod.postgresAdapter.create({ role: 'data', dsn: '' } as never)).rejects.toThrow(
      AdapterError,
    );
  });

  it('register() wires the provider into a caller-supplied registry', () => {
    const registry = new AdapterRegistry<AdapterProvider>();
    mod.register(registry);
    expect(registry.get('postgres')).toBe(mod.postgresAdapter);
    expect(registry.list()).toEqual(['postgres']);
  });

  it('register() with no argument targets the process-wide registry', async () => {
    const { adapterRegistry } = await import('@adminium/engine/adapter');
    expect(adapterRegistry.has('postgres')).toBe(false);

    mod.register();

    expect(adapterRegistry.has('postgres')).toBe(true);
    expect(adapterRegistry.get('postgres')).toBe(mod.postgresAdapter);
    // Double registration is a boot-composition bug, and says so.
    expect(() => mod.register()).toThrow(/already registered/);
    expect(adapterRegistry.unregister('postgres')).toBe(true);
  });

  it('an unregistered dialect fails loudly rather than silently', async () => {
    const { adapterRegistry } = await import('@adminium/engine/adapter');
    expect(adapterRegistry.has('postgres')).toBe(false);
    expect(() => adapterRegistry.get('postgres')).toThrow(AdapterError);
  });
});
