// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The assistant follows the tab's workspace, on SQLite, PostgreSQL and MySQL.
 *
 * One server runs two businesses: Fernhill Coffee (`fernhill`) and Kiln
 * Street Pottery (`kiln`), each a workspace, with `suppliers` in both, a
 * `scratch` database in none ("Other databases"), a Warehouse workspace of
 * 22 databases, and an Empty one. Then, through the routes and the tools as
 * a turn runs them:
 *
 *  - asked with a workspace, the assistant sees that workspace's databases
 *    and no other: the page facts and the prompt, `list_connections`,
 *    `describe_schema`, every row tool, and where a proposal may land;
 *  - asked with none, it sees every database the person reaches, as before;
 *  - a workspace of 22 databases is not held to the 20 a host may list;
 *  - an empty workspace narrows to nothing, never widens to everything;
 *  - an unknown workspace, or one the person does not see, is not found;
 *  - rights are still asked table by table inside the workspace;
 *  - a client cannot name the databases itself: the server resolves them.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyClassification, parseDatabaseModel, type DatabaseModel } from '@adminium/engine';
import {
  assistantSessionsRepo,
  pagesRepo,
  permissionsRepo,
  rolesRepo,
  snapshotsRepo,
  usersRepo,
  workspacesRepo,
  type AssistantHost,
  type MetaDb,
  type User,
} from '@adminium/meta';

import { WORKSPACE_PROMPT_NOTE } from '../src/assistant/page-facts.js';
import { placeFor } from '../src/assistant/proposals.js';
import { aggregateTool } from '../src/assistant/tools/aggregate.js';
import { rulePartsTool } from '../src/assistant/tools/rule-parts.js';
import { readRowsTool, sampleRecordTool } from '../src/assistant/tools/rows.js';
import { describeSchemaTool, listConnectionsTool } from '../src/assistant/tools/schema.js';
import { setUpTurn } from '../src/assistant/turn-setup.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { permissionSetAllows, resolvePermissionSet } from '../src/rbac/resolver.js';
import { assistantRoutes } from '../src/routes/assistant/index.js';
import { TEST_SECRET } from './helpers.js';
import { buildBareApp, type BareApp } from './jobs-helpers.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

const table = (name: string, columns: string[]) => ({
  schema: 'public',
  name,
  primaryKey: ['id'],
  columns: columns.map((column) => ({ name: column, logicalType: column === 'id' ? 'integer' : 'text', nullable: column !== 'id', ...(column === 'id' ? { isPrimaryKey: true, default: { kind: 'autoincrement' } } : {}) })),
});
/** Every database here holds the same two tables. */
const MODEL = applyClassification(
  parseDatabaseModel({
    dialect: 'postgres',
    name: 'shop',
    defaultSchema: 'public',
    schemas: ['public'],
    tables: [table('orders', ['id', 'note']), table('customers', ['id', 'name'])],
    relations: [],
  }),
) as DatabaseModel;
const TABLES_EACH = 2;
const WAREHOUSE_SIZE = 22;

interface Facts {
  facts: { values: { tables: number } };
}

describe.each(META_ENGINES)('the assistant in the tab\'s workspace — $name', (engine) => {
  let handle: MetaHandle;
  let meta: MetaDb;
  let manager: ConnectionManager;
  let app: BareApp;
  let owner: User;
  let clerk: User;
  const db: Record<string, string> = {};
  const ws: Record<string, string> = {};
  const warehouse: string[] = [];
  let all = 0;

  beforeAll(async () => {
    if (!engine.available) return;
    handle = await engine.make();
    meta = handle.meta;
    manager = new ConnectionManager({ meta, crypto: dsnCryptoFromSecret(TEST_SECRET), metaDsn: null, blockLoopback: false });
    const make = async (name: string) => {
      const connection = await manager.connections.create({ name, engine: 'postgres', introspectDsn: `postgres://ro@db.internal:5432/${name}` });
      await snapshotsRepo(meta).create({ connectionId: connection.id, source: 'introspection', schema: MODEL, checksum: `c-${name}` } as never);
      return connection.id;
    };
    for (const name of ['fernhill', 'kiln', 'suppliers', 'scratch']) db[name] = await make(name);
    for (let at = 1; at <= WAREHOUSE_SIZE; at++) warehouse.push(await make(`shelf-${String(at).padStart(2, '0')}`));
    all = 4 + WAREHOUSE_SIZE;
    const workspaces = workspacesRepo(meta);
    ws.coffee = (await workspaces.create({ name: 'Fernhill Coffee', connectionIds: [db.fernhill!, db.suppliers!] })).id;
    ws.kiln = (await workspaces.create({ name: 'Kiln Street Pottery', connectionIds: [db.kiln!, db.suppliers!] })).id;
    ws.warehouse = (await workspaces.create({ name: 'Warehouse', connectionIds: warehouse })).id;
    ws.empty = (await workspaces.create({ name: 'Empty' })).id;

    const users = usersRepo(meta);
    const roles = rolesRepo(meta);
    const permissions = permissionsRepo(meta);
    owner = await users.create({ email: 'owner@adminium.test', name: 'Owner', status: 'active' });
    await roles.assignToUser(owner.id, (await roles.findBySlug('super-admin'))!.id);
    // The clerk opens one Kiln page and reads one Kiln table: Kiln is the one workspace they see.
    clerk = await users.create({ email: 'clerk@adminium.test', name: 'Clerk', status: 'active' });
    const role = await roles.create({ slug: 'kiln-clerk', name: 'Kiln clerk' });
    await roles.assignToUser(clerk.id, role.id);
    const page = await pagesRepo(meta).create({ connectionId: db.kiln!, slug: 'kiln-orders', type: 'page-crud', title: 'Kiln orders', config: { source: { table: 'public.orders' } } });
    await permissions.grant(role.id, 'page', page.id, { view: true, edit: false } as never);
    await permissions.grant(role.id, 'table', `${db.kiln!}/public.orders`, { read: true, create: false, update: false, delete: false, export: false, import: false } as never);
    await permissions.grant(role.id, 'system', 'assistant.use', { allowed: true });

    app = buildBareApp();
    app.addHook('onRequest', async (request) => {
      const id = request.headers['x-test-user-id'];
      if (typeof id === 'string' && id.length > 0) (request as unknown as { user: { id: string; name: string } }).user = { id, name: id };
    });
    await app.register(rbacPlugin, { meta });
    await app.register(assistantRoutes({ meta, manager, networkFeatures: false }));
    await app.ready();
  }, 180_000);

  afterAll(async () => {
    if (!engine.available) return;
    await app.close();
    await handle.destroy();
  });

  const post = (url: string, user: User, payload: Record<string, unknown>) => app.inject({ method: 'POST', url, headers: { 'x-test-user-id': user.id }, payload });
  const factsFor = (user: User, host: Record<string, unknown>) => post('/assistant/facts', user, { context: 'general', host: { connectionIds: [], ...host } });

  /** The host a turn is stored with, as the route resolved it: what the job then runs with. */
  async function askedWith(user: User, host: Record<string, unknown>): Promise<{ status: number; host: AssistantHost | null }> {
    const sessions = assistantSessionsRepo(meta);
    const session = await sessions.create({ context: 'general', host: { connectionIds: [] }, createdBy: user.id, kind: 'panel' });
    const res = await post(`/assistant/sessions/${session.id}/turns`, user, { text: 'What is here?', context: 'general', host: { connectionIds: [], ...host } });
    if (res.statusCode !== 202) return { status: res.statusCode, host: null };
    const turn = await sessions.findTurn((res.json() as { turn: { id: string } }).turn.id);
    // One question at a time a person: this one is done with, so the next may be asked.
    await meta.db.updateTable('adminium_assistant_turns').set({ status: 'done' }).where('id', '=', turn!.id).execute();
    return { status: res.statusCode, host: turn!.host };
  }

  /** A turn's setup, as the job builds it from the stored host. */
  async function turnAs(user: User, host: AssistantHost) {
    const set = await resolvePermissionSet(meta, { kind: 'user', id: user.id, label: user.id });
    return setUpTurn({ meta, manager, context: 'general', host, userId: user.id, can: async (permission) => permissionSetAllows(set, permission) });
  }

  const names = (result: unknown) => ((result as { connections: { name: string }[] }).connections.map((row) => row.name)).sort();

  it.skipIf(!engine.available)('with a workspace, sees its databases only: facts, prompt, list_connections, describe_schema and every row tool', async () => {
    const facts = await factsFor(owner, { workspaceId: ws.kiln });
    expect(facts.statusCode, facts.body).toBe(200);
    expect((facts.json() as Facts).facts.values.tables).toBe(2 * TABLES_EACH);

    const asked = await askedWith(owner, { workspaceId: ws.kiln });
    expect(asked.status).toBe(202);
    expect(asked.host).toMatchObject({ workspaceId: ws.kiln, workspaceConnectionIds: [db.kiln!, db.suppliers!].sort() });

    const turn = await turnAs(owner, asked.host!);
    expect(turn.system).toContain(WORKSPACE_PROMPT_NOTE);
    expect(turn.system).toContain('kiln');
    expect(turn.system).not.toContain('fernhill');
    expect(turn.system).not.toContain('shelf-');
    const listed = await listConnectionsTool.run({}, turn.deps);
    expect(names(listed.result)).toEqual(['kiln', 'suppliers']);

    const inside = await describeSchemaTool.run({ connectionId: db.kiln! }, turn.deps);
    expect((inside.result as { tables: { id: string }[] }).tables.map((row) => row.id).sort()).toEqual(['public.customers', 'public.orders']);
    // Outside it, every tool that opens a database answers as if it were not connected, before opening it.
    const outside = { code: 'NOT_FOUND', message: 'That database is not in this workspace. Call list_connections for the ones here.' };
    expect((await describeSchemaTool.run({ connectionId: db.fernhill! }, turn.deps)).error).toEqual(outside);
    expect((await readRowsTool.run({ connectionId: db.fernhill!, table: 'public.orders' }, turn.deps)).error).toEqual(outside);
    expect((await sampleRecordTool.run({ connectionId: db.scratch!, table: 'public.orders' }, turn.deps)).error).toEqual(outside);
    expect((await aggregateTool.run({ connectionId: db.fernhill!, descriptor: { table: 'public.orders', measures: [{ fn: 'count' }] } }, turn.deps)).error).toEqual(outside);
    expect((await rulePartsTool.run({ connectionId: db.fernhill!, table: 'public.orders' }, turn.deps)).error).toEqual(outside);
  });

  it.skipIf(!engine.available)('places a proposal inside the workspace only, and an empty workspace places none', async () => {
    const kiln = await turnAs(owner, (await askedWith(owner, { workspaceId: ws.kiln })).host!);
    const place = await placeFor(kiln.deps);
    expect(await place({ connectionId: db.suppliers!, table: 'public.orders' })).toEqual({ ok: true, connectionId: db.suppliers!, table: 'public.orders' });
    expect(await place({ connectionId: db.fernhill!, table: 'public.orders' })).toMatchObject({ ok: false, refusal: { code: 'NOT_A_DATA_TABLE' } });

    const asked = await askedWith(owner, { workspaceId: ws.empty });
    expect(asked.host).toMatchObject({ workspaceConnectionIds: [] });
    const empty = await turnAs(owner, asked.host!);
    // Narrowed to nothing, never widened to everything.
    expect(names((await listConnectionsTool.run({}, empty.deps)).result)).toEqual([]);
    expect(await (await placeFor(empty.deps))({ connectionId: db.kiln!, table: 'public.orders' })).toMatchObject({ ok: false });
    expect(((await factsFor(owner, { workspaceId: ws.empty })).json() as Facts).facts.values.tables).toBe(0);
  });

  it.skipIf(!engine.available)('with no workspace, sees every database the person reaches, as before', async () => {
    const facts = await factsFor(owner, {});
    expect((facts.json() as Facts).facts.values.tables).toBe(all * TABLES_EACH);
    const asked = await askedWith(owner, {});
    expect(asked.host).not.toHaveProperty('workspaceId');
    expect(asked.host).not.toHaveProperty('workspaceConnectionIds');
    const turn = await turnAs(owner, asked.host!);
    expect(turn.system).not.toContain(WORKSPACE_PROMPT_NOTE);
    expect(names((await listConnectionsTool.run({}, turn.deps)).result)).toHaveLength(all);
    expect((await describeSchemaTool.run({ connectionId: db.fernhill! }, turn.deps)).error).toBeUndefined();
    expect(await (await placeFor(turn.deps))({ connectionId: db.fernhill!, table: 'public.orders' })).toMatchObject({ ok: true });
  });

  it.skipIf(!engine.available)(`lifts the 20-database cap: a workspace of ${String(WAREHOUSE_SIZE)} is read whole`, async () => {
    // A host that lists its databases itself is still held to 20.
    const listed = await factsFor(owner, { connectionIds: warehouse.slice(0, 21) });
    expect(listed.statusCode).toBe(422);

    const facts = await factsFor(owner, { workspaceId: ws.warehouse });
    expect(facts.statusCode, facts.body).toBe(200);
    expect((facts.json() as Facts).facts.values.tables).toBe(WAREHOUSE_SIZE * TABLES_EACH);
    const asked = await askedWith(owner, { workspaceId: ws.warehouse });
    expect(asked.host!.workspaceConnectionIds).toHaveLength(WAREHOUSE_SIZE);
    const turn = await turnAs(owner, asked.host!);
    expect(names((await listConnectionsTool.run({}, turn.deps)).result)).toHaveLength(WAREHOUSE_SIZE);
    expect(await (await placeFor(turn.deps))({ connectionId: warehouse.at(-1)!, table: 'public.customers' })).toMatchObject({ ok: true });
    expect((await describeSchemaTool.run({ connectionId: warehouse.at(-1)! }, turn.deps)).error).toBeUndefined();
  });

  it.skipIf(!engine.available)('takes "other" for the databases in no workspace', async () => {
    const asked = await askedWith(owner, { workspaceId: 'other' });
    expect(asked.host).toMatchObject({ workspaceConnectionIds: [db.scratch!] });
    const turn = await turnAs(owner, asked.host!);
    expect(names((await listConnectionsTool.run({}, turn.deps)).result)).toEqual(['scratch']);
  });

  it.skipIf(!engine.available)('refuses a workspace that does not exist, or one the person does not see, on every route', async () => {
    for (const [user, workspaceId] of [
      [owner, 'wsp_absent'],
      [clerk, ws.coffee!],
      [clerk, ws.warehouse!],
      // The clerk reaches no database in none of them, so "Other databases" is not theirs either.
      [clerk, 'other'],
    ] as const) {
      const facts = await factsFor(user, { workspaceId });
      expect(facts.statusCode, `${user.name} ${workspaceId}`).toBe(404);
      expect((facts.json() as { error: { code: string } }).error.code).toBe('NOT_FOUND');
      expect((await askedWith(user, { workspaceId })).status, `${user.name} ${workspaceId}`).toBe(404);
    }
    expect((await factsFor(owner, { workspaceId: '' })).statusCode).toBe(422);
  });

  it.skipIf(!engine.available)('still asks rights table by table inside the workspace', async () => {
    const facts = await factsFor(clerk, { workspaceId: ws.kiln });
    expect(facts.statusCode, facts.body).toBe(200);
    expect((facts.json() as Facts).facts.values.tables).toBe(1);
    const turn = await turnAs(clerk, (await askedWith(clerk, { workspaceId: ws.kiln })).host!);
    const rows = (await listConnectionsTool.run({}, turn.deps)).result as { connections: { name: string; readableTables: number }[] };
    expect(rows.connections.map((row) => [row.name, row.readableTables]).sort()).toEqual([
      ['kiln', 1],
      ['suppliers', 0],
    ]);
    expect((await describeSchemaTool.run({ connectionId: db.suppliers!, tables: ['public.orders'] }, turn.deps)).error?.code).toBe('TABLE_FORBIDDEN');
    expect(await (await placeFor(turn.deps))({ connectionId: db.kiln!, table: 'public.customers' })).toMatchObject({ ok: false });
  });

  it.skipIf(!engine.available)('never takes the databases from the client: the server resolves them', async () => {
    const facts = await factsFor(owner, { workspaceConnectionIds: [db.fernhill!] });
    expect((facts.json() as Facts).facts.values.tables).toBe(all * TABLES_EACH);
    const asked = await askedWith(owner, { workspaceId: ws.kiln, workspaceConnectionIds: [db.fernhill!] });
    expect(asked.host!.workspaceConnectionIds).toEqual([db.kiln!, db.suppliers!].sort());
  });
});
