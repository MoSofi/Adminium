// SPDX-License-Identifier: AGPL-3.0-only
/**
 * planningData unit tests — the pure extraction/normalization layer the
 * planning archetype bindings run before their widget-data batch:
 * kind-'page' envelopes extract, unsupported shapes rewrite to record-list,
 * invalid bindings surface per-instance, and the dateRange window filters
 * land only on the targeted primary item.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PageEnvelope } from '@adminium/engine/config';
import type { ReactNode } from 'react';

import { jsonResponse } from '../../test/fixtures.js';
import {
  extractPlanningBindings,
  normalizeDescriptorShape,
  planningWindowTargetOf,
  usePlanningStates,
  withDateWindow,
} from './planningData.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** One QueryClient per wrapper, built outside the render so its identity holds. */
function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

const CONN = 'conn_1';

function descriptor(shape: string, extra: Record<string, unknown> = {}) {
  return {
    kind: 'table-query',
    connectionId: CONN,
    source: { schema: 'public', name: 'releases', type: 'table' },
    shape,
    limit: 500,
    ...extra,
  };
}

function envelope(items: Record<string, unknown>[]): PageEnvelope {
  return {
    v: 1,
    kind: 'page',
    id: 'page_test',
    template: 'page-calendar',
    title: 'Releases',
    source: { connectionId: CONN, table: 'public.releases' },
    nav: { slug: 'releases', group: 'planning', order: 10 },
    access: {},
    config: {
      templateVersion: 1,
      toolbar: [],
      overlays: [],
      layout: { version: 1, items },
    },
  } as unknown as PageEnvelope;
}

describe('extractPlanningBindings', () => {
  it('extracts descriptors from a kind-page envelope, rewriting calendar-events to record-list', () => {
    const page = envelope([
      {
        i: 'cal-1',
        widget: 'calendar-month',
        x: 0,
        y: 0,
        w: 8,
        h: 12,
        config: { startColumn: 'released_at', binding: descriptor('calendar-events') },
      },
      {
        i: 'kpi-1',
        widget: 'kpi-stat-card',
        x: 0,
        y: 0,
        w: 3,
        h: 3,
        config: { binding: descriptor('metric+delta', { aggregations: [{ fn: 'count', alias: 'n' }] }) },
      },
      { i: 'unbound', widget: 'day-agenda', x: 8, y: 0, w: 4, h: 12, config: {} },
    ]);
    const { requests, invalid } = extractPlanningBindings(page);
    expect(invalid.size).toBe(0);
    expect(requests.map((request) => request.instanceId)).toEqual(['cal-1', 'kpi-1']);
    expect(requests[0]?.descriptor.shape).toBe('record-list'); // rewritten
    expect(requests[1]?.descriptor.shape).toBe('metric+delta'); // supported, untouched
  });

  it('collects invalid bindings per instance instead of throwing', () => {
    const page = envelope([
      { i: 'bad-1', widget: 'calendar-month', x: 0, y: 0, w: 8, h: 12, config: { binding: { nope: true } } },
    ]);
    const { requests, invalid } = extractPlanningBindings(page);
    expect(requests).toHaveLength(0);
    expect(invalid.has('bad-1')).toBe(true);
  });

  it('returns nothing for a corrupt layout (the template shows its invalid card)', () => {
    const page = { ...envelope([]), config: { layout: 'nope' } } as unknown as PageEnvelope;
    const { requests, invalid } = extractPlanningBindings(page);
    expect(requests).toHaveLength(0);
    expect(invalid.size).toBe(0);
  });
});

describe('normalizeDescriptorShape', () => {
  it('leaves compiler-supported shapes untouched', () => {
    const d = descriptor('record-list') as Parameters<typeof normalizeDescriptorShape>[0];
    expect(normalizeDescriptorShape(d)).toBe(d);
  });
});

describe('date windowing', () => {
  const page = envelope([
    {
      i: 'sched-1',
      widget: 'schedule-matrix',
      x: 0,
      y: 0,
      w: 12,
      h: 14,
      config: {
        personColumn: 'employee_id',
        dateColumn: 'shift_date',
        typeColumn: 'shift_type',
        binding: descriptor('record-list'),
      },
    },
    {
      i: 'kpi-1',
      widget: 'kpi-stat-card',
      x: 0,
      y: 0,
      w: 3,
      h: 3,
      config: { binding: descriptor('metric+delta', { aggregations: [{ fn: 'count', alias: 'n' }] }) },
    },
  ]);

  it('finds the primary item and its stored date column', () => {
    expect(planningWindowTargetOf(page, ['schedule-matrix'], ['dateColumn'])).toEqual({
      instanceId: 'sched-1',
      column: 'shift_date',
    });
    expect(planningWindowTargetOf(page, ['calendar-month'])).toBeNull();
  });

  it('appends late-bound dateRange filters to the target only, idempotently', () => {
    const { requests } = extractPlanningBindings(page);
    const target = { instanceId: 'sched-1', column: 'shift_date' };
    const windowed = withDateWindow(requests, target);
    const scheduled = windowed.find((request) => request.instanceId === 'sched-1');
    expect(scheduled?.descriptor.filters).toEqual([
      { column: 'shift_date', op: 'gte', param: 'dateRange.start' },
      { column: 'shift_date', op: 'lte', param: 'dateRange.end' },
    ]);
    // KPI aggregate untouched.
    expect(windowed.find((request) => request.instanceId === 'kpi-1')?.descriptor.filters).toBeUndefined();
    // Idempotent on a second pass.
    expect(withDateWindow(windowed, target).find((r) => r.instanceId === 'sched-1')?.descriptor.filters).toHaveLength(2);
  });
});

describe('planningWindowTargetOf — the near misses', () => {
  const matrix = (config: Record<string, unknown>): PageEnvelope =>
    envelope([{ i: 'sched-1', widget: 'schedule-matrix', x: 0, y: 0, w: 12, h: 14, config }]);

  it('tries the candidate column keys in order', () => {
    // `startColumn` wins over `dateColumn` under the default key list.
    expect(
      planningWindowTargetOf(matrix({ startColumn: 'starts_at', dateColumn: 'shift_date' }), [
        'schedule-matrix',
      ]),
    ).toEqual({ instanceId: 'sched-1', column: 'starts_at' });
  });

  it('gives up on the matched item rather than skipping to the next one', () => {
    // The first item using one of `widgetIds` IS the primary. If it carries no
    // usable date column there is no window to apply — falling through to a
    // later item would window the wrong widget.
    const page = envelope([
      { i: 'sched-1', widget: 'schedule-matrix', x: 0, y: 0, w: 12, h: 14, config: {} },
      {
        i: 'sched-2',
        widget: 'schedule-matrix',
        x: 0,
        y: 14,
        w: 12,
        h: 14,
        config: { dateColumn: 'shift_date' },
      },
    ]);
    expect(planningWindowTargetOf(page, ['schedule-matrix'], ['dateColumn'])).toBeNull();
  });

  it('ignores a blank or non-string stored column', () => {
    expect(planningWindowTargetOf(matrix({ dateColumn: '' }), ['schedule-matrix'], ['dateColumn'])).toBeNull();
    expect(planningWindowTargetOf(matrix({ dateColumn: 7 }), ['schedule-matrix'], ['dateColumn'])).toBeNull();
  });

  it('returns null on a corrupt layout', () => {
    const page = { ...envelope([]), config: { layout: 'nope' } } as unknown as PageEnvelope;
    expect(planningWindowTargetOf(page, ['schedule-matrix'])).toBeNull();
  });
});

describe('normalizeDescriptorShape — the rewrite', () => {
  it('rewrites an unsupported shape but keeps the stored select', () => {
    // Unlike `usePageTemplateData`, the planning templates map rows through the
    // stored column vocabulary client-side, so the projection must survive.
    const d = descriptor('calendar-events', { select: ['starts_at', 'title'] }) as Parameters<
      typeof normalizeDescriptorShape
    >[0];
    const out = normalizeDescriptorShape(d);
    expect(out.shape).toBe('record-list');
    expect(out.select).toEqual(['starts_at', 'title']);
  });
});

describe('usePlanningStates', () => {
  const boundPage = (): PageEnvelope =>
    envelope([
      {
        i: 'cal-1',
        widget: 'calendar-month',
        x: 0,
        y: 0,
        w: 8,
        h: 12,
        config: { startColumn: 'released_at', binding: descriptor('calendar-events') },
      },
      {
        i: 'kpi-1',
        widget: 'kpi-stat-card',
        x: 8,
        y: 0,
        w: 4,
        h: 3,
        config: { binding: descriptor('metric+delta', { aggregations: [{ fn: 'count', alias: 'n' }] }) },
      },
    ]);

  it('is undefined for a page with nothing bound — the template then runs full demo mode', () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { results: {} }));
    vi.stubGlobal('fetch', fetchMock);
    const page = envelope([{ i: 'cal-1', widget: 'calendar-month', x: 0, y: 0, w: 8, h: 12, config: {} }]);
    const { result } = renderHook(() => usePlanningStates(page), { wrapper: makeWrapper() });
    expect(result.current).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('starts loading, then hands each instance its payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          results: {
            'cal-1': { ok: true, result: { rows: [{ id: 1 }] }, cached: false },
            'kpi-1': { ok: true, result: { value: 4 }, cached: false },
          },
        }),
      ),
    );
    const { result } = renderHook(() => usePlanningStates(boundPage()), { wrapper: makeWrapper() });
    expect(result.current?.['cal-1']?.status).toBe('loading');
    await waitFor(() => {
      expect(result.current?.['cal-1']?.status).toBe('success');
    });
    expect(result.current?.['cal-1']?.data).toEqual({ rows: [{ id: 1 }] });
    expect(result.current?.['kpi-1']?.data).toEqual({ value: 4 });
  });

  it('sends the windowed descriptor when a target is supplied, and only for that item', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        results: {
          'cal-1': { ok: true, result: [], cached: false },
          'kpi-1': { ok: true, result: {}, cached: false },
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(
      () => usePlanningStates(boundPage(), {}, { instanceId: 'cal-1', column: 'released_at' }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => {
      expect(result.current?.['cal-1']?.status).toBe('success');
    });
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as {
      requests: { instanceId: string; descriptor: { filters?: unknown[] } }[];
    };
    expect(body.requests.find((request) => request.instanceId === 'cal-1')?.descriptor.filters).toEqual([
      { column: 'released_at', op: 'gte', param: 'dateRange.start' },
      { column: 'released_at', op: 'lte', param: 'dateRange.end' },
    ]);
    expect(body.requests.find((request) => request.instanceId === 'kpi-1')?.descriptor.filters).toBeUndefined();
  });

  it('leaves the descriptors alone when there is no window target', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        results: { 'cal-1': { ok: true, result: [], cached: false }, 'kpi-1': { ok: true, result: {}, cached: false } },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => usePlanningStates(boundPage(), {}, null), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => {
      expect(result.current?.['cal-1']?.status).toBe('success');
    });
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as {
      requests: { descriptor: { filters?: unknown[] } }[];
    };
    expect(body.requests.every((request) => request.descriptor.filters === undefined)).toBe(true);
  });

  it('reports an invalid binding as INVALID_BINDING beside the healthy instances', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, { results: { 'cal-1': { ok: true, result: [], cached: false } } }),
      ),
    );
    const page = envelope([
      {
        i: 'cal-1',
        widget: 'calendar-month',
        x: 0,
        y: 0,
        w: 8,
        h: 12,
        config: { binding: descriptor('calendar-events') },
      },
      { i: 'bad-1', widget: 'day-agenda', x: 8, y: 0, w: 4, h: 12, config: { binding: { nope: true } } },
    ]);
    const { result } = renderHook(() => usePlanningStates(page), { wrapper: makeWrapper() });
    expect(result.current?.['bad-1']?.status).toBe('error');
    expect((result.current?.['bad-1']?.error as { code: string }).code).toBe('INVALID_BINDING');
    await waitFor(() => {
      expect(result.current?.['cal-1']?.status).toBe('success');
    });
  });

  it('maps a per-item failure, a missing item and a dead batch to error states', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          results: { 'cal-1': { ok: false, error: { code: 'UNKNOWN_IDENTIFIER', message: 'no such column' } } },
        }),
      ),
    );
    const { result, unmount } = renderHook(() => usePlanningStates(boundPage()), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => {
      expect(result.current?.['cal-1']?.status).toBe('error');
    });
    expect((result.current?.['cal-1']?.error as { code: string }).code).toBe('UNKNOWN_IDENTIFIER');
    // `kpi-1` is absent from the reply entirely — same error surface, generic code.
    expect((result.current?.['kpi-1']?.error as { code: string }).code).toBe('WIDGET_DATA_FAILED');
    unmount();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(503, { error: { code: 'INTERNAL', message: 'boom', requestId: 'req_2' } }),
      ),
    );
    const dead = renderHook(() => usePlanningStates(boundPage()), { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(dead.result.current?.['cal-1']?.status).toBe('error');
    });
    expect(dead.result.current?.['kpi-1']?.status).toBe('error');
    expect((dead.result.current?.['cal-1']?.error as Error).message).toBe('boom');
  });

  it('hands every state the same refetch handle', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          results: { 'cal-1': { ok: true, result: [], cached: false }, 'kpi-1': { ok: true, result: {}, cached: false } },
        }),
      ),
    );
    const { result } = renderHook(() => usePlanningStates(boundPage()), { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(result.current?.['cal-1']?.status).toBe('success');
    });
    const handle = result.current?.['cal-1']?.refetch;
    expect(handle).toBeTypeOf('function');
    expect(result.current?.['kpi-1']?.refetch).toBe(handle);
  });
});
