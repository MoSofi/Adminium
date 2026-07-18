/**
 * Import-wizard routes (M7-T07, 09-generated-app.md §11.1), mounted under
 * `/api/v1`:
 *
 * - `POST /imports/upload`       — raw `text/csv` body → files storage (kind
 *   `import`) + header/sample/row-count preview for the mapping step. The
 *   content-type parser is registered INSIDE this plugin, so the raw-body
 *   handling is encapsulated (Fastify parser scoping).
 * - `POST /imports`              — create + VALIDATE: type-coerce every mapped
 *   cell against the effective schema, collect per-row issues into the
 *   validation report (§11.1 "non-blocking"), land the row in `ready`.
 *   Guard: per-table `table:<conn>:<table>:import` AFTER identifier
 *   resolution (08 §5.2).
 * - `POST /imports/:id/run`      — enqueue the `import-run` job (owner only,
 *   grant re-checked at enqueue time).
 * - `GET  /imports` / `GET /imports/:id` — mine (or all with
 *   {@link IMPORTS_MANAGE_PERMISSION}, fail-closed until the key lands).
 * - `GET  /imports/:id/error-report` — the failure-rows CSV.
 */
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  filesRepo,
  importsRepo,
  newId,
  type DataImport,
  type EnqueueJobInput,
  type Job,
  type MetaDb,
} from '@adminium/meta';

import type { ConnectionManager } from '../../connections/manager.js';
import { SnapshotView, type ResolvedTable } from '../../crud/identifiers.js';
import { coerceCell } from '../../data-io/coerce.js';
import { parseCsv } from '../../data-io/csv.js';
import { loadSnapshotView } from '../../data-io/snapshot-view.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationFailedError,
} from '../../errors.js';
import type { FileStorage } from '../../files/storage.js';
import { IMPORT_RUN_KIND } from '../../jobs/import-run.js';
import {
  REPORT_ISSUE_CAP,
  UPLOAD_SAMPLE_ROWS,
  importIdParams,
  importsCreateBody,
  importsCreateReply,
  importsGetReply,
  importsListQuery,
  importsListReply,
  importsRunReply,
  importsUploadQuery,
  importsUploadReply,
  type ImportView,
  type ValidationIssueView,
  type ValidationReport,
} from './schema.js';

/** Companion to exports' manage grant — see the handoff note there. */
export const IMPORTS_MANAGE_PERMISSION = 'system:imports:manage';

/** Upload cap: 32 MiB of CSV (route-scoped bodyLimit). */
export const UPLOAD_BODY_LIMIT = 32 * 1024 * 1024;

export interface ImportsRoutesDeps {
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

function toView(row: DataImport): ImportView {
  return {
    id: row.id,
    connectionId: row.connectionId,
    tableName: row.tableName,
    requestedBy: row.requestedBy,
    fileId: row.fileId,
    mapping: row.mapping,
    options: row.options,
    status: row.status,
    stats: row.stats,
    errorReportFileId: row.errorReportFileId,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

/** The VALIDATE stage (§11.1 step 3) — pure, also exercised directly in tests. */
export function validateRows(
  rows: string[][],
  header: string[],
  mapping: DataImport['mapping'],
  view: SnapshotView,
  table: ResolvedTable,
): ValidationReport {
  const byName = new Map<string, number>();
  header.forEach((name, index) => byName.set(name.trim(), index));
  const mapped: { index: number; column: ReturnType<SnapshotView['column']> }[] = [];
  for (const entry of mapping.columns) {
    if (entry.to === null) continue;
    const index = byName.get(entry.from.trim());
    if (index === undefined) {
      throw new ValidationFailedError(
        `Mapped source column ${JSON.stringify(entry.from)} is not in the file header.`,
        { from: entry.from },
      );
    }
    mapped.push({ index, column: view.column(table, entry.to) });
  }
  if (mapped.length === 0) {
    throw new ValidationFailedError('The mapping imports no columns.', {});
  }

  const issues: ValidationIssueView[] = [];
  let invalid = 0;
  let total = 0;
  for (const record of rows) {
    if (record.length === 1 && record[0]?.trim() === '') continue;
    total += 1;
    let bad = false;
    for (const target of mapped) {
      const raw = record[target.index] ?? '';
      const result = coerceCell(raw, target.column);
      if (!result.ok) {
        bad = true;
        if (issues.length < REPORT_ISSUE_CAP) {
          issues.push({
            row: total,
            column: target.column.name,
            code: result.code,
            message: result.message,
            value: raw,
          });
        }
      }
    }
    if (bad) invalid += 1;
  }
  return { total, valid: total - invalid, invalid, issues };
}

export function importsRoutes(deps: ImportsRoutesDeps): FastifyPluginAsyncZod {
  const { meta, manager, storage } = deps;
  const imports = importsRepo(meta);
  const files = filesRepo(meta);

  async function assertVisible(request: FastifyRequest, row: DataImport, userId: string): Promise<void> {
    if (row.requestedBy === userId) return;
    if (await request.can(IMPORTS_MANAGE_PERMISSION)) return;
    throw new NotFoundError(`Import ${row.id} not found.`);
  }

  async function readStoredCsv(storageKey: string): Promise<string> {
    const stream = await storage.read(storageKey);
    stream.setEncoding('utf8');
    let text = '';
    for await (const chunk of stream) text += chunk as string;
    return text;
  }

  return async (app) => {
    // Raw CSV bodies, this plugin's scope only.
    app.addContentTypeParser('text/csv', { parseAs: 'buffer' }, (_request, body, done) => {
      done(null, body);
    });

    app.post(
      '/imports/upload',
      {
        bodyLimit: UPLOAD_BODY_LIMIT,
        schema: { querystring: importsUploadQuery, response: { 201: importsUploadReply } },
      },
      async (request, reply) => {
        const userId = requireUserId(request);
        const body = request.body;
        if (!Buffer.isBuffer(body) || body.byteLength === 0) {
          throw new ValidationFailedError('Send the CSV file as a raw `text/csv` body.', {});
        }
        const text = body.toString('utf8');
        const rows = parseCsv(text);
        const header = rows[0];
        if (header === undefined || header.every((cell) => cell.trim() === '')) {
          throw new ValidationFailedError('The file has no header row.', {});
        }
        const dataRows = rows
          .slice(1)
          .filter((record) => !(record.length === 1 && record[0]?.trim() === ''));

        const fileId = newId('file');
        const written = await storage.write(fileId, body);
        const file = await files.create({
          id: fileId,
          filename: request.query.filename,
          mime: 'text/csv; charset=utf-8',
          sizeBytes: written.sizeBytes,
          sha256: written.sha256,
          kind: 'import',
          uploadedBy: userId,
        });
        await app.rbac.audit(request, {
          category: 'data',
          action: 'import.upload',
          changes: { after: { fileId: file.id, filename: file.filename, rows: dataRows.length } },
        });
        return reply.status(201).send({
          data: {
            fileId: file.id,
            filename: file.filename,
            sizeBytes: file.sizeBytes,
            sha256: file.sha256,
            columns: header,
            sampleRows: dataRows.slice(0, UPLOAD_SAMPLE_ROWS),
            totalRows: dataRows.length,
          },
        });
      },
    );

    app.post(
      '/imports',
      { schema: { body: importsCreateBody, response: { 201: importsCreateReply } } },
      async (request, reply) => {
        const userId = requireUserId(request);
        const { fileId, connectionId, table: tableParam, mapping, options } = request.body;

        const connection = await manager.mustFind(connectionId);
        const view = await loadSnapshotView(meta, connectionId);
        // Identifier resolution FIRST, then RBAC on the resolved name (§5.2).
        const table = view.table(tableParam);
        const permission = `table:${connectionId}:${table.id}:import`;
        if (!(await request.can(permission))) {
          throw new ForbiddenError('You do not have import access to this table.', 'TABLE_FORBIDDEN', {
            permission,
          });
        }
        if (connection.readOnly) {
          throw new ForbiddenError(
            'This connection is read-only — Adminium never writes to it.',
            'READ_ONLY_MODE',
            { connectionId },
          );
        }
        if (table.readOnly) {
          throw new ForbiddenError(
            'This table has no primary key (or is a view) and is read-only.',
            'READ_ONLY_MODE',
            { table: table.id },
          );
        }
        if ((options.mode ?? 'insert') === 'upsert') {
          const match = options.matchColumn ?? null;
          if (match === null) {
            throw new ValidationFailedError('Upsert mode requires `options.matchColumn`.', {});
          }
          const matchResolved = view.column(table, match); // 422 on unknown/secret
          // The match column must actually be IMPORTED — otherwise every row's
          // match value is undefined and the "upsert" either errors per row or
          // blindly inserts duplicates (M7 wave-2 finding).
          const matchMapped = mapping.columns.some(
            (entry) => entry.to !== null && view.column(table, entry.to).name === matchResolved.name,
          );
          if (!matchMapped) {
            throw new ValidationFailedError(
              'Upsert mode requires `options.matchColumn` to be one of the mapped target columns.',
              { matchColumn: match },
            );
          }
        }

        const upload = await files.findById(fileId);
        if (upload === null || upload.kind !== 'import' || upload.deletedAt !== null) {
          throw new NotFoundError(`Upload ${fileId} not found.`);
        }
        if (upload.uploadedBy !== userId) {
          throw new ForbiddenError('You can only import files you uploaded.', 'FORBIDDEN', {});
        }

        // --- VALIDATE stage (§11.1): parse + coerce, collect per-row issues ----
        const rows = parseCsv(await readStoredCsv(upload.storageKey));
        const header = rows[0];
        if (header === undefined) throw new ValidationFailedError('The file is empty.', {});
        const report = validateRows(rows.slice(1), header, mapping, view, table);

        const row = await imports.create({
          connectionId,
          tableName: table.id,
          requestedBy: userId,
          fileId,
          mapping,
          options,
        });
        await imports.markReady(row.id, { total: report.total });
        const ready = (await imports.findById(row.id)) ?? row;

        await app.rbac.audit(request, {
          category: 'data',
          action: 'import.validate',
          connectionId,
          changes: {
            after: { importId: row.id, table: table.id, total: report.total, invalid: report.invalid },
          },
        });
        return reply.status(201).send({ data: { import: toView(ready), report } });
      },
    );

    app.post(
      '/imports/:id/run',
      { schema: { params: importIdParams, response: { 202: importsRunReply } } },
      async (request, reply) => {
        const userId = requireUserId(request);
        const row = await imports.findById(request.params.id);
        if (row === null) throw new NotFoundError(`Import ${request.params.id} not found.`);
        await assertVisible(request, row, userId);
        if (row.status !== 'ready') {
          throw new ConflictError(`Import is ${row.status}.`, 'CONFLICT', { status: row.status });
        }
        // The grant is re-checked at enqueue time — it may have been revoked
        // between validate and run.
        const permission = `table:${row.connectionId}:${row.tableName}:import`;
        if (!(await request.can(permission))) {
          throw new ForbiddenError('You do not have import access to this table.', 'TABLE_FORBIDDEN', {
            permission,
          });
        }
        const job = await deps.enqueue({
          kind: IMPORT_RUN_KIND,
          payload: { importId: row.id, userId },
        });
        await app.rbac.audit(request, {
          category: 'data',
          action: 'import.run',
          connectionId: row.connectionId,
          changes: { after: { importId: row.id, jobId: job.id } },
        });
        return reply.status(202).send({ data: { import: toView(row), jobId: job.id } });
      },
    );

    app.get(
      '/imports',
      { schema: { querystring: importsListQuery, response: { 200: importsListReply } } },
      async (request) => {
        const userId = requireUserId(request);
        const manage = await request.can(IMPORTS_MANAGE_PERMISSION);
        const rows = await imports.list({
          ...(manage ? {} : { requestedBy: userId }),
          limit: request.query.limit,
        });
        return { data: rows.map(toView) };
      },
    );

    app.get(
      '/imports/:id',
      { schema: { params: importIdParams, response: { 200: importsGetReply } } },
      async (request) => {
        const userId = requireUserId(request);
        const row = await imports.findById(request.params.id);
        if (row === null) throw new NotFoundError(`Import ${request.params.id} not found.`);
        await assertVisible(request, row, userId);
        return { data: toView(row) };
      },
    );

    app.get(
      '/imports/:id/error-report',
      { schema: { params: importIdParams } },
      async (request, reply) => {
        const userId = requireUserId(request);
        const row = await imports.findById(request.params.id);
        if (row === null) throw new NotFoundError(`Import ${request.params.id} not found.`);
        await assertVisible(request, row, userId);
        if (row.errorReportFileId === null) {
          throw new NotFoundError('This import has no error report.');
        }
        const file = await files.findById(row.errorReportFileId);
        if (file === null || file.deletedAt !== null) {
          throw new NotFoundError('The error report is no longer stored.');
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
