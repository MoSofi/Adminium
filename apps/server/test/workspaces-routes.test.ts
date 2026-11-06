// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Workspaces through their routes, with real roles:
 *  - made, renamed, reordered, filled and deleted by whoever manages
 *    connections, and by nobody else; every change audited;
 *  - a database may sit in several workspaces, or in none; deleting a
 *    workspace leaves its databases, deleting a database leaves the workspace;
 *  - deleting a workspace lists what it was the only "Shown in" of, which then
 *    shows nowhere — never widened to all;
 *  - the view is one server setting, written beside the other defaults;
 *  - a person's last choice is a workspace they can see, or refused;
 *  - `?workspaceId=` only ever narrows a list: what it returns is a subset of
 *    the list without it, and an unseen workspace is not found.
 */
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  auditRepo,
  connectionsRepo,
  createSqliteMetaDb,
  destroyMetaDb,
  emailTemplatesRepo,
  firstRun,
  initMetaDb,
  pagesRepo,
  permissionsRepo,
  rolesRepo,
  usersRepo,
  workspacesRepo,
  type MetaDb,
  type User,
} from '@adminium/meta';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { pagesRoutes } from '../src/routes/pages/index.js';
import { workspacesRoutes } from '../src/routes/workspaces/index.js';
import { makeEnv } from './helpers.js';

interface Ctx {
  app: AdminiumServer;
  meta: MetaDb;
  owner: User;
  reader: User;
  conn: { fernhill: string; archive: string; kiln: string; suppliers: string };
}
let ctx: Ctx;
afterEach(async () => {
  await ctx.app.close();
  await destroyMetaDb(ctx.meta);
});

const PLAIN = { encrypt: (v: string) => v, decrypt: (v: string) => v };

async function build(): Promise<Ctx> {
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await initMetaDb(meta);
  await firstRun(meta);
  const roles = rolesRepo(meta);
  const users = usersRepo(meta);
  const owner = await users.create({ email: 'owner@adminium.test', name: 'Owner', passwordHash: 'x' });
  await roles.assignToUser(owner.id, (await roles.findBySlug('super-admin'))!.id);
  // Someone who reaches one page of kiln, and nothing else.
  const reader = await users.create({ email: 'reader@adminium.test', name: 'Reader', passwordHash: 'x' });
  const readerRole = await roles.create({ slug: 'kiln-reader', name: 'Kiln reader' });
  await roles.assignToUser(reader.id, readerRole.id);
  const connections = connectionsRepo(meta, PLAIN);
  const make = async (name: string) => (await connections.create({ name, engine: 'sqlite', introspectDsn: 'sqlite::memory:', dataDsn: 'sqlite::memory:' })).id;
  const conn = { fernhill: await make('fernhill'), archive: await make('fernhill_archive'), kiln: await make('kiln'), suppliers: await make('suppliers') };
  const pages = pagesRepo(meta);
  for (const [name, id] of Object.entries(conn)) {
    const page = await pages.create({ connectionId: id, slug: `${name.replace('_', '-')}-orders`, type: 'crud', title: `${name} orders`, config: { v: 1, kind: 'crud', template: 'page-crud', config: {} }, createdBy: null });
    if (id === conn.kiln) await permissionsRepo(meta).grant(readerRole.id, 'page', page.id, { view: true, edit: false } as never);
  }
  const app = await buildServer({ env: makeEnv(), logger: false, metaDb: meta });
  app.addHook('onRequest', async (request) => {
    const id = request.headers['x-test-user-id'];
    const user = typeof id === 'string' ? await users.findById(id) : null;
    if (user === null) return;
    Object.assign(request, { user: { id: user.id, name: user.name, email: user.email }, session: { id: 'ses_test', userId: user.id } });
  });
  await app.register(rbacPlugin, { meta });
  await app.register(
    async (api) => {
      await api.register(workspacesRoutes);
      await api.register(pagesRoutes({ meta }));
    },
    { prefix: '/api/v1' },
  );
  await app.ready();
  return { app, meta, owner, reader, conn };
}

const call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, user: User, payload?: unknown) =>
  ctx.app.inject({ method, url: `/api/v1${url}`, headers: { 'x-test-user-id': user.id }, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });

describe('workspaces', () => {
  it('are made, renamed, reordered, filled and deleted by whoever manages connections, and nobody else', async () => {
    ctx = await build();
    const { owner, reader, conn } = ctx;
    expect((await call('GET', '/workspaces', reader)).statusCode).toBe(403);
    expect((await call('POST', '/workspaces', reader, { name: 'Kiln' })).statusCode).toBe(403);

    const empty = await call('GET', '/workspaces', owner);
    expect(empty.json()).toEqual({ workspaces: [], otherDatabases: null, view: 'all' });

    const coffee = await call('POST', '/workspaces', owner, { name: 'Fernhill Coffee', connectionIds: [conn.fernhill, conn.archive, conn.suppliers] });
    expect(coffee.statusCode, coffee.body).toBe(201);
    expect(coffee.json()).toMatchObject({ first: true, workspace: { name: 'Fernhill Coffee', position: 0 } });
    const kiln = await call('POST', '/workspaces', owner, { name: 'Kiln Street Pottery', connectionIds: [conn.kiln, conn.suppliers] });
    expect(kiln.json()).toMatchObject({ first: false, workspace: { position: 1 } });
    expect((await call('POST', '/workspaces', owner, { name: 'Fernhill Coffee' })).statusCode).toBe(409);
    expect((await call('POST', '/workspaces', owner, { name: 'Ghost', connectionIds: ['conn_absent'] })).statusCode).toBe(422);
    const coffeeId = coffee.json().workspace.id as string;
    const kilnId = kiln.json().workspace.id as string;

    expect((await call('PATCH', `/workspaces/${kilnId}`, owner, { name: 'Kiln' })).json()).toMatchObject({ name: 'Kiln' });
    expect((await call('PUT', '/workspaces/order', owner, { ids: [kilnId] })).statusCode).toBe(422);
    const ordered = await call('PUT', '/workspaces/order', owner, { ids: [kilnId, coffeeId] });
    expect(ordered.json().workspaces.map((w: { id: string }) => w.id)).toEqual([kilnId, coffeeId]);

    // The archive leaves Fernhill Coffee: in no workspace, it is one of the "Other databases".
    const moved = await call('PUT', `/connections/${conn.archive}/workspaces`, owner, { workspaceIds: [] });
    expect(moved.json()).toEqual({ connectionId: conn.archive, workspaceIds: [], added: [], removed: [coffeeId] });
    expect((await call('GET', '/workspaces', owner)).json().otherDatabases).toEqual([conn.archive]);
    expect((await call('PUT', `/connections/${conn.archive}/workspaces`, owner, { workspaceIds: ['wsp_absent'] })).statusCode).toBe(404);

    // A template shown in Kiln alone: deleting Kiln lists it, and it is then shown nowhere — never in all.
    const template = await emailTemplatesRepo(ctx.meta).upsert('kiln-firing', 'en_US', { name: 'Firing done', subject: 's', blocks: [], enabled: true });
    await workspacesRepo(ctx.meta).setShownIn('email-template', template.id, [kilnId]);
    const plan = await call('GET', `/workspaces/${kilnId}/delete-plan`, owner);
    expect(plan.json()).toMatchObject({ shownOnlyIn: [{ kind: 'email-template', itemId: template.id, name: 'Firing done' }], last: false });
    const deleted = await call('DELETE', `/workspaces/${kilnId}`, owner);
    expect(deleted.json()).toMatchObject({ deleted: true, last: false });
    expect(await workspacesRepo(ctx.meta).shownIn('email-template', template.id)).toEqual({ mode: 'chosen', workspaceIds: [] });
    expect((await connectionsRepo(ctx.meta, PLAIN).findById(conn.kiln))?.name).toBe('kiln');

    const actions = (await auditRepo(ctx.meta).list({ category: 'connection', limit: 50 })).map((entry) => entry.action);
    for (const action of ['workspace.create', 'workspace.rename', 'workspace.reorder', 'workspace.connections', 'workspace.delete']) expect(actions).toContain(action);
  });

  it('keeps a person to the workspaces they can see, and narrows a list without ever widening it', async () => {
    ctx = await build();
    const { owner, reader, conn } = ctx;
    const coffee = (await call('POST', '/workspaces', owner, { name: 'Fernhill Coffee', connectionIds: [conn.fernhill, conn.archive] })).json().workspace.id as string;
    const kiln = (await call('POST', '/workspaces', owner, { name: 'Kiln', connectionIds: [conn.kiln] })).json().workspace.id as string;

    // The reader reaches a kiln page only: Kiln is theirs to choose, Fernhill Coffee is not there for them.
    expect((await call('PATCH', '/me/prefs', reader, { workspaceId: coffee })).statusCode).toBe(404);
    const chosen = await call('PATCH', '/me/prefs', reader, { workspaceId: kiln });
    expect(chosen.statusCode, chosen.body).toBe(200);
    expect(chosen.json().data.prefs.workspaceId).toBe(kiln);

    // Every list with `workspaceId` is a subset of the list without it.
    const all = (await call('GET', '/pages', owner)).json().data as { connectionId: string; id: string }[];
    for (const workspace of [coffee, kiln]) {
      const narrowed = (await call('GET', `/pages?workspaceId=${workspace}`, owner)).json().data as { connectionId: string; id: string }[];
      expect(narrowed.length).toBeGreaterThan(0);
      for (const page of narrowed) expect(all.some((one) => one.id === page.id)).toBe(true);
    }
    expect(((await call('GET', `/pages?workspaceId=${kiln}`, owner)).json().data as { connectionId: string }[]).map((page) => page.connectionId)).toEqual([conn.kiln]);
    // Both a workspace and a database: refused. A workspace that is not there: not found.
    expect((await call('GET', `/pages?workspaceId=${kiln}&connectionId=${conn.kiln}`, owner)).statusCode).toBe(422);
    expect((await call('GET', '/pages?workspaceId=wsp_absent', owner)).statusCode).toBe(404);
  });
});
