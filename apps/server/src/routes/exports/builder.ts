// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The export builder's reads, mounted inside `exportsRoutes` under
 * `/api/v1`:
 *
 * - `GET  /exports/sources?connectionId=` — the connection's tables with the
 *   caller's export grant resolved server-side (`canExport`), row and column
 *   counts, and the pages bound to each (the "Start from" card). A caller
 *   with no export grant anywhere gets `tables: []`, never a 403 — the
 *   no-access state is a state, not an error.
 * - `GET  /exports/views?connectionId=&table=` — the saved views of every
 *   page bound to the table (own + shared), with their filters verbatim, a
 *   `hasSearch` flag (D8) and an exact row count each.
 * - `POST /exports/preview` — the first N rows of a definition, read through
 *   the SAME resolver and the SAME writer the job uses, so the table tab is
 *   the file's cells and the raw tab is the file's first lines.
 *
 * The schema itself is NOT served here: `GET /connections/:id/schema`
 * (routes/schema) needs only a session, so the builder's browser reads the
 * Studio's DTO through the Studio's own call (a correction to plan 41 — the
 * plan cited the connections file, which guards a different set of routes).
 *
 * Grants are the create route's: `table:<conn>:<table>:export` on the base
 * table, the PII capability per request, `read` per reached table through
 * the shared resolver. Every refused projection in a preview is audited as
 * `projection.denied`, exactly as a page read is.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import { pagesRepo, viewsRepo, type MetaDb, type Page } from '@adminium/meta';

import type { ConnectionManager, SourceDatabase } from '../../connections/manager.js';
import { LIST_LIMIT_MAX, runList } from '../../crud/list.js';
import { canReadPii } from '../../crud/mask.js';
import type { ResolvedTable, SnapshotView } from '../../crud/identifiers.js';
import { loadSnapshotView } from '../../data-io/snapshot-view.js';
import { filtersToWhere, resolveExportDefinition } from '../../export/definition.js';
import { cellText, createRowWriter, maskedKeysOf } from '../../export/writer.js';
import { auditExempt } from '../../audit/coverage.js';
import { ForbiddenError, NotFoundError } from '../../errors.js';
import {
  exportsPreviewBody,
  exportsPreviewReply,
  exportsSourcesQuery,
  exportsSourcesReply,
  exportsViewsQuery,
  exportsViewsReply,
} from './schema.js';
import { requireUserId, resolveSource } from './source.js';

export interface BuilderRoutesDeps {
  meta: MetaDb;
  manager: ConnectionManager;
}

/** Lines the "Raw file" tab shows — the comp draws a dozen. */
export const RAW_PREVIEW_LINES = 12;

/** Longest a sources read waits for one `COUNT(*)` when the snapshot has no estimate. */
export const COUNT_BUDGET_MS = 200;

/** The saved grid state a `filters` view stores (routes/views/schema.ts). */
interface ViewQuery {
  search?: unknown;
  filters?: unknown[];
}

/** `source.table` off a stored envelope; the pages repo's tolerant reader, inlined. */
function boundTableOf(page: Page): string | null {
  const source = (page.config as { source?: { table?: unknown } } | null)?.source;
  return typeof source?.table === 'string' && source.table.length > 0 ? source.table : null;
}

/** The page's stored `config.config.columns` — the nested envelope. */
function pageColumnsOf(page: Page): Record<string, unknown>[] | null {
  const body = (page.config as { config?: { columns?: unknown } } | null)?.config;
  const columns = body?.columns;
  if (!Array.isArray(columns)) return null;
  return columns.filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null);
}

/** `COUNT(*)` within a time budget, or null — a missing number is honest, a slow page is not. */
async function countWithin(db: Kysely<SourceDatabase>, table: ResolvedTable, budgetMs: number): Promise<number | null> {
  const query = (db as unknown as Kysely<Record<string, Record<string, unknown>>>)
    .selectFrom(table.id)
    .select((eb) => eb.fn.countAll<number | string | bigint>().as('n'))
    .executeTakeFirst()
    .then((row) => (row === undefined ? null : Number(row.n)))
    .catch(() => null);
  const budget = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), budgetMs).unref?.();
  });
  return Promise.race([query, budget]);
}

export async function registerBuilderRoutes(
  app: FastifyInstance,
  deps: BuilderRoutesDeps,
): Promise<void> {
  const { meta, manager } = deps;
  const api = app.withTypeProvider<ZodTypeProvider>();

  function tableOrNotFound(view: SnapshotView, name: string): ResolvedTable {
    try {
      return view.table(name);
    } catch {
      throw new NotFoundError(`Table ${JSON.stringify(name)} is not in this connection's schema.`, { table: name });
    }
  }

  async function exportGrant(request: FastifyRequest, connectionId: string, table: ResolvedTable): Promise<void> {
    const permission = `table:${connectionId}:${table.id}:export`;
    if (!(await request.can(permission))) {
      throw new ForbiddenError('You do not have export access to this table.', 'TABLE_FORBIDDEN', { permission });
    }
  }

  async function exactCount(
    db: Kysely<SourceDatabase>,
    view: SnapshotView,
    table: ResolvedTable,
    where: string | undefined,
    unmasked: boolean,
    dialect: Parameters<typeof runList>[0]['dialect'],
  ): Promise<number | null> {
    const page = await runList({
      db,
      view,
      table,
      params: { ...(where === undefined ? {} : { where }), limit: 1, offset: 0, count: 'exact' },
      canReadPii: unmasked,
      dialect,
    });
    return page.page?.total ?? null;
  }

  // --- sources ---------------------------------------------------------------

  api.get(
    '/exports/sources',
    { schema: { querystring: exportsSourcesQuery, response: { 200: exportsSourcesReply } } },
    async (request) => {
      requireUserId(request);
      const { connectionId } = request.query;
      const connection = await manager.mustFind(connectionId);
      const view = await loadSnapshotView(meta, connectionId);
      const pages = await pagesRepo(meta).listForConnection(connectionId);
      const pagesByTable = new Map<string, Page[]>();
      for (const page of pages) {
        const bound = boundTableOf(page);
        if (bound === null) continue;
        const list = pagesByTable.get(bound) ?? [];
        list.push(page);
        pagesByTable.set(bound, list);
      }

      const tables = [];
      let handle: { db: Kysely<SourceDatabase> } | null = null;
      for (const modelTable of view.model.tables) {
        if (modelTable.system) continue;
        const table = view.table(modelTable.id);
        const canExport = await request.can(`table:${connectionId}:${table.id}:export`);
        let rowCountEstimate = modelTable.rowCountEstimate ?? null;
        if (rowCountEstimate === null && canExport) {
          handle ??= await manager.data(connection);
          rowCountEstimate = await countWithin(handle.db, table, COUNT_BUDGET_MS);
        }
        const bound = pagesByTable.get(table.id) ?? [];
        tables.push({
          id: table.id,
          schema: table.schema,
          name: table.name,
          label: modelTable.label ?? null,
          rowCountEstimate,
          columnCount: view.selectableColumns(table).length,
          canExport,
          usedBy: bound.length,
          pages: bound.flatMap((page) => {
            const columns = pageColumnsOf(page);
            if (columns === null) return [];
            return [
              {
                id: page.id,
                title: page.title,
                columns: columns.length,
                linked: columns.filter((entry) => entry['lookup'] !== undefined).length,
                totals: columns.filter((entry) => entry['reverse'] !== undefined || entry['derived'] !== undefined)
                  .length,
              },
            ];
          }),
        });
      }
      return {
        data: {
          connection: { id: connection.id, name: connection.name, dialect: connection.engine },
          tables,
        },
      };
    },
  );

  // --- views -----------------------------------------------------------------

  api.get(
    '/exports/views',
    { schema: { querystring: exportsViewsQuery, response: { 200: exportsViewsReply } } },
    async (request) => {
      const userId = requireUserId(request);
      const { connectionId } = request.query;
      const view = await loadSnapshotView(meta, connectionId);
      const table = tableOrNotFound(view, request.query.table);
      await exportGrant(request, connectionId, table);
      const unmasked = await canReadPii(request);
      const { db, dialect } = await manager.data(connectionId);
      const views = viewsRepo(meta);
      const out = [];
      for (const page of await pagesRepo(meta).listForConnection(connectionId)) {
        if (boundTableOf(page) !== table.id) continue;
        for (const saved of await views.listForPageUser(page.id, userId)) {
          const query = (saved.config ?? {}) as ViewQuery;
          const filters = Array.isArray(query.filters) ? query.filters : [];
          out.push({
            id: saved.id,
            pageId: page.id,
            pageTitle: page.title,
            name: saved.name,
            filterCount: filters.length,
            filters,
            hasSearch: typeof query.search === 'string' && query.search.length > 0,
            rowCount: await exactCount(db, view, table, filtersToWhere(filters), unmasked, dialect),
          });
        }
      }
      return { data: { views: out } };
    },
  );

  // --- preview ---------------------------------------------------------------

  api.post(
    '/exports/preview',
    {
      // A READ carried by POST (the definition is a body, not a query): it
      // writes no row and no file; the refused projections it audits are the
      // page-read rule, not a mutation.
      config: { audit: auditExempt('a sample read of an export definition; it writes nothing') },
      schema: { body: exportsPreviewBody, response: { 200: exportsPreviewReply } },
    },
    async (request) => {
      const userId = requireUserId(request);
      const { connectionId, source, format, sampleRows } = request.body;
      const resolved = await resolveSource(meta, source, connectionId, userId);
      await manager.mustFind(connectionId);
      const view = await loadSnapshotView(meta, connectionId);
      const table = view.table(resolved.table);
      await exportGrant(request, connectionId, table);
      const unmasked = await canReadPii(request);
      const definition = await resolveExportDefinition({
        view,
        table,
        source: { ...source, table: table.id, ...(resolved.filters === undefined ? {} : { filters: resolved.filters }) },
        canReadPii: unmasked,
        canReadTable: (tableId) => request.can(`table:${connectionId}:${tableId}:read`),
      });
      for (const refusal of definition.refusals) {
        await app.rbac.audit(request, {
          category: 'rbac',
          action: 'projection.denied',
          connectionId,
          changes: {
            after: { alias: refusal.alias, table: refusal.table, reason: refusal.reason, method: request.method, url: request.url },
          },
        });
      }

      const { db, dialect } = await manager.data(connectionId);
      const where = filtersToWhere(resolved.filters);
      const page = await runList({
        db,
        view,
        table,
        params: {
          ...(where === undefined ? {} : { where }),
          ...(definition.select === undefined || definition.select.length === 0
            ? {}
            : { select: definition.select.join(',') }),
          limit: Math.min(sampleRows, LIST_LIMIT_MAX),
          offset: 0,
          count: where === undefined ? 'none' : 'exact',
        },
        canReadPii: unmasked,
        dialect,
        lookups: definition.lookups,
        measures: definition.measures,
        derivedFields: definition.fields,
        requiredColumns: definition.requiredColumns,
      });

      const columns = definition.columns.map((column) => ({
        key: column.key,
        header: column.header,
        numeric: column.numeric,
      }));
      const writer = createRowWriter(format === 'json' ? 'json' : 'csv', columns, {
        headerRow: source.options?.headerRow,
      });
      const rows = page.data.map((record) => {
        const masked = maskedKeysOf(record);
        return columns.map((column) => cellText(record[column.key], masked.has(column.key)));
      });
      const raw: string[] = [];
      const headerLine = writer.headerLine();
      if (headerLine !== null) raw.push(headerLine);
      for (const record of page.data) {
        if (raw.length >= RAW_PREVIEW_LINES) break;
        raw.push(writer.line(record));
      }

      // Row count: exact under a view's filters (the read paid for it), the
      // snapshot's estimate for the whole table, a bounded COUNT when there is
      // none — the comp's number wherever it can be known, never invented.
      let rowCount: number | null;
      let rowCountKind: 'exact' | 'estimate' | 'unknown';
      if (where !== undefined) {
        rowCount = page.page?.total ?? null;
        rowCountKind = rowCount === null ? 'unknown' : 'exact';
      } else {
        const modelTable = view.model.tables.find((entry) => entry.id === table.id);
        rowCount = modelTable?.rowCountEstimate ?? null;
        rowCountKind = 'estimate';
        if (rowCount === null) {
          rowCount = await countWithin(db, table, COUNT_BUDGET_MS);
          rowCountKind = rowCount === null ? 'unknown' : 'exact';
        }
      }
      // The comp's formula (1051-1052): mean bytes per sample row × rows, plus
      // the header line — computed where the bytes are real.
      const sampleBytes = page.data.reduce((sum, record) => sum + Buffer.byteLength(writer.line(record), 'utf8'), 0);
      const perRow = page.data.length === 0 ? 0 : sampleBytes / page.data.length;
      const headerBytes = headerLine === null ? 0 : Buffer.byteLength(headerLine, 'utf8');
      const estimatedBytes =
        rowCount === null ? null : Math.round(perRow * rowCount + headerBytes + Buffer.byteLength(writer.preamble(), 'utf8'));

      return {
        data: {
          columns: definition.columns.map((column) => ({
            key: column.key,
            header: column.header,
            kind: column.kind,
            numeric: column.numeric,
            masked: column.masked,
          })),
          rows,
          raw: raw.map((line) => line.replace(/\r?\n$/, '')),
          rowCount,
          rowCountKind,
          estimatedBytes,
          sampleRows: rows.length,
        },
      };
    },
  );
}
