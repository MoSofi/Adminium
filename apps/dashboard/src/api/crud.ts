// SPDX-License-Identifier: AGPL-3.0-only
/**
 * CrudApi implementation — the typed client for
 * `/api/v1/data/:connectionId/:table` (08-server-api.md §2.7; exact shapes
 * from apps/server/src/routes/data/schema.ts) implementing the `CrudApi`
 * adapter contract the `page-crud` template defines
 * (packages/widgets/src/templates/page-crud/crud-api.ts): list (filter tree +
 * `q` + keyset/offset), get (+ inbound counts), references preflight,
 * create/update/delete (+ cascade dry-run preview), bulk, single-use undo
 * tokens, FK combobox lookup via the referenced table's list endpoint with
 * `q=`, and related-record tabs via a `where column = value` list.
 *
 * TanStack Query binding lives here too (`crudListQuery`, 09-generated-app.md
 * §4 cache discipline) — the template itself stays fetch- and query-free.
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

import { api } from '../app/api.js';

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

/** Preferred display keys for FK lookup labels (no schema knowledge client-side). */
const LOOKUP_LABEL_KEYS = ['name', 'title', 'label', 'display_name', 'full_name', 'email'] as const;

function lookupLabelOf(row: CrudRow, keyColumn: string): string {
  for (const key of LOOKUP_LABEL_KEYS) {
    const value = row[key];
    if (typeof value === 'string' && value !== '') return value;
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
      const include = options.include === 'inboundCounts' ? '?include=inboundCounts' : '';
      return api.get<CrudGetResult>(`${base}/${encodeURIComponent(recordId)}${include}`);
    },

    async create(values): Promise<CrudMutationResult> {
      return api.post<CrudMutationResult>(base, { values });
    },

    async update(recordId, patch): Promise<CrudMutationResult> {
      return api.patch<CrudMutationResult>(`${base}/${encodeURIComponent(recordId)}`, { values: patch });
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

    async lookup(fk, query): Promise<CrudLookupOption[]> {
      const reply = await api.get<CrudListResult>(
        `${baseFor(fk.table)}${listSearch({ q: query, limit: 20 })}`,
      );
      return reply.data.map((row) => ({
        value: String(row[fk.column] ?? ''),
        label: lookupLabelOf(row, fk.column),
      }));
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
 * List binding (09 §4 cache discipline): key
 * `['data', connectionId, table, params]`, staleTime 0, previous page held
 * while the next one loads.
 */
export function crudListQuery(crud: BoundCrudApi, params: CrudListParams = {}) {
  return queryOptions({
    queryKey: ['data', crud.connectionId, crud.table, params] as const,
    staleTime: 0,
    placeholderData: keepPreviousData,
    queryFn: () => crud.list(params),
  });
}
