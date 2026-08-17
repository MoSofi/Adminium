/**
 * Widget-data binding (04-widget-registry.md §5, 09-generated-app.md §4.1):
 * one `POST /api/v1/widget-data/batch` round trip per dashboard page mount —
 * `{ requests: [{ instanceId, descriptor }], params }` (≤40) → per-instance
 * results. Identical descriptors are deduped in the request and fanned back
 * out on receipt; per-item failures map to per-widget error states, and a
 * whole-batch transport failure maps every instance to an error state — the
 * page itself never crashes.
 *
 * This module implements the `DashboardData` adapter the `page-dashboard`
 * template (packages/widgets/src/templates/page-dashboard) consumes: a lookup
 * from layout instance id → `WidgetDataState` (the WidgetHost input shape)
 * plus a refetch handle.
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

import { api } from '../app/api.js';

export interface WidgetDataRequest {
  instanceId: string;
  descriptor: QueryDescriptor;
}

/** Page-control published params (date range, filter facets — 04 §5.1). */
export type WidgetDataParams = Record<string, unknown>;

interface BatchReplyItem {
  instanceId: string;
  ok: boolean;
  data?: unknown;
  error?: { code?: string; message?: string } | undefined;
}

/**
 * Wire shape (apps/server routes/widget-data, 04 §5.2): `results` is an
 * OBJECT keyed by request instanceId, each item `{ ok, result?, error?,
 * cached }` — the shaped payload rides under `result`. Normalized here into
 * the flat per-instance items the rest of this module works with.
 */
interface WireBatchItem {
  ok: boolean;
  result?: unknown;
  error?: { code?: string; message?: string } | undefined;
  cached?: boolean;
}

interface BatchReply {
  results: Record<string, WireBatchItem>;
}

/** Adapter handed to the page-dashboard template. */
export interface DashboardData {
  /**
   * Data state for one layout instance; `null` when the instance carries no
   * binding (the template renders the widget's deterministic demo data —
   * 04 §5.3 demo mode).
   */
  stateFor(instanceId: string): WidgetDataState | null;
  /** Refetch the page batch (kebab → Refresh, `R` shortcut). */
  refetch(): void;
}

export interface ExtractedBindings {
  requests: WidgetDataRequest[];
  /** instanceId → validation message for items whose binding failed Zod. */
  invalid: Map<string, string>;
}

/**
 * Collect `config.binding` query descriptors from a dashboard document's
 * layout. Invalid descriptors surface as per-instance errors, never a throw.
 */
export function extractBindings(page: PageEnvelope): ExtractedBindings {
  const requests: WidgetDataRequest[] = [];
  const invalid = new Map<string, string>();
  if (page.kind !== 'dashboard') return { requests, invalid };
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

/** Batch-level dedupe: identical descriptors are sent once (04 §5.3). */
export function dedupeRequests(requests: WidgetDataRequest[]): {
  unique: WidgetDataRequest[];
  /** sent instanceId → every instanceId sharing that descriptor. */
  fanOut: Map<string, string[]>;
} {
  const byDescriptor = new Map<string, string[]>();
  const unique: WidgetDataRequest[] = [];
  const fanOut = new Map<string, string[]>();
  for (const request of requests) {
    const key = JSON.stringify(request.descriptor);
    const members = byDescriptor.get(key);
    if (members === undefined) {
      byDescriptor.set(key, [request.instanceId]);
      unique.push(request);
      fanOut.set(request.instanceId, [request.instanceId]);
    } else {
      members.push(request.instanceId);
      const sentId = members[0] as string;
      fanOut.get(sentId)?.push(request.instanceId);
    }
  }
  return { unique, fanOut };
}

export class WidgetDataItemError extends Error {
  override readonly name = 'WidgetDataItemError';
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** One round trip; per-item results keyed back to every requesting instance. */
export async function fetchWidgetDataBatch(
  requests: WidgetDataRequest[],
  params: WidgetDataParams,
): Promise<Map<string, BatchReplyItem>> {
  const { unique, fanOut } = dedupeRequests(requests);
  const reply = await api.post<BatchReply>('/api/v1/widget-data/batch', {
    requests: unique,
    params,
  });
  const byInstance = new Map<string, BatchReplyItem>();
  for (const [sourceId, item] of Object.entries(reply.results)) {
    for (const target of fanOut.get(sourceId) ?? [sourceId]) {
      byInstance.set(target, {
        instanceId: target,
        ok: item.ok,
        data: item.result,
        error: item.error,
      });
    }
  }
  return byInstance;
}

export const WIDGET_DATA_KEY_ROOT = 'widget-data';

/**
 * The dashboard batch binding: key `['widget-data', pageId, params]` — one
 * query per page mount, WS `widget-data:*`/`table:*` events invalidate the
 * `['widget-data']` prefix (src/api/realtime.ts).
 */
export function useDashboardData(page: PageEnvelope, params: WidgetDataParams = {}): DashboardData {
  const queryClient = useQueryClient();
  const { requests, invalid } = useMemo(() => extractBindings(page), [page]);

  // `refreshInterval` (seconds) has been in `widgetSharedConfigSchema` from the
  // start with no consumer anywhere — it rendered as a control in every widget's
  // config drawer and did nothing when set. The batch is per PAGE, not per
  // widget, so the honest interpretation of N per-instance intervals is the
  // tightest one: poll the batch at the shortest interval any bound widget asks
  // for. Nothing set → no polling, exactly as before.
  const refreshMs = useMemo<number | false>(() => {
    const layout = pageLayoutSchema.safeParse(page.config['layout']);
    if (!layout.success) return false;
    const intervals = layout.data.items
      .map((item) => item.config['refreshInterval'])
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
    return intervals.length === 0 ? false : Math.min(...intervals) * 1000;
  }, [page.config]);

  const query = useQuery({
    queryKey: [WIDGET_DATA_KEY_ROOT, page.id, params] as const,
    enabled: requests.length > 0,
    staleTime: 0,
    refetchInterval: refreshMs,
    queryFn: () => fetchWidgetDataBatch(requests, params),
  });

  const refetch = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [WIDGET_DATA_KEY_ROOT, page.id] });
  }, [queryClient, page.id]);

  const bound = useMemo(() => new Set(requests.map((request) => request.instanceId)), [requests]);

  return useMemo<DashboardData>(() => {
    const stateFor = (instanceId: string): WidgetDataState | null => {
      const invalidMessage = invalid.get(instanceId);
      if (invalidMessage !== undefined) {
        return { status: 'error', error: new WidgetDataItemError('INVALID_BINDING', invalidMessage) };
      }
      if (!bound.has(instanceId)) return null; // unbound → demo data (04 §5.3)
      if (query.isPending) return { status: 'loading' };
      if (query.isError) {
        // Whole-batch transport failure → per-widget error states (§4.1).
        return { status: 'error', error: query.error, refetch };
      }
      const item = query.data.get(instanceId);
      if (item === undefined || !item.ok) {
        return {
          status: 'error',
          error: new WidgetDataItemError(
            item?.error?.code ?? 'WIDGET_DATA_FAILED',
            item?.error?.message ?? 'This widget’s query failed.',
          ),
          refetch,
        };
      }
      return {
        status: 'success',
        data: item.data,
        refetch,
        isRefetching: query.isRefetching,
      };
    };
    return { stateFor, refetch };
  }, [invalid, bound, refetch, query.isPending, query.isError, query.error, query.data, query.isRefetching]);
}
