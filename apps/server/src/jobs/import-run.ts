// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `import-run` job handler: executes one validated adminium_imports request
 * — streaming CSV parse, mapping + type-coercion against the effective
 * schema, chunked insert/upsert through the same snapshot-allowlisted
 * identifiers the POST /data path uses (view.table / view.column — the
 * -item-1 invariant), one audit entry, and a realtime fan-out on
 * `table:<conn>:<table>` so open grids refetch. What each line becomes (a new
 * row, an update, a line left alone or refused) is decided by
 * `data-io/import-judge.ts`, which the preview route asks as well; this file
 * writes what it says.
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
import { tableFrameReach } from '../widget-data/stream-publisher.js';
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
import { tableRulesFor } from '../crud/column-rules.js';
import type { Row } from '../crud/mask.js';
import { rowRefinement } from '../crud/row-limit.js';
import {
  HookFailedError,
  HookRejectedError,
  insertRow,
  insertRows,
  updateRows,
  type CheckedRow,
  type RecordWriteService,
} from '../crud/write-service.js';
import { EXPORT_BOM, createCsvParser, serializeCsvRow } from '../data-io/csv.js';
import { openImportJudge, type ImportLine, type MappedColumn } from '../data-io/import-judge.js';
import { NotFoundError } from '../errors.js';
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

async function runImport(
  row: DataImport,
  payload: ImportRunPayload,
  ctx: JobHandlerContext,
  deps: ImportRunDeps,
  now: () => number,
): Promise<void> {
  const imports = importsRepo(deps.meta);
  const files = filesRepo(deps.meta);

  // The table, the requester as their roles stand now, and each line's verdict: `data-io/import-judge.ts`, which the preview asks too.
  const judge = await openImportJudge(deps, row, payload.userId);
  const { table, db, dialect, writes, writeTarget, context, hooked, mode, reach, updateTest } = judge;
  const matchResolved = judge.match;
  const toldOf = judge.told;

  const upload = await files.findById(row.fileId);
  if (upload === null) throw new Error(`import-run: upload file row missing: ${row.fileId}`);
  const skipInvalid = row.options.skipInvalid ?? true;
  /** The stored row a file's row matches, among the rows the requester's update reaches. */
  const matched = async (column: string, value: unknown): Promise<Row | undefined> => {
    let query = (db as Kysely<SourceDatabase>).selectFrom(table.id).selectAll().where((eb) => eb(db.dynamic.ref(column), '=', value));
    if (updateTest !== null) query = query.where(updateTest(db as Kysely<SourceDatabase>, table.name));
    return (await query.limit(1).executeTakeFirst()) as Row | undefined;
  };
  /** Whether a row that an UPDATE wrote nothing of left the requester's reach meanwhile (an engine also counts nothing for a row that already held the values). */
  const handedOn = async (column: string, value: unknown): Promise<boolean> => updateTest !== null && (await matched(column, value)) === undefined;
  /** …and the same test in the UPDATE itself: a row handed on between the match and the write is not written. */
  // (Left out on MySQL for a table reached through a parent in the same table, which MySQL will not read inside its own UPDATE: there the match stands alone.)
  const within = rowRefinement(reach, db as Kysely<SourceDatabase>, table, 'update') as never;

  // --- stream-parse the CSV ---------------------------------------------------
  const parser = createCsvParser();
  const stream = await deps.storage.read(upload);
  stream.setEncoding('utf8');

  let header: string[] | null = null;
  let mapped: MappedColumn[] | null = null;

  const issues: RowIssue[] = [];
  let total = 0;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  /** Lines of a `skip` import whose row was already here: left alone, counted in `skipped`, and no error. */
  let alreadyHere = 0;
  let pending: ImportLine[] = [];

  const fail = (message: string): never => {
    throw new Error(message);
  };

  async function flushChunk(): Promise<void> {
    if (pending.length === 0) return;
    const chunk = pending;
    pending = [];
    if (ctx.signal.aborted) throw new JobCancelledError(ctx.jobId);

    if (!judge.fast) {
      for (const item of chunk) await writeOne(item);
    } else {
      // THE FAST PATH: no hook wants this write and nothing limits its requester, so the chunk is checked together and goes into one INSERT.
      const verdicts = await judge.lines(chunk, { hooks: true });
      const good: { item: ImportLine; values: CheckedRow }[] = [];
      for (const [i, item] of chunk.entries()) {
        const verdict = verdicts[i]!;
        // Every line of an import that matches nothing is new or refused.
        if (verdict.status === 'new') good.push({ item, values: verdict.values });
        else if (verdict.status === 'refused') refuseRow(item, verdict);
      }
      if (good.length === 0) {
        reportProgress();
        return;
      }
      let written = false;
      try {
        await db.transaction().execute(async (trx) => {
          const tdb = trx as unknown as Kysely<SourceDatabase>;
          // A copy that follows its parent, read again from the parent inside the chunk's transaction.
          for (const entry of good) entry.values = await writes.followed({ ...writeTarget, db: tdb }, tdb, entry.values);
          await insertRows(
            tdb,
            dialect,
            table,
            good.map((entry) => entry.values),
          );
        });
        written = true;
      } catch {
        // Isolate the offending row(s): replay the chunk row-by-row.
        for (const entry of good) await writeOne(entry.item);
      }
      if (written) {
        inserted += good.length;
        // The parent totals these rows feed; no hook step ran to settle them.
        // Outside the try: the chunk is committed, and a settle that fails
        // must not replay it as new rows.
        await writes.settle(
          'create',
          writeTarget,
          good.map((entry) => ({ record: entry.values, before: null })),
        );
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
   * A row the judge refused. Reported with its FIELD and the reason — the
   * import's whole value over a raw INSERT is telling somebody which cell to
   * fix. With `skipInvalid` off it throws, exactly as a driver error does.
   */
  function refuseRow(item: ImportLine, verdict: { code: string; column: string; message: string }): void {
    if (!skipInvalid) fail(`row ${item.rowNumber}: ${verdict.message}`);
    skipped += 1;
    issues.push({ row: item.rowNumber, column: verdict.column, code: verdict.code, message: verdict.message, raw: item.raw.join(',') });
  }

  /** One line judged, then written: on its own, so what stops it stops only it. */
  async function writeOne(item: ImportLine): Promise<void> {
    const [verdict] = await judge.lines([item], { hooks: true });
    if (verdict === undefined) return;
    if (verdict.status === 'refused') {
      refuseRow(item, verdict);
      return;
    }
    try {
      if (verdict.status === 'here') {
        // Left as it is: the row is here, and this import was asked to change none.
        if (verdict.values === null || matchResolved === null) {
          skipped += 1;
          alreadyHere += 1;
          return;
        }
        const existing = verdict.before;
        const matchValue = item.values[matchResolved.name];
        const match = { [matchResolved.name]: matchValue };
        if ((await updateRows(db, dialect, table, verdict.values, match, within)) === 0 && (await handedOn(matchResolved.name, matchValue))) throw new NotFoundError('Record not found.');
        updated += 1;
        if (hooked.update) await afterImportWrite('update', match, existing);
        // The whole row: the parent it fed before, when this update moves it to another.
        else await writes.settle('update', writeTarget, [{ record: { ...existing, ...verdict.values, ...match }, before: existing }]);
        return;
      }
      if (hooked.create) {
        const stored = await insertRow(db, dialect, table, await writes.followed(writeTarget, db as Kysely<SourceDatabase>, verdict.values));
        inserted += 1;
        await writes.afterEach('create', writeTarget, context, [{ record: stored, before: null }]);
        return;
      }
      const current = await writes.followed(writeTarget, db as Kysely<SourceDatabase>, verdict.values);
      await insertRows(db, dialect, table, [current]);
      inserted += 1;
      await writes.settle('create', writeTarget, [{ record: current, before: null }]);
    } catch (error) {
      const message = toldOf(error);
      if (!skipInvalid) fail(`row ${item.rowNumber}: ${message}`);
      skipped += 1;
      const code =
        error instanceof HookRejectedError ? 'REJECTED' : error instanceof HookFailedError ? 'HOOK_FAILED' : 'DB_ERROR';
      issues.push({ row: item.rowNumber, column: '', code, message, raw: item.raw.join(',') });
    }
  }

  /** The totals and after hooks for an upserted row, reading it again only when either needs it. */
  async function afterImportWrite(action: 'update', match: Row, before: Row): Promise<void> {
    const rules = tableRulesFor(writeTarget);
    // Totals it feeds, or rows that follow it (its extras, when a stay's dates change).
    const settles = (rules?.rollupsInto?.length ?? 0) + (rules?.ownRollups?.length ?? 0) + (rules?.follows?.length ?? 0) > 0;
    if (!settles && !(await writes.wants('after', action, writeTarget, context))) return;
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
      mapped = judge.mapping(header);
      return;
    }
    // Fully empty trailing lines are not data rows.
    if (record.length === 1 && record[0]?.trim() === '') return;
    total += 1;
    const rowNumber = total;
    const parsed = judge.parse(mapped ?? [], record, rowNumber);
    if (parsed.line === null) {
      const first = parsed.issues[0]!;
      if (!skipInvalid) {
        issues.push(first);
        fail(`row ${rowNumber}, ${first.column}: ${first.message}`);
      }
      issues.push(...parsed.issues);
      skipped += 1;
      return;
    }
    pending.push(parsed.line);
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
  const stats = { total, inserted, updated, skipped, ...(mode === 'skip' ? { alreadyHere } : {}) };
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
    deps.hub.publish(widgetDataChannel(row.connectionId, table.id), 'record.bulk-create', { count: inserted }, undefined, tableFrameReach(table));
  }
  ctx.progress(100, { step: 'done', message: `${inserted + updated} of ${total} rows imported` });
  ctx.log('import-run: succeeded', { importId: row.id, ...stats });
}
