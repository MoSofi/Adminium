// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Teams, the people a writer may name, and a role's "which rows" as the role
 * editor reads and saves it.
 *
 * A team's lead reaches the rows of its members, so every team route is the
 * people-manager's; the list of people is anybody's who is signed in, and
 * tells a name and an id only; and a matrix saved by a client that knows
 * nothing of row limits leaves every limit where it was.
 */
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { applyClassification, parseDatabaseModel } from '@adminium/engine';
import { auditRepo, connectionsRepo, createSqliteMetaDb, destroyMetaDb, firstRun, initMetaDb, overridesRepo, permissionsRepo, rolesRepo, snapshotsRepo, teamsRepo, usersRepo, type MetaDb, type Role, type TableActions, type User } from '@adminium/meta';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { rolesRoutes } from '../src/routes/roles/index.js';
import { teamsRoutes } from '../src/routes/teams/index.js';
import { makeEnv } from './helpers.js';

interface Ctx {
  app: AdminiumServer;
  meta: MetaDb;
  people: { ava: User; iris: User; liam: User; dana: User; sam: User; gone: User; sample: User };
  roles: { viewer: Role; custom: Role };
  /** A connection Adminium has read, with one table that says whose its rows are. */
  conn: string;
}
let ctx: Ctx;
afterEach(async () => {
  await ctx.app.close();
  await destroyMetaDb(ctx.meta);
});
const as = (user: User): Record<string, string> => ({ 'x-test-user-id': user.id });

async function build(): Promise<Ctx> {
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await initMetaDb(meta);
  await firstRun(meta);
  const roles = rolesRepo(meta);
  const users = usersRepo(meta);
  const permissions = permissionsRepo(meta);
  const builtin = async (slug: string) => (await roles.findBySlug(slug))!;
  const peopleAdmin = await roles.create({ slug: 'people-admin', name: 'People Admin' });
  await permissions.grant(peopleAdmin.id, 'system', 'users.manage', { allowed: true });
  const custom = await roles.create({ slug: 'rep', name: 'Rep' });
  const make = async (name: string, role: Role | null, status: User['status'] = 'active') => {
    const user = await users.create({ email: `${name.toLowerCase()}@adminium.test`, name, passwordHash: status === 'active' ? 'x' : null, status });
    if (role !== null) await roles.assignToUser(user.id, role.id);
    return user;
  };
  const people = {
    ava: await make('Ava', await builtin('super-admin')),
    iris: await make('Iris', peopleAdmin),
    liam: await make('Liam', await builtin('viewer')),
    dana: await make('Dana', custom),
    sam: await make('Sam', custom),
    gone: await make('Gone', null, 'suspended'),
    sample: await make('Sample Rep', null, 'sample'),
  };
  // A row limit is taken only for a table that is there and says whose its rows are: a database as Adminium read it.
  const conn = (await connectionsRepo(meta, { encrypt: (v: string) => v, decrypt: (v: string) => v }).create({ name: 'Main', engine: 'sqlite', introspectDsn: 'sqlite::memory:', dataDsn: 'sqlite::memory:' })).id;
  const text = (name: string) => ({ name, logicalType: 'text', nullable: true });
  const model = applyClassification(
    parseDatabaseModel({
      dialect: 'sqlite',
      name: 'main',
      defaultSchema: 'main',
      schemas: ['main'],
      tables: [
        { schema: 'main', name: 'deals', primaryKey: ['id'], columns: [{ name: 'id', logicalType: 'integer', nullable: false, isPrimaryKey: true, default: { kind: 'autoincrement' } }, text('owner_id'), text('state')] },
        { schema: 'main', name: 'other', primaryKey: ['id'], columns: [{ name: 'id', logicalType: 'integer', nullable: false, isPrimaryKey: true, default: { kind: 'autoincrement' } }, text('owner_id')] },
      ],
      relations: [],
    }),
  );
  await snapshotsRepo(meta).create({ connectionId: conn, source: 'introspection', schema: model, checksum: 'c1' } as never);
  for (const table of ['main.deals', 'main.other']) {
    await overridesRepo(meta).create({ connectionId: conn, op: 'column.staff', tableName: table, columnName: 'owner_id', value: { staff: true }, origin: 'user' } as never);
    await overridesRepo(meta).create({ connectionId: conn, op: 'table.belongs', tableName: table, columnName: null, value: { ways: [{ column: 'owner_id', set: 'team' }] }, origin: 'user' } as never);
  }
  const app = await buildServer({ env: makeEnv(), logger: false, metaDb: meta });
  app.addHook('onRequest', async (request) => {
    const id = request.headers['x-test-user-id'];
    const user = typeof id === 'string' ? await users.findById(id) : null;
    if (user === null) return;
    // Signed in, as the session cookie would have it.
    Object.assign(request, { user: { id: user.id, name: user.name, email: user.email }, session: { id: 'ses_test', userId: user.id } });
  });
  await app.register(rbacPlugin, { meta });
  await app.register(
    async (api) => {
      await api.register(rolesRoutes);
      await api.register(teamsRoutes);
    },
    { prefix: '/api/v1' },
  );
  await app.ready();
  return { app, meta, people, roles: { viewer: await builtin('viewer'), custom }, conn };
}

const call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, user: User, payload?: unknown) =>
  ctx.app.inject({ method, url: `/api/v1${url}`, headers: as(user), ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });

describe('teams', () => {
  it('are made, renamed, filled, led and removed by whoever manages people, and by nobody else', async () => {
    ctx = await build();
    const { iris, liam, dana, sam } = ctx.people;
    // Reading a team says who works with whom: not for a viewer.
    expect((await call('GET', '/teams', liam)).statusCode).toBe(403);
    expect((await call('POST', '/teams', liam, { name: 'Sales' })).statusCode).toBe(403);

    const made = await call('POST', '/teams', iris, { name: ' Sales ' });
    expect(made.statusCode, made.body).toBe(201);
    const team = made.json() as { id: string; name: string; members: unknown[] };
    expect([team.name, team.members]).toEqual(['Sales', []]);
    expect((await call('POST', '/teams', iris, { name: 'Sales' })).statusCode).toBe(409);

    expect((await call('PUT', `/teams/${team.id}/members/${dana.id}`, iris, { lead: false })).statusCode).toBe(200);
    expect((await call('PUT', `/teams/${team.id}/members/${sam.id}`, iris, { lead: true })).statusCode).toBe(200);
    // A lead reaches the other members' rows: this is what the row limit reads.
    expect((await teamsRepo(ctx.meta).leadReach(sam.id)).ids).toEqual([dana.id]);
    expect((await teamsRepo(ctx.meta).leadReach(dana.id)).ids).toEqual([]);
    // Changing who leads is a change, not a second place in the team.
    const swapped = await call('PUT', `/teams/${team.id}/members/${dana.id}`, iris, { lead: true });
    expect((swapped.json() as { members: { name: string; lead: boolean }[] }).members.map((member) => [member.name, member.lead])).toEqual([
      ['Dana', true],
      ['Sam', true],
    ]);
    expect((await call('PUT', `/teams/${team.id}/members/usr_nobody`, iris, { lead: false })).statusCode).toBe(404);

    const renamed = await call('PATCH', `/teams/${team.id}`, iris, { name: 'North' });
    expect((renamed.json() as { name: string }).name).toBe('North');
    const listed = (await call('GET', '/teams', iris)).json() as { teams: { name: string; members: { name: string; email: string; status: string }[] }[]; reachMax: number; over: unknown[] };
    expect(listed.teams.map((one) => [one.name, one.members.map((member) => member.name)])).toEqual([['North', ['Dana', 'Sam']]]);
    expect([listed.reachMax, listed.over]).toEqual([2000, []]);

    expect((await call('DELETE', `/teams/${team.id}/members/${sam.id}`, iris)).statusCode).toBe(200);
    expect((await call('DELETE', `/teams/${team.id}/members/${sam.id}`, iris)).statusCode).toBe(404);
    expect((await call('DELETE', `/teams/${team.id}`, iris)).statusCode).toBe(200);
    expect(await teamsRepo(ctx.meta).list()).toEqual([]);

    const actions = (await auditRepo(ctx.meta).list({ category: 'rbac' })).map((entry) => entry.action);
    for (const action of ['team.create', 'team.member.add', 'team.member.change', 'team.rename', 'team.member.remove', 'team.delete']) expect(actions, action).toContain(action);
  });
});

describe('the people a writer may name', () => {
  it('are told by name and id to anybody signed in: nothing else, and nobody who cannot be given a row', async () => {
    ctx = await build();
    const { liam, sample } = ctx.people;
    const reply = await call('GET', '/people', liam);
    expect(reply.statusCode, reply.body).toBe(200);
    const people = (reply.json() as { people: Record<string, unknown>[] }).people;
    // Suspended is left out; the sample person is in, and marked.
    expect(people.map((person) => person['name'])).toEqual(['Ava', 'Dana', 'Iris', 'Liam', 'Sam', 'Sample Rep']);
    expect(people.every((person) => Object.keys(person).sort().join() === 'id,name,sample')).toBe(true);
    expect(people.find((person) => person['id'] === sample.id)?.['sample']).toBe(true);
    expect(reply.body).not.toContain('@');

    const some = (await call('GET', '/people?q=sa', liam)).json() as { people: { name: string }[] };
    expect(some.people.map((person) => person.name)).toEqual(['Sam', 'Sample Rep']);
    // Part of an address finds nobody: this route does not confirm one.
    expect(((await call('GET', '/people?q=adminium.test', liam)).json() as { people: unknown[] }).people).toEqual([]);
  });

  it('answers the first by name, however many came later and whoever else matched by address', async () => {
    ctx = await build();
    const { liam } = ctx.people;
    const users = usersRepo(ctx.meta);
    // An old account whose NAME matches, then a crowd of newer ones whose ADDRESS matches and whose name does not.
    await users.create({ email: 'first@adminium.test', name: 'Zed Marlow', passwordHash: 'x', status: 'active' }, 1);
    for (let n = 0; n < 12; n += 1) await users.create({ email: `marlow${String(n)}@adminium.test`, name: `Newcomer ${String(n).padStart(2, '0')}`, passwordHash: 'x', status: 'active' }, 1000 + n);
    const byName = (await call('GET', '/people?q=marlow&limit=5', liam)).json() as { people: { name: string }[] };
    expect(byName.people.map((person) => person.name)).toEqual(['Zed Marlow']);
    // With nothing typed it is the first by name, not the newest made.
    const firsts = (await call('GET', '/people?limit=3', liam)).json() as { people: { name: string }[] };
    expect(firsts.people.map((person) => person.name)).toEqual(['Ava', 'Dana', 'Iris']);
  });

  it('are not told to a request with no person behind it', async () => {
    ctx = await build();
    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/people' })).statusCode).toBe(401);
  });
});

describe('a role\'s "which rows"', () => {

  it('is read with the matrix, set table by table, and kept by a save that does not mention it', async () => {
    ctx = await build();
    const TABLE = `${ctx.conn}/main.deals`;
    const grant = (action: string) => `table:${ctx.conn}:main.deals:${action}`;
    const grants = [grant('read'), grant('update')];
    const { ava } = ctx.people;
    const url = `/roles/${ctx.roles.custom.id}/permissions`;
    const first = await call('PUT', url, ava, { grants, rows: { [TABLE]: { read: { reach: 'team', unowned: true }, update: { reach: 'own' } } } });
    expect(first.statusCode, first.body).toBe(200);
    expect((first.json() as { rows: unknown }).rows).toEqual({ [TABLE]: { read: { reach: 'team', unowned: true }, update: { reach: 'own' } } });
    expect(((await call('GET', url, ava)).json() as { rows: unknown }).rows).toEqual({ [TABLE]: { read: { reach: 'team', unowned: true }, update: { reach: 'own' } } });

    // An older client saves the matrix with a box more ticked and no word of rows: the limit stays.
    const older = await call('PUT', url, ava, { grants: [...grants, grant('export')] });
    expect((older.json() as { rows: unknown }).rows).toEqual({ [TABLE]: { read: { reach: 'team', unowned: true }, update: { reach: 'own' } } });
    const stored = (await permissionsRepo(ctx.meta).listForRole(ctx.roles.custom.id)).find((row) => row.resourceRef === TABLE)!;
    expect((stored.actions as TableActions).rowLimit).toEqual({ read: { reach: 'team', unowned: true }, update: { reach: 'own' } });

    // Narrowed for one action, then taken off altogether.
    const narrowed = await call('PUT', url, ava, { grants, rows: { [TABLE]: { read: { reach: 'own', while: { column: 'state', in: ['open'] } } } } });
    expect((narrowed.json() as { rows: unknown }).rows).toEqual({ [TABLE]: { read: { reach: 'own', while: { column: 'state', in: ['open'] } } } });
    const lifted = await call('PUT', url, ava, { grants, rows: { [TABLE]: null } });
    expect((lifted.json() as { rows: unknown }).rows).toEqual({});

    const entries = await auditRepo(ctx.meta).list({ category: 'rbac' });
    expect(JSON.stringify(entries.filter((entry) => entry.action === 'role.permission.change'))).toContain('"reach":"team"');
  });

  it('refuses a limit on a table the role holds nothing on, and "every row" with no "only while"', async () => {
    ctx = await build();
    const TABLE = `${ctx.conn}/main.deals`;
    const grant = (action: string) => `table:${ctx.conn}:main.deals:${action}`;
    const grants = [grant('read'), grant('update')];
    const { ava, iris } = ctx.people;
    const url = `/roles/${ctx.roles.custom.id}/permissions`;
    const loose = await call('PUT', url, ava, { grants, rows: { [`${ctx.conn}/main.other`]: { read: { reach: 'own' } } } });
    expect([loose.statusCode, loose.body.includes('not-granted')]).toEqual([422, true]);
    const all = await call('PUT', url, ava, { grants, rows: { [TABLE]: { read: { reach: 'all' } } } });
    expect([all.statusCode, all.body.includes('all-without-while')]).toEqual([422, true]);
    expect((await call('PUT', url, ava, { grants, rows: { [TABLE]: { read: { reach: 'all', while: { column: 'state', in: ['won'] } } } } })).statusCode).toBe(200);
    expect((await call('PUT', url, ava, { grants, rows: { [TABLE]: { read: { reach: 'mine' } } } })).statusCode).toBe(422);
    // Managing people is not managing roles.
    expect((await call('PUT', url, iris, { grants })).statusCode).toBe(403);
  });
});
