// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A small sales firm on a real database of each engine, for the row-limit
 * tests: the whole server, its tables made in SQL (so the tests do not wait
 * on an app's install), the words that say whose a row is written as an
 * owner would write them, and people who sign in with a password.
 *
 * ── THE FIRM ───────────────────────────────────────────────────────────────
 * North is led by Mara, with Dana and Omar. South is led by Lena, with Sam;
 * Mara also SITS in South and leads nothing there. Kim is on crew 1.
 *
 *   deals       1 Dana open   2 Dana won   3 Omar open   4 Omar lost
 *               5 Lena open   6 Sam won    7 nobody open 8 Sam open   9 Lena won
 *   helpers     Dana is on deal 5 (Lena's)
 *   cover       Omar covers Sam from 2026-08-10 to 2026-08-21
 *               Dana covers Lena from 2026-09-01, with no end
 *   quotes      1→deal 1   2→deal 3   3→deal 5   4→deal 7   5→no deal
 *   lines       1→quote 1  2→quote 2  3→quote 3
 *   deliveries  1 crew 1 (Kim)   2 crew 2 (Sam)   3 no crew
 *   tickets     1→agent 1 (Dana) 2→agent 2 (Omar) 3 nobody   4→agent 3 (no person)
 *   one-to-ones 1 Mara+Dana   2 Lena+Sam   3 Mara+Omar        (private)
 */
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { sql, type Kysely } from 'kysely';
import { expect } from 'vitest';
import { parseDatabaseModel } from '@adminium/engine';
import { AdapterRegistry, type AdapterProvider } from '@adminium/engine/adapter';
import { createFirstSuperAdmin, createSqliteMetaDb, firstRun, overridesRepo, permissionsRepo, rolesRepo, snapshotsRepo, teamsRepo, usersRepo, type MetaDb, type RowLimit } from '@adminium/meta';

import type { AdminiumServer } from '../src/app.js';
import { composeServer } from '../src/compose.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { applyOverrides, type BelongsWay, type EffectiveModel } from '../src/connections/effective-schema.js';
import { runIntrospection } from '../src/connections/introspect.js';
import { ConnectionManager, type SourceDatabase } from '../src/connections/manager.js';
import { registerAdapters } from '../src/connections/register-adapters.js';
import { rowLimitFor, type RowAction, type RowLimitContext } from '../src/crud/row-limit.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import { resolvePermissionSet, type PermissionSet } from '../src/rbac/resolver.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

export type Dialect = 'sqlite' | 'postgres' | 'mysql';
export const POSTGRES_URL = process.env.TEST_POSTGRES_URL || undefined;
export const MYSQL_URL = process.env.TEST_MYSQL_URL || undefined;
export const ENGINES: [Dialect, boolean][] = [
  ['sqlite', true],
  ['postgres', POSTGRES_URL !== undefined],
  ['mysql', MYSQL_URL !== undefined],
];

export const TABLES = ['deals', 'deal_members', 'covers', 'quotes', 'quote_lines', 'crews', 'crew_members', 'deliveries', 'agents', 'tickets', 'one_to_ones', 'companies'] as const;
export type TableName = (typeof TABLES)[number];

/** The tables in SQL every engine takes: explicit keys, table-level foreign keys (MySQL reads no other kind). */
const DDL: readonly string[] = [
  `CREATE TABLE companies (id INTEGER PRIMARY KEY, name VARCHAR(80) NOT NULL)`,
  `CREATE TABLE deals (id INTEGER PRIMARY KEY, title VARCHAR(80) NOT NULL, owner_id VARCHAR(36), state VARCHAR(10) NOT NULL, amount INTEGER NOT NULL, big BOOLEAN NOT NULL, company_id INTEGER, FOREIGN KEY (company_id) REFERENCES companies(id))`,
  `CREATE TABLE deal_members (id INTEGER PRIMARY KEY, deal_id INTEGER NOT NULL, user_id VARCHAR(36) NOT NULL, FOREIGN KEY (deal_id) REFERENCES deals(id))`,
  `CREATE TABLE covers (id INTEGER PRIMARY KEY, owner_id VARCHAR(36) NOT NULL, cover_id VARCHAR(36) NOT NULL, starts_on DATE NOT NULL, ends_on DATE)`,
  `CREATE TABLE quotes (id INTEGER PRIMARY KEY, deal_id INTEGER, total INTEGER NOT NULL, FOREIGN KEY (deal_id) REFERENCES deals(id))`,
  `CREATE TABLE quote_lines (id INTEGER PRIMARY KEY, quote_id INTEGER NOT NULL, amount INTEGER NOT NULL, FOREIGN KEY (quote_id) REFERENCES quotes(id))`,
  `CREATE TABLE crews (id INTEGER PRIMARY KEY, name VARCHAR(40) NOT NULL)`,
  `CREATE TABLE crew_members (id INTEGER PRIMARY KEY, crew_id INTEGER NOT NULL, user_id VARCHAR(36) NOT NULL, FOREIGN KEY (crew_id) REFERENCES crews(id))`,
  `CREATE TABLE deliveries (id INTEGER PRIMARY KEY, crew_id INTEGER, place VARCHAR(80) NOT NULL, FOREIGN KEY (crew_id) REFERENCES crews(id))`,
  `CREATE TABLE agents (id INTEGER PRIMARY KEY, name VARCHAR(40) NOT NULL, user_id VARCHAR(36))`,
  `CREATE TABLE tickets (id INTEGER PRIMARY KEY, subject VARCHAR(80) NOT NULL, assignee_id INTEGER, FOREIGN KEY (assignee_id) REFERENCES agents(id))`,
  `CREATE TABLE one_to_ones (id INTEGER PRIMARY KEY, manager_id VARCHAR(36) NOT NULL, rep_id VARCHAR(36) NOT NULL, note VARCHAR(200) NOT NULL)`,
];

export const PEOPLE = ['mara', 'dana', 'omar', 'lena', 'sam', 'kim'] as const;
export type PersonName = (typeof PEOPLE)[number];

/** How people belong to each table's rows, with a listing's table by its short name. */
export const BELONGS: Partial<Record<TableName, BelongsWay[]>> = {
  deals: [
    { column: 'owner_id', set: 'team' },
    { through: { table: 'deal_members', link: 'deal_id', user: 'user_id' } },
    { through: { table: 'covers', link: 'owner_id', on: 'owner_id', user: 'cover_id', from: 'starts_on', to: 'ends_on' } },
  ],
  quotes: [{ via: 'deal_id' }],
  quote_lines: [{ via: 'quote_id' }],
  deliveries: [{ through: { table: 'crew_members', link: 'crew_id', on: 'crew_id', user: 'user_id' } }],
  tickets: [{ column: 'assignee_id', person: 'user_id', set: 'anyone' }],
  one_to_ones: [{ column: 'manager_id' }, { column: 'rep_id', set: 'team' }],
};
export const STAFF_COLUMNS: [TableName, string][] = [
  ['deals', 'owner_id'],
  ['deal_members', 'user_id'],
  ['covers', 'owner_id'],
  ['covers', 'cover_id'],
  ['crew_members', 'user_id'],
  ['agents', 'user_id'],
  ['one_to_ones', 'manager_id'],
  ['one_to_ones', 'rep_id'],
];

/** A day inside Omar's cover for Sam, and before Dana's for Lena. */
export const IN_COVER = '2026-08-15';

export interface Signed {
  id: string;
  cookie: string;
}

export interface World {
  dialect: Dialect;
  app: AdminiumServer;
  meta: MetaDb;
  manager: ConnectionManager;
  connectionId: string;
  db: Kysely<SourceDatabase>;
  /** The real id of a table (`public.deals`, `main.deals`). */
  id: (table: TableName) => string;
  /** Each person's user id. */
  people: Record<PersonName, string>;
  /** The Super Admin who owns the workspace. */
  owner: Signed;
  run: (statement: string) => Promise<void>;
  rows: (statement: string) => Promise<Record<string, unknown>[]>;
  /** The whole model as the server reads it now. */
  model: () => Promise<EffectiveModel>;
  /** A role holding these table actions, each with the rows it reaches; `also` are grant rows made as given. */
  role: (slug: string, tables: Partial<Record<TableName, { actions: RowAction[] | ('create' | RowAction)[]; rows?: RowLimit }>>) => Promise<string>;
  /** Give a person a role by its slug. */
  give: (person: PersonName, slug: string) => Promise<void>;
  take: (person: PersonName, slug: string) => Promise<void>;
  /** The permission set of a person as the server resolves it. */
  setOf: (person: PersonName) => Promise<PermissionSet>;
  /** What a person's `action` reaches of a table: the test's context. */
  contextOf: (set: Pick<PermissionSet, 'superAdmin' | 'rowLimits' | 'reach'>, today?: string) => Promise<RowLimitContext>;
  /** The keys of the rows a permission set reaches, in order; `'all'` when nothing limits it. */
  reached: (set: Pick<PermissionSet, 'superAdmin' | 'rowLimits' | 'reach'>, table: TableName, action?: RowAction, today?: string) => Promise<number[] | 'all'>;
  /** Sign a person in; the cookie is kept for the next call. */
  signIn: (person: PersonName) => Promise<Signed>;
  /** Replace how people belong to a table's rows. */
  belongs: (table: TableName, ways: BelongsWay[] | null) => Promise<void>;
  /** Mark a table private, or not. */
  private: (table: TableName, on: boolean) => Promise<void>;
  close: () => Promise<void>;
}

async function sourceDatabase(dialect: Dialect, dataDir: string): Promise<{ dsn: string; drop: () => Promise<void> }> {
  const name = `adminium_rowlimit_${randomBytes(4).toString('hex')}`;
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

export async function world(dialect: Dialect): Promise<World> {
  const dataDir = await mkdtemp(join(tmpdir(), 'row-limit-'));
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  const hash = await adminPasswordHash();
  await createFirstSuperAdmin(meta, { email: 'owner@firm.test', name: 'Owner', passwordHash: hash });
  const registry = new AdapterRegistry<AdapterProvider>();
  await registerAdapters(registry);
  const manager = new ConnectionManager({ meta, crypto: dsnCryptoFromSecret(TEST_SECRET), registry, metaDsn: null, blockLoopback: false });
  const source = await sourceDatabase(dialect, dataDir);
  const connection = await manager.connections.create({ name: 'Firm', engine: dialect, introspectDsn: source.dsn, dataDsn: source.dsn });
  const { db } = await manager.data(connection.id);
  const run = async (statement: string): Promise<void> => {
    await sql.raw(statement).execute(db);
  };
  for (const statement of DDL) await run(statement);

  const users = usersRepo(meta);
  const people = {} as Record<PersonName, string>;
  for (const name of PEOPLE) people[name] = (await users.create({ email: `${name}@firm.test`, name: name[0]!.toUpperCase() + name.slice(1), passwordHash: hash })).id;
  const teams = teamsRepo(meta);
  const north = await teams.create('North');
  const south = await teams.create('South');
  await teams.setMember(north.id, people.mara, true);
  await teams.setMember(north.id, people.dana, false);
  await teams.setMember(north.id, people.omar, false);
  await teams.setMember(south.id, people.lena, true);
  await teams.setMember(south.id, people.sam, false);
  await teams.setMember(south.id, people.mara, false);

  const q = (value: string | null): string => (value === null ? 'NULL' : `'${value}'`);
  const yes = (value: boolean): string => (dialect === 'postgres' ? String(value) : value ? '1' : '0');
  await run(`INSERT INTO companies (id, name) VALUES (1, 'Harbour Hotels'), (2, 'Northfield Dental')`);
  const deals: [number, PersonName | null, string, number][] = [
    [1, 'dana', 'open', 12000],
    [2, 'dana', 'won', 30000],
    [3, 'omar', 'open', 8000],
    [4, 'omar', 'lost', 5000],
    [5, 'lena', 'open', 20000],
    [6, 'sam', 'won', 15000],
    [7, null, 'open', 9000],
    [8, 'sam', 'open', 7000],
    [9, 'lena', 'won', 40000],
  ];
  for (const [key, owner, state, amount] of deals) {
    await run(`INSERT INTO deals (id, title, owner_id, state, amount, big, company_id) VALUES (${String(key)}, 'Deal ${String(key)}', ${q(owner === null ? null : people[owner])}, '${state}', ${String(amount)}, ${yes(amount >= 20000)}, ${String(key % 2 === 0 ? 2 : 1)})`);
  }
  await run(`INSERT INTO deal_members (id, deal_id, user_id) VALUES (1, 5, '${people.dana}')`);
  await run(`INSERT INTO covers (id, owner_id, cover_id, starts_on, ends_on) VALUES (1, '${people.sam}', '${people.omar}', '2026-08-10', '2026-08-21'), (2, '${people.lena}', '${people.dana}', '2026-09-01', NULL)`);
  await run(`INSERT INTO quotes (id, deal_id, total) VALUES (1, 1, 100), (2, 3, 200), (3, 5, 300), (4, 7, 400), (5, NULL, 500)`);
  await run(`INSERT INTO quote_lines (id, quote_id, amount) VALUES (1, 1, 10), (2, 2, 20), (3, 3, 30)`);
  await run(`INSERT INTO crews (id, name) VALUES (1, 'Crew one'), (2, 'Crew two'), (3, 'Crew of nobody')`);
  await run(`INSERT INTO crew_members (id, crew_id, user_id) VALUES (1, 1, '${people.kim}'), (2, 2, '${people.sam}')`);
  await run(`INSERT INTO deliveries (id, crew_id, place) VALUES (1, 1, 'Harbour'), (2, 2, 'Northfield'), (3, NULL, 'Unplanned'), (4, 3, 'Nobody on it')`);
  await run(`INSERT INTO agents (id, name, user_id) VALUES (1, 'Dana', '${people.dana}'), (2, 'Omar', '${people.omar}'), (3, 'A bot', NULL)`);
  await run(`INSERT INTO tickets (id, subject, assignee_id) VALUES (1, 'One', 1), (2, 'Two', 2), (3, 'Three', NULL), (4, 'Four', 3)`);
  await run(`INSERT INTO one_to_ones (id, manager_id, rep_id, note) VALUES (1, '${people.mara}', '${people.dana}', 'Dana, August'), (2, '${people.lena}', '${people.sam}', 'Sam, August'), (3, '${people.mara}', '${people.omar}', 'Omar, August')`);

  await runIntrospection({ manager, meta, connectionId: connection.id });
  const snapshot = parseDatabaseModel((await snapshotsRepo(meta).latest(connection.id))!.schema);
  const id = (table: TableName): string => snapshot.tables.find((one) => one.name === table)!.id;
  const overrides = overridesRepo(meta);
  for (const [table, column] of STAFF_COLUMNS) await overrides.create({ connectionId: connection.id, op: 'column.staff', tableName: id(table), columnName: column, value: { staff: true }, origin: 'user' });
  const real = (ways: BelongsWay[]): BelongsWay[] => ways.map((way) => ('through' in way ? { through: { ...way.through, table: id(way.through.table as TableName) } } : way));
  const belongs = async (table: TableName, ways: BelongsWay[] | null): Promise<void> => {
    await meta.db.deleteFrom('adminium_schema_overrides').where('connectionId', '=', connection.id).where('op', '=', 'table.belongs' as never).where('tableName', '=', id(table)).execute();
    if (ways !== null) await overrides.create({ connectionId: connection.id, op: 'table.belongs', tableName: id(table), value: { ways: real(ways) }, origin: 'user' });
  };
  for (const [table, ways] of Object.entries(BELONGS)) await belongs(table as TableName, ways);
  const setPrivate = async (table: TableName, on: boolean): Promise<void> => {
    await meta.db.deleteFrom('adminium_schema_overrides').where('connectionId', '=', connection.id).where('op', '=', 'table.private' as never).where('tableName', '=', id(table)).execute();
    if (on) await overrides.create({ connectionId: connection.id, op: 'table.private', tableName: id(table), value: { private: true }, origin: 'user' });
  };
  await setPrivate('one_to_ones', true);

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

  const signInAs = async (email: string): Promise<string> => {
    signIns += 1;
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.7.${String(Math.floor(signIns / 250))}.${String(signIns % 250)}`, payload: { email, password: ADMIN_PASSWORD } });
    expect(res.statusCode, res.body).toBe(200);
    return sessionCookie(res.headers['set-cookie']);
  };
  const ownerId = (await users.findByEmail('owner@firm.test'))!.id;
  const cookies = new Map<PersonName, string>();
  const model = async (): Promise<EffectiveModel> => {
    const latest = parseDatabaseModel((await snapshotsRepo(meta).latest(connection.id))!.schema);
    return applyOverrides(latest, await overrides.listForConnection(connection.id, { status: 'active' }));
  };
  const contextOf: World['contextOf'] = async (set, today = IN_COVER) => ({ set, connectionId: connection.id, model: await model(), today });

  return {
    dialect,
    app,
    meta,
    manager,
    connectionId: connection.id,
    db,
    id,
    people,
    owner: { id: ownerId, cookie: await signInAs('owner@firm.test') },
    run,
    rows: async (statement) => (await sql.raw<Record<string, unknown>>(statement).execute(db)).rows,
    model,
    role: async (slug, tables) => {
      const role = (await rolesRepo(meta).findBySlug(slug)) ?? (await rolesRepo(meta).create({ slug, name: slug }));
      for (const [table, grant] of Object.entries(tables)) {
        const actions = { read: false, create: false, update: false, delete: false, export: false, import: false, ...Object.fromEntries(grant.actions.map((action) => [action, true])) };
        await permissionsRepo(meta).grant(role.id, 'table', `${connection.id}/${id(table as TableName)}`, { ...actions, ...(grant.rows === undefined ? {} : { rowLimit: grant.rows }) } as never);
      }
      return role.id;
    },
    give: async (person, slug) => {
      await rolesRepo(meta).assignToUser(people[person], (await rolesRepo(meta).findBySlug(slug))!.id);
    },
    take: async (person, slug) => {
      await rolesRepo(meta).removeFromUser(people[person], (await rolesRepo(meta).findBySlug(slug))!.id);
    },
    setOf: (person) => resolvePermissionSet(meta, { kind: 'user', id: people[person], label: person }),
    contextOf,
    reached: async (set, table, action = 'read', today = IN_COVER) => {
      const test = rowLimitFor(await contextOf(set, today), id(table), action);
      if (test === null) return 'all';
      const found = await db
        .selectFrom(id(table))
        .select('id')
        .where(test(db, table))
        .orderBy('id')
        .execute();
      return found.map((row) => Number((row as { id: unknown }).id));
    },
    signIn: async (person) => {
      const cookie = cookies.get(person) ?? (await signInAs(`${person}@firm.test`));
      cookies.set(person, cookie);
      return { id: people[person], cookie };
    },
    belongs,
    private: setPrivate,
    close: async () => {
      await app.close();
      await manager.disposeAll().catch(() => undefined);
      await source.drop();
      await meta.db.destroy();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}
