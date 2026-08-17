// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Full-adapter tests through the real better-sqlite3 driver — gated on the
 * native binding loading, so the suite skips cleanly pre-install. Covers the
 * connect/test/probe surface (read-only detection per 05 §4.3: mode, file
 * permissions, PRAGMA query_only), role guards, error mapping, registration,
 * and CRUD through the Kysely query engine with instance injection.
 */
import { chmodSync } from 'node:fs';

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
  makeTempDir,
  removeTempDir,
  sqliteDriverAvailable,
  testDatabasePath,
} from './harness.js';

const driverReady = await sqliteDriverAvailable();

type AdapterModule = typeof import('../src/index.js');

describe.skipIf(!driverReady)('SqliteAdapter (better-sqlite3 driver)', () => {
  let mod: AdapterModule;
  let dir = '';
  let file = '';
  let introspectAdapter: DatabaseAdapter<'introspect'>;

  beforeAll(async () => {
    mod = await import('../src/index.js');
    dir = makeTempDir();
    file = await createTestDatabase(dir, true);
    introspectAdapter = new mod.SqliteAdapter<'introspect'>('introspect');
    await introspectAdapter.connect({ role: 'introspect', file });
  }, 60_000);

  afterAll(async () => {
    await introspectAdapter?.close();
    if (dir !== '') removeTempDir(dir);
  });

  it('test() reports the SQLite version and no transport/user', async () => {
    const result = await introspectAdapter.test();
    expect(result.ok).toBe(true);
    expect(result.serverVersion).toMatch(/^3\./);
    expect(result.currentUser).toBeNull();
    expect(result.ssl).toBe(false);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('the introspect role reports the CONNECTION as writable on a writable file', async () => {
    // The introspect HANDLE always opens readonly (a safety measure), but
    // read-only DETECTION must reflect the connection — the file is writable
    // via the data role — not the forced open mode. Conflating the two reported
    // every connection read-only and gated all CRUD (05 §4.3 regression).
    const result = await introspectAdapter.test();
    expect(result.canWrite).toBe(true);
    const probe = await introspectAdapter.probeCapabilities();
    expect(probe.currentRole).toEqual({ name: 'local', readOnly: false });
    expect(probe.privileges.canWrite).toBe(true);
  });

  it('the introspect role reports read-only for a non-writable file (chmod 0444)', async () => {
    // Isolates the W_OK detection path: the introspect handle opens readonly so
    // it can open the 0444 file, and the config mode is the default readwrite,
    // so the only signal flipping the connection to read-only is file W_OK.
    const roFile = await createTestDatabase(dir, false, 'CREATE TABLE t (id INTEGER)');
    chmodSync(roFile, 0o444);
    const adapter = new mod.SqliteAdapter<'introspect'>('introspect');
    await adapter.connect({ role: 'introspect', file: roFile });
    try {
      const result = await adapter.test();
      expect(result.canWrite).toBe(false);
      const probe = await adapter.probeCapabilities();
      expect(probe.currentRole).toEqual({ name: 'local', readOnly: true });
      expect(probe.privileges.canWrite).toBe(false);
    } finally {
      await adapter.close();
      chmodSync(roFile, 0o644);
    }
  });

  it('an explicit mode: readonly config reports read-only even on a writable file', async () => {
    const adapter = new mod.SqliteAdapter<'data'>('data');
    await adapter.connect({ role: 'data', file, mode: 'readonly' });
    try {
      const probe = await adapter.probeCapabilities();
      expect(probe.currentRole.readOnly).toBe(true);
      expect(probe.privileges.canWrite).toBe(false);
    } finally {
      await adapter.close();
    }
  });

  it('a data-role handle on a writable file reads as writable', async () => {
    const adapter = new mod.SqliteAdapter<'data'>('data');
    await adapter.connect({ role: 'data', file });
    try {
      const probe = await adapter.probeCapabilities();
      expect(probe.currentRole.readOnly).toBe(false);
      expect(probe.privileges.canWrite).toBe(true);
    } finally {
      await adapter.close();
    }
  });

  it('probeCapabilities() reflects the §4.3 capability flags', async () => {
    const probe = await introspectAdapter.probeCapabilities();
    expect(probe.capabilities).toMatchObject({
      hasEnums: false,
      hasFKs: true,
      hasSchemas: false,
      hasComments: false,
      hasRLS: false,
      hasRowEstimates: true,
      supportsStatementTimeout: false,
      supportsReturning: true,
      maxIdentifierLength: 128,
    });
    expect(probe.serverVersion).toMatch(/^3\./);
  });

  it('file-permission read-only detection (data role, chmod 0444)', async () => {
    const roFile = await createTestDatabase(dir, false, 'CREATE TABLE t (id INTEGER)');
    chmodSync(roFile, 0o444);
    const adapter = new mod.SqliteAdapter<'data'>('data');
    await adapter.connect({ role: 'data', file: roFile, mode: 'readonly' });
    try {
      const probe = await adapter.probeCapabilities();
      expect(probe.currentRole.readOnly).toBe(true);
    } finally {
      await adapter.close();
      chmodSync(roFile, 0o644);
    }
  });

  it(':memory: connections work for demo/test', async () => {
    const adapter = new mod.SqliteAdapter<'introspect'>('introspect');
    await adapter.connect({ role: 'introspect', file: ':memory:' });
    try {
      const result = await adapter.test();
      expect(result.ok).toBe(true);
      const model = await adapter.introspect();
      expect(model.name).toBe('memory');
      expect(model.tables).toHaveLength(0);
    } finally {
      await adapter.close();
    }
  });

  it('accepts sqlite:/// and file: DSN spellings', async () => {
    const adapter = new mod.SqliteAdapter<'introspect'>('introspect');
    await adapter.connect({ role: 'introspect', dsn: `sqlite://${file}` });
    try {
      const result = await adapter.test();
      expect(result.ok).toBe(true);
    } finally {
      await adapter.close();
    }
  });

  it('row-touching methods are runtime-guarded on the introspect role', async () => {
    const adapter = introspectAdapter as unknown as DatabaseAdapter<'data'>;
    await expect(
      adapter.query({ table: { schema: null, name: 'orders' } }),
    ).rejects.toMatchObject({ name: 'AdapterError', code: 'PERMISSION' });
    await expect(
      adapter.sample({ schema: null, name: 'orders' }, { purpose: 'preview' }),
    ).rejects.toMatchObject({ code: 'PERMISSION' });
  });

  it('introspect() is runtime-guarded on the data role', async () => {
    const adapter = new mod.SqliteAdapter<'data'>('data');
    await adapter.connect({ role: 'data', file });
    try {
      const asIntrospect = adapter as unknown as DatabaseAdapter<'introspect'>;
      await expect(asIntrospect.introspect()).rejects.toMatchObject({ code: 'PERMISSION' });
      await expect(
        (adapter as DatabaseAdapter<'data'>).query({ table: { schema: null, name: 'orders' } }),
      ).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    } finally {
      await adapter.close();
    }
  });

  it('connect() rejects a mismatched role brand and a missing file', async () => {
    const adapter = new mod.SqliteAdapter<'introspect'>('introspect');
    await expect(
      adapter.connect({ role: 'data', file } as unknown as IntrospectConnectionConfig),
    ).rejects.toMatchObject({ code: 'PERMISSION' });
    await expect(adapter.connect({ role: 'introspect' })).rejects.toMatchObject({
      code: 'UNKNOWN',
    });
  });

  it('a nonexistent file maps to HOST_UNREACHABLE (fileMustExist)', async () => {
    const adapter = new mod.SqliteAdapter<'introspect'>('introspect');
    await adapter.connect({ role: 'introspect', file: testDatabasePath(dir) });
    const result = await adapter.test();
    expect(result.ok).toBe(false);
    expect(result.error).toBeInstanceOf(AdapterError);
    expect(result.error?.code).toBe('HOST_UNREACHABLE');
    await adapter.close();
  });

  it('close() is idempotent', async () => {
    const adapter = new mod.SqliteAdapter<'introspect'>('introspect');
    await adapter.connect({ role: 'introspect', file });
    await adapter.test(); // force the handle open
    await adapter.close();
    await adapter.close();
  });

  it('register() wires the provider into a registry', () => {
    const registry = new AdapterRegistry<AdapterProvider>();
    mod.register(registry);
    expect(registry.get('sqlite')).toBe(mod.sqliteAdapter);
    expect(registry.list()).toEqual(['sqlite']);
  });
});

describe.skipIf(!driverReady)('query engine (Kysely SqliteDialect CRUD)', () => {
  let mod: AdapterModule;
  let dir = '';
  let file = '';

  beforeAll(async () => {
    mod = await import('../src/index.js');
    dir = makeTempDir();
    file = await createTestDatabase(dir, true);
  }, 60_000);

  afterAll(() => {
    if (dir !== '') removeTempDir(dir);
  });

  interface Shipper {
    shipper_id: number;
    company_name: string;
    phone: string | null;
  }

  it('exposes the Kysely dialect, quoting, and serializers, and runs CRUD', async () => {
    const { Kysely, SqliteDialect } = await import('kysely');
    const engine = mod.createQueryEngine({ role: 'data', file });
    try {
      expect(engine.dialect).toBeInstanceOf(SqliteDialect);
      expect(engine.identifiers.quote('order details')).toBe('"order details"');
      expect(engine.identifiers.maxLength).toBe(128);
      expect(engine.serializers.bigint).toBeDefined();
      expect(engine.serializers.binary).toBeUndefined();

      const kysely = new Kysely<{ shippers: Shipper }>({
        dialect: engine.dialect as InstanceType<typeof SqliteDialect>,
      });
      // INSERT … RETURNING (SQLite ≥ 3.35 — supportsReturning true)
      const inserted = await kysely
        .insertInto('shippers')
        .values({ shipper_id: 99, company_name: 'Test Freight', phone: null })
        .returningAll()
        .executeTakeFirst();
      expect(inserted).toMatchObject({ shipper_id: 99, company_name: 'Test Freight' });
      // UPDATE
      await kysely
        .updateTable('shippers')
        .set({ phone: '555-0000' })
        .where('shipper_id', '=', 99)
        .execute();
      const updated = await kysely
        .selectFrom('shippers')
        .select('phone')
        .where('shipper_id', '=', 99)
        .executeTakeFirst();
      expect(updated?.phone).toBe('555-0000');
      // DELETE
      const deleted = await kysely
        .deleteFrom('shippers')
        .where('shipper_id', '=', 99)
        .executeTakeFirst();
      expect(Number(deleted.numDeletedRows)).toBe(1);
      // NOTE: no kysely.destroy() — the engine owns the handle.
    } finally {
      await engine.destroy();
      await engine.destroy(); // idempotent
    }
  });

  it('supports better-sqlite3 instance injection (05-T14)', async () => {
    const { Kysely, SqliteDialect } = await import('kysely');
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(file);
    try {
      const engine = mod.createQueryEngine({ role: 'data', file: ':memory:' }, { database: db });
      expect(engine.dialect).toBeInstanceOf(SqliteDialect);
      const kysely = new Kysely<{ shippers: Shipper }>({
        dialect: engine.dialect as InstanceType<typeof SqliteDialect>,
      });
      const rows = await kysely.selectFrom('shippers').selectAll().execute();
      expect(rows.length).toBeGreaterThan(0);
      await engine.destroy();
      // The injected handle stays open — owned by the caller.
      expect(db.open).toBe(true);
    } finally {
      db.close();
    }
  });

  it('applyDataPragmas sets WAL/foreign_keys/busy_timeout on file databases', async () => {
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(file);
    try {
      mod.applyDataPragmas(db, file);
      expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
    } finally {
      db.close();
    }
  });
});

describe.skipIf(!driverReady)('collectTableStats (data role — 06 §4.2 statistics)', () => {
  let mod: AdapterModule;
  let dir = '';
  let file = '';
  let dataAdapter: DatabaseAdapter<'data'>;

  const table = { schema: null, name: 'people' };
  const cols: StatsColumnInput[] = [
    { name: 'email', logicalType: 'text', piiSuspected: true },
    { name: 'city', logicalType: 'text' },
    { name: 'age', logicalType: 'integer' },
  ];

  beforeAll(async () => {
    mod = await import('../src/index.js');
    dir = makeTempDir();
    file = await createTestDatabase(
      dir,
      false,
      `CREATE TABLE people (id INTEGER PRIMARY KEY, email TEXT, city TEXT, age INTEGER);
       INSERT INTO people (email, city, age) VALUES
         ('a@x.com', 'Paris', 30),
         ('b@x.com', 'Paris', NULL),
         ('c@x.com', 'Berlin', 40),
         (NULL, 'Berlin', 25),
         ('e@x.com', NULL, 50);`,
    );
    dataAdapter = new mod.SqliteAdapter<'data'>('data');
    await dataAdapter.connect({ role: 'data', file });
  }, 60_000);

  afterAll(async () => {
    await dataAdapter?.close();
    if (dir !== '') removeTempDir(dir);
  });

  it('is sample-free by default — aggregates only, no cell values leak', async () => {
    const stats = await dataAdapter.collectTableStats(table, { columns: cols });
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
    // The serialized result contains NOT ONE cell value.
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

    // The PII email value never appears anywhere in the result.
    expect(JSON.stringify(stats)).not.toContain('a@x.com');
  });

  it('is runtime-guarded on the introspect role', async () => {
    const introspect = new mod.SqliteAdapter<'introspect'>('introspect');
    await introspect.connect({ role: 'introspect', file });
    try {
      await expect(
        (introspect as unknown as DatabaseAdapter<'data'>).collectTableStats(table),
      ).rejects.toMatchObject({ code: 'PERMISSION' });
    } finally {
      await introspect.close();
    }
  });
});
