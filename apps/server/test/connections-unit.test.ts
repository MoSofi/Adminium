/**
 * Offline unit tests for the connections layer: DSN parsing/masking, the §7
 * item-2 SSRF guard, same-database detection, the 01 §3.1 meta-placement
 * rule, adapter-module provider discovery, and the DSN crypto closures.
 */

import { describe, expect, it } from 'vitest';
import { AdapterRegistry, type AdapterProvider } from '@adminium/engine/adapter';

import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import {
  guardDsn,
  maskDsn,
  MetaPlacementError,
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
