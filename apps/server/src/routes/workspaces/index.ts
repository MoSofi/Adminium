// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Workspaces: named groups of a server's databases, managed on Data
 * connections by whoever manages connections.
 *
 * A database may be in several workspaces or in none. Deleting a workspace
 * leaves its databases where they are; deleting a database takes it out of
 * every workspace. Every change is audited and publishes `config-changed`,
 * so every open dashboard redraws its menu without a reload.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { settingsRepo, workspacesRepo, WorkspaceNameTaken, type MetaDb, type Workspace } from '@adminium/meta';

import { ConflictError, NotFoundError, ValidationFailedError } from '../../errors.js';
import {
  connectionWorkspacesBody,
  connectionWorkspacesReply,
  workspaceConnectionParams,
  workspaceCreateBody,
  workspaceCreateReply,
  workspaceDeletePlanReply,
  workspaceDeleteReply,
  workspaceIdParams,
  workspaceListReply,
  workspaceOrderBody,
  workspaceRenameBody,
  type WorkspaceDto,
} from './schema.js';

const CONNECTIONS_MANAGE = 'system:connections:manage';

/** The realtime event every workspace change publishes on `config-changed`. */
export const WORKSPACES_CHANGED = 'workspaces.changed';

function dto(workspace: Workspace): WorkspaceDto {
  return {
    id: workspace.id,
    name: workspace.name,
    position: workspace.position,
    connectionIds: workspace.connectionIds,
    sender: workspace.sender,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  };
}

/** The name an item of a "Shown in" kind is listed by, and an email template's key; null when the item is gone. */
async function itemOf(meta: MetaDb, kind: 'email-template' | 'report' | 'invoice', itemId: string): Promise<{ name: string; family: string } | null> {
  if (kind === 'email-template') {
    const row = await meta.db.selectFrom('adminium_email_templates').select(['name', 'key']).where('id', '=', itemId).executeTakeFirst();
    return row === undefined ? null : { name: row.name, family: `email-template:${row.key}` };
  }
  const table = kind === 'report' ? 'adminium_report_documents' : 'adminium_invoice_documents';
  const row = await meta.db.selectFrom(table).select('name').where('id', '=', itemId).executeTakeFirst();
  return row === undefined ? null : { name: row.name, family: `${kind}:${itemId}` };
}

export const workspacesRoutes: FastifyPluginAsyncZod = async (app) => {
  const { meta } = app.rbac;
  const workspaces = workspacesRepo(meta);
  const guarded = { preHandler: app.rbac.require(CONNECTIONS_MANAGE) };

  const changed = async (at: number): Promise<void> => {
    if (app.hasDecorator('realtime')) app.realtime.publish('config-changed', WORKSPACES_CHANGED, {}, at);
  };
  const mustFind = async (id: string): Promise<Workspace> => {
    const found = await workspaces.findById(id);
    if (found === null) throw new NotFoundError('There is no such workspace.', { workspaceId: id });
    return found;
  };
  const refuseTaken = (error: unknown): never => {
    if (error instanceof WorkspaceNameTaken) throw new ConflictError('A workspace already has that name.', 'UNIQUE_VIOLATION', { name: error.message });
    throw error;
  };
  const knownConnections = async (ids: readonly string[]): Promise<void> => {
    if (ids.length === 0) return;
    const found = new Set((await meta.db.selectFrom('adminium_connections').select('id').where('id', 'in', [...ids]).execute()).map((row) => row.id));
    const missing = ids.filter((id) => !found.has(id));
    if (missing.length > 0) throw new ValidationFailedError('Some of those databases are not connected here.', { connectionIds: missing });
  };

  app.get('/workspaces', { ...guarded, schema: { response: { 200: workspaceListReply } } }, async () => {
    const all = await workspaces.list();
    const grouped = new Set(all.flatMap((workspace) => workspace.connectionIds));
    const connections = (await meta.db.selectFrom('adminium_connections').select('id').orderBy('name', 'asc').execute()).map((row) => row.id);
    const other = connections.filter((id) => !grouped.has(id));
    return {
      workspaces: all.map(dto),
      otherDatabases: all.length === 0 || other.length === 0 ? null : other,
      view: await settingsRepo(meta).get('ui.workspaceView'),
    };
  });

  app.post('/workspaces', { ...guarded, schema: { body: workspaceCreateBody, response: { 201: workspaceCreateReply } } }, async (request, reply) => {
    await knownConnections(request.body.connectionIds ?? []);
    const first = (await workspaces.count()) === 0;
    const at = app.rbac.now();
    const workspace = await workspaces
      .create({ name: request.body.name, connectionIds: request.body.connectionIds ?? [], createdBy: request.user?.id ?? null }, at)
      .catch(refuseTaken);
    await app.rbac.audit(request, { category: 'connection', action: 'workspace.create', changes: { after: { workspaceId: workspace.id, name: workspace.name, connectionIds: workspace.connectionIds } } });
    await changed(at);
    return reply.code(201).send({ workspace: dto(workspace), first });
  });

  app.patch('/workspaces/:id', { ...guarded, schema: { params: workspaceIdParams, body: workspaceRenameBody, response: { 200: workspaceCreateReply.shape.workspace } } }, async (request) => {
    const before = await mustFind(request.params.id);
    const at = app.rbac.now();
    const after = (await workspaces.rename(before.id, request.body.name, at).catch(refuseTaken))!;
    await app.rbac.audit(request, { category: 'connection', action: 'workspace.rename', changes: { before: { workspaceId: before.id, name: before.name }, after: { name: after.name } } });
    await changed(at);
    return dto(after);
  });

  app.put('/workspaces/order', { ...guarded, schema: { body: workspaceOrderBody, response: { 200: workspaceListReply } } }, async (request) => {
    const at = app.rbac.now();
    const before = (await workspaces.list()).map((workspace) => workspace.id);
    if (!(await workspaces.reorder(request.body.ids, at))) {
      throw new ValidationFailedError('Name every workspace once, in the order they go.', { ids: before });
    }
    await app.rbac.audit(request, { category: 'connection', action: 'workspace.reorder', changes: { before: { ids: before }, after: { ids: request.body.ids } } });
    await changed(at);
    const all = await workspaces.list();
    const grouped = new Set(all.flatMap((workspace) => workspace.connectionIds));
    const other = (await meta.db.selectFrom('adminium_connections').select('id').orderBy('name', 'asc').execute()).map((row) => row.id).filter((id) => !grouped.has(id));
    return { workspaces: all.map(dto), otherDatabases: other.length === 0 ? null : other, view: await settingsRepo(meta).get('ui.workspaceView') };
  });

  /** What a delete would do, for the confirm: the databases stay; items shown only here become shown nowhere. */
  const deletePlan = async (id: string) => {
    const workspace = await mustFind(id);
    const shownOnlyIn = [];
    // An email template is chosen as a family (every language of its key): it is listed once.
    const families = new Set<string>();
    for (const item of await workspaces.onlyIn(id)) {
      const found = await itemOf(meta, item.kind, item.itemId);
      if (found === null || families.has(found.family)) continue;
      families.add(found.family);
      shownOnlyIn.push({ ...item, name: found.name });
    }
    return { workspace: dto(workspace), connectionIds: workspace.connectionIds, shownOnlyIn, last: (await workspaces.count()) === 1 };
  };

  app.get('/workspaces/:id/delete-plan', { ...guarded, schema: { params: workspaceIdParams, response: { 200: workspaceDeletePlanReply } } }, async (request) => deletePlan(request.params.id));

  app.delete('/workspaces/:id', { ...guarded, schema: { params: workspaceIdParams, response: { 200: workspaceDeleteReply } } }, async (request) => {
    const plan = await deletePlan(request.params.id);
    const at = app.rbac.now();
    await workspaces.remove(plan.workspace.id);
    await app.rbac.audit(request, {
      category: 'connection',
      action: 'workspace.delete',
      changes: { before: { workspaceId: plan.workspace.id, name: plan.workspace.name, connectionIds: plan.connectionIds, shownOnlyIn: plan.shownOnlyIn.map((item) => `${item.kind}:${item.itemId}`) } },
    });
    await changed(at);
    return { deleted: true as const, shownOnlyIn: plan.shownOnlyIn, last: plan.last };
  });

  app.put(
    '/connections/:id/workspaces',
    { ...guarded, schema: { params: workspaceConnectionParams, body: connectionWorkspacesBody, response: { 200: connectionWorkspacesReply } } },
    async (request) => {
      const connectionId = request.params.id;
      await knownConnections([connectionId]);
      const at = app.rbac.now();
      let moved: { added: string[]; removed: string[] };
      try {
        moved = await workspaces.setForConnection(connectionId, request.body.workspaceIds, at);
      } catch (error) {
        throw new NotFoundError('There is no such workspace.', { workspaceIds: request.body.workspaceIds, reason: error instanceof Error ? error.message : String(error) });
      }
      if (moved.added.length + moved.removed.length > 0) {
        await app.rbac.audit(request, { category: 'connection', action: 'workspace.connections', connectionId, changes: { after: { connectionId, added: moved.added, removed: moved.removed } } });
        await changed(at);
      }
      return { connectionId, workspaceIds: await workspaces.forConnection(connectionId), ...moved };
    },
  );
};
