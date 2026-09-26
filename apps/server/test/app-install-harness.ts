// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app install against a real database, for the suites that need one but
 * not the whole pipeline suite's machinery: a meta store, a connection to a
 * fresh database on the engine asked for, and the app routes signed in as the
 * app's owner. `install` stages a manifest and installs it.
 *
 * SQLite always; Postgres with TEST_POSTGRES_URL, MySQL with TEST_MYSQL_URL.
 */
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { sql } from 'kysely';
import { expect } from 'vitest';
import { AdapterRegistry, type AdapterProvider } from '@adminium/engine/adapter';
import { createSqliteMetaDb, firstRun, manifestsRepo, usersRepo, type MetaDb } from '@adminium/meta';

import { createInstalledApps } from '../src/apps/installed.js';
import { createAppSchemaTarget } from '../src/apps/schema-target.js';
import { createAppStore } from '../src/apps/store.js';
import { sha512Integrity } from '../src/add-ons/store.js';
import { runIntrospection } from '../src/connections/introspect.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { registerAdapters } from '../src/connections/register-adapters.js';
import { AppError, errorEnvelope } from '../src/errors.js';
import { appRoutes } from '../src/routes/apps/index.js';
import { packageTarball } from './app-bundle-helpers.js';
import { TEST_SECRET } from './helpers.js';

export type Dialect = 'sqlite' | 'postgres' | 'mysql';
export const POSTGRES_URL = process.env.TEST_POSTGRES_URL || undefined;
// `''` means absent: CI leaves this empty on a push, where mysql runs nightly.
export const MYSQL_URL = process.env.TEST_MYSQL_URL || undefined;

/** Every engine this machine can run, and whether it can. */
export const ENGINES: [Dialect, boolean][] = [
  ['sqlite', true],
  ['postgres', POSTGRES_URL !== undefined],
  ['mysql', MYSQL_URL !== undefined],
];

export interface InstallReply {
  statusCode: number;
  body: string;
  json: () => { pages: { warnings: { page: string; reason: string; message: string }[] } };
}

export interface Harness {
  meta: MetaDb;
  dsn: string;
  connectionId: string;
  /** Stage `manifest` and install it on the connection. */
  install: (manifest: Record<string, unknown>) => Promise<InstallReply>;
  /** Stage `manifest` only (an upload), for a test that then plans, installs or updates by hand. */
  stage: (manifest: Record<string, unknown>) => Promise<void>;
  /** A request to the app routes, signed in as the owner. */
  inject: (request: { method: 'GET' | 'POST'; url: string; payload?: Record<string, unknown> }) => Promise<InstallReply>;
  /** A second connection, to a fresh SQLite file of its own. */
  otherConnection: () => Promise<{ id: string; tables: () => Promise<string[]> }>;
  run: (statement: string) => Promise<void>;
  rows: (statement: string) => Promise<Record<string, unknown>[]>;
  close: () => Promise<void>;
}

/** A real database per engine, a meta store, and the app routes signed in as its owner. */
export async function installHarness(dialect: Dialect): Promise<Harness> {
  const dataDir = await mkdtemp(join(tmpdir(), 'app-junction-'));
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  const user = await usersRepo(meta).create({ email: 'owner@test', name: 'Owner' });
  const registry = new AdapterRegistry<AdapterProvider>();
  await registerAdapters(registry);
  const manager = new ConnectionManager({ meta, crypto: dsnCryptoFromSecret(TEST_SECRET), registry, metaDsn: null, blockLoopback: false });

  let dsn: string;
  let drop: () => Promise<void> = async () => undefined;
  const name = `adminium_junction_${randomBytes(4).toString('hex')}`;
  if (dialect === 'sqlite') {
    const file = join(dataDir, 'source.db');
    new BetterSqlite3(file).close();
    dsn = `sqlite:${file}`;
  } else if (dialect === 'postgres') {
    const { Client } = await import('pg');
    const admin = new Client({ connectionString: POSTGRES_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    await admin.end();
    const url = new URL(POSTGRES_URL as string);
    url.pathname = `/${name}`;
    dsn = url.toString();
    drop = async () => {
      const again = new Client({ connectionString: POSTGRES_URL });
      await again.connect();
      await again.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await again.end();
    };
  } else {
    const mysql = await import('mysql2/promise');
    const admin = await mysql.createConnection(MYSQL_URL as string);
    await admin.query(`CREATE DATABASE \`${name}\``);
    await admin.end();
    const url = new URL(MYSQL_URL as string);
    url.pathname = `/${name}`;
    dsn = url.toString();
    drop = async () => {
      const again = await mysql.createConnection(MYSQL_URL as string);
      await again.query(`DROP DATABASE IF EXISTS \`${name}\``);
      await again.end();
    };
  }
  const connection = await manager.connections.create({ name: 'Clinic', engine: dialect, introspectDsn: dsn, dataDsn: dsn });
  await runIntrospection({ manager, meta, connectionId: connection.id });

  const Fastify = (await import('fastify')).default;
  const { serializerCompiler, validatorCompiler } = await import('fastify-type-provider-zod');
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('rbac', { require: () => async () => {}, resolve: async () => ({ superAdmin: false }) } as never);
  app.decorate('requireAuth', (async () => {}) as never);
  // Refusals in the server's own envelope, details included.
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) return reply.status(error.statusCode).send(errorEnvelope(error.code, error.message, 'req_test', error.details));
    return reply.status(500).send(errorEnvelope('INTERNAL', String(error), 'req_test'));
  });
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (request) => {
    (request as { user?: unknown }).user = { id: user.id, email: 'owner@test' };
  });
  const store = createAppStore({ dataDir });
  const manifests = manifestsRepo(meta, { encrypt: (v) => v, decrypt: (v) => v });
  await app.register(
    appRoutes({
      meta,
      store,
      installed: createInstalledApps({
        store,
        list: async () => (await manifests.list('app')).map((m) => ({ key: m.row.manifestKey, version: m.row.version, status: m.row.status })),
      }),
      credentialCrypto: { encrypt: (v) => v, decrypt: (v) => v },
      directoryKeys: () => [],
      serverVersion: '0.4.0',
      schemaTarget: createAppSchemaTarget({ meta, manager, crypto: dsnCryptoFromSecret(TEST_SECRET) }),
    }),
  );
  await app.ready();
  const handle = await manager.data(connection.id);
  const stage = async (manifest: Record<string, unknown>) => {
    const tarball = packageTarball({ 'manifest.json': JSON.stringify(manifest), 'staff/index.html': '<!doctype html><html><body></body></html>' });
    const staged = await app.inject({
      method: 'POST',
      url: `/apps/upload?expectedSha512=${encodeURIComponent(sha512Integrity(tarball))}`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from(tarball),
    });
    expect(staged.statusCode, staged.body).toBe(200);
  };
  return {
    meta,
    dsn,
    connectionId: connection.id,
    install: async (manifest) => {
      await stage(manifest);
      return app.inject({ method: 'POST', url: '/apps/install', payload: { key: manifest['key'], version: manifest['version'], connectionId: connection.id } });
    },
    stage,
    inject: async (request) => app.inject(request),
    otherConnection: async () => {
      const file = join(dataDir, `other-${randomBytes(3).toString('hex')}.db`);
      new BetterSqlite3(file).close();
      const other = await manager.connections.create({ name: 'Second', engine: 'sqlite', introspectDsn: `sqlite:${file}`, dataDsn: `sqlite:${file}` });
      await runIntrospection({ manager, meta, connectionId: other.id });
      return {
        id: other.id,
        tables: async () => {
          const reader = new BetterSqlite3(file, { readonly: true });
          try {
            return (reader.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all() as { name: string }[]).map((r) => r.name);
          } finally {
            reader.close();
          }
        },
      };
    },
    run: async (statement) => {
      await sql.raw(statement).execute(handle.db);
    },
    rows: async (statement) => (await sql.raw<Record<string, unknown>>(statement).execute(handle.db)).rows,
    close: async () => {
      await app.close();
      await manager.disposeAll().catch(() => undefined);
      await drop();
      await meta.db.destroy();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}
