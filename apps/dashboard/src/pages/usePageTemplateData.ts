// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Widget-data binding for RESOURCE templates (kind: 'page') — the M7
 * archetype pages (`page-directory`, `page-master-detail`,
 * `page-queue-inbox`, …).
 *
 * `src/api/widgetData.ts#extractBindings` deliberately gates on
 * `kind === 'dashboard'`; archetype envelopes are `kind: 'page'`
 * (templateKind, 09 §3.2) yet their `config.layout` items DO carry
 * `binding` query descriptors (04 §5.1 — see generate-archetypes.test.ts).
 * This hook is the same one-batch-per-page-mount discipline over that
 * layout: extract → dedupe/batch via `fetchWidgetDataBatch` → per-instance
 * `WidgetDataState`s handed to the template through its `states` prop.
 * The query key matches useDashboardData's `['widget-data', pageId, params]`
 * prefix, so WS `widget-data:*`/`table:*` invalidations (src/api/realtime.ts)
 * refetch these pages too.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { pageLayoutSchema, queryDescriptorSchema, type PageEnvelope } from '@adminium/engine/config';
import type { WidgetDataState } from '@adminium/widgets';

import {
  WIDGET_DATA_KEY_ROOT,
  WidgetDataItemError,
  fetchWidgetDataBatch,
  type WidgetDataParams,
  type WidgetDataRequest,
} from '../api/widgetData.js';

export interface TemplateBindings {
  requests: WidgetDataRequest[];
  /** instanceId → validation message for items whose binding failed Zod. */
  invalid: Map<string, string>;
}

/**
 * Shapes the server-side compiler accepts today (apps/server widget-data
 * compiler.ts SUPPORTED_SHAPES). The engine persists richer archetype shapes
 * (`hierarchy/tree` for the directory org-chart, `calendar-events`, …) that
 * the M4 compiler rejects — those are rewritten to plain `record-list` row
 * queries and the templates map rows through the stored column vocabulary
 * client-side (the planningData.ts precedent; assembly may unify the two).
 */
const COMPILER_SHAPES: ReadonlySet<string> = new Set([
  'single-metric',
  'metric+delta',
  'timeseries',
  'categorical',
  'record-list',
  'stream',
]);

/** Collect `config.binding` descriptors from any page's layout (no kind gate). */
export function extractTemplateBindings(page: PageEnvelope): TemplateBindings {
  const requests: WidgetDataRequest[] = [];
  const invalid = new Map<string, string>();
  const layout = pageLayoutSchema.safeParse(page.config['layout']);
  if (!layout.success) return { requests, invalid };
  for (const item of layout.data.items) {
    const binding = item.config['binding'];
    if (binding === undefined) continue;
    const descriptor = queryDescriptorSchema.safeParse(binding);
    if (descriptor.success) {
      // Unsupported shapes also DROP the stored `select`: those descriptors
      // (e.g. the org-chart's hierarchy/tree) were authored for a shaper that
      // would resolve identity/parent columns server-side; as a plain row
      // query the template needs the FULL row — pk + hierarchy pointer
      // included — and the compiler selects every readable column when
      // `select` is absent.
      const normalized = COMPILER_SHAPES.has(descriptor.data.shape)
        ? descriptor.data
        : { ...descriptor.data, shape: 'record-list' as const, select: undefined };
      requests.push({ instanceId: item.i, descriptor: normalized });
    } else {
      invalid.set(item.i, descriptor.error.issues.map((issue) => issue.message).join('; '));
    }
  }
  return { requests, invalid };
}

export interface PageTemplateData {
  /** Per-instance data states for the template's `states` prop. */
  states: Record<string, WidgetDataState>;
  /** Refetch the whole page batch. */
  refetch(): void;
}

export function usePageTemplateData(page: PageEnvelope, params: WidgetDataParams = {}): PageTemplateData {
  const queryClient = useQueryClient();
  const { requests, invalid } = useMemo(() => extractTemplateBindings(page), [page]);

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
      record[instanceId] = {
        status: 'error',
        error: new WidgetDataItemError('INVALID_BINDING', message),
      };
    }
    for (const request of requests) {
      const instanceId = request.instanceId;
      if (query.isPending) {
        record[instanceId] = { status: 'loading' };
        continue;
      }
      if (query.isError) {
        // Whole-batch transport failure → per-widget error states (09 §4.1).
        record[instanceId] = { status: 'error', error: query.error, refetch };
        continue;
      }
      const item = query.data.get(instanceId);
      record[instanceId] =
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
  }, [invalid, requests, refetch, query.isPending, query.isError, query.error, query.data, query.isRefetching]);

  return useMemo(() => ({ states, refetch }), [states, refetch]);
}
