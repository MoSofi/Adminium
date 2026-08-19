// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Studio page-manager client (08-server-api.md §2.6).
 *
 * Two contracts are pinned here and neither is visible from the manager screen.
 *
 * EVERY page id is percent-encoded into its path. A page id is server-issued,
 * but it reaches these calls from route params and from a list the server sent,
 * and a single unencoded id is the difference between `PATCH /pages/page_a%2Fb`
 * and a request to a route that does not exist.
 *
 * AND every mutation invalidates `['bootstrap']` as well as the pages list.
 * The sidebar rail is a projection of exactly the rows these calls write and
 * its query holds `staleTime: Infinity`, so a missing invalidation is a rename
 * that is correct on the server, correct in the manager, and stale in the rail
 * beside it until a reload.
 */
import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse } from '../../test/fixtures.js';
import {
  PAGES_QUERY_KEY,
  createPage,
  deletePage,
  duplicatePage,
  invalidatePages,
  isNavGroup,
  saveNavOrder,
  savePageConfig,
  studioPagesQuery,
  updatePage,
  type PageSummaryDto,
} from './pagesApi.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const PAGE: PageSummaryDto = {
  id: 'page_orders',
  connectionId: 'conn_1',
  slug: 'orders',
  type: 'page-crud',
  title: 'Orders',
  icon: 'shopping-cart',
  navGroup: 'workspace',
  navOrder: 2,
  origin: 'generated',
  manifestId: null,
  isEnabled: true,
  revision: 4,
  updatedAt: 1,
};

function stubJson(body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, body));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function requestOf(fetchMock: ReturnType<typeof vi.fn>) {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
  return {
    url: String(url),
    method: init?.method ?? 'GET',
    body: init?.body === undefined ? undefined : (JSON.parse(String(init.body)) as unknown),
  };
}

describe('isNavGroup', () => {
  it('accepts the five fixed sidebar buckets and nothing else', () => {
    expect(['workspace', 'library', 'planning', 'people', 'account'].every(isNavGroup)).toBe(true);
    expect(isNavGroup('studio')).toBe(false);
    expect(isNavGroup(null)).toBe(false);
    expect(isNavGroup('')).toBe(false);
  });
});

describe('the reads', () => {
  it('unwraps the page list out of the §1.4 envelope', async () => {
    stubJson({ data: [PAGE] });
    const query = studioPagesQuery();
    expect(query.queryKey).toEqual(PAGES_QUERY_KEY);
    await expect(query.queryFn?.({} as never)).resolves.toEqual([PAGE]);
  });
});

describe('the writes', () => {
  it('creates a page from the form input', async () => {
    const fetchMock = stubJson({ data: PAGE });
    const input = {
      slug: 'orders',
      title: 'Orders',
      template: 'page-crud',
      navGroup: 'workspace' as const,
    };
    expect(await createPage(input)).toEqual(PAGE);
    expect(requestOf(fetchMock)).toEqual({ url: '/api/v1/pages', method: 'POST', body: input });
  });

  it('patches a page, carrying the revision the client last read', async () => {
    const fetchMock = stubJson({ data: PAGE });
    await updatePage('page_orders', { title: 'All orders', expectedRevision: 4 });
    expect(requestOf(fetchMock)).toEqual({
      url: '/api/v1/pages/page_orders',
      method: 'PATCH',
      body: { title: 'All orders', expectedRevision: 4 },
    });
  });

  it('duplicates under the source page id', async () => {
    const fetchMock = stubJson({ data: PAGE });
    await duplicatePage('page_orders', { slug: 'orders-copy', title: 'Orders copy' });
    expect(requestOf(fetchMock)).toEqual({
      url: '/api/v1/pages/page_orders/duplicate',
      method: 'POST',
      body: { slug: 'orders-copy', title: 'Orders copy' },
    });
  });

  it('deletes by id', async () => {
    const fetchMock = stubJson({ data: { ok: true } });
    await deletePage('page_orders');
    expect(requestOf(fetchMock)).toMatchObject({ url: '/api/v1/pages/page_orders', method: 'DELETE' });
  });

  it('percent-encodes an id that would otherwise reshape the path', async () => {
    const fetchMock = stubJson({ data: PAGE });
    await updatePage('page a/b', { title: 'x' });
    expect(requestOf(fetchMock).url).toBe('/api/v1/pages/page%20a%2Fb');
  });

  it('reports how many rows the nav reorder moved', async () => {
    const fetchMock = stubJson({ data: { moved: 3 } });
    const items = [{ pageId: 'page_orders', navGroup: 'library' as const }];
    expect(await saveNavOrder(items)).toBe(3);
    expect(requestOf(fetchMock)).toEqual({
      url: '/api/v1/pages/nav-order',
      method: 'PUT',
      body: { items },
    });
  });
});

describe('savePageConfig', () => {
  it('sends the config alone when the caller is not doing a concurrency check', async () => {
    const fetchMock = stubJson({ data: PAGE });
    await savePageConfig('page_orders', { layout: { version: 1, items: [] } });
    expect(requestOf(fetchMock)).toEqual({
      url: '/api/v1/pages/page_orders/config',
      method: 'PATCH',
      body: { config: { layout: { version: 1, items: [] } } },
    });
  });

  it('adds expectedRevision when one is supplied — including revision 0', async () => {
    const fetchMock = stubJson({ data: PAGE });
    // 0 is a real revision. A truthiness check here would silently drop the
    // concurrency guard on a page nobody has edited yet.
    await savePageConfig('page_orders', { layout: {} }, 0);
    expect(requestOf(fetchMock).body).toEqual({ config: { layout: {} }, expectedRevision: 0 });
  });
});

describe('invalidatePages', () => {
  it('drops the pages list, the bootstrap nav tree and the rendered documents', async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue(undefined);
    await invalidatePages(client);
    expect(invalidate.mock.calls.map((call) => call[0]?.queryKey)).toEqual([
      PAGES_QUERY_KEY,
      ['bootstrap'],
      ['page'],
    ]);
  });
});
