// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE DATA KIT'S HOOKS. An add-on's page reads and writes its add-on's
 * tables through the same `/api/v1/data` routes as a generated page, as the
 * signed-in reader: their grants, their role's limits, masking, every rule
 * of the table. A table is a short name (`./resolve.ts`); queries sit under
 * the `['data', connectionId, table]` keys the rest of the dashboard
 * invalidates, so a write anywhere refreshes a page built on these.
 *
 * Signatures are the contract package's (`AddOnDataHooks`), checked by the
 * compiler in `./index.ts`.
 */
import { keepPreviousData, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { isDeletePreview, type CrudFilter, type CrudListParams } from '@adminium/widgets';
import type {
  DataError,
  DataFilter,
  DataRow,
  DataValue,
  EachResult,
  LookUpAnswer,
  OnceValue,
  OpenDocumentOptions,
  TreeNode,
  UseAccessResult,
  PostingSaid,
  UseDocumentResult,
  UseExportResult,
  UseLookUpResult,
  UseReadResult,
  UseRecordResult,
  UseRecordsOptions,
  UseRecordsResult,
  UseStateMoveResult,
  UseTreeWriteResult,
  UseWordsResult,
  UseWriteResult,
  WordsAnswer,
  WriteResult,
} from '@adminium/add-on-contracts/runtime';

import { createCrudApi } from '../../api/crud.js';
import { api, ApiError } from '../../app/api.js';
import { addOnKitQuery, resolveOwnTable, resolveTable, useKit, type Kit } from './resolve.js';

const DEFAULT_PAGE_SIZE = 50;
/** One short of the data routes' ceiling: a list reads one row more than a page to know whether another follows. */
const MAX_PAGE_SIZE = 199;
/** The one-by-one route's ceiling for one call. */
export const EACH_CALL_MAX = 500;

const dataBase = (connectionId: string, tableId: string): string => `/api/v1/data/${encodeURIComponent(connectionId)}/${encodeURIComponent(tableId)}`;
const keyText = (key: string | number): string => String(key);

/** A refusal as a page may show it: the server's code and sentence, and what it says of the row. */
export function dataError(caught: unknown): DataError {
  if (caught instanceof ApiError) {
    return { code: caught.code, message: caught.message, ...(typeof caught.details === 'object' && caught.details !== null ? { details: caught.details as Record<string, unknown> } : {}) };
  }
  return { code: 'CLIENT_ERROR', message: caught instanceof Error ? caught.message : String(caught) };
}

/** One kit filter as the list route's condition. */
function condition(filter: DataFilter): CrudFilter {
  const { column, op, value } = filter;
  if (op === 'empty') return { column, op: 'is_null' };
  if (op === 'notEmpty') return { column, op: 'not_null' };
  // A typed `%` or `_` is the character, not a wildcard.
  if (op === 'contains') return { column, op: 'ilike', value: `%${String(value ?? '').replace(/[\\%_]/g, (hit) => `\\${hit}`)}%` };
  return { column, op, value };
}

/** A kit list as the data routes' parameters: one row more than the page, to know whether another follows. */
export function listParams(options: UseRecordsOptions): { params: CrudListParams; pageSize: number } {
  const pageSize = Math.min(Math.max(Math.trunc(options.pageSize ?? DEFAULT_PAGE_SIZE), 1), MAX_PAGE_SIZE);
  const page = Math.max(Math.trunc(options.page ?? 1), 1);
  const conditions = (options.filter ?? []).map(condition);
  return {
    pageSize,
    params: {
      ...(options.columns === undefined ? {} : { select: options.columns }),
      ...(conditions.length === 0 ? {} : { where: conditions.length === 1 ? conditions[0] : { and: conditions } }),
      ...(options.sort === undefined || options.sort.length === 0 ? {} : { order: options.sort.map((sort) => ({ column: sort.column, dir: sort.direction })) }),
      limit: pageSize + 1,
      offset: (page - 1) * pageSize,
    },
  };
}

/** Run something the kit read told us to; a 403 means the read is stale, so it is read again for the next try. */
function refreshOnRefusal(client: QueryClient, kit: Kit, caught: unknown): void {
  if (caught instanceof ApiError && caught.status === 403) void client.invalidateQueries({ queryKey: addOnKitQuery(kit.addOnKey).queryKey });
}

export function useRecords(table: string, options: UseRecordsOptions = {}): UseRecordsResult {
  const kit = useKit();
  const client = useQueryClient();
  const at = resolveTable(kit, table);
  const { params, pageSize } = listParams(options);
  const result = useQuery({
    queryKey: ['data', at.connectionId, at.id, 'kit-list', params] as const,
    enabled: options.enabled !== false,
    queryFn: async () => {
      try {
        return await createCrudApi(at.connectionId, at.id).list(params);
      } catch (caught) {
        refreshOnRefusal(client, kit, caught);
        throw caught;
      }
    },
    placeholderData: keepPreviousData,
  });
  const { refetch } = result;
  const again = useCallback(() => void refetch(), [refetch]);
  const rows = (result.data?.data ?? []) as DataRow[];
  return {
    rows: rows.length > pageSize ? rows.slice(0, pageSize) : rows,
    hasMore: rows.length > pageSize,
    loading: options.enabled !== false && result.isPending,
    error: result.error === null ? null : dataError(result.error),
    refetch: again,
  };
}

export function useRecord(table: string, key: string | number | null): UseRecordResult {
  const kit = useKit();
  const client = useQueryClient();
  const at = resolveTable(kit, table);
  const id = key === null ? null : keyText(key);
  const result = useQuery({
    queryKey: ['data', at.connectionId, at.id, 'kit-record', id] as const,
    enabled: id !== null,
    queryFn: async (): Promise<DataRow | null> => {
      try {
        return (await createCrudApi(at.connectionId, at.id).get(id as string)).data as DataRow;
      } catch (caught) {
        if (caught instanceof ApiError && caught.status === 404) return null;
        refreshOnRefusal(client, kit, caught);
        throw caught;
      }
    },
  });
  const { refetch } = result;
  const again = useCallback(() => void refetch(), [refetch]);
  return { row: id === null ? null : (result.data ?? null), loading: id !== null && result.isPending, error: result.error === null ? null : dataError(result.error), refetch: again };
}

interface Saved {
  data: unknown;
  once?: { column: string; value: string; print?: string }[];
  postings?: PostingSaid[];
}

/** A save's reply as a page reads it: the row as stored, and a code shown once with the ticket its print takes. */
function written(table: string, reply: Saved): WriteResult {
  const row = (reply.data ?? {}) as DataRow;
  const once = (reply.once ?? []).map((entry): OnceValue => ({ table, key: String(row['id'] ?? ''), column: entry.column, value: entry.value, print: entry.print ?? '' }));
  return { row, ...(once.length === 0 ? {} : { once }), ...(reply.postings === undefined || reply.postings.length === 0 ? {} : { postings: reply.postings }) };
}

/**
 * Reads asked for when something happens, not while the page is drawn: a
 * scan that must know now whether a code names an item, a run that reads
 * which lines are still to go. The lists' own routes, the reader's own grants.
 */
export function useRead(): UseReadResult {
  const kit = useKit();
  const client = useQueryClient();
  return useMemo<UseReadResult>(
    () => ({
      list: async (table, options = {}) => {
        const at = resolveTable(kit, table);
        const { params, pageSize } = listParams(options);
        try {
          const rows = ((await createCrudApi(at.connectionId, at.id).list(params)).data ?? []) as DataRow[];
          return { rows: rows.length > pageSize ? rows.slice(0, pageSize) : rows, hasMore: rows.length > pageSize };
        } catch (caught) {
          refreshOnRefusal(client, kit, caught);
          throw caught;
        }
      },
      get: async (table, key) => {
        const at = resolveTable(kit, table);
        try {
          return (await createCrudApi(at.connectionId, at.id).get(keyText(key))).data as DataRow;
        } catch (caught) {
          if (caught instanceof ApiError && caught.status === 404) return null;
          refreshOnRefusal(client, kit, caught);
          throw caught;
        }
      },
    }),
    [kit, client],
  );
}

/** What every write hook shares: how many are running, the last refusal, and a refresh of everything that read the table. */
function useRunner(kit: Kit, connectionId: string) {
  const client = useQueryClient();
  const [running, setRunning] = useState(0);
  const [error, setError] = useState<DataError | null>(null);
  const run = useCallback(
    async <T,>(call: () => Promise<T>): Promise<T> => {
      setRunning((count) => count + 1);
      setError(null);
      try {
        return await call();
      } catch (caught) {
        setError(dataError(caught));
        refreshOnRefusal(client, kit, caught);
        throw caught;
      } finally {
        // Refused or not, a write may have changed what is stored (a row of several): what read the table reads again.
        await Promise.all([client.invalidateQueries({ queryKey: ['data', connectionId] }), client.invalidateQueries({ queryKey: ['widget-data'] })]);
        setRunning((count) => count - 1);
      }
    },
    [client, kit, connectionId],
  );
  return { run, saving: running > 0, error };
}

interface EachReply {
  results: { id?: unknown; index?: number; ok: boolean; data?: DataRow; postings?: PostingSaid[]; error?: { code: string; message?: string; details?: unknown } }[];
}

/**
 * Rows written one save each, 500 to a call, the calls one after another —
 * never two at once. A call refused as a whole marks its rows with that
 * refusal and stops: what follows was not run.
 */
async function each<Item>(items: readonly Item[], keyOf: (item: Item, index: number) => string, send: (chunk: readonly Item[]) => Promise<EachReply>): Promise<EachResult[]> {
  const out: EachResult[] = [];
  let stopped = false;
  for (let start = 0; start < items.length; start += EACH_CALL_MAX) {
    const chunk = items.slice(start, start + EACH_CALL_MAX);
    if (stopped) {
      chunk.forEach((item, i) => out.push({ key: keyOf(item, start + i), ok: false, notRun: true }));
      continue;
    }
    try {
      const reply = await send(chunk);
      chunk.forEach((item, i) => {
        const result = reply.results[i];
        const key = result?.data?.['id'] !== undefined && result.data['id'] !== null ? String(result.data['id']) : keyOf(item, start + i);
        if (result === undefined || result.error?.code === 'NOT_RUN') out.push({ key, ok: false, notRun: true });
        else if (result.ok) out.push({ key, ok: true, row: result.data ?? {}, ...(result.postings === undefined || result.postings.length === 0 ? {} : { postings: result.postings }) });
        else out.push({ key, ok: false, error: { code: result.error?.code ?? 'REFUSED', message: result.error?.message ?? '', ...(typeof result.error?.details === 'object' && result.error.details !== null ? { details: result.error.details as Record<string, unknown> } : {}) } });
      });
    } catch (caught) {
      const error = dataError(caught);
      chunk.forEach((item, i) => out.push({ key: keyOf(item, start + i), ok: false, error }));
      stopped = true;
    }
  }
  return out;
}

export function useWrite(table: string): UseWriteResult {
  const kit = useKit();
  const at = resolveOwnTable(kit, table);
  const { run, saving, error } = useRunner(kit, at.connectionId);
  return useMemo<UseWriteResult>(() => {
    const crud = createCrudApi(at.connectionId, at.id);
    const base = dataBase(at.connectionId, at.id);
    return {
      create: (values) => run(async () => written(table, (await crud.create(values as Record<string, unknown>)) as Saved)),
      update: (key, values) => run(async () => written(table, (await crud.update(keyText(key), values as Record<string, unknown>)) as Saved)),
      remove: (key) =>
        run(async () => {
          const reply = await crud.remove(keyText(key), { confirm: true });
          if (isDeletePreview(reply)) throw new Error('Other rows refer to this one: it was not deleted.');
        }),
      updateEach: (keys, values, options) => run(() => each(keys, (key) => keyText(key), (chunk) => api.post<EachReply>(`${base}/one-by-one`, { ids: chunk, values, ...(options?.from === undefined ? {} : { from: options.from }) }))),
      createEach: (rows) => run(() => each(rows, (_row, index) => String(index), (chunk) => api.post<EachReply>(`${base}/one-by-one`, { creates: chunk }))),
      saving,
      error,
    };
  }, [at.connectionId, at.id, table, run, saving, error]);
}

interface SchemaRelation {
  id: string;
  through: unknown;
  from: { tableId: string };
  to: { tableId: string };
}

/** A tree as the create route takes one: child rows by the relation that ties them to their parent. */
async function treeBody(kit: Kit, client: QueryClient, table: string, node: TreeNode): Promise<{ values: Record<string, DataValue>; children?: Record<string, unknown[]> }> {
  const names = Object.keys(node.children ?? {});
  if (names.length === 0) return { values: { ...node.values } };
  const parent = resolveOwnTable(kit, table);
  const { model } = await client.fetchQuery({
    queryKey: ['add-on-kit', kit.addOnKey, 'relations', parent.connectionId] as const,
    queryFn: () => api.get<{ model: { relations: SchemaRelation[] } }>(`/api/v1/connections/${encodeURIComponent(parent.connectionId)}/schema`),
    staleTime: 60_000,
  });
  const children: Record<string, unknown[]> = {};
  for (const name of names) {
    const child = resolveOwnTable(kit, name);
    const relation = model.relations.find((candidate) => candidate.through === null && candidate.from.tableId === child.id && candidate.to.tableId === parent.id);
    if (relation === undefined) throw new Error(`"${name}" has no link to "${table}": its rows cannot be saved under one.`);
    const rows: unknown[] = [];
    for (const row of node.children?.[name] ?? []) rows.push(await treeBody(kit, client, name, row));
    children[relation.id] = rows;
  }
  return { values: { ...node.values }, children };
}

export function useTreeWrite(table: string): UseTreeWriteResult {
  const kit = useKit();
  const client = useQueryClient();
  const at = resolveOwnTable(kit, table);
  const { run, saving, error } = useRunner(kit, at.connectionId);
  return useMemo<UseTreeWriteResult>(() => {
    const base = dataBase(at.connectionId, at.id);
    return {
      create: (tree) => run(async () => written(table, await api.post<Saved>(base, await treeBody(kit, client, table, tree)))),
      // Nothing is written, so nothing that read the table needs to read again — but a dry run goes through the same counter.
      dryRun: async (tree) => api.post<Record<string, unknown>>(`${base}/dry-run`, await treeBody(kit, client, table, tree)),
      saving,
      error,
    };
  }, [at.connectionId, at.id, table, kit, client, run, saving, error]);
}

export function useStateMove(table: string): UseStateMoveResult {
  const kit = useKit();
  const at = resolveOwnTable(kit, table);
  const { run } = useRunner(kit, at.connectionId);
  return useCallback<UseStateMoveResult>(
    (key, actionId, values) =>
      run(async () => {
        const states = at.own.states;
        if (states === undefined) throw new Error(`"${table}" keeps no states: its rows are not moved.`);
        const crud = createCrudApi(at.connectionId, at.id);
        // The state the row is in now, as this reader may see it: what the move is made from, and refused if it moved meanwhile.
        const row = (await crud.get(keyText(key))).data as DataRow;
        const from = String(row[states.column] ?? '');
        const action = states.actions?.find((candidate) => candidate.id === actionId && (candidate.kind === 'move' || candidate.kind === 'set'));
        // An action is named and nothing more: its target state and the columns it sets are the server's.
        if (action !== undefined) {
          return written(table, await api.post<Saved>(`${dataBase(at.connectionId, at.id)}/${encodeURIComponent(keyText(key))}/actions/${encodeURIComponent(actionId)}`, { from, ...(values === undefined ? {} : { values }) }));
        }
        // Otherwise a state's own name: a plain move, with the state it was seen in.
        return written(table, await api.patch<Saved>(`${dataBase(at.connectionId, at.id)}/${encodeURIComponent(keyText(key))}`, { values: { ...(values ?? {}), [states.column]: actionId }, from }));
      }),
    [at.connectionId, at.id, at.own.states, table, run],
  );
}

export function useAccess(): UseAccessResult {
  const kit = useKit();
  return useMemo<UseAccessResult>(() => {
    const own = (table: string) => (Object.prototype.hasOwnProperty.call(kit.reply.tables, table) ? kit.reply.tables[table] : undefined);
    return {
      // The kit's read is in before a page is drawn at all.
      ready: true,
      canRead: (table, columns) => {
        const at = own(table);
        if (at === undefined) return kit.reply.hosts.some((host) => host.tableRef === table);
        return at.can.read && (columns ?? []).every((column) => !at.unreadable.includes(column));
      },
      canCreate: (table) => own(table)?.can.create === true,
      canUpdate: (table) => own(table)?.can.update === true,
      canMove: (table, actionId, from) => {
        const states = own(table)?.states;
        if (states === undefined || own(table)?.can.update !== true) return false;
        const action = states.actions?.find((candidate) => candidate.id === actionId);
        if (action !== undefined) return from === undefined ? action.from.length > 0 : action.from.includes(from);
        // A state's own name: a plain move this reader's roles may make.
        return from === undefined ? Object.values(states.moves).some((targets) => targets.includes(actionId)) : (states.moves[from] ?? []).includes(actionId);
      },
      has: (feature) => kit.reply.has[feature] === true,
    };
  }, [kit]);
}

interface LookUpReply {
  found: boolean;
  kind?: string;
  by?: 'code' | 'address';
  table?: string;
  key?: string;
  last4?: string | null;
  record?: DataRow;
  rows?: DataRow[] | null;
  more?: number;
}

export function useLookUp(addOnKey?: string): UseLookUpResult {
  const kit = useKit();
  const key = addOnKey ?? kit.addOnKey;
  const [finding, setFinding] = useState(0);
  const [error, setError] = useState<DataError | null>(null);
  const find = useCallback(
    async (typed: string): Promise<LookUpAnswer | null> => {
      setFinding((count) => count + 1);
      setError(null);
      try {
        // The answer is the server's, passed through: no code ever comes back, so none is kept here.
        const reply = await api.post<LookUpReply>(`/api/v1/add-ons/${encodeURIComponent(key)}/look-up`, { value: typed });
        if (!reply.found || reply.kind === undefined || reply.table === undefined || reply.key === undefined) return null;
        return {
          kind: reply.kind,
          table: reply.table,
          key: reply.key,
          row: reply.record ?? {},
          ...(reply.rows === undefined || reply.rows === null ? {} : { rows: reply.rows }),
          ...(reply.by === undefined ? {} : { by: reply.by }),
          ...(reply.last4 === undefined ? {} : { last4: reply.last4 }),
          ...(reply.more === undefined ? {} : { more: reply.more }),
        };
      } catch (caught) {
        setError(dataError(caught));
        throw caught;
      } finally {
        setFinding((count) => count - 1);
      }
    },
    [key],
  );
  return { find, finding: finding > 0, error };
}

/** The most rows one question may name. */
export const WORDS_IDS_MAX = 60;

export function useWords(wordsId: string): UseWordsResult {
  const kit = useKit();
  return useMemo<UseWordsResult>(
    () => ({
      ask: async (table, ids) => {
        if (ids.length === 0) return [];
        // A short name of the add-on's own, or the stored name of a table that hands it rows: the route takes the stored one.
        const own = Object.prototype.hasOwnProperty.call(kit.reply.tables, table) ? kit.reply.tables[table] : undefined;
        // Anything else must be one of its hosts, by the name it is stored under; a stranger is refused by name.
        if (own === undefined) resolveTable(kit, table);
        const stored = own !== undefined ? `${kit.addOnKey}:${table}` : table;
        const search = new URLSearchParams({ table: stored, ids: ids.slice(0, WORDS_IDS_MAX).map(String).join(',') });
        return (await api.get<{ data: WordsAnswer[] }>(`/api/v1/words/${encodeURIComponent(kit.addOnKey)}/${encodeURIComponent(wordsId)}?${search.toString()}`)).data;
      },
    }),
    [kit, wordsId],
  );
}

interface RenderReply {
  printUrl?: string | null;
  contentUrl?: string | null;
}

export function useDocument(): UseDocumentResult {
  const kit = useKit();
  const [opening, setOpening] = useState(0);
  const [error, setError] = useState<DataError | null>(null);
  const open = useCallback(
    async (kind: string, table: string, key: string | number, options: OpenDocumentOptions = {}): Promise<void> => {
      setOpening((count) => count + 1);
      setError(null);
      try {
        // The table goes by its short name: the server knows whose page asks.
        resolveOwnTable(kit, table);
        const reply = await api.post<RenderReply>(`/api/v1/add-ons/${encodeURIComponent(kit.addOnKey)}/documents/render`, {
          kind,
          table,
          key: keyText(key),
          ...(options.paper === undefined ? {} : { paper: options.paper }),
          ...(options.once === undefined ? {} : { once: options.once }),
          ...(options.locale === undefined ? {} : { locale: options.locale }),
          ...(options.values === undefined ? {} : { values: options.values }),
        });
        const address = options.print === true ? (reply.printUrl ?? reply.contentUrl) : (reply.contentUrl ?? reply.printUrl);
        if (address === undefined || address === null) throw new Error('The document was drawn and has no address to open.');
        // Opened, never fetched: a print ticket good for one use is spent by the tab that prints, not by this page.
        window.open(address, '_blank', 'noopener');
      } catch (caught) {
        setError(dataError(caught));
        throw caught;
      } finally {
        setOpening((count) => count - 1);
      }
    },
    [kit],
  );
  return { open, opening: opening > 0, error };
}

export function useExport(): UseExportResult {
  const kit = useKit();
  const [running, setRunning] = useState(0);
  const [error, setError] = useState<DataError | null>(null);
  const start = useCallback<UseExportResult['start']>(
    async (table, options) => {
      setRunning((count) => count + 1);
      setError(null);
      try {
        const at = resolveTable(kit, table);
        const reply = await api.post<{ data: { id: string } }>('/api/v1/exports', {
          connectionId: at.connectionId,
          source: {
            kind: 'table',
            table: at.id,
            ...(options.filter === undefined || options.filter.length === 0 ? {} : { filters: options.filter.map(condition) }),
            ...(options.columns === undefined ? {} : { columns: options.columns.map((name) => ({ name, label: name })) }),
          },
          format: options.format,
        });
        return reply.data.id;
      } catch (caught) {
        setError(dataError(caught));
        throw caught;
      } finally {
        setRunning((count) => count - 1);
      }
    },
    [kit],
  );
  const download = useCallback(async (id: string): Promise<void> => {
    window.open(`/api/v1/exports/${encodeURIComponent(id)}/download`, '_blank', 'noopener');
  }, []);
  return { start, download, running: running > 0, error };
}
