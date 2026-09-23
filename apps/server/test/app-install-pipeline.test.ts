// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app install, end to end, against a REAL database on every engine: the
 * live plan, the operator's answers, and the apply — renames through the schema
 * editor, prefixed creates with prefixed foreign keys, and the safe edits a
 * reused table needs.
 *
 * Nothing here is faked below the HTTP route: the connection manager, the
 * introspection, the schema editor's plan and apply, and the DDL all run.
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { sql } from 'kysely';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { desiredTableSchema, parseDatabaseModel } from '@adminium/engine';
import { AdapterRegistry, type AdapterProvider } from '@adminium/engine/adapter';
import {
  appTablesRepo,
  connectionTenantConfig,
  createSqliteMetaDb,
  documentSequencesRepo,
  snapshotsRepo,
  firstRun,
  manifestsRepo,
  optionListsRepo,
  overridesRepo,
  pagesRepo,
  permissionsRepo,
  publicEndpointsRepo,
  publicKeysRepo,
  rolesRepo,
  usersRepo,
  type MetaDb,
} from '@adminium/meta';

import { createInstalledApps } from '../src/apps/installed.js';
import { resolveForRoles } from '../src/rbac/resolver.js';
import { createAppSchemaTarget } from '../src/apps/schema-target.js';
import { createAppStore } from '../src/apps/store.js';
import { createSampleDataService, findSampleApp, normaliseValue, type SampleDataDeps } from '../src/apps/sample-data.js';
import type { FileStore } from '../src/files/store.js';
import { sha512Integrity } from '../src/add-ons/store.js';
import { runIntrospection } from '../src/connections/introspect.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { registerAdapters } from '../src/connections/register-adapters.js';
import { applyOverrides } from '../src/connections/effective-schema.js';
import { SnapshotView } from '../src/crud/identifiers.js';
import { resolveLookups } from '../src/crud/lookups.js';
import { venueClock } from '../src/crud/capacity-guard.js';
import { createWriteService, GuardedBatchError, type WriteTarget } from '../src/crud/write-service.js';
import { normalizeWriteValue } from '../src/crud/write-values.js';
import { wallTimeToInstant } from '../src/crud/venue-time.js';
import { writeStores } from '../src/crud/write-stores.js';
import { columnFactsFor } from '../src/routes/pages/column-facts.js';
import { compileWidgetQuery } from '../src/widget-data/compiler.js';
import { shapeRows } from '../src/widget-data/shapers.js';
import { queryDescriptorSchema } from '@adminium/engine/config';
import { POS_OVERVIEW_LAYOUT, POS_OVERVIEW_TABLES } from './fixtures/pos-overview.js';
import { createEndpointService, EndpointSaveRefused } from '../src/public-api/endpoint-service.js';
import { endpointIssues, parseDefinition } from '../src/public-api/endpoint.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { appRoutes } from '../src/routes/apps/index.js';
import { packageTarball } from './app-bundle-helpers.js';
import { TEST_SECRET } from './helpers.js';

/**
 * The code generator's dice, loaded on request: a queued number is the next
 * `randomInt`, so a test can make a code collide. Empty, it is the real one.
 */
const forcedInts = vi.hoisted(() => [] as number[]);
vi.mock('node:crypto', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:crypto')>();
  return {
    ...real,
    randomInt: ((...args: Parameters<typeof real.randomInt>) =>
      forcedInts.length > 0 ? forcedInts.shift()! : (real.randomInt as (...a: unknown[]) => unknown)(...args)) as typeof real.randomInt,
  };
});

type Dialect = 'sqlite' | 'postgres' | 'mysql';
const POSTGRES_URL = process.env.TEST_POSTGRES_URL;
const MYSQL_URL = process.env.TEST_MYSQL_URL || undefined;

/** Keys the routes told the public resolver to forget. */
const INVALIDATED_KEYS: string[] = [];

const TABLES = [
  {
    ref: 'menu_items',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'name', type: 'text', maxLength: 80 },
      { ref: 'price', type: 'money', default: 0 },
    ],
  },
  {
    ref: 'payments',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'amount', type: 'money' },
      { ref: 'tip', type: 'money', nullable: true },
      { ref: 'method', type: 'text', maxLength: 16 },
    ],
  },
  {
    ref: 'shifts',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'opened_at', type: 'timestamptz', default: 'now' },
    ],
  },
  {
    ref: 'lines',
    columns: [
      { ref: 'id', type: 'bigint', role: 'pk' },
      { ref: 'item_id', type: 'fk', references: 'menu_items' },
    ],
  },
];

const MANIFEST = {
  kind: 'app',
  manifestVersion: 1,
  key: 'pos',
  name: 'Point of Sale',
  version: '1.0.0',
  publisher: { id: 'adminium', name: 'Adminium' },
  license: 'AGPL-3.0-only',
  description: { key: 'd', fallback: 'A till.' },
  categories: ['hospitality'],
  compatibility: { minAdminiumVersion: '0.1.0' },
  requiredSchema: { prefixed: true, tables: TABLES },
  pages: [
    {
      ref: 'pos-menu',
      template: 'page-crud',
      title: { key: 't', fallback: 'Menu' },
      nav: { group: 'library', icon: 'list', order: 1 },
      bindings: { rows: 'menu_items' },
    },
  ],
  frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
};

interface Harness {
  app: Awaited<ReturnType<typeof buildApp>>;
  meta: MetaDb;
  manager: ConnectionManager;
  connectionId: string;
  run: (statement: string) => Promise<void>;
  rows: (statement: string) => Promise<Record<string, unknown>[]>;
  dataDir: string;
  columns: (table: string) => Promise<Record<string, { type: string; width: number | null }>>;
  close: () => Promise<void>;
}

let open: Harness | null = null;
afterEach(async () => {
  await open?.close();
  open = null;
});

interface AppOpts {
  superAdmin?: boolean;
  /** Whether the signed-in user may manage API keys; unset, the request has no `can` at all. */
  canManageKeys?: boolean;
}

async function buildApp(meta: MetaDb, manager: ConnectionManager, dataDir: string, userId: string, opts: AppOpts = {}) {
  const superAdmin = opts.superAdmin ?? false;
  const Fastify = (await import('fastify')).default;
  const { serializerCompiler, validatorCompiler } = await import('fastify-type-provider-zod');
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('rbac', { require: () => async () => {}, resolve: async () => ({ superAdmin }) } as never);
  app.decorate('requireAuth', (async () => {}) as never);
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (request) => {
    (request as { user?: unknown }).user = { id: userId, email: 'owner@test' };
    if (opts.canManageKeys !== undefined) {
      (request as { can?: unknown }).can = async (permission: string) =>
        permission === 'system:api-keys:manage' ? opts.canManageKeys : true;
    }
  });
  const views = createPublicViews(meta);
  const store = createAppStore({ dataDir });
  const manifests = manifestsRepo(meta, { encrypt: (v) => v, decrypt: (v) => v });
  const installed = createInstalledApps({
    store,
    list: async () =>
      (await manifests.list('app')).map((m) => ({ key: m.row.manifestKey, version: m.row.version, status: m.row.status })),
  });
  await app.register(
    appRoutes({
      meta,
      store,
      installed,
      credentialCrypto: { encrypt: (v) => v, decrypt: (v) => v },
      directoryKeys: () => [],
      serverVersion: '0.4.0',
      schemaTarget: createAppSchemaTarget({ meta, manager, crypto: dsnCryptoFromSecret(TEST_SECRET) }),
      sampleData: sampleDeps(meta, manager, store),
      publicAccess: {
        service: createEndpointService({ meta, viewFor: views.viewFor, tenantConfigOf: async (id) => (await connectionTenantConfig(meta, id)) ?? undefined }),
        viewFor: views.viewFor,
        crypto: dsnCryptoFromSecret(TEST_SECRET),
        origins: ['self'],
        invalidateKey: (keyId) => INVALIDATED_KEYS.push(keyId),
      },
    }),
  );
  await app.ready();
  return app;
}

/** The Files library, as far as the sample service uses it: bytes in, a location out. */
const memoryFiles = {
  write: async (input: { id: string; bytes: Buffer | string }) => ({
    storageKey: input.id,
    sizeBytes: Buffer.byteLength(input.bytes),
    sha256: createHash('sha256').update(input.bytes).digest('hex'),
    destinationId: null,
    storage: 'memory',
  }),
} as unknown as FileStore;

function sampleDeps(meta: MetaDb, manager: ConnectionManager, store: ReturnType<typeof createAppStore>): SampleDataDeps {
  return { meta, manager, store, files: memoryFiles };
}

async function harness(dialect: Dialect, opts: AppOpts = {}): Promise<Harness> {
  const dataDir = await mkdtemp(join(tmpdir(), 'app-pipeline-'));
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  const user = await usersRepo(meta).create({ email: 'owner@test', name: 'Owner' });
  const registry = new AdapterRegistry<AdapterProvider>();
  await registerAdapters(registry);
  const manager = new ConnectionManager({
    meta,
    crypto: dsnCryptoFromSecret(TEST_SECRET),
    registry,
    metaDsn: null,
    blockLoopback: false,
  });

  let dsn: string;
  let drop: () => Promise<void> = async () => undefined;
  const name = `adminium_pipeline_${randomBytes(4).toString('hex')}`;
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
  const connection = await manager.connections.create({ name: 'Cafe', engine: dialect, introspectDsn: dsn, dataDsn: dsn });
  await runIntrospection({ manager, meta, connectionId: connection.id });

  const app = await buildApp(meta, manager, dataDir, user.id, opts);
  const handle = await manager.data(connection.id);
  const h: Harness = {
    app,
    meta,
    manager,
    connectionId: connection.id,
    run: async (statement) => {
      await sql.raw(statement).execute(handle.db);
    },
    rows: async (statement) => (await sql.raw<Record<string, unknown>>(statement).execute(handle.db)).rows,
    dataDir,
    columns: async (table) => {
      const adapter = await manager.introspectAdapter(connection.id);
      try {
        const model = await adapter.introspect({ tableFilter: (t) => t.name === table, collectRowEstimates: false, collectActivityStats: false });
        const found = model.tables.find((t) => t.name === table);
        return Object.fromEntries((found?.columns ?? []).map((c) => [c.name, { type: c.logicalType, width: c.maxLength }]));
      } finally {
        await adapter.close();
      }
    },
    close: async () => {
      await app.close();
      await manager.disposeAll().catch(() => undefined);
      await drop();
      await meta.db.destroy();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
  return h;
}

async function stage(h: Harness): Promise<void> {
  const tarball = packageTarball({
    'manifest.json': JSON.stringify(MANIFEST),
    'staff/index.html': '<!doctype html><html><body data-app="pos"></body></html>',
  });
  const res = await h.app.inject({
    method: 'POST',
    url: `/apps/upload?expectedSha512=${encodeURIComponent(sha512Integrity(tarball))}`,
    headers: { 'content-type': 'application/octet-stream' },
    payload: Buffer.from(tarball),
  });
  expect(res.statusCode, res.body).toBe(200);
}

/** Stages a different manifest: another version, or another shape. */
async function stageManifest(
  h: Harness,
  manifest: Record<string, unknown>,
  files: Record<string, string> = {},
): Promise<void> {
  const tarball = packageTarball({
    'manifest.json': JSON.stringify(manifest),
    'staff/index.html': '<!doctype html><html><body data-app="pos"></body></html>',
    ...files,
  });
  const res = await h.app.inject({
    method: 'POST',
    url: `/apps/upload?expectedSha512=${encodeURIComponent(sha512Integrity(tarball))}`,
    headers: { 'content-type': 'application/octet-stream' },
    payload: Buffer.from(tarball),
  });
  expect(res.statusCode, res.body).toBe(200);
}

const post = (h: Harness, url: string, extra: Record<string, unknown> = {}) =>
  h.app.inject({ method: 'POST', url, payload: { key: 'pos', version: '1.0.0', connectionId: h.connectionId, ...extra } });

const legs: [Dialect, boolean][] = [
  ['sqlite', true],
  ['postgres', POSTGRES_URL !== undefined],
  ['mysql', MYSQL_URL !== undefined],
];

for (const [dialect, available] of legs) {
  describe.skipIf(!available)(`an app install on ${dialect}`, () => {
    it('creates every table under the prefix, links them by their real names, and records them', async () => {
      const h = (open = await harness(dialect));
      await stage(h);
      const res = await post(h, '/apps/install');
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().schema.created).toEqual(['pos_menu_items', 'pos_payments', 'pos_shifts', 'pos_lines']);

      // The key numbers itself and the foreign key points at the prefixed table.
      await h.run(`INSERT INTO pos_menu_items (name) VALUES ('Latte')`);
      await h.run(`INSERT INTO pos_lines (item_id) VALUES (1)`);
      await expect(h.run(`INSERT INTO pos_lines (item_id) VALUES (999)`)).rejects.toThrow();

      // The page binds the short name and composes from the real table.
      expect(res.json().pages.warnings).toEqual([]);
      const page = await pagesRepo(h.meta).findBySlug(h.connectionId, 'pos-menu');
      expect((page?.config as { source: { table: string } }).source.table).toMatch(/(^|\.)pos_menu_items$/);

      const records = await appTablesRepo(h.meta).forInstall(h.connectionId, 'pos');
      expect(records.map((r) => [r.ref, r.tableName, r.state, r.owned])).toEqual([
        ['menu_items', 'pos_menu_items', 'created', true],
        ['payments', 'pos_payments', 'created', true],
        ['shifts', 'pos_shifts', 'created', true],
        ['lines', 'pos_lines', 'created', true],
      ]);
    }, 60_000);

    it('asks about a hand-made table, then adapts it with only safe edits', async () => {
      const h = (open = await harness(dialect));
      // Made by hand: no tip column, a method column too narrow, rows in it.
      await h.run(`CREATE TABLE pos_payments (id integer PRIMARY KEY, amount decimal(19,4) NOT NULL, method varchar(8) NOT NULL)`);
      await h.run(`INSERT INTO pos_payments (id, amount, method) VALUES (1, 4.5, 'cash')`);
      await stage(h);

      const asked = await post(h, '/apps/plan');
      const payments = asked.json().plan.tables.find((t: { ref: string }) => t.ref === 'payments');
      expect(payments).toMatchObject({ class: 'taken', action: 'undecided' });
      // The declared columns ride along, so the check's count and its list agree.
      expect(payments.columns).toEqual([
        { ref: 'id', type: 'int' },
        { ref: 'amount', type: 'money' },
        { ref: 'tip', type: 'money' },
        { ref: 'method', type: 'text' },
      ]);
      expect((await post(h, '/apps/install')).statusCode).toBe(422);

      const choices = { payments: { action: 'reuse' } };
      const planned = await post(h, '/apps/plan', { choices });
      const edits = planned.json().plan.tables.find((t: { ref: string }) => t.ref === 'payments').edits;
      expect(edits).toContainEqual({ kind: 'add-column', column: 'tip' });
      expect(edits).toContainEqual({ kind: 'widen', column: 'method', from: 'varchar(8)', to: 'varchar(16)' });

      const res = await post(h, '/apps/install', { choices, planChecksum: planned.json().plan.checksum });
      expect(res.statusCode, res.body).toBe(200);
      const columns = await h.columns('pos_payments');
      expect(columns['tip']).toBeDefined();
      if (dialect !== 'sqlite') expect(columns['method']?.width).toBe(16);
      // The row survived, and a new one needs no id any more.
      await h.run(`INSERT INTO pos_payments (amount, method) VALUES (2, 'card')`);
      const [record] = (await appTablesRepo(h.meta).forInstall(h.connectionId, 'pos')).filter((r) => r.ref === 'payments');
      expect(record).toMatchObject({ state: 'adopted', owned: false });
    }, 60_000);

    it('renames a table it cannot use out of the way, and creates its own', async () => {
      const h = (open = await harness(dialect));
      // Another system's table: it requires a column the app never fills.
      await h.run(`CREATE TABLE pos_shifts (id integer PRIMARY KEY, location_id integer NOT NULL)`);
      await h.run(`INSERT INTO pos_shifts (id, location_id) VALUES (1, 7)`);
      await stage(h);

      const plan = (await post(h, '/apps/plan')).json().plan;
      const shifts = plan.tables.find((t: { ref: string }) => t.ref === 'shifts');
      expect(shifts.offers).toEqual(['rename-existing', 'alt-prefix']);
      expect(shifts.reuseRefusal).toContain('"location_id"');

      const res = await post(h, '/apps/install', { choices: { shifts: { action: 'rename-existing', to: 'shifts_2019' } } });
      expect(res.statusCode, res.body).toBe(200);
      expect(Object.keys(await h.columns('shifts_2019'))).toContain('location_id');
      expect(Object.keys(await h.columns('pos_shifts'))).toEqual(['id', 'opened_at']);
      // The app's record names the table it made, not the one it moved aside:
      // the rename's repair must not carry the app's own record with it.
      const records = await appTablesRepo(h.meta).forInstall(h.connectionId, 'pos');
      expect(records.find((r) => r.ref === 'shifts')).toMatchObject({ tableName: 'pos_shifts', state: 'created', owned: true });
      expect(records.some((r) => r.tableName === 'shifts_2019')).toBe(false);
    }, 60_000);

    it('gives the whole app a different prefix', async () => {
      const h = (open = await harness(dialect));
      await h.run(`CREATE TABLE pos_menu_items (id integer PRIMARY KEY, sku varchar(20) NOT NULL)`);
      await stage(h);
      const res = await post(h, '/apps/install', { altPrefix: 'pos2_' });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().schema.created).toEqual(['pos2_menu_items', 'pos2_payments', 'pos2_shifts', 'pos2_lines']);
      await h.run(`INSERT INTO pos2_menu_items (name) VALUES ('Mocha')`);
      await h.run(`INSERT INTO pos2_lines (item_id) VALUES (1)`);
    }, 60_000);

    it('adds the link columns an update needs, with their foreign keys, to a table that has rows', async () => {
      const h = (open = await harness(dialect));
      await stage(h);
      expect((await post(h, '/apps/install')).statusCode).toBe(200);
      await h.run(`INSERT INTO pos_shifts (opened_at) VALUES (CURRENT_TIMESTAMP)`);
      await h.run(`INSERT INTO pos_payments (amount, method) VALUES (4.5, 'cash')`);
      // 1.1.0: payments links to shifts (there already) and to customers (new in 1.1.0).
      const next = {
        ...MANIFEST,
        version: '1.1.0',
        requiredSchema: {
          prefixed: true,
          tables: [
            ...TABLES.map((t) =>
              t.ref === 'payments'
                ? {
                    ...t,
                    columns: [
                      ...t.columns,
                      { ref: 'shift_id', type: 'fk', references: 'shifts', nullable: true },
                      { ref: 'customer_id', type: 'fk', references: 'customers', nullable: true },
                    ],
                  }
                : t,
            ),
            { ref: 'customers', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'name', type: 'text', maxLength: 80 }] },
          ],
        },
      };
      await stageManifest(h, next);
      const planned = (await post(h, '/apps/plan', { version: '1.1.0' })).json().plan;
      expect(planned.problems).toEqual([]);
      expect(planned.tables.find((t: { ref: string }) => t.ref === 'payments').edits).toEqual([
        { kind: 'add-column', column: 'shift_id' },
        { kind: 'add-column', column: 'customer_id' },
      ]);
      const res = await h.app.inject({ method: 'POST', url: '/apps/pos/update', payload: { planChecksum: planned.checksum } });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().app.schema.created).toEqual(['pos_customers']);

      // The row that was there is unlinked; a link must point at a real row.
      expect(await h.rows('SELECT shift_id, customer_id FROM pos_payments')).toEqual([{ shift_id: null, customer_id: null }]);
      await h.run(`INSERT INTO pos_customers (name) VALUES ('Dana')`);
      await h.run(`INSERT INTO pos_payments (amount, method, shift_id, customer_id) VALUES (3, 'card', 1, 1)`);
      await expect(h.run(`INSERT INTO pos_payments (amount, method, customer_id) VALUES (3, 'card', 999)`)).rejects.toThrow();
      await expect(h.run(`INSERT INTO pos_payments (amount, method, shift_id) VALUES (3, 'card', 999)`)).rejects.toThrow();
      const [row] = (await h.app.inject({ method: 'GET', url: '/apps' })).json().apps;
      expect(row.version).toBe('1.1.0');
    }, 90_000);

    it('grows a choice column on update and keeps refusing what is not on it', async () => {
      const h = (open = await harness(dialect));
      const withMethods = (values: string[], version: string) => ({
        ...MANIFEST,
        version,
        requiredSchema: {
          prefixed: true,
          tables: TABLES.map((t) =>
            t.ref === 'payments'
              ? { ...t, columns: t.columns.map((c) => (c.ref === 'method' ? { ref: 'method', type: 'enum', enum: values } : c)) }
              : t,
          ),
        },
      });
      await stageManifest(h, withMethods(['cash', 'card', 'walk_in'], '1.0.0'));
      expect((await post(h, '/apps/install')).statusCode).toBe(200);
      await stageManifest(h, withMethods(['cash', 'card', 'walk_in', 'gift_card'], '1.1.0'));
      const planned = (await post(h, '/apps/plan', { version: '1.1.0' })).json().plan;
      // Only the value that is new — an underscore in one already there is not a change.
      expect(planned.tables.find((t: { ref: string }) => t.ref === 'payments').edits).toEqual([
        { kind: 'enum-values', column: 'method', values: ['gift_card'] },
      ]);
      const res = await h.app.inject({ method: 'POST', url: '/apps/pos/update', payload: { planChecksum: planned.checksum } });
      expect(res.statusCode, res.body).toBe(200);
      await h.run(`INSERT INTO pos_payments (amount, method) VALUES (5, 'gift_card')`);
      await h.run(`INSERT INTO pos_payments (amount, method) VALUES (5, 'walk_in')`);
      // The list grew; it did not go away.
      await expect(h.run(`INSERT INTO pos_payments (amount, method) VALUES (5, 'bitcoin')`)).rejects.toThrow();
    }, 90_000);

    it('adds a choice column on update and still keeps its values on every write', async () => {
      const h = (open = await harness(dialect));
      await stage(h);
      expect((await post(h, '/apps/install')).statusCode).toBe(200);
      const next = {
        ...MANIFEST,
        version: '1.1.0',
        requiredSchema: {
          prefixed: true,
          tables: TABLES.map((t) =>
            t.ref === 'payments' ? { ...t, columns: [...t.columns, { ref: 'stage', type: 'enum', enum: ['queued', 'ready'], nullable: true }] } : t,
          ),
        },
      };
      await stageManifest(h, next);
      const updated = await h.app.inject({ method: 'POST', url: '/apps/pos/update' });
      expect(updated.statusCode, updated.body).toBe(200);

      const snapshot = (await snapshotsRepo(h.meta).latest(h.connectionId))!;
      const view = new SnapshotView(
        h.connectionId,
        applyOverrides(parseDatabaseModel(snapshot.schema), await overridesRepo(h.meta).listForConnection(h.connectionId, { status: 'active' })),
        new Map(),
      );
      const { db, dialect: d } = await h.manager.data(h.connectionId);
      const target: WriteTarget = { connectionId: h.connectionId, view, table: view.table(view.model.tables.find((t) => t.name === 'pos_payments')!.id), db, dialect: d };
      const writes = createWriteService(writeStores(h.meta));
      const context = { origin: 'dashboard' as const, hops: 0, actor: null, request: null };
      const write = (stage: string) =>
        writes.create({ target, values: { amount: 1, method: 'cash', stage }, context, announce: async () => {} }).then(
          () => 'written',
          (error: { details?: { fields?: Record<string, { code?: string }> } }) => `refused:${String(error.details?.fields?.['stage']?.code)}`,
        );
      expect(await write('ready')).toBe('written');
      // An update adds the column as text; the list the app declared still holds.
      expect(await write('lost')).toBe('refused:not-allowed');
    }, 90_000);

    it('refuses an update whose table needs a column no safe edit can add, before it changes anything', async () => {
      const h = (open = await harness(dialect));
      await stage(h);
      expect((await post(h, '/apps/install')).statusCode).toBe(200);
      // 1.1.0: payments gains a REQUIRED reference to shifts — the rows already there would have none.
      const next = {
        ...MANIFEST,
        version: '1.1.0',
        requiredSchema: {
          prefixed: true,
          tables: TABLES.map((t) =>
            t.ref === 'payments' ? { ...t, columns: [...t.columns, { ref: 'shift_id', type: 'fk', references: 'shifts' }] } : t,
          ),
        },
      };
      await stageManifest(h, next);
      const planned = (await post(h, '/apps/plan', { version: '1.1.0' })).json().plan;
      expect(planned.problems.map((p: { code: string }) => p.code)).toEqual(['COLUMNS_REQUIRED']);
      const res = await h.app.inject({ method: 'POST', url: '/apps/pos/update', payload: { planChecksum: planned.checksum } });
      expect(res.statusCode, res.body).toBe(422);
      // The plan's own refusal, naming the update (its problems ride in `details`) —
      // not the DDL step's bare "this plan was refused".
      expect(res.json()).toMatchObject({ code: 'VALIDATION_FAILED', message: '"pos" cannot be updated on this database.' });
      expect(Object.keys(await h.columns('pos_payments'))).not.toContain('shift_id');
      const [row] = (await h.app.inject({ method: 'GET', url: '/apps' })).json().apps;
      expect(row.version).toBe('1.0.0');
    }, 60_000);

    it('renames an install made before prefixes to the prefix, every table, as reviewed', async () => {
      const h = (open = await harness(dialect));
      // The version an older install came from: plain names.
      await stageManifest(h, { ...MANIFEST, requiredSchema: { tables: TABLES } });
      expect((await post(h, '/apps/install')).statusCode).toBe(200);
      await h.run(`INSERT INTO menu_items (name) VALUES ('Latte')`);
      // The version that prefixes its tables: an update keeps the names it has.
      await stageManifest(h, { ...MANIFEST, version: '1.1.0' });
      const updated = await h.app.inject({ method: 'POST', url: '/apps/pos/update' });
      expect(updated.statusCode, updated.body).toBe(200);

      const listed = (await h.app.inject({ method: 'GET', url: '/apps' })).json();
      expect(listed.apps[0].oldTableNames).toEqual({ prefix: 'pos_', count: 4 });

      const planned = await h.app.inject({ method: 'POST', url: '/apps/pos/rename-tables/plan' });
      expect(planned.statusCode, planned.body).toBe(200);
      const preview = planned.json();
      // Every table, not a sample of them.
      expect(preview.tables).toEqual([
        { ref: 'lines', from: 'lines', to: 'pos_lines' },
        { ref: 'menu_items', from: 'menu_items', to: 'pos_menu_items' },
        { ref: 'payments', from: 'payments', to: 'pos_payments' },
        { ref: 'shifts', from: 'shifts', to: 'pos_shifts' },
      ]);
      expect(preview.plan.refusals).toEqual([]);

      const stale = await h.app.inject({
        method: 'POST',
        url: '/apps/pos/rename-tables',
        payload: { checksum: 'f'.repeat(64) },
      });
      expect(stale.statusCode).toBe(409);
      expect(stale.body).toContain('SCHEMA_DRIFT');
      expect(await h.columns('menu_items')).not.toEqual({});

      const renamed = await h.app.inject({
        method: 'POST',
        url: '/apps/pos/rename-tables',
        payload: { checksum: preview.plan.checksum },
      });
      expect(renamed.statusCode, renamed.body).toBe(200);
      expect(await h.columns('menu_items')).toEqual({});
      // The row came along, and the foreign key follows the new name.
      await h.run(`INSERT INTO pos_lines (item_id) VALUES (1)`);
      await expect(h.run(`INSERT INTO pos_lines (item_id) VALUES (999)`)).rejects.toThrow();

      const records = await appTablesRepo(h.meta).forInstall(h.connectionId, 'pos');
      expect(records.map((r) => r.tableName).sort()).toEqual(['pos_lines', 'pos_menu_items', 'pos_payments', 'pos_shifts']);
      const page = await pagesRepo(h.meta).findBySlug(h.connectionId, 'pos-menu');
      expect((page?.config as { source: { table: string } }).source.table).toMatch(/(^|\.)pos_menu_items$/);
      const after = (await h.app.inject({ method: 'GET', url: '/apps' })).json();
      expect(after.apps[0].oldTableNames).toBeUndefined();
    }, 60_000);

    it('asks about a new version\'s taken table, and updates with the answer', async () => {
      const h = (open = await harness(dialect));
      await stage(h);
      expect((await post(h, '/apps/install')).statusCode).toBe(200);
      // The new version brings a table somebody already made by hand.
      await h.run(`CREATE TABLE pos_staff (id integer PRIMARY KEY, badge varchar(10) NOT NULL)`);
      const next = {
        ...MANIFEST,
        version: '1.1.0',
        requiredSchema: {
          prefixed: true,
          tables: [...TABLES, { ref: 'staff', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'name', type: 'text' }] }],
        },
      };
      await stageManifest(h, next);

      const refused = await h.app.inject({ method: 'POST', url: '/apps/pos/update' });
      expect(refused.statusCode).toBe(422);

      const choices = { staff: { action: 'rename-existing', to: 'pos_staff_2019' } };
      const planned = (await post(h, '/apps/plan', { version: '1.1.0', choices })).json().plan;
      expect(planned.tables.find((t: { ref: string }) => t.ref === 'staff')).toMatchObject({
        class: 'taken',
        action: 'rename-existing',
      });
      // Payment tables and the rest are the app's own, taken back as they are.
      expect(planned.tables.find((t: { ref: string }) => t.ref === 'payments').class).toBe('own-leftover');

      const drifted = await h.app.inject({
        method: 'POST',
        url: '/apps/pos/update',
        payload: { choices, planChecksum: 'f'.repeat(64) },
      });
      expect(drifted.statusCode).toBe(409);
      expect(drifted.body).toContain('SCHEMA_DRIFT');

      const updated = await h.app.inject({
        method: 'POST',
        url: '/apps/pos/update',
        payload: { choices, planChecksum: planned.checksum },
      });
      expect(updated.statusCode, updated.body).toBe(200);
      expect(updated.json().app.schema.created).toEqual(['pos_staff']);
      expect(await h.columns('pos_staff_2019')).toHaveProperty('badge');
      expect(await h.columns('pos_staff')).toHaveProperty('name');
    }, 60_000);

    it('uninstalls, dropping only its own tables and only when the key is typed back', async () => {
      const h = (open = await harness(dialect, { superAdmin: true }));
      await stage(h);
      expect((await post(h, '/apps/install')).statusCode).toBe(200);

      const plan = (await h.app.inject({ method: 'GET', url: '/apps/pos/uninstall-plan' })).json();
      expect(plan.canDropTables).toBe(true);
      expect(plan.pages.removed.map((p: { slug: string }) => p.slug)).toEqual(['pos-menu']);
      expect(plan.tables.map((t: { table: string; droppable: boolean }) => [t.table, t.droppable])).toEqual([
        ['pos_menu_items', true],
        ['pos_payments', true],
        ['pos_shifts', true],
        ['pos_lines', true],
      ]);

      const unconfirmed = await h.app.inject({ method: 'DELETE', url: '/apps/pos', payload: { dropTables: true, confirmKey: 'nope' } });
      expect(unconfirmed.statusCode).toBe(422);
      expect(await h.columns('pos_menu_items')).not.toEqual({});

      const res = await h.app.inject({ method: 'DELETE', url: '/apps/pos', payload: { dropTables: true, confirmKey: 'pos' } });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().dropped.sort()).toEqual(['pos_lines', 'pos_menu_items', 'pos_payments', 'pos_shifts']);
      for (const table of ['pos_menu_items', 'pos_payments', 'pos_shifts', 'pos_lines']) {
        expect(await h.columns(table), table).toEqual({});
      }
      const records = await appTablesRepo(h.meta).forInstall(h.connectionId, 'pos');
      expect(new Set(records.map((r) => r.state))).toEqual(new Set(['dropped']));
      expect(await pagesRepo(h.meta).findBySlug(h.connectionId, 'pos-menu')).toBeNull();
    }, 60_000);

    it('keeps the tables and an edited page, and takes its roles with it', async () => {
      const h = (open = await harness(dialect));
      await stage(h);
      expect((await post(h, '/apps/install')).statusCode).toBe(200);
      const page = (await pagesRepo(h.meta).findBySlug(h.connectionId, 'pos-menu'))!;
      await pagesRepo(h.meta).replaceConfig(page.id, { ...(page.config as Record<string, unknown>), edited: true });
      const role = await rolesRepo(h.meta).create({ slug: 'pos-cashier', name: 'POS cashier', appKey: 'pos' });
      const user = await usersRepo(h.meta).create({ email: 'cashier@test', name: 'Cashier' });
      await rolesRepo(h.meta).assignToUser(user.id, role.id);

      const plan = (await h.app.inject({ method: 'GET', url: '/apps/pos/uninstall-plan' })).json();
      expect(plan.pages.kept.map((p: { slug: string }) => p.slug)).toEqual(['pos-menu']);
      expect(plan.roles).toEqual([{ slug: 'pos-cashier', name: 'POS cashier', members: 1, apiKeys: 0 }]);

      const res = await h.app.inject({ method: 'DELETE', url: '/apps/pos' });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toMatchObject({ removed: { pages: 0, roles: 1 }, kept: { pages: 1 }, dropped: [] });
      expect(await h.columns('pos_menu_items')).not.toEqual({});
      const kept = (await pagesRepo(h.meta).findBySlug(h.connectionId, 'pos-menu'))!;
      expect(kept.origin).toBe('user');
      expect(kept.manifestId).toBeNull();
      expect((await rolesRepo(h.meta).list()).some((r) => r.slug === 'pos-cashier')).toBe(false);
      const records = await appTablesRepo(h.meta).forInstall(h.connectionId, 'pos');
      expect(new Set(records.map((r) => r.state))).toEqual(new Set(['released']));
    }, 60_000);

    it('reinstalls over its kept tables, adding the one column a table lost', async () => {
      const h = (open = await harness(dialect));
      // A table with a foreign key: SQLite's edit rebuilds such a table rather than altering it.
      const withNote = {
        ...MANIFEST,
        requiredSchema: {
          prefixed: true,
          tables: [
            ...TABLES.map((t) => (t.ref === 'lines' ? { ...t, columns: [...t.columns, { ref: 'note', type: 'text', nullable: true }] } : t)),
            {
              ref: 'tabs',
              columns: [
                { ref: 'id', type: 'uuid', role: 'pk' },
                { ref: 'line_id', type: 'fk', references: 'lines', label: { 'en-US': 'Line' } },
                { ref: 'method', type: 'enum', enum: ['cash', 'card'] },
                { ref: 'amount', type: 'money', default: 0 },
                { ref: 'reference', type: 'text', maxLength: 64, nullable: true },
                { ref: 'paid_at', type: 'timestamptz', default: 'now' },
                { ref: 'item_id', type: 'fk', references: 'menu_items', nullable: true },
              ],
            },
          ],
        },
      };
      await stageManifest(h, withNote);
      expect((await post(h, '/apps/install')).statusCode).toBe(200);
      await h.run(`INSERT INTO pos_menu_items (name) VALUES ('Latte')`);
      await h.run(`INSERT INTO pos_lines (item_id, note) VALUES (1, 'oat')`);
      expect((await h.app.inject({ method: 'DELETE', url: '/apps/pos' })).statusCode).toBe(200);
      // Dropped by another program, as an operator's own tool would: on SQLite
      // that is another connection to the same file, which the server's own
      // connection must notice.
      const outside = dialect === 'sqlite' ? new BetterSqlite3(join(h.dataDir, 'source.db')) : null;
      for (const statement of ['ALTER TABLE pos_lines DROP COLUMN note', 'ALTER TABLE pos_tabs DROP COLUMN reference', 'DROP TABLE pos_shifts']) {
        if (outside === null) await h.run(statement);
        else outside.exec(statement);
      }
      outside?.close();
      await stageManifest(h, withNote);

      const planned = (await post(h, '/apps/plan')).json().plan;
      const lines = planned.tables.find((t: { ref: string }) => t.ref === 'lines');
      expect(lines).toMatchObject({ class: 'own-leftover', action: 'reuse', edits: [{ kind: 'add-column', column: 'note' }] });
      const res = await post(h, '/apps/install', { planChecksum: planned.checksum });
      expect(res.statusCode, res.body).toBe(200);
      expect(await h.columns('pos_lines')).toHaveProperty('note');
      await h.run(`INSERT INTO pos_lines (item_id, note) VALUES (1, 'soy')`);
      // A table dropped outside is made again, not taken for still there.
      expect(res.json().schema.created).toEqual(['pos_shifts']);
      await h.run('INSERT INTO pos_shifts (id) VALUES (1)');
    }, 60_000);

    it('refuses a drop it may not make before it changes anything', async () => {
      const h = (open = await harness(dialect));
      await stage(h);
      expect((await post(h, '/apps/install')).statusCode).toBe(200);
      expect((await h.app.inject({ method: 'GET', url: '/apps/pos/uninstall-plan' })).json().canDropTables).toBe(false);
      const res = await h.app.inject({ method: 'DELETE', url: '/apps/pos', payload: { dropTables: true, confirmKey: 'pos' } });
      expect(res.statusCode).toBe(403);
      // Still installed, pages and all.
      expect((await h.app.inject({ method: 'GET', url: '/apps' })).json().apps).toHaveLength(1);
      expect(await pagesRepo(h.meta).findBySlug(h.connectionId, 'pos-menu')).not.toBeNull();
    }, 60_000);

    it('keeps the rules its manifest asks for, and takes back only the ones still its own', async () => {
      const h = (open = await harness(dialect));
      const withRules = (version: string, rules: Record<string, Record<string, unknown>>) => ({
        ...MANIFEST,
        version,
        optionLists: { zones: { label: { 'en-US': 'Zones', 'de-DE': 'Bereiche' }, values: [{ value: 'bar' }, { value: 'terrace', label: 'Terrace' }] } },
        requiredSchema: {
          prefixed: true,
          tables: TABLES.map((table) => {
            const columns = table.columns.map((column) => {
              const own = rules[`${table.ref}.${column.ref}`];
              return own === undefined ? column : { ...column, rules: own };
            });
            if (table.ref !== 'shifts') return { ...table, columns };
            return {
              ...table,
              columns: [
                ...columns,
                { ref: 'zone', type: 'text', maxLength: 16, nullable: true, rules: rules['shifts.zone'] },
                { ref: 'state', type: 'enum', enum: ['open', 'closed'], default: 'open', rules: rules['shifts.state'] },
              ],
            };
          }),
        },
      });
      const v1 = withRules('1.0.0', {
        'menu_items.name': { required: true, validation: { maxLength: 60 } },
        'payments.method': { options: { values: [{ value: 'cash', label: { 'en-US': 'Cash', 'de-DE': 'Bar' } }, { value: 'card' }] } },
        'shifts.zone': { options: { list: 'zones' } },
        'shifts.state': { enumLabels: { labels: { open: 'Open', closed: { 'en-US': 'Closed' } } } },
      });
      await stageManifest(h, v1);
      const installed = await post(h, '/apps/install');
      expect(installed.statusCode, installed.body).toBe(200);
      expect(installed.json().rules).toEqual({ written: 5, removed: 0, lists: ['pos-zones'], skipped: [] });

      const overrides = overridesRepo(h.meta);
      const appRules = async () =>
        (await overrides.listForConnection(h.connectionId))
          .map((o) => ({ op: o.op, at: `${o.tableName.split('.').at(-1)!}.${o.columnName ?? ''}`, origin: o.origin, value: o.value }))
          .sort((a, b) => `${a.at}${a.op}`.localeCompare(`${b.at}${b.op}`));
      expect(await appRules()).toEqual([
        { op: 'column.required', at: 'pos_menu_items.name', origin: 'app', value: { required: true } },
        { op: 'column.validation', at: 'pos_menu_items.name', origin: 'app', value: { maxLength: 60 } },
        {
          op: 'column.options',
          at: 'pos_payments.method',
          origin: 'app',
          value: { values: [{ value: 'cash', label: 'Cash' }, { value: 'card' }] },
        },
        { op: 'column.enumLabels', at: 'pos_shifts.state', origin: 'app', value: { labels: { open: 'Open', closed: 'Closed' } } },
        { op: 'column.options', at: 'pos_shifts.zone', origin: 'app', value: { list: 'pos-zones' } },
      ]);
      expect(await optionListsRepo(h.meta).findByKey('pos-zones')).toMatchObject({
        name: 'Zones',
        origin: 'app:pos',
        items: [{ value: 'bar' }, { value: 'terrace', label: 'Terrace' }],
      });

      // A Studio save rewrites every row under a new id, keeping each one's
      // origin: the rules are still the app's.
      const before = await overrides.listForConnection(h.connectionId);
      await overrides.replaceForConnection(
        h.connectionId,
        before.map((o) => ({ op: o.op, tableName: o.tableName, columnName: o.columnName, value: o.value, origin: o.origin })),
      );
      // The operator changes the payment methods, and keeps their own rule on the tip.
      const method = (await overrides.listForConnection(h.connectionId)).find((o) => o.columnName === 'method')!;
      await h.meta.db
        .updateTable('adminium_schema_overrides')
        .set({ value: JSON.stringify({ values: [{ value: 'cash' }, { value: 'card' }, { value: 'voucher' }] }) } as never)
        .where('id', '=', method.id)
        .execute();
      const tipTable = before.find((o) => o.tableName.endsWith('pos_payments'))!.tableName;
      await overrides.create({ connectionId: h.connectionId, op: 'column.required', tableName: tipTable, columnName: 'tip', value: { required: true } });

      // v2: no length limit, new labels, other methods, and a tip it wants required.
      await stageManifest(
        h,
        withRules('1.1.0', {
          'menu_items.name': { required: true },
          'payments.method': { options: { values: [{ value: 'cash' }, { value: 'card' }, { value: 'online' }] } },
          'payments.tip': { required: true },
          'shifts.zone': { options: { list: 'zones' } },
          'shifts.state': { enumLabels: { labels: { open: 'Open now', closed: 'Closed' } } },
        }),
      );
      const updated = await h.app.inject({ method: 'POST', url: '/apps/pos/update' });
      expect(updated.statusCode, updated.body).toBe(200);
      const rules = updated.json().app.rules;
      expect(rules).toMatchObject({ written: 1, removed: 1, lists: [] });
      // The operator's two rules win: their methods, their tip.
      expect(rules.skipped.map((skip: { column: string; op: string }) => `${skip.column}:${skip.op}`).sort()).toEqual([
        'method:column.options',
        'tip:column.required',
      ]);
      expect((await appRules()).map((r) => `${r.at}:${r.op}:${r.origin}`)).toEqual([
        'pos_menu_items.name:column.required:app',
        'pos_payments.method:column.options:app',
        'pos_payments.tip:column.required:user',
        'pos_shifts.state:column.enumLabels:app',
        'pos_shifts.zone:column.options:app',
      ]);
      expect((await appRules()).find((r) => r.at === 'pos_shifts.state')?.value).toEqual({
        labels: { open: 'Open now', closed: 'Closed' },
      });

      // After the update the operator relabels the shift states — the rule the
      // app just recorded, under the id it recorded.
      const state = (await overrides.listForConnection(h.connectionId)).find((o) => o.columnName === 'state')!;
      await h.meta.db
        .updateTable('adminium_schema_overrides')
        .set({ value: JSON.stringify({ labels: { open: 'Serving', closed: 'Closed' } }) } as never)
        .where('id', '=', state.id)
        .execute();

      // Uninstall takes back the two still as it wrote them.
      const plan = (await h.app.inject({ method: 'GET', url: '/apps/pos/uninstall-plan' })).json();
      expect(plan.rules).toBe(2);
      const removed = await h.app.inject({ method: 'DELETE', url: '/apps/pos' });
      expect(removed.statusCode, removed.body).toBe(200);
      expect(removed.json().removed.rules).toBe(2);
      expect((await appRules()).map((r) => `${r.at}:${r.op}`)).toEqual([
        'pos_payments.method:column.options',
        'pos_payments.tip:column.required',
        'pos_shifts.state:column.enumLabels',
      ]);
      // The list stays: the operator's own rules may name it.
      expect(await optionListsRepo(h.meta).findByKey('pos-zones')).not.toBeNull();
    }, 60_000);

    it('names its tables and columns in every language it speaks, and the operator’s own name wins', async () => {
      const h = (open = await harness(dialect));
      const labelled = {
        ...MANIFEST,
        requiredSchema: {
          prefixed: true,
          tables: TABLES.map((table) => {
            if (table.ref === 'menu_items') {
              return {
                ...table,
                label: { 'en-US': 'Menu item', 'de-DE': 'Gericht' },
                labelPlural: { 'en-US': 'Menu items', 'de-DE': 'Gerichte' },
                keyField: 'name',
                columns: table.columns.map((column) =>
                  column.ref === 'price' ? { ...column, label: { 'en-US': 'Unit price', 'de-DE': 'Stückpreis' } } : column,
                ),
              };
            }
            if (table.ref === 'payments') {
              return { ...table, columns: table.columns.map((column) => (column.ref === 'method' ? { ...column, label: 'How paid' } : column)) };
            }
            if (table.ref === 'shifts') {
              return {
                ...table,
                columns: [
                  ...table.columns,
                  { ref: 'state', type: 'enum', enum: ['open', 'closed'], default: 'open', rules: { enumLabels: { labels: { open: 'Open now', closed: 'Closed' } } } },
                ],
              };
            }
            return table;
          }),
        },
      };
      await stageManifest(h, labelled);
      const overrides = overridesRepo(h.meta);
      const installed = await post(h, '/apps/install');
      expect(installed.statusCode, installed.body).toBe(200);
      expect(installed.json().rules).toMatchObject({ written: 5, skipped: [] });
      const labels = async () =>
        (await overrides.listForConnection(h.connectionId))
          .filter((o) => o.op === 'table.label' || o.op === 'table.keyField' || o.op === 'column.label')
          .map((o) => ({ op: o.op, at: `${o.tableName.split('.').at(-1)!}.${o.columnName ?? ''}`, origin: o.origin, value: o.value }))
          .sort((a, b) => `${a.at}${a.op}`.localeCompare(`${b.at}${b.op}`));
      expect(await labels()).toEqual([
        { op: 'column.label', at: 'pos_menu_items.price', origin: 'app', value: { label: { en_US: 'Unit price', de_DE: 'Stückpreis' } } },
        { op: 'table.keyField', at: 'pos_menu_items.', origin: 'app', value: { column: 'name' } },
        {
          op: 'table.label',
          at: 'pos_menu_items.',
          origin: 'app',
          value: { label: { en_US: 'Menu item', de_DE: 'Gericht' }, labelPlural: { en_US: 'Menu items', de_DE: 'Gerichte' } },
        },
        { op: 'column.label', at: 'pos_payments.method', origin: 'app', value: { label: 'How paid' } },
      ]);

      // A form reads them in its reader's language: the title's noun, a field's name, a link's.
      const items = (await overrides.listForConnection(h.connectionId)).find((o) => o.op === 'table.label')!.tableName;
      const german = await columnFactsFor(h.meta, h.connectionId, items, 'de_DE');
      const english = await columnFactsFor(h.meta, h.connectionId, items);
      expect([german?.table.labelSingular, english?.table.labelSingular]).toEqual(['Gericht', 'Menu item']);
      const priceLabel = (block: typeof german) => block?.columns.find((c) => c.spec['name'] === 'price')?.spec['label'];
      expect([priceLabel(german), priceLabel(english)]).toEqual(['Stückpreis', 'Unit price']);
      expect([german?.table.labelPlural, english?.table.labelPlural]).toEqual(['Gerichte', 'Menu items']);
      // A reference names its table the reader's way; an enum names its values.
      const lines = items.replace('pos_menu_items', 'pos_lines');
      const itemRef = (await columnFactsFor(h.meta, h.connectionId, lines, 'de_DE'))?.columns.find((c) => c.spec['name'] === 'item_id');
      expect((itemRef?.spec['fk'] as { label?: string } | undefined)?.label).toBe('Gerichte');
      const shifts = items.replace('pos_menu_items', 'pos_shifts');
      const state = (await columnFactsFor(h.meta, h.connectionId, shifts))?.columns.find((c) => c.spec['name'] === 'state');
      expect(state?.enumLabels).toEqual({ open: 'Open now', closed: 'Closed' });
      // The page the app ships is composed with them: its list heads the column the app's way.
      const menu = await pagesRepo(h.meta).findBySlug(h.connectionId, 'pos-menu');
      expect(JSON.stringify(menu?.config)).toContain('"label":"Unit price"');

      // The operator renames the payment method; an update leaves their name alone.
      const method = (await overrides.listForConnection(h.connectionId)).find((o) => o.op === 'column.label' && o.columnName === 'method')!;
      await overrides.delete(method.id);
      await overrides.create({ connectionId: h.connectionId, op: 'column.label', tableName: method.tableName, columnName: 'method', value: { label: 'Tender' } });
      await stageManifest(h, { ...labelled, version: '1.1.0' });
      const updated = await h.app.inject({ method: 'POST', url: '/apps/pos/update' });
      expect(updated.statusCode, updated.body).toBe(200);
      expect(updated.json().app.rules.skipped.map((skip: { column: string; op: string }) => `${skip.column}:${skip.op}`)).toEqual([
        'method:column.label',
      ]);

      // Uninstall takes back the three still its own; the operator's stays.
      const removed = await h.app.inject({ method: 'DELETE', url: '/apps/pos' });
      expect(removed.statusCode, removed.body).toBe(200);
      expect(removed.json().removed.rules).toBe(4);
      expect((await labels()).map((r) => `${r.at}:${r.op}:${r.origin}`)).toEqual(['pos_payments.method:column.label:user']);
    }, 60_000);

    it('installs its roles with their grants filled in, seeded once, and suspended while it is off', async () => {
      const h = (open = await harness(dialect));
      const withRoles = (version: string, cashier: string[]) => ({
        ...MANIFEST,
        version,
        roles: [
          { key: 'cashier', name: 'POS cashier', screensOnly: true, permissions: cashier },
          { key: 'manager', name: 'POS manager', cloneFrom: 'cashier', permissions: ['table:@payments:delete', 'page:@pos-menu:edit'] },
        ],
      });
      const v1 = ['table:@menu_items:read', 'table:@payments:read', 'table:@payments:create', 'page:@pos-menu:view', 'app:@:staff'];
      await stageManifest(h, withRoles('1.0.0', v1));
      const installed = await post(h, '/apps/install');
      expect(installed.statusCode, installed.body).toBe(200);
      // Five for the cashier (its staff screens included), seven for the manager.
      expect(installed.json().roles).toEqual({ created: ['pos-cashier', 'pos-manager'], seeded: 12 });

      const roles = rolesRepo(h.meta);
      const cashier = (await roles.findBySlug('pos-cashier'))!;
      expect(cashier).toMatchObject({ appKey: 'pos', screensOnly: true, name: 'POS cashier' });
      const rowsOf = async (roleId: string) =>
        Object.fromEntries(
          (await permissionsRepo(h.meta).listForRole(roleId)).map((row) => [
            row.resourceKind === 'table'
              ? row.resourceRef.split('/')[1]!.split('.').at(-1)!
              : `${row.resourceKind}:${row.resourceKind === 'app' ? row.resourceRef : 'page'}`,
            Object.entries(row.actions as Record<string, boolean>)
              .filter(([, on]) => on)
              .map(([action]) => action)
              .sort(),
          ]),
        );
      expect(await rowsOf(cashier.id)).toEqual({
        pos_menu_items: ['read'],
        pos_payments: ['create', 'read'],
        'page:page': ['view'],
        'app:pos': ['staff'],
      });
      const manager = (await roles.findBySlug('pos-manager'))!;
      expect(await rowsOf(manager.id)).toEqual({
        pos_menu_items: ['read'],
        pos_payments: ['create', 'delete', 'read'],
        'page:page': ['edit', 'view'],
        'app:pos': ['staff'],
      });

      // The operator takes creating payments away from the cashier.
      const payments = (await permissionsRepo(h.meta).listForRole(cashier.id)).find((row) => row.resourceRef.endsWith('pos_payments'))!;
      await permissionsRepo(h.meta).grant(cashier.id, 'table', payments.resourceRef, { ...(payments.actions as object), create: false } as never);

      // v1.1 asks for shifts too: only that is given (to the cashier, and to
      // the manager that clones it); the narrowing stays.
      await stageManifest(h, withRoles('1.1.0', [...v1, 'table:@shifts:read']));
      const updated = await h.app.inject({ method: 'POST', url: '/apps/pos/update' });
      expect(updated.statusCode, updated.body).toBe(200);
      expect(updated.json().app.roles).toEqual({ created: [], seeded: 2 });
      expect(await rowsOf(cashier.id)).toEqual({
        pos_menu_items: ['read'],
        pos_payments: ['read'],
        pos_shifts: ['read'],
        'page:page': ['view'],
        'app:pos': ['staff'],
      });

      // Switched off, its roles grant nothing; nothing about them is deleted.
      const on = await resolveForRoles(h.meta, [cashier]);
      expect(on.grants.size).toBeGreaterThan(0);
      const row = (await manifestsRepo(h.meta, { encrypt: (v) => v, decrypt: (v) => v }).list('app'))[0]!;
      await manifestsRepo(h.meta, { encrypt: (v) => v, decrypt: (v) => v }).setStatus(row.row.id, 'disabled');
      expect((await resolveForRoles(h.meta, [cashier])).grants.size).toBe(0);
      await manifestsRepo(h.meta, { encrypt: (v) => v, decrypt: (v) => v }).setStatus(row.row.id, 'installed');

      // Uninstalled and installed again: the roles come back with every grant.
      expect((await h.app.inject({ method: 'DELETE', url: '/apps/pos' })).statusCode).toBe(200);
      expect(await roles.findBySlug('pos-cashier')).toBeNull();
      await stageManifest(h, withRoles('1.1.0', [...v1, 'table:@shifts:read']));
      const again = await h.app.inject({
        method: 'POST',
        url: '/apps/install',
        payload: { key: 'pos', version: '1.1.0', connectionId: h.connectionId },
      });
      expect(again.statusCode, again.body).toBe(200);
      expect(again.json().roles.created).toEqual(['pos-cashier', 'pos-manager']);
      const back = (await roles.findBySlug('pos-cashier'))!;
      expect((await rowsOf(back.id))['pos_payments']).toEqual(['create', 'read']);
    }, 60_000);

    it('makes the public access its manifest asks for, as the app’s own, and takes it back at uninstall', async () => {
      const h = (open = await harness(dialect));
      const withAccess = (version: string) => ({
        ...MANIFEST,
        version,
        publicAccess: [
          { table: 'menu_items', methods: ['GET'], select: ['id', 'name', 'price'] },
          { table: 'payments', methods: ['GET'], claim: { match: ['id', 'method'] } },
        ],
      });
      await stageManifest(h, withAccess('1.0.0'));
      const planned = await post(h, '/apps/plan');
      expect(planned.statusCode, planned.body).toBe(200);
      const access = planned.json().plan.publicAccess;
      expect(access.canGrant).toBe(true);
      expect(access.endpoints.map((e: { ref: string; pending: boolean }) => [e.ref, e.pending])).toEqual([
        ['pos_menu_items', false],
        ['pos_payments_claimed', false],
      ]);
      // `self` is an allowed origin and the database has a time zone: only the switch is said.
      expect(access.warnings.map((w: { code: string }) => w.code)).toEqual(['PUBLIC_API_OFF']);

      const installed = await post(h, '/apps/install');
      expect(installed.statusCode, installed.body).toBe(200);
      const made = installed.json().publicAccess;
      expect(made.endpoints).toEqual(['pos_menu_items', 'pos_payments_claimed']);
      expect(made.keyId).not.toBeNull();

      const endpoints = () => publicEndpointsRepo(h.meta).listByConnection(h.connectionId);
      const saved = await endpoints();
      expect(saved.map((e) => [e.ref, e.managedBy]).sort()).toEqual([
        ['pos_menu_items', 'pos'],
        ['pos_payments_claimed', 'pos'],
      ]);
      const claimed = JSON.parse(saved.find((e) => e.ref === 'pos_payments_claimed')!.definition) as Record<string, unknown>;
      expect(claimed['identity']).toEqual({ strategy: 'lookup', match: ['id', 'method'], column: 'id' });
      expect(claimed['auth']).toEqual({ role: 'authenticated' });
      const key = (await publicKeysRepo(h.meta).findById(made.keyId))!;
      expect(key).toMatchObject({ name: 'Point of Sale · guests', kind: 'browser', appKey: 'pos', managedBy: 'pos', side: 'customer' });

      // An update saves the endpoints again and keeps the one key.
      await stageManifest(h, withAccess('1.1.0'));
      const updated = await h.app.inject({ method: 'POST', url: '/apps/pos/update' });
      expect(updated.statusCode, updated.body).toBe(200);
      expect(updated.json().app.publicAccess).toEqual({ endpoints: ['pos_menu_items', 'pos_payments_claimed'], keyId: null, skipped: [] });
      expect((await publicKeysRepo(h.meta).list()).filter((k) => k.managedBy === 'pos')).toHaveLength(1);

      // Uninstalled: the key is revoked and the endpoints are gone.
      expect((await h.app.inject({ method: 'DELETE', url: '/apps/pos' })).statusCode).toBe(200);
      expect((await publicKeysRepo(h.meta).findById(made.keyId))!.revokedAt).not.toBeNull();
      // …and stops at once: the resolver's cached scope is dropped.
      expect(INVALIDATED_KEYS).toContain(made.keyId);
      expect(await endpoints()).toEqual([]);
    }, 60_000);

    it('holds the app’s own key to the safe list, and an update may not widen it', async () => {
      const h = (open = await harness(dialect));
      const withAccess = (version: string, select: string[]) => ({
        ...MANIFEST,
        version,
        publicAccess: [
          { table: 'menu_items', methods: ['GET'], select },
          { table: 'payments', methods: ['GET', 'PATCH'], writable: ['tip'], claim: { match: ['id', 'method'] } },
        ],
      });
      await stageManifest(h, withAccess('1.0.0', ['id', 'name']));
      const installed = await post(h, '/apps/install');
      expect(installed.statusCode, installed.body).toBe(200);
      const keyId = installed.json().publicAccess.keyId as string;

      const views = createPublicViews(h.meta);
      const service = createEndpointService({
        meta: h.meta,
        viewFor: views.viewFor,
        tenantConfigOf: async (id) => (await connectionTenantConfig(h.meta, id)) ?? undefined,
      });
      const stored = async (ref: string) => {
        const row = await publicEndpointsRepo(h.meta).findByRef(h.connectionId, ref);
        const parsed = parseDefinition(row!.definition);
        if (!parsed.ok) throw new Error('unparseable');
        return parsed.definition;
      };
      const refusal = async (ref: string, change: (d: Awaited<ReturnType<typeof stored>>) => void) => {
        const definition = structuredClone(await stored(ref));
        change(definition);
        try {
          await service.saveEndpoint({ connectionId: h.connectionId, ref, definition });
        } catch (error) {
          if (error instanceof EndpointSaveRefused) return error.issues.map((i) => i.code);
          throw error;
        }
        return [];
      };
      // A write method, more columns, the sign-in taken away: each refused.
      expect(await refusal('pos_menu_items', (d) => d.methods.push('POST'))).toContain('KEY_MANAGED_UNSAFE');
      expect(await refusal('pos_menu_items', (d) => d.select.push('price'))).toContain('KEY_MANAGED_UNSAFE');
      expect(await refusal('pos_payments_claimed', (d) => d.methods.push('DELETE'))).toContain('KEY_MANAGED_UNSAFE');
      // A narrowing is fine.
      expect(await refusal('pos_menu_items', (d) => d.select.splice(1))).toEqual([]);

      // The app's own key may not be made with DELETE, nor with PATCH where no guest signs in;
      // a hand-made key may.
      const shifts = structuredClone(await stored('pos_menu_items'));
      const table = shifts.source.replace(/menu_items$/, 'shifts');
      await service.saveEndpoint({
        connectionId: h.connectionId,
        ref: 'pos_shifts',
        definition: { ...shifts, path: '/pos_shifts', source: table, select: ['id'], methods: ['GET', 'PATCH', 'DELETE'], writable: ['opened_at'] },
      });
      const made = (methods: string[], managedBy: string | null) =>
        service
          .createKey({
            connectionId: h.connectionId,
            name: 'another',
            access: [{ ref: 'pos_shifts', methods: methods as never }],
            secret: { prefix: 'pk_x', tokenHash: `h${String(Math.random())}`, tokenEncrypted: 'e' },
            managedBy,
          })
          .then(
            () => [],
            (error: { issues?: { code: string }[] }) => [...new Set((error.issues ?? []).map((i) => i.code))],
          );
      expect(await made(['GET'], 'pos')).toEqual([]);
      expect(await made(['GET', 'PATCH'], 'pos')).toEqual(['KEY_MANAGED_UNSAFE']);
      expect(await made(['GET', 'DELETE'], 'pos')).toEqual(['KEY_MANAGED_UNSAFE']);
      expect(await made(['GET', 'PATCH', 'DELETE'], null)).toEqual([]);

      // v1.1 shows one more column: the key keeps what was allowed, and the reply says why.
      await stageManifest(h, withAccess('1.1.0', ['id', 'name', 'price']));
      const updated = await h.app.inject({ method: 'POST', url: '/apps/pos/update' });
      expect(updated.statusCode, updated.body).toBe(200);
      const access = updated.json().app.publicAccess;
      expect(access.skipped.map((s: { ref: string }) => s.ref)).toEqual(['pos_menu_items']);
      expect(access.skipped[0].reason).toContain('would see more of');
      expect((await stored('pos_menu_items')).select).toEqual(['id']);
      expect((await publicKeysRepo(h.meta).findById(keyId))!.revokedAt).toBeNull();
    }, 60_000);

    it('copies a price, numbers a ticket and codes a booking, whoever writes', async () => {
      const h = (open = await harness(dialect));
      const decided = {
        ...MANIFEST,
        requiredSchema: {
          prefixed: true,
          tables: [
            TABLES[0],
            {
              ref: 'lines',
              columns: [
                { ref: 'id', type: 'bigint', role: 'pk' },
                { ref: 'item_id', type: 'fk', references: 'menu_items' },
                { ref: 'unit_price', type: 'money', nullable: true, rules: { copy: { via: 'item_id', from: 'price' } } },
              ],
            },
            {
              ref: 'tickets',
              columns: [
                { ref: 'id', type: 'int', role: 'pk' },
                { ref: 'number', type: 'text', maxLength: 16, nullable: true, rules: { sequence: { start: 100 } } },
                { ref: 'covers', type: 'int', nullable: true, rules: { validation: { min: 1 } } },
              ],
            },
            {
              ref: 'bookings',
              columns: [
                { ref: 'id', type: 'int', role: 'pk' },
                { ref: 'code', type: 'text', rules: { code: { prefix: 'MR-', length: 4 } } },
                { ref: 'name', type: 'text', maxLength: 40 },
              ],
            },
          ],
        },
      };
      await stageManifest(h, decided);
      const installed = await post(h, '/apps/install');
      expect(installed.statusCode, installed.body).toBe(200);
      expect(installed.json().rules.written).toBe(4);

      // The view every write path builds: the snapshot with its overrides.
      const snapshot = (await snapshotsRepo(h.meta).latest(h.connectionId))!;
      const view = new SnapshotView(
        h.connectionId,
        applyOverrides(parseDatabaseModel(snapshot.schema), await overridesRepo(h.meta).listForConnection(h.connectionId, { status: 'active' })),
        new Map(),
      );
      const { db, dialect: d } = await h.manager.data(h.connectionId);
      const targetOf = (name: string): WriteTarget => ({
        connectionId: h.connectionId,
        view,
        table: view.table(view.model.tables.find((t) => t.name === name)!.id),
        db,
        dialect: d,
      });
      const writes = createWriteService({ sequences: documentSequencesRepo(h.meta) });
      const context = { origin: 'dashboard' as const, hops: 0, actor: null, request: null };
      const create = (name: string, values: Record<string, unknown>, target = targetOf(name)) =>
        writes.create({ target, values, context, announce: async () => {} });

      const item = await create('pos_menu_items', { name: 'Flat white', price: 4.5 });
      // Copied from the item; a value the till sends wins (`default` mode).
      expect(Number((await create('pos_lines', { item_id: item['id'] }))['unit_price'])).toBe(4.5);
      expect(Number((await create('pos_lines', { item_id: item['id'], unit_price: 3 }))['unit_price'])).toBe(3);

      // Numbered from the rule's start, past a sample's own number; a refused
      // write burns none.
      expect((await create('pos_tickets', { number: 'S-1042' }))['number']).toBe('S-1042');
      expect((await create('pos_tickets', {}))['number']).toBe('100');
      await expect(create('pos_tickets', { covers: 0 })).rejects.toThrow('Some values were refused.');
      expect((await create('pos_tickets', {}))['number']).toBe('101');

      // A code, and a fresh one when the first collides.
      const code = (await create('pos_bookings', { name: 'Ada' }))['code'] as string;
      expect(code).toMatch(/^MR-[0-9A-HJKMNP-TV-Z]{4}$/);
      const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
      const dice = (text: string) => [...text].map((c) => CROCKFORD.indexOf(c));
      forcedInts.push(...dice(code.slice(3)), ...dice('7Q2K'));
      expect((await create('pos_bookings', { name: 'Grace' }))['code']).toBe('MR-7Q2K');
      // …inside a transaction too, where Postgres would otherwise abort it.
      forcedInts.push(...dice('7Q2K'), ...dice('8R3M'));
      const inTx = await db.transaction().execute((trx) => create('pos_bookings', { name: 'Hedy' }, { ...targetOf('pos_bookings'), db: trx }));
      expect(inTx['code']).toBe('MR-8R3M');
      expect(forcedInts).toEqual([]);

      // The multi-row paths — an import's fast path and a bulk write — decide the same.
      const checked = await writes.check('create', targetOf('pos_tickets'), context, [{}, { covers: 0 }, {}]);
      expect(checked.rows.map((row) => row?.['number'] ?? null)).toEqual(['102', null, '103']);
      const prepared = await writes.beforeEach('create', targetOf('pos_lines'), context, [{ values: { item_id: item['id'] } }]);
      expect(Number(prepared[0]!.values['unit_price'])).toBe(4.5);

      // And a public endpoint may not offer a guest any of them.
      const bookings = targetOf('pos_bookings').table;
      const definition = {
        path: '/pos_bookings',
        source: bookings.id,
        methods: ['POST'],
        select: ['id', 'code', 'name'],
        writable: ['code', 'name'],
        filters: [],
        pagination: { default_limit: 50, max_limit: 200, order: 'id.asc' },
        auth: { role: 'anon' },
        rate_limit: { requests: 60, window: '1m' },
        response: { shape: 'object', envelope: 'data' },
      } as never;
      expect(endpointIssues(definition, { ref: 'pos_bookings', view }).map((i) => [i.code, i.column])).toEqual([
        ['ENDPOINT_WRITABLE_DECIDED', 'code'],
      ]);
    }, 60_000);

    it('holds a slot to its limit, on the venue clock, and keeps a ticket’s total in step with its lines', async () => {
      const h = (open = await harness(dialect));
      const guarded = {
        ...MANIFEST,
        requiredSchema: {
          prefixed: true,
          tables: [
            TABLES[0],
            { ref: 'booking_rules', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'covers', type: 'int' }] },
            {
              ref: 'reservations',
              columns: [
                { ref: 'id', type: 'int', role: 'pk' },
                { ref: 'starts_at', type: 'timestamptz' },
                { ref: 'party', type: 'int' },
                { ref: 'status', type: 'enum', enum: ['booked', 'cancelled'] },
              ],
              capacity: {
                slot: 'starts_at',
                amount: 'party',
                perSlot: { table: 'booking_rules', column: 'covers' },
                countWhere: { column: 'status', values: ['booked'] },
                slotMinutes: 30,
                windowDays: 5,
                opens: '17:00',
                closes: '21:00',
              },
            },
            {
              ref: 'tickets',
              columns: [
                { ref: 'id', type: 'int', role: 'pk' },
                { ref: 'subtotal', type: 'money', nullable: true, rules: { rollup: { from: 'lines', via: 'ticket_id', sum: 'unit_price', times: 'qty' } } },
              ],
            },
            {
              ref: 'lines',
              columns: [
                { ref: 'id', type: 'bigint', role: 'pk' },
                { ref: 'ticket_id', type: 'fk', references: 'tickets' },
                { ref: 'unit_price', type: 'money' },
                { ref: 'qty', type: 'int' },
              ],
            },
          ],
        },
        publicAccess: [{ table: 'reservations', kind: 'availability', methods: ['GET'] }],
      };
      await stageManifest(h, guarded);
      const installed = await post(h, '/apps/install');
      expect(installed.statusCode, installed.body).toBe(200);
      expect(installed.json().rules).toMatchObject({ written: 2, skipped: [] });
      // The guests' free-or-full endpoint is made, on the guarded table.
      expect(installed.json().publicAccess.endpoints).toEqual(['pos_reservations_availability']);

      const snapshot = (await snapshotsRepo(h.meta).latest(h.connectionId))!;
      const view = new SnapshotView(
        h.connectionId,
        applyOverrides(parseDatabaseModel(snapshot.schema), await overridesRepo(h.meta).listForConnection(h.connectionId, { status: 'active' })),
        new Map(),
      );
      const { db, dialect: d } = await h.manager.data(h.connectionId);
      const zone = 'Europe/London';
      const targetOf = (name: string): WriteTarget => ({
        connectionId: h.connectionId,
        view,
        table: view.table(view.model.tables.find((t) => t.name === name)!.id),
        db,
        dialect: d,
        timezone: zone,
      });
      const writes = createWriteService({ sequences: documentSequencesRepo(h.meta) });
      const context = { origin: 'dashboard' as const, hops: 0, actor: null, request: null };
      // As the data routes prepare a value: a naive timestamp as this server's wall clock.
      const prepared = (name: string, values: Record<string, unknown>) => {
        const table = targetOf(name).table;
        return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, normalizeWriteValue(table.columns.get(k)!, v)]));
      };
      const create = (name: string, values: Record<string, unknown>) =>
        writes.create({ target: targetOf(name), values: prepared(name, values), context, announce: async () => {} });
      const update = (name: string, id: unknown, values: Record<string, unknown>) =>
        writes.update({ target: targetOf(name), pk: { id }, values: prepared(name, values), context, announce: async () => {} });
      const failure = (run: Promise<unknown>) =>
        run.then(
          () => 'written',
          (error: { code?: string; details?: { fields?: Record<string, unknown> } }) =>
            error.code === 'VALIDATION_FAILED' ? `refused:${Object.keys(error.details?.fields ?? {}).join(',')}` : String(error.code),
        );

      /** `days` from today at `hh:mm` on the venue's clock, as an ISO instant. */
      const at = (days: number, hh: number, mm = 0) => {
        const today = venueClock(new Date(), zone).day;
        const guess = Date.parse(`${today}T00:00:00Z`) + days * 86_400_000 + (hh * 60 + mm) * 60_000;
        const drift = venueClock(new Date(guess), zone).minute - (hh * 60 + mm);
        return new Date(guess - drift * 60_000).toISOString();
      };

      await create('pos_booking_rules', { covers: 6 });
      const slot = at(1, 19);
      const first = await create('pos_reservations', { starts_at: slot, party: 4, status: 'booked' });
      expect(await failure(create('pos_reservations', { starts_at: slot, party: 3, status: 'booked' }))).toBe('CAPACITY_FULL');
      const second = await create('pos_reservations', { starts_at: slot, party: 2, status: 'booked' });
      // A cancelled booking holds no seats.
      expect(await failure(create('pos_reservations', { starts_at: slot, party: 5, status: 'cancelled' }))).toBe('written');
      await update('pos_reservations', first['id'], { status: 'cancelled' });
      await create('pos_reservations', { starts_at: slot, party: 3, status: 'booked' });
      // A change to a booking leaves its own party out of the sum: 3 + 3 fits, 3 + 4 does not.
      expect(await failure(update('pos_reservations', second['id'], { party: 3 }))).toBe('written');
      expect(await failure(update('pos_reservations', second['id'], { party: 4 }))).toBe('CAPACITY_FULL');
      // The limit is the venue's setting, read at write time.
      await db.updateTable(targetOf('pos_booking_rules').table.id as never).set({ covers: 7 } as never).execute();
      expect(await failure(update('pos_reservations', second['id'], { party: 4 }))).toBe('written');

      // Only a slot the venue offers: its grid, its hours, its window, not the past.
      const offered = (iso: string) => failure(create('pos_reservations', { starts_at: iso, party: 1, status: 'booked' }));
      expect(await offered(at(1, 19, 15))).toBe('refused:starts_at');
      expect(await offered(at(1, 16, 30))).toBe('refused:starts_at');
      expect(await offered(at(1, 21))).toBe('refused:starts_at');
      expect(await offered(at(1, 20, 30))).toBe('written');
      expect(await offered(at(6, 19))).toBe('refused:starts_at');
      expect(await offered(at(-1, 19))).toBe('refused:starts_at');

      // Five guests at once for six seats, two each: three get in.
      const busy = at(2, 18);
      const outcomes = await Promise.all(
        Array.from({ length: 5 }, () => failure(create('pos_reservations', { starts_at: busy, party: 2, status: 'booked' }))),
      );
      expect(outcomes.filter((o) => o === 'written')).toHaveLength(3);
      expect(outcomes.filter((o) => o === 'CAPACITY_FULL')).toHaveLength(2);

      // Rows written together cannot each hold their slot: refused, unless it is history.
      await expect(writes.check('create', targetOf('pos_reservations'), context, [{ starts_at: busy, party: 1 }])).rejects.toBeInstanceOf(
        GuardedBatchError,
      );
      const history = await writes.check('create', targetOf('pos_reservations'), context, [prepared('pos_reservations', { starts_at: at(-3, 19), party: 9, status: 'booked' })], {
        capacity: 'unchecked',
      });
      expect(history.rows[0]).not.toBeNull();

      // A ticket's subtotal follows its lines, however they change.
      const total = async (id: unknown) =>
        Number(
          ((await db.selectFrom(targetOf('pos_tickets').table.id as never).select('subtotal' as never).where('id' as never, '=', id as never).executeTakeFirst()) as { subtotal: unknown })
            .subtotal,
        );
      const ticket = await create('pos_tickets', { subtotal: 0 });
      const other = await create('pos_tickets', { subtotal: 0 });
      const line = await create('pos_lines', { ticket_id: ticket['id'], unit_price: 4.5, qty: 2 });
      expect(await total(ticket['id'])).toBe(9);
      await create('pos_lines', { ticket_id: ticket['id'], unit_price: 3, qty: 1 });
      expect(await total(ticket['id'])).toBe(12);
      await update('pos_lines', line['id'], { qty: 3 });
      expect(await total(ticket['id'])).toBe(16.5);
      await update('pos_lines', line['id'], { ticket_id: other['id'] });
      expect([await total(ticket['id']), await total(other['id'])]).toEqual([3, 13.5]);
      await writes.delete({ target: targetOf('pos_lines'), pk: { id: line['id'] }, context, announce: async () => {} });
      expect(await total(other['id'])).toBe(0);

      // And a guest may never write a total.
      const tickets = targetOf('pos_tickets').table;
      expect(
        endpointIssues(
          {
            path: '/pos_tickets',
            source: tickets.id,
            methods: ['POST'],
            select: ['id', 'subtotal'],
            writable: ['subtotal'],
            filters: [],
            pagination: { default_limit: 50, max_limit: 200, order: 'id.asc' },
            auth: { role: 'anon' },
            rate_limit: { requests: 60, window: '1m' },
            response: { shape: 'object', envelope: 'data' },
          } as never,
          { ref: 'pos_tickets', view },
        ).map((i) => i.code),
      ).toContain('ENDPOINT_WRITABLE_DECIDED');
    }, 60_000);

    it('reads a booking’s wall time on the venue’s clock, from the connection’s own zone', async () => {
      const h = (open = await harness(dialect));
      const booking = {
        ...MANIFEST,
        requiredSchema: {
          prefixed: true,
          tables: [
            TABLES[0],
            {
              ref: 'reservations',
              columns: [
                { ref: 'id', type: 'int', role: 'pk' },
                { ref: 'starts_at', type: 'timestamptz', rules: { venueLocal: true } },
                { ref: 'noted_at', type: 'timestamptz', nullable: true },
                { ref: 'party', type: 'int' },
              ],
              capacity: { slot: 'starts_at', amount: 'party', perSlot: 8, slotMinutes: 30, opens: '17:00', closes: '21:00' },
            },
          ],
        },
      };
      await stageManifest(h, booking);
      expect((await post(h, '/apps/install')).statusCode).toBe(200);
      await h.meta.db.updateTable('adminium_connections').set({ timezone: 'Asia/Tokyo' }).where('id', '=', h.connectionId).execute();

      const snapshot = (await snapshotsRepo(h.meta).latest(h.connectionId))!;
      const view = new SnapshotView(
        h.connectionId,
        applyOverrides(parseDatabaseModel(snapshot.schema), await overridesRepo(h.meta).listForConnection(h.connectionId, { status: 'active' })),
        new Map(),
      );
      const { db, dialect: d } = await h.manager.data(h.connectionId);
      const table = view.table(view.model.tables.find((t) => t.name === 'pos_reservations')!.id);
      // No zone on the target: the service looks up the connection's.
      const target: WriteTarget = { connectionId: h.connectionId, view, table, db, dialect: d };
      const writes = createWriteService(writeStores(h.meta));
      const context = { origin: 'dashboard' as const, hops: 0, actor: null, request: null };
      const tomorrow = venueClock(new Date(Date.now() + 86_400_000), 'Asia/Tokyo').day;
      const create = (values: Record<string, unknown>, on: WriteTarget = target) =>
        writes.create({ target: on, values, context, announce: async () => {} });
      const instantOf = (value: unknown) =>
        value instanceof Date ? value.toISOString() : new Date(String(value).includes('T') ? String(value) : String(value).replace(' ', 'T')).toISOString();

      const row = await create({ starts_at: `${tomorrow} 19:00`, noted_at: `${tomorrow} 19:00`, party: 2 });
      // 19:00 in Tokyo is 10:00 UTC; the column without the rule is left as written.
      expect(instantOf(row['starts_at'])).toBe(`${tomorrow}T10:00:00.000Z`);
      expect(instantOf(row['noted_at'])).not.toBe(`${tomorrow}T10:00:00.000Z`);
      // Tokyo's hours: 16:30 there is refused, whatever it is in UTC.
      await expect(create({ starts_at: `${tomorrow} 16:30`, party: 2 })).rejects.toThrow('Some values were refused.');
      // A zone the writer names — the public API's key — wins over the connection's.
      const london = await create({ starts_at: `${tomorrow} 19:00`, party: 2 }, { ...target, timezone: 'Europe/London' });
      expect(instantOf(london['starts_at'])).toBe(wallTimeToInstant(`${tomorrow} 19:00`, 'Europe/London')!.toISOString());
    }, 60_000);

    it('installs the Overview, and every card of it reads the till’s day', async () => {
      const h = (open = await harness(dialect));
      await stageManifest(h, {
        ...MANIFEST,
        requiredSchema: { prefixed: true, tables: POS_OVERVIEW_TABLES },
        pages: [
          {
            ref: 'pos-overview',
            template: 'page-dashboard',
            title: { key: 't', fallback: 'Overview' },
            nav: { group: 'library', icon: 'layout-dashboard', order: 0 },
            config: { layout: POS_OVERVIEW_LAYOUT },
          },
        ],
      });
      const installed = await post(h, '/apps/install');
      expect(installed.statusCode, installed.body).toBe(200);
      expect(installed.json().pages.created).toEqual(['pos-overview']);

      // The layout as installed: every card bound to this connection's real tables.
      const page = (await pagesRepo(h.meta).findBySlug(h.connectionId, 'pos-overview'))!;
      const findLayout = (value: unknown): { toolbar?: unknown; items: { i: string; config: { binding?: unknown } }[] } | null => {
        if (typeof value !== 'object' || value === null) return null;
        const node = value as Record<string, unknown>;
        if (Array.isArray(node['items']) && node['version'] === 1) return node as never;
        for (const child of Object.values(node)) {
          const found = findLayout(child);
          if (found !== null) return found;
        }
        return null;
      };
      const layout = findLayout(page.config)!;
      expect(layout.toolbar).toEqual({ day: true });
      expect(layout.items).toHaveLength(14);

      // A little of today at the till, written as the till writes.
      const snapshot = (await snapshotsRepo(h.meta).latest(h.connectionId))!;
      const view = new SnapshotView(h.connectionId, applyOverrides(parseDatabaseModel(snapshot.schema), []), new Map());
      const { db, dialect: d } = await h.manager.data(h.connectionId);
      const writes = createWriteService(writeStores(h.meta));
      const context = { origin: 'dashboard' as const, hops: 0, actor: null, request: null };
      const put = (name: string, values: Record<string, unknown>) =>
        writes.create({
          target: { connectionId: h.connectionId, view, table: view.table(view.model.tables.find((t) => t.name === `pos_${name}`)!.id), db, dialect: d },
          values,
          context,
          announce: async () => {},
        });
      const now = new Date();
      const stamp = now.toISOString();
      const ticket = await put('tickets', { number: '1042', status: 'paid', guests: 2, total: 12.5, opened_at: stamp, closed_at: stamp });
      await put('tickets', { number: '1043', status: 'open', guests: 1, opened_at: stamp });
      await put('payments', { ticket_id: ticket['id'], method: 'card', amount: 12.5, tip: 1.5, paid_at: stamp });
      await put('ticket_items', { ticket_id: ticket['id'], name: 'Flat white', qty: 2, unit_price: 4.5, sent_at: stamp });
      await put('refunds', { ticket_id: ticket['id'], amount: 2, reason: 'Wrong item', refunded_at: stamp });
      await put('reservations', { name: 'Ada', party_size: 4, starts_at: stamp, status: 'confirmed' });
      await put('menu_items', { name: 'Almond croissant', price: 3, available: d === 'sqlite' ? 0 : false });
      await put('shifts', { opening_float: 200, started_at: stamp });
      const alex = await put('staff', { name: 'Alex' });
      await put('time_clock', { staff_id: alex['id'], clock_in: stamp });

      const cards: Record<string, Record<string, unknown>> = {};
      for (const item of layout.items) {
        const descriptor = queryDescriptorSchema.parse(item.config.binding);
        // As the widget-data route does: a card's lookups are resolved for the reader first.
        const lookups = await resolveLookups({
          view,
          table: view.table(view.model.tables.find((t) => t.name === descriptor.source.name)!.id),
          raw: descriptor.lookups ?? [],
          canReadPii: true,
          canReadTable: async () => true,
        });
        const compiled = compileWidgetQuery({ db, view, descriptor, params: { day: 'today' }, canReadPii: true, dialect: d, now: () => now, timezone: 'UTC', lookups });
        const rows = (await compiled.query.execute()) as Record<string, unknown>[];
        const priorRows = compiled.prior === null ? undefined : ((await compiled.prior.execute()) as Record<string, unknown>[]);
        cards[item.i] = shapeRows({ compiled, rows, priorRows, canReadPii: true }) as unknown as Record<string, unknown>;
      }
      expect(Object.keys(cards)).toHaveLength(14);
      expect(Number(cards['kpi-sales']!['value'])).toBe(12.5);
      expect(Number(cards['kpi-tickets']!['value'])).toBe(1);
      expect(Number(cards['kpi-tips']!['value'])).toBe(1.5);
      expect(Number(cards['kpi-guests']!['value'])).toBe(2);
      expect(JSON.stringify(cards['payments'])).toContain('card');
      expect(JSON.stringify(cards['best-sellers'])).toContain('Flat white');
      expect(JSON.stringify(cards['right-now'])).toContain('1043');
      expect(JSON.stringify(cards['right-now'])).not.toContain('1042');
      expect(JSON.stringify(cards['bookings'])).toContain('Ada');
      expect(JSON.stringify(cards['sold-out'])).toContain('Almond croissant');
      expect(JSON.stringify(cards['refunds'])).toContain('Wrong item');
      expect(JSON.stringify(cards['on-shift'])).toContain('Alex');
      // The looked-up name is one of the answer's columns, so a card draws it.
      expect((cards['on-shift']!['columns'] as { name: string }[]).map((c) => c.name)).toContain('staff_name');
      expect(JSON.stringify(cards['sales-by-hour'])).toContain('points');
    }, 90_000);

    it('installs a booking endpoint that confirms by email, and says when mail is not set up', async () => {
      const h = (open = await harness(dialect));
      await stageManifest(h, {
        ...MANIFEST,
        requiredSchema: {
          prefixed: true,
          tables: [
            TABLES[0],
            {
              ref: 'bookings',
              columns: [
                { ref: 'id', type: 'int', role: 'pk' },
                { ref: 'name', type: 'text', maxLength: 40 },
                { ref: 'email', type: 'text', maxLength: 80, nullable: true },
              ],
            },
            { ref: 'venue', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'venue_name', type: 'text', maxLength: 40 }] },
          ],
        },
        publicAccess: [
          {
            table: 'bookings',
            methods: ['POST'],
            // Never the email back out: a guest's address is personal data.
            select: ['id', 'name'],
            writable: ['name', 'email'],
            confirm: { template: 'booking-confirmation', to: 'email', name: 'name', venue: { table: 'venue', name: 'venue_name' }, link: 'manage?code={code}' },
          },
        ],
      });
      const planned = await post(h, '/apps/plan');
      expect(planned.statusCode, planned.body).toBe(200);
      const access = planned.json().plan.publicAccess;
      expect(access.endpoints.map((e: { ref: string; confirms: boolean }) => [e.ref, e.confirms])).toEqual([['pos_bookings', true]]);
      // No SMTP here: the check step says guests will get no confirmation.
      expect(access.warnings.map((w: { code: string }) => w.code)).toContain('NO_EMAIL');

      const installed = await post(h, '/apps/install');
      expect(installed.statusCode, installed.body).toBe(200);
      const saved = (await publicEndpointsRepo(h.meta).findByRef(h.connectionId, 'pos_bookings'))!;
      const confirm = (JSON.parse(saved.definition) as { confirm: { to: string; venue: { table: string } } }).confirm;
      expect(confirm.to).toBe('email');
      // The venue named by its short ref, bound to the real table.
      expect(confirm.venue.table).toMatch(/(^|\.)pos_venue$/);
    }, 60_000);

    it('shows a venue’s own phone publicly only when the app says it is not personal data', async () => {
      const venue = (rules: Record<string, unknown>) => ({
        ...MANIFEST,
        requiredSchema: {
          prefixed: true,
          tables: [
            TABLES[0],
            {
              ref: 'venue',
              columns: [
                { ref: 'id', type: 'int', role: 'pk' },
                { ref: 'venue_name', type: 'text', maxLength: 40 },
                { ref: 'phone', type: 'text', maxLength: 32, nullable: true, rules },
              ],
            },
          ],
        },
        publicAccess: [{ table: 'venue', methods: ['GET'], select: ['id', 'venue_name', 'phone'] }],
      });
      // A column named `phone` is taken for a person's: no anonymous endpoint may show it.
      const h = (open = await harness(dialect));
      await stageManifest(h, venue({}));
      const refused = await post(h, '/apps/install');
      expect(refused.statusCode, refused.body).toBe(409);
      expect(refused.json().message).toContain('"phone" is marked personal data');
      await h.close();

      // The app knows better: it is the venue's own number.
      const again = (open = await harness(dialect));
      await stageManifest(again, venue({ personal: false }));
      const installed = await post(again, '/apps/install');
      expect(installed.statusCode, installed.body).toBe(200);
      expect(installed.json().publicAccess.endpoints).toEqual(['pos_venue']);
      const rule = (await overridesRepo(again.meta).listForConnection(again.connectionId)).find((o) => o.op === 'column.pii');
      expect(rule?.value).toEqual({ masked: false });
      expect(rule?.origin).toBe('app');
    }, 90_000);

    it('makes no public access when it is declined, and refuses it to someone who may not manage keys', async () => {
      const h = (open = await harness(dialect, { canManageKeys: false }));
      await stageManifest(h, { ...MANIFEST, publicAccess: [{ table: 'menu_items', methods: ['GET'] }] });
      await h.meta.db.updateTable('adminium_connections').set({ timezone: null }).where('id', '=', h.connectionId).execute();
      const planned = await post(h, '/apps/plan');
      expect(planned.json().plan.publicAccess.canGrant).toBe(false);
      expect(planned.json().plan.publicAccess.warnings.map((w: { code: string }) => w.code)).toEqual(['PUBLIC_API_OFF', 'NO_TIME_ZONE']);

      const refused = await post(h, '/apps/install');
      expect(refused.statusCode, refused.body).toBe(403);
      expect(refused.json().message).toContain('asks for public access');
      // Refused before anything was written.
      expect(await manifestsRepo(h.meta, { encrypt: (v) => v, decrypt: (v) => v }).list('app')).toEqual([]);

      const declined = await post(h, '/apps/install', { publicAccess: false });
      expect(declined.statusCode, declined.body).toBe(200);
      expect(declined.json().publicAccess).toBeUndefined();
      expect(await publicEndpointsRepo(h.meta).listByConnection(h.connectionId)).toEqual([]);
      expect((await publicKeysRepo(h.meta).list()).filter((k) => k.appKey === 'pos')).toEqual([]);
    }, 60_000);

    it('adds sample rows holding a list, a switch and a uuid key', async () => {
      const h = (open = await harness(dialect));
      const bundle = {
        format: 'adminium.sample/1',
        app: 'pos',
        tables: [
          { ref: 'venue', rows: [{ name: 'Daybreak', open: true, tip_presets: [0, 10, 15, 20] }] },
          { ref: 'tenders', rows: [{ id: '5a3b1e00-0000-4000-8000-000000000001', amount: '4.50', settled: false }] },
        ],
      };
      await stageManifest(
        h,
        {
          ...MANIFEST,
          requiredSchema: {
            prefixed: true,
            tables: [
              TABLES[0],
              {
                ref: 'venue',
                columns: [
                  { ref: 'id', type: 'int', role: 'pk' },
                  { ref: 'name', type: 'text', maxLength: 40 },
                  { ref: 'open', type: 'bool', default: true },
                  { ref: 'tip_presets', type: 'json', nullable: true },
                ],
              },
              {
                ref: 'tenders',
                columns: [
                  { ref: 'id', type: 'uuid', role: 'pk' },
                  { ref: 'amount', type: 'money' },
                  { ref: 'settled', type: 'bool', default: false },
                ],
              },
            ],
          },
          sampleData: { file: 'seeds/pos.sample.json' },
        },
        { 'seeds/pos.sample.json': JSON.stringify(bundle) },
      );
      expect((await post(h, '/apps/install')).statusCode).toBe(200);
      const service = createSampleDataService(sampleDeps(h.meta, h.manager, createAppStore({ dataDir: h.dataDir })));
      // Each driver refused one of these raw: an array went out as a Postgres
      // array or a MySQL parameter list, and SQLite binds no boolean at all.
      // A uuid key has no sequence to move on afterwards (Postgres: max(uuid)).
      const added = await service.add((await findSampleApp(h.meta, 'pos'))!, { locale: 'en-US', userId: null, userLabel: 'test' });
      expect(added.counts).toEqual({ venue: 1, tenders: 1 });
      const venue = (await h.rows('SELECT open, tip_presets FROM pos_venue'))[0]!;
      const presets = typeof venue['tip_presets'] === 'string' ? JSON.parse(venue['tip_presets']) : venue['tip_presets'];
      expect(presets).toEqual([0, 10, 15, 20]);
      expect(Boolean(Number(venue['open']) || venue['open'] === true)).toBe(true);
      const tender = (await h.rows('SELECT id, settled FROM pos_tenders'))[0]!;
      expect(String(tender['id']).toLowerCase()).toBe('5a3b1e00-0000-4000-8000-000000000001');
      expect(Boolean(Number(tender['settled']) || tender['settled'] === true)).toBe(false);
    }, 60_000);

    it('adds sample data after your own records, leaving a code you already hold for Adminium to make', async () => {
      const h = (open = await harness(dialect));
      const bundle = {
        format: 'adminium.sample/1',
        app: 'pos',
        assets: {},
        tables: [{ ref: 'bookings', rows: [{ code: 'MR-4829', guest: 'Mara' }, { code: 'MR-7777', guest: 'Noah' }] }],
      };
      const manifest = {
        ...MANIFEST,
        sampleData: { file: 'seeds/pos.sample.json' },
        requiredSchema: {
          prefixed: true,
          tables: [
            ...TABLES,
            {
              ref: 'bookings',
              columns: [
                { ref: 'id', type: 'int', role: 'pk' },
                { ref: 'code', type: 'text', maxLength: 12, rules: { code: { prefix: 'MR-', length: 4 } } },
                { ref: 'guest', type: 'text', maxLength: 40 },
              ],
            },
          ],
        },
      };
      await stageManifest(h, manifest, { 'seeds/pos.sample.json': JSON.stringify(bundle) });
      expect((await post(h, '/apps/install')).statusCode).toBe(200);
      // The operator's own booking already holds the code the sample ships.
      await h.run(`INSERT INTO pos_bookings (code, guest) VALUES ('MR-4829', 'Own')`);
      const service = createSampleDataService(sampleDeps(h.meta, h.manager, createAppStore({ dataDir: h.dataDir })));
      const app = (await findSampleApp(h.meta, 'pos'))!;
      await service.add(app, { locale: 'en-US', userId: null, userLabel: 'test' });
      const rows = await h.rows('SELECT code, guest FROM pos_bookings ORDER BY id');
      expect(rows.map((r) => r.guest)).toEqual(['Own', 'Mara', 'Noah']);
      // The free code is the sample's own; the taken one was made anew, and stays unique.
      expect(rows[2]!.code).toBe('MR-7777');
      expect(String(rows[1]!.code)).toMatch(/^MR-[0-9A-Z]{4}$/);
      expect(new Set(rows.map((r) => r.code)).size).toBe(3);
    }, 90_000);

    it('adds sample data in one go, then removes it without touching what you use or changed', async () => {
      const h = (open = await harness(dialect));
      const image = 'not really a webp, but bytes';
      const bundle = {
        format: 'adminium.sample/1',
        app: 'pos',
        assets: { 'img:latte': { file: 'seeds/images/latte.webp', sha256: createHash('sha256').update(image).digest('hex') } },
        tables: [
          {
            ref: 'menu_items',
            rows: [
              { '@label': 'item:latte', name: { '@t': { 'en-US': 'Latte', 'de-DE': 'Milchkaffee' } }, price: '4.50' },
              { '@label': 'item:tea', name: 'Tea', price: '3' },
              { '@label': 'item:cake', name: 'Cake', price: '5.25' },
            ],
          },
          { ref: 'shifts', rows: [{ opened_at: { '@day': -1, '@time': '09:30' } }] },
          { ref: 'payments', rows: [{ amount: '4.50', method: 'cash', tip: null }] },
          { ref: 'lines', rows: [{ item_id: { '@ref': 'item:latte' } }, { item_id: { '@ref': 'item:tea' } }] },
        ],
      };
      await stageManifest(h, { ...MANIFEST, sampleData: { file: 'seeds/pos.sample.json' } }, {
        'seeds/pos.sample.json': JSON.stringify(bundle),
        'seeds/images/latte.webp': image,
      });
      expect((await post(h, '/apps/install')).statusCode).toBe(200);

      const before = (await h.app.inject({ method: 'GET', url: '/apps/pos/sample-data' })).json();
      expect(before).toMatchObject({ offered: true, loaded: false, available: { total: 7, assets: 1 } });

      // The route queues the add as a job…
      const queued = await h.app.inject({ method: 'POST', url: '/apps/pos/sample-data' });
      expect(queued.statusCode, queued.body).toBe(200);
      expect(queued.json().jobId).toMatch(/.+/);
      // …which runs the service; run it here, in the adding person's language.
      const service = createSampleDataService(sampleDeps(h.meta, h.manager, createAppStore({ dataDir: h.dataDir })));
      const app = (await findSampleApp(h.meta, 'pos'))!;
      const now = Date.UTC(2026, 8, 23, 12, 0);
      // The venue's own zone decides what "yesterday at 09:30" is.
      await h.meta.db.updateTable('adminium_connections').set({ timezone: 'America/New_York' }).execute();
      const added = await service.add(app, { locale: 'de-DE', userId: null, userLabel: 'test', now });
      expect(added).toEqual({ counts: { menu_items: 3, shifts: 1, payments: 1, lines: 2 }, files: 1 });

      const items = await h.rows('SELECT id, name FROM pos_menu_items ORDER BY id');
      expect(items.map((r) => r.name)).toEqual(['Milchkaffee', 'Tea', 'Cake']);
      const lines = await h.rows('SELECT item_id FROM pos_lines ORDER BY id');
      expect(lines.map((r) => Number(r.item_id))).toEqual([Number(items[0]!.id), Number(items[1]!.id)]);
      const shift = await h.rows('SELECT opened_at FROM pos_shifts');
      // Yesterday at 09:30 in New York (EDT, UTC-4).
      expect(normaliseValue(shift[0]!.opened_at, 'timestamptz')).toBe('2026-09-22T13:30:00.000Z');
      const status = (await h.app.inject({ method: 'GET', url: '/apps/pos/sample-data' })).json();
      expect(status).toMatchObject({ offered: true, loaded: true, total: 7, available: null });
      // The ledger now exists, and the app's page lists it last, as its own.
      const overview = (await h.app.inject({ method: 'GET', url: '/apps/pos/overview' })).json();
      expect(overview.tables.at(-1)).toMatchObject({ table: 'pos_sample_data', role: 'sample-ledger' });
      expect(overview.tables.slice(0, -1).every((t: { role: string }) => t.role === 'app')).toBe(true);
      // Adding twice is refused rather than writing the café again.
      await expect(service.add(app, { locale: 'en-US', userId: null, userLabel: 'test' })).rejects.toThrow(/already/);

      // Your own line uses the cake; you renamed the tea.
      await h.run(`INSERT INTO pos_lines (item_id) VALUES (${String(items[2]!.id)})`);
      await h.run(`UPDATE pos_menu_items SET name = 'Green tea' WHERE id = ${String(items[1]!.id)}`);
      const plan = (await h.app.inject({ method: 'POST', url: '/apps/pos/sample-data/remove-plan' })).json();
      // Named as they read now: the renamed tea is "Green tea".
      expect(plan.kept).toEqual([{ ref: 'menu_items', label: 'item:cake', title: 'Cake', usedBy: 1 }]);
      expect(plan.changed).toEqual([{ ref: 'menu_items', label: 'item:tea', title: 'Green tea', columns: ['name'] }]);

      const removed = await h.app.inject({ method: 'POST', url: '/apps/pos/sample-data/remove', payload: { keepChanged: true } });
      expect(removed.statusCode, removed.body).toBe(200);
      expect(removed.json()).toEqual({ removed: 5, kept: 2, byTable: { lines: 2, payments: 1, shifts: 1, menu_items: 1 } });
      expect((await h.rows('SELECT name FROM pos_menu_items ORDER BY id')).map((r) => r.name)).toEqual(['Green tea', 'Cake']);
      expect(await h.rows('SELECT id FROM pos_shifts')).toEqual([]);
      // Your own line is untouched.
      expect(await h.rows('SELECT id FROM pos_lines')).toHaveLength(1);
      // The two that stay are the operator's now: the ledger is empty, and sample data can be added again.
      const after = (await h.app.inject({ method: 'GET', url: '/apps/pos/sample-data' })).json();
      expect(after).toMatchObject({ loaded: false, total: 0 });
      const again = await h.app.inject({ method: 'POST', url: '/apps/pos/sample-data' });
      expect(again.statusCode, again.body).toBeLessThan(300);
    }, 90_000);

    /*
     * Two tables that point at each other. Every FK used to be created inline,
     * which SQLite accepts and Postgres and MySQL refuse ("relation pos_tickets
     * does not exist", "Failed to open the referenced table"): the install
     * stopped at the tables step with the first table made.
     */
    const CYCLE = {
      ...MANIFEST,
      requiredSchema: {
        prefixed: true,
        tables: [
          {
            ref: 'tickets',
            columns: [
              { ref: 'id', type: 'int', role: 'pk' },
              { ref: 'reservation_id', type: 'fk', references: 'reservations', nullable: true },
            ],
          },
          {
            ref: 'reservations',
            columns: [
              { ref: 'id', type: 'int', role: 'pk' },
              { ref: 'ticket_id', type: 'fk', references: 'tickets', nullable: true },
            ],
          },
        ],
      },
      pages: [{ ...MANIFEST.pages[0]!, ref: 'pos-tickets', bindings: { rows: 'tickets' } }],
    };
    const cycleFks = async (h: Harness): Promise<string[]> => {
      const schema = dialect === 'mysql' ? 'database()' : 'current_schema()';
      const rows = await h.rows(
        `SELECT constraint_name AS name FROM information_schema.table_constraints ` +
          `WHERE table_schema = ${schema} AND constraint_type = 'FOREIGN KEY' ` +
          `AND table_name IN ('pos_tickets', 'pos_reservations') ORDER BY constraint_name`,
      );
      return rows.map((r) => String(r.name ?? r.NAME));
    };

    it('installs two tables that reference each other, with both links enforced', async () => {
      const h = (open = await harness(dialect));
      await stageManifest(h, CYCLE);
      const res = await post(h, '/apps/install');
      expect(res.statusCode, res.body).toBe(200);
      expect([...res.json().schema.created].sort()).toEqual(['pos_reservations', 'pos_tickets']);
      if (dialect !== 'sqlite') {
        expect(await cycleFks(h)).toEqual(['fk_pos_reservations_ticket_id', 'fk_pos_tickets_reservation_id']);
      }

      // Both directions refuse a dangling id and accept a real one.
      await h.run(`INSERT INTO pos_tickets (id) VALUES (1)`);
      await h.run(`INSERT INTO pos_reservations (id, ticket_id) VALUES (1, 1)`);
      await h.run(`UPDATE pos_tickets SET reservation_id = 1 WHERE id = 1`);
      await expect(h.run(`INSERT INTO pos_tickets (id, reservation_id) VALUES (2, 999)`)).rejects.toThrow();
      await expect(h.run(`INSERT INTO pos_reservations (id, ticket_id) VALUES (2, 999)`)).rejects.toThrow();

      // The snapshot knows both links.
      const model = parseDatabaseModel((await snapshotsRepo(h.meta).latest(h.connectionId))!.schema);
      const links = model.relations
        .filter((r) => r.kind === 'declared-fk')
        .map((r) => `${r.from.tableId.split('.').at(-1)!}->${r.to.tableId.split('.').at(-1)!}`)
        .sort();
      expect(links).toEqual(['pos_reservations->pos_tickets', 'pos_tickets->pos_reservations']);
    }, 60_000);

    it.skipIf(dialect === 'sqlite')('finishes a cycle a stopped install left unlinked when it is run again', async () => {
      const h = (open = await harness(dialect));
      await stageManifest(h, CYCLE);
      expect((await post(h, '/apps/install')).statusCode).toBe(200);
      // Stopped between the CREATEs and the ALTER that closes the cycle.
      await h.run(
        dialect === 'mysql'
          ? 'ALTER TABLE pos_reservations DROP FOREIGN KEY fk_pos_reservations_ticket_id'
          : 'ALTER TABLE pos_reservations DROP CONSTRAINT fk_pos_reservations_ticket_id',
      );
      const manifests = manifestsRepo(h.meta, { encrypt: (v) => v, decrypt: (v) => v });
      const row = (await manifests.list('app')).find((m) => m.row.manifestKey === 'pos')!;
      await manifests.setStatus(row.row.id, 'installing');

      const again = await post(h, '/apps/install');
      expect(again.statusCode, again.body).toBe(200);
      expect(again.json().schema.created).toEqual([]);
      expect(await cycleFks(h)).toEqual(['fk_pos_reservations_ticket_id', 'fk_pos_tickets_reservation_id']);
      await expect(h.run(`INSERT INTO pos_reservations (id, ticket_id) VALUES (1, 999)`)).rejects.toThrow();
    }, 60_000);

    it('takes the tables away again when rows link them both ways', async () => {
      const h = (open = await harness(dialect, { superAdmin: true }));
      await stageManifest(h, CYCLE);
      expect((await post(h, '/apps/install')).statusCode).toBe(200);
      // A ticket and its reservation, each pointing at the other: no drop
      // order empties either table first, on any engine.
      await h.run(`INSERT INTO pos_tickets (id) VALUES (1)`);
      await h.run(`INSERT INTO pos_reservations (id, ticket_id) VALUES (1, 1)`);
      await h.run(`UPDATE pos_tickets SET reservation_id = 1 WHERE id = 1`);

      const gone = await h.app.inject({ method: 'DELETE', url: '/apps/pos', payload: { dropTables: true, confirmKey: 'pos' } });
      expect(gone.statusCode, gone.body).toBe(200);
      expect([...gone.json().dropped].sort()).toEqual(['pos_reservations', 'pos_tickets']);
      expect(await h.columns('pos_tickets')).toEqual({});
      expect(await h.columns('pos_reservations')).toEqual({});
      // SQLite turned enforcement off for the drop; it is back on after it.
      if (dialect === 'sqlite') expect(await h.rows('PRAGMA foreign_keys')).toEqual([{ foreign_keys: 1 }]);
    }, 60_000);

    it('creates two tables that reference each other in one schema edit', async () => {
      const h = (open = await harness(dialect));
      const target = createAppSchemaTarget({ meta: h.meta, manager: h.manager, crypto: dsnCryptoFromSecret(TEST_SECRET) });
      const table = (name: string, fk: string, to: string, schema: string | null) =>
        desiredTableSchema.parse({
          name,
          schema,
          columns: [
            { name: 'id', logicalType: 'integer', nullable: false },
            { name: fk, logicalType: 'integer' },
          ],
          primaryKey: ['id'],
          // A table this edit creates has no id yet: it is named bare.
          foreignKeys: [{ columns: [fk], toTable: to, toColumns: ['id'] }],
        });
      const result = await target.edit(
        h.connectionId,
        (model) => ({
          upsertTables: [
            table('orders', 'invoice_id', 'invoices', model.defaultSchema),
            table('invoices', 'order_id', 'orders', model.defaultSchema),
          ],
        }),
        { superAdmin: true, createdBy: null },
      );
      expect(result.status, JSON.stringify(result)).toBe('applied');

      await h.run(`INSERT INTO orders (id) VALUES (1)`);
      await h.run(`INSERT INTO invoices (id, order_id) VALUES (1, 1)`);
      await h.run(`UPDATE orders SET invoice_id = 1 WHERE id = 1`);
      await expect(h.run(`INSERT INTO orders (id, invoice_id) VALUES (2, 999)`)).rejects.toThrow();
      await expect(h.run(`INSERT INTO invoices (id, order_id) VALUES (2, 999)`)).rejects.toThrow();
    }, 60_000);
  });
}
