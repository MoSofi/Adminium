// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Widget-data states for `kind: 'page'` archetype documents (LOGS/MEDIA/CHAT
 * track — page-log-viewer / page-files / page-chat bindings).
 *
 * `src/api/widgetData.ts`'s `extractBindings`/`useDashboardData` are gated on
 * `page.kind === 'dashboard'`; the §14 archetype pages are `kind: 'page'` but
 * carry the same `config.layout` + per-item `config.binding` descriptors
 * (09-generated-app.md §3.2). This module reuses the SAME transport
 * (`fetchWidgetDataBatch` — one deduped `POST /api/v1/widget-data/batch`) and
 * the SAME query-key root, so WS `widget-data:*`/`table:*` invalidations
 * (src/api/realtime.ts) refetch these pages automatically, and materializes a
 * per-instance `WidgetDataState` record the template renderers consume via
 * their `states` prop (unbound instances stay absent → the template's demo
 * path, 04 §5.3).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { pageLayoutSchema, queryDescriptorSchema, type PageEnvelope, type QueryDescriptor } from '@adminium/engine/config';
import type { WidgetDataState } from '@adminium/widgets';

import {
  WIDGET_DATA_KEY_ROOT,
  WidgetDataItemError,
  fetchWidgetDataBatch,
  type WidgetDataParams,
  type WidgetDataRequest,
} from '../../api/widgetData.js';

export interface PageBindings {
  requests: WidgetDataRequest[];
  /** instanceId → validation message for items whose binding failed Zod. */
  invalid: Map<string, string>;
}

/** `extractBindings` without the dashboard-kind gate — layout is the contract. */
export function extractPageBindings(page: PageEnvelope): PageBindings {
  const requests: WidgetDataRequest[] = [];
  const invalid = new Map<string, string>();
  const layout = pageLayoutSchema.safeParse(page.config['layout']);
  if (!layout.success) return { requests, invalid };
  for (const item of layout.data.items) {
    const binding = item.config['binding'];
    if (binding === undefined) continue;
    const descriptor = queryDescriptorSchema.safeParse(binding);
    if (descriptor.success) {
      requests.push({ instanceId: item.i, descriptor: descriptor.data });
    } else {
      invalid.set(item.i, descriptor.error.issues.map((issue) => issue.message).join('; '));
    }
  }
  return { requests, invalid };
}

/** The stored descriptor of the first layout item using `widgetId` (or instance id). */
export function findItemDescriptor(
  page: PageEnvelope,
  widgetIds: readonly string[],
  instanceId?: string,
): { instanceId: string; descriptor: QueryDescriptor } | null {
  const layout = pageLayoutSchema.safeParse(page.config['layout']);
  if (!layout.success) return null;
  const item =
    layout.data.items.find((entry) => widgetIds.includes(entry.widget)) ??
    (instanceId === undefined ? undefined : layout.data.items.find((entry) => entry.i === instanceId));
  if (item === undefined) return null;
  const descriptor = queryDescriptorSchema.safeParse(item.config['binding']);
  return descriptor.success ? { instanceId: item.i, descriptor: descriptor.data } : null;
}

/** Tolerant `record-list` rows reader (matches the widgets families' readers). */
export function recordRowsOf(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (typeof data === 'object' && data !== null) {
    const envelope = data as { rows?: unknown; data?: unknown; snapshot?: unknown };
    if (Array.isArray(envelope.rows)) return envelope.rows as Record<string, unknown>[];
    if (Array.isArray(envelope.data)) return envelope.data as Record<string, unknown>[];
    if (Array.isArray(envelope.snapshot)) return envelope.snapshot as Record<string, unknown>[];
  }
  return [];
}

export interface PageWidgetStates {
  /** instanceId → state for every BOUND/INVALID instance; others absent (demo). */
  states: Record<string, WidgetDataState>;
  refetch: () => void;
}

/**
 * One batch round trip per page mount under the shared
 * `['widget-data', pageId, params]` key — realtime invalidations refetch it.
 */
export function usePageWidgetStates(page: PageEnvelope, params: WidgetDataParams = {}): PageWidgetStates {
  const queryClient = useQueryClient();
  const { requests, invalid } = useMemo(() => extractPageBindings(page), [page]);

  const query = useQuery({
    queryKey: [WIDGET_DATA_KEY_ROOT, page.id, params] as const,
    enabled: requests.length > 0,
    staleTime: 0,
    queryFn: () => fetchWidgetDataBatch(requests, params),
  });

  const refetch = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [WIDGET_DATA_KEY_ROOT, page.id] });
  }, [queryClient, page.id]);

  const states = useMemo(() => {
    const record: Record<string, WidgetDataState> = {};
    for (const [instanceId, message] of invalid) {
      record[instanceId] = { status: 'error', error: new WidgetDataItemError('INVALID_BINDING', message) };
    }
    for (const request of requests) {
      if (query.isPending) {
        record[request.instanceId] = { status: 'loading' };
        continue;
      }
      if (query.isError) {
        record[request.instanceId] = { status: 'error', error: query.error, refetch };
        continue;
      }
      const item = query.data.get(request.instanceId);
      record[request.instanceId] =
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
    return record;
  }, [requests, invalid, query.isPending, query.isError, query.error, query.data, query.isRefetching, refetch]);

  return useMemo(() => ({ states, refetch }), [states, refetch]);
}
