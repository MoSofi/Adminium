/**
 * `export-run` job handler (M7-T07, 09-generated-app.md §11.2): drains one
 * adminium_exports request through the crud list pipeline and lands the
 * artifact in file storage.
 *
 * Grants are captured AT REQUEST TIME: the exports route verifies
 * `table:<conn>:<table>:export` and resolves the caller's PII capability
 * (crud/mask.ts) before enqueueing; the payload carries `unmasked` and the
 * job replays it through `runList`, so masked columns serialize as empty/null
 * exactly as the caller would see them in the grid. Secret columns never
 * appear (mask.ts rule 1).
 *
 * Streaming: pages come out of `runList` keyset-style (offset loop for
 * PK-less tables) and go straight into an incremental `FileWriter` — the
 * whole table is never in memory. CSV per data-io/csv.ts (RFC 4180 + BOM);
 * `json` is JSON-lines (one object per line). `xlsx` is rejected at the
 * route; a row that reaches here anyway fails cleanly.
 */
import {
  auditRepo,
  exportsRepo,
  filesRepo,
  newId,
  settingsRepo,
  DAY_MS,
  type DataExport,
  type MetaDb,
} from '@adminium/meta';
import { z } from 'zod';

import type { ConnectionManager } from '../connections/manager.js';
import { LIST_LIMIT_MAX, runList, type ListResult } from '../crud/list.js';
import { EXPORT_BOM, serializeCsvRow } from '../data-io/csv.js';
import { loadSnapshotView } from '../data-io/snapshot-view.js';
import type { FileStorage } from '../files/storage.js';
import { JobCancelledError, type JobHandlerContext, type JobRegistry } from './registry.js';

export const EXPORT_RUN_KIND = 'export-run';

export const exportRunPayloadSchema = z.object({
  exportId: z.string().min(1),
  /** Owner convention (routes/jobs): the requesting user. */
  userId: z.string().optional(),
  /** PII capability captured at request time (crud/mask.ts). */
  unmasked: z.boolean().default(false),
});
export type ExportRunPayload = z.infer<typeof exportRunPayloadSchema>;

export interface ExportRunDeps {
  meta: MetaDb;
  manager: ConnectionManager;
  storage: FileStorage;
  now?: () => number;
}

function filtersToWhere(filters: unknown[] | undefined): string | undefined {
  if (filters === undefined || filters.length === 0) return undefined;
  return JSON.stringify(filters.length === 1 ? filters[0] : { and: filters });
}

export function registerExportRunHandler(registry: JobRegistry, deps: ExportRunDeps): void {
  const now = deps.now ?? Date.now;
  registry.registerJobHandler(EXPORT_RUN_KIND, exportRunPayloadSchema, async (payload, ctx) => {
    await executeExportRun(payload, ctx, deps, now);
    return { exportId: payload.exportId };
    // internal: the `unmasked` PII decision is captured from the caller's
    // authority on POST /exports, never from a POST /jobs payload.
  }, { internal: true });
}

async function executeExportRun(
  payload: ExportRunPayload,
  ctx: JobHandlerContext,
  deps: ExportRunDeps,
  now: () => number,
): Promise<void> {
  const exports = exportsRepo(deps.meta);
  const row = await exports.findById(payload.exportId);
  if (row === null) throw new Error(`export-run: export not found: ${payload.exportId}`);
  if (row.status !== 'processing') {
    ctx.log('export-run: export not in processing state, skipping', { status: row.status });
    return;
  }

  try {
    await runExport(row, payload, ctx, deps, now);
  } catch (error) {
    if (error instanceof JobCancelledError || ctx.signal.aborted) {
      await exports.markCancelled(row.id, now());
      ctx.log('export-run: cancelled', { exportId: row.id });
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    await exports.markFailed(row.id, message, now());
    ctx.log('export-run: failed', { exportId: row.id });
    // Deterministic failure — mark the row and let the job succeed so the
    // queue does not retry a request the user can simply re-issue.
    return;
  }
}

async function runExport(
  row: DataExport,
  payload: ExportRunPayload,
  ctx: JobHandlerContext,
  deps: ExportRunDeps,
  now: () => number,
): Promise<void> {
  const exports = exportsRepo(deps.meta);
  const files = filesRepo(deps.meta);

  if (row.format === 'xlsx') {
    throw new Error('xlsx exports are not available in this build — use csv or json.');
  }
  if (row.source.kind !== 'table' || typeof row.source.table !== 'string' || row.connectionId === null) {
    throw new Error(`export source kind ${JSON.stringify(row.source.kind)} is not supported yet.`);
  }

  const view = await loadSnapshotView(deps.meta, row.connectionId);
  const table = view.table(row.source.table);
  const { db, dialect } = await deps.manager.data(row.connectionId);

  const columns = view.selectableColumns(table).map((column) => column.name);
  const where = filtersToWhere(row.source.filters);

  const fileId = newId('file');
  const safeTable = table.id.replaceAll(/[^\w.-]+/g, '_');
  const filename = `${safeTable}-${row.id}.${row.format === 'csv' ? 'csv' : 'jsonl'}`;
  const writer = await deps.storage.openWriter(fileId);

  let rowCount = 0;
  try {
    if (row.format === 'csv') {
      await writer.write(EXPORT_BOM + serializeCsvRow(columns));
    }

    const useCursor = table.primaryKey.length > 0;
    let cursor = '';
    let offset = 0;
    // Keyset loop over the crud list path (offset fallback for PK-less tables).
    for (;;) {
      if (ctx.signal.aborted) throw new JobCancelledError(ctx.jobId);
      const page: ListResult = await runList({
        db,
        view,
        table,
        params: {
          ...(where === undefined ? {} : { where }),
          limit: LIST_LIMIT_MAX,
          ...(useCursor ? { cursor } : { offset, count: 'none' as const }),
        },
        canReadPii: payload.unmasked,
        dialect,
      });

      for (const record of page.data) {
        delete record['_masked']; // marker, not data — columns stay positional
        if (row.format === 'csv') {
          await writer.write(serializeCsvRow(columns.map((name) => record[name])));
        } else {
          const slim: Record<string, unknown> = {};
          for (const name of columns) slim[name] = record[name] ?? null;
          await writer.write(`${JSON.stringify(slim)}\n`);
        }
      }
      rowCount += page.data.length;
      ctx.progress(Math.min(95, 5 + Math.floor(rowCount / 100)), {
        step: 'exporting',
        message: `${rowCount} rows exported`,
      });

      if (useCursor) {
        const next = page.cursor?.next ?? null;
        if (next === null) break;
        cursor = next;
      } else {
        if (page.data.length < LIST_LIMIT_MAX) break;
        offset += LIST_LIMIT_MAX;
      }
    }
  } catch (error) {
    await writer.abort();
    throw error;
  }

  const written = await writer.close();
  const at = now();
  await files.create(
    {
      id: fileId,
      filename,
      mime: row.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/x-ndjson',
      sizeBytes: written.sizeBytes,
      sha256: written.sha256,
      kind: 'export',
      uploadedBy: payload.userId ?? null,
    },
    at,
  );

  const retentionDays = await settingsRepo(deps.meta).get('retention.exportsDays');
  await exports.markReady(
    row.id,
    { fileId, rowCount, expiresAt: at + retentionDays * DAY_MS },
    at,
  );
  await auditRepo(deps.meta).append(
    {
      actorKind: payload.userId === undefined ? 'system' : 'user',
      actorId: payload.userId ?? null,
      actorLabel: payload.userId ?? 'system',
      category: 'export',
      action: 'export.complete',
      connectionId: row.connectionId,
      changes: { after: { exportId: row.id, table: table.id, format: row.format, rowCount } },
    },
    at,
  );
  ctx.progress(100, { step: 'done', message: `${rowCount} rows exported` });
  ctx.log('export-run: ready', { exportId: row.id, rowCount });
}
