/**
 * Shared harness for the connections + CRUD suites (not collected — no
 * .test suffix).
 *
 * Everything is probe-gated per the standing rule (CI without a local
 * PostgreSQL stays green): suites call `describe.skipIf(!pgAvailable())`.
 * Test databases are named `adminium_test_srv_<rand>`, created through the
 * `postgres` maintenance DB with the `psql` CLI, seeded with the adapter
 * package's Northwind fixture, and always dropped in afterAll.
 *
 * The app under test is the real `buildServer` on an in-memory SQLite meta
 * store with the stub session-auth hook from rbac-helpers (`x-test-user-id`
 * → `request.user`), the rbac plugin, and this wave's route plugins.
 */

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import BetterSqlite3 from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import {
  createSqliteMetaDb,
  firstRun,
  permissionsRepo,
  rolesRepo,
  usersRepo,
  type MetaDb,
  type Role,
  type User,
} from '@adminium/meta';
import { adapterRegistry, type AdapterProvider, type AdapterRegistry } from '@adminium/engine/adapter';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { registerAdapters } from '../src/connections/register-adapters.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { connectionsRoutes } from '../src/routes/connections/index.js';
import { dataRoutes } from '../src/routes/data/index.js';
import { schemaRoutes } from '../src/routes/schema/index.js';
import { widgetDataRoutes } from '../src/routes/widget-data/index.js';
import { UndoStore } from '../src/crud/undo.js';
import { WidgetDataCache } from '../src/widget-data/cache.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

export const PG_HOST = process.env.ADMINIUM_TEST_PG_HOST ?? '127.0.0.1';
export const PG_PORT = process.env.ADMINIUM_TEST_PG_PORT ?? '5432';
const MAINTENANCE_DB = 'postgres';

export const NORTHWIND_SQL = fileURLToPath(
  new URL('../../../packages/adapter-postgres/fixtures/northwind.sql', import.meta.url),
);

function findPsql(): string | null {
  const candidates = [
    process.env.ADMINIUM_TEST_PSQL,
    'psql',
    '/opt/homebrew/opt/postgresql@16/bin/psql',
    '/usr/lib/postgresql/16/bin/psql',
  ];
  for (const candidate of candidates) {
    if (candidate === undefined) continue;
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore' });
      return candidate;
    } catch {
      // keep looking
    }
  }
  return null;
}

export const PSQL = findPsql();

let probed: boolean | null = null;

/** True when psql can reach the local server, the adapter provider exists, and the fixture is present. */
export function pgAvailable(): boolean {
  if (probed !== null) return probed;
  probed = false;
  if (PSQL !== null && existsSync(NORTHWIND_SQL)) {
    try {
      psql(MAINTENANCE_DB, 'SELECT 1');
      probed = true;
    } catch {
      probed = false;
    }
  }
  return probed;
}

export function psql(database: string, sql: string): string {
  if (PSQL === null) throw new Error('psql unavailable');
  return execFileSync(PSQL, ['-h', PG_HOST, '-p', PG_PORT, '-d', database, '-v', 'ON_ERROR_STOP=1', '-Atc', sql], {
    encoding: 'utf8',
  });
}

function psqlFile(database: string, file: string): void {
  if (PSQL === null) throw new Error('psql unavailable');
  execFileSync(
    PSQL,
    ['-h', PG_HOST, '-p', PG_PORT, '-d', database, '-v', 'ON_ERROR_STOP=1', '-q', '-f', file],
    { stdio: 'ignore' },
  );
}

export interface TestPg {
  database: string;
  dsn: string;
  /** SELECT-only role on the same database (read-only probe scenarios). */
  readOnlyDsn: string;
  readOnlyRole: string;
  drop(): void;
}

/** Create `adminium_test_srv_<rand>`, load Northwind, and mint a read-only role. */
export function createNorthwindDb(): TestPg {
  const database = `adminium_test_srv_${randomBytes(4).toString('hex')}`;
  const role = `${database}_ro`;
  psql(MAINTENANCE_DB, `CREATE DATABASE ${database}`);
  try {
    psqlFile(database, NORTHWIND_SQL);
    psql(MAINTENANCE_DB, `CREATE ROLE ${role} LOGIN PASSWORD 'ro_secret'`);
    psql(database, `GRANT CONNECT ON DATABASE ${database} TO ${role}`);
    psql(database, `GRANT USAGE ON SCHEMA public TO ${role}`);
    psql(database, `GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${role}`);
    // The adapter's read-only probe checks default_transaction_read_only.
    psql(database, `ALTER ROLE ${role} SET default_transaction_read_only = on`);
  } catch (error) {
    psql(MAINTENANCE_DB, `DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    throw error;
  }
  // PGUSER first: locally the superuser is usually the OS user, but in CI the
  // OS user (`runner`) has no role — psql already honours PGUSER, and the DSN
  // handed to the driver must name the same principal.
  const user = process.env.PGUSER ?? process.env.USER ?? 'postgres';
  return {
    database,
    dsn: `postgres://${user}@${PG_HOST}:${PG_PORT}/${database}`,
    readOnlyDsn: `postgres://${role}:ro_secret@${PG_HOST}:${PG_PORT}/${database}`,
    readOnlyRole: role,
    drop() {
      psql(MAINTENANCE_DB, `DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      psql(MAINTENANCE_DB, `DROP ROLE IF EXISTS ${role}`);
    },
  };
}

export interface DataTestContext {
  app: AdminiumServer;
  meta: MetaDb;
  manager: ConnectionManager;
  undoStore: UndoStore;
  widgetCache: WidgetDataCache;
  users: { admin: User; editor: User; viewer: User };
  roles: { admin: Role; editor: Role; viewer: Role };
  grantTable(role: Role, connectionId: string, table: string, actions: Partial<Record<string, boolean>>): Promise<void>;
}

export function asUser(user: User): Record<string, string> {
  return { 'x-test-user-id': user.id };
}

export interface BuildDataTestAppOptions {
  /** Meta DSN handed to the manager for same-db placement checks. */
  metaDsn?: string | undefined;
  now?: (() => number) | undefined;
  /** Custom adapter registry (fake-adapter suites); default: real postgres. */
  registry?: AdapterRegistry<AdapterProvider> | undefined;
  /**
   * Extra route plugins registered under `/api/v1` alongside the standard
   * set (additive seam — the M7 data-io suite mounts its exports/imports
   * routes here; explicit registration per the test idiom).
   */
  extraRoutes?:
    | ((api: FastifyInstance, ctx: { meta: MetaDb; manager: ConnectionManager }) => Promise<void>)
    | undefined;
}

export async function buildDataTestApp(opts: BuildDataTestAppOptions = {}): Promise<DataTestContext> {
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  if (opts.registry === undefined) await registerAdapters(adapterRegistry);

  const roles = rolesRepo(meta);
  const users = usersRepo(meta);
  const permissions = permissionsRepo(meta);

  async function builtin(slug: string): Promise<Role> {
    const role = await roles.findBySlug(slug);
    if (role === null) throw new Error(`missing built-in role ${slug}`);
    return role;
  }
  const roleSet = {
    admin: await builtin('admin'),
    editor: await builtin('editor'),
    viewer: await builtin('viewer'),
  };

  async function makeUser(name: string, role: Role): Promise<User> {
    const user = await users.create({
      email: `${name.toLowerCase()}@adminium.test`,
      name,
      passwordHash: 'test-hash',
      status: 'active',
    });
    await roles.assignToUser(user.id, role.id);
    return user;
  }
  const userSet = {
    admin: await makeUser('Ava', roleSet.admin),
    editor: await makeUser('Mia', roleSet.editor),
    viewer: await makeUser('Liam', roleSet.viewer),
  };

  const manager = new ConnectionManager({
    meta,
    crypto: dsnCryptoFromSecret(TEST_SECRET),
    registry: opts.registry,
    metaDsn: opts.metaDsn ?? null,
    blockLoopback: false,
  });
  const undoStore = new UndoStore(opts.now ?? Date.now);
  const widgetCache = new WidgetDataCache(opts.now !== undefined ? { now: opts.now } : {});

  const app = await buildServer({ env: makeEnv(), logger: false });
  app.addHook('onRequest', async (request) => {
    const id = request.headers['x-test-user-id'];
    if (typeof id === 'string') {
      const user = await users.findById(id);
      if (user !== null) {
        (request as unknown as { user: { id: string; name: string; email: string } }).user = {
          id: user.id,
          name: user.name,
          email: user.email,
        };
      }
    }
  });
  await app.register(rbacPlugin, { meta, ...(opts.now !== undefined ? { now: opts.now } : {}) });
  await app.register(
    async (api) => {
      await api.register(connectionsRoutes({ manager, meta }));
      await api.register(schemaRoutes({ manager, meta }));
      await api.register(dataRoutes({ manager, meta, undoStore }));
      await api.register(widgetDataRoutes({ manager, meta, cache: widgetCache }));
      if (opts.extraRoutes !== undefined) {
        await opts.extraRoutes(api as unknown as FastifyInstance, { meta, manager });
      }
    },
    { prefix: '/api/v1' },
  );
  app.addHook('onClose', async () => {
    await manager.disposeAll();
  });
  await app.ready();

  return {
    app,
    meta,
    manager,
    undoStore,
    widgetCache,
    users: userSet,
    roles: roleSet,
    async grantTable(role, connectionId, table, actions) {
      await permissions.grant(role.id, 'table', `${connectionId}/${table}`, {
        read: false,
        create: false,
        update: false,
        delete: false,
        export: false,
        import: false,
        ...actions,
      });
    },
  };
}

/** POST /api/v1/connections as the admin; returns the connection id. */
export async function createConnectionViaApi(
  t: DataTestContext,
  dsn: string,
  name = 'northwind',
): Promise<string> {
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/v1/connections',
    headers: asUser(t.users.admin),
    payload: { name, engine: 'postgres', dsn },
  });
  if (res.statusCode !== 201) {
    throw new Error(`connection create failed: ${res.statusCode} ${res.body}`);
  }
  return (res.json() as { id: string }).id;
}

/** POST introspect (sync path in tests — no jobs worker registered). */
export async function introspectViaApi(t: DataTestContext, connectionId: string): Promise<{
  snapshotId: string;
  noop: boolean;
  proposedMasks: number;
  checksum: string;
}> {
  const res = await t.app.inject({
    method: 'POST',
    url: `/api/v1/connections/${connectionId}/introspect`,
    headers: asUser(t.users.admin),
  });
  if (res.statusCode !== 200) {
    throw new Error(`introspect failed: ${res.statusCode} ${res.body}`);
  }
  return res.json() as { snapshotId: string; noop: boolean; proposedMasks: number; checksum: string };
}
