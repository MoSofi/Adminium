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
}

export async function runList(opts: RunListOptions): Promise<ListResult> {
  const { db, view, table, params, canReadPii, dialect } = opts;
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
  if (params.select !== undefined && params.select.length > 0) {
    selected = params.select.split(',').map((name) => view.readableColumn(table, name.trim(), canReadPii));
  } else {
    selected = view.selectableColumns(table);
  }
  // PK columns ride along for cursors/refs even when not selected.
  const selectNames = new Set(selected.map((column) => column.name));
  for (const pk of table.primaryKey) selectNames.add(pk);

  const filter: RecordFilter | null = params.where === undefined ? null : parseWhereParam(params.where);
  const sortKeys = parseOrder(view, table, params.order, canReadPii);

  const applyFilters = (qb: Qb): Qb => {
    let out = qb;
    if (filter !== null) out = out.where((eb) => compileFilter(eb as never, ctx, filter));
    if (params.q !== undefined && params.q.length > 0) {
      out = out.where((eb) => {
        const search = compileQuickSearch(eb as never, ctx, params.q as string);
        return search ?? eb(eb.val(1), '=', 1);
      });
    }
    return out;
  };

  let qb = applyFilters(
    db.selectFrom(table.id).select([...selectNames].map((name) => dynamic.ref(name))) as unknown as Qb,
  );
  for (const key of sortKeys) qb = qb.orderBy(dynamic.ref(key.column), key.dir);

  const cursorMode = params.cursor !== undefined;
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
    return { data: maskRows(pageRows, table, canReadPii), cursor: { next } };
  }

  const rows = (await qb.limit(limit).offset(offset).execute()) as Row[];
  let total: number | null = null;
  if (params.count !== 'none') {
    // `estimated` consults catalog statistics only for unfiltered lists —
    // table-level statistics cannot see filters or quick search — and only
    // above the shared threshold; every refusal falls through to the exact
    // count this endpoint always ran.
    const unfiltered = filter === null && (params.q === undefined || params.q.length === 0);
    if (params.count === 'estimated' && unfiltered) {
      total = await estimatedTotal(db, table, dialect);
    }
    if (total === null) {
      const countRow = await applyFilters(db.selectFrom(table.id) as unknown as Qb)
        .select((eb) => eb.fn.countAll().as('total'))
        .executeTakeFirst();
      total = Number((countRow as { total?: unknown } | undefined)?.total ?? 0);
    }
  }
  return { data: maskRows(rows, table, canReadPii), page: { limit, offset, total } };
}
