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
 *  - `GET /apps/save/:id/file` downloads a saved file again.
 *
 * All of them need `system:manifests:manage`. Rows and personal columns need
 * the saver's own rights on each table besides (the service asks them).
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { MetaDb } from '@adminium/meta';

import type { SaveRights, SaveService } from '../../apps/save/service.js';
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
  answer: z.object({ choices: z.array(z.string()).readonly(), target: z.string() }).optional(),
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
      label: z.string(),
      savedBy: z.string().nullable(),
      savedAt: z.number(),
      integrity: z.string(),
      bytes: z.number(),
      /** Whether "Download again" still has a copy. */
      downloadable: z.boolean(),
    }),
  ),
});

const saveIdParams = z.object({ id: z.string().min(1) });

export interface AppSaveRoutesDeps {
  meta: MetaDb;
  service: SaveService;
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
      async (request) => ({ save: await deps.service.save(request.body, rightsOf(request)) }),
    );

    app.get(
      '/apps/saves',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        schema: { response: { 200: appSavesReply } },
      },
      async () => ({
        saves: (await deps.service.list()).map((save) => ({
          id: save.id,
          key: save.appKey,
          version: save.version,
          connectionId: save.connectionId,
          label: save.label,
          savedBy: save.savedBy,
          savedAt: save.savedAt,
          integrity: save.integrity,
          bytes: save.bytes,
          downloadable: save.fileId !== null,
        })),
      }),
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
  };
}
