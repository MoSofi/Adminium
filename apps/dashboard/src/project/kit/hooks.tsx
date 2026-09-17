// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The UI kit's data and navigation hooks (49-developer-projects.md §6.2).
 *
 * Records are read and written through the same `/api/v1/data` routes as
 * generated pages, as the signed-in person: their table permissions, masking
 * and the project's hooks all apply. A database is named by its key in
 * `adminium.config.ts`; the bootstrap payload maps keys to connections.
 * Queries sit under the `['data', connectionId, table]` keys the rest of the
 * dashboard invalidates, so a write anywhere refreshes them.
 */

import { keepPreviousData, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useCallback, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { isDeletePreview, type CrudFilter, type CrudListParams } from '@adminium/widgets';
import type {
  AnyRecord,
  CurrentUser,
  LinkProps,
  Mutation,
  RecordId,
  RecordResult,
  RecordsQuery,
  RecordsResult,
} from '@adminium/server/ui';

import { createCrudApi } from '../../api/crud.js';
import { ApiError } from '../../app/api.js';
import { bootstrapQuery } from '../../app/bootstrap.js';
import { connectionForDatabase } from '../bootstrapProject.js';

const DEFAULT_LIMIT = 50;
/** The data routes' own ceiling. */
const MAX_LIMIT = 200;

function useConnection(database: string): string {
  const { data: bootstrap } = useSuspenseQuery(bootstrapQuery());
  const connectionId = connectionForDatabase(bootstrap, database);
  if (connectionId === null) {
    throw new Error(`There is no database "${database}" in adminium.config.ts, or it has no connection yet.`);
  }
  return connectionId;
}

/** A record key as the data routes take it in a URL. */
export function recordKey(id: RecordId): string {
  return typeof id === 'object' ? JSON.stringify(id) : String(id);
}

/** Kit query options as the data routes' list parameters. */
export function listParams(query: RecordsQuery): CrudListParams {
  const conditions: CrudFilter[] = Object.entries(query.where ?? {}).map(([column, value]) =>
    value === null ? { column, op: 'is_null' } : { column, op: 'eq', value },
  );
  const orderBy = query.orderBy?.trim() ?? '';
  const descending = orderBy.startsWith('-');
  const column = descending ? orderBy.slice(1) : orderBy;
  return {
    ...(conditions.length === 0 ? {} : { where: conditions.length === 1 ? conditions[0] : { and: conditions } }),
    ...(query.search === undefined || query.search.trim() === '' ? {} : { q: query.search.trim() }),
    ...(column === '' ? {} : { order: [{ column, dir: descending ? 'desc' : 'asc' }] }),
    limit: Math.min(Math.max(Math.trunc(query.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT),
    offset: Math.max(Math.trunc(query.offset ?? 0), 0),
    count: 'estimated',
  };
}

const asError = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)));

export function useRecords<R extends AnyRecord = AnyRecord>(
  database: string,
  table: string,
  query: RecordsQuery<R> = {},
): RecordsResult<R> {
  const connectionId = useConnection(database);
  const params = listParams(query as RecordsQuery);
  const result = useQuery({
    queryKey: ['data', connectionId, table, 'project-list', params] as const,
    queryFn: () => createCrudApi(connectionId, table).list(params),
    placeholderData: keepPreviousData,
  });
  const { refetch } = result;
  const again = useCallback(() => void refetch(), [refetch]);
  return {
    data: result.data?.data as R[] | undefined,
    total: result.data?.page?.total ?? null,
    isLoading: result.isPending,
    error: result.error,
    refetch: again,
  };
}

export function useRecord<R extends AnyRecord = AnyRecord>(
  database: string,
  table: string,
  id: RecordId | null | undefined,
): RecordResult<R> {
  const connectionId = useConnection(database);
  const key = id === null || id === undefined ? null : recordKey(id);
  const result = useQuery({
    queryKey: ['data', connectionId, table, 'project-record', key] as const,
    enabled: key !== null,
    queryFn: async (): Promise<R | null> => {
      try {
        return (await createCrudApi(connectionId, table).get(key as string)).data as R;
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
  });
  const { refetch } = result;
  const again = useCallback(() => void refetch(), [refetch]);
  return {
    data: key === null ? null : result.data,
    isLoading: key !== null && result.isPending,
    error: result.error,
    refetch: again,
  };
}

export function useMutation<R extends AnyRecord = AnyRecord>(database: string, table: string): Mutation<R> {
  const connectionId = useConnection(database);
  const queryClient = useQueryClient();
  const [running, setRunning] = useState(0);
  const [error, setError] = useState<Error | null>(null);

  const run = useCallback(
    async <T,>(call: () => Promise<T>): Promise<T> => {
      setRunning((count) => count + 1);
      setError(null);
      try {
        const value = await call();
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['data', connectionId] }),
          queryClient.invalidateQueries({ queryKey: ['widget-data'] }),
        ]);
        return value;
      } catch (caught) {
        setError(asError(caught));
        throw caught;
      } finally {
        setRunning((count) => count - 1);
      }
    },
    [connectionId, queryClient],
  );

  return useMemo<Mutation<R>>(() => {
    const crud = createCrudApi(connectionId, table);
    return {
      create: (values) => run(async () => (await crud.create(values)).data as R),
      update: (id, values) => run(async () => (await crud.update(recordKey(id), values)).data as R),
      remove: (id, options) =>
        run(async () => {
          const reply = await crud.remove(recordKey(id), options?.confirm === true ? { confirm: true } : {});
          if (isDeletePreview(reply)) {
            throw new Error('Other records refer to this one. Pass { confirm: true } to delete it anyway.');
          }
        }),
      isPending: running > 0,
      error,
    };
  }, [connectionId, table, run, running, error]);
}

export function useCurrentUser(): CurrentUser {
  const { data } = useSuspenseQuery(bootstrapQuery());
  return useMemo(
    () => ({ id: data.user.id, name: data.user.name, email: data.user.email, roles: [...data.roles] }),
    [data.user, data.roles],
  );
}

/** A path inside this dashboard; anything else is refused by name. */
function checkedPath(to: string): string {
  if (!to.startsWith('/') || to.startsWith('//')) {
    throw new Error(`"${to}" is not a path in this dashboard. Use one such as /p/orders.`);
  }
  return to;
}

export function useNavigate(): (to: string) => void {
  const router = useRouter();
  return useCallback(
    (to: string) => {
      router.history.push(checkedPath(to));
    },
    [router],
  );
}

export function Link({ to, children }: LinkProps): ReactNode {
  const router = useRouter();
  const path = checkedPath(to);
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    // Let the browser open new tabs and windows itself.
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    router.history.push(path);
  };
  return (
    <a href={router.history.createHref(path)} onClick={onClick} className="font-medium text-accent hover:underline">
      {children}
    </a>
  );
}
