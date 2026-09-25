// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A LINK THAT OPENS A RECORDS PAGE FILTERED — `/p/<slug>?f.<column>=<op>:<value>`.
 *
 * A metric card ("Overdue: $3,120") or a list's "View all" leads to the
 * records page with the filter in its address. The pieces are worked out on
 * the SERVER (`POST /widget-data/link-filters`): "today" is the venue's, the
 * column types are the table's, and a column this reader may not see is left
 * out. What comes back is a plain filter tree of the list grammar, which this
 * ANDs into every read the page's list makes — its pages, its count and its
 * exports — so what is counted, paged and exported is what the chips say.
 *
 * Nothing here decides what a piece means; this only carries the address to
 * the server and the answer to the list.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useRouter, type AnyRouter } from '@tanstack/react-router';
import { useCallback, useSyncExternalStore } from 'react';
import type { CrudApi, CrudFilter, CrudListParams, PageCrudLinkFilter } from '@adminium/widgets';

import { api } from '../app/api.js';
import { LINK_FILTER_PREFIX, spell, type PageSearch } from './pageSearch.js';

export { LINK_FILTER_PREFIX, validatePageSearch, type PageSearch } from './pageSearch.js';

/** Pieces sent at most (the server uses the first eight and says so of the rest). */
const PIECES_MAX = 32;

/** One piece of the address: the column after `f.`, and what it says. */
export interface LinkPiece {
  column: string;
  raw: string;
}

const NO_SEARCH: PageSearch = {};

/**
 * The page's search, and a way to replace it. Read from the router when there
 * is one; a template mounted outside one (a preview, a test harness) has no
 * address and so no link filters — nothing to narrow, nothing to take away.
 */
export function usePageSearch(): { search: PageSearch; replaceSearch: (next: PageSearch) => void } {
  const router = useRouter({ warn: false }) as AnyRouter | null;
  const subscribe = useCallback((notify: () => void) => (router === null ? () => undefined : router.subscribe('onResolved', notify)), [router]);
  const search = useSyncExternalStore(subscribe, () => (router === null ? NO_SEARCH : (router.state.location.search as PageSearch)));
  const replaceSearch = useCallback(
    (next: PageSearch) => {
      if (router !== null) void router.navigate({ to: router.state.location.pathname, search: next } as never);
    },
    [router],
  );
  return { search, replaceSearch };
}

/** The pieces of a search, in its order; a repeated key gives one piece per value. */
export function linkPiecesOf(search: PageSearch): LinkPiece[] {
  const pieces: LinkPiece[] = [];
  for (const [key, value] of Object.entries(search)) {
    if (!key.startsWith(LINK_FILTER_PREFIX) || key.length === LINK_FILTER_PREFIX.length) continue;
    const column = key.slice(LINK_FILTER_PREFIX.length);
    for (const raw of Array.isArray(value) ? value : [value]) {
      const text = spell(raw);
      if (text !== null) pieces.push({ column, raw: text });
    }
  }
  return pieces.slice(0, PIECES_MAX);
}

/** The search with one piece (by its position among the pieces) taken out, or all of them. */
export function searchWithout(search: PageSearch, index: number | 'all'): PageSearch {
  const out: PageSearch = {};
  let at = 0;
  for (const [key, value] of Object.entries(search)) {
    if (!key.startsWith(LINK_FILTER_PREFIX)) {
      out[key] = value;
      continue;
    }
    if (index === 'all') continue;
    const values = Array.isArray(value) ? value : [value];
    const kept = values.filter(() => at++ !== index);
    if (kept.length > 0) out[key] = Array.isArray(value) ? kept : kept[0];
  }
  return out;
}

export interface LinkFilterReply {
  where: CrudFilter | null;
  filters: PageCrudLinkFilter[];
}

/**
 * The server's answer for this page's pieces. Disabled with none, so a page
 * opened plainly makes no request. Re-asked after a minute on focus, so a
 * list left open past the venue's midnight moves "today" with it.
 */
export function useLinkFilters(connectionId: string | null, table: string | null, pieces: readonly LinkPiece[]) {
  return useQuery({
    queryKey: ['link-filters', connectionId, table, pieces] as const,
    queryFn: () =>
      api.post<LinkFilterReply>('/api/v1/widget-data/link-filters', { connectionId, table, filters: pieces }),
    enabled: pieces.length > 0 && connectionId !== null && table !== null,
    staleTime: 60_000,
    // Taking one chip away keeps the rest in force until the new answer is in:
    // the list stays mounted and, for that moment, narrower — never wider.
    placeholderData: keepPreviousData,
  });
}

/**
 * `link` AND `own`, kept as flat as the grammar allows: the list refuses a
 * group nested past two levels, so two `and` groups become one.
 */
export function andWhere(link: CrudFilter, own: CrudFilter | undefined): CrudFilter {
  if (own === undefined) return link;
  const parts = (filter: CrudFilter): CrudFilter[] => ('and' in filter ? filter.and : [filter]);
  return { and: [...parts(link), ...parts(own)] };
}

/**
 * The page's data access with the link's filter under every read of the list:
 * the grid's pages and count, and an export of what is on screen. A record
 * read by id, a write, and the pickers are the page's own and stay as they are.
 */
export function withLinkWhere<T extends CrudApi>(crudApi: T, where: CrudFilter | null): T {
  if (where === null) return crudApi;
  const narrowed = (params: CrudListParams | undefined): CrudListParams => ({
    ...params,
    where: andWhere(where, params?.where),
  });
  const decorated: CrudApi = {
    ...crudApi,
    list: (params) => crudApi.list(narrowed(params)),
    ...(crudApi.export === undefined
      ? {}
      : {
          export: (request) =>
            (crudApi.export as NonNullable<CrudApi['export']>)({ ...request, params: narrowed(request.params) }),
        }),
  };
  return decorated as T;
}
