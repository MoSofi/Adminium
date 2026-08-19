// SPDX-License-Identifier: AGPL-3.0-only
/**
 * usePageTemplateData (M7 archetype pages): resource envelopes are
 * `kind: 'page'` — unlike api/widgetData.ts#extractBindings this extractor
 * must NOT gate on the dashboard kind, must collect every layout item's
 * descriptor, and must map invalid descriptors to per-instance messages
 * instead of throwing.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { PageEnvelope } from '@adminium/engine/config';

import { jsonResponse } from '../test/fixtures.js';
import { extractTemplateBindings, usePageTemplateData } from './usePageTemplateData.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * One QueryClient per wrapper, created OUTSIDE the render — a client rebuilt on
 * every render would hand `useQueryClient()` a new identity each time, which is
 * exactly what the refetch-stability assertion below is looking for.
 */
function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

const descriptor = {
  kind: 'table-query',
  connectionId: 'conn_1',
  source: { name: 'approvals', schema: 'public', type: 'table' },
  shape: 'record-list',
  limit: 50,
};

function envelope(items: unknown[]): PageEnvelope {
  return {
    v: 1,
    kind: 'page',
    id: 'page_test_queue',
    template: 'page-queue-inbox',
    title: { key: 'nav.queue', fallback: 'Queue' },
    source: { connectionId: 'conn_1', table: 'public.approvals' },
    nav: { group: 'workspace', icon: 'inbox', order: 10, slug: 'queue' },
    access: { minRole: 'viewer', permissions: [] },
    config: { templateVersion: 1, layout: { version: 1, items } },
  } as unknown as PageEnvelope;
}

describe('extractTemplateBindings', () => {
  it('collects descriptors from a kind:page envelope (no dashboard gate)', () => {
    const page = envelope([
      { i: 'queue', widget: 'master-list', x: 0, y: 3, w: 8, h: 12, config: { binding: descriptor } },
      { i: 'kpi-row-1', widget: 'kpi-stat-card', x: 0, y: 0, w: 3, h: 3, config: {} }, // unbound → demo
    ]);
    const { requests, invalid } = extractTemplateBindings(page);
    expect(requests.map((request) => request.instanceId)).toEqual(['queue']);
    expect(requests[0]?.descriptor.source.name).toBe('approvals');
    expect(invalid.size).toBe(0);
  });

  it('maps an invalid binding to a per-instance message, never a throw', () => {
    const page = envelope([
      { i: 'queue', widget: 'master-list', x: 0, y: 3, w: 8, h: 12, config: { binding: { kind: 'nope' } } },
    ]);
    const { requests, invalid } = extractTemplateBindings(page);
    expect(requests).toHaveLength(0);
    expect(invalid.has('queue')).toBe(true);
  });

  it('returns empty on a missing/corrupt layout', () => {
    const page = envelope([]);
    (page.config as Record<string, unknown>)['layout'] = 'nope';
    const { requests, invalid } = extractTemplateBindings(page);
    expect(requests).toHaveLength(0);
    expect(invalid.size).toBe(0);
  });
});

describe('extractTemplateBindings — shape normalization', () => {
  it('rewrites a shape the compiler rejects to record-list AND drops the stored select', () => {
    // The org-chart's `hierarchy/tree` descriptor names only the columns a
    // server-side shaper would have folded. As a plain row query the template
    // needs the FULL row (pk + parent pointer), and the compiler selects every
    // readable column when `select` is absent — so keeping the stored `select`
    // is what would silently starve the template.
    const page = envelope([
      {
        i: 'org',
        widget: 'org-chart',
        x: 0,
        y: 0,
        w: 12,
        h: 12,
        config: {
          binding: { ...descriptor, shape: 'hierarchy/tree', select: ['id', 'manager_id'] },
        },
      },
    ]);
    const { requests } = extractTemplateBindings(page);
    expect(requests[0]?.descriptor.shape).toBe('record-list');
    expect(requests[0]?.descriptor.select).toBeUndefined();
  });

  it('leaves a supported shape — and its select — exactly as stored', () => {
    const page = envelope([
      {
        i: 'queue',
        widget: 'master-list',
        x: 0,
        y: 0,
        w: 8,
        h: 12,
        config: { binding: { ...descriptor, select: ['id', 'title'] } },
      },
    ]);
    const { requests } = extractTemplateBindings(page);
    expect(requests[0]?.descriptor.shape).toBe('record-list');
    expect(requests[0]?.descriptor.select).toEqual(['id', 'title']);
  });
});

describe('usePageTemplateData', () => {
  const bound = (): PageEnvelope =>
    envelope([
      { i: 'queue', widget: 'master-list', x: 0, y: 3, w: 8, h: 12, config: { binding: descriptor } },
      {
        i: 'kpi',
        widget: 'kpi-stat-card',
        x: 0,
        y: 0,
        w: 3,
        h: 3,
        config: { binding: { ...descriptor, shape: 'single-metric', limit: undefined } },
      },
      { i: 'unbound', widget: 'kpi-stat-card', x: 3, y: 0, w: 3, h: 3, config: {} },
    ]);

  it('starts every bound instance loading, then hands each its own payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          results: {
            queue: { ok: true, result: { rows: [{ id: 1 }] }, cached: false },
            kpi: { ok: true, result: { value: 12 }, cached: false },
          },
        }),
      ),
    );
    const { result } = renderHook(() => usePageTemplateData(bound()), { wrapper: makeWrapper() });

    expect(result.current.states['queue']?.status).toBe('loading');
    expect(result.current.states['kpi']?.status).toBe('loading');
    // An unbound instance is the template's demo-data path, not a state.
    expect(result.current.states['unbound']).toBeUndefined();

    await waitFor(() => {
      expect(result.current.states['queue']?.status).toBe('success');
    });
    expect(result.current.states['queue']?.data).toEqual({ rows: [{ id: 1 }] });
    expect(result.current.states['kpi']?.data).toEqual({ value: 12 });
  });

  it('maps a per-item failure to that instance only, keeping its code and message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          results: {
            queue: { ok: false, error: { code: 'COLUMN_FORBIDDEN', message: 'masked column' } },
            kpi: { ok: true, result: { value: 3 }, cached: false },
          },
        }),
      ),
    );
    const { result } = renderHook(() => usePageTemplateData(bound()), { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(result.current.states['kpi']?.status).toBe('success');
    });
    const failed = result.current.states['queue'];
    expect(failed?.status).toBe('error');
    expect((failed?.error as { code: string }).code).toBe('COLUMN_FORBIDDEN');
    expect((failed?.error as Error).message).toBe('masked column');
  });

  it('falls back to WIDGET_DATA_FAILED when the batch omits an instance entirely', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { results: {} })));
    const { result } = renderHook(() => usePageTemplateData(bound()), { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(result.current.states['queue']?.status).toBe('error');
    });
    expect((result.current.states['queue']?.error as { code: string }).code).toBe('WIDGET_DATA_FAILED');
  });

  it('maps a whole-batch transport failure onto every bound instance', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(500, { error: { code: 'INTERNAL', message: 'boom', requestId: 'req_1' } }),
      ),
    );
    const { result } = renderHook(() => usePageTemplateData(bound()), { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(result.current.states['queue']?.status).toBe('error');
    });
    expect(result.current.states['kpi']?.status).toBe('error');
    expect((result.current.states['queue']?.error as Error).message).toBe('boom');
  });

  it('never sends an invalid binding, and reports it as INVALID_BINDING without waiting', () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { results: {} }));
    vi.stubGlobal('fetch', fetchMock);
    const page = envelope([
      { i: 'queue', widget: 'master-list', x: 0, y: 0, w: 8, h: 12, config: { binding: { kind: 'nope' } } },
    ]);
    const { result } = renderHook(() => usePageTemplateData(page), { wrapper: makeWrapper() });
    expect(result.current.states['queue']?.status).toBe('error');
    expect((result.current.states['queue']?.error as { code: string }).code).toBe('INVALID_BINDING');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('issues no round trip at all for a page with nothing bound', () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { results: {} }));
    vi.stubGlobal('fetch', fetchMock);
    const page = envelope([{ i: 'kpi', widget: 'kpi-stat-card', x: 0, y: 0, w: 3, h: 3, config: {} }]);
    const { result } = renderHook(() => usePageTemplateData(page), { wrapper: makeWrapper() });
    expect(result.current.states).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends ONE batch for the whole page and keeps a stable refetch handle', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        results: { queue: { ok: true, result: [], cached: false }, kpi: { ok: true, result: {}, cached: false } },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const page = bound();
    const { result, rerender } = renderHook(() => usePageTemplateData(page), { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(result.current.states['queue']?.status).toBe('success');
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/v1/widget-data/batch');

    const first = result.current.refetch;
    rerender();
    expect(result.current.refetch).toBe(first);
    // The success states carry it too — that is the template's retry affordance.
    expect(result.current.states['queue']?.refetch).toBe(first);
  });
});
