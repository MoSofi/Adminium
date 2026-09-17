// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `/files` workspace page's read layer (last bullet, Appendix C) over
 * `GET /api/v1/files` and `GET /api/v1/files/usage`.
 *
 * WHY THIS IS NOT IN `./api.ts`. That module is the 37c TRANSPORT: the upload
 * XHR, the batch resolver, and the three record-panel calls, all of which are
 * imperative functions a binding calls. This one is the QUERY layer — TanStack
 * options objects, keyed so one page's mutation can invalidate another's list.
 * Keeping them apart means the record page and the grid never pull a page's
 * infinite-query machinery into their chunk, and this file never grows an
 * upload path it has no use for.
 *
 * THE PRESETS ARE SERVER-SIDE QUERIES, NOT A CLIENT-SIDE FILTER. Every rail
 * entry on the page is a distinct {@link FilesFilters} value that becomes
 * distinct query-string parameters and therefore a distinct request. This is
 * the whole reason the page cannot be the `file-browser` widget (see
 * `FilesPage.tsx`): filtering rows already fetched would answer "of the fifty
 * files on this page, which are in the trash", which is not the question.
 *
 * KEYSET, NOT OFFSET — the `auditApi.ts` precedent, for the same reason. The
 * reply hands back an opaque `nextCursor` and no total, so the page walks
 * forward and never claims to know how many pages there are.
 *
 * SYNC NOTE: {@link FilesListReply} mirrors `filesListReply` and
 * {@link StorageUsageEntry} mirrors `filesUsageReply` in
 * `apps/server/src/routes/files/schema.ts`; `FilesState` mirrors that file's
 * `state` enum. Hand mirrors rather than imports, because the dashboard must
 * not pull `@adminium/meta` (and its database machinery) into a browser chunk
 * — the matrix. Change them together.
 */
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { getFormatters } from '@adminium/i18n';

import { api } from '../app/api.js';
import { getI18nInstance } from '../i18n/t.js';
import type { FileDto } from './api.js';

/** Mirrors the route's `state` enum. `live` is the server's default. */
export type FilesState = 'live' | 'trash' | 'unattached';

/**
 * How "this server's disk" is named on the wire.
 *
 * `destination_id IS NULL` is the implicit destination — it has no row and so
 * no id — and the route maps this sentinel back to `null`. The same constant
 * exists in `studio/storage/storageApi.ts` for the migrate picker; it is
 * repeated rather than imported so this page does not reach into a lazily
 * loaded Studio chunk for one string.
 */
export const LOCAL_DESTINATION_VALUE = 'local';

/** The `limit` every page of the list asks for. The route caps it at 200. */
export const FILES_PAGE_SIZE = 50;

/**
 * One rail preset, as query parameters.
 *
 * `connectionId`/`table` travel together because a bare table name is
 * ambiguous across connections — two sources can both have `public.invoices`,
 * and the route filters on both columns.
 */
export interface FilesFilters {
  state: FilesState;
  /** `''` = no search term. */
  q: string;
  /**
   * `null` = every connection.
   *
   * Usable ON ITS OWN since: every upload records the connection it
   * belongs to, whether or not a record claims it, so "everything for this
   * source" is one query rather than a table-by-table sweep.
   */
  connectionId: string | null;
  table: string | null;
  /** `null` = every destination; {@link LOCAL_DESTINATION_VALUE} = this server's disk. */
  destinationId: string | null;
  /**
   * Uploaded at or after this instant — the **Recent** preset.
   *
   * A server-side filter like every other entry on the rail. Slicing the first
   * page client-side would answer "which of these fifty are recent", which is
   * not the question. `null` = no lower bound.
   */
  since: number | null;
}

export const ALL_FILES_FILTERS: FilesFilters = {
  state: 'live',
  q: '',
  connectionId: null,
  table: null,
  destinationId: null,
  since: null,
};

/**
 * How far back **Recent** looks.
 *
 * Seven days, and deliberately about UPLOAD time rather than last access:
 * nothing records a read, and inventing a per-viewer "last opened" would mean
 * a write on every download to power one rail entry.
 */
export const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface FilesListReply {
  data: FileDto[];
  nextCursor: string | null;
}

/**
 * Filters → the request path. Pure, so the preset-to-query-string mapping is
 * testable without a DOM or a fetch stub — and it is the part that is easy to
 * get quietly wrong, since an omitted parameter widens a preset rather than
 * failing.
 */
export function buildFilesPath(filters: FilesFilters, cursor: string | null): string {
  const params = new URLSearchParams({ state: filters.state, limit: String(FILES_PAGE_SIZE) });
  if (filters.q !== '') params.set('q', filters.q);
  if (filters.connectionId !== null) params.set('connectionId', filters.connectionId);
  if (filters.table !== null) params.set('table', filters.table);
  if (filters.destinationId !== null) params.set('destinationId', filters.destinationId);
  if (filters.since !== null) params.set('since', String(filters.since));
  if (cursor !== null && cursor !== '') params.set('cursor', cursor);
  return `/api/v1/files?${params.toString()}`;
}

/**
 * The list cache root. Deliberately a prefix of {@link FILES_USAGE_QUERY_KEY}
 * as well, so one `invalidateQueries({ queryKey: FILES_QUERY_KEY })` after a
 * delete refreshes both the rows and the bytes-used strip: a delete changes
 * both facts, and a strip that still shows the old figure is a lie the reader
 * has no way to spot.
 */
export const FILES_QUERY_KEY = ['files'] as const;
export const FILES_USAGE_QUERY_KEY = ['files', 'usage'] as const;

export function filesQuery(filters: FilesFilters) {
  return infiniteQueryOptions({
    queryKey: [...FILES_QUERY_KEY, 'list', filters] as const,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.get<FilesListReply>(buildFilesPath(filters, pageParam)),
    getNextPageParam: (last: FilesListReply) => last.nextCursor,
  });
}

/** Mirrors one row of `filesUsageReply`. */
export interface StorageUsageEntry {
  /** `null` = this server's disk, which has no destination row. */
  destinationId: string | null;
  name: string;
  driver: string;
  files: number;
  bytes: number;
  /** Local destinations only — a bucket cannot know. NEVER a denominator. */
  available?: number;
}

/**
 * Bytes and file counts per destination, including the implicit one.
 *
 * Readable with either `files.manage` or `storage.manage`, which is why the
 * page can show the strip to an operator who is only here to tidy files.
 */
export function filesUsageQuery() {
  return queryOptions({
    queryKey: FILES_USAGE_QUERY_KEY,
    queryFn: async () => (await api.get<{ data: StorageUsageEntry[] }>('/api/v1/files/usage')).data,
  });
}

/** One "by table" rail entry. `files` counts only what has been LOADED — see below. */
export interface TablePreset {
  connectionId: string;
  table: string;
  files: number;
}

/**
 * The tables to offer in the rail, derived from the rows on screen.
 *
 * THIS IS THE ONE PLACE THE RAIL IS NOT SERVER-DRIVEN, and it is a gap in the
 * wire rather than a shortcut: Appendix C has no facet or group-by endpoint
 * for files, so nothing can enumerate "every table that owns a file" without
 * walking the whole list. Deriving the entries from the fetched pages means
 * the rail grows as you page forward, and the count beside each entry is
 * therefore "seen so far", not a total — which is why the page labels it as a
 * shortcut and not as a statistic.
 *
 * What the entry DOES do is issue a real server query: selecting one sets
 * `connectionId` + `table` on the request, so it finds files this client has
 * never loaded. The derivation picks the destinations; the server does the
 * filtering.
 */
export function tablePresets(rows: readonly FileDto[]): TablePreset[] {
  const byKey = new Map<string, TablePreset>();
  for (const row of rows) {
    if (row.entity === null) continue;
    const key = `${row.entity.connectionId}\u0000${row.entity.table}`;
    const found = byKey.get(key);
    if (found === undefined) {
      byKey.set(key, { connectionId: row.entity.connectionId, table: row.entity.table, files: 1 });
      continue;
    }
    found.files += 1;
  }
  return [...byKey.values()].sort((a, b) => a.table.localeCompare(b.table));
}

/** Do two preset filters address the same query? Drives the rail's selected state. */
export function sameFilters(a: FilesFilters, b: FilesFilters): boolean {
  return (
    a.state === b.state &&
    a.connectionId === b.connectionId &&
    a.table === b.table &&
    a.destinationId === b.destinationId &&
    // `since` distinguishes Recent from All, which are otherwise the same
    // filter — without it both rail entries would light up together.
    (a.since === null) === (b.since === null)
  );
}

/**
 * "1.2 MB" in the reader's locale.
 *
 * ALWAYS A BARE FIGURE. 37 Appendix D forbids "N of M" outright: this product
 * sells nobody storage, so a capacity denominator would be a number with no
 * meaning attached to it. The only second figure this feature ever shows is a
 * local disk's own "available", and that is a separate sentence, not the
 * bottom half of a fraction.
 *
 * Duplicated from `studio/storage/storageApi.ts` on purpose — one line, and
 * importing it would tie this page to a Studio chunk it otherwise never
 * touches.
 */
export function formatBytes(bytes: number): string {
  return getFormatters(getI18nInstance()?.language ?? 'en-US').bytes(bytes);
}

/** One row of `GET /api/v1/connections`, narrowed to what the rail draws. */
export interface FilesConnection {
  id: string;
  name: string;
}

/**
 * Every connection, for the **By connection** rail group.
 *
 * NOT derived from the rows on screen, unlike {@link tablePresets}. Since every
 * upload records its connection, so the server can answer "everything for this
 * source" directly — and an operator opening the page to find the files they
 * just uploaded to a quiet connection should see that connection in the rail
 * whether or not its files happen to be on the first page.
 *
 * A DUPLICATE of the Studio hub's `connectionsQuery`, deliberately: that one
 * lives in a lazily loaded Studio chunk, and this page has no business pulling
 * the console's API surface in for a list of names. The same reasoning
 * `LOCAL_DESTINATION_VALUE` above is repeated for.
 *
 * SILENT ON FAILURE. `GET /api/v1/connections` is guarded by the admin-only
 * `system:connections:manage`, while this page is reachable with
 * `files.manage`. A 403 is the ordinary answer for a file-tidying operator,
 * and the rail simply does not draw the group — every other preset still
 * works. `retry: false` so the refusal is asked once, not three times.
 */
export function filesConnectionsQuery() {
  return queryOptions({
    queryKey: ['files', 'connections'] as const,
    queryFn: async () =>
      (await api.get<{ connections: FilesConnection[] }>('/api/v1/connections')).connections,
    retry: false,
  });
}

/**
 * Local disks report what is left on them; buckets cannot.
 *
 * Used capacity for a LOCAL destination is `bytes + available` — both figures
 * the server already returns — and it is the only place this feature draws a
 * fraction. "N of M" was banned outright, then narrowed to
 * "never for something with no capacity", which is every remote driver. A disk
 * genuinely has a size, and hiding it does not make the disk bigger.
 */
export function diskCapacityOf(entry: StorageUsageEntry): number | null {
  if (entry.available === undefined) return null;
  const total = entry.bytes + entry.available;
  return total > 0 ? total : null;
}
