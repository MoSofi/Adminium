// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Widget-data plumbing for the PLANNING archetype bindings — `page-board`,
 * `page-calendar`, `page-scheduler` (09-generated-app.md §7.5/§7.6).
 *
 * Archetype pages are `kind: 'page'` envelopes, so the dashboard's
 * `useDashboardData` (kind-gated to `'dashboard'`) never extracts their
 * bindings — this module does the same job for any envelope carrying a
 * `config.layout`:
 *
 * - **extraction**: `config.layout.items[].config.binding` → validated
 *   query descriptors; invalid ones become per-instance error states,
 *   never a crash (04 §5.1).
 * - **shape normalization**: the engine persists `calendar-events`-shaped
 *   descriptors, but the server compiler supports the M4 shape set only
 *   (single-metric, metric+delta, timeseries, categorical, record-list,
 *   stream) — anything else is rewritten to `record-list`; the templates
 *   map rows through the stored column vocabulary client-side.
 * - **date windowing**: the template's visible window (calendar range
 *   toolbar, scheduler week nav) rides `dateRange.start`/`dateRange.end`
 *   params; `withDateWindow` appends the matching late-bound `param`
 *   filters to the PRIMARY item's descriptor (04 §5.1 — the server drops
 *   the filter while the param is unset).
 * - **fetching**: one `POST /api/v1/widget-data/batch` per page mount under
 *   `['widget-data', pageId, 'planning', params]`; WS `widget-data:*` /
 *   `table:*` invalidations refetch automatically — which is also what
 *   reconciles the boards' and matrix's optimistic overrides after a write.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import {
  pageLayoutSchema,
  queryDescriptorSchema,
  type PageEnvelope,
  type QueryDescriptor,
} from '@adminium/engine/config';
import type { WidgetDataState } from '@adminium/widgets';

import {
  WIDGET_DATA_KEY_ROOT,
  WidgetDataItemError,
  fetchWidgetDataBatch,
  type WidgetDataParams,
  type WidgetDataRequest,
} from '../../api/widgetData.js';

/** Shapes the server-side compiler accepts today (apps/server widget-data). */
const COMPILER_SHAPES: ReadonlySet<string> = new Set([
  'single-metric',
  'metric+delta',
  'timeseries',
  'categorical',
  'record-list',
  'stream',
]);

/** Rewrite descriptors the compiler rejects into plain row queries. */
export function normalizeDescriptorShape(descriptor: QueryDescriptor): QueryDescriptor {
  if (COMPILER_SHAPES.has(descriptor.shape)) return descriptor;
  return { ...descriptor, shape: 'record-list' };
}

export interface PlanningBindings {
  requests: WidgetDataRequest[];
  /** instanceId → validation message for items whose binding failed Zod. */
  invalid: Map<string, string>;
}

/** Collect + normalize every `config.binding` descriptor from a page layout. */
export function extractPlanningBindings(page: PageEnvelope): PlanningBindings {
  const requests: WidgetDataRequest[] = [];
  const invalid = new Map<string, string>();
  const layout = pageLayoutSchema.safeParse(page.config['layout']);
  if (!layout.success) return { requests, invalid };
  for (const item of layout.data.items) {
    const binding = item.config['binding'];
    if (binding === undefined) continue;
    const descriptor = queryDescriptorSchema.safeParse(binding);
    if (descriptor.success) {
      requests.push({ instanceId: item.i, descriptor: normalizeDescriptorShape(descriptor.data) });
    } else {
      invalid.set(item.i, descriptor.error.issues.map((issue) => issue.message).join('; '));
    }
  }
  return { requests, invalid };
}

/** The primary item whose descriptor gets the `dateRange.*` window filters. */
export interface PlanningWindowTarget {
  instanceId: string;
  /** The stored date column (`startColumn` / `dateColumn` vocabulary). */
  column: string;
}

/**
 * Find the window target on a page: the first layout item using one of
 * `widgetIds`, with its date column read from the stored candidate keys.
 */
export function planningWindowTargetOf(
  page: PageEnvelope,
  widgetIds: readonly string[],
  columnKeys: readonly string[] = ['startColumn', 'dateColumn'],
): PlanningWindowTarget | null {
  const layout = pageLayoutSchema.safeParse(page.config['layout']);
  if (!layout.success) return null;
  for (const item of layout.data.items) {
    if (!widgetIds.includes(item.widget)) continue;
    for (const key of columnKeys) {
      const column = item.config[key];
      if (typeof column === 'string' && column !== '') return { instanceId: item.i, column };
    }
    return null;
  }
  return null;
}

/**
 * Append the late-bound `dateRange.*` window filters to the target item's
 * descriptor (04 §5.1). Idempotent: an already-windowed descriptor is left
 * alone, and untargeted requests (KPI aggregates) pass through untouched.
 */
export function withDateWindow(
  requests: readonly WidgetDataRequest[],
  target: PlanningWindowTarget,
): WidgetDataRequest[] {
  return requests.map((request) => {
    if (request.instanceId !== target.instanceId) return request;
    const filters = request.descriptor.filters ?? [];
    if (filters.some((filter) => filter.param === 'dateRange.start')) return request;
    return {
      instanceId: request.instanceId,
      descriptor: {
        ...request.descriptor,
        filters: [
          ...filters,
          { column: target.column, op: 'gte' as const, param: 'dateRange.start' },
          { column: target.column, op: 'lte' as const, param: 'dateRange.end' },
        ],
      },
    };
  });
}

export type PlanningStates = Record<string, WidgetDataState>;

/**
 * Per-instance data states for a planning page: ONE deduped batch round trip
 * for the bound items (invalid bindings map to error states); `undefined`
 * when the page has nothing bound — the template then runs full demo mode
 * (04 §5.3).
 */
export function usePlanningStates(
  page: PageEnvelope,
  params: WidgetDataParams = {},
  window?: PlanningWindowTarget | null,
): PlanningStates | undefined {
  const queryClient = useQueryClient();
  const { requests: base, invalid } = useMemo(() => extractPlanningBindings(page), [page]);
  const requests = useMemo(
    () => (window === undefined || window === null ? base : withDateWindow(base, window)),
    [base, window],
  );

  const query = useQuery({
    // Distinct key tail: the (disabled) dashboard hook observes
    // ['widget-data', pageId, params] on the same page — the shared
    // ['widget-data'] prefix keeps WS invalidations covering both.
    queryKey: [WIDGET_DATA_KEY_ROOT, page.id, 'planning', params] as const,
    enabled: requests.length > 0,
    staleTime: 0,
    queryFn: () => fetchWidgetDataBatch(requests, params),
  });

  const refetch = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [WIDGET_DATA_KEY_ROOT, page.id] });
  }, [queryClient, page.id]);

  return useMemo(() => {
    if (requests.length === 0 && invalid.size === 0) return undefined;
    const states: PlanningStates = {};
    for (const [instanceId, message] of invalid) {
      states[instanceId] = { status: 'error', error: new WidgetDataItemError('INVALID_BINDING', message) };
    }
    for (const request of requests) {
      if (query.isPending) {
        states[request.instanceId] = { status: 'loading' };
        continue;
      }
      if (query.isError) {
        // Whole-batch transport failure → per-widget error states (09 §4.1).
        states[request.instanceId] = { status: 'error', error: query.error, refetch };
        continue;
      }
      const item = query.data.get(request.instanceId);
      states[request.instanceId] =
        item === undefined || !item.ok
          ? {
              status: 'error',
              error: new WidgetDataItemError(
                item?.error?.code ?? 'WIDGET_DATA_FAILED',
                item?.error?.message ?? 'This widget’s query failed.',
              ),
              refetch,
            }
          : { status: 'success', data: item.data, refetch, isRefetching: query.isRefetching };
    }
    return states;
  }, [requests, invalid, query.isPending, query.isError, query.error, query.data, query.isRefetching, refetch]);
}
