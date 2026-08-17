// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Dashboard layout-persistence client (04-T13): the typed wrappers hit the
 * documented endpoints, the shared/personal save hooks debounce a burst of
 * layouts into a single request (with `flush()` forcing the pending one), reset
 * issues a DELETE, and `resolvedLayoutFromDocument` extracts the server-resolved
 * layout the renderer reads.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PageLayout } from '@adminium/widgets/page-config';

import { createQueryClient } from '../../app/query.js';
import { jsonResponse } from '../../test/fixtures.js';
import { layoutApi } from './layoutApi.js';
import {
  resolvedLayoutFromDocument,
  useResetLayout,
  useSavePersonalLayout,
  useSaveSharedLayout,
} from './useLayoutPersistence.js';

const layout = (i: string): PageLayout => ({
  version: 1,
  items: [{ i, widget: 'kpi-stat-card', x: 0, y: 0, w: 4, h: 3, config: {} }],
});

interface Call {
  url: string;
  method: string;
  body: unknown;
}

function stubFetch(): Call[] {
  const calls: Call[] = [];
  const mock = vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
    calls.push({ url, method, body });
    if (method === 'DELETE') return Promise.resolve(jsonResponse(200, { data: { ok: true } }));
    return Promise.resolve(jsonResponse(200, { data: { layout: body } }));
  });
  vi.stubGlobal('fetch', mock);
  return calls;
}

function wrapper() {
  const client = createQueryClient();
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('layoutApi', () => {
  it('saveShared PATCHes the page layout endpoint', async () => {
    const calls = stubFetch();
    const result = await layoutApi.saveShared('page_dash', layout('a'));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('PATCH');
    expect(calls[0]?.url).toBe('/api/v1/pages/page_dash/layout');
    expect(calls[0]?.body).toEqual(layout('a'));
    expect(result).toEqual(layout('a'));
  });

  it('savePersonal PUTs the me/views layout endpoint', async () => {
    const calls = stubFetch();
    await layoutApi.savePersonal('page_dash', layout('b'));
    expect(calls[0]?.method).toBe('PUT');
    expect(calls[0]?.url).toBe('/api/v1/me/views/page_dash/layout');
    expect(calls[0]?.body).toEqual(layout('b'));
  });

  it('reset DELETEs the me/views layout endpoint', async () => {
    const calls = stubFetch();
    await layoutApi.reset('page_dash');
    expect(calls[0]?.method).toBe('DELETE');
    expect(calls[0]?.url).toBe('/api/v1/me/views/page_dash/layout');
  });
});

describe('resolvedLayoutFromDocument', () => {
  it('extracts config.layout when present and valid', () => {
    expect(resolvedLayoutFromDocument({ config: { layout: layout('x') } })).toEqual(layout('x'));
  });

  it('returns null when the layout is absent or invalid', () => {
    expect(resolvedLayoutFromDocument({ config: {} })).toBeNull();
    expect(resolvedLayoutFromDocument({ config: { layout: { version: 2 } } })).toBeNull();
  });
});

describe('useSaveSharedLayout', () => {
  it('collapses a burst of saves into one PATCH via the trailing debounce', async () => {
    const calls = stubFetch();
    const { result } = renderHook(() => useSaveSharedLayout('page_dash'), { wrapper: wrapper() });

    // Three rapid edits; only the last should reach the server after flush.
    act(() => {
      result.current.save(layout('a'));
      result.current.save(layout('b'));
      result.current.save(layout('c'));
    });
    expect(calls).toHaveLength(0); // still debouncing

    await act(async () => {
      await result.current.flush();
    });

    const patches = calls.filter((c) => c.method === 'PATCH');
    expect(patches).toHaveLength(1);
    expect(patches[0]?.body).toEqual(layout('c'));
  });

  it('flush with nothing pending is a no-op', async () => {
    const calls = stubFetch();
    const { result } = renderHook(() => useSaveSharedLayout('page_dash'), { wrapper: wrapper() });
    await act(async () => {
      await result.current.flush();
    });
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
  });
});

describe('useSavePersonalLayout', () => {
  it('flushes a pending personal override to a single PUT', async () => {
    const calls = stubFetch();
    const { result } = renderHook(() => useSavePersonalLayout('page_dash'), { wrapper: wrapper() });
    result.current.save(layout('mine'));
    await result.current.flush();
    const puts = calls.filter((c) => c.method === 'PUT');
    expect(puts).toHaveLength(1);
    expect(puts[0]?.url).toBe('/api/v1/me/views/page_dash/layout');
  });
});

describe('useResetLayout', () => {
  it('issues a DELETE against the personal override', async () => {
    const calls = stubFetch();
    const { result } = renderHook(() => useResetLayout('page_dash'), { wrapper: wrapper() });
    await result.current.reset();
    await waitFor(() => expect(result.current.isResetting).toBe(false));
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
  });
});
