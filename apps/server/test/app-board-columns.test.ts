// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A board whose columns are the rows of a table, on every engine, through the
 * whole server: a sales app whose deals move through stages its team keeps in
 * a table of their own.
 *
 * What is on trial: the app installs and its page's stored board carries the
 * columns the manifest named; the stages are read in their order — an empty
 * one too — each with a count and a sum of the deals in it, over the deals
 * the READER reaches; a stage added to the table is a column of the next
 * read, with no update of the app; and a card's move is the ordinary save,
 * refused with its reason where a role's rule closes the deal, and not found
 * where the deal is somebody else's. And a board of some of its rows (`only`:
 * the open deals): the cards it lists and each stage's count and totals are of
 * those rows alike, a rep's of their own — and a reader who may not read the
 * column the board chooses by is told so, never handed a figure.
 *
 * Nothing is faked below the HTTP routes: the app is uploaded and installed
 * through its routes, people sign in with a password, and every read and
 * write goes through the data API the board calls.
 */
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { parseDatabaseModel } from '@adminium/engine';
import { AdapterRegistry, type AdapterProvider } from '@adminium/engine/adapter';
import { createFirstSuperAdmin, createSqliteMetaDb, firstRun, pagesRepo, rolesRepo, snapshotsRepo, teamsRepo, usersRepo, type MetaDb } from '@adminium/meta';

import { sha512Integrity } from '../src/add-ons/store.js';
import type { AdminiumServer } from '../src/app.js';
import { composeServer } from '../src/compose.js';
import { runIntrospection } from '../src/connections/introspect.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { registerAdapters } from '../src/connections/register-adapters.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import { permissionSetAllows, resolvePermissionSet } from '../src/rbac/resolver.js';
import { authorizeChannel, widgetDataChannel, type RealtimeEvent } from '../src/realtime/hub.js';
import { orderedSink, readLimitedFrames } from '../src/realtime/read-frames.js';
import { packageTarball } from './app-bundle-helpers.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

// `config.board` is read from 0.3.28 on, and the upload door refuses an app newer than the server: this server says it is that release.
vi.mock('../src/version.js', async (original) => ({ ...(await original<typeof import('../src/version.js')>()), APP_VERSION: '0.3.28' }));

type Dialect = 'sqlite' | 'postgres' | 'mysql';
const POSTGRES_URL = process.env.TEST_POSTGRES_URL || undefined;
const MYSQL_URL = process.env.TEST_MYSQL_URL || undefined;
const ENGINES: [Dialect, boolean][] = [
  ['sqlite', true],
  ['postgres', POSTGRES_URL !== undefined],
  ['mysql', MYSQL_URL !== undefined],
];

const id = { ref: 'id', type: 'int', role: 'pk' };

/** A sales desk: a rep works their own deals, a manager their team's; a won deal is closed to a rep. */
const MANIFEST = {
  kind: 'app',
  manifestVersion: 1,
  key: 'crm',
  name: 'Sales',
  version: '1.0.0',
  publisher: { id: 'adminium', name: 'Adminium' },
  license: 'AGPL-3.0-only',
  description: { key: 'd', fallback: 'A sales desk.' },
  categories: ['operations'],
  compatibility: { minAdminiumVersion: '0.3.28' },
  requiredSchema: {
    prefixed: true,
    tables: [
      { ref: 'stages', columns: [id, { ref: 'name', type: 'text', maxLength: 80 }, { ref: 'position', type: 'int' }] },
      {
        ref: 'deals',
        columns: [
          id,
          { ref: 'name', type: 'text', maxLength: 120 },
          { ref: 'stage_id', type: 'fk', references: 'stages', nullable: true },
          { ref: 'amount', type: 'money', nullable: true },
          { ref: 'state', type: 'enum', enum: ['open', 'won', 'lost'], default: 'open' },
          { ref: 'owner_id', type: 'text', maxLength: 36, nullable: true, rules: { staff: true } },
          { ref: 'hot', type: 'bool', default: false },
          // Personal data: masked for whoever does not hold the grant to read it.
          { ref: 'region', type: 'text', maxLength: 40, nullable: true, rules: { personal: true } },
        ],
        states: { column: 'state', initial: 'open', moves: { open: ['won', 'lost'], won: ['open'], lost: ['open'] } },
        belongs: [{ column: 'owner_id', set: 'team' }],
        indexes: [['owner_id'], ['stage_id']],
      },
      // Tasks by a phase a task may not have yet: the rows with none are on no column.
      { ref: 'tasks', columns: [id, { ref: 'name', type: 'text', maxLength: 80 }, { ref: 'phase', type: 'enum', enum: ['todo', 'doing', 'done'], nullable: true }] },
    ],
  },
  pages: [
    {
      ref: 'crm-pipeline',
      template: 'page-board',
      title: { key: 'p', fallback: 'Pipeline' },
      nav: { group: 'records', icon: 'square-kanban', order: 1 },
      bindings: { rows: 'deals' },
      config: {
        board: {
          column: 'stage_id',
          columnsFrom: { table: 'stages', label: 'name', order: 'position' },
          title: 'name',
          totals: [{ column: 'amount', fn: 'sum' }],
        },
      },
    },
    // The same deals by a choice column the app names: its values are no workflow Adminium would guess a board from.
    {
      ref: 'crm-outcomes',
      template: 'page-board',
      title: { key: 'o', fallback: 'Outcomes' },
      nav: { group: 'records', icon: 'square-kanban', order: 2 },
      bindings: { rows: 'deals' },
      config: { board: { column: 'state', title: 'name', totals: [{ column: 'amount', fn: 'sum' }] } },
    },
    // The pipeline as a sales team means it: the open deals only.
    {
      ref: 'crm-open',
      template: 'page-board',
      title: { key: 'n', fallback: 'Open pipeline' },
      nav: { group: 'records', icon: 'square-kanban', order: 3 },
      bindings: { rows: 'deals' },
      config: {
        board: { column: 'stage_id', columnsFrom: { table: 'stages', label: 'name', order: 'position' }, title: 'name', totals: [{ column: 'amount', fn: 'sum' }], only: { state: 'open' } },
      },
    },
    // An enum board of some of its rows: the hot deals by outcome.
    {
      ref: 'crm-hot',
      template: 'page-board',
      title: { key: 'h', fallback: 'Hot deals' },
      nav: { group: 'records', icon: 'square-kanban', order: 4 },
      bindings: { rows: 'deals' },
      config: { board: { column: 'state', title: 'name', totals: [{ column: 'amount', fn: 'sum' }], only: { hot: true } } },
    },
    {
      ref: 'crm-tasks',
      template: 'page-board',
      title: { key: 't', fallback: 'Tasks' },
      nav: { group: 'records', icon: 'square-kanban', order: 5 },
      bindings: { rows: 'tasks' },
      config: { board: { column: 'phase', title: 'name' } },
    },
  ],
  roles: [
    {
      key: 'rep',
      name: 'Sales rep',
      permissions: ['table:@deals:read', 'table:@deals:update', 'table:@stages:read', 'page:@crm-pipeline:view', 'page:@crm-outcomes:view', 'page:@crm-open:view', 'page:@crm-hot:view'],
      // Their own deals, and a deal only while it is open: a won deal is not theirs to move.
      limits: { deals: { rows: { read: { reach: 'own' }, update: { reach: 'own' } }, writable: ['stage_id', 'name', 'amount'], writableFrom: { state: ['open'] } } },
    },
    {
      key: 'manager',
      name: 'Sales manager',
      permissions: ['table:@deals:read', 'table:@deals:update', 'table:@stages:read', 'table:@stages:create', 'page:@crm-pipeline:view', 'page:@crm-outcomes:view', 'page:@crm-open:view', 'page:@crm-hot:view'],
      limits: { deals: { rows: { read: { reach: 'team' }, update: { reach: 'team' } } } },
    },
    {
      // Reads every deal, but not whether it is open, won or lost: `state` is not among the columns shown to them.
      key: 'clerk',
      name: 'Clerk',
      permissions: ['table:@deals:read', 'table:@stages:read', 'page:@crm-open:view'],
      limits: { deals: { readable: ['id', 'name', 'stage_id', 'amount'] } },
    },
    {
      // Reads the stages, and no deal at all.
      key: 'porter',
      name: 'Porter',
      permissions: ['table:@stages:read'],
    },
    {
      // Reads every deal, and not the table the pipeline's columns are the rows of.
      key: 'teller',
      name: 'Teller',
      permissions: ['table:@deals:read'],
    },
  ],
  frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
};

interface Stack {
  app: AdminiumServer;
  meta: MetaDb;
  manager: ConnectionManager;
  connectionId: string;
  run: (statement: string) => Promise<void>;
  rows: (statement: string) => Promise<Record<string, unknown>[]>;
  table: { stages: string; deals: string };
  /** What the install said of the app's pages. */
  warnings: unknown[];
  close: () => Promise<void>;
}

async function sourceDatabase(dialect: Dialect, dataDir: string): Promise<{ dsn: string; drop: () => Promise<void> }> {
  const name = `adminium_board_${randomBytes(4).toString('hex')}`;
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

/** Each sign-in from an address of its own: the login bucket allows five per address. */
let signIns = 0;
async function signIn(app: AdminiumServer, email: string): Promise<string> {
  signIns += 1;
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.9.0.${String(signIns % 250)}`, payload: { email, password: ADMIN_PASSWORD } });
  expect(res.statusCode, res.body).toBe(200);
  return sessionCookie(res.headers['set-cookie']);
}

/** The whole server over a fresh store and a fresh source database, with the app installed. */
async function stack(dialect: Dialect): Promise<Stack> {
  const dataDir = await mkdtemp(join(tmpdir(), 'app-board-'));
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  await createFirstSuperAdmin(meta, { email: 'owner@firm.test', name: 'Owner', passwordHash: await adminPasswordHash() });
  const registry = new AdapterRegistry<AdapterProvider>();
  await registerAdapters(registry);
  const manager = new ConnectionManager({ meta, crypto: dsnCryptoFromSecret(TEST_SECRET), registry, metaDsn: null, blockLoopback: false });
  const source = await sourceDatabase(dialect, dataDir);
  const connection = await manager.connections.create({ name: 'Firm', engine: dialect, introspectDsn: source.dsn, dataDsn: source.dsn });
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

  const owner = await signIn(app, 'owner@firm.test');
  const tarball = packageTarball({ 'manifest.json': JSON.stringify(MANIFEST), 'staff/index.html': '<!doctype html><html><body data-app="crm"></body></html>' });
  const staged = await app.inject({
    method: 'POST',
    url: `/api/v1/apps/upload?expectedSha512=${encodeURIComponent(sha512Integrity(tarball))}`,
    headers: { cookie: owner, 'content-type': 'application/octet-stream' },
    payload: Buffer.from(tarball),
  });
  expect(staged.statusCode, staged.body).toBe(200);
  const installed = await app.inject({ method: 'POST', url: '/api/v1/apps/install', headers: { cookie: owner }, payload: { key: 'crm', version: '1.0.0', connectionId: connection.id } });
  expect(installed.statusCode, installed.body).toBe(200);

  const model = parseDatabaseModel((await snapshotsRepo(meta).latest(connection.id))!.schema);
  const idOf = (name: string) => model.tables.find((t) => t.name === name)!.id;
  const handle = await manager.data(connection.id);
  return {
    app,
    meta,
    manager,
    connectionId: connection.id,
    run: async (statement) => {
      await sql.raw(statement).execute(handle.db);
    },
    rows: async (statement) => (await sql.raw<Record<string, unknown>>(statement).execute(handle.db)).rows,
    table: { stages: idOf('crm_stages'), deals: idOf('crm_deals') },
    warnings: (installed.json() as { pages?: { warnings?: unknown[] } }).pages?.warnings ?? [],
    close: async () => {
      await app.close();
      await manager.disposeAll().catch(() => undefined);
      await source.drop();
      await meta.db.destroy();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`a board whose columns are rows of a table [${dialect}]`, () => {
    let s: Stack;
    const people = {} as Record<'mara' | 'dana' | 'omar' | 'cleo' | 'pat' | 'tess' | 'owner', { id: string; cookie: string }>;
    const data = (path: string) => `/api/v1/data/${s.connectionId}/${path}`;
    const get = (who: keyof typeof people, path: string) => s.app.inject({ method: 'GET', url: data(path), headers: { cookie: people[who].cookie } });
    const patch = (who: keyof typeof people, path: string, values: Record<string, unknown>) =>
      s.app.inject({ method: 'PATCH', url: data(path), headers: { cookie: people[who].cookie }, payload: { values } });
    /** The read the board makes for its columns: the stages in order, each with a count and a sum of the deals in it. */
    const columns = async (who: keyof typeof people): Promise<[string, number, number][]> => {
      const compute = encodeURIComponent(
        JSON.stringify({
          measures: [
            { id: 'board_count', table: s.table.deals, fkColumn: 'stage_id', fn: 'count' },
            { id: 'board_total_0', table: s.table.deals, fkColumn: 'stage_id', fn: 'sum', of: { terms: [{ sign: 'plus', factors: ['amount'] }] } },
          ],
        }),
      );
      const res = await get(who, `${s.table.stages}?select=id,name&order=position.asc&limit=100&compute=${compute}`);
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as { data: Record<string, unknown>[] }).data.map((row) => [String(row['name']), Number(row['board_count']), Number(row['board_total_0'])]);
    };

    beforeAll(async () => {
      s = await stack(dialect);
      const users = usersRepo(s.meta);
      const hash = await adminPasswordHash();
      const roles = { mara: 'crm-manager', dana: 'crm-rep', omar: 'crm-rep', cleo: 'crm-clerk', pat: 'crm-porter', tess: 'crm-teller' } as const;
      for (const name of ['mara', 'dana', 'omar', 'cleo', 'pat', 'tess'] as const) {
        const user = await users.create({ email: `${name}@firm.test`, name, passwordHash: hash });
        await rolesRepo(s.meta).assignToUser(user.id, (await rolesRepo(s.meta).findBySlug(roles[name]))!.id);
        people[name] = { id: user.id, cookie: '' };
      }
      const north = await teamsRepo(s.meta).create('North');
      await teamsRepo(s.meta).setMember(north.id, people.mara.id, true);
      await teamsRepo(s.meta).setMember(north.id, people.dana.id, false);
      await teamsRepo(s.meta).setMember(north.id, people.omar.id, false);
      for (const name of ['mara', 'dana', 'omar', 'cleo', 'pat', 'tess'] as const) people[name].cookie = await signIn(s.app, `${name}@firm.test`);
      // The owner holds every grant, the one to read personal data among them.
      people.owner = { id: '', cookie: await signIn(s.app, 'owner@firm.test') };
      // The stages' order is their `position`, not their key: Qualified (2) comes before Lead (1)'s key order would put it.
      // Keyed by the database (1 to 4), so the key it gives the next stage is free on every engine.
      for (const [name, position] of [['Lead', 1], ['Proposal', 3], ['Qualified', 2], ['Closing', 4]] as const) await s.run(`INSERT INTO crm_stages (name, position) VALUES ('${name}', ${String(position)})`);
      const deal = (key: number, owner: string | null, stage: number | null, amount: number, state: string) =>
        `(${String(key)}, 'Deal ${String(key)}', ${stage === null ? 'NULL' : String(stage)}, ${String(amount)}, '${state}', ${owner === null ? 'NULL' : `'${owner}'`})`;
      await s.run(
        `INSERT INTO crm_deals (id, name, stage_id, amount, state, owner_id) VALUES ${[
          deal(1, people.dana.id, 1, 100, 'open'),
          deal(2, people.dana.id, 2, 300, 'won'),
          deal(3, people.omar.id, 1, 50, 'open'),
          deal(4, people.omar.id, 3, 70, 'open'),
          deal(5, people.dana.id, null, 20, 'open'),
          // Nobody's: no rep's, and no team's.
          deal(6, null, 1, 1000, 'open'),
        ].join(', ')}`,
      );
      // Deals 1, 2 and 4 are hot; deals 1 and 3 are in the north.
      await s.run(`UPDATE crm_deals SET hot = ${dialect === 'postgres' ? 'TRUE' : '1'} WHERE id IN (1, 2, 4)`);
      await s.run(`UPDATE crm_deals SET region = 'north' WHERE id IN (1, 3)`);
      // Tasks: five to do, three being done, one done — and four with no phase yet.
      const phases = [...Array<string>(5).fill("'todo'"), ...Array<string>(3).fill("'doing'"), "'done'", ...Array<string>(4).fill('NULL')];
      await s.run(`INSERT INTO crm_tasks (name, phase) VALUES ${phases.map((phase, index) => `('Task ${String(index + 1)}', ${phase})`).join(', ')}`);
    }, 180_000);
    afterAll(async () => {
      await s?.close();
    });

    it('installs, and the page it stores is a board that takes its columns from the stages', async () => {
      expect(s.warnings).toEqual([]);
      const page = (await pagesRepo(s.meta).findBySlug(s.connectionId, 'crm-pipeline'))!;
      expect(page.type).toBe('page-board');
      const stored = page.config as { source: { table: string }; config: { layout: { items: { widget: string; config: Record<string, unknown> }[] } } };
      expect(stored.source.table).toBe(s.table.deals);
      const board = stored.config.layout.items.find((item) => item.widget === 'kanban-board');
      expect(board?.config).toMatchObject({
        statusColumn: 'stage_id',
        // The real table, by the id the data routes take; the column of it a deal's link holds.
        columnsFrom: { table: s.table.stages, key: 'id', label: 'name', order: 'position' },
        titleColumn: 'name',
        totals: [{ column: 'amount', fn: 'sum' }],
      });
      expect((board?.config['binding'] as { select: string[] }).select).toEqual(expect.arrayContaining(['stage_id', 'name', 'amount']));
    });

    it('answers every stage in its order, an empty one too, with a count and a sum of the deals a reader reaches', async () => {
      // A manager: the team's deals (1–5); deal 6 is nobody's.
      expect(await columns('mara')).toEqual([
        ['Lead', 2, 150],
        ['Qualified', 1, 70],
        ['Proposal', 1, 300],
        ['Closing', 0, 0],
      ]);
      // A rep: their own.
      expect(await columns('dana')).toEqual([
        ['Lead', 1, 100],
        ['Qualified', 0, 0],
        ['Proposal', 1, 300],
        ['Closing', 0, 0],
      ]);
      expect(await columns('omar')).toEqual([
        ['Lead', 1, 50],
        ['Qualified', 1, 70],
        ['Proposal', 0, 0],
        ['Closing', 0, 0],
      ]);
    });

    it('the cards the board lists carry the link as the stage row’s own key', async () => {
      const page = (await pagesRepo(s.meta).findBySlug(s.connectionId, 'crm-pipeline'))!;
      const stored = page.config as { config: { layout: { items: { i: string; widget: string; config: Record<string, unknown> }[] } } };
      const board = stored.config.layout.items.find((item) => item.widget === 'kanban-board')!;
      const res = await s.app.inject({
        method: 'POST',
        url: '/api/v1/widget-data/batch',
        headers: { cookie: people.dana.cookie },
        payload: { requests: [{ instanceId: board.i, descriptor: board.config['binding'] }], params: {} },
      });
      expect(res.statusCode, res.body).toBe(200);
      const result = (res.json() as { results: Record<string, { ok: boolean; result: { rows?: Record<string, unknown>[]; data?: Record<string, unknown>[] } }> }).results[board.i]!;
      expect(result.ok, res.body).toBe(true);
      const rows = result.result.rows ?? result.result.data ?? [];
      // Her own deals, the one with no stage among them: it is on no column.
      expect(rows.map((row) => [row['name'], row['stage_id'] === null ? null : Number(row['stage_id'])]).sort()).toEqual([
        ['Deal 1', 1],
        ['Deal 2', 2],
        ['Deal 5', null],
      ]);
    });

    it('a board over an enum the page names counts and totals each value in one more query, over the deals a reader reaches', async () => {
      const page = (await pagesRepo(s.meta).findBySlug(s.connectionId, 'crm-outcomes'))!;
      const stored = page.config as { config: { layout: { items: { i: string; widget: string; config: Record<string, unknown> }[] } } };
      const board = stored.config.layout.items.find((item) => item.widget === 'kanban-board')!;
      expect(board.config).toMatchObject({ statusColumn: 'state', columns: ['open', 'won', 'lost'], titleColumn: 'name', totals: [{ column: 'amount', fn: 'sum' }] });
      expect(board.config['columnsFrom']).toBeUndefined();
      const groups = async (who: keyof typeof people): Promise<[string, number, number][]> => {
        const res = await s.app.inject({
          method: 'POST',
          url: '/api/v1/widget-data/batch',
          headers: { cookie: people[who].cookie },
          payload: { requests: [{ instanceId: `${board.i}:columns`, descriptor: board.config['columnsBinding'] }], params: {} },
        });
        expect(res.statusCode, res.body).toBe(200);
        const result = (res.json() as { results: Record<string, { ok: boolean; result: { items: { key: string; value: number; values?: Record<string, number> }[] } }> }).results[`${board.i}:columns`]!;
        expect(result.ok, res.body).toBe(true);
        return result.result.items.map((item): [string, number, number] => [String(item.key), Number(item.values?.['cards']), Number(item.values?.['total0'])]).sort((a, b) => a[0].localeCompare(b[0]));
      };
      // Her own: deals 1 and 5 open, deal 2 won. A value with no deal is no group; the board draws it with none.
      expect(await groups('dana')).toEqual([
        ['open', 2, 120],
        ['won', 1, 300],
      ]);
      // The team's: deals 1, 3, 4, 5 open.
      expect(await groups('mara')).toEqual([
        ['open', 4, 240],
        ['won', 1, 300],
      ]);
    });

    // ── A board of some of its rows (`only`) ────────────────────────────────────────────────────────────────────

    type Test = { column: string; in: unknown[] };
    const AMOUNT = { terms: [{ sign: 'plus', factors: ['amount'] }] };
    /** The stages in order, each with the measures asked of the deals in it: the read a board makes, with whatever `where`. */
    const measured = async (who: keyof typeof people, measures: Record<string, unknown>[]): Promise<{ status: number; rows: Record<string, unknown>[]; body: string }> => {
      const compute = encodeURIComponent(JSON.stringify({ measures: measures.map((measure) => ({ table: s.table.deals, fkColumn: 'stage_id', ...measure })) }));
      const res = await get(who, `${s.table.stages}?select=id,name&order=position.asc&limit=100&compute=${compute}`);
      return { status: res.statusCode, rows: res.statusCode === 200 ? (res.json() as { data: Record<string, unknown>[] }).data : [], body: res.body };
    };
    /** One measure by stage: `[name, value]`. */
    const byStage = async (who: keyof typeof people, measure: Record<string, unknown>): Promise<[string, unknown][]> => {
      const read = await measured(who, [{ id: 'm', ...measure }]);
      expect(read.status, read.body).toBe(200);
      return read.rows.map((row) => [String(row['name']), row['m']]);
    };
    const storedBoard = async (slug: string) => {
      const page = (await pagesRepo(s.meta).findBySlug(s.connectionId, slug))!;
      const stored = page.config as { config: { layout: { items: { i: string; widget: string; config: Record<string, unknown> }[] } } };
      return stored.config.layout.items.find((item) => item.widget === 'kanban-board')!;
    };
    /** The cards a stored board lists for a reader, as the page's batch asks for them. */
    const cards = async (who: keyof typeof people, board: { i: string; config: Record<string, unknown> }, key = 'binding') => {
      const res = await s.app.inject({
        method: 'POST',
        url: '/api/v1/widget-data/batch',
        headers: { cookie: people[who].cookie },
        payload: { requests: [{ instanceId: board.i, descriptor: board.config[key] }], params: {} },
      });
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as { results: Record<string, { ok: boolean; error?: { code: string }; result?: { rows?: Record<string, unknown>[]; items?: { key: string; values?: Record<string, number> }[] } }> }).results[board.i]!;
    };

    it('stores a board of the open deals: the cards’ query and the tests the columns are counted by say the same', async () => {
      const board = await storedBoard('crm-open');
      expect(board.config).toMatchObject({ statusColumn: 'stage_id', columnsFrom: { table: s.table.stages, key: 'id' }, only: [{ column: 'state', in: ['open'] }] });
      expect((board.config['binding'] as { filters?: unknown }).filters).toEqual([{ column: 'state', op: 'in', value: ['open'] }]);
      // The board that names no `only` carries none: every deal, as before.
      const whole = await storedBoard('crm-pipeline');
      expect(whole.config['only']).toBeUndefined();
      expect((whole.config['binding'] as { filters?: unknown }).filters).toBeUndefined();
    });

    it('lists the open deals only as cards, a rep’s own', async () => {
      const board = await storedBoard('crm-open');
      const names = async (who: keyof typeof people) => {
        const result = await cards(who, board);
        expect(result.ok, JSON.stringify(result)).toBe(true);
        return (result.result?.rows ?? []).map((row) => String(row['name'])).sort();
      };
      // Deal 2 is won: on the whole pipeline it is her card, on this board it is not.
      expect(await names('dana')).toEqual(['Deal 1', 'Deal 5']);
      expect(await names('omar')).toEqual(['Deal 3', 'Deal 4']);
      expect(await names('mara')).toEqual(['Deal 1', 'Deal 3', 'Deal 4', 'Deal 5']);
    });

    it('counts and sums each stage’s open deals, over the deals a reader reaches: the header says what the cards say', async () => {
      const board = await storedBoard('crm-open');
      const where = board.config['only'] as Test[];
      const open = async (who: keyof typeof people): Promise<[string, unknown, unknown][]> => {
        const read = await measured(who, [
          { id: 'board_count', fn: 'count', where },
          { id: 'board_total_0', fn: 'sum', of: AMOUNT, where },
        ]);
        expect(read.status, read.body).toBe(200);
        return read.rows.map((row) => [String(row['name']), row['board_count'], Number(row['board_total_0'])]);
      };
      // The team's: Proposal holds one deal, and it is won.
      expect(await open('mara')).toEqual([
        ['Lead', 2, 150],
        ['Qualified', 1, 70],
        ['Proposal', 0, 0],
        ['Closing', 0, 0],
      ]);
      expect(await open('dana')).toEqual([
        ['Lead', 1, 100],
        ['Qualified', 0, 0],
        ['Proposal', 0, 0],
        ['Closing', 0, 0],
      ]);
      expect(await open('omar')).toEqual([
        ['Lead', 1, 50],
        ['Qualified', 1, 70],
        ['Proposal', 0, 0],
        ['Closing', 0, 0],
      ]);
      // The same read with no `where` still counts her won deal: the condition is what left it out.
      expect((await columns('dana')).find(([name]) => name === 'Proposal')).toEqual(['Proposal', 1, 300]);
    });

    it('takes a list of values, several tests at once, a yes/no, and folds with avg, min and max', async () => {
      const closed = [{ column: 'state', in: ['won', 'lost'] }];
      expect(await byStage('mara', { fn: 'count', where: closed })).toEqual([['Lead', 0], ['Qualified', 0], ['Proposal', 1], ['Closing', 0]]);
      expect(await byStage('mara', { fn: 'sum', of: AMOUNT, where: closed })).toEqual([['Lead', '0'], ['Qualified', '0'], ['Proposal', '300'], ['Closing', '0']]);
      // Hot: deals 1, 2 and 4.
      expect(await byStage('mara', { fn: 'count', where: [{ column: 'hot', in: [true] }] })).toEqual([['Lead', 1], ['Qualified', 1], ['Proposal', 1], ['Closing', 0]]);
      expect(await byStage('mara', { fn: 'count', where: [{ column: 'hot', in: [false] }] })).toEqual([['Lead', 1], ['Qualified', 0], ['Proposal', 0], ['Closing', 0]]);
      // Every test must hold: hot AND open leaves the won deal out.
      expect(await byStage('mara', { fn: 'count', where: [{ column: 'hot', in: [true] }, { column: 'state', in: ['open'] }] })).toEqual([['Lead', 1], ['Qualified', 1], ['Proposal', 0], ['Closing', 0]]);
      const open = [{ column: 'state', in: ['open'] }];
      // The average of nothing is nothing, not zero.
      expect((await byStage('mara', { fn: 'avg', of: AMOUNT, where: open })).map(([name, value]) => [name, value === null ? null : Number(value)])).toEqual([['Lead', 75], ['Qualified', 70], ['Proposal', null], ['Closing', null]]);
      expect((await byStage('mara', { fn: 'min', of: AMOUNT, where: open })).map(([name, value]) => [name, value === null ? null : Number(value)])).toEqual([['Lead', 50], ['Qualified', 70], ['Proposal', null], ['Closing', null]]);
      expect((await byStage('mara', { fn: 'max', of: AMOUNT, where: open })).map(([name, value]) => [name, value === null ? null : Number(value)])).toEqual([['Lead', 100], ['Qualified', 70], ['Proposal', null], ['Closing', null]]);
      // A link's key, by number: the deals of stage 1 are every deal counted under stage 1 and none under another.
      expect(await byStage('mara', { fn: 'count', where: [{ column: 'id', in: [1, 4, 2] }] })).toEqual([['Lead', 1], ['Qualified', 1], ['Proposal', 1], ['Closing', 0]]);
    });

    it('answers no figure to a reader the tested column is hidden from: null and the masked marker, never an unfiltered number', async () => {
      const where = [{ column: 'state', in: ['open'] }];
      const read = await measured('cleo', [
        { id: 'board_count', fn: 'count', where },
        { id: 'board_total_0', fn: 'sum', of: AMOUNT, where },
        // The same reader, asked nothing of the hidden column, is answered: the test is what refuses.
        { id: 'every', fn: 'count' },
      ]);
      expect(read.status, read.body).toBe(200);
      expect(read.rows.map((row) => [row['name'], row['board_count'], row['board_total_0'], row['every']])).toEqual([
        ['Lead', null, null, 3],
        ['Qualified', null, null, 1],
        ['Proposal', null, null, 1],
        ['Closing', null, null, 0],
      ]);
      for (const row of read.rows) expect(row['_masked']).toEqual(expect.arrayContaining(['board_count', 'board_total_0']));
      for (const row of read.rows) expect(row['_masked']).not.toContain('every');
      // Whatever value is asked for, the answer is the same: a count that moved with it would say which values the column holds.
      for (const value of ['open', 'won', 'lost', 'never']) {
        expect(await byStage('cleo', { fn: 'count', where: [{ column: 'state', in: [value] }] })).toEqual([['Lead', null], ['Qualified', null], ['Proposal', null], ['Closing', null]]);
      }
      // The cards of that board are not listed for them either: its query names the column it may not read.
      const listed = await cards('cleo', await storedBoard('crm-open'));
      expect(listed.ok).toBe(false);
      expect(listed.result).toBeUndefined();
    });

    it('answers no figure to a reader the tested column is masked for, and the figure to one who may read it', async () => {
      const where = [{ column: 'region', in: ['north'] }];
      // A rep reads their deals without the grant to read personal data.
      const rep = await measured('dana', [{ id: 'north', fn: 'count', where }]);
      expect(rep.status, rep.body).toBe(200);
      expect(rep.rows.map((row) => row['north'])).toEqual([null, null, null, null]);
      for (const row of rep.rows) expect(row['_masked']).toContain('north');
      // The owner holds it: deals 1 and 3, both leads.
      expect(await byStage('owner', { fn: 'count', where })).toEqual([['Lead', 2], ['Qualified', 0], ['Proposal', 0], ['Closing', 0]]);
    });

    it('refuses a test the table cannot answer as the author’s mistake, and counts none for a value the column never holds', async () => {
      const status = async (where: unknown) => (await measured('mara', [{ id: 'm', fn: 'count', where }])).status;
      expect(await status([{ column: 'status', in: ['open'] }])).toBe(422);
      // A number is no text, text is no number, and money is compared with numbers.
      expect(await status([{ column: 'state', in: [1] }])).toBe(422);
      expect(await status([{ column: 'id', in: ['one'] }])).toBe(422);
      expect(await status([{ column: 'hot', in: ['yes'] }])).toBe(422);
      expect(await status([{ column: 'amount', in: ['100'] }])).toBe(422);
      // A value the choice does not have matches no deal, on every engine: no error, no deal.
      expect(await byStage('mara', { fn: 'count', where: [{ column: 'state', in: ['closed'] }] })).toEqual([['Lead', 0], ['Qualified', 0], ['Proposal', 0], ['Closing', 0]]);
      // A value is a value, whatever it spells: bound, it is compared and matches nothing.
      expect(await byStage('mara', { fn: 'count', where: [{ column: 'name', in: ["x' OR '1'='1"] }] })).toEqual([['Lead', 0], ['Qualified', 0], ['Proposal', 0], ['Closing', 0]]);
    });

    it('an enum board of some of its rows counts and totals each value over those rows, and lists those cards', async () => {
      const board = await storedBoard('crm-hot');
      const filters = [{ column: 'hot', op: 'in', value: [true] }];
      expect(board.config).toMatchObject({ statusColumn: 'state', columns: ['open', 'won', 'lost'], only: [{ column: 'hot', in: [true] }] });
      expect((board.config['binding'] as { filters?: unknown }).filters).toEqual(filters);
      // The counting query asks the cards' condition, and the enum's own values: no group for a row with none.
      expect((board.config['columnsBinding'] as { filters?: unknown }).filters).toEqual([...filters, { column: 'state', op: 'in', value: ['open', 'won', 'lost'] }]);
      const groups = async (who: keyof typeof people): Promise<[string, number, number][]> => {
        const result = await cards(who, board, 'columnsBinding');
        expect(result.ok, JSON.stringify(result)).toBe(true);
        return (result.result?.items ?? []).map((item): [string, number, number] => [String(item.key), Number(item.values?.['cards']), Number(item.values?.['total0'])]).sort((a, b) => a[0].localeCompare(b[0]));
      };
      // The team's hot deals: 1 and 4 open, 2 won. Her own: 1 open, 2 won.
      expect(await groups('mara')).toEqual([['open', 2, 170], ['won', 1, 300]]);
      expect(await groups('dana')).toEqual([['open', 1, 100], ['won', 1, 300]]);
      const listed = await cards('dana', board);
      expect((listed.result?.rows ?? []).map((row) => String(row['name'])).sort()).toEqual(['Deal 1', 'Deal 2']);
    });

    it('an enum board counts every value that has cards, however many rows have no value at all', async () => {
      const board = await storedBoard('crm-tasks');
      expect(board.config).toMatchObject({ statusColumn: 'phase', columns: ['todo', 'doing', 'done'] });
      const result = await cards('owner', board, 'columnsBinding');
      expect(result.ok, JSON.stringify(result)).toBe(true);
      // The four rows with no phase made a fourth group, bigger than "done": cut at three groups, "done" read 0 over its card.
      // One figure a group (no totals on this board): it is the group's `value`.
      const counted = (result.result?.items ?? []) as { key: string; value?: number; values?: Record<string, number> }[];
      expect(counted.map((item): [string, number] => [String(item.key), Number(item.values?.['cards'] ?? item.value)]).sort((a, b) => a[0].localeCompare(b[0]))).toEqual([
        ['doing', 3],
        ['done', 1],
        ['todo', 5],
      ]);
      // The cards themselves are every task: the ones with no phase are listed, and are on no column.
      expect((await cards('owner', board)).result?.rows).toHaveLength(13);
    });

    it('refuses a whole number past the column’s width where the database would raise, and counts none where it would not', async () => {
      const read = await measured('mara', [{ id: 'm', fn: 'count', where: [{ column: 'id', in: [3_000_000_000] }] }]);
      if (dialect === 'postgres') {
        // An int4 column: bound as it came, Postgres raises and the whole read is a 500.
        expect(read.status, read.body).toBe(422);
        expect((JSON.parse(read.body) as { error: { code: string; message: string } }).error).toMatchObject({
          code: 'VALIDATION_FAILED',
          message: expect.stringContaining('takes whole numbers from -2147483648 to 2147483647'),
        });
      } else {
        expect(read.status, read.body).toBe(200);
        expect(read.rows.map((row) => row['m'])).toEqual(read.rows.map(() => 0));
      }
      // Within the width it is compared, on every engine.
      expect((await measured('mara', [{ id: 'm', fn: 'count', where: [{ column: 'id', in: [2_147_483_647] }] }])).status).toBe(200);
    });

    it('decides who may be answered before it judges the values: a refused measure is null, never a 422 that names a type', async () => {
      const mistyped = [{ id: 'm', fn: 'count', where: [{ column: 'region', in: [7] }] }];
      // Whoever may read the column is told the author's mistake.
      expect((await measured('owner', mistyped)).status).toBe(422);
      // A rep, for whom `region` is masked: no figure, and nothing about what the column takes.
      const rep = await measured('dana', mistyped);
      expect(rep.status, rep.body).toBe(200);
      for (const row of rep.rows) expect([row['m'], row['_masked']]).toEqual([null, expect.arrayContaining(['m'])]);
      // Somebody who reads the stages and no deal at all: the same, whatever is sent.
      const porter = await measured('pat', [{ id: 'm', fn: 'count', where: [{ column: 'state', in: [1] }] }]);
      expect(porter.status, porter.body).toBe(200);
      expect(porter.rows.length).toBeGreaterThan(0);
      for (const row of porter.rows) expect([row['m'], row['_masked']]).toEqual([null, expect.arrayContaining(['m'])]);
      expect((await measured('mara', [{ id: 'm', fn: 'count', where: [{ column: 'state', in: [1] }] }])).status).toBe(422);
    });

    it('a stage added to the table is a column of the next read, with no update of the app', async () => {
      const made = await s.app.inject({ method: 'POST', url: data(s.table.stages), headers: { cookie: people.mara.cookie }, payload: { values: { name: 'Negotiation', position: 0 } } });
      expect(made.statusCode, made.body).toBe(201);
      expect((await columns('dana')).map(([name]) => name)).toEqual(['Negotiation', 'Lead', 'Qualified', 'Proposal', 'Closing']);
      await s.run(`UPDATE crm_stages SET name = 'New lead' WHERE id = 1`);
      await s.run(`DELETE FROM crm_stages WHERE id = 4`);
      expect((await columns('dana')).map(([name]) => name)).toEqual(['Negotiation', 'New lead', 'Qualified', 'Proposal']);
    });

    it('a move is the ordinary save: the count and the sum follow it', async () => {
      const moved = await patch('dana', `${s.table.deals}/1`, { stage_id: 3 });
      expect(moved.statusCode, moved.body).toBe(200);
      expect((await columns('dana')).filter(([name]) => name === 'New lead' || name === 'Qualified')).toEqual([
        ['New lead', 0, 0],
        ['Qualified', 1, 100],
      ]);
    });

    it('refuses the move of a won deal with the reason, and leaves the row as it was', async () => {
      const refused = await patch('dana', `${s.table.deals}/2`, { stage_id: 1 });
      expect(refused.statusCode, refused.body).toBe(403);
      const error = (refused.json() as { error: { code: string; message: string; details: Record<string, unknown> } }).error;
      expect(error.code).toBe('COLUMN_FORBIDDEN');
      expect(error.details).toMatchObject({ reason: 'update-from', column: 'state', writableFrom: ['open'] });
      expect(error.message).not.toBe('');
      expect((await s.rows(`SELECT stage_id FROM crm_deals WHERE id = 2`)).map((row) => Number(row['stage_id']))).toEqual([2]);
      // Her manager, whom the rule does not hold, moves it.
      expect((await patch('mara', `${s.table.deals}/2`, { stage_id: 1 })).statusCode).toBe(200);
    });

    it('does not find a deal out of reach', async () => {
      const missing = await patch('dana', `${s.table.deals}/3`, { stage_id: 2 });
      expect(missing.statusCode, missing.body).toBe(404);
      expect((await s.rows(`SELECT stage_id FROM crm_deals WHERE id = 3`)).map((row) => Number(row['stage_id']))).toEqual([1]);
    });

    it('a colleague’s change is told on the table’s own channel to whoever reads that table, and to nobody else', async () => {
      // What a board page follows: the channel of its cards' table, and of the table its columns are the rows of.
      const stages = widgetDataChannel(s.connectionId, s.table.stages);
      const deals = widgetDataChannel(s.connectionId, s.table.deals);
      const frameFor = readLimitedFrames(s.meta);
      type Frame = { type: string; pk: Record<string, unknown> | null; row: Record<string, unknown> | null; changed?: true };
      const got = new Map<string, Frame[]>();
      const offs: (() => void)[] = [];
      /** As the server's own gateway does it: the door first, then every frame through the subscriber's filter. */
      const follow = async (who: 'dana' | 'omar' | 'tess' | 'pat', channel: string): Promise<boolean> => {
        const user = { id: people[who].id };
        const allowed = await authorizeChannel(user, channel, { can: async (_user, permission) => permissionSetAllows(await resolvePermissionSet(s.meta, { kind: 'user', id: user.id, label: user.id }), permission) });
        got.set(`${who} ${channel}`, []);
        // Subscribed whatever the door said, to show the filter holds on its own too: a role taken away mid-session.
        offs.push(s.app.realtime.subscribe(channel, orderedSink(await frameFor(user, channel), (event: RealtimeEvent) => got.get(`${who} ${channel}`)!.push(event.data as Frame))));
        return allowed;
      };
      // The door: by the reader's own grant on THAT table. Reading the cards opens nothing of the columns' table, and the other way round.
      expect(await follow('dana', stages)).toBe(true);
      expect(await follow('tess', stages)).toBe(false);
      expect(await follow('pat', stages)).toBe(true);
      expect(await follow('dana', deals)).toBe(true);
      expect(await follow('omar', deals)).toBe(true);
      expect(await follow('pat', deals)).toBe(false);
      // And the same door over HTTP, for the transport that falls back to a stream.
      const refused = await s.app.inject({ method: 'GET', url: `/api/v1/events?channels=${encodeURIComponent(stages)}`, headers: { cookie: people.tess.cookie } });
      expect(refused.statusCode, refused.body).toBe(403);

      // A manager adds a stage, and renames one of Omar's deals.
      const made = await s.app.inject({ method: 'POST', url: data(s.table.stages), headers: { cookie: people.mara.cookie }, payload: { values: { name: 'Review', position: 9 } } });
      expect(made.statusCode, made.body).toBe(201);
      expect((await patch('mara', `${s.table.deals}/4`, { name: 'Deal 4, renamed' })).statusCode).toBe(200);
      // Each frame is judged after its publisher returns: let the judging finish.
      for (let turn = 0; turn < 20; turn += 1) await new Promise((resolve) => setTimeout(resolve, 5));
      for (const off of offs) off();

      // The new stage: to whoever reads the stages, whole. To the one who does not: nothing.
      for (const who of ['dana', 'pat']) {
        expect(got.get(`${who} ${stages}`)!.map((frame) => [frame.type, frame.row?.['name']]), who).toEqual([['record.create', 'Review']]);
      }
      expect(got.get(`tess ${stages}`)).toEqual([]);
      // The deal: to the rep it belongs to, and not to the rep it does not; and nothing to who reads no deal.
      expect(got.get(`omar ${deals}`)!.map((frame) => [frame.type, frame.row?.['name']])).toEqual([['record.update', 'Deal 4, renamed']]);
      expect(got.get(`dana ${deals}`)).toEqual([]);
      expect(got.get(`pat ${deals}`)).toEqual([]);
    });

    // Last: it adds a column and reads the schema again.
    it.skipIf(dialect !== 'postgres')('refuses a test of a column that holds a list, which the database could not compare', async () => {
      await s.run(`ALTER TABLE crm_deals ADD COLUMN tags text[]`);
      await runIntrospection({ manager: s.manager, meta: s.meta, connectionId: s.connectionId });
      const read = await measured('owner', [{ id: 'm', fn: 'count', where: [{ column: 'tags', in: ['a'] }] }]);
      expect(read.status, read.body).toBe(422);
      expect((JSON.parse(read.body) as { error: { message: string } }).error.message).toContain('a column that holds a list is not compared');
    });
  });
}
