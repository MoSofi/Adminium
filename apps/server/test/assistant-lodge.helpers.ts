// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A whole server over a real source database on each engine, with one small
 * app installed (a guest house: rooms and stays, a page bound to stays, and
 * roles that read and write stays in part). Shared by the assistant's tests
 * that have to be true "as that role, on every engine".
 *
 * Postgres and MySQL gate on TEST_POSTGRES_URL / TEST_MYSQL_URL and skip green
 * without them.
 */
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { sql } from 'kysely';
import { expect } from 'vitest';
import { parseDatabaseModel } from '@adminium/engine';
import { AdapterRegistry, type AdapterProvider } from '@adminium/engine/adapter';
import { createFirstSuperAdmin, createSqliteMetaDb, firstRun, permissionsRepo, rolesRepo, snapshotsRepo, usersRepo, type MetaDb } from '@adminium/meta';

import { sha512Integrity } from '../src/add-ons/store.js';
import type { AdminiumServer } from '../src/app.js';
import { composeServer } from '../src/compose.js';
import { runIntrospection } from '../src/connections/introspect.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { registerAdapters } from '../src/connections/register-adapters.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import { matrixRowsFromGrants } from '../src/rbac/permissions.js';
import { permissionSetAllows, resolvePermissionSet } from '../src/rbac/resolver.js';
import { setUpTurn, type TurnSetup } from '../src/assistant/turn-setup.js';
import type { AssistantContextKey, AssistantHost } from '@adminium/meta';
import { packageTarball } from './app-bundle-helpers.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

export type Dialect = 'sqlite' | 'postgres' | 'mysql';
const POSTGRES_URL = process.env.TEST_POSTGRES_URL;
const MYSQL_URL = process.env.TEST_MYSQL_URL || undefined;

const id = { ref: 'id', type: 'int', role: 'pk' };

export const MANIFEST = {
  kind: 'app',
  manifestVersion: 1,
  key: 'lodge',
  name: 'Lodge',
  version: '1.0.0',
  publisher: { id: 'adminium', name: 'Adminium' },
  license: 'AGPL-3.0-only',
  description: { key: 'd', fallback: 'A guest house.' },
  categories: ['operations'],
  compatibility: { minAdminiumVersion: '0.1.0' },
  requiredSchema: {
    prefixed: true,
    tables: [
      { ref: 'rooms', columns: [id, { ref: 'number', type: 'text', maxLength: 8 }] },
      {
        ref: 'stays',
        columns: [
          id,
          { ref: 'room_id', type: 'fk', references: 'rooms', nullable: true },
          { ref: 'arrive', type: 'date' },
          { ref: 'depart', type: 'date' },
          { ref: 'guest_name', type: 'text', maxLength: 80 },
          { ref: 'note', type: 'text', maxLength: 200, nullable: true },
          // Personal: masked for whoever lacks the right to personal columns, and not searched for them.
          { ref: 'phone', type: 'text', maxLength: 40, nullable: true, rules: { personal: true } },
          { ref: 'total', type: 'int', nullable: true },
          { ref: 'late_until', type: 'text', maxLength: 5, nullable: true },
          { ref: 'status', type: 'enum', enum: ['booked', 'in_house', 'departed'], default: 'booked' },
          { ref: 'checked_in_by', type: 'text', maxLength: 120, nullable: true, rules: { personal: false, stamp: { set: 'user-name', on: { column: 'status', values: ['in_house'] } } } },
        ],
        states: { column: 'status', initial: 'booked', strict: { show: ['guest_name'] }, moves: { booked: ['in_house'], in_house: ['departed'] } },
      },
    ],
  },
  pages: [{ ref: 'lodge-stays', template: 'page-crud', title: { key: 't', fallback: 'Stays' }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: 'stays' } }],
  roles: [
    {
      key: 'housekeeping',
      name: 'Housekeeping',
      permissions: ['table:@stays:read', 'table:@rooms:read', 'page:@lodge-stays:view'],
      limits: { stays: { readable: ['arrive', 'depart', 'late_until'] } },
    },
    // Reads all of stays, and nothing of rooms: limits are per table.
    { key: 'night', name: 'Night desk', permissions: ['table:@stays:read', 'page:@lodge-stays:view'] },
    // May write stays and reads them in part: the author of a rule.
    {
      key: 'planner',
      name: 'Planner',
      permissions: ['table:@stays:read', 'table:@stays:update', 'table:@rooms:read', 'page:@lodge-stays:view'],
      limits: { stays: { readable: ['arrive', 'depart', 'late_until', 'status'] } },
    },
  ],
  frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
};

async function sourceDatabase(dialect: Dialect, dataDir: string): Promise<{ dsn: string; drop: () => Promise<void> }> {
  const name = `lodge_readlimit_${randomBytes(4).toString('hex')}`;
  if (dialect === 'sqlite') {
    const file = join(dataDir, 'source.db');
    new BetterSqlite3(file).close();
    return { dsn: `sqlite:${file}`, drop: async () => undefined };
  }
  if (dialect === 'postgres') {
    const { Client } = await import('pg');
    const admin = new Client({ connectionString: POSTGRES_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    await admin.end();
    const url = new URL(POSTGRES_URL as string);
    url.pathname = `/${name}`;
    return {
      dsn: url.toString(),
      drop: async () => {
        const again = new Client({ connectionString: POSTGRES_URL });
        await again.connect();
        await again.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
        await again.end();
      },
    };
  }
  const mysql = await import('mysql2/promise');
  const admin = await mysql.createConnection(MYSQL_URL as string);
  await admin.query(`CREATE DATABASE \`${name}\``);
  await admin.end();
  const url = new URL(MYSQL_URL as string);
  url.pathname = `/${name}`;
  return {
    dsn: url.toString(),
    drop: async () => {
      const again = await mysql.createConnection(MYSQL_URL as string);
      await again.query(`DROP DATABASE IF EXISTS \`${name}\``);
      await again.end();
    },
  };
}

let signIns = 0;
export async function signIn(app: AdminiumServer, email: string): Promise<string> {
  signIns += 1;
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    remoteAddress: `10.9.${String(Math.floor(signIns / 250))}.${String(signIns % 250)}`,
    payload: { email, password: ADMIN_PASSWORD },
  });
  expect(res.statusCode, res.body).toBe(200);
  return sessionCookie(res.headers['set-cookie']);
}

export interface Stack {
  app: AdminiumServer;
  meta: MetaDb;
  connectionId: string;
  run: (statement: string) => Promise<void>;
  runJobs: () => Promise<void>;
  manager: ConnectionManager;
  dialect: Dialect;
  table: { rooms: string; stays: string };
  /** The id of any table of the source, by its name in the database. */
  tableId: (name: string) => string;
  close: () => Promise<void>;
}

export async function stack(dialect: Dialect, manifest: Record<string, unknown> = MANIFEST): Promise<Stack> {
  const dataDir = await mkdtemp(join(tmpdir(), 'app-role-read-'));
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  await createFirstSuperAdmin(meta, { email: 'owner@lodge.dev', name: 'Owner', passwordHash: await adminPasswordHash() });
  const registry = new AdapterRegistry<AdapterProvider>();
  await registerAdapters(registry);
  const manager = new ConnectionManager({ meta, crypto: dsnCryptoFromSecret(TEST_SECRET), registry, metaDsn: null, blockLoopback: false });
  const source = await sourceDatabase(dialect, dataDir);
  const connection = await manager.connections.create({ name: 'Lodge', engine: dialect, introspectDsn: source.dsn, dataDsn: source.dsn });
  await runIntrospection({ manager, meta, connectionId: connection.id });
  const runService = createRunService({ meta });
  const composed = await composeServer({
    env: makeEnv({ HOST: '127.0.0.1', ADMINIUM_DATA_DIR: dataDir }),
    metaStore: { meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() },
    manager,
    runService,
    applyService: createApplyService({ meta, runService }),
    allowed: { templates: [], widgets: [], widgetContracts: {} },
    logger: false,
    telemetry: false,
  });
  const app = composed.app;
  await app.ready();
  await composed.jobs.worker.stop();
  composed.jobs.scheduler.stop();
  const owner = await signIn(app, 'owner@lodge.dev');
  const tarball = packageTarball({ 'manifest.json': JSON.stringify(manifest), 'staff/index.html': '<!doctype html><html><body></body></html>' });
  const staged = await app.inject({
    method: 'POST',
    url: `/api/v1/apps/upload?expectedSha512=${encodeURIComponent(sha512Integrity(tarball))}`,
    headers: { cookie: owner, 'content-type': 'application/octet-stream' },
    payload: Buffer.from(tarball),
  });
  expect(staged.statusCode, staged.body).toBe(200);
  const installed = await app.inject({ method: 'POST', url: '/api/v1/apps/install', headers: { cookie: owner }, payload: { key: 'lodge', version: '1.0.0', connectionId: connection.id } });
  expect(installed.statusCode, installed.body).toBe(200);
  const model = parseDatabaseModel((await snapshotsRepo(meta).latest(connection.id))!.schema);
  const idOf = (name: string) => model.tables.find((t) => t.name === name)!.id;
  const handle = await manager.data(connection.id);
  return {
    app,
    meta,
    connectionId: connection.id,
    run: async (statement) => {
      await sql.raw(statement).execute(handle.db);
    },
    table: { rooms: idOf('lodge_rooms'), stays: idOf('lodge_stays') },
    tableId: idOf,
    manager,
    runJobs: async () => {
      while ((await composed.jobs.worker.runOnce()) > 0);
    },
    dialect,
    close: async () => {
      await app.close();
      await manager.disposeAll().catch(() => undefined);
      await source.drop();
      await meta.db.destroy();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

/** Someone holding these roles (the app's by key, or a role made here), signed in; their user id too. */
export async function person(s: Stack, email: string, roles: string[], grants: string[] = []): Promise<{ cookie: string; id: string }> {
  const user = await usersRepo(s.meta).create({ email, name: email.split('@')[0]!, passwordHash: await adminPasswordHash() });
  for (const key of roles) {
    const role = (await rolesRepo(s.meta).findBySlug(`lodge-${key}`)) ?? (await rolesRepo(s.meta).findBySlug(key));
    expect(role, key).not.toBeNull();
    await rolesRepo(s.meta).assignToUser(user.id, role!.id);
  }
  if (grants.length > 0) {
    const own = await rolesRepo(s.meta).create({ slug: `own-${user.id.slice(-8)}`, name: 'Own' });
    for (const row of matrixRowsFromGrants(grants).rows) await permissionsRepo(s.meta).grant(own.id, row.resourceKind, row.resourceRef, row.actions as never);
    await rolesRepo(s.meta).assignToUser(user.id, own.id);
  }
  return { cookie: await signIn(s.app, email), id: user.id };
}

export const legs: [Dialect, boolean][] = [
  ['sqlite', true],
  ['postgres', POSTGRES_URL !== undefined],
  ['mysql', MYSQL_URL !== undefined],
];


/** A turn's tools and prompt, as this person, on one page. */
export async function turnAs(s: Stack, userId: string, context: AssistantContextKey, host: Partial<AssistantHost> = {}): Promise<TurnSetup> {
  return setUpTurn({
    meta: s.meta,
    manager: s.manager,
    context,
    host: { connectionIds: [s.connectionId], ...host },
    userId,
    can: async (permission) => permissionSetAllows(await resolvePermissionSet(s.meta, { kind: 'user', id: userId, label: userId }), permission),
  });
}
