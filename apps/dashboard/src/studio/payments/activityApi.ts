// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Studio → Payments → Activity: the transport.
 *
 * The list pages back on the server's `(at, id)` cursor; "Needs a look" is
 * its own query (the database finds a flagged row however old); the badge
 * is one count, read by the Payments tab, the hub row and the Activity card
 * alike, so all three always say the same number.
 */
import { infiniteQueryOptions, queryOptions, useQuery } from '@tanstack/react-query';

import { api, ApiError, csrfHeaders } from '../../app/api.js';

export const ACTIVITY_FLAGS = ['paid-not-recorded', 'amount-differs', 'payable-voided', 'refunded-at-provider', 'refund-record', 'mode-mismatch', 'paid-twice', 'waiting-long', 'record-changed', 'disputed'] as const;
export type ActivityFlag = (typeof ACTIVITY_FLAGS)[number];

/** The flags whose "Mark as checked" must say what was found (the server refuses an empty note). */
export const NOTE_REQUIRED: ReadonlySet<ActivityFlag> = new Set(['paid-not-recorded', 'amount-differs', 'payable-voided', 'refund-record', 'mode-mismatch', 'paid-twice', 'record-changed']);

export const STATE_GROUPS = ['started', 'paid', 'waiting', 'failed', 'expired', 'refunded', 'refundFailed', 'disputed'] as const;
export type StateGroup = (typeof STATE_GROUPS)[number];

export interface ActivityRow {
  id: string;
  kind: 'attempt' | 'refund';
  at: number;
  service: string;
  mode: 'test' | 'live';
  payable: { kind: string; connectionId: string | null; tableName: string | null; rowKey: string; label: string | null } | null;
  amount: string;
  currency: string;
  state: string;
  paidWith: string | null;
  way: string | null;
  group: StateGroup;
  asked: { amount: string; currency: string };
  times: { started: number; settled: number | null; recorded: number | null; updated: number };
  refs: { attempt: string | null; checkout: string | null; payment: string | null; refund: string | null };
  /** `dispute`: a lost dispute gave the money back (absent from an older server). */
  refundSource: 'staff' | 'provider' | 'dispute' | null;
  flag: { code: ActivityFlag; reason: string | null; message: string | null } | null;
  check: { at: number; by: string | null; byName: string | null; note: string | null } | null;
  /** An attempt that took money: what may still be refunded, and why nothing may now. Null on a refund row. */
  refund: { refundable: string; refusal: { code: string; message: string } | null } | null;
  /** A dispute the service told of; its deadline and outcome are read in the service's dashboard. */
  dispute: { state: 'open' | 'closed'; at: number; closedAt: number | null } | null;
}

export interface ActivityPage {
  rows: ActivityRow[];
  more: boolean;
  next: { before: number; beforeId: string } | null;
}

export interface ActivityFilters {
  state: StateGroup | '';
  service: string;
  way: string;
  mode: 'test' | 'live' | '';
  from: string;
  to: string;
}

export const NO_FILTERS: ActivityFilters = { state: '', service: '', way: '', mode: '', from: '', to: '' };

export const ACTIVITY_QUERY_KEY = ['payments', 'activity'] as const;
export const ACTIVITY_COUNT_QUERY_KEY = ['payments', 'activity', 'count'] as const;

/** The query string for a filter set (and a cursor), leaving out what is not set. */
export function activitySearch(filters: Partial<ActivityFilters> & { open?: boolean }, cursor?: ActivityPage['next']): string {
  const params = new URLSearchParams();
  for (const key of ['state', 'service', 'way', 'mode', 'from', 'to'] as const) {
    const value = filters[key];
    if (value !== undefined && value !== '') params.set(key, value);
  }
  if (filters.open === true) params.set('open', '1');
  if (cursor != null) {
    params.set('before', String(cursor.before));
    params.set('beforeId', cursor.beforeId);
  }
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}

export function activityQuery(filters: ActivityFilters) {
  return infiniteQueryOptions({
    queryKey: [...ACTIVITY_QUERY_KEY, 'list', filters] as const,
    queryFn: async ({ pageParam }) => (await api.get<{ data: ActivityPage }>(`/api/v1/payments/activity${activitySearch(filters, pageParam)}`)).data,
    initialPageParam: null as ActivityPage['next'],
    getNextPageParam: (last) => (last.more ? last.next : null),
    retry: false,
  });
}

/** Every row that still needs a look, however old. */
export function needsLookQuery() {
  return queryOptions({
    queryKey: [...ACTIVITY_QUERY_KEY, 'open'] as const,
    queryFn: async () => (await api.get<{ data: ActivityPage }>(`/api/v1/payments/activity${activitySearch({ open: true })}`)).data,
    retry: false,
  });
}

export function activityCountQuery(enabled = true) {
  return queryOptions({
    queryKey: ACTIVITY_COUNT_QUERY_KEY,
    queryFn: async () => {
      const open = (await api.get<{ data: { open?: unknown } }>('/api/v1/payments/activity/count')).data.open;
      return typeof open === 'number' ? open : 0;
    },
    enabled,
    retry: false,
    staleTime: 30_000,
  });
}

/** "Mark as checked", with what the person found. */
export async function checkFlag(row: Pick<ActivityRow, 'id' | 'kind'>, note: string | null): Promise<void> {
  await api.post(`/api/v1/payments/activity/${row.kind === 'refund' ? 'refunds' : 'attempts'}/${encodeURIComponent(row.id)}/check`, { note });
}

/** The CSV of what the filters show, saved by the browser; answers the file's name. */
export async function exportActivity(filters: ActivityFilters): Promise<string> {
  const response = await fetch(`/api/v1/payments/activity.csv${activitySearch(filters)}`, { credentials: 'same-origin', headers: { accept: 'text/csv', ...csrfHeaders() } });
  if (!response.ok) throw new ApiError(response.status, 'EXPORT_FAILED', `Export failed with status ${String(response.status)}.`, null, null);
  const disposition = response.headers.get('content-disposition') ?? '';
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'payments-activity.csv';
  const url = URL.createObjectURL(await response.blob());
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return name;
}

/** The count beside "Activity" and on the hub's Payments row: rows that still need a look. */
export function useActivityCount(enabled = true): number {
  const count = useQuery(activityCountQuery(enabled));
  return count.data ?? 0;
}
