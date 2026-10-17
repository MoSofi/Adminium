// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Import-wizard routes, mounted under `/api/v1`:
 *
 * - `POST /imports/upload`       — raw `text/csv` body → files storage (kind
 *   `import`) + header/sample/row-count preview for the mapping step. The
 *   content-type parser is registered INSIDE this plugin, so the raw-body
 *   handling is encapsulated (Fastify parser scoping).
 * - `POST /imports` — create + VALIDATE: type-coerce every mapped cell against
 * the effective schema, collect per-row issues into the validation report,
 * land the row in `ready`. Guard: per-table `table:<conn>:<table>:import`
 * AFTER identifier resolution.
 * - `POST /imports/:id/run`      — enqueue the `import-run` job (owner only,
 *   grant re-checked at enqueue time).
 * - `GET  /imports` / `GET /imports/:id` — mine (or all with
 *   {@link IMPORTS_MANAGE_PERMISSION}, fail-closed until the key lands).
 * - `GET  /imports/:id/error-report` — the failure-rows CSV.
 * - `GET  /imports/:id/preview` — what running a `ready` import would do with
 *   each line (new, already here, refused), judged by the job's own judge
 *   (`data-io/import-judge.ts`) as the requester's roles stand now. It writes
 *   nothing, and answers only the import's requester.
 *
 * An import that MATCHES its lines to stored rows (`skip`, `upsert`) says, a
 * line at a time, which values the table holds. So it is made, previewed and
 * run only by somebody who holds the table's `read` as well as its `import`,
 * and never matched on a column they see masked.
 *
 * The upload takes a file's commas, a pasted sheet's tabs, or semicolons, and
 * stores anything but commas re-written as comma CSV: the job and every other
 * reader of a stored file read one shape.
 */
import { assertNotPrivate } from '../../crud/row-limit.js';
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
import { privilegeRefusal, writeRefused } from '../../connections/privileges.js';
import { SnapshotView, type ResolvedTable } from '../../crud/identifiers.js';
import { coerceCell } from '../../data-io/coerce.js';
import { createCsvParser, parseCsv, serializeCsvRow, sniffDelimiter } from '../../data-io/csv.js';
import { assertMatchReadable, assertUpsertUpdates, openImportJudge, type EarlierLines, type ImportLine, type LineVerdict } from '../../data-io/import-judge.js';
import { canReadPii } from '../../crud/mask.js';
import type { RecordWriteService } from '../../crud/write-service.js';
import { loadSnapshotView } from '../../data-io/snapshot-view.js';
import { requestReadsWhole } from '../../crud/row-reach-request.js';
import { assertImportReadable, readViewOf } from '../../crud/read-view.js';
import { assertImportCreatable, createLimitOf, updateLimitOf } from '../../rbac/update-limits.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationFailedError,
} from '../../errors.js';
import type { ByteLocation, FileStore } from '../../files/store.js';
import { IMPORT_RUN_KIND } from '../../jobs/import-run.js';
import {
  PREVIEW_LABEL_MAX,
  PREVIEW_LINE_CAP,
  REPORT_ISSUE_CAP,
  UPLOAD_SAMPLE_ROWS,
  importIdParams,
  importsCreateBody,
  importsCreateReply,
  importsGetReply,
  importsListQuery,
  importsListReply,
  importsPreviewQuery,
  importsPreviewReply,
  importsRunReply,
  importsUploadQuery,
  importsUploadReply,
  type ImportView,
  type PreviewLineView,
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
  storage: FileStore;
  /** `app.jobs.enqueue` in compose; a jobsRepo-backed stub in tests. */
  enqueue: (input: EnqueueJobInput) => Promise<Job>;
  /** The write service the import job writes through: a preview is judged by the same rules. */
  writes?: RecordWriteService | undefined;
}

const DELIMITER_NAMES = { ',': 'comma', '\t': 'tab', ';': 'semicolon' } as const;
/** How many lines a preview hands the judge at a time: one match lookup each. */
const PREVIEW_BATCH = 200;

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

/** The VALIDATE stage — pure, also exercised directly in tests. */
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

  /**
   * Somebody else's import — its file, its mapping, the report of the rows it
   * refused, each of which quotes rows — is opened by a holder of the manage
   * grant whom nothing limits on the table it wrote: a report of rows that
   * are not theirs is not theirs to read, whoever asked for the import.
   */
  async function mayOpenAnothers(request: FastifyRequest, row: DataImport): Promise<boolean> {
    if (!(await request.can(IMPORTS_MANAGE_PERMISSION))) return false;
    return requestReadsWhole(meta, request, row.connectionId, row.tableName);
  }

  async function assertVisible(request: FastifyRequest, row: DataImport, userId: string): Promise<void> {
    if (row.requestedBy === userId) return;
    if (await mayOpenAnothers(request, row)) return;
    throw new NotFoundError(`Import ${row.id} not found.`);
  }

  async function readStoredCsv(file: ByteLocation): Promise<string> {
    const stream = await storage.read(file);
    stream.setEncoding('utf8');
    let text = '';
    for await (const chunk of stream) text += chunk as string;
    return text;
  }

  /**
   * The header and the first `cap` lines of a stored file, read as a stream
   * that is let go once it has them: a preview of a 30 MB file reads its
   * first two thousand lines, not the file. `more` says a line came after
   * them; with `countAll` the rest is read too, only to be counted (an
   * import whose validation left no count).
   */
  async function firstLines(file: ByteLocation, cap: number, countAll: boolean): Promise<{ header: string[] | undefined; data: string[][]; more: boolean; counted: number }> {
    const stream = await storage.read(file);
    stream.setEncoding('utf8');
    const parser = createCsvParser();
    let header: string[] | undefined;
    const data: string[][] = [];
    let counted = 0;
    /** Takes one record; false once nothing more is wanted of the file. */
    const take = (record: string[]): boolean => {
      if (header === undefined) {
        header = record;
        return true;
      }
      if (record.length === 1 && record[0]?.trim() === '') return true;
      counted += 1;
      if (data.length < cap) data.push(record);
      return countAll || counted <= cap;
    };
    let wanted = true;
    try {
      for await (const chunk of stream) {
        for (const record of parser.write(chunk as string)) {
          wanted = take(record);
          if (!wanted) break;
        }
        if (!wanted) break;
      }
      if (wanted) for (const record of parser.end()) if (!take(record)) break;
    } finally {
      stream.destroy();
    }
    return { header, data, more: counted > cap, counted };
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
        // A file's commas, a pasted sheet's tabs, or semicolons: told from the first line.
        const delimiter = sniffDelimiter(text);
        const rows = parseCsv(text, delimiter);
        const headless = request.query.header === 'none';
        const notBlank = (record: string[]) => !(record.length === 1 && record[0]?.trim() === '');
        let header = rows[0];
        if (headless) {
          // Every row is data: the columns are named by their place.
          // (Counted in a loop: a paste has more lines than one call takes arguments.)
          const width = rows.reduce((widest, record) => (notBlank(record) && record.length > widest ? record.length : widest), 0);
          if (width === 0) throw new ValidationFailedError('There are no rows to bring in.', {});
          header = Array.from({ length: width }, (_, index) => `Column ${index + 1}`);
        }
        if (header === undefined || header.every((cell) => cell.trim() === '')) {
          throw new ValidationFailedError('The file has no header row.', {});
        }
        const dataRows = (headless ? rows : rows.slice(1)).filter(notBlank);
        // Stored as comma CSV with a header row, whatever was sent: the job and the validate step read one shape.
        const stored = headless || delimiter !== ',' ? Buffer.from([header, ...(headless ? rows : rows.slice(1))].map(serializeCsvRow).join(''), 'utf8') : body;

        const fileId = newId('file');
        const written = await storage.write({
          id: fileId,
          kind: 'import',
          filename: request.query.filename,
          mime: 'text/csv; charset=utf-8',
          bytes: stored,
        });
        const file = await files.create({
          id: fileId,
          filename: request.query.filename,
          mime: 'text/csv; charset=utf-8',
          sizeBytes: written.sizeBytes,
          sha256: written.sha256,
          kind: 'import',
          uploadedBy: userId,
          // Wave 0024: where the bytes actually landed. With no destination
          // configured these are `null` / `'local'` / the id — exactly the row
          // this call wrote before the wave.
          storageKey: written.storageKey,
          destinationId: written.destinationId,
          storage: written.storage,
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
            delimiter: DELIMITER_NAMES[delimiter],
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
        const mode = options.mode ?? 'insert';

        const connection = await manager.mustFind(connectionId);
        const view = await loadSnapshotView(meta, connectionId);
        // Identifier resolution FIRST, then RBAC on the resolved name.
        const table = view.table(tableParam);
        assertNotPrivate(table, 'no file is brought in to it');
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
        // Refused up front rather than once per row: an import the role may not
        // write would otherwise fail every row with the database's own words.
        const rights = await manager.tablePrivileges(connection);
        if (
          writeRefused(rights, table.id, 'create') ||
          (mode === 'upsert' && writeRefused(rights, table.id, 'update'))
        ) {
          throw privilegeRefusal(table);
        }
        // Matching says which values the table holds: it is for somebody who reads the table.
        assertMatchReadable(await request.can(`table:${connectionId}:${table.id}:read`), mode, connectionId, table.id);
        // Changing the rows a file matches is an update: for somebody who holds it.
        assertUpsertUpdates(await request.can(`table:${connectionId}:${table.id}:update`), mode, connectionId, table.id);
        // As this person reads the table: a column their role does not read, or sees masked, is no match key, and no column brought in unless their update names it.
        const permissions = await app.rbac.resolve(request);
        assertImportReadable(
          readViewOf(view, permissions),
          table.id,
          mapping.columns,
          mode === 'insert' ? null : (options.matchColumn ?? null),
          updateLimitOf(permissions, connectionId, table.id)?.writable ?? null,
          await canReadPii(request, connectionId, table.id),
        );
        // An import makes new rows: held to what the role's create may give one.
        assertImportCreatable(createLimitOf(permissions, connectionId, table.id), table.id, mapping.columns);
        // `upsert` and `skip` both match each line to a row: they differ in what a matched line does.
        if (mode !== 'insert') {
          const match = options.matchColumn ?? null;
          if (match === null) {
            throw new ValidationFailedError(`${mode === 'upsert' ? 'Upsert' : 'Skip'} mode requires \`options.matchColumn\`.`, {});
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
              `${mode === 'upsert' ? 'Upsert' : 'Skip'} mode requires \`options.matchColumn\` to be one of the mapped target columns.`,
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

        // --- VALIDATE stage: parse + coerce, collect per-row issues ----
        const rows = parseCsv(await readStoredCsv(upload));
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
      '/imports/:id/preview',
      { schema: { params: importIdParams, querystring: importsPreviewQuery, response: { 200: importsPreviewReply } } },
      async (request) => {
        const userId = requireUserId(request);
        const row = await imports.findById(request.params.id);
        // Its requester's alone: what each line matches is told as that one person reaches the rows, and to nobody else.
        if (row === null || row.requestedBy !== userId) throw new NotFoundError(`Import ${request.params.id} not found.`);
        if (row.status !== 'ready') {
          throw new ConflictError(`Import is ${row.status}.`, 'CONFLICT', { status: row.status });
        }
        const connection = await manager.mustFind(row.connectionId);
        const view = await loadSnapshotView(meta, row.connectionId);
        const table = view.table(row.tableName);
        assertNotPrivate(table, 'no file is brought in to it');
        // The grant as it stands now, as the run checks it again.
        const permission = `table:${row.connectionId}:${table.id}:import`;
        if (!(await request.can(permission))) {
          throw new ForbiddenError('You do not have import access to this table.', 'TABLE_FORBIDDEN', { permission });
        }
        if (connection.readOnly || table.readOnly) {
          throw new ForbiddenError(
            connection.readOnly ? 'This connection is read-only — Adminium never writes to it.' : 'This table has no primary key (or is a view) and is read-only.',
            'READ_ONLY_MODE',
            connection.readOnly ? { connectionId: row.connectionId } : { table: table.id },
          );
        }
        const upload = await files.findById(row.fileId);
        if (upload === null || upload.deletedAt !== null) throw new NotFoundError(`Upload ${row.fileId} not found.`);

        // The job's own judge, opened as the requester's roles stand NOW; what refuses the whole import refuses the preview.
        const judge = await openImportJudge({ meta, manager, writes: deps.writes }, row, userId);
        // The first lines only, however long the file: its whole count is the one its validation took.
        const known = row.stats?.total;
        const { header, data, more, counted } = await firstLines(upload, PREVIEW_LINE_CAP, known === undefined);
        if (header === undefined) throw new ValidationFailedError('The file is empty.', {});
        const mapped = judge.mapping(header);
        const judged = data.length;
        const total = more ? Math.max(known ?? counted, judged + 1) : judged;

        const counts = { new: 0, here: 0, refused: 0 };
        const lines: PreviewLineView[] = [];
        const { offset, limit } = request.query;
        // Which cell names a line to the person who typed it: the one the lines are matched on, else the first one mapped.
        const matchOn = row.options.matchColumn;
        const labelAt = (mapped.find((target) => target.column.name === matchOn) ?? [...mapped].sort((a, b) => a.index - b.index)[0])?.index;
        const labelOf = (rowNumber: number): string | undefined => {
          const cell = labelAt === undefined ? '' : (data[rowNumber - 1]?.[labelAt] ?? '').trim();
          return cell === '' ? undefined : [...cell].slice(0, PREVIEW_LABEL_MAX).join('');
        };
        const told = (rowNumber: number, verdict: Pick<LineVerdict, 'status'> & { code?: string; column?: string; message?: string; earlierLine?: number }): void => {
          counts[verdict.status] += 1;
          if (rowNumber <= offset || rowNumber > offset + limit) return;
          const label = labelOf(rowNumber);
          lines.push({
            row: rowNumber,
            status: verdict.status,
            ...(label === undefined ? {} : { label }),
            ...(verdict.status === 'refused' ? { code: verdict.code, message: verdict.message, ...(verdict.column === undefined || verdict.column === '' ? {} : { column: verdict.column }) } : {}),
            ...(verdict.earlierLine === undefined ? {} : { earlierLine: verdict.earlierLine }),
          });
        };
        // The lines this preview called new, by match value: a later line with the same value finds the row the first would make.
        const earlier: EarlierLines = new Map();
        // …and their keys: a later line with the key of one of them is refused, as the database would refuse it.
        const earlierKeys = new Map<string, number>();
        for (let at = 0; at < judged; at += PREVIEW_BATCH) {
          const batch: ImportLine[] = [];
          const unread = new Map<number, { code: string; column: string; message: string }>();
          for (let index = at; index < Math.min(judged, at + PREVIEW_BATCH); index += 1) {
            const parsed = judge.parse(mapped, data[index]!, index + 1);
            if (parsed.line !== null) batch.push(parsed.line);
            else unread.set(index + 1, parsed.issues[0]!);
          }
          // No hook runs, and no number is claimed: nothing is written anywhere.
          const verdicts = await judge.lines(batch, { hooks: false, earlier, earlierKeys });
          const byRow = new Map(batch.map((line, index) => [line.rowNumber, verdicts[index]!]));
          for (let rowNumber = at + 1; rowNumber <= Math.min(judged, at + PREVIEW_BATCH); rowNumber += 1) {
            const cell = unread.get(rowNumber);
            told(rowNumber, cell !== undefined ? { status: 'refused', ...cell } : byRow.get(rowNumber)!);
          }
        }
        return {
          data: {
            total,
            judged,
            capped: total > judged,
            counts,
            hooksNotRun: judge.hooked.create || judge.hooked.update,
            lines,
          },
        };
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
        const shown: DataImport[] = [];
        for (const row of rows) if (row.requestedBy === userId || (await mayOpenAnothers(request, row))) shown.push(row);
        return { data: shown.map(toView) };
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
        const stream = await storage.read(file);
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
