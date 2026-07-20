/**
 * Global-search client (`GET /api/v1/search`, 08-server-api.md §2.9; exact
 * shapes from apps/server/src/routes/search/schema.ts). The ⌘K palette calls
 * with `limit=3` (§2.9) and `types=record` — its Actions/Navigate/Recent
 * groups are client-side (registry + localStorage), never server concerns.
 */
import { api } from '../app/api.js';

export interface SearchPageHit {
  pageId: string;
  slug: string;
  title: string;
  icon: string | null;
}

export interface SearchRecordHit {
  connectionId: string;
  /** Qualified table id, e.g. `public.customers`. */
  table: string;
  /** `:recordId` segment for `hrefForRecord(pageSlug, recordId)`. */
  recordId: string;
  label: string;
  /** §2.9 row context, e.g. `unit_price 18 · status active` (may be absent). */
  context?: string | undefined;
  pageSlug: string;
}

export type SearchGroup =
  | { type: 'page'; count: number; hits: SearchPageHit[] }
  | {
      type: 'record';
      connectionId: string;
      table: string;
      pageSlug: string;
      count: number;
      /** True when this table's search timed out server-side (degraded). */
      partial?: boolean;
      hits: SearchRecordHit[];
    };

export interface SearchReply {
  data: { groups: SearchGroup[] };
}

/** Per-group cap the palette asks for (08 §2.9). */
export const PALETTE_SEARCH_LIMIT = 3;

export interface SearchOptions {
  limit?: number | undefined;
  types?: readonly ('page' | 'record')[] | undefined;
  connectionId?: string | undefined;
}

export async function search(q: string, options: SearchOptions = {}): Promise<SearchGroup[]> {
  const params = new URLSearchParams({ q });
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  if (options.types !== undefined && options.types.length > 0) {
    params.set('types', options.types.join(','));
  }
  if (options.connectionId !== undefined) params.set('connectionId', options.connectionId);
  const reply = await api.get<SearchReply>(`/api/v1/search?${params.toString()}`);
  return reply.data.groups;
}

/** Flatten the per-table record groups into one palette-ready hit list. */
export function recordHits(groups: readonly SearchGroup[]): SearchRecordHit[] {
  return groups.flatMap((group) => (group.type === 'record' ? group.hits : []));
}
