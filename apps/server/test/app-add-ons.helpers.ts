// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Apps that need add-ons, against a real database per engine: a meta store,
 * one connection, the app AND add-on routes over the same stores, and the
 * real RBAC plugin (the owner is Super Admin; `as(user)` acts as another).
 *
 * `stageAddOn` puts an add-on package in the add-on store the way a verified
 * download or the boot seed would, and `bundled: true` also lays its tarball's
 * name in the bundled directory — the only witness of "comes with Adminium".
 *
 * `documents` also serves the documents routes over an add-on runtime the test
 * hands in, so an app's own screen can ask for a document to be drawn.
 *
 * SQLite always; Postgres with TEST_POSTGRES_URL, MySQL with TEST_MYSQL_URL.
 */
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { sql } from 'kysely';
import { AdapterRegistry, type AdapterProvider } from '@adminium/engine/adapter';
import { createSqliteMetaDb, firstRun, manifestsRepo, rolesRepo, usersRepo, type MetaDb, type User } from '@adminium/meta';

import type { CatalogClient } from '../src/add-ons/catalog.js';
import type { AddOnRuntimeState } from '../src/add-ons/runtime.js';
import { createAddOnSchemaTarget } from '../src/add-ons/schema-target.js';
import { createAddOnStore, sha512Integrity, type AddOnStore } from '../src/add-ons/store.js';
import { createInstalledApps } from '../src/apps/installed.js';
import { createAppSchemaTarget, type AppSchemaTarget } from '../src/apps/schema-target.js';
import { createAppStore } from '../src/apps/store.js';
import { runIntrospection } from '../src/connections/introspect.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { registerAdapters } from '../src/connections/register-adapters.js';
import { AppError, errorEnvelope, UnauthorizedError } from '../src/errors.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { addOnRoutes } from '../src/routes/add-ons/index.js';
import { appRoutes } from '../src/routes/apps/index.js';
import { documentRoutes } from '../src/routes/documents/index.js';
import { createDocumentPipeline } from '../src/documents/compose.js';
import type { RenderDeps } from '../src/documents/render.js';
import { packageTarball } from './app-bundle-helpers.js';
import { memoryStorage } from './memory-storage.helpers.js';
import { TEST_SECRET } from './helpers.js';

export type Dialect = 'sqlite' | 'postgres' | 'mysql';
const POSTGRES_URL = process.env.TEST_POSTGRES_URL || undefined;
const MYSQL_URL = process.env.TEST_MYSQL_URL || undefined;

/** Every engine this machine can run, and whether it can. */
export const ENGINES: [Dialect, boolean][] = [
  ['sqlite', true],
  ['postgres', POSTGRES_URL !== undefined],
  ['mysql', MYSQL_URL !== undefined],
];

export const CRYPTO = { encrypt: (v: string) => v, decrypt: (v: string) => v };

/** A valid add-on manifest; override what a test is about. */
export function addOnManifest(key: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  const { addOn, ...rest } = over as { addOn?: Record<string, unknown> };
  return {
    kind: 'add-on',
    manifestVersion: 1,
    key,
    name: `${key[0]!.toUpperCase()}${key.slice(1)}`,
    version: '1.0.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: `addon.${key}.line`, fallback: 'x' },
    categories: ['data'],
    compatibility: { minAdminiumVersion: '0.2.6', requires: [] },
    ...rest,
    addOn: {
      attaches: [{ app: '*' }],
      slots: [{ slot: 'settings.add-on.panel', client: 'dist/client.js', order: 10 }],
      connect: { kind: 'none' },
      ...addOn,
    },
  };
}

/** A valid app manifest with one table of its own; override what a test is about. */
export function appManifest(key: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key,
    name: 'Studio',
    version: '0.2.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: `mft.${key}.desc`, fallback: 'A studio.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.1.0', engines: ['postgres', 'mysql', 'sqlite'] },
    requiredSchema: {
      tables: [
        {
          ref: 'jobs',
          columns: [
            { ref: 'id', type: 'int', role: 'pk' },
            { ref: 'title', type: 'text', nullable: true },
          ],
        },
      ],
    },
    pages: [
      {
        ref: `${key}-home`,
        template: 'page-dashboard',
        title: { key: `mft.${key}.page.home`, fallback: 'Home' },
        nav: { group: 'manifest:sample', icon: 'layout-dashboard', order: 1 },
      },
    ],
    frontends: [
      { side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } },
      { side: 'customer', kind: 'spa', entry: 'index.html', routes: { book: '/' } },
    ],
    ...over,
  };
}

/** A reply body, read by the assertions. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the assertions reach into it freely
type Body = any;

export interface Harness {
  meta: MetaDb;
  owner: User;
  connectionId: string;
  addOnStore: AddOnStore;
  bundledDir: string;
  /** How many times a route asked for the add-on runtime to be rebuilt. */
  rebuilds: () => number;
  /** Make the app's next table step fail once (a disk that filled up). */
  failNextTables: () => void;
  /** Turn the online catalogue on, over a cached feed. */
  catalog: { on: boolean };
  stageAddOn: (manifest: Record<string, unknown>, opts?: { bundled?: boolean }) => Promise<void>;
  stageApp: (manifest: Record<string, unknown>) => Promise<void>;
  inject: (req: { method: string; url: string; payload?: unknown; as?: User | null }) => Promise<{ statusCode: number; body: string; json: () => Body }>;
  /** Stage an app and ask for its plan on the harness's connection. */
  plan: (manifest: Record<string, unknown>) => Promise<{ statusCode: number; json: () => Body; body: string }>;
  /** Install a staged app on the harness's connection. */
  install: (key: string, version: string, extra?: Record<string, unknown>) => Promise<{ statusCode: number; json: () => Body; body: string }>;
  tableNames: () => Promise<string[]>;
  rows: (statement: string) => Promise<Record<string, unknown>[]>;
  /** The document pipeline the routes draw with, when `documents` was asked for. */
  pipeline: RenderDeps | null;
  close: () => Promise<void>;
}

export interface HarnessOptions {
  /** Serve the documents routes too, drawing with this add-on runtime. */
  documents?: { runtime: () => AddOnRuntimeState | null } | undefined;
}

export async function addOnHarness(dialect: Dialect, opts: HarnessOptions = {}): Promise<Harness> {
  const dataDir = await mkdtemp(join(tmpdir(), 'app-add-ons-'));
  const bundledDir = await mkdtemp(join(tmpdir(), 'add-ons-bundle-'));
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  const owner = await usersRepo(meta).create({ email: 'owner@test', name: 'Owner' });
  const superAdmin = await rolesRepo(meta).findBySlug('super-admin');
  await rolesRepo(meta).assignToUser(owner.id, superAdmin!.id);
  const registry = new AdapterRegistry<AdapterProvider>();
  await registerAdapters(registry);
  const manager = new ConnectionManager({ meta, crypto: dsnCryptoFromSecret(TEST_SECRET), registry, metaDsn: null, blockLoopback: false });

  let dsn: string;
  let drop: () => Promise<void> = async () => undefined;
  const name = `adminium_addons_${randomBytes(4).toString('hex')}`;
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
  const connection = await manager.connections.create({ name: 'Studio', engine: dialect, introspectDsn: dsn, dataDsn: dsn });
  await runIntrospection({ manager, meta, connectionId: connection.id });

  const Fastify = (await import('fastify')).default;
  const { serializerCompiler, validatorCompiler } = await import('fastify-type-provider-zod');
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send(errorEnvelope(error.code, error.message, 'req_test', error.details));
    }
    return reply.status(500).send(errorEnvelope('INTERNAL', String(error), 'req_test'));
  });
  app.decorate('requireAuth', (async (request: { user?: unknown }) => {
    if (request.user === null || request.user === undefined) throw new UnauthorizedError('UNAUTHENTICATED');
  }) as never);
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (request) => {
    const id = request.headers['x-test-user-id'];
    if (id === 'anonymous') return;
    const user = typeof id === 'string' ? await usersRepo(meta).findById(id) : owner;
    if (user !== null) (request as { user?: unknown }).user = { id: user.id, name: user.name, email: user.email };
  });
  await app.register(rbacPlugin, { meta });

  let rebuilds = 0;
  let failTables = false;
  const catalogState = { on: false };
  const addOnStore = createAddOnStore({ dataDir });
  const appStore = createAppStore({ dataDir });
  const installer = {
    meta,
    store: addOnStore,
    credentialCrypto: CRYPTO,
    schemaTarget: createAddOnSchemaTarget({ meta, manager, credentialCrypto: CRYPTO }),
    rebuildRuntime: async () => {
      rebuilds += 1;
    },
  };
  const catalog = {
    isEnabled: async () => catalogState.on,
    networkFeaturesAllowed: () => true,
  } as unknown as CatalogClient;
  const real: AppSchemaTarget = createAppSchemaTarget({ meta, manager, crypto: dsnCryptoFromSecret(TEST_SECRET) });
  const schemaTarget: AppSchemaTarget = {
    ...real,
    apply: async (...args: Parameters<AppSchemaTarget['apply']>) => {
      if (failTables) {
        failTables = false;
        throw new Error('The disk is full.');
      }
      return real.apply(...args);
    },
  };
  const manifests = manifestsRepo(meta, CRYPTO);
  const runtime = opts.documents?.runtime;
  await app.register(
    addOnRoutes({ ...installer, serverVersion: '0.4.0', catalog, ...(runtime === undefined ? {} : { runtime }) }),
  );
  await app.register(
    appRoutes({
      meta,
      store: appStore,
      installed: createInstalledApps({
        store: appStore,
        list: async () => (await manifests.list('app')).map((m) => ({ key: m.row.manifestKey, version: m.row.version, status: m.row.status })),
      }),
      credentialCrypto: CRYPTO,
      directoryKeys: () => [],
      serverVersion: '0.4.0',
      schemaTarget,
      addOns: { installer, catalog, bundledDir },
      ...(runtime === undefined ? {} : { addOnRuntime: runtime }),
    }),
  );
  let pipeline: RenderDeps | null = null;
  if (runtime !== undefined) {
    // Imported here: that module imports this one.
    const storage = memoryStorage();
    pipeline = createDocumentPipeline({ meta, manager, storage, runtime });
    await app.register(documentRoutes({ meta, storage, runtime, enqueue: () => Promise.resolve({ id: 'job_1' }), pipeline }));
  }
  await app.ready();
  const handle = await manager.data(connection.id);

  const inject: Harness['inject'] = async ({ method, url, payload, as }) =>
    app.inject({
      method: method as 'GET',
      url,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
      headers: as === undefined ? {} : { 'x-test-user-id': as === null ? 'anonymous' : as.id },
    });

  const stageApp: Harness['stageApp'] = async (manifest) => {
    const tarball = packageTarball({
      'manifest.json': JSON.stringify(manifest),
      'staff/index.html': '<!doctype html><html><body></body></html>',
      'customer/index.html': '<!doctype html><html><body></body></html>',
    });
    await appStore.stage({
      key: String(manifest['key']),
      version: String(manifest['version']),
      tarball,
      expectedIntegrity: sha512Integrity(tarball),
    });
  };

  return {
    meta,
    owner,
    connectionId: connection.id,
    addOnStore,
    bundledDir,
    rebuilds: () => rebuilds,
    failNextTables: () => {
      failTables = true;
    },
    catalog: catalogState,
    stageAddOn: async (manifest, opts = {}) => {
      const key = String(manifest['key']);
      const version = String(manifest['version']);
      const tarball = packageTarball({
        'manifest.json': JSON.stringify(manifest),
        'package.json': JSON.stringify({ name: `@adminiumjs/add-on-${key}` }),
        'dist/client.js': 'export const register = () => {};',
      });
      await addOnStore.stage({ key, version, tarball, expectedIntegrity: sha512Integrity(tarball) });
      if (opts.bundled === true) {
        await writeFile(join(bundledDir, `${key}-${version}.tgz`), Buffer.from(tarball));
        await writeFile(join(bundledDir, `${key}-${version}.tgz.integrity`), sha512Integrity(tarball));
      }
    },
    stageApp,
    inject,
    plan: async (manifest) => {
      await stageApp(manifest);
      return inject({
        method: 'POST',
        url: '/apps/plan',
        payload: { key: manifest['key'], version: manifest['version'], connectionId: connection.id },
      });
    },
    install: async (key, version, extra = {}) =>
      inject({ method: 'POST', url: '/apps/install', payload: { key, version, connectionId: connection.id, ...extra } }),
    tableNames: async () => {
      const adapter = await manager.introspectAdapter(connection.id);
      try {
        const model = await adapter.introspect({ collectRowEstimates: false, collectActivityStats: false });
        return model.tables.map((table) => table.name).sort();
      } finally {
        await adapter.close().catch(() => undefined);
      }
    },
    rows: async (statement) => (await sql.raw<Record<string, unknown>>(statement).execute(handle.db)).rows,
    pipeline,
    close: async () => {
      await app.close();
      await manager.disposeAll().catch(() => undefined);
      await drop();
      await meta.db.destroy();
      await rm(dataDir, { recursive: true, force: true });
      await rm(bundledDir, { recursive: true, force: true });
    },
  };
}
