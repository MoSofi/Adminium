// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SAVE AS APP: what a database would become as an app file, the file itself,
 * and the saves made here.
 *
 *  - `POST /apps/save/plan` writes nothing: the Check step's list, the counts,
 *    the version and whether the file can be made now;
 *  - `POST /apps/save` makes the file again from the same answers, keeps a
 *    copy and records the save; it refuses while Check holds a question;
 *  - `GET /apps/saves` lists the saves made here (the "Saved from here" card);
 *  - `GET /apps/save/:id/file` downloads a saved file again;
 *  - `POST /workspaces/:id/save/plan`, `POST /workspaces/:id/save` and
 *    `GET /workspaces/save/:id/file` do the same for a whole workspace: one
 *    app per database, in one file ("Save workspace"). The saves list names
 *    the workspace files saved here too.
 *
 * All of them need `system:manifests:manage`. Rows and personal columns need
 * the saver's own rights on each table besides (the service asks them).
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { usersRepo, type MetaDb } from '@adminium/meta';

import type { SaveRights, SaveService } from '../../apps/save/service.js';
import type { WorkspaceSaveService } from '../../apps/save/workspace.js';
import { audited, auditExempt } from '../../audit/coverage.js';
import { requestReadsWhole } from '../../crud/row-reach-request.js';
import { NotFoundError } from '../../errors.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { getPrincipal } from '../../rbac/principal.js';

const ids = z.array(z.string().min(1).max(200)).max(2000);

export const saveAppBody = z
  .object({
    connectionId: z.string().min(1),
    key: z.string().regex(/^[a-z][a-z0-9-]{1,79}$/, 'a key is lower-case letters, digits and -'),
    name: z.string().trim().min(1).max(80),
    version: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
    description: z.string().max(500).optional(),
    label: z.string().trim().min(1).max(120).optional(),
    include: z
      .object({
        tables: ids.optional(),
        pages: ids.optional(),
        roles: ids.optional(),
        automations: ids.optional(),
        emailTemplates: ids.optional(),
        documents: ids.optional(),
        reports: ids.optional(),
        invoiceLayouts: ids.optional(),
        scheduledReports: ids.optional(),
        publicEndpoints: ids.optional(),
        payments: z.boolean().optional(),
        instance: z.boolean().optional(),
      })
      .strict()
      .optional(),
    rows: z.record(z.string().min(1), z.object({ mode: z.enum(['none', 'starting', 'sample']), viewId: z.string().min(1).optional() }).strict()).optional(),
    answers: z
      .object({
        carryAsText: ids.optional(),
        personalColumns: ids.optional(),
        shareViews: ids.optional(),
        clear: ids.optional(),
        leaveOut: ids.optional(),
        keep: ids.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const checkItem = z.object({
  group: z.enum(['choice', 'after', 'info']),
  code: z.string(),
  kind: z.string(),
  item: z.string(),
  field: z.string().optional(),
  message: z.string(),
  answer: z
    .object({
      choices: z.array(z.string()).readonly(),
      target: z.string(),
      /** A choice that records another value than `target`, by choice. */
      targets: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
  afterKind: z.string().optional(),
});

export const savePlanReply = z.object({
  plan: z.object({
    key: z.string(),
    version: z.string(),
    lineage: z.enum(['new', 'kept']),
    label: z.string(),
    minAdminiumVersion: z.string(),
    ready: z.boolean(),
    check: z.array(checkItem),
    problems: z.array(z.object({ code: z.string(), message: z.string(), path: z.string().optional() })),
    counts: z.record(z.string(), z.number()),
  }),
});

const savedFile = z.object({
  id: z.string(),
  key: z.string(),
  version: z.string(),
  integrity: z.string(),
  bytes: z.number(),
  filename: z.string(),
  savedAt: z.number(),
});

export const saveAppReply = z.object({ save: savedFile });

export const appSavesReply = z.object({
  saves: z.array(
    z.object({
      id: z.string(),
      key: z.string(),
      version: z.string(),
      connectionId: z.string().nullable(),
      /** The app's name and description as saved; null on a save from before they were kept. */
      name: z.string().nullable(),
      description: z.string().nullable(),
      label: z.string(),
      savedBy: z.string().nullable(),
      /** Who saved it, by name; null when nobody (the command line) or they are gone. */
      savedByName: z.string().nullable(),
      savedAt: z.number(),
      integrity: z.string(),
      bytes: z.number(),
      /** Whether "Download again" still has a copy. */
      downloadable: z.boolean(),
    }),
  ),
  /** The workspace files saved here, newest first. */
  workspaces: z.array(
    z.object({
      id: z.string(),
      workspaceId: z.string().nullable(),
      name: z.string(),
      label: z.string(),
      savedBy: z.string().nullable(),
      savedAt: z.number(),
      integrity: z.string(),
      bytes: z.number(),
      /** The app saves inside, in the file's order. */
      appSaveIds: z.array(z.string()),
    }),
  ),
});

/** One app of a workspace file: Save as app's body, without the label (the file has one). */
export const workspaceAppBody = saveAppBody.omit({ label: true });

export const saveWorkspaceBody = z
  .object({
    label: z.string().trim().min(1).max(120).optional(),
    /** The database whose server settings travel with its app ("Server settings: from {database}"); none when absent. */
    instanceFrom: z.string().min(1).nullable().optional(),
    /** One app per database; every database of the workspace when absent. */
    apps: z.array(workspaceAppBody).min(1).max(8).optional(),
  })
  .strict();

const savePlanDto = savePlanReply.shape.plan;

export const workspaceSavePlanReply = z.object({
  plan: z.object({
    workspaceId: z.string(),
    name: z.string(),
    label: z.string(),
    filename: z.string(),
    minAdminiumVersion: z.string(),
    ready: z.boolean(),
    instanceFrom: z.string().nullable(),
    /** Each app's Check, grouped per app, in the order the file would hold them. */
    apps: z.array(
      z.object({
        connectionId: z.string(),
        database: z.object({ name: z.string(), engine: z.string() }),
        key: z.string(),
        name: z.string(),
        plan: savePlanDto,
      }),
    ),
    /** The workspaces the databases are in, by name: for your information. */
    workspaces: z.array(z.string()),
  }),
});

export const saveWorkspaceReply = z.object({
  save: z.object({
    id: z.string(),
    name: z.string(),
    filename: z.string(),
    integrity: z.string(),
    bytes: z.number(),
    savedAt: z.number(),
    apps: z.array(z.object({ key: z.string(), version: z.string(), integrity: z.string(), bytes: z.number() })),
  }),
});

const workspaceIdParams = z.object({ id: z.string().min(1) });

const saveIdParams = z.object({ id: z.string().min(1) });

const inventoryItem = z.object({ id: z.string(), name: z.string(), tableIds: z.array(z.string()), pageId: z.string().optional() });

export const saveInventoryReply = z.object({
  inventory: z.object({
    connectionId: z.string(),
    tables: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        columns: z.number().int(),
        rows: z.number().int().nullable(),
        rowsExact: z.boolean(),
        links: z.array(z.object({ column: z.string(), to: z.string(), required: z.boolean() })),
        personal: z.array(z.string()),
        secretLike: z.array(z.string()),
        rowsAllowed: z.boolean(),
        personalAllowed: z.boolean(),
      }),
    ),
    pages: z.array(z.object({ id: z.string(), title: z.string(), tableId: z.string().nullable(), generated: z.boolean() })),
    views: z.array(z.object({ id: z.string(), name: z.string(), pageId: z.string(), ownerId: z.string().nullable(), ownerName: z.string().nullable() })),
    roles: z.array(z.object({ id: z.string(), name: z.string() })),
    automations: z.array(inventoryItem),
    emailTemplates: z.array(z.object({ key: z.string(), name: z.string() })),
    documents: z.array(inventoryItem),
    reports: z.array(inventoryItem),
    invoiceLayouts: z.array(inventoryItem),
    scheduledReports: z.array(inventoryItem),
    publicEndpoints: z.array(inventoryItem),
    payments: z.boolean(),
    instance: z.boolean(),
  }),
});

const inventoryQuery = z.object({ connectionId: z.string().min(1) }).strict();

export interface AppSaveRoutesDeps {
  meta: MetaDb;
  service: SaveService;
  workspaces: WorkspaceSaveService;
}

export function appSaveRoutes(deps: AppSaveRoutesDeps): FastifyPluginAsyncZod {
  return async (app) => {
    const rightsOf = (request: Parameters<typeof requestReadsWhole>[1]): SaveRights => ({
      userId: getPrincipal(request)?.kind === 'user' ? (getPrincipal(request) as { id: string }).id : null,
      can: async (grant) => typeof request.can === 'function' && (await request.can(grant)),
      readsWhole: (connectionId, tableId) => requestReadsWhole(deps.meta, request, connectionId, tableId, 'read'),
    });

    app.post(
      '/apps/save/plan',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        config: { audit: auditExempt('a preview of the file a save would make; it reads configuration and writes nothing. The save it precedes is audited.') },
        schema: { body: saveAppBody, response: { 200: savePlanReply } },
      },
      async (request) => ({ plan: await deps.service.plan(request.body, rightsOf(request)) }),
    );

    app.post(
      '/apps/save',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        config: { audit: audited('rbac') },
        schema: { body: saveAppBody, response: { 200: saveAppReply } },
      },
      async (request) => {
        const { tarball: _bytes, ...save } = await deps.service.save(request.body, rightsOf(request));
        return { save };
      },
    );

    app.get(
      '/apps/save/inventory',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        schema: { querystring: inventoryQuery, response: { 200: saveInventoryReply } },
      },
      async (request) => ({ inventory: await deps.service.inventory(request.query.connectionId, rightsOf(request)) }),
    );

    app.get(
      '/apps/saves',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        schema: { response: { 200: appSavesReply } },
      },
      async () => {
        const saves = await deps.service.list();
        const people = new Map<string, string | null>();
        for (const id of new Set(saves.flatMap((save) => (save.savedBy === null ? [] : [save.savedBy])))) people.set(id, (await usersRepo(deps.meta).findById(id))?.name ?? null);
        return { saves: saves.map((save) => ({
          id: save.id,
          key: save.appKey,
          version: save.version,
          connectionId: save.connectionId,
          name: save.name,
          description: save.description,
          label: save.label,
          savedBy: save.savedBy,
          savedByName: save.savedBy === null ? null : (people.get(save.savedBy) ?? null),
          savedAt: save.savedAt,
          integrity: save.integrity,
          bytes: save.bytes,
          downloadable: save.fileId !== null,
        })),
        workspaces: (await deps.workspaces.list()).map((save) => ({
          id: save.id,
          workspaceId: save.workspaceId,
          name: save.name,
          label: save.label,
          savedBy: save.savedBy,
          savedAt: save.savedAt,
          integrity: save.integrity,
          bytes: save.bytes,
          appSaveIds: save.appSaveIds,
        })),
      };
      },
    );

    app.get(
      '/apps/save/:id/file',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        schema: { params: saveIdParams },
      },
      async (request, reply) => {
        const found = await deps.service.file(request.params.id);
        if (found === null) throw new NotFoundError('That saved file is no longer kept. Save the app again.');
        const safeName = found.filename.replaceAll(/["\\\r\n]/g, '_');
        return reply
          .header('content-type', 'application/gzip')
          .header('content-length', String(found.bytes.byteLength))
          .header('content-disposition', `attachment; filename="${safeName}"`)
          .header('x-adminium-integrity', found.save.integrity)
          .send(Buffer.from(found.bytes));
      },
    );

    // ── Save workspace: one app per database, in one file ─────────────────────

    app.post(
      '/workspaces/:id/save/plan',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        config: { audit: auditExempt('a preview of the workspace file a save would make; it reads configuration and writes nothing. The save it precedes is audited.') },
        schema: { params: workspaceIdParams, body: saveWorkspaceBody, response: { 200: workspaceSavePlanReply } },
      },
      async (request) => ({ plan: await deps.workspaces.plan(request.params.id, request.body, rightsOf(request)) }),
    );

    app.post(
      '/workspaces/:id/save',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        config: { audit: audited('rbac') },
        schema: { params: workspaceIdParams, body: saveWorkspaceBody, response: { 200: saveWorkspaceReply } },
      },
      async (request) => {
        const { tarball: _bytes, ...save } = await deps.workspaces.save(request.params.id, request.body, rightsOf(request));
        return { save };
      },
    );

    app.get(
      '/workspaces/save/:id/file',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        schema: { params: saveIdParams },
      },
      async (request, reply) => {
        const found = await deps.workspaces.file(request.params.id);
        if (found === null) throw new NotFoundError('An app in that workspace file is no longer kept. Save the workspace again.');
        const safeName = found.filename.replaceAll(/["\\\r\n]/g, '_');
        return reply
          .header('content-type', 'application/gzip')
          .header('content-length', String(found.bytes.byteLength))
          .header('content-disposition', `attachment; filename="${safeName}"`)
          .header('x-adminium-integrity', found.save.integrity)
          .send(Buffer.from(found.bytes));
      },
    );
  };
}
