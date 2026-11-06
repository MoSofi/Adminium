// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The workspaces block of `GET /api/v1/bootstrap`, as the menu reads it:
 *  - a server with no workspace says nothing of them: no block, and no item
 *    names a workspace (the menu is the one it always was);
 *  - with workspaces, the block lists the ones this person sees, by
 *    position, with their tile letters, the view, the engine of each
 *    database, and "Other databases" when they reach one of those;
 *  - every item of a database names the workspaces that hold it, two for a
 *    database in two workspaces;
 *  - someone who reaches one database's pages sees only its workspace, and
 *    their last choice comes back only while they still see it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { connectionsRepo, pagesRepo, permissionsRepo, rolesRepo, settingsRepo, userPrefsRepo, usersRepo, workspacesRepo } from '@adminium/meta';

import { rbacPlugin } from '../src/plugins/rbac.js';
import { ADMIN_PASSWORD, adminPasswordHash, buildAuthApp, login, type AuthTestApp } from './auth-helpers.js';

const PLAIN = { encrypt: (v: string) => v, decrypt: (v: string) => v };

interface Block {
  workspaces: { id: string; name: string; initials: string; position: number; connectionIds: string[] }[];
  otherDatabases: string[] | null;
  workspaceView: 'one' | 'all';
  lastWorkspaceId: string | null;
  manage: boolean;
  engines: Record<string, string>;
}
interface Item {
  slug: string;
  connectionId: string | null;
  workspaceIds?: string[];
}

describe('the workspaces of the session bootstrap', () => {
  let t: AuthTestApp;
  let conn: { fernhill: string; kiln: string; suppliers: string; scratch: string };

  beforeEach(async () => {
    t = await buildAuthApp();
    await t.app.register(rbacPlugin, { meta: t.meta });
    const connections = connectionsRepo(t.meta, PLAIN);
    const make = async (name: string, engine: 'sqlite' | 'postgres' | 'mysql') =>
      (await connections.create({ name, engine, introspectDsn: 'sqlite::memory:', dataDsn: 'sqlite::memory:' })).id;
    conn = { fernhill: await make('fernhill', 'postgres'), kiln: await make('kiln', 'mysql'), suppliers: await make('suppliers', 'postgres'), scratch: await make('scratch', 'sqlite') };
    for (const [name, id] of Object.entries(conn)) {
      await pagesRepo(t.meta).create({ connectionId: id, slug: `${name}-orders`, type: 'crud', title: `${name} orders`, navGroup: 'workspace', config: { v: 1, kind: 'crud', template: 'page-crud', config: {} }, createdBy: null } );
    }
    await pagesRepo(t.meta).create({ connectionId: null, slug: 'notes', type: 'crud', title: 'Notes', navGroup: 'workspace', config: { v: 1, kind: 'crud', template: 'page-crud', config: {} }, createdBy: null });
  });
  afterEach(async () => {
    await t.destroy();
  });

  const bootstrap = async (email?: string) => {
    const { cookie } = email === undefined ? await login(t.app) : await login(t.app, email, ADMIN_PASSWORD);
    const res = await t.app.inject({ method: 'GET', url: '/api/v1/bootstrap', headers: { cookie: cookie ?? '' } });
    expect(res.statusCode, res.body).toBe(200);
    const data = res.json().data as { workspaces?: Block; nav: { groups: { items: Item[] }[] } };
    return { block: data.workspaces, items: data.nav.groups.flatMap((group) => group.items) };
  };

  it('says nothing of workspaces while the server has none: the menu is the one it always was', async () => {
    const { block, items } = await bootstrap();
    expect(block).toBeUndefined();
    expect(items.length).toBe(5);
    for (const item of items) expect(item).not.toHaveProperty('workspaceIds');
  });

  it('lists the workspaces by position with what the menu draws, and names every database\'s workspaces on its items', async () => {
    const repo = workspacesRepo(t.meta);
    const coffee = await repo.create({ name: 'Fernhill Coffee', connectionIds: [conn.fernhill, conn.suppliers], createdBy: null });
    const kiln = await repo.create({ name: 'Kiln Street Pottery', connectionIds: [conn.kiln, conn.suppliers], createdBy: null });
    await settingsRepo(t.meta).set('ui.workspaceView', 'one', { updatedBy: null });

    const { block, items } = await bootstrap();
    expect(block).toMatchObject({
      workspaces: [
        { id: coffee.id, name: 'Fernhill Coffee', initials: 'FC', position: 0, connectionIds: [conn.fernhill, conn.suppliers] },
        { id: kiln.id, name: 'Kiln Street Pottery', initials: 'KS', position: 1 },
      ],
      otherDatabases: [conn.scratch],
      workspaceView: 'one',
      lastWorkspaceId: null,
      manage: true,
    });
    expect(block!.engines).toEqual({ [conn.fernhill]: 'postgres', [conn.kiln]: 'mysql', [conn.suppliers]: 'postgres', [conn.scratch]: 'sqlite' });
    const of = (slug: string) => items.find((item) => item.slug === slug)?.workspaceIds;
    expect(of('suppliers-orders')).toEqual([coffee.id, kiln.id]);
    expect(of('kiln-orders')).toEqual([kiln.id]);
    // A database in no workspace, and a page of no database, name none.
    expect(of('scratch-orders')).toEqual([]);
    expect(items.find((item) => item.slug === 'notes')).not.toHaveProperty('workspaceIds');
  });

  it('shows someone only the workspaces of the databases they reach, and their last choice only while they see it', async () => {
    const repo = workspacesRepo(t.meta);
    const coffee = await repo.create({ name: 'Fernhill Coffee', connectionIds: [conn.fernhill], createdBy: null });
    const kiln = await repo.create({ name: 'Kiln Street Pottery', connectionIds: [conn.kiln], createdBy: null });
    const reader = await usersRepo(t.meta).create({ email: 'ade@example.com', name: 'Ade', passwordHash: await adminPasswordHash() });
    const role = await rolesRepo(t.meta).create({ slug: 'kiln-staff', name: 'Kiln staff' });
    await rolesRepo(t.meta).assignToUser(reader.id, role.id);
    const kilnPage = (await pagesRepo(t.meta).findBySlug(conn.kiln, 'kiln-orders'))!;
    await permissionsRepo(t.meta).grant(role.id, 'page', kilnPage.id, { view: true, edit: false } as never);

    await userPrefsRepo(t.meta).set(reader.id, { workspaceId: kiln.id }, Date.now());
    const { block } = await bootstrap('ade@example.com');
    expect(block!.workspaces.map((workspace) => workspace.id)).toEqual([kiln.id]);
    // One group for them: the menu draws no card. Nor "Other databases", which they reach nothing of.
    expect(block!.otherDatabases).toBeNull();
    expect(block!.manage).toBe(false);
    expect(block!.lastWorkspaceId).toBe(kiln.id);
    expect(Object.keys(block!.engines)).toEqual([conn.kiln]);

    // A choice they no longer see is not where a new tab starts.
    await userPrefsRepo(t.meta).set(reader.id, { workspaceId: coffee.id }, Date.now());
    expect((await bootstrap('ade@example.com')).block!.lastWorkspaceId).toBeNull();
  });

  it('tells someone of a workspace they see only the databases they reach in it, by id and engine', async () => {
    const repo = workspacesRepo(t.meta);
    // Kiln's workspace holds a database the reader reaches and one they do not; "Other databases" likewise.
    const kiln = await repo.create({ name: 'Kiln Street Pottery', connectionIds: [conn.kiln, conn.suppliers], createdBy: null });
    await repo.create({ name: 'Fernhill Coffee', connectionIds: [conn.fernhill], createdBy: null });
    const reader = await usersRepo(t.meta).create({ email: 'bo@example.com', name: 'Bo', passwordHash: await adminPasswordHash() });
    const role = await rolesRepo(t.meta).create({ slug: 'kiln-only', name: 'Kiln only' });
    await rolesRepo(t.meta).assignToUser(reader.id, role.id);
    for (const [connectionId, slug] of [[conn.kiln, 'kiln-orders'], [conn.scratch, 'scratch-orders']] as const) {
      const page = (await pagesRepo(t.meta).findBySlug(connectionId, slug))!;
      await permissionsRepo(t.meta).grant(role.id, 'page', page.id, { view: true, edit: false } as never);
    }

    const { block, items } = await bootstrap('bo@example.com');
    expect(block!.workspaces).toEqual([expect.objectContaining({ id: kiln.id, connectionIds: [conn.kiln] })]);
    expect(block!.otherDatabases).toEqual([conn.scratch]);
    expect(block!.engines).toEqual({ [conn.kiln]: 'mysql', [conn.scratch]: 'sqlite' });
    const whole = JSON.stringify(block);
    for (const unseen of [conn.suppliers, conn.fernhill]) expect(whole).not.toContain(unseen);
    // Each row they have still sits in its workspace.
    expect(items.find((item) => item.slug === 'kiln-orders')?.workspaceIds).toEqual([kiln.id]);
    expect(items.find((item) => item.slug === 'scratch-orders')?.workspaceIds).toEqual([]);
    expect(items.some((item) => item.slug === 'suppliers-orders')).toBe(false);
  });
});
