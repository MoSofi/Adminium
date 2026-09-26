// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Full-adapter tests through the real `pg` pool — gated on BOTH probes
 * (local Postgres reachable AND the driver installed), so the suite skips
 * cleanly pre-install and on PG-less CI. Everything driver-flavored is
 * imported dynamically for the same reason.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  AdapterError,
  AdapterRegistry,
  type AdapterProvider,
  type DatabaseAdapter,
  type IntrospectConnectionConfig,
  type StatsColumnInput,
} from '@adminium/engine/adapter';

import {
  createTestDatabase,
  dropTestDatabase,
  dsnFor,
  loadEngineFixture,
  normalizeModel,
  pgDriverAvailable,
  psql,
  psqlAvailable,
} from './harness.js';

const driverReady = psqlAvailable && (await pgDriverAvailable());

type AdapterModule = typeof import('../src/index.js');

describe.skipIf(!driverReady)('PostgresAdapter (pg driver)', () => {
  let mod: AdapterModule;
  let db = '';
  let introspectAdapter: DatabaseAdapter<'introspect'>;
  const suffix = Math.random().toString(36).slice(2, 8);
  const roRole = `adminium_test_dro_${suffix}`;

  beforeAll(async () => {
    mod = await import('../src/index.js');
    db = await createTestDatabase(true);
    await psql(`CREATE ROLE ${roRole} LOGIN`);
    const config: IntrospectConnectionConfig = { role: 'introspect', dsn: dsnFor(db) };
    introspectAdapter = new mod.PostgresAdapter<'introspect'>('introspect');
    await introspectAdapter.connect(config);
  }, 60_000);

  afterAll(async () => {
    await introspectAdapter?.close();
    if (db !== '') await dropTestDatabase(db);
    await psql(`DROP ROLE IF EXISTS ${roRole}`);
  });

  it('introspect() deep-equals the shared engine fixture', async () => {
    const model = await introspectAdapter.introspect({ schemas: ['public'] });
    expect(normalizeModel(model)).toEqual(normalizeModel(loadEngineFixture()));
  });

  it('test() reports latency, server version, user, and write access', async () => {
    const result = await introspectAdapter.test();
    expect(result.ok).toBe(true);
    expect(result.serverVersion).toMatch(/^\d+\./);
    expect(result.currentUser).not.toBeNull();
    expect(result.canWrite).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeUndefined();
  });

  it('probeCapabilities() reflects the dialect and the connected role', async () => {
    const probe = await introspectAdapter.probeCapabilities();
    expect(probe.capabilities).toMatchObject({
      hasSchemas: true,
      hasEnums: true,
      hasRLS: true,
      supportsReturning: true,
      maxIdentifierLength: 63,
    });
    expect(probe.privileges).toEqual({
      canReadSchema: true,
      canRead: true,
      canWrite: true,
      canDDL: true,
    });
    expect(probe.currentRole.readOnly).toBe(false);
  });

  it('probeCapabilities() detects a read-only role (it may write no table)', async () => {
    const adapter = new mod.PostgresAdapter<'introspect'>('introspect');
    await adapter.connect({ role: 'introspect', dsn: dsnFor(db, roRole) });
    try {
      const probe = await adapter.probeCapabilities();
      expect(probe.currentRole).toEqual({ name: roRole, readOnly: true });
      expect(probe.privileges.canWrite).toBe(false);
      expect(probe.privileges.canDDL).toBe(false);
    } finally {
      await adapter.close();
    }
  });

  it('row-touching methods are runtime-guarded on the introspect role', async () => {
    const adapter = introspectAdapter as unknown as DatabaseAdapter<'data'>;
    await expect(adapter.query({ table: { schema: 'public', name: 'orders' } })).rejects.toMatchObject(
      { name: 'AdapterError', code: 'PERMISSION' },
    );
    await expect(
      adapter.sample({ schema: 'public', name: 'orders' }, { purpose: 'preview' }),
    ).rejects.toMatchObject({ code: 'PERMISSION' });
  });

  it('introspect() is runtime-guarded on the data role', async () => {
    const adapter = new mod.PostgresAdapter<'data'>('data');
    await adapter.connect({ role: 'data', dsn: dsnFor(db) });
    try {
      const asIntrospect = adapter as unknown as DatabaseAdapter<'introspect'>;
      await expect(asIntrospect.introspect()).rejects.toMatchObject({ code: 'PERMISSION' });
      // Data methods pass the role guard but are scope → UNSUPPORTED.
      await expect(
        (adapter as DatabaseAdapter<'data'>).query({ table: { schema: 'public', name: 'orders' } }),
      ).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    } finally {
      await adapter.close();
    }
  });

  it('connect() rejects a mismatched role brand', async () => {
    const adapter = new mod.PostgresAdapter<'introspect'>('introspect');
    await expect(
      adapter.connect({ role: 'data', dsn: dsnFor(db) } as unknown as IntrospectConnectionConfig),
    ).rejects.toMatchObject({ code: 'PERMISSION' });
  });

  it('test() against an unreachable host maps to HOST_UNREACHABLE', async () => {
    const adapter = new mod.PostgresAdapter<'introspect'>('introspect');
    await adapter.connect({ role: 'introspect', dsn: 'postgres://127.0.0.1:59999/nope' });
    try {
      const result = await adapter.test();
      expect(result.ok).toBe(false);
      expect(result.error).toBeInstanceOf(AdapterError);
      expect(result.error?.code).toBe('HOST_UNREACHABLE');
    } finally {
      await adapter.close();
    }
  });

  it('close() is idempotent', async () => {
    const adapter = new mod.PostgresAdapter<'introspect'>('introspect');
    await adapter.connect({ role: 'introspect', dsn: dsnFor(db) });
    await adapter.close();
    await adapter.close();
  });

  it('register() wires the provider into a registry', () => {
    const registry = new AdapterRegistry<AdapterProvider>();
    mod.register(registry);
    expect(registry.get('postgres')).toBe(mod.postgresAdapter);
    expect(registry.list()).toEqual(['postgres']);
  });

  it('createQueryEngine() exposes the Kysely dialect, quoting, and serializers', async () => {
    const { PostgresDialect } = await import('kysely');
    const engine = mod.createQueryEngine({ role: 'data', dsn: dsnFor(db) });
    try {
      expect(engine.dialect).toBeInstanceOf(PostgresDialect);
      expect(engine.identifiers.quote('order details')).toBe('"order details"');
      expect(engine.identifiers.maxLength).toBe(63);
      expect(engine.serializers.bigint).toBeDefined();
      expect(engine.serializers.binary).toBeUndefined();
    } finally {
      await engine.destroy();
      await engine.destroy(); // idempotent
    }
  });
});

describe.skipIf(!driverReady)('collectTableStats (data role — statistics)', () => {
  let mod: AdapterModule;
  let db = '';
  let dataAdapter: DatabaseAdapter<'data'>;

  const table = { schema: 'public', name: 'people' };
  const cols: StatsColumnInput[] = [
    { name: 'email', logicalType: 'text', piiSuspected: true },
    { name: 'city', logicalType: 'text' },
    { name: 'age', logicalType: 'integer' },
  ];

  beforeAll(async () => {
    mod = await import('../src/index.js');
    db = await createTestDatabase(false);
    await psql(
      `CREATE TABLE people (id serial PRIMARY KEY, email text, city text, age int);
       INSERT INTO people (email, city, age) VALUES
         ('a@x.com', 'Paris', 30),
         ('b@x.com', 'Paris', NULL),
         ('c@x.com', 'Berlin', 40),
         (NULL, 'Berlin', 25),
         ('e@x.com', NULL, 50);`,
      { db },
    );
    dataAdapter = new mod.PostgresAdapter<'data'>('data');
    await dataAdapter.connect({ role: 'data', dsn: dsnFor(db) });
  }, 60_000);

  afterAll(async () => {
    await dataAdapter?.close();
    if (db !== '') await dropTestDatabase(db);
  });

  it('is sample-free by default — aggregates only, no cell values leak', async () => {
    const stats = await dataAdapter.collectTableStats(table, { columns: cols });
    // reltuples is stale on a just-created table → exact COUNT(*) fallback.
    expect(stats.rowCountEstimate).toBe(5);
    expect(stats.rowCountExact).toBe(true);
    expect(stats.sampled).toBe(false);
    for (const column of stats.columns) {
      expect(column.min).toBeUndefined();
      expect(column.max).toBeUndefined();
      expect(column.sampleValues).toBeUndefined();
    }
    const city = stats.columns.find((c) => c.column === 'city');
    expect(city?.nullFraction).toBeCloseTo(0.2);
    expect(city?.distinctCount).toBe(2);
    const json = JSON.stringify(stats);
    expect(json).not.toContain('Paris');
    expect(json).not.toContain('a@x.com');
  });

  it('under sampling opt-in, PII columns never contribute values', async () => {
    const stats = await dataAdapter.collectTableStats(table, {
      columns: cols,
      sampling: { maxValuesPerColumn: 10 },
    });
    expect(stats.sampled).toBe(true);

    const email = stats.columns.find((c) => c.column === 'email');
    expect(email?.sampleValues).toBeUndefined();
    expect(email?.min).toBeUndefined();
    expect(email?.max).toBeUndefined();

    const city = stats.columns.find((c) => c.column === 'city');
    expect(city?.sampleValues).toEqual(expect.arrayContaining(['Paris', 'Berlin']));

    const age = stats.columns.find((c) => c.column === 'age');
    expect(age?.min).toBe(25);
    expect(age?.max).toBe(50);

    expect(JSON.stringify(stats)).not.toContain('a@x.com');
  });

  it('is runtime-guarded on the introspect role', async () => {
    const introspect = new mod.PostgresAdapter<'introspect'>('introspect');
    await introspect.connect({ role: 'introspect', dsn: dsnFor(db) });
    try {
      await expect(
        (introspect as unknown as DatabaseAdapter<'data'>).collectTableStats(table),
      ).rejects.toMatchObject({ code: 'PERMISSION' });
    } finally {
      await introspect.close();
    }
  });
});

describe.skipIf(!driverReady)('PostgresAdapter — table grants', () => {
  let mod: typeof import('../src/index.js');
  let db = '';
  const suffix = Math.random().toString(36).slice(2, 8);
  const dml = `adminium_test_dml_${suffix}`;
  const none = `adminium_test_none_${suffix}`;

  beforeAll(async () => {
    mod = await import('../src/index.js');
    db = await createTestDatabase(false);
    await psql(`CREATE ROLE ${dml} LOGIN; CREATE ROLE ${none} LOGIN;`);
    await psql(
      `CREATE TABLE public.items (id serial PRIMARY KEY, title text, status text, updated_at timestamptz);
       CREATE TABLE public.releases (id serial PRIMARY KEY, version text);
       CREATE TABLE public.notes (id serial PRIMARY KEY, body text, author text);
       GRANT USAGE ON SCHEMA public TO ${dml}, ${none};
       GRANT SELECT, INSERT, UPDATE ON public.items TO ${dml};
       GRANT USAGE ON SEQUENCE public.items_id_seq TO ${dml};
       GRANT SELECT ON public.releases TO ${dml}, ${none};
       GRANT SELECT, DELETE ON public.notes TO ${dml};
       GRANT UPDATE (body) ON public.notes TO ${dml};`,
      { db },
    );
  }, 60_000);

  afterAll(async () => {
    if (db !== '') await dropTestDatabase(db);
    await psql(`DROP ROLE IF EXISTS ${dml}; DROP ROLE IF EXISTS ${none};`);
  });

  async function withRole<T>(role: string, fn: (adapter: DatabaseAdapter<'data'>) => Promise<T>): Promise<T> {
    const adapter = new mod.PostgresAdapter<'data'>('data');
    await adapter.connect({ role: 'data', dsn: dsnFor(db, role) });
    try {
      return await fn(adapter);
    } finally {
      await adapter.close();
    }
  }

  it('a role granted only DML on its tables writes: not read-only, and no DDL', async () => {
    const probe = await withRole(dml, (a) => a.probeCapabilities());
    expect(probe.currentRole).toEqual({ name: dml, readOnly: false });
    expect(probe.privileges).toMatchObject({ canWrite: true, canDDL: false });
  });

  it('a role granted only SELECT is read-only', async () => {
    const probe = await withRole(none, (a) => a.probeCapabilities());
    expect(probe.currentRole.readOnly).toBe(true);
    expect(probe.privileges.canWrite).toBe(false);
  });

  it('reads each table\'s rights, and each column\'s only where they differ', async () => {
    const map = await withRole(dml, (a) => a.probeTablePrivileges!());
    expect(map['public.items']).toEqual({ insert: true, update: true, delete: false });
    expect(map['public.releases']).toEqual({ insert: false, update: false, delete: false });
    expect(map['public.notes']).toEqual({
      insert: false,
      update: true,
      delete: true,
      columns: {
        id: { insert: false, update: false },
        body: { insert: false, update: true },
        author: { insert: false, update: false },
      },
    });
  });
});
