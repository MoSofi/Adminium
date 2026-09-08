// SPDX-License-Identifier: AGPL-3.0-only
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
  pagesRepo,
  settingsRepo,
  DAY_MS,
  type DataExport,
  type MetaDb,
} from '@adminium/meta';
import { z } from 'zod';

import type { DerivedField } from '@adminium/engine/config';

import type { ConnectionManager } from '../connections/manager.js';
import { LIST_LIMIT_MAX, runList, type ListResult } from '../crud/list.js';
import { loadSnapshotView } from '../data-io/snapshot-view.js';
import { filtersToWhere, resolveExportDefinition, sanitizeFileName } from '../export/definition.js';
import { createRowWriter, type WriterColumn } from '../export/writer.js';
import type { FileStore } from '../files/store.js';
import { parseComputeParam } from '../crud/compute.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import { resolveMeasures, type ResolvedMeasure } from '../crud/measures.js';
import { canReadTableFor } from '../rbac/table-grants.js';
import { JobCancelledError, type JobHandlerContext, type JobRegistry } from './registry.js';

export const EXPORT_RUN_KIND = 'export-run';

export const exportRunPayloadSchema = z.object({
  exportId: z.string().min(1),
  /** Owner convention (routes/jobs): the requesting user. */
  userId: z.string().optional(),
  /** PII capability captured at request time (crud/mask.ts). */
  unmasked: z.boolean().default(false),
  /**
   * The page whose `config.derived` this export computes, when there is one
   * (36-derived-columns.md D28).
   *
   * On the PAYLOAD rather than the stored export row deliberately: the row's
   * `source` carries `table`, `viewId` and `filters` and no page id, and
   * widening a stored shape needs a meta migration for a fact that is already
   * known at enqueue time. A saved-view export resolves through its page and
   * passes it here; a scheduled report passes its own. A bare table export has
   * no page and therefore no derived columns, which is the honest answer
   * rather than a missing feature.
   */
  pageId: z.string().optional(),
});
export type ExportRunPayload = z.infer<typeof exportRunPayloadSchema>;

export interface ExportRunDeps {
  meta: MetaDb;
  manager: ConnectionManager;
  storage: FileStore;
  now?: () => number;
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
  // The ROUTE resolves every accepted kind down to a table before the row is
  // written — a `view` through its page's binding — so the only question left
  // here is which table, not which kind. Keying off the kind is what made this
  // throw on a `view` row the route had already resolved and authorized.
  if (typeof row.source.table !== 'string' || row.source.table.length === 0 || row.connectionId === null) {
    throw new Error(
      `export ${row.id} has no resolved source table (kind ${JSON.stringify(row.source.kind)}).`,
    );
  }

  const view = await loadSnapshotView(deps.meta, row.connectionId);
  const table = view.table(row.source.table);
  const { db, dialect } = await deps.manager.data(row.connectionId);

  const where = filtersToWhere(row.source.filters);

  /*
   * What the file contains, resolved under the REQUESTING USER's grants.
   *
   * D28: a scheduled report's numbers are computed as its creator, not as the
   * system — a measure over a table the creator can no longer read resolves to
   * null and the cell is blank, exactly as it would be on screen. And a
   * payload carrying NO userId refuses every measure, because there is nobody
   * to check against and a file is not a place to discover that. The same
   * predicate now covers a definition's lookups (41 §3.4).
   *
   * A builder DEFINITION (`source.columns`) carries its own headers, lookups,
   * counts, folds and derived block; the pre-definition shape (every
   * selectable column, and the page's derived block through `pageId`) is
   * kept byte for byte for existing rows and scheduled reports.
   */
  const canReadTable = await canReadTableFor(deps.meta, payload.userId, row.connectionId);
  const definition = await resolveExportDefinition({
    view,
    table,
    source: row.source,
    canReadPii: payload.unmasked,
    canReadTable,
  });
  const derived = definition.legacy
    ? await resolveExportDerived(row, payload, view, table, deps)
    : NO_DERIVED;
  const columns: WriterColumn[] = definition.legacy
    ? [
        ...definition.columns.map((column) => ({ key: column.key, header: column.key, numeric: false })),
        ...derived.measures.map((measure) => ({ key: measure.alias, header: measure.alias, numeric: false })),
        ...derived.fields.map((field) => ({ key: field.id, header: field.id, numeric: false })),
      ]
    : definition.columns.map((column) => ({
        key: column.key,
        header: column.header,
        numeric: column.numeric,
      }));
  const projection = definition.legacy
    ? {
        select: undefined,
        requiredColumns: derived.requiredColumns,
        lookups: [],
        measures: derived.measures,
        fields: derived.fields,
      }
    : {
        select: definition.select,
        requiredColumns: definition.requiredColumns,
        lookups: definition.lookups,
        measures: definition.measures,
        fields: definition.fields,
      };
  const rowWriter = createRowWriter(row.format === 'csv' ? 'csv' : 'json', columns, {
    legacy: definition.legacy,
    headerRow: row.source.options?.headerRow,
  });

  const fileId = newId('file');
  const safeTable = table.id.replaceAll(/[^\w.-]+/g, '_');
  const stem = sanitizeFileName(row.source.options?.fileName) ?? `${safeTable}-${row.id}`;
  const filename = `${stem}.${rowWriter.extension}`;
  const writer = await deps.storage.openWriter({
    id: fileId,
    kind: 'export',
    filename,
    mime: rowWriter.mime,
  });

  let rowCount = 0;
  try {
    const preamble = rowWriter.preamble();
    if (preamble !== '') await writer.write(preamble);
    const headerLine = rowWriter.headerLine();
    if (headerLine !== null) await writer.write(headerLine);

    // Keyset paging encodes the PK tiebreaker into the cursor, which `runList`
    // refuses when that column is masked for the caller (a masked natural key
    // could be read back out of the cursor). Offset paging asks for nothing a
    // masked reader may not see, so it is the honest fallback rather than a
    // failed export (41 §3.4).
    const pkMasked = table.primaryKey.some((pk) => table.columns.get(pk)?.masked === true);
    const useCursor = table.primaryKey.length > 0 && (payload.unmasked || !pkMasked);
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
          ...(projection.select === undefined || projection.select.length === 0
            ? {}
            : { select: projection.select.join(',') }),
          limit: LIST_LIMIT_MAX,
          ...(useCursor ? { cursor } : { offset, count: 'none' as const }),
        },
        canReadPii: payload.unmasked,
        dialect,
        lookups: projection.lookups,
        measures: projection.measures,
        derivedFields: projection.fields,
        requiredColumns: projection.requiredColumns,
      });

      for (const record of page.data) await writer.write(rowWriter.line(record));
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
      mime: rowWriter.mime,
      sizeBytes: written.sizeBytes,
      sha256: written.sha256,
      kind: 'export',
      uploadedBy: payload.userId ?? null,
      storageKey: written.storageKey,
      destinationId: written.destinationId,
      storage: written.storage,
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


interface ExportDerived {
  measures: ResolvedMeasure[];
  fields: DerivedField[];
  requiredColumns: readonly string[];
}

const NO_DERIVED: ExportDerived = { measures: [], fields: [], requiredColumns: [] };

/**
 * Resolve the export's page-level derived columns, or nothing.
 *
 * Reuses `parseComputeParam` rather than re-implementing the checks: the block
 * an export computes has to pass exactly what a read of the same page passes —
 * the same caps, the same shared alias namespace, the same 422 on an unknown
 * column. Going through the string form keeps that literally true.
 *
 * Refuses quietly and completely on ANY problem: a job is not a place to
 * surface a page-author mistake, and half a set of derived columns in a
 * downloaded file is worse than none.
 */
async function resolveExportDerived(
  row: DataExport,
  payload: ExportRunPayload,
  view: SnapshotView,
  table: ResolvedTable,
  deps: ExportRunDeps,
): Promise<ExportDerived> {
  if (payload.pageId === undefined || row.connectionId === null) return NO_DERIVED;
  const page = await pagesRepo(deps.meta).findById(payload.pageId);
  /*
   * The stored row is the whole ENVELOPE; the template body — `columns`,
   * `derived` — sits under `config.config`, and `source.table` at the top
   * (41-export-builder.md §0.3). Until 2026-09-07 this read the top level,
   * which no real page ever carried, so a saved-view export or a scheduled
   * report of a page with derived columns wrote none of them — the 36 D28
   * suite passed only because its fixture was seeded at the wrong level. The
   * nested body is read first; the top level stays tolerated for any row
   * written to that shape.
   */
  const envelope = page?.config as { config?: { derived?: unknown }; derived?: unknown } | undefined;
  const block = envelope?.config?.derived ?? envelope?.derived;
  if (block === undefined || block === null) return NO_DERIVED;
  let parsed;
  try {
    parsed = parseComputeParam(JSON.stringify(block), { view, table });
  } catch {
    return NO_DERIVED;
  }
  if (parsed.measures.length === 0 && parsed.fields.length === 0) return NO_DERIVED;
  const canReadTable = await canReadTableFor(deps.meta, payload.userId, row.connectionId);
  const measures = await resolveMeasures({
    view,
    table,
    specs: parsed.measures,
    canReadPii: payload.unmasked,
    canReadTable,
  });
  return { measures, fields: [...parsed.fields], requiredColumns: parsed.requiredColumns };
}
