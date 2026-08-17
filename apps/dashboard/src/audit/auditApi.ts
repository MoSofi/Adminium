// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Audit-log data layer over the already-registered `/api/v1/audit` routes
 * (08-server-api.md §2.14) — no new server surface. The routes have shipped
 * since M7 with no consumer at all; this is that consumer.
 *
 * KEYSET, NOT OFFSET. The reply hands back an opaque `nextCursor` and there is
 * no total count, deliberately: an audit log is append-heavy and page 7 of an
 * offset query means something different every time a row lands. So the page
 * walks forward with `fetchNextPage` and never claims to know how many pages
 * there are — an audit surface that rounds off is not an audit surface.
 *
 * SYNC NOTE: `AuditEntryDto` mirrors `auditEntryDto` in
 * `apps/server/src/routes/audit/schema.ts`, and {@link AUDIT_CATEGORIES}
 * mirrors `auditCategorySchema` in `packages/meta/src/schema/json-payloads.ts`
 * (the dashboard has no `@adminium/meta` dependency — copied mirror, per the
 * 01-architecture.md §2.3 matrix). Change them together.
 */
import { infiniteQueryOptions } from '@tanstack/react-query';

import { api } from '../app/api.js';

export type ActorKind = 'user' | 'api-key' | 'system' | 'automation';

export const AUDIT_CATEGORIES = [
  'auth',
  'data',
  'schema',
  'settings',
  'rbac',
  'connection',
  'llm',
  'automation',
  'export',
  'system',
] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

export interface AuditEntryDto {
  id: string;
  createdAt: number;
  actorKind: ActorKind;
  actorId: string | null;
  actorLabel: string;
  category: AuditCategory;
  /** Dotted verb, e.g. `role.permission.change` (07 §3.11). */
  action: string;
  connectionId: string | null;
  entity: Record<string, unknown> | null;
  changes: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

export interface AuditListReply {
  entries: AuditEntryDto[];
  nextCursor: string | null;
}

/** The filter bar, as one value so it can key the query. */
export interface AuditFilters {
  /** `''` = any category. */
  category: AuditCategory | '';
  /** `''` = any actor. */
  actorId: string;
  /** `YYYY-MM-DD` from a date input; `''` = unbounded. */
  from: string;
  to: string;
}

export const EMPTY_AUDIT_FILTERS: AuditFilters = { category: '', actorId: '', from: '', to: '' };

// --- request building (pure — unit-tested without a DOM) ---------------------

/**
 * `YYYY-MM-DD` → the inclusive epoch-ms bound the route wants.
 *
 * The `to` bound takes the END of its day (`T23:59:59.999Z`): a user who picks
 * the same date for both ends means "that day", and a naive midnight-to-
 * midnight range would return nothing at all — the emptiest possible answer to
 * the most obvious possible query. Unparseable input yields `null`, i.e. the
 * bound is simply not sent, rather than `NaN` riding into the query string.
 */
export function dayBound(day: string, edge: 'start' | 'end'): number | null {
  if (day === '') return null;
  const parsed = Date.parse(edge === 'start' ? `${day}T00:00:00.000Z` : `${day}T23:59:59.999Z`);
  return Number.isNaN(parsed) ? null : parsed;
}

export function buildAuditPath(filters: AuditFilters, cursor: string | null): string {
  const params = new URLSearchParams();
  if (filters.category !== '') params.set('category', filters.category);
  if (filters.actorId !== '') params.set('actorId', filters.actorId);
  const from = dayBound(filters.from, 'start');
  const to = dayBound(filters.to, 'end');
  if (from !== null) params.set('from', String(from));
  if (to !== null) params.set('to', String(to));
  if (cursor !== null && cursor !== '') params.set('cursor', cursor);
  const query = params.toString();
  return query === '' ? '/api/v1/audit' : `/api/v1/audit?${query}`;
}

// --- the before/after diff (pure) --------------------------------------------

/** One field of a `{ before, after }` image, as the drawer renders it. */
export interface DiffRow {
  field: string;
  /** `null` = the field is absent from that side (added / removed). */
  before: string | null;
  after: string | null;
  changed: boolean;
}

/**
 * A scalar as one line of a diff cell.
 *
 * `null` the VALUE and `null` "the field was not in this image" are different
 * facts and must not render identically, so the former becomes the literal
 * text `null` and the latter is the `null` return of {@link diffRows}, which
 * the drawer draws as an em-dash. Objects and arrays are compacted to JSON
 * because a nested image is still evidence and dropping it would be worse
 * than an ugly line.
 */
export function formatDiffValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null) return 'null';
  if (value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    // Cyclic or otherwise unserialisable: the row still has to exist, because
    // "this field changed" is the part that matters in an audit log.
    return '[unserializable]';
  }
}

function imageOf(changes: Record<string, unknown> | null, side: 'before' | 'after'): Record<string, unknown> | null {
  const image = changes?.[side];
  if (typeof image !== 'object' || image === null || Array.isArray(image)) return null;
  return image as Record<string, unknown>;
}

/**
 * `changes` → the drawer's rows, union of both images' fields in sorted order.
 *
 * Not every category writes both sides: a create has only `after`, a delete
 * only `before`, and `07 §3.11` truncates the whole payload past 16 KB (see
 * {@link isTruncated}). All three are rendered as what they are rather than
 * flattened into "no changes".
 */
export function diffRows(changes: Record<string, unknown> | null): DiffRow[] {
  const before = imageOf(changes, 'before');
  const after = imageOf(changes, 'after');
  if (before === null && after === null) return [];
  const fields = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].sort();
  return fields.map((field) => {
    const hasBefore = before !== null && field in before;
    const hasAfter = after !== null && field in after;
    const beforeText = hasBefore ? formatDiffValue(before[field]) : null;
    const afterText = hasAfter ? formatDiffValue(after[field]) : null;
    return { field, before: beforeText, after: afterText, changed: beforeText !== afterText };
  });
}

/** The server dropped part of the payload at the §3.11 16 KB cap. */
export function isTruncated(changes: Record<string, unknown> | null): boolean {
  return changes?.['_truncated'] === true;
}

/** `entity` → sorted label/value pairs for the drawer's resource block. */
export function entityRows(entity: Record<string, unknown> | null): { field: string; value: string }[] {
  if (entity === null) return [];
  return Object.keys(entity)
    .sort()
    .map((field) => ({ field, value: formatDiffValue(entity[field]) }));
}

// --- query -------------------------------------------------------------------

export const AUDIT_QUERY_KEY = ['audit'] as const;

export function auditQuery(filters: AuditFilters) {
  return infiniteQueryOptions({
    queryKey: [...AUDIT_QUERY_KEY, filters] as const,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.get<AuditListReply>(buildAuditPath(filters, pageParam)),
    getNextPageParam: (last: AuditListReply) => last.nextCursor,
  });
}
