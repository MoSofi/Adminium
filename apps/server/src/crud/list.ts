// SPDX-License-Identifier: AGPL-3.0-only
/**
 * List pipeline for `GET /data/:connectionId/:table` (08-server-api.md
 * §2.7.1): select allowlisting, filter DSL, `q=` quick search, ≤ 3 sort
 * keys with a PK tiebreaker, offset pagination with exact counts, and
 * opaque keyset cursors (mutually exclusive with `offset`).
 */

import { sql, type Kysely, type SelectQueryBuilder } from 'kysely';

import { STATS_EXACT_COUNT_THRESHOLD, type Dialect } from '@adminium/engine';

import { ValidationFailedError } from '../errors.js';
import type { SourceDatabase } from '../connections/manager.js';
import {
  compileFilter,
  compileQuickSearch,
  parseWhereParam,
  type CompileFilterContext,
  type RecordFilter,
} from './filters.js';
import type { ResolvedColumn, ResolvedTable, SnapshotView } from './identifiers.js';
import { applyAggregateMask, aggregateSelections, type ResolvedAggregate } from './aggregates.js';
import { applyLookupMask, lookupSelections, type ResolvedLookup } from './lookups.js';
import { maskRows, type Row } from './mask.js';

export const LIST_LIMIT_MAX = 200;
export const LIST_LIMIT_DEFAULT = 50;
export const MAX_SORT_KEYS = 3;

export interface SortKey {
  column: string;
  dir: 'asc' | 'desc';
}

export interface ListParams {
  select?: string | undefined;
  where?: string | undefined;
  q?: string | undefined;
  order?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
  cursor?: string | undefined;
  count?: 'exact' | 'estimated' | 'none' | undefined;
}

export interface ListResult {
  data: Row[];
  page?: { limit: number; offset: number; total: number | null };
  cursor?: { next: string | null };
}

/** `col.desc,col2.asc` → validated sort keys; a PK tiebreaker is always appended. */
export function parseOrder(
  view: SnapshotView,
  table: ResolvedTable,
  raw: string | undefined,
  canReadPii: boolean,
): SortKey[] {
  const keys: SortKey[] = [];
  if (raw !== undefined && raw.length > 0) {
    for (const part of raw.split(',')) {
      const [name, dir = 'asc'] = part.split('.', 2);
      if (name === undefined || name.length === 0 || (dir !== 'asc' && dir !== 'desc')) {
        throw new ValidationFailedError('`order` must be `col.asc` / `col.desc` pairs.', { part });
      }
      // Masked columns are rejected in `order` (§5.3 rule 2).
      const column = view.readableColumn(table, name, canReadPii);
      keys.push({ column: column.name, dir });
    }
    if (keys.length > MAX_SORT_KEYS) {
      throw new ValidationFailedError('At most 3 sort keys.', { max: MAX_SORT_KEYS });
    }
  }
  for (const pk of table.primaryKey) {
    if (!keys.some((key) => key.column === pk)) keys.push({ column: pk, dir: 'asc' });
  }
  return keys;
}

function encodeCursor(values: unknown[]): string {
  return Buffer.from(JSON.stringify({ k: values }), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string, expectedKeys: number): unknown[] {
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new ValidationFailedError('Malformed cursor.', {});
  }
  const values = (payload as { k?: unknown }).k;
  if (!Array.isArray(values) || values.length !== expectedKeys) {
    throw new ValidationFailedError('Cursor does not match the current sort.', {});
  }
  return values;
}

type Qb = SelectQueryBuilder<SourceDatabase, string, Record<string, unknown>>;

/**
 * Statistics-backed row-count estimate for `count=estimated`, mirroring the
 * adapters' collectTableStats policy (05 §10): the catalog figure is used only
 * when it clears STATS_EXACT_COUNT_THRESHOLD — below that, exact COUNT(*) is
 * cheap and estimates are embarrassingly wrong; null / negative (never
 * analyzed) also refuses. SQLite keeps no catalog statistics without ANALYZE,
 * so it always refuses. Table identifiers travel as bind parameters, never
 * spliced into SQL. Returns null when the caller should run the exact count;
 * a failed probe degrades the same way rather than failing the list.
 */
export async function estimatedTotal(
  db: Kysely<SourceDatabase>,
  table: Pick<ResolvedTable, 'schema' | 'name'>,
  dialect: Dialect,
  threshold: number = STATS_EXACT_COUNT_THRESHOLD,
): Promise<number | null> {
  try {
    let raw: unknown;
    if (dialect === 'postgres') {
      const result = await sql<{ estimate: unknown }>`
        SELECT c.reltuples::float8 AS estimate
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = ${table.schema} AND c.relname = ${table.name}
        LIMIT 1`.execute(db);
      raw = result.rows[0]?.estimate;
    } else if (dialect === 'mysql') {
      // For MySQL the introspected "schema" is the database name; an empty one
      // (single-database DSNs) resolves to the connection's current database.
      const result = await sql<{ estimate: unknown }>`
        SELECT TABLE_ROWS AS estimate
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = COALESCE(NULLIF(${table.schema}, ''), DATABASE())
          AND TABLE_NAME = ${table.name}
        LIMIT 1`.execute(db);
      raw = result.rows[0]?.estimate;
    } else {
      return null;
    }
    if (raw === null || raw === undefined) return null;
    const estimate = Number(raw);
    if (!Number.isFinite(estimate) || estimate < threshold) return null;
    return Math.round(estimate);
  } catch {
    return null;
  }
}

export interface RunListOptions {
  db: Kysely<SourceDatabase>;
  view: SnapshotView;
  table: ResolvedTable;
  params: ListParams;
  canReadPii: boolean;
  dialect: Dialect;
  /**
   * A predicate the CALLER CANNOT SEE OR REMOVE (28-public-surface.md §3.2).
   *
   * ANDed first and unconditionally, before the caller's own `where` and before
   * quick search, so no combination of query parameters can widen the row set
   * past it. The dashboard passes `undefined` and nothing about its behaviour
   * changes; the public layer compiles it from the scope document.
   */
  mandatory?: RecordFilter | undefined;
  /**
   * The COMPLETE column set to return, replacing both `params.select` and the
   * default (28 D5 a / a′).
   *
   * Two things this does that a `select` string cannot. It is not a validator
   * the caller can sidestep by OMITTING `select` — which defaults to every
   * non-secret column. And it suppresses the primary-key ride-along below, so a
   * resource that does not list its PK does not return it; passing `select`
   * upstream returns `{name, id}` for `select=name`, which for the sequential
   * integer PKs these schemas use is an enumeration aid.
   */
  exposeColumns?: readonly string[] | undefined;
  /** Columns `q=` may search; see `compileQuickSearch` (28 D5 b). */
  searchColumns?: readonly string[] | undefined;
  /**
   * Resolved cross-table lookups (`crud/lookups.ts`) — each compiles to a
   * correlated scalar subquery aliased into the SELECT list, so filters,
   * search, sort, cursors and the count query keep their single-table
   * semantics. Resolution (and its per-table RBAC) happens in the route, not
   * here — the public path never passes any.
   */
  lookups?: readonly ResolvedLookup[] | undefined;
  /**
   * Resolved reverse-link aggregates (`crud/aggregates.ts`) — correlated
   * scalar COUNT subqueries, same single-table-semantics guarantee as
   * `lookups`. Resolution (and its per-table RBAC) happens in the route, not
   * here — the public path never passes any.
   */
  aggregates?: readonly ResolvedAggregate[] | undefined;
}

export async function runList(opts: RunListOptions): Promise<ListResult> {
  const { db, view, table, params, canReadPii, dialect, mandatory, exposeColumns, searchColumns } = opts;
  const lookups = opts.lookups ?? [];
  const aggregates = opts.aggregates ?? [];
  const dynamic = db.dynamic;
  const ctx: CompileFilterContext = { view, table, canReadPii, dynamic, dialect };

  const limit = Math.min(Math.max(params.limit ?? LIST_LIMIT_DEFAULT, 1), LIST_LIMIT_MAX);
  const offset = Math.max(params.offset ?? 0, 0);
  if (params.cursor !== undefined && params.offset !== undefined) {
    throw new ValidationFailedError('`cursor` and `offset` are mutually exclusive.', {});
  }

  // SELECT list: default = every non-secret column — masked ones serialize
  // as null + `_masked` marker (§5.3 rule 1); explicitly selecting a masked
  // column without the grant → 403 COLUMN_FORBIDDEN (§2.7.1).
  let selected: ResolvedColumn[];
  if (exposeColumns !== undefined) {
    // Fixed by the caller's policy, not by the request. `params.select` is
    // ignored rather than merged: merging would let a request widen the set.
    selected = exposeColumns.map((name) => view.readableColumn(table, name, canReadPii));
  } else if (params.select !== undefined && params.select.length > 0) {
    selected = params.select.split(',').map((name) => view.readableColumn(table, name.trim(), canReadPii));
  } else {
    selected = view.selectableColumns(table);
  }
  const selectNames = new Set(selected.map((column) => column.name));
  // PK columns ride along for cursors/refs even when not selected — EXCEPT
  // under `exposeColumns`, where the whole point is that the set is complete
  // (D5 a′). Keyset pagination is refused below when the PK is absent, which is
  // the price of that and is paid deliberately.
  if (exposeColumns === undefined) {
    for (const pk of table.primaryKey) selectNames.add(pk);
  }

  const filter: RecordFilter | null = params.where === undefined ? null : parseWhereParam(params.where);
  const sortKeys = parseOrder(view, table, params.order, canReadPii);

  const applyFilters = (qb: Qb): Qb => {
    let out = qb;
    // FIRST, and outside every conditional below. Every later clause narrows.
    if (mandatory !== undefined) out = out.where((eb) => compileFilter(eb as never, ctx, mandatory));
    if (filter !== null) out = out.where((eb) => compileFilter(eb as never, ctx, filter));
    if (params.q !== undefined && params.q.length > 0) {
      out = out.where((eb) => {
        const search = compileQuickSearch(eb as never, ctx, params.q as string, searchColumns);
        // No searchable column ⇒ match NOTHING. The dashboard's `1=1` fallback
        // is right when the table simply has no text columns; here an empty
        // allow-list means "q is not permitted", and widening to every row
        // would turn a refusal into a full listing.
        if (search === null) {
          return searchColumns === undefined ? eb(eb.val(1), '=', 1) : eb(eb.val(1), '=', 0);
        }
        return search;
      });
    }
    return out;
  };

  let qb = applyFilters(
    db.selectFrom(table.id).select([...selectNames].map((name) => dynamic.ref(name))) as unknown as Qb,
  );
  if (lookups.length > 0) {
    // Refused lookups compile to nothing — applyLookupMask() nulls + marks
    // them after the fetch, so refused data never leaves the database.
    qb = qb.select((eb) => lookupSelections(eb as never, db, table, lookups)) as Qb;
  }
  if (aggregates.length > 0) {
    // Same contract: refused aggregates never reach SQL.
    qb = qb.select((eb) => aggregateSelections(eb as never, db, table, aggregates)) as Qb;
  }
  for (const key of sortKeys) qb = qb.orderBy(dynamic.ref(key.column), key.dir);

  const cursorMode = params.cursor !== undefined;
  // Keyset cursors carry the sort tuple — including the primary-key tiebreaker
  // parseOrder() always appends — encoded in the cursor and read from the RAW,
  // pre-mask row. A PK can itself be a masked PII column (a natural key like an
  // email), and the PK tiebreaker bypasses readableColumn()'s masked-column
  // 403 that the explicit order/select/filter paths enforce. So a caller who
  // cannot read PII could recover a masked column's plaintext by decoding the
  // cursor. Refuse keyset mode whenever any sort-key column is masked for this
  // caller; offset pagination (which emits no cursor) remains available.
  if (cursorMode && !canReadPii) {
    const masked = sortKeys.find((key) => table.columns.get(key.column)?.masked === true);
    if (masked !== undefined) {
      throw new ValidationFailedError(
        'Keyset pagination is unavailable because a sort or key column is masked for your role; use offset pagination.',
        { column: masked.column },
      );
    }
  }
  /*
   * Keyset pagination encodes the sort tuple — including the PK tiebreaker
   * `parseOrder` always appends — into the cursor and hands it to the caller.
   * Under `exposeColumns` a PK that was deliberately not exposed would be
   * readable straight out of that cursor, which is the same leak the masked-PK
   * refusal above closes, arrived at from the other direction. Offset paging
   * stays available and emits no cursor.
   */
  if (cursorMode && exposeColumns !== undefined) {
    const hidden = sortKeys.find((key) => !selectNames.has(key.column));
    if (hidden !== undefined) {
      throw new ValidationFailedError(
        'Keyset pagination is unavailable because a sort or key column is not exposed by this scope; use offset pagination.',
        { column: hidden.column },
      );
    }
  }
  if (cursorMode && (params.cursor as string).length > 0) {
    if (table.primaryKey.length === 0) {
      throw new ValidationFailedError('Keyset pagination needs a primary key; use offset.', {
        table: table.id,
      });
    }
    const values = decodeCursor(params.cursor as string, sortKeys.length);
    // Lexicographic keyset predicate over the mixed-direction sort tuple.
    qb = qb.where((eb) =>
      eb.or(
        sortKeys.map((key, i) =>
          eb.and([
            ...sortKeys.slice(0, i).map((prev, j) => eb(dynamic.ref(prev.column), '=', values[j])),
            eb(dynamic.ref(key.column), key.dir === 'asc' ? '>' : '<', values[i]),
          ]),
        ),
      ),
    );
  }

  if (cursorMode) {
    const rows = (await qb.limit(limit + 1).execute()) as Row[];
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const last = pageRows.at(-1);
    const next =
      hasMore && last !== undefined ? encodeCursor(sortKeys.map((key) => last[key.column])) : null;
    return {
      data: applyAggregateMask(applyLookupMask(maskRows(pageRows, table, canReadPii), lookups), aggregates),
      cursor: { next },
    };
  }

  const rows = (await qb.limit(limit).offset(offset).execute()) as Row[];
  let total: number | null = null;
  if (params.count !== 'none') {
    // `estimated` consults catalog statistics only for unfiltered lists —
    // table-level statistics cannot see filters or quick search — and only
    // above the shared threshold; every refusal falls through to the exact
    // count this endpoint always ran.
    const unfiltered =
      mandatory === undefined && filter === null && (params.q === undefined || params.q.length === 0);
    if (params.count === 'estimated' && unfiltered) {
      total = await estimatedTotal(db, table, dialect);
    }
    /*
     * The fall-through to an exact COUNT(*) is right for the dashboard — the
     * endpoint has always produced a real total — but it is a free
     * amplification primitive on an anonymous surface, and `estimated` is
     * exactly the setting that looks cheap while reaching it. A mandatory
     * predicate makes every public list filtered by construction, so this
     * branch would fire on EVERY public request. `count` never leaves `none`
     * on the public path (D5 d); this guard states the same rule where the
     * cost actually is, so a future caller that does pass one cannot buy the
     * COUNT by asking for an estimate.
     */
    if (total === null && mandatory !== undefined) {
      total = null;
    } else if (total === null) {
      const countRow = await applyFilters(db.selectFrom(table.id) as unknown as Qb)
        .select((eb) => eb.fn.countAll().as('total'))
        .executeTakeFirst();
      total = Number((countRow as { total?: unknown } | undefined)?.total ?? 0);
    }
  }
  return {
    data: applyAggregateMask(applyLookupMask(maskRows(rows, table, canReadPii), lookups), aggregates),
    page: { limit, offset, total },
  };
}
