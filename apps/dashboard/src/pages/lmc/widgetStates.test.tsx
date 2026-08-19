// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Widget-data states for the LOGS/MEDIA/CHAT archetype pages (09 §14).
 *
 * `extractPageBindings` is the deliberately UNNORMALIZED extractor of the three
 * — unlike `usePageTemplateData` and `planningData` it rewrites no shape, so a
 * descriptor reaches the compiler exactly as the engine stored it. That
 * difference is the first thing here.
 *
 * `recordRowsOf` is the other: it is the reader every one of these templates
 * uses to find rows in a payload whose envelope shape is not fixed, and its
 * contract is "an array or nothing" — never a throw, never a half-object the
 * template would then index into.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PageEnvelope } from '@adminium/engine/config';
import type { ReactNode } from 'react';

import { jsonResponse } from '../../test/fixtures.js';
import { extractPageBindings, findItemDescriptor, recordRowsOf, usePageWidgetStates } from './widgetStates.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

const descriptor = {
  kind: 'table-query',
  connectionId: 'conn_1',
  source: { schema: 'public', name: 'order_audit', type: 'table' },
  shape: 'stream',
  limit: 200,
};

function envelope(items: unknown[]): PageEnvelope {
  return {
    v: 1,
    kind: 'page',
    id: 'page_logs',
    template: 'page-log-viewer',
    title: { key: 'nav.logs', fallback: 'Logs' },
    source: { connectionId: 'conn_1', table: 'public.order_audit' },
    nav: { group: 'library', icon: 'file-text', order: 10, slug: 'logs' },
    access: {},
    config: { templateVersion: 1, layout: { version: 1, items } },
  } as unknown as PageEnvelope;
}

const boundPage = (): PageEnvelope =>
  envelope([
    { i: 'log', widget: 'log-stream', x: 0, y: 0, w: 12, h: 14, config: { binding: descriptor } },
    { i: 'unbound', widget: 'kpi-stat-card', x: 0, y: 14, w: 3, h: 3, config: {} },
  ]);

describe('extractPageBindings', () => {
  it('keeps the stored shape as it is — this extractor normalizes nothing', () => {
    const { requests } = extractPageBindings(
      envelope([
        {
          i: 'log',
          widget: 'log-stream',
          x: 0,
          y: 0,
          w: 12,
          h: 14,
          config: { binding: { ...descriptor, shape: 'calendar-events', select: ['at', 'msg'] } },
        },
      ]),
    );
    expect(requests[0]?.descriptor.shape).toBe('calendar-events');
    expect(requests[0]?.descriptor.select).toEqual(['at', 'msg']);
  });

  it('maps an invalid binding to a per-instance message instead of throwing', () => {
    const { requests, invalid } = extractPageBindings(
      envelope([{ i: 'log', widget: 'log-stream', x: 0, y: 0, w: 12, h: 14, config: { binding: { kind: 'nope' } } }]),
    );
    expect(requests).toHaveLength(0);
    expect(invalid.get('log')).toBeTypeOf('string');
    expect(invalid.get('log')?.length).toBeGreaterThan(0);
  });

  it('returns nothing for a corrupt layout', () => {
    const page = { ...envelope([]), config: { layout: 42 } } as unknown as PageEnvelope;
    expect(extractPageBindings(page).requests).toHaveLength(0);
  });
});

describe('findItemDescriptor', () => {
  it('is null when the matched item carries no valid binding', () => {
    const page = envelope([
      { i: 'log', widget: 'log-stream', x: 0, y: 0, w: 12, h: 14, config: { binding: { kind: 'nope' } } },
    ]);
    expect(findItemDescriptor(page, ['log-stream'])).toBeNull();
  });

  it('is null on a corrupt layout', () => {
    const page = { ...envelope([]), config: { layout: 'nope' } } as unknown as PageEnvelope;
    expect(findItemDescriptor(page, ['log-stream'])).toBeNull();
  });
});

describe('recordRowsOf', () => {
  it('reads a bare array', () => {
    expect(recordRowsOf([{ id: 1 }])).toEqual([{ id: 1 }]);
  });

  it('reads each of the envelope keys the widget families emit', () => {
    expect(recordRowsOf({ rows: [{ id: 1 }] })).toEqual([{ id: 1 }]);
    expect(recordRowsOf({ data: [{ id: 2 }] })).toEqual([{ id: 2 }]);
    expect(recordRowsOf({ snapshot: [{ id: 3 }] })).toEqual([{ id: 3 }]);
  });

  it('prefers `rows` when a payload carries more than one of them', () => {
    expect(recordRowsOf({ rows: [{ id: 1 }], data: [{ id: 2 }], snapshot: [{ id: 3 }] })).toEqual([{ id: 1 }]);
  });

  it('is empty for anything with no array in it — never a throw', () => {
    expect(recordRowsOf(null)).toEqual([]);
    expect(recordRowsOf(undefined)).toEqual([]);
    expect(recordRowsOf('rows')).toEqual([]);
    expect(recordRowsOf(42)).toEqual([]);
    expect(recordRowsOf({})).toEqual([]);
    expect(recordRowsOf({ rows: { 0: { id: 1 } } })).toEqual([]);
  });
});

describe('usePageWidgetStates', () => {
  it('maps a per-item failure and a missing item to error states', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          results: { log: { ok: false, error: { code: 'COLUMN_FORBIDDEN', message: 'masked' } } },
        }),
      ),
    );
    const page = envelope([
      { i: 'log', widget: 'log-stream', x: 0, y: 0, w: 12, h: 14, config: { binding: descriptor } },
      {
        i: 'tail',
        widget: 'log-stream',
        x: 0,
        y: 14,
        w: 12,
        h: 6,
        config: { binding: { ...descriptor, limit: 50 } },
      },
    ]);
    const { result } = renderHook(() => usePageWidgetStates(page), { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(result.current.states['log']?.status).toBe('error');
    });
    expect((result.current.states['log']?.error as { code: string }).code).toBe('COLUMN_FORBIDDEN');
    expect((result.current.states['tail']?.error as { code: string }).code).toBe('WIDGET_DATA_FAILED');
  });

  it('maps a whole-batch failure onto every bound instance, with a retry handle', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(500, { error: { code: 'INTERNAL', message: 'boom', requestId: 'req_1' } }),
      ),
    );
    const { result } = renderHook(() => usePageWidgetStates(boundPage()), { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(result.current.states['log']?.status).toBe('error');
    });
    expect((result.current.states['log']?.error as Error).message).toBe('boom');
    expect(result.current.states['log']?.refetch).toBe(result.current.refetch);
    // Unbound instances stay absent — the template's demo path (04 §5.3).
    expect(result.current.states['unbound']).toBeUndefined();
  });

  it('reports an invalid binding without issuing a request', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const page = envelope([
      { i: 'log', widget: 'log-stream', x: 0, y: 0, w: 12, h: 14, config: { binding: { kind: 'nope' } } },
    ]);
    const { result } = renderHook(() => usePageWidgetStates(page), { wrapper: makeWrapper() });
    expect((result.current.states['log']?.error as { code: string }).code).toBe('INVALID_BINDING');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
