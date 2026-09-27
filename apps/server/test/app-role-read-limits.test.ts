// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app's role whose READ of a table is limited to some columns — a guest
 * house's housekeeping reads a stay's room, its dates and its late leaving,
 * and nothing of its guest, its note or its money — held to it on every
 * staff read path, on every engine, against the whole server: the app is
 * installed through its routes and people sign in with a password.
 *
 * One table of read paths, each asked as housekeeping and — where it tells
 * something — as someone who reads the table whole. The key and the links to
 * other rows always read; a column filtered, sorted or selected by is refused
 * as a masked one is (403 `COLUMN_FORBIDDEN`); a hidden column is not written
 * either unless the role's update names it (`writable`). Roles add up: a
 * plain read of the table from another role lifts the limit.
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
import { createFirstSuperAdmin, createSqliteMetaDb, documentProfilesRepo, firstRun, pagesRepo, permissionsRepo, rolesRepo, snapshotsRepo, usersRepo, type MetaDb } from '@adminium/meta';

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
import { readLimitedFrames } from '../src/realtime/read-frames.js';
import { packageTarball } from './app-bundle-helpers.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

type Dialect = 'sqlite' | 'postgres' | 'mysql';
const POSTGRES_URL = process.env.TEST_POSTGRES_URL;
const MYSQL_URL = process.env.TEST_MYSQL_URL || undefined;

const id = { ref: 'id', type: 'int', role: 'pk' };
const HIDDEN = ['guest_name', 'note', 'total'] as const;

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
        ],
      },
      { ref: 'stay_notes', columns: [id, { ref: 'stay_id', type: 'fk', references: 'stays' }, { ref: 'body', type: 'text', maxLength: 200 }] },
    ],
  },
  pages: [{ ref: 'lodge-stays', template: 'page-crud', title: { key: 't', fallback: 'Stays' }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: 'stays' } }],
  roles: [
    {
      key: 'housekeeping',
      name: 'Housekeeping',
      permissions: ['table:@stays:read', 'table:@stays:export', 'table:@rooms:read', 'table:@stay_notes:read', 'page:@lodge-stays:view', 'app:@:staff'],
      limits: { stays: { readable: ['arrive', 'depart', 'late_until'] } },
    },
    // Moves a stay's dates and leaves a note it may not read back.
    {
      key: 'desk',
      name: 'Desk',
      permissions: ['table:@stays:read', 'table:@stays:update', 'table:@rooms:read', 'page:@lodge-stays:view'],
      limits: { stays: { readable: ['arrive', 'depart', 'late_until'], writable: ['arrive', 'depart', 'late_until', 'note'] } },
    },
    { key: 'manager', name: 'Manager', permissions: ['table:@stays:read', 'table:@rooms:read'] },
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
  table: { rooms: string; stays: string; notes: string };
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
    table: { rooms: idOf('lodge_rooms'), stays: idOf('lodge_stays'), notes: idOf('lodge_stay_notes') },
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

interface Ctx {
  s: Stack;
  hk: { cookie: string; id: string };
  desk: { cookie: string; id: string };
  both: { cookie: string; id: string };
  auditor: { cookie: string; id: string };
  owner: string;
}
type Reply = Awaited<ReturnType<AdminiumServer['inject']>>;
const get = (c: Ctx, cookie: string, url: string) => c.s.app.inject({ method: 'GET', url, headers: { cookie } });
const post = (c: Ctx, cookie: string, url: string, payload: unknown) => c.s.app.inject({ method: 'POST', url, headers: { cookie }, payload: payload as never });
const data = (c: Ctx, rest: string) => `/api/v1/data/${c.s.connectionId}/${rest}`;
const refusedAsMasked = (res: Reply) => {
  expect(res.statusCode, res.body).toBe(403);
  expect(res.json().error).toMatchObject({ code: 'COLUMN_FORBIDDEN' });
};
const withoutHidden = (row: Record<string, unknown>) => {
  for (const column of HIDDEN) expect(row, column).not.toHaveProperty(column);
};
const card = (c: Ctx, cookie: string, select: string[]) =>
  post(c, cookie, '/api/v1/widget-data/query', { descriptor: { connectionId: c.s.connectionId, source: { name: c.s.table.stays.split('.').at(-1)!, ...(c.s.table.stays.includes('.') ? { schema: c.s.table.stays.split('.')[0] } : {}) }, shape: 'record-list', select } });

/** Every staff read path, as housekeeping (and, where it tells something, as a reader of the whole table). */
const PATHS: [string, (c: Ctx) => Promise<void>][] = [
  [
    'a list shows the key, the links and the columns the role reads — nothing else',
    async (c) => {
      const res = await get(c, c.hk.cookie, data(c, c.s.table.stays));
      expect(res.statusCode, res.body).toBe(200);
      const row = res.json().data[0];
      expect(row).toMatchObject({ id: 1, room_id: 1, late_until: '14:00' });
      withoutHidden(row);
      expect((await get(c, c.both.cookie, data(c, c.s.table.stays))).json().data[0]).toMatchObject({ guest_name: 'Nia Obi', total: 480 });
    },
  ],
  [
    'one record the same',
    async (c) => {
      const res = await get(c, c.hk.cookie, data(c, `${c.s.table.stays}/1`));
      expect(res.statusCode, res.body).toBe(200);
      withoutHidden(res.json().data);
    },
  ],
  ['a select of a hidden column is refused as a masked one', async (c) => refusedAsMasked(await get(c, c.hk.cookie, data(c, `${c.s.table.stays}?select=id,total`)))],
  [
    'a filter by one is refused',
    async (c) => refusedAsMasked(await get(c, c.hk.cookie, data(c, `${c.s.table.stays}?where=${encodeURIComponent(JSON.stringify({ column: 'total', op: 'gt', value: 100 }))}`))),
  ],
  ['a sort by one is refused', async (c) => refusedAsMasked(await get(c, c.hk.cookie, data(c, `${c.s.table.stays}?order=total.desc`)))],
  [
    'a quick search never matches one',
    async (c) => {
      expect((await get(c, c.hk.cookie, data(c, `${c.s.table.stays}?q=Nia`))).json().data).toEqual([]);
      expect((await get(c, c.both.cookie, data(c, `${c.s.table.stays}?q=Nia`))).json().data).toHaveLength(1);
    },
  ],
  [
    "a lookup into one, from another table, is empty and said so",
    async (c) => {
      const res = await get(c, c.hk.cookie, data(c, `${c.s.table.notes}?lookup=${encodeURIComponent('guest:stay_id.guest_name')}`));
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().data[0]).toMatchObject({ guest: null });
      expect(res.json().data[0]._masked).toContain('guest');
      expect((await get(c, c.both.cookie, data(c, `${c.s.table.notes}?lookup=${encodeURIComponent('guest:stay_id.guest_name')}`))).json().data[0]).toMatchObject({ guest: 'Nia Obi' });
    },
  ],
  [
    'a total over one, listed with another table, is empty and said so',
    async (c) => {
      const compute = encodeURIComponent(JSON.stringify({ measures: [{ id: 'takings', table: c.s.table.stays, fkColumn: 'room_id', fn: 'sum', of: { terms: [{ sign: 'plus', factors: ['total'] }] } }] }));
      const res = await get(c, c.hk.cookie, data(c, `${c.s.table.rooms}?select=id&compute=${compute}`));
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().data[0].takings).toBeNull();
      expect(res.json().data[0]._masked).toContain('takings');
    },
  ],
  [
    'the search box finds no stay by a hidden column',
    async (c) => {
      const res = await get(c, c.hk.cookie, '/api/v1/search?q=Nia%20Obi');
      expect(res.statusCode, res.body).toBe(200);
      expect(JSON.stringify(res.json())).not.toContain('Nia Obi');
    },
  ],
  [
    'a dashboard card refuses one, and shows the rest',
    async (c) => {
      expect((await card(c, c.hk.cookie, ['id', 'total'])).json().error?.code).toBe('COLUMN_FORBIDDEN');
      const shown = await card(c, c.hk.cookie, ['id', 'arrive']);
      expect(shown.statusCode, shown.body).toBe(200);
      expect(JSON.stringify(shown.json())).not.toContain('Nia Obi');
    },
  ],
  [
    'an export neither previews nor writes one',
    async (c) => {
      const asked = await post(c, c.hk.cookie, '/api/v1/exports/preview', {
        connectionId: c.s.connectionId,
        source: { kind: 'table', table: c.s.table.stays, columns: [{ name: 'id', label: 'Stay' }, { name: 'total', label: 'Total' }] },
        format: 'csv',
        sampleRows: 5,
      });
      refusedAsMasked(asked);
      const whole = await post(c, c.hk.cookie, '/api/v1/exports/preview', { connectionId: c.s.connectionId, source: { kind: 'table', table: c.s.table.stays }, format: 'csv', sampleRows: 5 });
      expect(whole.statusCode, whole.body).toBe(200);
      expect(JSON.stringify(whole.json())).not.toContain('Nia Obi');
      expect(JSON.stringify(whole.json())).not.toContain('VIP');
    },
  ],
  [
    "the page's form and grid carry no hidden column",
    async (c) => {
      const page = (await pagesRepo(c.s.meta).findBySlug(c.s.connectionId, 'lodge-stays'))!;
      const res = await get(c, c.hk.cookie, `/api/v1/pages/${page.id}`);
      expect(res.statusCode, res.body).toBe(200);
      const names = (res.json().columnFacts?.columns ?? []).map((column: { spec: { name: string } }) => column.spec.name);
      expect(names).toContain('arrive');
      for (const column of HIDDEN) expect(names).not.toContain(column);
      expect(JSON.stringify(res.json().data)).not.toContain('"guest_name"');
      const whole = (await get(c, c.both.cookie, `/api/v1/pages/${page.id}`)).json();
      expect(whole.columnFacts.columns.map((column: { spec: { name: string } }) => column.spec.name)).toContain('guest_name');
    },
  ],
  [
    "the audit log's before and after of a stay",
    async (c) => {
      const res = await get(c, c.auditor.cookie, `/api/v1/audit?entityTable=${encodeURIComponent(c.s.table.stays)}`);
      expect(res.statusCode, res.body).toBe(200);
      const entry = res.json().entries.find((one: { action: string }) => one.action === 'record.update');
      expect(entry).toBeDefined();
      withoutHidden(entry.changes.after);
      withoutHidden(entry.changes.before);
      expect(entry.changes.after).toMatchObject({ late_until: '14:00' });
    },
  ],
  [
    "the live frames of the table, per subscriber",
    async (c) => {
      const frames = readLimitedFrames(c.s.meta);
      const channel = `widget-data:${c.s.connectionId}:${c.s.table.stays}`;
      const event = { channel, type: 'record.update', ts: '', data: { type: 'record.update', pk: { id: 1 }, row: { id: 1, room_id: 1, arrive: '2026-11-05', guest_name: 'Nia Obi', note: 'VIP', total: 480, late_until: '14:00' } } };
      const hk = await frames({ id: c.hk.id }, channel);
      expect(hk).not.toBeNull();
      const shown = hk!(event).data as { row: Record<string, unknown> };
      withoutHidden(shown.row);
      expect(shown.row).toMatchObject({ id: 1, room_id: 1, late_until: '14:00' });
      expect(await frames({ id: c.both.id }, channel)).toBeNull();
    },
  ],
  [
    'a document that prints one is not drawn',
    async (c) => {
      const profile = await documentProfilesRepo(c.s.meta).create({ addOnKey: 'invoices', kind: 'card', name: 'Stay card', connectionId: c.s.connectionId, table: c.s.table.stays, mapping: { guest: { column: 'guest_name' } } });
      const res = await post(c, c.hk.cookie, '/api/v1/documents/render', { profileId: profile.id, pk: { id: 1 } });
      refusedAsMasked(res);
    },
  ],
  [
    "a hidden column is not written, unless the role's update names it; the reply shows none",
    async (c) => {
      const patch = (values: Record<string, unknown>) => c.s.app.inject({ method: 'PATCH', url: data(c, `${c.s.table.stays}/1`), headers: { cookie: c.desk.cookie }, payload: { values } });
      refusedAsMasked(await patch({ total: 1 }));
      refusedAsMasked(await patch({ guest_name: 'Someone' }));
      const note = await patch({ note: 'late arrival' });
      expect(note.statusCode, note.body).toBe(200);
      withoutHidden(note.json().data);
      const bulk = await post(c, c.desk.cookie, data(c, `${c.s.table.stays}/bulk`), { action: 'update', ids: [1], values: { total: 2 } });
      refusedAsMasked(bulk);
      const quoted = await post(c, c.desk.cookie, data(c, `${c.s.table.stays}/1/dry-run`), { values: { depart: '2026-11-09' } });
      expect(quoted.statusCode, quoted.body).toBe(200);
      withoutHidden(quoted.json().data);
      refusedAsMasked(await post(c, c.desk.cookie, data(c, `${c.s.table.stays}/1/dry-run`), { values: { total: 3 } }));
    },
  ],
  [
    "the install keeps the limit on the role's row, and a save of the role's grants keeps it there",
    async (c) => {
      const role = (await rolesRepo(c.s.meta).findBySlug('lodge-housekeeping'))!;
      const limitOf = async () => (await permissionsRepo(c.s.meta).listForRole(role.id)).find((row) => row.resourceRef.endsWith(c.s.table.stays))?.actions as { readLimit?: unknown } | undefined;
      expect((await limitOf())?.readLimit).toEqual({ readable: ['arrive', 'depart', 'late_until'] });
      const current = (await get(c, c.owner, `/api/v1/roles/${role.id}/permissions`)).json() as { grants: string[] };
      expect(current.grants.length).toBeGreaterThan(0);
      const saved = await c.s.app.inject({ method: 'PUT', url: `/api/v1/roles/${role.id}/permissions`, headers: { cookie: c.owner }, payload: { grants: current.grants } });
      expect(saved.statusCode, saved.body).toBe(200);
      expect((await limitOf())?.readLimit).toEqual({ readable: ['arrive', 'depart', 'late_until'] });
    },
  ],
];

for (const [dialect, available] of legs) {
  describe.skipIf(!available)(`a role that reads a table in part, on every staff read path — ${dialect}`, () => {
    const c = {} as Ctx;
    beforeAll(async () => {
      c.s = await stack(dialect);
      await c.s.run(`INSERT INTO lodge_rooms (number) VALUES ('101')`);
      await c.s.run(`INSERT INTO lodge_stays (room_id, arrive, depart, guest_name, note, total, late_until) VALUES (1, '2026-11-05', '2026-11-08', 'Nia Obi', 'VIP', 480, '12:00')`);
      await c.s.run(`INSERT INTO lodge_stay_notes (stay_id, body) VALUES (1, 'extra towels')`);
      c.owner = await signIn(c.s.app, 'owner@lodge.dev');
      c.hk = await person(c.s, 'hana@lodge.dev', ['housekeeping']);
      c.desk = await person(c.s, 'dev@lodge.dev', ['desk']);
      c.both = await person(c.s, 'mo@lodge.dev', ['housekeeping', 'manager']);
      c.auditor = await person(c.s, 'aud@lodge.dev', ['housekeeping'], ['system:audit:read']);
      // A change the audit log keeps before and after images of.
      const changed = await c.s.app.inject({ method: 'PATCH', url: data(c, `${c.s.table.stays}/1`), headers: { cookie: c.owner }, payload: { values: { late_until: '14:00' } } });
      expect(changed.statusCode, changed.body).toBe(200);
    }, 180_000);
    afterAll(async () => c.s?.close());

    it.each(PATHS)('%s', async (_name, check) => {
      await check(c);
    });
  });
}
