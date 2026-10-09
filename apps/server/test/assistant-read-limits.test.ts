// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Milo reads as the person who asked, column limits included, on every engine.
 *
 * A role that is shown three columns of a table gets those three from every
 * reading tool and nothing else: the others are absent from what the schema
 * tool describes, refused by name as a filter, a sort, a group or a measure,
 * absent from the rows and from a sample, and absent from what the turn
 * stores. Each tool is run the way a turn runs it (`setUpTurn(...).execute`),
 * as that role, never as an admin.
 *
 * Also here, because they are the same promise: a drafted rule is checked
 * against what its AUTHOR reads and may write, and the assistant answers a
 * signed-in person, not an API key.
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
import { permissionSetAllows, resolvePermissionSet } from '../src/rbac/resolver.js';
import { setUpTurn, type TurnSetup } from '../src/assistant/turn-setup.js';
import { automationContext } from '../src/assistant/contexts/automation.js';
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
  manager: ConnectionManager;
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
    allowed: { templates: [], widgets: [], widgetContracts: {} },
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

// What the role is not shown. Keys stay readable under a limit (the row's own, and the one to its room): the grid needs them too.
const HIDDEN = ['guest_name', 'note', 'total', 'status', 'checked_in_by'];
const SHOWN = ['arrive', 'depart', 'id', 'late_until', 'room_id'];
const SECRETS = ['Nia Obi', 'VIP', '480', 'Olga Owner'];

for (const [dialect, available] of legs) {
  describe.skipIf(!available)(`Milo reads as the person, column limits included — ${dialect}`, () => {
    let s: Stack;
    let owner: string;
    let hk: { cookie: string; id: string };
    let night: { cookie: string; id: string };
    let planner: { cookie: string; id: string };
    let schemaOf: { stays: string; rooms: string };

    /** A turn's tools, as this person, on the page that offers every reading tool. */
    async function turn(userId: string, context: 'report' | 'automation' = 'report'): Promise<TurnSetup> {
      return setUpTurn({
        meta: s.meta,
        manager: s.manager,
        context,
        host: { connectionIds: [s.connectionId] },
        userId,
        can: async (permission) => permissionSetAllows(await resolvePermissionSet(s.meta, { kind: 'user', id: userId, label: userId }), permission),
      });
    }
    const run = async (setup: TurnSetup, tool: string, args: Record<string, unknown>) => setup.execute({ id: 'c1', tool, args: { connectionId: s.connectionId, ...args } });
    const source = () => {
      const [schema, name] = schemaOf.stays.split('.') as [string, string];
      return { schema, name };
    };
    const expectNoSecret = (value: unknown) => {
      const text = JSON.stringify(value);
      for (const secret of SECRETS) expect(text, secret).not.toContain(secret);
    };

    beforeAll(async () => {
      s = await stack(dialect);
      schemaOf = s.table;
      await s.run(`INSERT INTO lodge_rooms (number) VALUES ('101')`);
      await s.run(`INSERT INTO lodge_stays (room_id, arrive, depart, guest_name, note, total, late_until, status, checked_in_by) VALUES (1, '2026-11-05', '2026-11-08', 'Nia Obi', 'VIP', 480, '12:00', 'in_house', 'Olga Owner')`);
      await s.run(`INSERT INTO lodge_stays (room_id, arrive, depart, guest_name, note, total, late_until, status) VALUES (1, '2026-11-09', '2026-11-11', 'Nia Obi', 'VIP', 480, '14:00', 'booked')`);
      owner = await signIn(s.app, 'owner@lodge.dev');
      hk = await person(s, 'hk@lodge.dev', ['housekeeping']);
      night = await person(s, 'night@lodge.dev', ['night']);
      planner = await person(s, 'planner@lodge.dev', ['planner']);
    }, 180_000);
    afterAll(async () => s?.close());

    it('describes only the columns the role is shown, and no key over a hidden one', async () => {
      const setup = await turn(hk.id);
      const out = await run(setup, 'describe_schema', {});
      const tables = (out.result as { tables: { id: string; columns: { name: string }[]; foreignKeys: { columns: string[] }[] }[] }).tables;
      const stays = tables.find((table) => table.id === s.table.stays)!;
      expect(stays.columns.map((column) => column.name).sort()).toEqual(SHOWN);
      // Exactly the columns the grid's own route gives this person: Milo is shown what the screen shows.
      const listed = await s.app.inject({ method: 'GET', url: `/api/v1/data/${s.connectionId}/${s.table.stays}`, headers: { cookie: hk.cookie } });
      expect(listed.statusCode, listed.body).toBe(200);
      expect(Object.keys((listed.json() as { data: Record<string, unknown>[] }).data[0]!).sort()).toEqual(SHOWN);
      // Limits are per table: rooms is read whole.
      expect(tables.find((table) => table.id === s.table.rooms)!.columns.map((column) => column.name).sort()).toEqual(['id', 'number']);
      // The page's own count is the role's.
      expect((setup.facts as { tables?: number }).tables).toBe(2);
      expect(setup.system).not.toContain('guest_name');
    });

    it('reads rows without the hidden columns, and refuses one named as a column, a filter or a sort', async () => {
      const setup = await turn(hk.id);
      const rows = await run(setup, 'read_rows', { table: s.table.stays });
      expect(rows.error, JSON.stringify(rows.error)).toBeUndefined();
      const data = (rows.result as { rows: Record<string, unknown>[]; total: number }).rows;
      expect(data).toHaveLength(2);
      for (const row of data) expect(Object.keys(row).sort()).toEqual(SHOWN);
      expectNoSecret(rows);

      for (const args of [
        { columns: ['arrive', 'total'] },
        { where: { column: 'guest_name', op: 'eq', value: 'Nia Obi' } },
        { where: { and: [{ column: 'arrive', op: 'gte', value: '2026-01-01' }, { column: 'total', op: 'gt', value: 100 }] } },
        { sort: 'total.desc' },
      ]) {
        const refused = await run(setup, 'read_rows', { table: s.table.stays, ...args });
        expect(refused.error?.code, JSON.stringify({ args, refused })).toBe('COLUMN_FORBIDDEN');
        expect(refused.result).toBeUndefined();
        expectNoSecret(refused);
      }
    });

    it('answers no figure over a hidden column: as a measure, a group, a filter or an order', async () => {
      const setup = await turn(hk.id);
      const ok = await run(setup, 'aggregate', { descriptor: { shape: 'single-metric', source: source(), aggregations: [{ fn: 'count', alias: 'stays' }] } });
      expect(ok.error, JSON.stringify(ok.error)).toBeUndefined();
      for (const descriptor of [
        { shape: 'single-metric', source: source(), aggregations: [{ fn: 'sum', column: 'total', alias: 'money' }] },
        { shape: 'categorical', source: source(), groupBy: ['guest_name'], aggregations: [{ fn: 'count', alias: 'n' }] },
        { shape: 'single-metric', source: source(), aggregations: [{ fn: 'count', alias: 'n' }], filters: { column: 'total', op: 'gt', value: 100 } },
        { shape: 'categorical', source: source(), groupBy: ['arrive'], aggregations: [{ fn: 'count', alias: 'n' }], orderBy: [{ column: 'total', dir: 'desc' }] },
        { shape: 'timeseries', source: source(), bucket: { column: 'arrive', unit: 'month' }, aggregations: [{ fn: 'max', column: 'total', alias: 'top' }] },
      ]) {
        const refused = await run(setup, 'aggregate', { descriptor });
        expect(refused.error, JSON.stringify({ descriptor, refused })).toBeDefined();
        expect(refused.result).toBeUndefined();
        expectNoSecret(refused);
      }
    });

    it('samples a record without the hidden columns, and refuses a pick by one', async () => {
      // The rules page offers the sample tool; the report page does not.
      const setup = await turn(hk.id, 'automation');
      const sample = await run(setup, 'sample_record', { table: s.table.stays });
      expect(Object.keys((sample.result as { record: Record<string, unknown> }).record).sort()).toEqual(SHOWN);
      expectNoSecret(sample);
      const refused = await run(setup, 'sample_record', { table: s.table.stays, where: { column: 'note', op: 'eq', value: 'VIP' } });
      expect(refused.error?.code).toBe('COLUMN_FORBIDDEN');
      expectNoSecret(refused);
    });

    it('counts the table for the connection, since the role does read it', async () => {
      const setup = await turn(hk.id);
      const listed = await run(setup, 'list_connections', {});
      expect((listed.result as { connections: { readableTables: number }[] }).connections[0]?.readableTables).toBe(2);
    });

    it('keeps limits to their own table and their own role', async () => {
      // Reads all of stays, nothing of rooms.
      const setup = await turn(night.id);
      const rows = await run(setup, 'read_rows', { table: s.table.stays, columns: ['guest_name', 'total'] });
      expect((rows.result as { rows: Record<string, unknown>[] }).rows[0]).toMatchObject({ total: 480 });
      const rooms = await run(setup, 'read_rows', { table: s.table.rooms });
      expect(rooms.error?.code).toBe('TABLE_FORBIDDEN');
      // The owner reads every column.
      const all = await run(await turn((await usersRepo(s.meta).findByEmail('owner@lodge.dev'))!.id), 'describe_schema', { tables: [s.table.stays] });
      const names = (all.result as { tables: { columns: { name: string }[] }[] }).tables[0]!.columns.map((column) => column.name);
      for (const hidden of HIDDEN) expect(names).toContain(hidden);
    });

    it('checks a drafted rule against what its author reads and may write', async () => {
      const setup = await turn(planner.id, 'automation');
      const rule = (changed: string, values: Record<string, unknown> = { late_until: '12:00' }) => ({
        name: 'Late leavers',
        trigger: { kind: 'record', event: 'updated', connectionId: s.connectionId, table: s.table.stays, watch: true, changedColumn: changed, when: [{ left: { field: changed }, op: 'not_empty' }] },
        graph: {
          version: 1,
          nodes: [
            { id: 'n1', kind: 'trigger', title: 'A stay changes' },
            { id: 'n2', kind: 'action', title: 'Set the late leaving', onError: false, action: { kind: 'record.update', values } },
          ],
        },
      });
      const accept = (who: TurnSetup, artefact: Record<string, unknown>) => automationContext.acceptArtefact(artefact, who.deps);
      // What the planner reads and may change: accepted.
      const fine = await accept(setup, rule('late_until'));
      expect(fine.ok, JSON.stringify(fine)).toBe(true);
      // A column the planner is not shown: refused, and nothing of it is told.
      const hidden = await accept(setup, rule('total'));
      expect(hidden.ok).toBe(false);
      expect(JSON.stringify(hidden)).toMatch(/total/);
      expectNoSecret(hidden);
      // The same draft from someone who reads stays whole and may not change them: the step's table is not theirs to write.
      const reader = await turn(night.id, 'automation');
      const unwritable = await accept(reader, rule('late_until'));
      expect(unwritable.ok).toBe(false);
      expect(JSON.stringify(unwritable)).toMatch(/do not have access/);
      // And the owner, who reads the column, may watch it.
      const ownerTurn = await turn((await usersRepo(s.meta).findByEmail('owner@lodge.dev'))!.id, 'automation');
      expect((await accept(ownerTurn, rule('total'))).ok).toBe(true);
    });

    it('answers a signed-in person, and tells an API key so', async () => {
      const role = (await rolesRepo(s.meta).findBySlug('admin'))!;
      const made = await s.app.inject({ method: 'POST', url: '/api/v1/api-keys', headers: { cookie: owner }, payload: { name: 'milo key', roleId: role.id } });
      expect(made.statusCode, made.body).toBe(201);
      const auth = { authorization: `Bearer ${String(made.json().key)}` };
      const res = await s.app.inject({ method: 'GET', url: '/api/v1/assistant/availability', headers: auth });
      expect(res.statusCode, res.body).toBe(403);
      expect(res.json().error.details).toMatchObject({ reason: 'api-key' });
      const person = await s.app.inject({ method: 'GET', url: '/api/v1/assistant/availability', headers: { cookie: owner } });
      expect(person.statusCode, person.body).toBe(200);
    });
  });
}
