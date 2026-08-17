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
        if (source.kind !== 'table' || typeof source.table !== 'string' || source.table.length === 0) {
          throw new ValidationFailedError('Only `source.kind = "table"` exports are supported.', {
            kind: source.kind,
          });
        }

        await manager.mustFind(connectionId);
        const view = await loadSnapshotView(meta, connectionId);
        // Identifier resolution FIRST, then RBAC on the resolved name (§5.2).
        const table = view.table(source.table);
        const permission = `table:${connectionId}:${table.id}:export`;
        if (!(await request.can(permission))) {
          throw new ForbiddenError('You do not have export access to this table.', 'TABLE_FORBIDDEN', {
            permission,
          });
        }

        const row = await exports.create({
          connectionId,
          requestedBy: userId,
          source: { ...source, table: table.id },
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
