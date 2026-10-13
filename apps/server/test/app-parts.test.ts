// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE PARTS OF AN APP, SWITCHED OFF AND ON, against the whole server on
 * SQLite, Postgres and MySQL: an app is installed through its routes, people
 * who hold its roles sign in, and each thing a part owns is tried while the
 * part is off and again once it is on — its page by address and in the menu,
 * its roles and their grants, its rules before a run is claimed and in the
 * runner, its public entry, and the map the app's own screens are told.
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
import { automationsRepo, createFirstSuperAdmin, createSqliteMetaDb, firstRun, manifestsRepo, pagesRepo, readAppModules, rolesRepo, settingsRepo, snapshotsRepo, userPrefsRepo, usersRepo, type MetaDb } from '@adminium/meta';

import { sha512Integrity } from '../src/add-ons/store.js';
import type { AdminiumServer } from '../src/app.js';
import { scanDueSchedules } from '../src/automations/schedule.js';
import { composeServer } from '../src/compose.js';
import { runIntrospection } from '../src/connections/introspect.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { registerAdapters } from '../src/connections/register-adapters.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import { publicEntryPartOff, withOpenDoors } from '../src/rbac/app-parts.js';
import { packageTarball } from './app-bundle-helpers.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

// The server says the version it was built at; the words tried here are read from the release to come.
vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.28' }));

type Dialect = 'sqlite' | 'postgres' | 'mysql';
const POSTGRES_URL = process.env.TEST_POSTGRES_URL || undefined;
const MYSQL_URL = process.env.TEST_MYSQL_URL || undefined;
const LEGS: [Dialect, boolean][] = [
  ['sqlite', true],
  ['postgres', POSTGRES_URL !== undefined],
  ['mysql', MYSQL_URL !== undefined],
];

const en = (text: string) => ({ 'en-US': text });
const id = { ref: 'id', type: 'int', role: 'pk' };
const page = (ref: string, table: string, module: string, order: number) => ({ ref, template: 'page-crud', title: { key: `t.${ref}`, fallback: ref }, nav: { group: 'desk', icon: 'list', order }, bindings: { rows: table }, module });
const step = (key: string, action: Record<string, unknown>) => ({ version: 1, nodes: [{ id: 't', kind: 'trigger', title: key }, { id: 'a', kind: 'action', title: key, action }] });

function desk(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'desk',
    name: 'Desk',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.desk.desc', fallback: 'A desk.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.28', engines: ['postgres', 'mysql', 'sqlite'] },
    modules: [
      { id: 'front', label: { 'en-US': 'Front desk', 'de-DE': 'Empfang' }, default: 'always' },
      { id: 'jobs', label: en('Jobs on site'), default: 'off' },
      { id: 'fleet', label: en('Vehicles'), default: 'on' },
    ],
    maps: true,
    navGroups: [{ key: 'desk', label: en('Desk'), order: 1 }],
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'tickets', module: 'front', columns: [id, { ref: 'title', type: 'text', maxLength: 120 }] },
        {
          ref: 'jobs',
          module: 'jobs',
          label: en('Job'),
          labelPlural: en('Jobs'),
          columns: [id, { ref: 'title', type: 'text', maxLength: 120 }, { ref: 'state', type: 'enum', enum: ['open', 'done'], default: 'open' }],
          states: { column: 'state', initial: 'open', moves: { open: ['done'], done: [] } },
        },
        { ref: 'vans', module: 'fleet', columns: [id, { ref: 'plate', type: 'text', maxLength: 20 }] },
      ],
    },
    roles: [
      // A role of another part that is granted the jobs: it goes on reading them while "Jobs on site" is off, and makes none.
      { key: 'agent', name: 'Agent', modules: ['front'], permissions: ['app:@:staff', 'table:@tickets:read', 'table:@tickets:create', 'table:@jobs:read', 'table:@jobs:create', 'page:@desk-tickets:view'] },
      { key: 'fitter', name: 'Fitter', names: { 'de-DE': 'Monteur' }, modules: ['jobs'], permissions: ['table:@jobs:read', 'table:@jobs:create', 'table:@jobs:update', 'page:@desk-jobs:view'] },
      { key: 'dispatcher', name: 'Dispatcher', modules: ['jobs', 'fleet'], permissions: ['table:@jobs:read', 'table:@vans:read', 'page:@desk-jobs:view', 'page:@desk-vans:view'] },
      // Opens the app's own screens and never the dashboard.
      { key: 'kiosk', name: 'Site tablet', modules: ['jobs'], screensOnly: true, permissions: ['app:@:staff', 'table:@jobs:read'] },
    ],
    pages: [page('desk-tickets', 'tickets', 'front', 1), page('desk-jobs', 'jobs', 'jobs', 2), page('desk-vans', 'vans', 'fleet', 3)],
    automations: [
      { key: 'job-made', name: en('A job is made: a ticket says so'), enabled: true, module: 'jobs', trigger: { kind: 'record', event: 'created', table: 'jobs' }, graph: step('job-made', { kind: 'record.create', table: 'tickets', values: { title: 'Job: {{record.title}}' } }) },
      {
        key: 'job-open',
        name: en('An open job, once: a ticket'),
        enabled: true,
        module: 'jobs',
        trigger: { kind: 'schedule', schedule: { kind: 'interval', everyMinutes: '5' }, forEach: { table: 'jobs', once: true, where: [{ left: { field: 'state' }, op: 'is', right: 'open' }] } },
        graph: step('job-open', { kind: 'record.create', table: 'tickets', values: { title: 'Open: {{record.title}}' } }),
      },
    ],
    publicAccess: [{ table: 'vans', methods: ['GET'], select: ['id', 'plate'], module: 'fleet' }],
    frontends: [
      { side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } },
      { side: 'customer', kind: 'spa', entry: 'index.html', routes: { home: '/' } },
    ],
  };
}

async function sourceDatabase(dialect: Dialect, dataDir: string): Promise<{ dsn: string; drop: () => Promise<void> }> {
  const name = `parts_${randomBytes(4).toString('hex')}`;
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

type Reply = Awaited<ReturnType<AdminiumServer['inject']>>;
interface Stack {
  app: AdminiumServer;
  meta: MetaDb;
  manager: ConnectionManager;
  connectionId: string;
  t: (ref: string) => string;
  rows: (statement: string) => Promise<Record<string, unknown>[]>;
  cookie: Record<string, string>;
  ids: Record<string, string>;
  jobs: () => Promise<void>;
  tick: () => Promise<number>;
  close: () => Promise<void>;
}

let signIns = 0;
async function signIn(app: AdminiumServer, email: string): Promise<string> {
  signIns += 1;
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.12.${String(Math.floor(signIns / 250))}.${String(signIns % 250)}`, payload: { email, password: ADMIN_PASSWORD } });
  expect(res.statusCode, res.body).toBe(200);
  return sessionCookie(res.headers['set-cookie']);
}

async function stack(dialect: Dialect): Promise<Stack> {
  const dataDir = await mkdtemp(join(tmpdir(), 'app-parts-'));
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  const hash = await adminPasswordHash();
  await createFirstSuperAdmin(meta, { email: 'owner@desk.test', name: 'Owner', passwordHash: hash });
  const registry = new AdapterRegistry<AdapterProvider>();
  await registerAdapters(registry);
  const manager = new ConnectionManager({ meta, crypto: dsnCryptoFromSecret(TEST_SECRET), registry, metaDsn: null, blockLoopback: false });
  const source = await sourceDatabase(dialect, dataDir);
  const connection = await manager.connections.create({ name: 'Desk', engine: dialect, introspectDsn: source.dsn, dataDsn: source.dsn });
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
  const owner = await signIn(app, 'owner@desk.test');

  const document = desk();
  const tarball = packageTarball({ 'manifest.json': JSON.stringify(document), 'staff/index.html': '<!doctype html><html><body></body></html>', 'customer/index.html': '<!doctype html><html><body></body></html>' });
  const staged = await app.inject({ method: 'POST', url: `/api/v1/apps/upload?expectedSha512=${encodeURIComponent(sha512Integrity(tarball))}`, headers: { cookie: owner, 'content-type': 'application/octet-stream' }, payload: Buffer.from(tarball) });
  expect(staged.statusCode, staged.body).toBe(200);
  // The first app that shows maps asks whether this install shows them; here the answer is no.
  const planned = await app.inject({ method: 'POST', url: '/api/v1/apps/plan', headers: { cookie: owner }, payload: { key: 'desk', version: '0.1.0', connectionId: connection.id } });
  expect(planned.statusCode, planned.body).toBe(200);
  expect((planned.json() as { plan: { maps?: boolean } }).plan.maps).toBe(true);
  const installed = await app.inject({ method: 'POST', url: '/api/v1/apps/install', headers: { cookie: owner }, payload: { key: 'desk', version: '0.1.0', connectionId: connection.id, maps: false } });
  expect(installed.statusCode, installed.body).toBe(200);

  const users = usersRepo(meta);
  const roles = rolesRepo(meta);
  const cookie: Record<string, string> = { owner };
  const ids: Record<string, string> = {};
  for (const [name, held] of [['agent', ['agent']], ['fitter', ['fitter']], ['dispatcher', ['dispatcher']], ['tablet', ['kiosk']]] as const) {
    const user = await users.create({ email: `${name}@desk.test`, name, passwordHash: hash });
    for (const role of held) await roles.assignToUser(user.id, (await roles.findBySlug(`desk-${role}`))!.id);
    ids[name] = user.id;
    cookie[name] = await signIn(app, `${name}@desk.test`);
  }

  const model = parseDatabaseModel((await snapshotsRepo(meta).latest(connection.id))!.schema);
  const handle = await manager.data(connection.id);
  return {
    app,
    meta,
    manager,
    connectionId: connection.id,
    t: (ref) => model.tables.find((table) => table.name === `desk_${ref}`)!.id,
    rows: async (statement) => (await sql.raw<Record<string, unknown>>(statement).execute(handle.db)).rows,
    cookie,
    ids,
    jobs: async () => {
      for (let round = 0; round < 20; round += 1) {
        await meta.db.updateTable('adminium_jobs').set({ runAt: 0 } as never).where('status', '=', 'pending' as never).execute();
        if ((await composed.jobs.worker.runOnce()) === 0) break;
      }
    },
    // One pass of the clock over the rules that run by it, each made due first.
    tick: async () => {
      await meta.db.updateTable('adminium_automations').set({ nextRunAt: 1 }).where('nextRunAt', 'is not', null).execute();
      return (await scanDueSchedules({ meta, manager, enqueue: (input) => composed.jobs.enqueue(input) })).runsStarted;
    },
    close: async () => {
      await app.close();
      await manager.disposeAll().catch(() => undefined);
      await source.drop();
      await meta.db.destroy();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

const said = (res: Reply): string => {
  if (res.statusCode < 300) return 'ok';
  try {
    return `${String(res.statusCode)} ${(res.json() as { error?: { code?: string } }).error?.code ?? ''}`.trim();
  } catch {
    return String(res.statusCode);
  }
};

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`the parts of an app, switched off and on, on ${dialect}`, () => {
    let s: Stack;
    const get = (who: string, url: string) => s.app.inject({ method: 'GET', url, headers: { cookie: s.cookie[who]! } });
    const list = (who: string, ref: string) => get(who, `/api/v1/data/${s.connectionId}/${s.t(ref)}?limit=50`);
    const make = (who: string, ref: string, values: Record<string, unknown>) => s.app.inject({ method: 'POST', url: `/api/v1/data/${s.connectionId}/${s.t(ref)}`, headers: { cookie: s.cookie[who]! }, payload: { values } });
    const flip = (part: string, on: boolean) => s.app.inject({ method: 'PUT', url: `/api/v1/apps/desk/parts/${part}`, headers: { cookie: s.cookie['owner']! }, payload: { on } });
    const bootstrap = async (who: string) => (await get(who, '/api/v1/bootstrap')).json().data as { nav: unknown; appSections: { key: string; groups?: { items: { slug: string }[] }[] }[]; partOffPages?: { slug: string }[]; partsOff?: true };
    const pageId = async (slug: string) => (await pagesRepo(s.meta).findBySlug(s.connectionId, slug))!.id;
    const menu = async (who: string): Promise<string> => JSON.stringify((await bootstrap(who)).appSections);
    const tickets = async () => (await s.rows('select title from desk_tickets order by id')).map((row) => String(row['title']));
    const runs = async () => (await s.meta.db.selectFrom('adminium_automation_runs').select(['status']).execute()).map((row) => row.status);

    beforeAll(async () => {
      s = await stack(dialect);
    }, 120_000);
    afterAll(async () => {
      await s?.close();
    });

    it('starts each part as the manifest says, and tells the app’s own screens', async () => {
      const parts = await get('owner', '/api/v1/apps/desk/parts');
      expect(parts.statusCode, parts.body).toBe(200);
      expect(parts.json().parts).toEqual([
        expect.objectContaining({ id: 'front', label: 'Front desk', default: 'always', switch: true, on: true, pages: 1, tables: 1, rules: 0 }),
        expect.objectContaining({ id: 'jobs', default: 'off', switch: false, on: false, pages: 1, tables: 1, rules: 2 }),
        expect.objectContaining({ id: 'fleet', default: 'on', switch: true, on: true, pages: 1, tables: 1, rules: 0 }),
      ]);
      expect(parts.json().parts[1].roles).toEqual([
        { slug: 'desk-dispatcher', name: 'Dispatcher', members: 1 },
        { slug: 'desk-fitter', name: 'Fitter', members: 1 },
        { slug: 'desk-kiosk', name: 'Site tablet', members: 1 },
      ]);
      const config = await get('agent', '/apps/desk/staff/surface-config.json');
      expect(config.statusCode, config.body).toBe(200);
      expect(config.json().modules).toEqual({ front: true, jobs: false, fleet: true });
    });

    it('refuses a page of a part that is off by its address, and leaves it out of the menu', async () => {
      const jobsPage = await get('owner', `/api/v1/pages/${await pageId('desk-jobs')}`);
      expect(said(jobsPage)).toBe('409 PART_OFF');
      expect(said(await get('owner', `/api/v1/pages/${await pageId('desk-vans')}`))).toBe('ok');
      const seen = await menu('owner');
      expect(seen).toContain('desk-tickets');
      expect(seen).toContain('desk-vans');
      expect(seen).not.toContain('desk-jobs');
      expect(((await bootstrap('owner')).partOffPages ?? []).map((one) => one.slug)).toEqual(['desk-jobs']);
    });

    it('gives a role of a part that is off nothing, and keeps another part’s grant on its table', async () => {
      // The fitter's only role is of "Jobs on site".
      expect(said(await list('fitter', 'jobs'))).toBe('403 TABLE_FORBIDDEN');
      expect((await bootstrap('fitter')).partsOff).toBe(true);
      // The dispatcher is of "Jobs on site" and "Vehicles": the vans stay, the jobs lapse.
      expect(said(await list('dispatcher', 'vans'))).toBe('ok');
      expect(said(await list('dispatcher', 'jobs'))).toBe('403 TABLE_FORBIDDEN');
      expect((await bootstrap('dispatcher')).partsOff).toBeUndefined();
      // The agent is of the front desk and is granted the jobs: the table stays readable to them…
      expect(said(await list('agent', 'jobs'))).toBe('ok');
      // …and is written by nobody while its part is off: the agent may make a job only while jobs are done here at all.
      const before = (await s.rows('select id from desk_jobs')).length;
      expect(said(await make('agent', 'jobs', { title: 'Made while the part is off' }))).toBe('403 TABLE_FORBIDDEN');
      expect((await s.rows('select id from desk_jobs')).length).toBe(before);
    });

    it('keeps a person of the app’s own screens out of the dashboard while their part is off, and tells them on those screens', async () => {
      // Still a person of the app's screens: the dashboard does not open for them because their part is off.
      expect(said(await get('tablet', '/api/v1/bootstrap'))).toBe('403 APP_SCREENS_ONLY');
      expect(said(await get('tablet', '/api/v1/roles'))).toMatch(/^403/);
      // Their screens say that nothing is switched on for them, with who is signed in.
      const screen = await s.app.inject({ method: 'GET', url: '/apps/desk/staff/', headers: { cookie: s.cookie['tablet']!, accept: 'text/html', 'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate' } });
      expect(screen.statusCode).toBe(403);
      expect(screen.body).toContain('is switched on for you.');
      expect(screen.body).toContain('tablet@desk.test');
    });

    it('finds no page of a part that is off, and schedules no report over one', async () => {
      const found = await get('owner', '/api/v1/search?q=desk-&types=page');
      expect(found.statusCode, found.body).toBe(200);
      const slugs = JSON.stringify(found.json());
      expect(slugs).toContain('desk-vans');
      expect(slugs).not.toContain('desk-jobs');
      const report = await s.app.inject({
        method: 'POST',
        url: '/api/v1/scheduled-reports',
        headers: { cookie: s.cookie['owner']! },
        payload: { pageId: await pageId('desk-jobs'), name: 'Jobs', schedule: { frequency: 'daily', time: '08:00', timezone: 'UTC' }, recipients: ['owner@desk.test'], format: 'pdf', enabled: true },
      });
      expect(said(report)).toBe('409 PART_OFF');
    });

    it('lists a role in the reader’s language, and marks one that is not offered', async () => {
      const english = (await get('owner', '/api/v1/roles')).json().roles as { slug: string; name: string; partsOff?: true; appKey?: string }[];
      expect(english.find((role) => role.slug === 'desk-fitter')).toMatchObject({ name: 'Fitter', partsOff: true, appKey: 'desk' });
      expect(english.find((role) => role.slug === 'desk-dispatcher')?.partsOff).toBeUndefined();
      expect(english.find((role) => role.slug === 'desk-agent')?.partsOff).toBeUndefined();
      const owner = (await usersRepo(s.meta).findByEmail('owner@desk.test'))!;
      await userPrefsRepo(s.meta).set(owner.id, { locale: 'de_DE' });
      const german = (await get('owner', '/api/v1/roles')).json().roles as { slug: string; name: string }[];
      expect(german.find((role) => role.slug === 'desk-fitter')?.name).toBe('Monteur');
      // A role its owner renamed keeps the owner's name in every language.
      await rolesRepo(s.meta).rename((await rolesRepo(s.meta).findBySlug('desk-fitter'))!.id, 'Crew');
      expect(((await get('owner', '/api/v1/roles')).json().roles as { slug: string; name: string }[]).find((role) => role.slug === 'desk-fitter')?.name).toBe('Crew');
      await userPrefsRepo(s.meta).set(owner.id, { locale: 'en_US' });
    });

    it('starts no run for a rule of a part that is off: by a write, or by the clock', async () => {
      expect(said(await make('owner', 'jobs', { title: 'Atrium' }))).toBe('ok');
      await s.jobs();
      expect(await s.tick()).toBe(0);
      await s.jobs();
      expect(await runs()).toEqual([]);
      expect(await tickets()).toEqual([]);
    });

    it('closes a public entry of a part while it is off', async () => {
      const stored = readAppModules((await manifestsRepo(s.meta, { encrypt: (v) => v, decrypt: (v) => v }).findByKey('desk'))!.row.modules);
      expect(stored?.doors).toEqual({ desk_vans: 'fleet' });
      expect(await publicEntryPartOff(s.meta, 'desk', 'desk_vans')).toBe(false);
      expect((await flip('fleet', false)).statusCode).toBe(200);
      expect(await publicEntryPartOff(s.meta, 'desk', 'desk_vans')).toBe(true);
      expect(await publicEntryPartOff(s.meta, null, 'desk_vans')).toBe(false);
      // Every door of the public API reads the key through this: the entry is not in it.
      const key = { managedBy: 'desk', scope: { byRef: new Map<string, unknown>([['desk_vans', 1], ['desk_tickets', 2]]) } };
      expect([...(await withOpenDoors(s.meta, key)).scope.byRef.keys()]).toEqual(['desk_tickets']);
      expect((await flip('fleet', true)).statusCode).toBe(200);
      expect(await withOpenDoors(s.meta, key)).toBe(key);
    });

    it('says what is open in a part before it is switched off', async () => {
      expect((await flip('jobs', true)).statusCode).toBe(200);
      const open = await get('owner', '/api/v1/apps/desk/parts/jobs/open');
      expect(open.statusCode, open.body).toBe(200);
      // One job is not done; two rules are on; the fitter and the site tablet would be left with nothing.
      expect(open.json()).toEqual({ id: 'jobs', label: 'Jobs on site', open: [{ table: 'jobs', label: 'Jobs', rows: 1 }], rules: 2, pages: 1, stranded: 2 });
      expect((await flip('jobs', false)).statusCode).toBe(200);
    });

    it('is on at once when switched on: the page, the roles, the rules', async () => {
      const on = await flip('jobs', true);
      expect(on.statusCode, on.body).toBe(200);
      expect(on.json().parts[1]).toMatchObject({ id: 'jobs', switch: true, on: true });
      expect(said(await get('owner', `/api/v1/pages/${await pageId('desk-jobs')}`))).toBe('ok');
      expect(await menu('owner')).toContain('desk-jobs');
      expect(said(await list('fitter', 'jobs'))).toBe('ok');
      expect((await bootstrap('fitter')).partsOff).toBeUndefined();
      expect(said(await list('dispatcher', 'jobs'))).toBe('ok');
      expect((await get('agent', '/apps/desk/staff/surface-config.json')).json().modules).toEqual({ front: true, jobs: true, fleet: true });

      // What happened while it was off is not replayed for a rule set off by a write…
      await s.jobs();
      expect(await tickets()).toEqual([]);
      // …and a row a "once" rule has not visited was not used up: the clock finds it now.
      expect(await s.tick()).toBe(1);
      await s.jobs();
      expect(await tickets()).toEqual(['Open: Atrium']);
      // A job made now sets its rule off.
      expect(said(await make('fitter', 'jobs', { title: 'Loft' }))).toBe('ok');
      await s.jobs();
      expect((await tickets()).sort()).toEqual(['Job: Loft', 'Open: Atrium']);
    });

    it('passes over a run that was claimed before the part was switched off', async () => {
      expect(said(await make('fitter', 'jobs', { title: 'Mews' }))).toBe('ok');
      expect((await flip('jobs', false)).statusCode).toBe(200);
      await s.jobs();
      expect(await tickets()).not.toContain('Job: Mews');
      const skipped = await s.meta.db.selectFrom('adminium_automation_runs').select(['status', 'trace']).where('status', '=', 'skipped').execute();
      expect(skipped).toHaveLength(1);
      expect(JSON.stringify(skipped[0]!.trace)).toContain('Its part of the app is switched off.');
      // Off again: by address and for its roles.
      expect(said(await get('owner', `/api/v1/pages/${await pageId('desk-jobs')}`))).toBe('409 PART_OFF');
      expect(said(await list('fitter', 'jobs'))).toBe('403 TABLE_FORBIDDEN');
    });

    it('has no switch for a part that is always on, nor for one the app does not have', async () => {
      expect(said(await flip('front', false))).toBe('409 PART_ALWAYS_ON');
      expect(said(await flip('vans', true))).toBe('404 NOT_FOUND');
      expect(said(await s.app.inject({ method: 'PUT', url: '/api/v1/apps/desk/parts/jobs', headers: { cookie: s.cookie['agent']! }, payload: { on: true } }))).toMatch(/^403/);
    });

    it('asked once whether maps are shown, and keeps the answer for the whole install', async () => {
      expect(await settingsRepo(s.meta).get('maps.enabled')).toBe(false);
      // The answer counts at once: the next reply's policy names no map server.
      const after = await s.app.inject({ method: 'GET', url: '/api/v1/bootstrap', headers: { cookie: s.cookie['owner']! } });
      expect(String(after.headers['content-security-policy'])).not.toContain('openfreemap');
      expect((after.json() as { data: { maps?: { server: string | null } } }).data.maps?.server).toBeNull();
      // Answered: a later check of an app that shows maps does not ask again.
      const again = await s.app.inject({ method: 'POST', url: '/api/v1/apps/plan', headers: { cookie: s.cookie['owner']! }, payload: { key: 'desk', version: '0.1.0', connectionId: s.connectionId } });
      expect(again.statusCode, again.body).toBe(200);
      expect((again.json() as { plan: { maps?: boolean } }).plan.maps).toBeUndefined();
    });

    it('keeps the rules of the part with their part', async () => {
      const rules = await automationsRepo(s.meta).listManagedBy('desk', s.connectionId);
      expect(rules.map((rule) => [rule.templateKey, rule.module]).sort()).toEqual([
        ['job-made', 'jobs'],
        ['job-open', 'jobs'],
      ]);
    });
  });
}
