// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Zod schemas for `GET /api/v1/search` (08-server-api.md §2.9, M4-T06).
 *
 * The reply is GROUPED: one `page` group (nav entries matched by title) and
 * one `record` group PER searched table, in a deterministic order (connection
 * create order, then the table's page nav order). `count` is the capped hit
 * count — "5+" semantics, never a full COUNT(*) (§2.9: honest and fast).
 * Empty record groups are omitted unless the table timed out, in which case
 * the group ships `partial: true` with no hits rather than failing the
 * request (§2.9 degradation rule).
 */

import { z } from 'zod';

/** Per-group hit cap. The ⌘K palette calls with `limit=3` (§2.9). */
export const SEARCH_LIMIT_DEFAULT = 5;
export const SEARCH_LIMIT_MAX = 10;

export const SEARCH_TYPES = ['page', 'record'] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

export const searchQuery = z.object({
  /** Needle; `ILIKE %q%` semantics, ≥ 2 chars after trimming (§2.9). */
  q: z.string().min(2),
  /** CSV subset of `page,record`; unknown entries are ignored. Default: all. */
  types: z.string().optional(),
  /** Restrict record search to one connection. */
  connectionId: z.string().optional(),
  /** CSV of qualified table ids (`public.customers`) to restrict record search. */
  tables: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(SEARCH_LIMIT_MAX).optional(),
});

export const searchPageHit = z.object({
  pageId: z.string(),
  slug: z.string(),
  title: z.string(),
  icon: z.string().nullable(),
});
export type SearchPageHit = z.infer<typeof searchPageHit>;

export const searchRecordHit = z.object({
  connectionId: z.string(),
  /** Qualified snapshot table id, e.g. `public.customers`. */
  table: z.string(),
  /** `:recordId` segment for `/p/:slug/r/:recordId` (crud/records.ts pkLabel). */
  recordId: z.string(),
  /** Display-column value (never a masked/secret column) or the PK label. */
  label: z.string(),
  /**
   * §2.9 row context, e.g. `unit_price 18 · status active` — up to two
   * leading readable columns beyond the label. Masked/secret columns are
   * excluded (§5.3); omitted when the row has nothing else to show.
   */
  context: z.string().optional(),
  /** Slug of the page that renders this table — the palette's nav target. */
  pageSlug: z.string(),
});
export type SearchRecordHit = z.infer<typeof searchRecordHit>;

export const searchPageGroup = z.object({
  type: z.literal('page'),
  count: z.number(),
  hits: z.array(searchPageHit),
});
export type SearchPageGroup = z.infer<typeof searchPageGroup>;

export const searchRecordGroup = z.object({
  type: z.literal('record'),
  connectionId: z.string(),
  table: z.string(),
  pageSlug: z.string(),
  count: z.number(),
  /** True when this table's search timed out — degraded, not failed (§2.9). */
  partial: z.boolean().optional(),
  hits: z.array(searchRecordHit),
});
export type SearchRecordGroup = z.infer<typeof searchRecordGroup>;

export const searchGroup = z.discriminatedUnion('type', [searchPageGroup, searchRecordGroup]);
export type SearchGroup = z.infer<typeof searchGroup>;

export const searchReply = z.object({
  data: z.object({ groups: z.array(searchGroup) }),
});
export type SearchReply = z.infer<typeof searchReply>;
