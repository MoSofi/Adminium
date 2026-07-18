/**
 * `import-run` job handler (M7-T07, 09-generated-app.md §11.1): executes one
 * validated adminium_imports request — streaming CSV parse, mapping +
 * type-coercion against the effective schema, chunked insert/upsert through
 * the same snapshot-allowlisted identifiers the POST /data path uses
 * (view.table / view.column — the §7-item-1 invariant), one audit entry, and
 * a realtime fan-out on `table:<conn>:<table>` so open grids refetch.
 *
 * Grants are enforced AT REQUEST TIME: the imports route checks
 * `table:<conn>:<table>:import` before the row is created and again before
 * the run is enqueued. Undo: import runs are jobs, not requests — the 30 s
 * request-scoped undo-token store does not apply; the error report + audit
 * trail are the recovery path (documented deviation).
 *
 * Failure semantics: a row that fails coercion or the database is SKIPPED
 * when `options.skipInvalid` (the §11.1 "non-blocking" default) and fails the
 * import otherwise. Every skipped row lands in the error-report CSV
 * (`error_report_file_id`). The §11.1 invariant holds either way:
 * total = inserted + updated + skipped.
 */
import {
  auditRepo,
  filesRepo,
  importsRepo,
  newId,
  type DataImport,
  type MetaDb,
} from '@adminium/meta';
import type { Kysely } from 'kysely';
import { z } from 'zod';

import type { ConnectionManager, SourceDatabase } from '../connections/manager.js';
import type { ResolvedColumn, ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import { coerceCell } from '../data-io/coerce.js';
import { EXPORT_BOM, createCsvParser, serializeCsvRow } from '../data-io/csv.js';
import { loadSnapshotView } from '../data-io/snapshot-view.js';
import type { FileStorage } from '../files/storage.js';
import { widgetDataChannel, type RealtimeHub } from '../realtime/hub.js';
import { JobCancelledError, type JobHandlerContext, type JobRegistry } from './registry.js';

export const IMPORT_RUN_KIND = 'import-run';
export const IMPORT_CHUNK_SIZE = 100;

export const importRunPayloadSchema = z.object({
  importId: z.string().min(1),
  /** Owner convention (routes/jobs): the requesting user. */
  userId: z.string().optional(),
});
export type ImportRunPayload = z.infer<typeof importRunPayloadSchema>;

export interface ImportRunDeps {
  meta: MetaDb;
  manager: ConnectionManager;
  storage: FileStorage;
  /** Optional — table-channel fan-out when the hub is wired (compose). */
  hub?: RealtimeHub | undefined;
  now?: (() => number) | undefined;
}

export function registerImportRunHandler(registry: JobRegistry, deps: ImportRunDeps): void {
  const now = deps.now ?? Date.now;
  registry.registerJobHandler(IMPORT_RUN_KIND, importRunPayloadSchema, async (payload, ctx) => {
    await executeImportRun(payload, ctx, deps, now);
    return { importId: payload.importId };
  });
}

interface RowIssue {
  row: number;
  column: string;
  code: string;
  message: string;
  raw: string;
}

async function executeImportRun(
  payload: ImportRunPayload,
  ctx: JobHandlerContext,
  deps: ImportRunDeps,
  now: () => number,
): Promise<void> {
  const imports = importsRepo(deps.meta);
  const row = await imports.findById(payload.importId);
  if (row === null) throw new Error(`import-run: import not found: ${payload.importId}`);
  if (!(await imports.markRunning(row.id, now()))) {
    ctx.log('import-run: import not in ready state, skipping', { status: row.status });
    return;
  }

  try {
    await runImport(row, payload, ctx, deps, now);
  } catch (error) {
    if (error instanceof JobCancelledError || ctx.signal.aborted) {
      await imports.markFinished(row.id, { status: 'cancelled' }, now());
      ctx.log('import-run: cancelled', { importId: row.id });
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    await imports.markFinished(row.id, { status: 'failed' }, now());
    ctx.log('import-run: failed', { importId: row.id, error: message });
    return;
  }
}

/** Resolve the mapping into (csv column index → resolved target column). */
function resolveMapping(
  header: readonly string[],
  mapping: DataImport['mapping'],
  view: SnapshotView,
  table: ResolvedTable,
): { index: number; from: string; column: ResolvedColumn }[] {
  const byName = new Map<string, number>();
  header.forEach((name, index) => byName.set(name.trim(), index));
  const out: { index: number; from: string; column: ResolvedColumn }[] = [];
  for (const entry of mapping.columns) {
    if (entry.to === null) continue; // "Don't import"
    const index = byName.get(entry.from.trim());
    if (index === undefined) {
      throw new Error(`mapped source column ${JSON.stringify(entry.from)} is not in the file header`);
    }
    out.push({ index, from: entry.from, column: view.column(table, entry.to) });
  }
  if (out.length === 0) throw new Error('the mapping imports no columns');
  return out;
}

async function runImport(
  row: DataImport,
  payload: ImportRunPayload,
  ctx: JobHandlerContext,
  deps: ImportRunDeps,
  now: () => number,
): Promise<void> {
  const imports = importsRepo(deps.meta);
  const files = filesRepo(deps.meta);

  const connection = await deps.manager.mustFind(row.connectionId);
  if (connection.readOnly) {
    throw new Error('This connection is read-only — Adminium never writes to it.');
  }
  const view = await loadSnapshotView(deps.meta, row.connectionId);
  const table = view.table(row.tableName);
  if (table.readOnly) throw new Error(`Table ${table.id} is read-only.`);

  const upload = await files.findById(row.fileId);
  if (upload === null) throw new Error(`import-run: upload file row missing: ${row.fileId}`);
  const { db, dialect } = await deps.manager.data(row.connectionId);
  /** better-sqlite3 refuses boolean binds; PG refuses numbers for booleans. */
  const bindValue = (value: unknown): unknown =>
    dialect === 'sqlite' && typeof value === 'boolean' ? (value ? 1 : 0) : value;

  const mode = row.options.mode ?? 'insert';
  const skipInvalid = row.options.skipInvalid ?? true;
  const matchColumn = mode === 'upsert' ? (row.options.matchColumn ?? null) : null;
  if (mode === 'upsert' && matchColumn === null) {
    throw new Error('upsert mode requires options.matchColumn');
  }
  const matchResolved = matchColumn === null ? null : view.column(table, matchColumn);

  // --- stream-parse the CSV ---------------------------------------------------
  const parser = createCsvParser();
  const stream = await deps.storage.read(upload.storageKey);
  stream.setEncoding('utf8');

  let header: string[] | null = null;
  let mapped: { index: number; from: string; column: ResolvedColumn }[] | null = null;

  const issues: RowIssue[] = [];
  let total = 0;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let pending: { rowNumber: number; values: Record<string, unknown>; raw: string[] }[] = [];

  const fail = (message: string): never => {
    throw new Error(message);
  };

  async function flushChunk(): Promise<void> {
    if (pending.length === 0) return;
    const chunk = pending;
    pending = [];
    if (ctx.signal.aborted) throw new JobCancelledError(ctx.jobId);

    if (mode === 'upsert') {
      for (const item of chunk) await writeOne(item, true);
    } else {
      try {
        await db.transaction().execute(async (trx) => {
          await trx
            .insertInto(table.id)
            .values(chunk.map((item) => item.values) as never)
            .execute();
        });
        inserted += chunk.length;
      } catch {
        // Isolate the offending row(s): replay the chunk row-by-row.
        for (const item of chunk) await writeOne(item, false);
      }
    }
    ctx.progress(Math.min(95, 5 + Math.floor(((inserted + updated + skipped) / Math.max(1, total)) * 90)), {
      step: 'importing',
      message: `${inserted + updated} rows written`,
    });
  }

  async function writeOne(
    item: { rowNumber: number; values: Record<string, unknown>; raw: string[] },
    upsert: boolean,
  ): Promise<void> {
    try {
      if (upsert && matchResolved !== null) {
        const matchValue = item.values[matchResolved.name];
        if (matchValue === undefined || matchValue === null) {
          // An unmapped/empty match cell must never reach the driver: `= NULL`
          // matches nothing (silent duplicate insert) or throws per driver.
          const message = `the upsert match column ${matchResolved.name} has no value`;
          if (!skipInvalid) fail(`row ${item.rowNumber}: ${message}`);
          skipped += 1;
          issues.push({
            row: item.rowNumber,
            column: matchResolved.name,
            code: 'BAD_MATCH',
            message,
            raw: item.raw.join(','),
          });
          return;
        }
        const existing = await (db as Kysely<SourceDatabase>)
          .selectFrom(table.id)
          .select((eb) => eb.val(1).as('present'))
          .where((eb) => eb(db.dynamic.ref(matchResolved.name), '=', matchValue))
          .limit(1)
          .executeTakeFirst();
        if (existing !== undefined) {
          await db
            .updateTable(table.id)
            .set(item.values as never)
            .where((eb) => eb(db.dynamic.ref(matchResolved.name), '=', matchValue))
            .execute();
          updated += 1;
          return;
        }
      }
      await db
        .insertInto(table.id)
        .values(item.values as never)
        .execute();
      inserted += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!skipInvalid) fail(`row ${item.rowNumber}: ${message}`);
      skipped += 1;
      issues.push({ row: item.rowNumber, column: '', code: 'DB_ERROR', message, raw: item.raw.join(',') });
    }
  }

  async function handleRecord(record: string[]): Promise<void> {
    if (header === null) {
      header = record;
      mapped = resolveMapping(header, row.mapping, view, table);
      return;
    }
    // Fully empty trailing lines are not data rows.
    if (record.length === 1 && record[0]?.trim() === '') return;
    total += 1;
    const rowNumber = total;
    const values: Record<string, unknown> = {};
    let bad = false;
    for (const target of mapped ?? []) {
      const raw = record[target.index] ?? '';
      const result = coerceCell(raw, target.column);
      if (!result.ok) {
        bad = true;
        issues.push({ row: rowNumber, column: target.column.name, code: result.code, message: result.message, raw });
        if (!skipInvalid) fail(`row ${rowNumber}, ${target.column.name}: ${result.message}`);
        continue;
      }
      values[target.column.name] = bindValue(result.value);
    }
    if (bad) {
      skipped += 1;
      return;
    }
    pending.push({ rowNumber, values, raw: record });
    if (pending.length >= IMPORT_CHUNK_SIZE) await flushChunk();
  }

  for await (const chunk of stream) {
    for (const record of parser.write(chunk as string)) await handleRecord(record);
  }
  for (const record of parser.end()) await handleRecord(record);
  await flushChunk();

  // --- error report + terminal state -------------------------------------------
  let errorReportFileId: string | null = null;
  if (issues.length > 0) {
    const reportId = newId('file');
    let report = EXPORT_BOM + serializeCsvRow(['row', 'column', 'code', 'message', 'raw']);
    for (const issue of issues) {
      report += serializeCsvRow([issue.row, issue.column, issue.code, issue.message, issue.raw]);
    }
    const written = await deps.storage.write(reportId, report);
    await files.create({
      id: reportId,
      filename: `import-${row.id}-errors.csv`,
      mime: 'text/csv; charset=utf-8',
      sizeBytes: written.sizeBytes,
      sha256: written.sha256,
      kind: 'import',
      uploadedBy: payload.userId ?? null,
    });
    errorReportFileId = reportId;
  }

  const at = now();
  const stats = { total, inserted, updated, skipped };
  await imports.markFinished(row.id, { status: 'succeeded', stats, errorReportFileId }, at);
  await auditRepo(deps.meta).append(
    {
      actorKind: payload.userId === undefined ? 'system' : 'user',
      actorId: payload.userId ?? null,
      actorLabel: payload.userId ?? 'system',
      category: 'data',
      action: 'record.import',
      connectionId: row.connectionId,
      changes: { after: { importId: row.id, table: table.id, ...stats } },
    },
    at,
  );
  if (deps.hub !== undefined) {
    // Cache-invalidation fan-out — open grids on this table refetch (09 §4.1).
    // Dual publish mirroring routes/data: the legacy `table:` echo PLUS the
    // subscribable widget-data channel — parseChannel (realtime/hub.ts) knows
    // no `table:` prefix, so only the second one ever reaches a client.
    deps.hub.publish(`table:${row.connectionId}:${table.id}`, 'record.bulk-create', { count: inserted });
    deps.hub.publish(widgetDataChannel(row.connectionId, table.id), 'record.bulk-create', {
      count: inserted,
    });
  }
  ctx.progress(100, { step: 'done', message: `${inserted + updated} of ${total} rows imported` });
  ctx.log('import-run: succeeded', { importId: row.id, ...stats });
}
