// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `import-run` job handler: executes one validated adminium_imports request
 * — streaming CSV parse, mapping + type-coercion against the effective
 * schema, chunked insert/upsert through the same snapshot-allowlisted
 * identifiers the POST /data path uses (view.table / view.column — the
 * -item-1 invariant), one audit entry, and a realtime fan-out on
 * `table:<conn>:<table>` so open grids refetch.
 *
 * Grants are enforced AT REQUEST TIME: the imports route checks
 * `table:<conn>:<table>:import` before the row is created and again before
 * the run is enqueued. Undo: import runs are jobs, not requests — the 30 s
 * request-scoped undo-token store does not apply; the error report + audit
 * trail are the recovery path (documented deviation).
 *
 * Failure semantics: a row that fails coercion or the database is SKIPPED
 * when `options.skipInvalid` (the default) and fails the import otherwise.
 * Every skipped row lands in the error-report CSV (`error_report_file_id`).
 * The invariant holds either way: total = inserted + updated + skipped.
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
import type { FieldIssues } from '../crud/column-rules.js';
import type { Row } from '../crud/mask.js';
import {
  HookFailedError,
  HookRejectedError,
  bindValue,
  createWriteService,
  insertRow,
  insertRows,
  updateRows,
  type CheckedRow,
  type RecordWriteService,
  type WriteContext,
  type WriteTarget,
} from '../crud/write-service.js';
import { coerceCell } from '../data-io/coerce.js';
import { EXPORT_BOM, createCsvParser, serializeCsvRow } from '../data-io/csv.js';
import { loadSnapshotView } from '../data-io/snapshot-view.js';
import type { FileStore } from '../files/store.js';
import { widgetDataChannel, type RealtimeHub } from '../realtime/hub.js';
import type { WidgetDataCache } from '../widget-data/cache.js';
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
  storage: FileStore;
  /** Optional — table-channel fan-out when the hub is wired (compose). */
  hub?: RealtimeHub | undefined;
  /** The widget-data result cache to drop the table from (compose shares one). */
  widgetCache?: WidgetDataCache | undefined;
  /**
   * Where the rows go. Before hooks judge every row; after hooks run only when
   * a hook asks for imports (an import is one action, not thousands of events).
   */
  writes?: RecordWriteService | undefined;
  now?: (() => number) | undefined;
}

export function registerImportRunHandler(registry: JobRegistry, deps: ImportRunDeps): void {
  const now = deps.now ?? Date.now;
  registry.registerJobHandler(IMPORT_RUN_KIND, importRunPayloadSchema, async (payload, ctx) => {
    await executeImportRun(payload, ctx, deps, now);
    return { importId: payload.importId };
  }, { internal: true });
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
  const writes = deps.writes ?? createWriteService();
  const writeTarget: WriteTarget = { connectionId: row.connectionId, view, table, db, dialect };
  const context: WriteContext = {
    origin: 'import',
    hops: 0,
    actor:
      payload.userId === undefined
        ? { kind: 'system', id: null, label: 'system' }
        : { kind: 'user', id: payload.userId, label: payload.userId },
    request: null,
  };
  // Hooks judge rows one at a time, so a table with any hook for this import
  // is written row by row. Asked once: the hooks in force when the import
  // started decide how the whole file is written.
  const hooked = {
    create:
      (await writes.wants('before', 'create', writeTarget, context)) ||
      (await writes.wants('after', 'create', writeTarget, context)),
    update:
      (await writes.wants('before', 'update', writeTarget, context)) ||
      (await writes.wants('after', 'update', writeTarget, context)),
  };

  const mode = row.options.mode ?? 'insert';
  const skipInvalid = row.options.skipInvalid ?? true;
  const matchColumn = mode === 'upsert' ? (row.options.matchColumn ?? null) : null;
  if (mode === 'upsert' && matchColumn === null) {
    throw new Error('upsert mode requires options.matchColumn');
  }
  const matchResolved = matchColumn === null ? null : view.column(table, matchColumn);

  // --- stream-parse the CSV ---------------------------------------------------
  const parser = createCsvParser();
  const stream = await deps.storage.read(upload);
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

    if (mode === 'upsert' || hooked.create) {
      for (const item of chunk) await writeOne(item, mode === 'upsert');
    } else {
      /*
       * THE FAST PATH, AND WHY IT HAS TO ASK FOR THE RULES ITSELF.
       *
       * No hook wants this write, so `beforeEach` never runs and the chunk
       * goes straight into one INSERT. A rule placed inside the hook step
       * would therefore never fire for a hook-less import — which is most
       * imports. `check()` is the fill and the check without the hooks, and
       * the branded rows it returns are the only thing `insertRows` accepts.
       */
      const checked = writes.check('create', writeTarget, context, chunk.map((item) => item.values));
      const good: { item: (typeof chunk)[number]; values: CheckedRow }[] = [];
      for (const [i, item] of chunk.entries()) {
        const values = checked.rows[i];
        if (values === null || values === undefined) {
          refuseRow(item, checked.issues[i] ?? null);
          continue;
        }
        good.push({ item, values });
      }
      if (good.length === 0) {
        reportProgress();
        return;
      }
      try {
        await db.transaction().execute(async (trx) => {
          await insertRows(
            trx as unknown as Kysely<SourceDatabase>,
            table,
            good.map((entry) => entry.values),
          );
        });
        inserted += good.length;
      } catch {
        // Isolate the offending row(s): replay the chunk row-by-row.
        for (const entry of good) await writeOne(entry.item, false);
      }
    }
    reportProgress();
  }

  function reportProgress(): void {
    ctx.progress(Math.min(95, 5 + Math.floor(((inserted + updated + skipped) / Math.max(1, total)) * 90)), {
      step: 'importing',
      message: `${inserted + updated} rows written`,
    });
  }

  /**
   * A row the column rules refused. Reported with its FIELD and the reason —
   * the import's whole value over a raw INSERT is telling somebody which cell
   * to fix. With `skipInvalid` off it throws, exactly as a driver error does.
   */
  function refuseRow(
    item: { rowNumber: number; values: Record<string, unknown>; raw: string[] },
    fieldIssues: FieldIssues | null,
  ): void {
    const [column, issue] = Object.entries(fieldIssues ?? {})[0] ?? ['', null];
    const code = issue?.code ?? 'invalid';
    const message = column === '' ? `the value was refused (${code})` : `${column}: ${code}`;
    if (!skipInvalid) fail(`row ${item.rowNumber}: ${message}`);
    skipped += 1;
    issues.push({ row: item.rowNumber, column, code: 'REFUSED', message, raw: item.raw.join(',') });
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
        const match = { [matchResolved.name]: matchValue };
        if (hooked.update) {
          const existing = await (db as Kysely<SourceDatabase>)
            .selectFrom(table.id)
            .selectAll()
            .where((eb) => eb(db.dynamic.ref(matchResolved.name), '=', matchValue))
            .limit(1)
            .executeTakeFirst();
          if (existing !== undefined) {
            const before = existing as Row;
            const [prepared] = await writes.beforeEach('update', writeTarget, context, [
              { values: item.values, record: before },
            ]);
            if (prepared === undefined) return;
            if (prepared.issues !== null) {
              refuseRow(item, prepared.issues);
              return;
            }
            await updateRows(db, table, prepared.values, match);
            updated += 1;
            await afterImportWrite('update', match, before);
            return;
          }
        } else {
          const existing = await (db as Kysely<SourceDatabase>)
            .selectFrom(table.id)
            .select((eb) => eb.val(1).as('present'))
            .where((eb) => eb(db.dynamic.ref(matchResolved.name), '=', matchValue))
            .limit(1)
            .executeTakeFirst();
          if (existing !== undefined) {
            const checked = writes.check('update', writeTarget, context, [item.values]);
            const values = checked.rows[0];
            if (values === null || values === undefined) {
              refuseRow(item, checked.issues[0] ?? null);
              return;
            }
            await updateRows(db, table, values, match);
            updated += 1;
            return;
          }
        }
      }
      if (hooked.create) {
        const [prepared] = await writes.beforeEach('create', writeTarget, context, [{ values: item.values }]);
        if (prepared === undefined) return;
        if (prepared.issues !== null) {
          refuseRow(item, prepared.issues);
          return;
        }
        const stored = await insertRow(db, dialect, table, prepared.values);
        inserted += 1;
        await writes.afterEach('create', writeTarget, context, [{ record: stored, before: null }]);
        return;
      }
      const checked = writes.check('create', writeTarget, context, [item.values]);
      const values = checked.rows[0];
      if (values === null || values === undefined) {
        refuseRow(item, checked.issues[0] ?? null);
        return;
      }
      await insertRows(db, table, [values]);
      inserted += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!skipInvalid) fail(`row ${item.rowNumber}: ${message}`);
      skipped += 1;
      const code =
        error instanceof HookRejectedError ? 'REJECTED' : error instanceof HookFailedError ? 'HOOK_FAILED' : 'DB_ERROR';
      issues.push({ row: item.rowNumber, column: '', code, message, raw: item.raw.join(',') });
    }
  }

  /** After hooks for an upserted row, reading it again only when one runs. */
  async function afterImportWrite(action: 'update', match: Row, before: Row): Promise<void> {
    if (!(await writes.wants('after', action, writeTarget, context))) return;
    const record = (await (db as Kysely<SourceDatabase>)
      .selectFrom(table.id)
      .selectAll()
      .where((eb) => eb(db.dynamic.ref(Object.keys(match)[0] as string), '=', Object.values(match)[0]))
      .limit(1)
      .executeTakeFirst()) as Row | undefined;
    if (record !== undefined) await writes.afterEach(action, writeTarget, context, [{ record, before }]);
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
      values[target.column.name] = bindValue(dialect, result.value);
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
    const filename = `import-${row.id}-errors.csv`;
    const written = await deps.storage.write({
      id: reportId,
      kind: 'import',
      filename,
      mime: 'text/csv; charset=utf-8',
      bytes: report,
    });
    await files.create({
      id: reportId,
      filename,
      mime: 'text/csv; charset=utf-8',
      sizeBytes: written.sizeBytes,
      sha256: written.sha256,
      kind: 'import',
      uploadedBy: payload.userId ?? null,
      storageKey: written.storageKey,
      destinationId: written.destinationId,
      storage: written.storage,
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
  // Before the fan-out, so the refetch it triggers is not served stale.
  deps.widgetCache?.invalidateTable(row.connectionId, table.id);
  if (deps.hub !== undefined) {
    // Cache-invalidation fan-out — open grids on this table refetch.
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
