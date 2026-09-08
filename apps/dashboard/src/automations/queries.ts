// SPDX-License-Identifier: AGPL-3.0-only
/**
 * React-query keys for both automation surfaces (42-automations-and-workflow-
 * logs.md §3.5). Everything hangs off `['automations']` so one invalidation
 * after a rule write refreshes the list, its 30-day counters and the KPI
 * strip together.
 *
 * THE 5 s POLL (§4.2, "Live updates"). The comp draws a Refresh button and
 * nothing else; a run that is pending, running or waiting will change without
 * anybody pressing it, so the runs list re-fetches every five seconds WHILE
 * one of those is on screen and stops when none is. No new realtime channel:
 * `parseChannel` is a closed set (realtime/hub.ts) and one page's live list
 * does not justify widening it (§10 keeps that as a residual).
 */
import { infiniteQueryOptions, queryOptions, type QueryClient } from '@tanstack/react-query';

import { automationsApi, type RunsQuery } from './api.js';
import { RUNNING_STATUSES } from './model/vocabulary.js';

export const AUTOMATIONS_KEY = ['automations'] as const;
export const RUNS_KEY = ['automation-runs'] as const;

/** How often the runs list re-reads while something on it is unfinished. */
export const RUNS_POLL_MS = 5_000;

export function rulesQuery(connectionId?: string) {
  return queryOptions({
    queryKey: [...AUTOMATIONS_KEY, 'list', connectionId ?? null] as const,
    queryFn: () => automationsApi.list(connectionId),
  });
}

export function rulesStatsQuery() {
  return queryOptions({
    queryKey: [...AUTOMATIONS_KEY, 'stats'] as const,
    queryFn: () => automationsApi.stats(),
  });
}

export function sourcesQuery() {
  return queryOptions({
    queryKey: [...AUTOMATIONS_KEY, 'sources'] as const,
    queryFn: () => automationsApi.sources(),
    // The schema behind a rule does not move minute to minute, and every
    // select on the page reads this one payload.
    staleTime: 5 * 60_000,
  });
}

/**
 * The list, paged by the reply's own cursor — "Load older" is another page,
 * not a bigger first one (FILL F9). The poll follows the LOADED rows, so a
 * page of finished runs stops re-reading even while an older page is open.
 */
export function runsQuery(params: RunsQuery) {
  return infiniteQueryOptions({
    queryKey: [...RUNS_KEY, 'list', params] as const,
    queryFn: ({ pageParam }) =>
      automationsApi.runs(pageParam === null ? params : { ...params, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.cursor.next,
    refetchInterval: (query) => {
      const rows = (query.state.data?.pages ?? []).flatMap((page) => page.runs);
      return rows.some((run) => RUNNING_STATUSES.includes(run.status)) ? RUNS_POLL_MS : false;
    },
  });
}

export function runQuery(id: string | null) {
  return queryOptions({
    queryKey: [...RUNS_KEY, 'detail', id] as const,
    queryFn: () => (id === null ? Promise.reject(new Error('no run')) : automationsApi.run(id)),
    enabled: id !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.run.status;
      return status !== undefined && RUNNING_STATUSES.includes(status) ? RUNS_POLL_MS : false;
    },
  });
}

export function runsStatsQuery() {
  return queryOptions({
    queryKey: [...RUNS_KEY, 'stats'] as const,
    queryFn: () => automationsApi.runStats(),
  });
}

/** After any rule write: the list, the counters and the KPI strip re-read. */
export async function invalidateRules(queryClient: QueryClient): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: AUTOMATIONS_KEY });
}

/** The Refresh button (Workflow Logs 66) — list, detail and KPIs together. */
export async function invalidateRuns(queryClient: QueryClient): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: RUNS_KEY });
}
