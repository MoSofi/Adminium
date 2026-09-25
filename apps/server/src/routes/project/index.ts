// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Project routes, registered only when the server runs a project folder:
 *
 *   GET  /api/v1/project/status        what differs between the folder and this server
 *   POST /api/v1/project/resolve       settle a conflict: keep this server's copy or the project's
 *   GET  /api/v1/project/export        the server's changed copies, for `adminium pull --from`
 *   GET  /api/v1/project/actions       the project actions the caller may run
 *   POST /api/v1/project/actions/:id   run one on the selected records
 *   GET  /api/v1/project/overview      Studio → Settings → Project, for super admins
 *   GET  /api/v1/project/client/*      a built page or widget file, for the dashboard
 *
 * Status and resolve are the Studio pages manager's, under the same
 * `system:pages:manage` its other writes need. Export is read by the CLI with
 * an API key (`ADMINIUM_API_KEY`), so it is gated by `system:project:read`
 * alone, which sessions and keys both carry. An action checks the table
 * permission it declares, per table (`project/code/actions.ts`). The built
 * browser files are served to any signed-in person: they are the code of pages
 * the dashboard shows, and the data those pages read is checked by the data
 * routes. Their names carry a content hash, so they are cached for good.
 */

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { parseDatabaseModel } from '@adminium/engine';
import { overridesRepo, snapshotsRepo, type SchemaOverride } from '@adminium/meta';

import { audited } from '../../audit/coverage.js';
import { columnsShown } from '../../connections/effective-schema.js';
import { ForbiddenError, NotFoundError, ValidationFailedError } from '../../errors.js';
import type { ProjectClientHost } from '../../project/client-host.js';
import type { ActionRunner } from '../../project/code/actions.js';
import type { CodeProblem } from '../../project/code/load.js';
import type { ProjectCodeRuntime } from '../../project/code/runtime.js';
import { ProjectResolveError, type ProjectService, type SchemaApplyGuard } from '../../project/service.js';
import { APP_VERSION } from '../../version.js';

export interface ProjectRoutesDeps {
  project: ProjectService;
  /** The project's hooks and actions; absent where project code never loads. */
  code?:
    | {
        runtime: ProjectCodeRuntime;
        actions: ActionRunner;
        /** The built pages and widgets. */
        client: ProjectClientHost;
        /** Pages that could not get a page row at the last apply. */
        pageProblems: () => readonly CodeProblem[];
      }
    | undefined;
}

const modeSchema = z.enum(['dev', 'server']);

const outsidePageSchema = z.object({
  pageId: z.string(),
  slug: z.string(),
  connectionId: z.string().nullable(),
  reason: z.string(),
});

export const projectStatusReply = z.object({
  data: z.object({
    mode: modeSchema,
    entries: z.array(
      z.object({
        path: z.string(),
        kind: z.enum(['page', 'schema', 'list']),
        name: z.string(),
        pageId: z.string().nullable(),
        status: z.enum(['changed-on-server', 'conflict', 'not-in-project', 'pending', 'invalid']),
        serverEditedAt: z.number().int().nullable(),
        problems: z.array(z.string()).optional(),
      }),
    ),
    outside: z.array(outsidePageSchema),
  }),
});

export const projectResolveBody = z.object({
  path: z.string().min(1).max(200),
  keep: z.enum(['server', 'project']),
});

export const projectExportReply = z.object({
  data: z.object({
    version: z.string(),
    mode: modeSchema,
    changes: z.array(
      z.object({
        path: z.string(),
        status: z.enum(['changed-on-server', 'conflict', 'not-in-project']),
        /** The server's copy, or null when the server deleted it. */
        content: z.string().nullable(),
      }),
    ),
    outside: z.array(outsidePageSchema),
  }),
});

const actionSummarySchema = z.object({
  id: z.string(),
  label: z.string(),
  icon: z.string().nullable(),
  confirm: z.string().nullable(),
  bulk: z.boolean(),
  permission: z.enum(['read', 'create', 'update', 'delete']),
  database: z.string(),
  connectionId: z.string(),
  table: z.string(),
});

export const projectActionsReply = z.object({ data: z.array(actionSummarySchema) });

export const projectActionParams = z.object({ id: z.string().min(1).max(64) });

export const projectActionBody = z.object({
  database: z.string().min(1).max(48),
  table: z.string().min(1).max(128),
  ids: z
    .array(z.union([z.string().max(512), z.number(), z.record(z.string(), z.union([z.string(), z.number()]))]))
    .min(1)
    .max(1000),
});

export const projectActionReply = z.object({
  data: z.object({ message: z.string().nullable(), refresh: z.boolean() }),
});

/** The file's path in the build's client folder, such as `pages/revenue-5KX2P.js`. */
export const projectClientParams = z.object({ '*': z.string().min(1).max(300) });

const problemSchema = z.object({ source: z.string(), message: z.string(), at: z.number().int() });

export const projectOverviewReply = z.object({
  data: z.object({
    root: z.string(),
    version: z.string(),
    mode: modeSchema,
    /** False where project code never loads (the desktop app). */
    codeEnabled: z.boolean(),
    loadedAt: z.number().int().nullable(),
    actions: z.array(
      z.object({
        id: z.string(),
        source: z.string(),
        label: z.string(),
        database: z.string(),
        table: z.string(),
        bulk: z.boolean(),
        permission: z.enum(['read', 'create', 'update', 'delete']),
      }),
    ),
    hooks: z.array(
      z.object({
        source: z.string(),
        database: z.string(),
        table: z.string(),
        events: z.array(z.string()),
        onImport: z.boolean(),
      }),
    ),
    files: z.object({ pages: z.array(z.string()), schema: z.array(z.string()) }),
    /** The hand-written pages, `pages/<slug>.tsx`. */
    pages: z.array(
      z.object({
        slug: z.string(),
        source: z.string(),
        title: z.string(),
        group: z.string(),
        hidden: z.boolean(),
      }),
    ),
    /** The widgets, `widgets/<name>.tsx`. */
    widgets: z.array(z.object({ id: z.string(), source: z.string(), kind: z.enum(['cell', 'card']) })),
    problems: z.array(problemSchema),
    hookFailures: z.array(
      z.object({
        at: z.number().int(),
        source: z.string(),
        event: z.string(),
        database: z.string(),
        table: z.string(),
        message: z.string(),
      }),
    ),
    changes: projectStatusReply.shape.data.shape.entries,
  }),
});

export function projectRoutes(deps: ProjectRoutesDeps): FastifyPluginAsyncZod {
  const { project } = deps;
  return async (app) => {
    const manage = app.rbac.require('system:pages:manage');

    app.get(
      '/project/status',
      { preHandler: [app.requireAuth, manage], schema: { response: { 200: projectStatusReply } } },
      async () => ({ data: await project.status() }),
    );

    app.post(
      '/project/resolve',
      {
        preHandler: [app.requireAuth, manage],
        config: { audit: audited('rbac') },
        schema: { body: projectResolveBody, response: { 200: projectStatusReply } },
      },
      async (request) => {
        const { path, keep } = request.body;
        /*
         * A schema file's rules replace the server's, and may show a column
         * no reader saw — a `secret: false`, a mask taken off, a secret tag
         * left out. That takes Super Admin, as the same change saved in
         * Studio does (`routes/schema`).
         */
        const guard: SchemaApplyGuard = async (connectionId, rows) => {
          if ((await app.rbac.resolve(request)).superAdmin) return;
          const snapshot = await snapshotsRepo(app.rbac.meta).latest(connectionId);
          if (snapshot === null) return;
          const before = await overridesRepo(app.rbac.meta).listForConnection(connectionId);
          const at = Date.now();
          const after = [
            ...before.filter((row) => row.origin === 'auto'),
            ...rows.map(
              (row, index) =>
                ({ ...row, id: `ovr_file_${String(index)}`, connectionId, columnName: row.columnName ?? null, llmRunId: null, createdBy: null, createdAt: at, updatedAt: at }) as SchemaOverride,
            ),
          ];
          if (columnsShown(parseDatabaseModel(snapshot.schema), before, after).length > 0) {
            throw new ForbiddenError('Showing a column that is kept secret, or taking a personal column’s mask off, requires Super Admin.');
          }
        };
        try {
          await project.resolve(path, keep, guard);
        } catch (error) {
          if (error instanceof ProjectResolveError) {
            throw error.message.endsWith('is not a project file')
              ? new NotFoundError(error.message, { path })
              : new ValidationFailedError(error.message, { path });
          }
          throw error;
        }
        await app.rbac.audit(request, {
          category: 'settings',
          action: 'project.file.resolve',
          changes: { after: { path, keep } },
        });
        return { data: await project.status() };
      },
    );

    app.get(
      '/project/export',
      { preHandler: app.rbac.require('system:project:read'), schema: { response: { 200: projectExportReply } } },
      async () => {
        const status = await project.status();
        return {
          data: { version: APP_VERSION, mode: project.mode, changes: await project.changes(), outside: status.outside },
        };
      },
    );

    app.get(
      '/project/actions',
      { preHandler: app.requireAuth, schema: { response: { 200: projectActionsReply } } },
      async (request) => ({ data: deps.code === undefined ? [] : await deps.code.actions.list(request) }),
    );

    app.post(
      '/project/actions/:id',
      {
        preHandler: app.requireAuth,
        config: { audit: audited('rbac') },
        schema: { params: projectActionParams, body: projectActionBody, response: { 200: projectActionReply } },
      },
      async (request) => {
        if (deps.code === undefined) {
          throw new NotFoundError(`There is no project action "${request.params.id}".`, { id: request.params.id });
        }
        return { data: await deps.code.actions.run(request, { id: request.params.id, ...request.body }) };
      },
    );

    app.get(
      '/project/overview',
      { preHandler: app.requireAuth, schema: { response: { 200: projectOverviewReply } } },
      async (request) => {
        if (!(await app.rbac.resolve(request)).superAdmin) {
          throw new ForbiddenError('Only a super admin can see the project.', 'FORBIDDEN', {});
        }
        const code = deps.code?.runtime.current();
        const client = deps.code?.runtime.client();
        const files = await project.files();
        const status = await project.status();
        return {
          data: {
            root: project.root,
            version: APP_VERSION,
            mode: project.mode,
            codeEnabled: deps.code !== undefined,
            loadedAt: code === undefined || code.loadedAt === 0 ? null : code.loadedAt,
            actions: [...(code?.actions.values() ?? [])].map((action) => ({
              id: action.id,
              source: action.source,
              label: action.definition.label,
              database: action.database,
              table: action.definition.table,
              bulk: action.definition.bulk === true,
              permission: action.definition.permission ?? 'update',
            })),
            hooks: (code?.hooks ?? []).map((hook) => ({
              source: hook.source,
              database: hook.database,
              table: hook.definition.table,
              events: [...hook.events],
              onImport: hook.definition.onImport === true,
            })),
            files: {
              pages: files.filter((path) => path.startsWith('pages/')),
              schema: files.filter((path) => path.startsWith('schema/')),
            },
            pages: (client?.pages ?? []).map((page) => ({
              slug: page.name,
              source: page.source,
              title: page.title,
              group: page.nav.group,
              hidden: page.nav.hidden,
            })),
            widgets: (client?.widgets ?? []).map((widget) => ({
              id: `project.${widget.name}`,
              source: widget.source,
              kind: widget.kind,
            })),
            problems: [...(code?.problems ?? []), ...(deps.code?.pageProblems() ?? [])],
            hookFailures: deps.code?.runtime.failures.list() ?? [],
            changes: status.entries,
          },
        };
      },
    );

    app.get(
      '/project/client/*',
      { preHandler: app.requireAuth, schema: { params: projectClientParams } },
      async (request, reply) => {
        const path = request.params['*'];
        const read = deps.code === undefined ? ({ status: 'missing' } as const) : await deps.code.client.readFile(path);
        if (read.status === 'missing') {
          throw new NotFoundError(`The project build has no file "${path}".`, { path });
        }
        if (read.status === 'changed') {
          // Serving bytes the build did not produce would run code nobody built.
          throw new ValidationFailedError(
            `The built file "${path}" changed after the build, so it will not be served. Build the project again.`,
            { path },
          );
        }
        return reply
          .header('content-type', read.contentType)
          .header('x-content-type-options', 'nosniff')
          // The name carries a hash of the content, so a URL never changes meaning.
          .header('cache-control', 'private, max-age=31536000, immutable')
          .send(read.bytes);
      },
    );
  };
}
