// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Global search (`routes/search/`, 08-server-api.md §2.9, M4-T06 — the ⌘K
 * palette's server half):
 *
 *   GET /api/v1/search?q=&types=&connectionId=&tables=&limit=
 *
 * Two group kinds in v1. The §2.9 meta-entity groups (users, files,
 * automations, views) are a KNOWN, tracked pre-v1 gap: their features have
 * shipped, but the Kysely-over-meta-store search groups (with the
 * system:users:read-style RBAC filters) have not been built yet — adding them
 * means new SEARCH_TYPES entries plus per-group schemas here and in the
 * palette client:
 *
 *  - `page`: enabled nav rows matched by TITLE, filtered by the SAME
 *    `page:<id>:view` grant the bootstrap nav applies (09 §2.1) — search can
 *    never surface a page the sidebar would hide.
 *  - `record`: one group per searchable table the caller holds
 *    `table:<conn>:<table>:read` on. A table is searched only when an enabled,
 *    view-permitted page renders it (its envelope `source.table`) — that page's
 *    slug is what makes a hit navigable (`/p/:slug/r/:recordId`). Matching is
 *    the crud quick-search compiler (`compileQuickSearch` → dialect-aware
 *    ILIKE: postgres `ILIKE`, mysql/sqlite `LOWER(...) LIKE LOWER(...)`), so
 *    identifiers are snapshot strings and values bind as parameters (§7 item 1).
 *
 * PII (§5.3): the search context pins `canReadPii: false` for EVERY caller —
 * masked columns neither match nor surface as labels, even for callers who
 * hold the unmask grant, because labels outlive the request (the palette's
 * localStorage Recent list). Labels come from the classifier's displayColumn
 * (engine `classifyTable`) when it is a clean text column, else the first
 * unmasked text column, else the PK label.
 *
 * Budgets (§2.9): per-table searches run in parallel with a 2 s per-table
 * timeout inside a 5 s total budget; a timed-out (or failing) table degrades
 * to `{ partial: true }` on its group instead of failing the request.
 */

import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { pagesRepo, readBool, type MetaDb, type Page } from '@adminium/meta';
import { classifyTable, type DatabaseModel, type TableModel } from '@adminium/engine';

import { UnauthorizedError } from '../../errors.js';
import type { ConnectionManager } from '../../connections/manager.js';
import { compileQuickSearch, type CompileFilterContext } from '../../crud/filters.js';
import type { ResolvedTable, SnapshotView } from '../../crud/identifiers.js';
import { pkLabel } from '../../crud/records.js';
import type { Row } from '../../crud/mask.js';
import { loadSnapshotView } from '../../data-io/snapshot-view.js';
import {
  SEARCH_LIMIT_DEFAULT,
  searchQuery,
  searchReply,
  type SearchGroup,
  type SearchPageHit,
  type SearchRecordGroup,
  type SearchRecordHit,
} from './schema.js';

export const SEARCH_PER_TABLE_TIMEOUT_MS = 2_000;
export const SEARCH_TOTAL_BUDGET_MS = 5_000;
/** At most this many tables are searched per request (deterministic prefix). */
export const SEARCH_MAX_TABLES = 20;
/** Total record-hit cap across all groups (limit per table × table cap trim). */
export const SEARCH_MAX_TOTAL_HITS = 50;

export interface SearchRoutesDeps {
  manager: ConnectionManager;
  meta: MetaDb;
}

/** One table the record search will run against. */
interface RecordCandidate {
  connectionId: string;
  view: SnapshotView;
  table: ResolvedTable;
  pageSlug: string;
}

const TIMEOUT: unique symbol = Symbol('search-timeout');

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMEOUT> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<typeof TIMEOUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMEOUT), Math.max(0, ms));
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The label column for record hits: classifier displayColumn when it is a
 * readable (text-ish, unmasked, non-secret) column, else the first such
 * column, else null (→ PK label). Masked columns NEVER label a hit (§5.3).
 */
export function labelColumnFor(view: SnapshotView, table: ResolvedTable): string | null {
  const usable = (name: string): boolean => {
    const column = table.columns.get(name);
    return column !== undefined && column.textish && !column.secret && !column.masked;
  };
  const classified = classifyTable(
    view.model as DatabaseModel,
    table.table as unknown as TableModel,
  );
  if (classified.displayColumn !== null && usable(classified.displayColumn)) {
    return classified.displayColumn;
  }
  return [...table.columns.values()].find((c) => usable(c.name))?.name ?? null;
}

/** Number of columns a hit's §2.9 context string draws from. */
export const CONTEXT_COLUMN_CAP = 2;
/** Each context value is clipped so one long text column can't flood the palette row. */
const CONTEXT_VALUE_MAX = 40;

/** Scalar logical types beyond text that read well in a context string. */
const CONTEXT_SCALAR_TYPES = new Set([
  'integer',
  'bigint',
  'decimal',
  'float',
  'boolean',
  'date',
  'time',
  'timestamp',
  'timestamptz',
  'enum',
]);

/**
 * The columns a record hit's `context` string draws from (§2.9 "record hits
 * show row context", e.g. `budget £150,000 · status active`): the first
 * `CONTEXT_COLUMN_CAP` readable text/number columns beyond the label and the
 * PK. Masked/secret columns never appear — the same §5.3 rule that governs
 * matching and labels, because context strings outlive the request in the
 * palette's Recent list too.
 */
export function contextColumnsFor(table: ResolvedTable, labelColumn: string | null): string[] {
  const out: string[] = [];
  for (const column of table.columns.values()) {
    if (out.length >= CONTEXT_COLUMN_CAP) break;
    if (column.name === labelColumn || column.isPrimaryKey) continue;
    if (column.masked || column.secret) continue;
    if (!column.textish && !CONTEXT_SCALAR_TYPES.has(column.logicalType)) continue;
    out.push(column.name);
  }
  return out;
}

/** `col1 v1 · col2 v2` over the non-empty context values of one row. */
export function contextStringFor(row: Row, columns: readonly string[]): string | undefined {
  const parts: string[] = [];
  for (const name of columns) {
    const raw = row[name];
    if (raw === null || raw === undefined) continue;
    const value = String(raw).replace(/\s+/g, ' ').trim();
    if (value.length === 0) continue;
    parts.push(`${name} ${value.length > CONTEXT_VALUE_MAX ? `${value.slice(0, CONTEXT_VALUE_MAX - 1)}…` : value}`);
  }
  return parts.length === 0 ? undefined : parts.join(' · ');
}

export function searchRoutes(deps: SearchRoutesDeps): FastifyPluginAsyncZod {
  const { manager, meta } = deps;
  const pages = pagesRepo(meta);

  return async (app) => {
    /** `page:<id>:view` / `table:...:read`, tolerant of rbac-less harnesses. */
    function can(request: FastifyRequest, permission: string): Promise<boolean> {
      if (typeof request.can !== 'function') return Promise.resolve(true);
      return request.can(permission);
    }

    /** The envelope's `source.table`, when the page renders one table. */
    function sourceTableOf(page: Page): string | null {
      if (typeof page.config !== 'object' || page.config === null) return null;
      const source = (page.config as Record<string, unknown>)['source'];
      if (typeof source !== 'object' || source === null) return null;
      const table = (source as Record<string, unknown>)['table'];
      return typeof table === 'string' && table.length > 0 ? table : null;
    }

    app.get(
      '/search',
      {
        // §6 row 5: 60/min — each request fans out parallel per-table ILIKE
        // queries, so it gets its own bucket (limits live in RATE_BUCKETS).
        config: { rateLimitBucket: 'search' },
        schema: { querystring: searchQuery, response: { 200: searchReply } },
      },
      async (request) => {
        // Session or API-key principal required (401, same rule as bootstrap).
        if ((request.user ?? null) === null && (request.apiKeyPrincipal ?? null) === null) {
          throw new UnauthorizedError('UNAUTHENTICATED');
        }

        const q = request.query.q.trim();
        // Zod enforces ≥ 2 raw chars; re-check after trimming (§2.9).
        if (q.length < 2) return { data: { groups: [] } };
        const qLower = q.toLowerCase();
        const limit = request.query.limit ?? SEARCH_LIMIT_DEFAULT;
        const typeFilter =
          request.query.types === undefined
            ? null
            : new Set(request.query.types.split(',').map((t) => t.trim()));
        const wants = (type: 'page' | 'record'): boolean =>
          typeFilter === null || typeFilter.has(type);
        const tableFilter =
          request.query.tables === undefined
            ? null
            : new Set(request.query.tables.split(',').map((t) => t.trim()));

        const groups: SearchGroup[] = [];
        const startedAt = Date.now();

        // --- pages group (nav rows by title, view-filtered) -------------------
        if (wants('page')) {
          const navRows = [...(await pages.navRows())].sort(
            (a, b) => a.title.localeCompare(b.title) || a.slug.localeCompare(b.slug),
          );
          const hits: SearchPageHit[] = [];
          for (const row of navRows) {
            if (hits.length >= limit) break;
            if (!readBool(row.isEnabled)) continue;
            if (!row.title.toLowerCase().includes(qLower)) continue;
            if (!(await can(request, `page:${row.id}:view`))) continue;
            hits.push({ pageId: row.id, slug: row.slug, title: row.title, icon: row.icon });
          }
          groups.push({ type: 'page', count: hits.length, hits });
        }

        // --- record groups (per readable, page-backed, searchable table) ------
        if (wants('record')) {
          const candidates = await collectCandidates(request);
          const settled = await Promise.all(
            candidates.map(async (candidate): Promise<SearchRecordGroup | null> => {
              const budgetLeft = SEARCH_TOTAL_BUDGET_MS - (Date.now() - startedAt);
              const timeoutMs = Math.min(SEARCH_PER_TABLE_TIMEOUT_MS, budgetLeft);
              try {
                const result = await withTimeout(searchTable(candidate), timeoutMs);
                if (result !== TIMEOUT) return result;
              } catch (error) {
                request.log.warn(
                  { err: error, table: candidate.table.id },
                  'search: per-table query failed — degrading to partial',
                );
              }
              // Timed out / failed: degraded group, not a failed request (§2.9).
              return {
                type: 'record',
                connectionId: candidate.connectionId,
                table: candidate.table.id,
                pageSlug: candidate.pageSlug,
                count: 0,
                partial: true,
                hits: [],
              };
            }),
          );
          let total = 0;
          for (const group of settled) {
            if (group === null) continue;
            if (group.hits.length === 0 && group.partial !== true) continue; // omit empty
            if (total >= SEARCH_MAX_TOTAL_HITS) break; // total cap, deterministic prefix
            groups.push(group);
            total += group.hits.length;
          }
        }

        return { data: { groups } };

        /**
         * Deterministic candidate prefix: connections in create order, then
         * that connection's pages in nav order; the first page rendering a
         * table wins its slug (page-crud pages first, so the record route is
         * the canonical target when both a crud page and e.g. a board exist).
         */
        async function collectCandidates(req: FastifyRequest): Promise<RecordCandidate[]> {
          const connectionRows = await meta.db
            .selectFrom('adminium_connections')
            .select(['id', 'disabledAt'])
            .orderBy('createdAt', 'asc')
            .orderBy('id', 'asc')
            .execute();
          const connectionIds = connectionRows
            /*
             * A PAUSED connection contributes no candidates at all (meta wave
             * 0019) — dropped here rather than left to fail downstream.
             *
             * `manager.data` would refuse it anyway, but §2.9 turns a failed
             * per-table query into a `partial: true` group, so every table of a
             * paused source came back as an empty-but-present result: a row of
             * "no matches" headings for a database nobody is querying, once per
             * search. Not searching it is both the correct answer and the
             * cheaper one — no dial, no timeout, no group.
             */
            .filter((row) => row.disabledAt === null)
            .map((row) => row.id)
            .filter((id) => request.query.connectionId === undefined || id === request.query.connectionId);

          const out: RecordCandidate[] = [];
          for (const connectionId of connectionIds) {
            if (out.length >= SEARCH_MAX_TABLES) break;

            const pageRows = (await pages.listForConnection(connectionId)).filter(
              (page) => page.isEnabled && sourceTableOf(page) !== null,
            );
            // page-crud first — its `/p/:slug/r/:recordId` route is the target.
            pageRows.sort((a, b) => Number(b.type === 'page-crud') - Number(a.type === 'page-crud'));
            const pageByTable = new Map<string, Page>();
            for (const page of pageRows) {
              const tableId = sourceTableOf(page) as string;
              if (!pageByTable.has(tableId)) pageByTable.set(tableId, page);
            }
            if (pageByTable.size === 0) continue;

            let view: SnapshotView;
            try {
              view = await loadSnapshotView(meta, connectionId);
            } catch {
              continue; // no snapshot — nothing searchable on this connection
            }

            for (const [tableId, page] of pageByTable) {
              if (out.length >= SEARCH_MAX_TABLES) break;
              if (tableFilter !== null && !tableFilter.has(tableId)) continue;
              let table: ResolvedTable;
              try {
                table = view.table(tableId);
              } catch {
                continue; // stale page vs. re-introspected snapshot
              }
              // Record hits need a navigable record route → a PK (§2.7.2).
              if (table.primaryKey.length === 0) continue;
              // Searchable = at least one unmasked text column (§2.9 + §5.3).
              const searchable = [...table.columns.values()].some(
                (c) => c.textish && !c.secret && !c.masked,
              );
              if (!searchable) continue;
              // RBAC: the same table-read grant the data routes enforce (§5.2),
              // plus the page-view grant so a hit never navigates into a 403.
              if (!(await can(req, `table:${connectionId}:${table.id}:read`))) continue;
              if (!(await can(req, `page:${page.id}:view`))) continue;
              out.push({ connectionId, view, table, pageSlug: page.slug });
            }
          }
          return out;
        }

        /** One table's hits via the dialect-aware quick-search compiler. */
        async function searchTable(candidate: RecordCandidate): Promise<SearchRecordGroup | null> {
          const { connectionId, view, table, pageSlug } = candidate;
          const { db, dialect } = await manager.data(connectionId);
          // canReadPii pinned false: masked columns never match nor surface.
          const ctx: CompileFilterContext = {
            view,
            table,
            canReadPii: false,
            dynamic: db.dynamic,
            dialect,
          };
          const labelColumn = labelColumnFor(view, table);
          const contextColumns = contextColumnsFor(table, labelColumn);
          const selectNames = new Set<string>(table.primaryKey);
          if (labelColumn !== null) selectNames.add(labelColumn);
          for (const name of contextColumns) selectNames.add(name);

          let qb = db
            .selectFrom(table.id)
            .select([...selectNames].map((name) => db.dynamic.ref(name)));
          qb = qb.where((eb) => {
            const match = compileQuickSearch(eb as never, ctx, q);
            return match ?? eb(eb.val(1), '=', 0);
          });
          for (const pk of table.primaryKey) qb = qb.orderBy(db.dynamic.ref(pk), 'asc');
          const rows = (await qb.limit(limit).execute()) as Row[];
          if (rows.length === 0) return null;

          const hits: SearchRecordHit[] = rows.map((row) => {
            const pk = Object.fromEntries(table.primaryKey.map((name) => [name, row[name]]));
            const raw = labelColumn === null ? null : row[labelColumn];
            const label =
              raw === null || raw === undefined || String(raw).length === 0
                ? pkLabel(table, pk)
                : String(raw);
            const context = contextStringFor(row, contextColumns);
            return {
              connectionId,
              table: table.id,
              recordId: pkLabel(table, pk),
              label,
              ...(context === undefined ? {} : { context }),
              pageSlug,
            };
          });
          return {
            type: 'record',
            connectionId,
            table: table.id,
            pageSlug,
            count: hits.length,
            hits,
          };
        }
      },
    );
  };
}
