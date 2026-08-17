// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Bootstrap consumption (09-generated-app.md §2.1–§2.3): query fn parses the
 * `{ data }` envelope, nav helpers drive `/` redirect + slug resolution, and
 * auth failures surface as ApiError (never retried).
 */
import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse, makeBootstrap } from '../test/fixtures.js';
import { ApiError } from './api.js';
import { bootstrapQuery, defaultPageSlug, findNavItemBySlug, flattenNav } from './bootstrap.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('bootstrapQuery', () => {
  it('fetches /api/v1/bootstrap once and unwraps the data envelope', async () => {
    const fixture = makeBootstrap();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: fixture }));
    vi.stubGlobal('fetch', fetchMock);

    const queryClient = new QueryClient();
    const data = await queryClient.ensureQueryData(bootstrapQuery());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/bootstrap');
    expect(data.user.email).toBe('ava@adminium.io');
    expect(data.configVersion).toBe(42);
  });

  it('throws ApiError with the canonical code on 401 without retrying', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(401, { error: { code: 'SESSION_EXPIRED', message: 'expired', requestId: 'req_1' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const queryClient = new QueryClient();
    await expect(queryClient.ensureQueryData(bootstrapQuery())).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
      code: 'SESSION_EXPIRED',
      requestId: 'req_1',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const error = queryClient.getQueryState(bootstrapQuery().queryKey)?.error;
    expect(error).toBeInstanceOf(ApiError);
  });
});

describe('nav helpers', () => {
  const nav = makeBootstrap().nav;

  it('flattens groups in order', () => {
    expect(flattenNav(nav).map((item) => item.slug)).toEqual(['customers', 'orders', 'exports']);
  });

  it('resolves slugs and misses to null', () => {
    expect(findNavItemBySlug(nav, 'orders')?.pageId).toBe('page_orders');
    expect(findNavItemBySlug(nav, 'nope')).toBeNull();
  });

  it('defaults `/` to the first Workspace item; null when nav is empty', () => {
    expect(defaultPageSlug(nav)).toBe('customers');
    expect(defaultPageSlug({ groups: [] })).toBeNull();
    // No workspace group → first item anywhere.
    expect(
      defaultPageSlug({
        groups: [
          {
            key: 'library',
            items: [{ pageId: 'p1', slug: 'exports', labelKey: 'nav.exports', fallback: 'Exports', icon: 'download', order: 1 }],
          },
        ],
      }),
    ).toBe('exports');
  });
});
