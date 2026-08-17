// SPDX-License-Identifier: AGPL-3.0-only
/**
 * DashboardData adapter contract (04-widget-registry.md §5.2/§5.3).
 *
 * The template is transport-agnostic: it hands every bound widget's
 * descriptor to `queryBatch` in ONE call (a dashboard loads in one round
 * trip; failures are per-item) and receives per-instance WidgetDataStates
 * back. The dashboard app implements this over
 * `POST /api/v1/widget-data/batch` with TanStack Query (04-T03);
 * Storybook/tests pass canned states or rely on demo mode.
 *
 * Demo mode (04 §5.3): items without a parseable `config.binding` never
 * reach the adapter — they resolve synchronously to
 * `definition.demoData(hash(instanceId))`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fnv1a } from '@adminium/charts';
import { useMaybeT } from '@adminium/i18n/react';

import { widgetRegistry } from '../../registry/index.js';
import { queryDescriptorSchema, type PageLayout, type QueryDescriptor } from '../../page-config/index.js';
import { resolveOfflineWidgetId } from '../../registry/offline.js';
import { useWidgetRuntimeEnv } from '../../frame/WidgetRuntimeContext.js';
import type { WidgetDataState } from '../../frame/WidgetHost.js';
import type { WidgetDefinition } from '../../registry/types.js';

export interface WidgetQueryRequest {
  /** Widget instance id (`layout.items[].i`). */
  instanceId: string;
  descriptor: QueryDescriptor;
}

export interface DashboardDataAdapter {
  /**
   * Resolve all bound instances in one round trip. MUST be per-item
   * fault-isolated: one failing descriptor yields an `error` state for that
   * instance only. Missing keys in the result map read as errors.
   */
  queryBatch(
    requests: readonly WidgetQueryRequest[],
    params?: Record<string, unknown> | undefined,
  ): Promise<Record<string, WidgetDataState>>;
}

export type DashboardDataStates = Record<string, WidgetDataState>;

function demoState(instanceId: string, definition: WidgetDefinition | undefined): WidgetDataState {
  return {
    status: 'success',
    data: definition?.demoData(fnv1a(instanceId)),
  };
}

/**
 * Per-instance data states for a dashboard layout: demo mode for unbound
 * items, one `queryBatch` round trip for bound ones, per-instance refetch
 * closures for WidgetFrame's Retry button.
 */
export function useDashboardData(
  layout: PageLayout,
  adapter: DashboardDataAdapter | undefined,
  params?: Record<string, unknown> | undefined,
  registry: ReadonlyMap<string, WidgetDefinition> = widgetRegistry,
): DashboardDataStates {
  const bound = useMemo<WidgetQueryRequest[]>(() => {
    const requests: WidgetQueryRequest[] = [];
    for (const item of layout.items) {
      const binding = (item.config as { binding?: unknown }).binding;
      if (binding === undefined) continue;
      const parsed = queryDescriptorSchema.safeParse(binding);
      if (parsed.success) requests.push({ instanceId: item.i, descriptor: parsed.data });
    }
    return requests;
  }, [layout]);

  // §7's offline policy decides WHICH widget mounts, so it must also decide
  // whose `demoData` runs — `WidgetHost` resolves the id before it reads the
  // registry, and this used to read the registry with the STORED id. On desktop
  // that fed a map-bubble's lat/lng points to the choropleth tilegram: a blank
  // map with a list of world cities under it. See `useResolvedWidgetId`.
  const runtimeEnv = useWidgetRuntimeEnv();

  // Latest-t ref: the batch effect keys on `run`, so a locale switch must
  // re-label FUTURE errors without refiring the whole query batch.
  const t = useMaybeT();
  const tRef = useRef(t);
  tRef.current = t;

  const demoStates = useMemo<DashboardDataStates>(() => {
    const boundIds = new Set(bound.map((request) => request.instanceId));
    const states: DashboardDataStates = {};
    for (const item of layout.items) {
      if (adapter !== undefined && boundIds.has(item.i)) continue;
      states[item.i] = demoState(item.i, registry.get(resolveOfflineWidgetId(item.widget, runtimeEnv)));
    }
    return states;
  }, [layout, bound, adapter, registry, runtimeEnv]);

  const [remoteStates, setRemoteStates] = useState<DashboardDataStates>({});
  const generation = useRef(0);

  const run = useCallback(
    async (requests: readonly WidgetQueryRequest[]) => {
      if (adapter === undefined || requests.length === 0) return;
      const runId = generation.current;
      try {
        const results = await adapter.queryBatch(requests, params);
        if (generation.current !== runId) return; // layout/params changed mid-flight
        setRemoteStates((previous) => {
          const next = { ...previous };
          for (const request of requests) {
            next[request.instanceId] =
              results[request.instanceId] ??
              ({
                status: 'error',
                error: new Error(tRef.current('ui:frame.noResult', 'No result for widget')),
              } satisfies WidgetDataState);
          }
          return next;
        });
      } catch (error) {
        if (generation.current !== runId) return;
        // Adapter-level failure: every requested instance shows the error
        // state (per-item isolation is the adapter's contract; this is the
        // transport-down fallback).
        setRemoteStates((previous) => {
          const next = { ...previous };
          for (const request of requests) next[request.instanceId] = { status: 'error', error };
          return next;
        });
      }
    },
    [adapter, params],
  );

  useEffect(() => {
    if (adapter === undefined || bound.length === 0) return;
    generation.current += 1;
    const loading: DashboardDataStates = {};
    for (const request of bound) loading[request.instanceId] = { status: 'loading' };
    setRemoteStates(loading);
    void run(bound);
  }, [adapter, bound, run]);

  return useMemo(() => {
    const states: DashboardDataStates = { ...demoStates };
    if (adapter !== undefined) {
      for (const request of bound) {
        const remote = remoteStates[request.instanceId] ?? { status: 'loading' as const };
        states[request.instanceId] = {
          ...remote,
          refetch: () => void run([request]),
        };
      }
    }
    return states;
  }, [demoStates, adapter, bound, remoteStates, run]);
}
