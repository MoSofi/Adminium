// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A board's toolbar and cards (`config.board.toolbar`, `card.secondAmount`,
 * `card.daysSince.label`), on every engine, through the whole server: a sales
 * app's pipeline of open deals, read by a rep (her own deals), her manager
 * (the team's) and the owner (every deal).
 *
 * What is on trial: the app installs and the page's stored board carries the
 * toolbar, a card's second money line and what its days are; the toolbar's
 * total is the SERVER's — a count and a sum of every card the reader reaches,
 * more cards than the board lists among them — each reader's own; the people
 * its filter offers are the ones who hold cards the reader reaches, named
 * and never by id; and narrowed to one person the cards, the figures and the
 * total are that person's alone, within the reader's reach still.
 *
 * Nothing is faked below the HTTP routes: the app is uploaded and installed
 * through its routes, people sign in with a password, and every read goes
 * through the widget-data batch the board page sends.
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
import { packageTarball } from './app-bundle-helpers.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

// The toolbar and the card's words are read from 0.3.35 on, and the upload door refuses an app newer than the server: this server says it is that release.
vi.mock('../src/version.js', async (original) => ({ ...(await original<typeof import('../src/version.js')>()), APP_VERSION: '0.3.35' }));

type Dialect = 'sqlite' | 'postgres' | 'mysql';
const POSTGRES_URL = process.env.TEST_POSTGRES_URL || undefined;
const MYSQL_URL = process.env.TEST_MYSQL_URL || undefined;
const ENGINES: [Dialect, boolean][] = [
  ['sqlite', true],
  ['postgres', POSTGRES_URL !== undefined],
  ['mysql', MYSQL_URL !== undefined],
];

const id = { ref: 'id', type: 'int', role: 'pk' };

/** More cards than a board lists (its cards' query stops at 200): the total must still count them all. */
const MANY = 230;

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
  compatibility: { minAdminiumVersion: '0.3.35' },
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
          { ref: 'weighted', type: 'money', nullable: true },
          { ref: 'state', type: 'enum', enum: ['open', 'won', 'lost'], default: 'open' },
          { ref: 'owner_id', type: 'text', maxLength: 36, nullable: true, rules: { staff: true } },
          { ref: 'entered_at', type: 'timestamptz', nullable: true },
        ],
        belongs: [{ column: 'owner_id', set: 'team' }],
        indexes: [['owner_id'], ['stage_id']],
      },
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
          totals: [
            { column: 'amount', fn: 'sum' },
            { column: 'weighted', fn: 'sum' },
          ],
          only: { state: 'open' },
          card: {
            person: 'owner_id',
            amount: 'amount',
            secondAmount: { column: 'weighted', label: 'w', labels: { 'de-DE': 'gew.' } },
            daysSince: { column: 'entered_at', warnFrom: 14, alertFrom: 30, label: 'in stage', labels: { 'de-DE': 'in der Phase' } },
          },
          toolbar: { total: true, person: 'owner_id' },
          note: { text: 'Columns come from Stages' },
        },
      },
    },
  ],
  roles: [
    {
      key: 'rep',
      name: 'Sales rep',
      permissions: ['table:@deals:read', 'table:@stages:read', 'page:@crm-pipeline:view'],
      limits: { deals: { rows: { read: { reach: 'own' } } } },
    },
    {
      key: 'manager',
      name: 'Sales manager',
      permissions: ['table:@deals:read', 'table:@stages:read', 'page:@crm-pipeline:view'],
      limits: { deals: { rows: { read: { reach: 'team' } } } },
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
  const name = `adminium_btool_${randomBytes(4).toString('hex')}`;
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
  const dataDir = await mkdtemp(join(tmpdir(), 'app-board-toolbar-'));
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
  describe.skipIf(!available)(`a board's toolbar and cards [${dialect}]`, () => {
    let s: Stack;
    type Who = 'mara' | 'dana' | 'omar' | 'owner';
    const people = {} as Record<Who, { id: string; cookie: string }>;
    type Item = { i: string; widget: string; config: Record<string, unknown> };
    const stored = async (): Promise<Item> => {
      const page = (await pagesRepo(s.meta).findBySlug(s.connectionId, 'crm-pipeline'))!;
      return (page.config as { config: { layout: { items: Item[] } } }).config.layout.items.find((item) => item.widget === 'kanban-board')!;
    };
    /** The batch the board page sends, as `who`; each descriptor narrowed to one person when asked (the host's `withPerson`). */
    const batch = async (who: Who, requests: { instanceId: string; descriptor: unknown }[]) => {
      const res = await s.app.inject({ method: 'POST', url: '/api/v1/widget-data/batch', headers: { cookie: people[who].cookie }, payload: { requests, params: {} } });
      expect(res.statusCode, res.body).toBe(200);
      const results = (res.json() as { results: Record<string, { ok: boolean; result?: Record<string, unknown>; error?: unknown }> }).results;
      for (const request of requests) expect(results[request.instanceId]?.ok, JSON.stringify(results[request.instanceId])).toBe(true);
      return results;
    };
    const narrowed = (descriptor: unknown, person: string | null) =>
      person === null ? descriptor : { ...(descriptor as Record<string, unknown>), filters: [...(((descriptor as { filters?: unknown[] }).filters) ?? []), { column: 'owner_id', op: 'eq', value: person }] };
    /** The toolbar's total as `who` reads it: the count, then each total. */
    const total = async (who: Who, person: string | null = null): Promise<number[]> => {
      const board = await stored();
      const figures = board.config['toolbarBindings'] as unknown[];
      const requests = figures.map((descriptor, index) => ({ instanceId: `${board.i}:toolbar:${String(index)}`, descriptor: narrowed(descriptor, person) }));
      const results = await batch(who, requests);
      return requests.map((request) => Number((results[request.instanceId]!.result as { value: unknown }).value ?? 0));
    };
    /** The people the filter offers `who`, by name, each with their count of cards. */
    const offered = async (who: Who): Promise<[string, number][]> => {
      const board = await stored();
      const results = await batch(who, [{ instanceId: `${board.i}:people`, descriptor: board.config['personBinding'] }]);
      const items = (results[`${board.i}:people`]!.result as { items: { key: string; label?: string; value: number }[] }).items;
      return items.map((item): [string, number] => [item.label ?? item.key, item.value]).sort((a, b) => a[0].localeCompare(b[0]));
    };
    /** The cards the board lists for `who`, and how many. */
    const cards = async (who: Who, person: string | null = null) => {
      const board = await stored();
      const results = await batch(who, [{ instanceId: board.i, descriptor: narrowed(board.config['binding'], person) }]);
      return ((results[board.i]!.result as { rows: Record<string, unknown>[] }).rows ?? []);
    };

    beforeAll(async () => {
      s = await stack(dialect);
      const users = usersRepo(s.meta);
      const hash = await adminPasswordHash();
      const roles = { mara: 'crm-manager', dana: 'crm-rep', omar: 'crm-rep' } as const;
      const names = { mara: 'Mara Lind', dana: 'Dana Ruiz', omar: 'Omar Haddad' } as const;
      for (const name of ['mara', 'dana', 'omar'] as const) {
        const user = await users.create({ email: `${name}@firm.test`, name: names[name], passwordHash: hash });
        await rolesRepo(s.meta).assignToUser(user.id, (await rolesRepo(s.meta).findBySlug(roles[name]))!.id);
        people[name] = { id: user.id, cookie: '' };
      }
      const north = await teamsRepo(s.meta).create('North');
      await teamsRepo(s.meta).setMember(north.id, people.mara.id, true);
      await teamsRepo(s.meta).setMember(north.id, people.dana.id, false);
      await teamsRepo(s.meta).setMember(north.id, people.omar.id, false);
      for (const name of ['mara', 'dana', 'omar'] as const) people[name].cookie = await signIn(s.app, `${name}@firm.test`);
      people.owner = { id: '', cookie: await signIn(s.app, 'owner@firm.test') };
      for (const [name, position] of [['Lead', 1], ['Qualified', 2], ['Proposal', 3]] as const) await s.run(`INSERT INTO crm_stages (name, position) VALUES ('${name}', ${String(position)})`);
      const deal = (key: number, owner: string | null, stage: number, amount: number, weighted: number, state: string) =>
        `(${String(key)}, 'Deal ${String(key)}', ${String(stage)}, ${String(amount)}, ${String(weighted)}, '${state}', ${owner === null ? 'NULL' : `'${owner}'`})`;
      await s.run(
        `INSERT INTO crm_deals (id, name, stage_id, amount, weighted, state, owner_id) VALUES ${[
          deal(1, people.dana.id, 1, 100, 10, 'open'),
          deal(2, people.dana.id, 2, 300, 150, 'open'),
          // Won: not on the board of open deals, nor in its total.
          deal(3, people.dana.id, 3, 5000, 5000, 'won'),
          deal(4, people.omar.id, 1, 50, 5, 'open'),
          // Nobody's: the owner's to read only.
          deal(5, null, 1, 1000, 100, 'open'),
        ].join(', ')}`,
      );
      // More of Omar's open deals than the board lists: one each, at 2 and weighted 1.
      const more = Array.from({ length: MANY }, (_, n) => deal(100 + n, people.omar.id, 2, 2, 1, 'open'));
      for (let at = 0; at < more.length; at += 100) await s.run(`INSERT INTO crm_deals (id, name, stage_id, amount, weighted, state, owner_id) VALUES ${more.slice(at, at + 100).join(', ')}`);
    }, 240_000);
    afterAll(async () => {
      await s?.close();
    });

    it('installs, and the stored board carries its toolbar, its total and people queries, the second money line and what its days are', async () => {
      expect(s.warnings).toEqual([]);
      const board = await stored();
      expect(board.config).toMatchObject({
        toolbar: { total: true, person: 'owner_id' },
        card: { person: 'owner_id', amount: 'amount', secondAmount: { column: 'weighted', label: 'w', labels: { 'de-DE': 'gew.' } }, daysSince: { column: 'entered_at', label: 'in stage', labels: { 'de-DE': 'in der Phase' } } },
      });
      const open = [{ column: 'state', op: 'in', value: ['open'] }];
      expect(board.config['toolbarBindings']).toMatchObject([
        { shape: 'single-metric', aggregations: [{ fn: 'count', alias: 'cards' }], filters: open },
        { shape: 'single-metric', aggregations: [{ fn: 'sum', column: 'amount', alias: 'total' }], filters: open },
        { shape: 'single-metric', aggregations: [{ fn: 'sum', column: 'weighted', alias: 'total' }], filters: open },
      ]);
      expect(board.config['personBinding']).toMatchObject({ shape: 'categorical', groupBy: ['owner_id'], filters: [...open, { column: 'owner_id', op: 'not_null' }] });
      // A card reads its second money line with the rest.
      expect((board.config['binding'] as { select: string[] }).select).toEqual(expect.arrayContaining(['amount', 'weighted', 'owner_id', 'entered_at']));
    });

    it("totals every open card each reader reaches, more than the board lists among them: the server's figures, each reader's own", async () => {
      // Dana: her two open deals.
      expect(await total('dana')).toEqual([2, 400, 160]);
      // Mara, the team's: Dana's two, Omar's one and his many — more than the 200 cards the board lists.
      expect(await total('mara')).toEqual([3 + MANY, 450 + 2 * MANY, 165 + MANY]);
      expect((await cards('mara')).length).toBeLessThan(3 + MANY);
      // The owner: every open deal, the one that is nobody's too.
      expect(await total('owner')).toEqual([4 + MANY, 1450 + 2 * MANY, 265 + MANY]);
      // Omar: his own.
      expect(await total('omar')).toEqual([1 + MANY, 50 + 2 * MANY, 5 + MANY]);
    });

    it('offers the people who hold cards the reader reaches, by name, each with their count', async () => {
      expect(await offered('dana')).toEqual([['Dana Ruiz', 2]]);
      expect(await offered('mara')).toEqual([
        ['Dana Ruiz', 2],
        ['Omar Haddad', 1 + MANY],
      ]);
      // A deal that is nobody's is no choice: it is among everyone's.
      expect(await offered('owner')).toEqual([
        ['Dana Ruiz', 2],
        ['Omar Haddad', 1 + MANY],
      ]);
    });

    it("narrowed to one person, the cards and the total are that person's, within the reader's reach still", async () => {
      expect(await total('mara', people.dana.id)).toEqual([2, 400, 160]);
      expect((await cards('mara', people.dana.id)).map((row) => row['name']).sort()).toEqual(['Deal 1', 'Deal 2']);
      expect(await total('owner', people.omar.id)).toEqual([1 + MANY, 50 + 2 * MANY, 5 + MANY]);
      // A rep narrowed to a colleague is told of none of the colleague's cards: her reach holds.
      expect(await total('dana', people.omar.id)).toEqual([0, 0, 0]);
      expect(await cards('dana', people.omar.id)).toEqual([]);
    });
  });
}
