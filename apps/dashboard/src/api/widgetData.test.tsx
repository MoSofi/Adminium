/**
 * Widget-data batch binding (04 §5, 09 §4.1): descriptor extraction from the
 * dashboard layout, batch dedupe (one round trip per page mount), and the
 * per-item error → per-widget error state mapping — a failing item or a
 * failing batch never crashes the page.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import { jsonResponse, makeCrudEnvelope, makeDashboardEnvelope } from '../test/fixtures.js';
import {
  dedupeRequests,
  extractBindings,
  fetchWidgetDataBatch,
  useDashboardData,
  type WidgetDataRequest,
} from './widgetData.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const descriptor = {
  kind: 'table-query' as const,
  connectionId: 'conn_1',
  source: { schema: 'public', name: 'orders', type: 'table' as const },
  shape: 'single-metric' as const,
};

describe('extractBindings', () => {
  it('collects valid bindings and flags invalid ones per instance', () => {
    const page = makeDashboardEnvelope();
    const layout = page.config['layout'] as { items: Array<{ i: string; config: Record<string, unknown> }> };
    layout.items.push({
      ...(layout.items[0] as object),
      i: 'w3',
      config: { binding: { kind: 'table-query', shape: 'nope' } },
    } as never);

    const { requests, invalid } = extractBindings(page);
    expect(requests.map((request) => request.instanceId)).toEqual(['w1', 'w2']);
    expect(invalid.has('w3')).toBe(true);
  });

  it('returns nothing for non-dashboard documents', () => {
    expect(extractBindings(makeCrudEnvelope()).requests).toHaveLength(0);
  });
});

describe('dedupeRequests', () => {
  it('sends identical descriptors once and fans results back out', () => {
    const requests: WidgetDataRequest[] = [
      { instanceId: 'a', descriptor: descriptor as never },
      { instanceId: 'b', descriptor: descriptor as never },
      { instanceId: 'c', descriptor: { ...descriptor, shape: 'categorical' } as never },
    ];
    const { unique, fanOut } = dedupeRequests(requests);
    expect(unique.map((request) => request.instanceId)).toEqual(['a', 'c']);
    expect(fanOut.get('a')).toEqual(['a', 'b']);
    expect(fanOut.get('c')).toEqual(['c']);
  });
});

describe('fetchWidgetDataBatch', () => {
  it('issues ONE POST /api/v1/widget-data/batch and keys per-item results back', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        results: {
          a: { ok: true, result: { value: 42 }, cached: false },
          c: { ok: false, error: { code: 'UNKNOWN_IDENTIFIER', message: 'no such column' } },
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const byInstance = await fetchWidgetDataBatch(
      [
        { instanceId: 'a', descriptor: descriptor as never },
        { instanceId: 'b', descriptor: descriptor as never },
        { instanceId: 'c', descriptor: { ...descriptor, shape: 'categorical' } as never },
      ],
      { 'dateRange.start': '2026-01-01' },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/v1/widget-data/batch');
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as {
      requests: unknown[];
      params: Record<string, unknown>;
    };
    expect(body.requests).toHaveLength(2); // deduped
    expect(body.params).toEqual({ 'dateRange.start': '2026-01-01' });

    // Fan-out: b shares a's descriptor and receives a's payload.
    expect(byInstance.get('b')?.data).toEqual({ value: 42 });
    expect(byInstance.get('c')?.ok).toBe(false);
  });
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useDashboardData', () => {
  it('maps per-item failures to per-widget error states; siblings stay loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          results: {
            w1: { ok: true, result: { value: 7 }, cached: false },
            w2: { ok: false, error: { code: 'COLUMN_FORBIDDEN', message: 'masked' } },
          },
        }),
      ),
    );
    // Distinct descriptors so both instances go over the wire.
    const page = makeDashboardEnvelope();
    const layout = page.config['layout'] as { items: Array<{ config: Record<string, unknown> }> };
    (layout.items[1] as { config: Record<string, unknown> }).config = {
      binding: { ...descriptor, shape: 'categorical' },
    };

    const { result } = renderHook(() => useDashboardData(page), { wrapper });

    expect(result.current.stateFor('w1')?.status).toBe('loading');
    await waitFor(() => {
      expect(result.current.stateFor('w1')?.status).toBe('success');
    });
    expect(result.current.stateFor('w1')?.data).toEqual({ value: 7 });

    const failed = result.current.stateFor('w2');
    expect(failed?.status).toBe('error');
    expect(String((failed?.error as Error).message)).toContain('masked');

    // Unbound instances are the template's demo-data path, not an error.
    expect(result.current.stateFor('w-unbound')).toBeNull();
  });

  it('maps a whole-batch transport failure to error states on every instance', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(500, { error: { code: 'INTERNAL', message: 'boom', requestId: 'req_1' } }),
      ),
    );
    const { result } = renderHook(() => useDashboardData(makeDashboardEnvelope()), { wrapper });
    await waitFor(() => {
      expect(result.current.stateFor('w1')?.status).toBe('error');
    });
    expect(result.current.stateFor('w2')?.status).toBe('error');
  });
});
