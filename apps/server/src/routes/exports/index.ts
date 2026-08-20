// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Data-exports routes (M7-T07, 09-generated-app.md §11.2), mounted under
 * `/api/v1`:
 *
 * - `POST /exports`              — request an export → 202 + `export-run` job.
 *   Guard: per-table `table:<conn>:<table>:export` AFTER snapshot identifier
 *   resolution (08 §5.2). The caller's PII capability is captured here and
 *   rides the job payload — the job never re-derives grants.
 * - `GET  /exports`              — own exports; everyone's with
 *   {@link EXPORTS_MANAGE_PERMISSION} (fail-closed until the key is granted).
 * - `GET  /exports/:id`          — status poll (owner or manage).
 * - `GET  /exports/:id/download` — authenticated artifact stream (owner or
 *   manage); 410 once expired, 409 while processing.
 *
 * `xlsx` is in the §3.25 format vocabulary but NOT buildable without a new
 * dependency — it is rejected here with a clear 422 (documented deviation).
 */
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  exportsRepo,
  filesRepo,
  pagesRepo,
  viewsRepo,
  type DataExport,
  type EnqueueJobInput,
  type Job,
  type MetaDb,
  type StoredFile,
} from '@adminium/meta';

import type { ConnectionManager } from '../../connections/manager.js';
import { canReadPii } from '../../crud/mask.js';
import { loadSnapshotView } from '../../data-io/snapshot-view.js';
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationFailedError,
} from '../../errors.js';
import type { FileStorage } from '../../files/storage.js';
import { EXPORT_RUN_KIND } from '../../jobs/export-run.js';
import {
  exportIdParams,
  exportsCreateBody,
  exportsCreateReply,
  exportsGetReply,
  exportsListQuery,
  exportsListReply,
  type ExportView,
} from './schema.js';

/**
 * `system:exports:manage` — see-everyone's-exports. Declared in the M7-T07
 * handoff for meta's SYSTEM_ACTION_KEYS (`exports.manage`); until assembly
 * lands the key the check parses to "deny", so the list stays mine-only.
 */
export const EXPORTS_MANAGE_PERMISSION = 'system:exports:manage';

export interface ExportsRoutesDeps {
  meta: MetaDb;
  manager: ConnectionManager;
  storage: FileStorage;
  /** `app.jobs.enqueue` in compose; a jobsRepo-backed stub in tests. */
  enqueue: (input: EnqueueJobInput) => Promise<Job>;
}

/**
 * `config.source.table` off a page envelope, which `pagesRepo` stores opaquely.
 * Same narrowing the generate and llm-apply paths do against the same field.
 */
function pageSourceTable(config: unknown): string | null {
  const source = (config as { source?: { table?: unknown } } | null)?.source;
  return typeof source?.table === 'string' && source.table.length > 0 ? source.table : null;
}

/** The saved grid state a `filters` view stores (routes/views/schema.ts). */
interface ViewQuery {
  search?: unknown;
  sort?: unknown;
  filters?: unknown[];
}

/**
 * What an export actually reads, resolved BEFORE the grant check — §5.2's
 * "identifier resolution first, then RBAC on the resolved name".
 *
 * A `table` source names its table. A `view` source does NOT: it names a saved
 * grid state, which belongs to a PAGE, and the page carries the binding. So the
 * resolution is view → page → `config.source.table`, and the view's own filters
 * ride along as the query. The grant is then checked on the resolved table
 * exactly as for a direct table export — a saved view is a shortcut through the
 * same door, never a way around it.
 *
 * `page` resolves to nothing and never can: `exportSourceSchema` carries
 * `table`, `viewId` and `filters`, and no field that identifies a page. It is a
 * kind the vocabulary advertises and the payload cannot express.
 */
async function resolveSource(
  meta: MetaDb,
  source: { kind: 'table' | 'view' | 'page'; table?: string | null | undefined; viewId?: string | null | undefined; filters?: unknown[] | undefined },
  connectionId: string,
  userId: string,
): Promise<{ table: string; filters: unknown[] | undefined }> {
  if (source.kind === 'page') {
    throw new ValidationFailedError(
      '`source.kind = "page"` cannot be exported: an export source carries no page id. Export the page\'s table, or a saved view of it.',
      { kind: source.kind },
    );
  }

  if (source.kind === 'table') {
    if (typeof source.table !== 'string' || source.table.length === 0) {
      throw new ValidationFailedError('`source.table` is required for a table export.', {
        kind: source.kind,
      });
    }
    return { table: source.table, filters: source.filters };
  }

  if (typeof source.viewId !== 'string' || source.viewId.length === 0) {
    throw new ValidationFailedError('`source.viewId` is required for a view export.', {
      kind: source.kind,
    });
  }
  const saved = await viewsRepo(meta).findById(source.viewId);
  // A view the caller cannot see is reported as absent rather than forbidden:
  // whether a private view exists is itself the owner's business.
  if (saved === null || saved.kind !== 'filters' || (saved.userId !== null && saved.userId !== userId)) {
    throw new NotFoundError(`View ${source.viewId} not found.`);
  }

  const page = await pagesRepo(meta).findById(saved.pageId);
  const table = page === null ? null : pageSourceTable(page.config);
  if (page === null || table === null) {
    throw new ValidationFailedError('That saved view is not bound to a table.', {
      viewId: source.viewId,
    });
  }
  if (page.connectionId !== null && page.connectionId !== connectionId) {
    throw new ValidationFailedError('That saved view belongs to a different connection.', {
      viewId: source.viewId,
    });
  }

  const query = (saved.config ?? {}) as ViewQuery;
  // REFUSED RATHER THAN IGNORED. A view's search narrows what it shows, and an
  // export source has nowhere to carry one — exporting the view without it would
  // hand back MORE rows than the view displays and call the file by the view's
  // name. Sort is dropped silently by contrast, because ordering changes how the
  // same rows are arranged, not which rows they are.
  if (typeof query.search === 'string' && query.search.length > 0) {
    throw new ValidationFailedError(
      'That saved view has a search term, and an export cannot carry one yet — the file would contain more rows than the view shows.',
      { viewId: source.viewId },
    );
  }

  const viewFilters = Array.isArray(query.filters) ? query.filters : undefined;
  const extra = source.filters;
  const filters =
    viewFilters === undefined ? extra : extra === undefined ? viewFilters : [...viewFilters, ...extra];
  return { table, filters };
}

function requireUserId(request: FastifyRequest): string {
  const user = (request as unknown as { user?: { id?: string } }).user;
  const id = user?.id ?? request.apiKeyPrincipal?.id ?? null;
  if (id === null) throw new UnauthorizedError();
  return id;
}

export function exportsRoutes(deps: ExportsRoutesDeps): FastifyPluginAsyncZod {
  const { meta, manager, storage } = deps;
  const exports = exportsRepo(meta);
  const files = filesRepo(meta);

  function toView(row: DataExport, file: StoredFile | null, jobId: string | null = null): ExportView {
    return {
      id: row.id,
      connectionId: row.connectionId,
      requestedBy: row.requestedBy,
      source: row.source,
      format: row.format,
      status: row.status,
      fileId: row.fileId,
      filename: file?.filename ?? null,
      sizeBytes: file?.sizeBytes ?? null,
      rowCount: row.rowCount,
      error: row.error,
      jobId,
      createdAt: row.createdAt,
      completedAt: row.completedAt,
      expiresAt: row.expiresAt,
    };
  }

  async function fileFor(row: DataExport): Promise<StoredFile | null> {
    return row.fileId === null ? null : files.findById(row.fileId);
  }

  /** Owner sees their own; anyone else needs the manage grant. */
  async function assertVisible(request: FastifyRequest, row: DataExport, userId: string): Promise<void> {
    if (row.requestedBy === userId) return;
    if (await request.can(EXPORTS_MANAGE_PERMISSION)) return;
    throw new NotFoundError(`Export ${row.id} not found.`);
  }

  return async (app) => {
    app.post(
      '/exports',
      { schema: { body: exportsCreateBody, response: { 202: exportsCreateReply } } },
      async (request, reply) => {
        const userId = requireUserId(request);
        const { connectionId, source, format } = request.body;

        if (format === 'xlsx') {
          throw new ValidationFailedError(
            'xlsx exports are not available in this build — use csv or json.',
            { format },
          );
        }
        const resolved = await resolveSource(meta, source, connectionId, userId);

        await manager.mustFind(connectionId);
        const view = await loadSnapshotView(meta, connectionId);
        // Identifier resolution FIRST, then RBAC on the resolved name (§5.2).
        const table = view.table(resolved.table);
        const permission = `table:${connectionId}:${table.id}:export`;
        if (!(await request.can(permission))) {
          throw new ForbiddenError('You do not have export access to this table.', 'TABLE_FORBIDDEN', {
            permission,
          });
        }

        const row = await exports.create({
          connectionId,
          requestedBy: userId,
          // The resolved table and the resolved query are what gets STORED, so
          // `export-run` reads one shape whatever kind was asked for and never
          // re-derives a binding the grant check was made against.
          source: {
            ...source,
            table: table.id,
            ...(resolved.filters === undefined ? {} : { filters: resolved.filters }),
          },
          format,
        });
        const job = await deps.enqueue({
          kind: EXPORT_RUN_KIND,
          payload: {
            exportId: row.id,
            userId,
            // PII capability captured at request time (crud/mask.ts).
            unmasked: await canReadPii(request),
          },
        });
        await app.rbac.audit(request, {
          category: 'export',
          action: 'export.request',
          connectionId,
          changes: { after: { exportId: row.id, table: table.id, format } },
        });
        return reply.status(202).send({ data: toView(row, null, job.id) });
      },
    );

    app.get(
      '/exports',
      { schema: { querystring: exportsListQuery, response: { 200: exportsListReply } } },
      async (request) => {
        const userId = requireUserId(request);
        const manage = await request.can(EXPORTS_MANAGE_PERMISSION);
        const rows = await exports.list({
          ...(manage ? {} : { requestedBy: userId }),
          limit: request.query.limit,
        });
        const views: ExportView[] = [];
        for (const row of rows) views.push(toView(row, await fileFor(row)));
        return { data: views };
      },
    );

    app.get(
      '/exports/:id',
      { schema: { params: exportIdParams, response: { 200: exportsGetReply } } },
      async (request) => {
        const userId = requireUserId(request);
        const row = await exports.findById(request.params.id);
        if (row === null) throw new NotFoundError(`Export ${request.params.id} not found.`);
        await assertVisible(request, row, userId);
        return { data: toView(row, await fileFor(row)) };
      },
    );

    app.get(
      '/exports/:id/download',
      { schema: { params: exportIdParams } },
      async (request, reply) => {
        const userId = requireUserId(request);
        const row = await exports.findById(request.params.id);
        if (row === null) throw new NotFoundError(`Export ${request.params.id} not found.`);
        await assertVisible(request, row, userId);
        if (row.status === 'expired' || (row.expiresAt !== null && row.expiresAt < Date.now())) {
          throw new AppError(410, 'EXPORT_EXPIRED', 'This export has expired — request a new one.');
        }
        if (row.status !== 'ready' || row.fileId === null) {
          throw new ConflictError(`Export is ${row.status}.`, 'CONFLICT', { status: row.status });
        }
        const file = await files.findById(row.fileId);
        if (file === null || file.deletedAt !== null) {
          throw new NotFoundError('The export artifact is no longer stored.');
        }
        const stream = await storage.read(file.storageKey);
        const safeName = file.filename.replaceAll(/["\\\r\n]/g, '_');
        return reply
          .header('content-type', file.mime)
          .header('content-length', String(file.sizeBytes))
          .header('content-disposition', `attachment; filename="${safeName}"`)
          .send(stream);
      },
    );
  };
}
