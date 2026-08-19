// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Saved-views client (M5-T06). Every call is nested under a page id and half of
 * them under a view id too, so the whole contract is: the right verb, the right
 * two path segments (both encoded), and the `{ data: … }` unwrap that matches
 * what `routes/views/schema.ts` wraps.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse } from '../../test/fixtures.js';
import { viewsApi, type SavedView, type ViewConfig } from './viewsApi.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const CONFIG: ViewConfig = { v: 1, search: 'ava', pageSize: 50 };

const VIEW: SavedView = {
  id: 'view_1',
  pageId: 'page_orders',
  userId: null,
  name: 'Open orders',
  config: CONFIG,
  isDefault: false,
  createdAt: 1,
  updatedAt: 1,
};

function stubFetch(body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, body));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function callOf(fetchMock: ReturnType<typeof vi.fn>) {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
  return {
    url: String(url),
    method: init?.method ?? 'GET',
    body: init?.body === undefined ? undefined : (JSON.parse(String(init.body)) as unknown),
  };
}

describe('viewsApi', () => {
  it('lists the views of one page, unwrapping `data.views`', async () => {
    const fetchMock = stubFetch({ data: { views: [VIEW] } });
    expect(await viewsApi.list('page_orders')).toEqual([VIEW]);
    expect(callOf(fetchMock)).toMatchObject({
      url: '/api/v1/pages/page_orders/views',
      method: 'GET',
    });
  });

  it('creates a view from the name + config the toolbar captured', async () => {
    const fetchMock = stubFetch({ data: VIEW });
    expect(await viewsApi.create('page_orders', { name: 'Open orders', config: CONFIG })).toEqual(VIEW);
    expect(callOf(fetchMock)).toEqual({
      url: '/api/v1/pages/page_orders/views',
      method: 'POST',
      body: { name: 'Open orders', config: CONFIG },
    });
  });

  it('patches one view under both ids', async () => {
    const fetchMock = stubFetch({ data: { ...VIEW, isDefault: true } });
    expect((await viewsApi.update('page_orders', 'view_1', { isDefault: true })).isDefault).toBe(true);
    expect(callOf(fetchMock)).toEqual({
      url: '/api/v1/pages/page_orders/views/view_1',
      method: 'PATCH',
      body: { isDefault: true },
    });
  });

  it('deletes one view', async () => {
    const fetchMock = stubFetch({ data: { ok: true } });
    await viewsApi.remove('page_orders', 'view_1');
    expect(callOf(fetchMock)).toMatchObject({
      url: '/api/v1/pages/page_orders/views/view_1',
      method: 'DELETE',
    });
  });

  it('encodes both ids so neither can reshape the path', async () => {
    const fetchMock = stubFetch({ data: VIEW });
    await viewsApi.update('page a/b', 'view c/d', { name: 'x' });
    expect(callOf(fetchMock).url).toBe('/api/v1/pages/page%20a%2Fb/views/view%20c%2Fd');
  });
});
