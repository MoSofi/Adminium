/**
 * Offline unit tests for the connections layer: DSN parsing/masking, the §7
 * item-2 SSRF guard, same-database detection, the two 01 §3.1 meta-store
 * refusals (placement + prefix collision), adapter-module provider discovery,
 * and the DSN crypto closures.
 */

import BetterSqlite3 from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { AdapterRegistry, type AdapterProvider } from '@adminium/engine/adapter';
import { createSqliteMetaDb, firstRun, type MetaDb } from '@adminium/meta';

import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import {
  guardDsn,
  guardOutboundUrl,
  maskDsn,
  MetaPlacementError,
  MetaPrefixCollisionError,
  parseDsn,
  sameDatabase,
} from '../src/connections/dsn.js';
import { ConnectionManager, type ConnectionTestSummary } from '../src/connections/manager.js';
import { providerFromModule, registerAdapters } from '../src/connections/register-adapters.js';
import { ENC_TOKEN_PREFIX } from '../src/config/secrets.js';

describe('parseDsn / maskDsn', () => {
  it('parses postgres DSNs and strips credentials from the mask', () => {
    const parsed = parseDsn('postgres://ava:secret@db.acme.io:5433/prod');
    expect(parsed).toEqual({
      scheme: 'postgres',
      host: 'db.acme.io',
      port: 5433,
      database: 'prod',
      user: 'ava',
      file: null,
    });
    expect(maskDsn('postgres://ava:secret@db.acme.io:5433/prod')).toBe(
      'postgres://ava@db.acme.io:5433/prod',
    );
    expect(maskDsn('postgresql://db.acme.io/prod')).toBe('postgres://db.acme.io:5432/prod');
    expect(maskDsn('not a dsn')).toBeNull();
    expect(maskDsn('sqlite:/data/app.db')).toBe('sqlite:/data/app.db');
  });

  it('rejects schemes outside the allowlist (§7 item 2)', () => {
    for (const dsn of ['http://x/y', 'gopher://x', 'mongodb://h/db']) {
      expect(() => parseDsn(dsn)).toThrow('Unsupported DSN scheme');
    }
  });
});

describe('guardDsn', () => {
  it('always blocks cloud-metadata hosts', () => {
    expect(() => guardDsn('postgres://u@169.254.169.254/db')).toThrow('blocked address');
    expect(() => guardDsn('mysql://u@metadata.google.internal/db')).toThrow('blocked address');
  });

  it('blocks loopback only when asked to (production)', () => {
    expect(() => guardDsn('postgres://u@127.0.0.1/db')).not.toThrow();
    expect(() => guardDsn('postgres://u@localhost/db', { blockLoopback: true })).toThrow('Loopback');
    expect(() => guardDsn('postgres://u@127.9.9.9/db', { blockLoopback: true })).toThrow('Loopback');
  });
});

describe('guardOutboundUrl (LLM baseUrl SSRF guard, security review 2026-07-23)', () => {
  it('always blocks cloud-metadata endpoints', () => {
    expect(() => guardOutboundUrl('http://169.254.169.254')).toThrow('blocked address');
    expect(() => guardOutboundUrl('http://169.254.169.254/latest/meta-data/')).toThrow('blocked address');
    expect(() => guardOutboundUrl('https://metadata.google.internal/computeMetadata/v1/')).toThrow(
      'blocked address',
    );
    expect(() => guardOutboundUrl('http://[fd00:ec2::254]/latest/')).toThrow('blocked address');
  });

  it('blocks loopback only when asked to (production)', () => {
    // Dev: Ollama on localhost is legitimate.
    expect(() => guardOutboundUrl('http://localhost:11434')).not.toThrow();
    expect(() => guardOutboundUrl('http://127.0.0.1:11434')).not.toThrow();
    expect(() => guardOutboundUrl('http://localhost:11434', { blockLoopback: true })).toThrow('Loopback');
    expect(() => guardOutboundUrl('http://[::1]:11434', { blockLoopback: true })).toThrow('Loopback');
  });

  it('rejects non-http(s) schemes and malformed URLs', () => {
    expect(() => guardOutboundUrl('file:///etc/passwd')).toThrow('http and https');
    expect(() => guardOutboundUrl('gopher://internal/')).toThrow('http and https');
    expect(() => guardOutboundUrl('not a url')).toThrow('Invalid URL');
  });

  it('allows a normal remote provider URL', () => {
    expect(() => guardOutboundUrl('https://api.openai.com/v1')).not.toThrow();
    expect(() =>
      guardOutboundUrl('https://api.openai.com/v1', { blockLoopback: true }),
    ).not.toThrow();
  });
});

describe('sameDatabase', () => {
  it('matches host+port+database, treating localhost and 127.0.0.1 as one', () => {
    expect(sameDatabase('postgres://a@localhost:5432/x', 'postgres://b:pw@127.0.0.1:5432/x')).toBe(true);
    expect(sameDatabase('postgres://a@h:5432/x', 'postgres://a@h:5432/y')).toBe(false);
    expect(sameDatabase('postgres://a@h:5432/x', 'mysql://a@h:5432/x')).toBe(false);
    expect(sameDatabase('sqlite:/tmp/a.db', 'sqlite:/tmp/a.db')).toBe(true);
    expect(sameDatabase('sqlite:/tmp/a.db', 'sqlite:/tmp/b.db')).toBe(false);
    expect(sameDatabase(null, 'postgres://a@h/x')).toBe(false);
  });
});

function summary(privileges: { canWrite: boolean; canDDL: boolean }): ConnectionTestSummary {
  return {
    ok: true,
    latencyMs: 1,
    serverVersion: 'PostgreSQL 16',
    readOnly: !privileges.canWrite,
    capabilities: {
      capabilities: {} as never,
      privileges: { canReadSchema: true, canRead: true, ...privileges },
      serverVersion: 'PostgreSQL 16',
      currentRole: { name: 'role', readOnly: !privileges.canWrite },
    },
    error: null,
  };
}

describe('meta-placement enforcement (01 §3.1)', () => {
  const crypto = dsnCryptoFromSecret('unit-test-secret');
  const fakeMeta = { db: null, dialect: 'sqlite' } as never;
  const dataDsn = 'postgres://app@db.local:5432/prod';

  it('refuses same-db placement against a read-only role with META_PLACEMENT_INVALID (409)', () => {
    const manager = new ConnectionManager({ meta: fakeMeta, crypto, metaDsn: dataDsn });
    try {
      manager.enforceMetaPlacement(dataDsn, summary({ canWrite: false, canDDL: false }));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(MetaPlacementError);
      const appError = error as MetaPlacementError;
      expect(appError.statusCode).toBe(409);
      expect(appError.code).toBe('META_PLACEMENT_INVALID');
      expect(appError.message).toContain('read-only');
    }
  });

  it('refuses same-db placement against a DDL-less role', () => {
    const manager = new ConnectionManager({ meta: fakeMeta, crypto, metaDsn: dataDsn });
    expect(() =>
      manager.enforceMetaPlacement(dataDsn, summary({ canWrite: true, canDDL: false })),
    ).toThrow(MetaPlacementError);
  });

  it('allows same-db with full privileges, separate DBs, and embedded meta', () => {
    const sameDb = new ConnectionManager({ meta: fakeMeta, crypto, metaDsn: dataDsn });
    expect(() => sameDb.enforceMetaPlacement(dataDsn, summary({ canWrite: true, canDDL: true }))).not.toThrow();

    const separate = new ConnectionManager({
      meta: fakeMeta,
      crypto,
      metaDsn: 'postgres://meta@other.host:5432/adminium_meta',
    });
    expect(() =>
      separate.enforceMetaPlacement(dataDsn, summary({ canWrite: false, canDDL: false })),
    ).not.toThrow();

    const embedded = new ConnectionManager({ meta: fakeMeta, crypto, metaDsn: null });
    expect(() =>
      embedded.enforceMetaPlacement(dataDsn, summary({ canWrite: false, canDDL: false })),
    ).not.toThrow();
  });
});

describe('meta prefix-collision pre-flight (01 §3.1)', () => {
  const crypto = dsnCryptoFromSecret('unit-test-secret');
  const META_DSN = 'postgres://meta@db.local:5432/shared';

  function managerOver(meta: MetaDb): ConnectionManager {
    return new ConnectionManager({ meta, crypto, metaDsn: META_DSN });
  }

  function emptyStore(): MetaDb {
    return createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  }

  it('passes on a fresh database — nothing there to collide with', async () => {
    await expect(managerOver(emptyStore()).assertMetaPrefixAvailable()).resolves.toBeUndefined();
  });

  it('passes on an already-migrated store, which is every upgrade after the first', async () => {
    // THE FALSE POSITIVE THIS GUARDS. The tables ARE there on every normal
    // `docker compose pull && up -d` — the check must not refuse the upgrade it
    // was added to protect. The ledger is what says they are ours.
    const meta = emptyStore();
    await firstRun(meta);
    await expect(managerOver(meta).assertMetaPrefixAvailable()).resolves.toBeUndefined();
  });

  it('refuses a foreign adminium_* namespace with META_PREFIX_COLLISION (409)', async () => {
    // Somebody else's tables, no `adminium_migrations`. Without this the first
    // migration runs a `CREATE TABLE adminium_users` into a database that
    // already has one, after having created a dozen other tables there — and
    // the runner is up-only, so nothing undoes them.
    const meta = emptyStore();
    await meta.db.schema
      .createTable('adminium_users')
      .addColumn('id', 'text', (col) => col.primaryKey())
      .execute();
    await meta.db.schema
      .createTable('adminium_widgets')
      .addColumn('id', 'text', (col) => col.primaryKey())
      .execute();

    try {
      await managerOver(meta).assertMetaPrefixAvailable();
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(MetaPrefixCollisionError);
      const appError = error as MetaPrefixCollisionError;
      expect(appError.statusCode).toBe(409);
      expect(appError.code).toBe('META_PREFIX_COLLISION');
      // Names the tables — a refusal you cannot act on is a crash with manners.
      expect(appError.message).toContain('adminium_users');
      expect(appError.message).toContain('adminium_widgets');
      // And states both remedies.
      expect(appError.message).toContain('ADMINIUM_META_URL');
      expect(appError.message).toMatch(/drop\/rename/);
      // The DSN in `details` is masked: this lands in container logs.
      expect(appError.details).toMatchObject({
        tables: ['adminium_users', 'adminium_widgets'],
        metaDsn: 'postgres://meta@db.local:5432/shared',
      });
    }
  });

  it('lets a half-created store through when the ledger exists but is empty', async () => {
    // MySQL has no transactional DDL: a boot that dies part-way through the
    // first migration leaves tables behind AND a written ledger. Refusing there
    // would brick the retry, which is the one thing that fixes it.
    const meta = emptyStore();
    await meta.db.schema
      .createTable('adminium_migrations')
      .addColumn('name', 'text', (col) => col.primaryKey())
      .execute();
    await meta.db.schema
      .createTable('adminium_users')
      .addColumn('id', 'text', (col) => col.primaryKey())
      .execute();
    await expect(managerOver(meta).assertMetaPrefixAvailable()).resolves.toBeUndefined();
  });

  it('ignores tables outside the adminium_ namespace', async () => {
    // Pointing the meta store at a database that also holds the user's own
    // tables is legitimate — that is the §3.1 same-db placement the wizard
    // offers. Only the `adminium_` namespace is Adminium's to claim.
    const meta = emptyStore();
    for (const table of ['customers', 'orders', 'admin_users']) {
      await meta.db.schema
        .createTable(table)
        .addColumn('id', 'text', (col) => col.primaryKey())
        .execute();
    }
    await expect(managerOver(meta).assertMetaPrefixAvailable()).resolves.toBeUndefined();
  });
});

describe('adapter provider discovery', () => {
  const provider = {
    dialect: 'postgres',
    create: () => ({}),
    createQueryEngine: () => ({}),
  };

  it('finds providers under conventional export names and rejects non-providers', () => {
    expect(providerFromModule({ postgresAdapter: provider })).toBe(provider);
    expect(providerFromModule({ default: provider })).toBe(provider);
    expect(providerFromModule({ something: provider })).toBe(provider);
    expect(providerFromModule({ PACKAGE_NAME: '@adminium/adapter-postgres' })).toBeNull();
    expect(providerFromModule(null)).toBeNull();
  });

  it('registerAdapters registers postgres when the package is loadable, reports it missing otherwise', async () => {
    const registry = new AdapterRegistry<AdapterProvider>();
    // Never throws: a stub or not-yet-installed adapter package must not
    // crash boot (the whole point of the duck-typed composition boundary).
    const result = await registerAdapters(registry);
    if (result.registered.includes('postgres')) {
      expect(registry.has('postgres')).toBe(true);
    } else {
      expect(result.missing).toContain('@adminium/adapter-postgres');
    }
  });
});

describe('DSN crypto closures', () => {
  it('round-trips and produces enc:v1 tokens; keys are purpose-scoped', () => {
    const crypto = dsnCryptoFromSecret('unit-test-secret');
    const token = crypto.encrypt('postgres://ava:secret@h/db');
    expect(token.startsWith(ENC_TOKEN_PREFIX)).toBe(true);
    expect(token).not.toContain('secret');
    expect(crypto.decrypt(token)).toBe('postgres://ava:secret@h/db');
    const other = dsnCryptoFromSecret('another-secret');
    expect(() => other.decrypt(token)).toThrow();
  });
});
