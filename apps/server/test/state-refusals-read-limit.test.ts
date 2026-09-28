// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A role that reads a row's state only in part is told a refused write
 * without it — on every engine, against the whole server:
 *
 *  - a lock or a delete refused by the row's state names neither the state
 *    in its details nor in its words;
 *  - a child refused by its parent's state does not name the parent's state;
 *  - a room move refused by the room's own state (an effect of the stay's
 *    change) is judged as the caller reads the ROOMS: a role that reads the
 *    stay's state but not the room's is not told the room's;
 *  - an import's report of a refused row tells the refusal the same way;
 *  - whoever reads the states is told everything, as before.
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
      {
        ref: 'rooms',
        columns: [id, { ref: 'number', type: 'text', maxLength: 8 }, { ref: 'status', type: 'enum', enum: ['ready', 'occupied', 'cleaning'], default: 'ready' }],
        states: { column: 'status', initial: 'ready', moves: { ready: ['occupied', 'cleaning'], occupied: ['cleaning'], cleaning: ['ready'] } },
      },
      {
        ref: 'stays',
        columns: [
          id,
          { ref: 'room_id', type: 'fk', references: 'rooms', nullable: true },
          { ref: 'arrive', type: 'date' },
          { ref: 'depart', type: 'date' },
          { ref: 'guest_name', type: 'text', maxLength: 80 },
          { ref: 'note', type: 'text', maxLength: 200, nullable: true },
          { ref: 'status', type: 'enum', enum: ['booked', 'in_house', 'departed'], default: 'booked' },
        ],
        states: {
          column: 'status',
          initial: 'booked',
          moves: { booked: ['in_house'], in_house: ['departed'] },
          lock: { when: ['departed'] },
          noDelete: { when: ['departed'] },
          children: { extras: { via: 'stay_id', lock: true } },
          effects: [{ on: { change: 'room_id', in: ['in_house'] }, old: { set: { status: 'cleaning' } }, new: { set: { status: 'occupied' } } }],
        },
      },
      { ref: 'extras', columns: [id, { ref: 'stay_id', type: 'fk', references: 'stays' }, { ref: 'label', type: 'text', maxLength: 40 }] },
    ],
  },
  pages: [{ ref: 'lodge-stays', template: 'page-crud', title: { key: 't', fallback: 'Stays' }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: 'stays' } }],
  roles: [
    // Reads neither the stays' state nor the rooms'.
    {
      key: 'desk',
      name: 'Desk',
      permissions: ['table:@stays:read', 'table:@stays:update', 'table:@stays:delete', 'table:@rooms:read', 'table:@extras:read', 'table:@extras:create', 'page:@lodge-stays:view'],
      limits: {
        stays: { readable: ['arrive', 'depart', 'note'], writable: ['arrive', 'depart', 'note', 'room_id'] },
        rooms: { readable: ['number'] },
      },
    },
    // Reads the stays' state, not the rooms'.
    {
      key: 'keeper',
      name: 'Keeper',
      permissions: ['table:@stays:read', 'table:@stays:update', 'table:@rooms:read', 'page:@lodge-stays:view'],
      limits: {
        stays: { readable: ['arrive', 'depart', 'note', 'status'], writable: ['note', 'room_id'] },
        rooms: { readable: ['number'] },
      },
    },
  ],
  frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
};

async function sourceDatabase(dialect: Dialect, dataDir: string): Promise<{ dsn: string; drop: () => Promise<void> }> {
  const name = `lodge_staterefusal_${randomBytes(4).toString('hex')}`;
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
  rows: (statement: string) => Promise<Record<string, unknown>[]>;
  runJobs: () => Promise<void>;
  dialect: Dialect;
  table: { rooms: string; stays: string; extras: string };
  close: () => Promise<void>;
}

async function stack(dialect: Dialect): Promise<Stack> {
  const dataDir = await mkdtemp(join(tmpdir(), 'state-refusal-read-'));
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
    rows: async (statement) => (await sql.raw<Record<string, unknown>>(statement).execute(handle.db)).rows,
    table: { rooms: idOf('lodge_rooms'), stays: idOf('lodge_stays'), extras: idOf('lodge_extras') },
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


const OWN_WORDS = /departed|cleaning|occupied/;

for (const [dialect, available] of legs) {
  describe.skipIf(!available)(`state refusals told to a role that does not read the state — ${dialect}`, () => {
    let s: Stack;
    let owner: string;
    let desk: { cookie: string; id: string };
    let keeper: { cookie: string; id: string };
    const data = (rest: string) => `/api/v1/data/${s.connectionId}/${rest}`;
    beforeAll(async () => {
      s = await stack(dialect);
      await s.run(`INSERT INTO lodge_rooms (number, status) VALUES ('101', 'occupied')`);
      await s.run(`INSERT INTO lodge_rooms (number, status) VALUES ('102', 'cleaning')`);
      await s.run(`INSERT INTO lodge_rooms (number, status) VALUES ('103', 'occupied')`);
      await s.run(`INSERT INTO lodge_rooms (number, status) VALUES ('104', 'ready')`);
      await s.run(`INSERT INTO lodge_stays (room_id, arrive, depart, guest_name, note, status) VALUES (NULL, '2026-11-01', '2026-11-03', 'Old Guest', 'gone', 'departed')`);
      await s.run(`INSERT INTO lodge_stays (room_id, arrive, depart, guest_name, note, status) VALUES (1, '2026-11-05', '2026-11-08', 'Nia Obi', 'VIP', 'in_house')`);
      owner = await signIn(s.app, 'owner@lodge.dev');
      desk = await person(s, 'desk@lodge.dev', ['desk'], [`table:${s.connectionId}:${s.table.extras}:import`]);
      keeper = await person(s, 'keeper@lodge.dev', ['keeper']);
    }, 180_000);
    afterAll(async () => s?.close());

    type Reply = { statusCode: number; body: string; json: () => unknown };
    const told = (res: Reply) => (res.json() as { error: { code: string; message: string; details: Record<string, unknown> } }).error;
    const refusedWithout = (res: Reply, code: string, hidden: RegExp = OWN_WORDS) => {
      expect(res.statusCode, res.body).toBe(409);
      expect(told(res).code).toBe(code);
      expect(res.body).not.toMatch(hidden);
      return told(res);
    };

    it('control: the desk reads neither state', async () => {
      const stay = await s.app.inject({ method: 'GET', url: data(`${s.table.stays}/1`), headers: { cookie: desk.cookie } });
      expect(stay.statusCode, stay.body).toBe(200);
      expect(stay.body).not.toContain('departed');
      const room = await s.app.inject({ method: 'GET', url: data(`${s.table.rooms}/2`), headers: { cookie: desk.cookie } });
      expect(room.body).not.toContain('cleaning');
    });

    it("a lock or a delete refused by the row's state names the column, never the state", async () => {
      const lock = refusedWithout(await s.app.inject({ method: 'PATCH', url: data(`${s.table.stays}/1`), headers: { cookie: desk.cookie }, payload: { values: { note: 'again' } } }), 'RECORD_LOCKED');
      expect(lock.details).toEqual({ column: 'note' });
      expect(lock.message).toBe('This row cannot be changed now.');
      const gone = refusedWithout(await s.app.inject({ method: 'DELETE', url: data(`${s.table.stays}/1`), headers: { cookie: desk.cookie } }), 'DELETE_REFUSED');
      expect(gone.details).not.toHaveProperty('state');
      expect(gone.message).toBe('This row cannot be deleted now.');
      // Whoever reads the state is told it, as before.
      const whole = await s.app.inject({ method: 'PATCH', url: data(`${s.table.stays}/1`), headers: { cookie: owner }, payload: { values: { note: 'again' } } });
      expect(told(whole)).toMatchObject({ code: 'RECORD_LOCKED', message: expect.stringContaining('departed'), details: { column: 'note', state: 'departed' } });
      const keeperLock = await s.app.inject({ method: 'PATCH', url: data(`${s.table.stays}/1`), headers: { cookie: keeper.cookie }, payload: { values: { note: 'again' } } });
      expect(told(keeperLock)).toMatchObject({ code: 'RECORD_LOCKED', details: { state: 'departed' } });
    });

    it("a child refused by its parent's state does not name the parent's state", async () => {
      const refused = refusedWithout(await s.app.inject({ method: 'POST', url: data(s.table.extras), headers: { cookie: desk.cookie }, payload: { values: { stay_id: 1, label: 'cot' } } }), 'RECORD_LOCKED');
      expect(refused.details).not.toHaveProperty('state');
      expect(refused.message).toBe('This row cannot be changed now.');
    });

    it("a room move refused by the room's own state is told as the caller reads the rooms", async () => {
      for (const who of [desk, keeper]) {
        // Into a room being cleaned: the room's move from cleaning is none.
        const cleaning = refusedWithout(await s.app.inject({ method: 'PATCH', url: data(`${s.table.stays}/2`), headers: { cookie: who.cookie }, payload: { values: { room_id: 2 } } }), 'STATE_MOVE_REFUSED');
        expect(cleaning.message).toBe('This move cannot be made now.');
        expect(cleaning.details).not.toHaveProperty('from');
        // Into a room someone is in.
        const occupied = refusedWithout(await s.app.inject({ method: 'PATCH', url: data(`${s.table.stays}/2`), headers: { cookie: who.cookie }, payload: { values: { room_id: 3 } } }), 'STATE_MOVE_REFUSED');
        expect(occupied.details).toMatchObject({ column: 'room_id', effect: 'new' });
        expect(occupied.details).not.toHaveProperty('from');
        expect(occupied.details).not.toHaveProperty('to');
      }
      // The owner reads the rooms' state: told as before.
      const whole = await s.app.inject({ method: 'PATCH', url: data(`${s.table.stays}/2`), headers: { cookie: owner }, payload: { values: { room_id: 3 } } });
      expect(told(whole)).toMatchObject({ code: 'STATE_MOVE_REFUSED', details: { column: 'room_id', from: 'occupied', to: 'occupied', effect: 'new' } });
      expect(told(whole).message).toContain('occupied');
      const cleaning = await s.app.inject({ method: 'PATCH', url: data(`${s.table.stays}/2`), headers: { cookie: owner }, payload: { values: { room_id: 2 } } });
      expect(told(cleaning)).toMatchObject({ code: 'STATE_MOVE_REFUSED', details: { column: 'status', from: 'cleaning', to: 'occupied' } });
    });

    it("an import's report of a refused row tells the refusal the same way", async () => {
      const up = await s.app.inject({ method: 'POST', url: '/api/v1/imports/upload?filename=extras.csv', headers: { cookie: desk.cookie, 'content-type': 'text/csv' }, payload: 'Stay,Label\n1,cot\n' });
      expect(up.statusCode, up.body).toBe(201);
      const made = await s.app.inject({
        method: 'POST',
        url: '/api/v1/imports',
        headers: { cookie: desk.cookie },
        payload: { fileId: up.json().data.fileId, connectionId: s.connectionId, table: s.table.extras, mapping: { columns: [{ from: 'Stay', to: 'stay_id' }, { from: 'Label', to: 'label' }] }, options: { mode: 'insert' } },
      });
      expect(made.statusCode, made.body).toBe(201);
      const importId = made.json().data.import.id as string;
      const run = await s.app.inject({ method: 'POST', url: `/api/v1/imports/${importId}/run`, headers: { cookie: desk.cookie } });
      expect(run.statusCode, run.body).toBeLessThan(300);
      await s.runJobs();
      const view = await s.app.inject({ method: 'GET', url: `/api/v1/imports/${importId}`, headers: { cookie: desk.cookie } });
      const report = await s.app.inject({ method: 'GET', url: `/api/v1/imports/${importId}/error-report`, headers: { cookie: desk.cookie } });
      const job = await s.meta.db.selectFrom('adminium_jobs').selectAll().execute();
      // Refused, and said without the stay's state wherever the desk may read it.
      expect(view.json().data.stats).toMatchObject({ inserted: 0, skipped: 1 });
      expect(report.body).toContain('This row cannot be changed now.');
      expect(`${view.body}\n${report.body}\n${JSON.stringify(job)}`).not.toContain('departed');
      expect(Number((await s.rows(`select count(*) as n from lodge_extras`))[0]!['n'])).toBe(0);
    });

    it('a room move into a ready room goes through (control)', async () => {
      const res = await s.app.inject({ method: 'PATCH', url: data(`${s.table.stays}/2`), headers: { cookie: desk.cookie }, payload: { values: { room_id: 4 } } });
      expect(res.statusCode, res.body).toBe(200);
      const rooms = await s.rows(`select id, status from lodge_rooms order by id`);
      expect(rooms.map((room) => room['status'])).toEqual(['cleaning', 'cleaning', 'occupied', 'occupied']);
    });
  });
}
