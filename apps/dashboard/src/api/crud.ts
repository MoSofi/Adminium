// SPDX-License-Identifier: AGPL-3.0-only
/**
 * CrudApi implementation — the typed client for
 * `/api/v1/data/:connectionId/:table` (exact shapes from
 * apps/server/src/routes/data/schema.ts) implementing the `CrudApi` adapter
 * contract the `page-crud` template defines
 * (packages/widgets/src/templates/page-crud/crud-api.ts): list (filter tree +
 * `q` + keyset/offset), get (+ inbound counts), references preflight,
 * create/update/delete (+ cascade dry-run preview), bulk, single-use undo
 * tokens, FK combobox lookup via the referenced table's list endpoint with
 * `q=`, and related-record tabs via a `where column = value` list.
 *
 * TanStack Query binding lives here too (`crudListQuery`, cache discipline) —
 * the template itself stays fetch- and query-free.
 */
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import type {
  CrudApi,
  CrudBulkResult,
  CrudDeletePreview,
  CrudGetResult,
  CrudListParams,
  CrudListResult,
  CrudLookupOption,
  CrudMutationResult,
  CrudReferenceCount,
  CrudRow,
} from '@adminium/widgets';

import { ApiError, api } from '../app/api.js';

export type {
  CrudApi,
  CrudBulkResult,
  CrudDeletePreview,
  CrudGetResult,
  CrudListParams,
  CrudListResult,
  CrudLookupOption,
  CrudMutationResult,
  CrudReferenceCount,
  CrudRow,
} from '@adminium/widgets';

/**
 * WHAT A REFUSED WRITE LOOKS LIKE TO THE FORM.
 *
 * A 422 whose envelope carries `details.fields` names the columns the server
 * refused and why (`{ status: { code: 'not-allowed' } }`). The error is
 * rethrown with those issues attached, because that is the shape the template
 * has always looked for and nothing ever produced — until now every failed
 * save was a toast with the server's generic English and no marked field.
 *
 * The CODE travels, never a sentence: the wording is chosen in the template,
 * in the reader's language (`field-issues.ts`).
 */
export interface FieldIssues {
  [column: string]: { code: string; n?: number };
}

/**
 * An ApiError carrying the columns a write was refused for.
 *
 * It keeps `ApiError`'s own `name`, deliberately: everything that already
 * routes on `error.name` — the offline mapper, the toast fallbacks — must keep
 * treating this as the 422 it is. `instanceof` and `fieldIssues` are how a
 * caller tells the difference.
 */
export class FieldRefusedError extends ApiError {
  readonly fieldIssues: FieldIssues;

  constructor(source: ApiError, fieldIssues: FieldIssues) {
    super(source.status, source.code, source.message, source.requestId, source.details);
    this.fieldIssues = fieldIssues;
  }
}

function fieldIssuesIn(error: unknown): FieldIssues | null {
  if (!(error instanceof ApiError) || error.code !== 'VALIDATION_FAILED') return null;
  const details = error.details;
  if (typeof details !== 'object' || details === null) return null;
  const fields = (details as { fields?: unknown }).fields;
  if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) return null;
  const out: FieldIssues = {};
  for (const [column, issue] of Object.entries(fields as Record<string, unknown>)) {
    if (typeof issue !== 'object' || issue === null) continue;
    const { code, n } = issue as { code?: unknown; n?: unknown };
    if (typeof code !== 'string' || code === '') continue;
    out[column] = { code, ...(typeof n === 'number' ? { n } : {}) };
  }
  return Object.keys(out).length === 0 ? null : out;
}

/** Run a write, rethrowing a per-field refusal in the shape the form reads. */
async function withFieldIssues<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const issues = fieldIssuesIn(error);
    if (issues === null) throw error;
    throw new FieldRefusedError(error as ApiError, issues);
  }
}

/** A CrudApi bound to its connection + table (query keys, invalidation). */
export interface BoundCrudApi extends CrudApi {
  readonly connectionId: string;
  /** Qualified table name, e.g. `public.customers`. */
  readonly table: string;
}

function listSearch(params: CrudListParams): string {
  const search = new URLSearchParams();
  if (params.select !== undefined && params.select.length > 0) search.set('select', params.select.join(','));
  if (params.where !== undefined) search.set('where', JSON.stringify(params.where));
  if (params.q !== undefined && params.q !== '') search.set('q', params.q);
  if (params.order !== undefined && params.order.length > 0) {
    search.set('order', params.order.map((sort) => `${sort.column}.${sort.dir}`).join(','));
  }
  // Repeatable — one `lookup=` per cross-table alias, one
  // `agg=` per reverse-link aggregate alias.
  for (const lookup of params.lookup ?? []) search.append('lookup', lookup);
  for (const agg of params.agg ?? []) search.append('agg', agg);
  // NOT repeatable: the server refuses a second `compute=` by name.
  if (params.compute !== undefined) search.set('compute', params.compute);
  if (params.limit !== undefined) search.set('limit', String(params.limit));
  if (params.offset !== undefined) search.set('offset', String(params.offset));
  if (params.cursor !== undefined) search.set('cursor', params.cursor);
  if (params.count !== undefined) search.set('count', params.count);
  const encoded = search.toString();
  return encoded === '' ? '' : `?${encoded}`;
}

/** Standalone so undo toasts can fire after the issuing page unmounts. */
export async function undoMutation(token: string): Promise<{ restoredIds: unknown[] }> {
  return api.post<{ restoredIds: unknown[] }>(`/api/v1/data/undo/${encodeURIComponent(token)}`);
}

/**
 * The label for one row of a referenced table.
 *
 * IT IS NO LONGER A GUESS. The spec carries `fk.display` — the referenced
 * table's own display column, picked by the classifier at generation time and
 * stamped by `buildColumnDef` — and that column is what the picker shows.
 *
 * What it replaces: a fixed list of hoped-for key names (`name`, `title`,
 * `label`, `display_name`, `full_name`, `email`) followed by "the first
 * non-empty string in the row". A `companies` table whose display column is
 * `company` showed raw ids; a table whose first text column happened to be a
 * postcode showed postcodes. The server knew the right answer all along and
 * the client was never told it.
 *
 * ONE fallback survives, and it is not a name list: a spec with no `display`
 * (an FK whose target generation could not resolve — an excluded table, a page
 * made before the stamp) shows the row's first non-empty text, then the key
 * itself. A degraded label beats a picker of raw ids; a list of hoped-for
 * names just made the wrong guess look deliberate.
 */
function lookupLabelOf(row: CrudRow, keyColumn: string, display?: string): string {
  if (display !== undefined) {
    const named = row[display];
    if (typeof named === 'string' && named !== '') return named;
    if (typeof named === 'number' || typeof named === 'boolean') return String(named);
  }
  for (const [key, value] of Object.entries(row)) {
    if (key !== keyColumn && typeof value === 'string' && value !== '') return value;
  }
  return String(row[keyColumn] ?? '');
}

export function createCrudApi(connectionId: string, table: string): BoundCrudApi {
  const conn = encodeURIComponent(connectionId);
  const baseFor = (tableName: string): string => `/api/v1/data/${conn}/${encodeURIComponent(tableName)}`;
  const base = baseFor(table);

  return {
    connectionId,
    table,

    async list(params: CrudListParams = {}): Promise<CrudListResult> {
      return api.get<CrudListResult>(`${base}${listSearch(params)}`);
    },

    async get(recordId, options = {}): Promise<CrudGetResult> {
      const search = new URLSearchParams();
      if (options.include === 'inboundCounts') search.set('include', 'inboundCounts');
      for (const lookup of options.lookup ?? []) search.append('lookup', lookup);
      for (const agg of options.agg ?? []) search.append('agg', agg);
      if (options.compute !== undefined) search.set('compute', options.compute);
      const suffix = search.size === 0 ? '' : `?${search.toString()}`;
      return api.get<CrudGetResult>(`${base}/${encodeURIComponent(recordId)}${suffix}`);
    },

    async create(
      values,
      links,
      children,
      repeat,
    ): Promise<CrudMutationResult> {
      // `links` and `children` are omitted entirely when the form has no such
      // field: an empty object would ask the server to replace nothing, and
      // every write would carry a key that means something.
      return withFieldIssues(() =>
        api.post<CrudMutationResult>(base, {
          values,
          ...(links === undefined ? {} : { links }),
          ...(children === undefined ? {} : { children }),
          ...(repeat === undefined ? {} : { repeat }),
        }),
      );
    },

    async update(recordId, patch, links, children): Promise<CrudMutationResult> {
      return withFieldIssues(() =>
        api.patch<CrudMutationResult>(`${base}/${encodeURIComponent(recordId)}`, {
          values: patch,
          ...(links === undefined ? {} : { links }),
          ...(children === undefined ? {} : { children }),
        }),
      );
    },

    async links(recordId, relationId) {
      const reply = await api.get<{
        data: { key: string | number; name: string; detail?: string }[];
      }>(
        `${base}/${encodeURIComponent(recordId)}/links/${encodeURIComponent(relationId)}`,
      );
      return reply.data.map((row) => ({
        key: String(row.key),
        name: row.name,
        ...(row.detail === undefined ? {} : { detail: row.detail }),
      }));
    },

    async remove(recordId, options = {}): Promise<CrudMutationResult | CrudDeletePreview> {
      const search = new URLSearchParams();
      if (options.dryRun === true) search.set('dryRun', 'true');
      if (options.confirm === true) search.set('confirm', 'true');
      const suffix = search.size === 0 ? '' : `?${search.toString()}`;
      return api.delete<CrudMutationResult | CrudDeletePreview>(
        `${base}/${encodeURIComponent(recordId)}${suffix}`,
      );
    },

    async references(recordId): Promise<CrudReferenceCount[]> {
      const reply = await api.get<{ references: CrudReferenceCount[] }>(
        `${base}/${encodeURIComponent(recordId)}/references`,
      );
      return reply.references;
    },

    undo: undoMutation,

    async bulk(action, ids, values): Promise<CrudBulkResult> {
      return api.post<CrudBulkResult>(`${base}/bulk`, {
        action,
        ids: [...ids],
        ...(values === undefined ? {} : { values }),
      });
    },

    /**
     * Which instants this table's temporal column already holds in a window.
     * `exclude` carries the record being EDITED, so a booking's own slot is
     * not struck out from under it.
     */
    async availability(query): Promise<{ taken: string[]; capped: boolean }> {
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) search.set(key, String(value));
      }
      return await api.get<{ taken: string[]; capped: boolean }>(
        `${base}/availability?${search.toString()}`,
      );
    },
    async lookup(fk, query, fields): Promise<CrudLookupOption[]> {
      /*
       * The columns the FIELD asks for, and no others.
       *
       * Without a `select` this call returns whole rows — every column of
       * twenty records of the target, masked ones included — to render one
       * label. The narrowing is the privacy fix as much as the payload one.
       * With no reference settings the shape is the one this always sent: the
       * key and the display column, which `lookupLabelOf` reads.
       */
      const name = fields?.name ?? fk.display;
      const detail = [...(fields?.detail ?? [])];
      const select = [...new Set([fk.column, ...(name === undefined ? [] : [name]), ...detail])];
      const reply = await api.get<CrudListResult>(
        `${baseFor(fk.table)}${listSearch({ q: query, limit: 20, select })}`,
      );
      return reply.data.map((row) => {
        // " · " joins what is actually there: a row missing one detail reads as
        // one detail, never as "Pro · " with a dangling separator.
        const line = detail
          .map((column) => row[column])
          .filter((value) => value !== null && value !== undefined && value !== '')
          .map((value) => String(value))
          .join(' · ');
        return {
          value: String(row[fk.column] ?? ''),
          label: lookupLabelOf(row, fk.column, name),
          ...(line === '' ? {} : { detail: line }),
        };
      });
    },

    async listRelated(ref): Promise<CrudRow[]> {
      const reply = await api.get<CrudListResult>(
        `${baseFor(ref.table)}${listSearch({
          where: { column: ref.column, op: 'eq', value: ref.value },
          limit: ref.limit ?? 50,
        })}`,
      );
      return reply.data;
    },
  };
}

/**
 * List binding (cache discipline): key `['data', connectionId, table,
 * params]`, staleTime 0, previous page held while the next one loads.
 */
export function crudListQuery(crud: BoundCrudApi, params: CrudListParams = {}) {
  return queryOptions({
    queryKey: ['data', crud.connectionId, crud.table, params] as const,
    staleTime: 0,
    placeholderData: keepPreviousData,
    queryFn: () => crud.list(params),
  });
}
