// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A role that reads a table only in part is told nothing of the rest when a
 * write is refused, checked or matched — on every engine, against the whole
 * server:
 *
 *  - a price check naming a column it does not read is refused by name, as
 *    a masked column is, never answered with the figure (a change with no
 *    values too);
 *  - a strict row named in the state it holds does not repeat stamps or
 *    shown columns it may not read;
 *  - an export asked by a key is refused by name (it is a person's);
 *  - an import may neither match rows by, nor bring in, a column it does not
 *    read (unless its update names it);
 *  - a unique refusal never prints another row's values (Postgres says them).
 */
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
import { packageTarball } from './app-bundle-helpers.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

type Dialect = 'sqlite' | 'postgres' | 'mysql';
const POSTGRES_URL = process.env.TEST_POSTGRES_URL;
const MYSQL_URL = process.env.TEST_MYSQL_URL || undefined;

const id = { ref: 'id', type: 'int', role: 'pk' };

const MANIFEST = {
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
      permissions: ['table:@stays:read', 'table:@stays:export', 'table:@rooms:read', 'page:@lodge-stays:view', 'app:@:staff'],
      limits: { stays: { readable: ['arrive', 'depart', 'late_until'] } },
    },
    {
      key: 'desk',
      name: 'Desk',
      permissions: ['table:@stays:read', 'table:@stays:update', 'table:@rooms:read', 'page:@lodge-stays:view'],
      limits: { stays: { readable: ['arrive', 'depart', 'late_until'], writable: ['arrive', 'depart', 'late_until', 'note'] } },
    },
    // Reads the status, the dates and the late leaving; changes any column it reads.
    {
      key: 'frontdesk',
      name: 'Front desk',
      permissions: ['table:@stays:read', 'table:@stays:update', 'table:@stays:create', 'table:@rooms:read', 'page:@lodge-stays:view'],
      limits: { stays: { readable: ['status', 'arrive', 'depart', 'late_until'] } },
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
async function signIn(app: AdminiumServer, email: string): Promise<string> {
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

interface Stack {
  app: AdminiumServer;
  meta: MetaDb;
  connectionId: string;
  run: (statement: string) => Promise<void>;
  runJobs: () => Promise<void>;
  dialect: Dialect;
  table: { rooms: string; stays: string };
  close: () => Promise<void>;
}

async function stack(dialect: Dialect): Promise<Stack> {
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
    allowed: null,
    logger: false,
    telemetry: false,
  });
  const app = composed.app;
  await app.ready();
  await composed.jobs.worker.stop();
  composed.jobs.scheduler.stop();
  const owner = await signIn(app, 'owner@lodge.dev');
  const tarball = packageTarball({ 'manifest.json': JSON.stringify(MANIFEST), 'staff/index.html': '<!doctype html><html><body></body></html>' });
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
async function person(s: Stack, email: string, roles: string[], grants: string[] = []): Promise<{ cookie: string; id: string }> {
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

const legs: [Dialect, boolean][] = [
  ['sqlite', true],
  ['postgres', POSTGRES_URL !== undefined],
  ['mysql', MYSQL_URL !== undefined],
];

for (const [dialect, available] of legs) {
  describe.skipIf(!available)(`what a role that reads a table in part is told of a refused write — ${dialect}`, () => {
    let s: Stack;
    let owner: string;
    let desk: { cookie: string; id: string };
    let front: { cookie: string; id: string };
    const data = (rest: string) => `/api/v1/data/${s.connectionId}/${rest}`;
    beforeAll(async () => {
      s = await stack(dialect);
      await s.run(`INSERT INTO lodge_rooms (number) VALUES ('101')`);
      await s.run(`INSERT INTO lodge_rooms (number) VALUES ('102')`);
      await s.run(`INSERT INTO lodge_stays (room_id, arrive, depart, guest_name, note, total, late_until, status, checked_in_by) VALUES (1, '2026-11-05', '2026-11-08', 'Nia Obi', 'VIP', 480, '12:00', 'in_house', 'Olga Owner')`);
      await s.run(`INSERT INTO lodge_stays (room_id, arrive, depart, guest_name, note, total, late_until, status) VALUES (2, '2026-11-05', '2026-11-08', 'Nia Obi', 'second', 222, '12:00', 'booked')`);
      owner = await signIn(s.app, 'owner@lodge.dev');
      desk = await person(s, 'dev@lodge.dev', ['desk']);
      front = await person(s, 'fd@lodge.dev', ['frontdesk'], [`table:${s.connectionId}:${s.table.stays}:import`]);
    }, 180_000);
    afterAll(async () => s?.close());

    const hiddenRefusal = (res: { statusCode: number; json: () => unknown; body: string }) => {
      expect(res.statusCode, res.body).toBe(403);
      expect((res.json() as { error: { code: string; details: { reason?: string } } }).error).toMatchObject({ code: 'COLUMN_FORBIDDEN', details: { reason: 'read-limit' } });
    };

    it('refuses a price check on a column the role does not read, with no values or with a change, and keeps nothing', async () => {
      const none = await s.app.inject({ method: 'PATCH', url: data(`${s.table.stays}/1`), headers: { cookie: desk.cookie }, payload: { values: {}, expect: { total: '0', column: 'total' } } });
      hiddenRefusal(none);
      expect(none.body).not.toContain('480');
      const change = await s.app.inject({ method: 'PATCH', url: data(`${s.table.stays}/1`), headers: { cookie: desk.cookie }, payload: { values: { late_until: '13:00' }, expect: { total: '1', column: 'total' } } });
      hiddenRefusal(change);
      expect(change.body).not.toContain('480');
      const created = await s.app.inject({
        method: 'POST',
        url: data(s.table.stays),
        headers: { cookie: front.cookie },
        payload: { values: { arrive: '2026-12-01', depart: '2026-12-02', status: 'booked' }, expect: { total: '0', column: 'total' } },
      });
      hiddenRefusal(created);
      expect((await s.app.inject({ method: 'GET', url: data(`${s.table.stays}/1`), headers: { cookie: owner } })).json().data).toMatchObject({ late_until: '12:00' });
    });

    it('tells a strict row named in its state again without the stamps and shown columns the role does not read', async () => {
      const res = await s.app.inject({ method: 'PATCH', url: data(`${s.table.stays}/1`), headers: { cookie: front.cookie }, payload: { values: { status: 'in_house' } } });
      expect(res.statusCode, res.body).toBe(409);
      expect(res.body).not.toContain('Nia Obi');
      expect(res.body).not.toContain('Olga Owner');
      expect(res.json().error).toMatchObject({ code: 'STATE_UNCHANGED', details: { column: 'status', state: 'in_house' } });
      // Someone who reads the table whole is told as before.
      const whole = await s.app.inject({ method: 'PATCH', url: data(`${s.table.stays}/1`), headers: { cookie: owner }, payload: { values: { status: 'in_house' } } });
      expect(whole.json().error).toMatchObject({ code: 'STATE_UNCHANGED', details: { by: 'Olga Owner', guest_name: 'Nia Obi' } });
    });

    it('refuses an export asked for by a key, by name, and the key reads no hidden column', async () => {
      const role = (await rolesRepo(s.meta).findBySlug('lodge-housekeeping'))!;
      const made = await s.app.inject({ method: 'POST', url: '/api/v1/api-keys', headers: { cookie: owner }, payload: { name: 'hk key', roleId: role.id } });
      expect(made.statusCode, made.body).toBe(201);
      const auth = { authorization: `Bearer ${String(made.json().key)}` };
      const list = await s.app.inject({ method: 'GET', url: data(s.table.stays), headers: auth });
      expect(list.statusCode, list.body).toBe(200);
      expect(list.body).not.toContain('Nia Obi');
      const asked = await s.app.inject({ method: 'POST', url: '/api/v1/exports', headers: auth, payload: { connectionId: s.connectionId, source: { kind: 'table', table: s.table.stays }, format: 'csv' } });
      expect(asked.statusCode, asked.body).toBe(403);
      expect(asked.json().error.code).toBe('FORBIDDEN');
    });

    const upload = async (csv: string) => {
      const up = await s.app.inject({ method: 'POST', url: '/api/v1/imports/upload?filename=x.csv', headers: { cookie: front.cookie, 'content-type': 'text/csv' }, payload: csv });
      expect(up.statusCode, up.body).toBe(201);
      return up.json().data.fileId as string;
    };
    const importAs = (fileId: string, columns: { from: string; to: string }[], options: Record<string, unknown>) =>
      s.app.inject({ method: 'POST', url: '/api/v1/imports', headers: { cookie: front.cookie }, payload: { fileId, connectionId: s.connectionId, table: s.table.stays, mapping: { columns }, options } });

    it('refuses an import that matches rows by, or brings in, a column the role does not read', async () => {
      const fileId = await upload('Guest,Late\nNia Obi,16:00\nNobody Here,16:00\n');
      const matched = await importAs(fileId, [{ from: 'Guest', to: 'guest_name' }, { from: 'Late', to: 'late_until' }], { mode: 'upsert', matchColumn: 'guest_name' });
      hiddenRefusal(matched);
      const brought = await importAs(fileId, [{ from: 'Guest', to: 'guest_name' }, { from: 'Late', to: 'late_until' }], { mode: 'insert' });
      hiddenRefusal(brought);
      // What it reads, it may import.
      const plain = await importAs(await upload('Late\n16:00\n'), [{ from: 'Late', to: 'late_until' }], { mode: 'insert' });
      expect(plain.statusCode, plain.body).not.toBe(403);
      // Nothing was changed by the refused ones.
      expect((await s.app.inject({ method: 'GET', url: data(`${s.table.stays}/1`), headers: { cookie: owner } })).json().data).toMatchObject({ late_until: '12:00' });
    });

    it.skipIf(dialect !== 'postgres')('never prints another row\'s values in a unique refusal, to anyone', async () => {
      await s.run(`CREATE UNIQUE INDEX lodge_stays_room_guest ON lodge_stays (room_id, guest_name)`);
      for (const cookie of [front.cookie, owner]) {
        const res = await s.app.inject({ method: 'PATCH', url: data(`${s.table.stays}/2`), headers: { cookie }, payload: { values: { room_id: 1 } } });
        expect(res.statusCode, res.body).toBe(409);
        expect(res.json().error).toMatchObject({ code: 'UNIQUE_VIOLATION', details: { detail: null } });
        expect(res.body).not.toContain('Nia Obi');
      }
    });
  });
}
