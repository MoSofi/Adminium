// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Bootstrap consumption: query fn parses the `{ data }` envelope, nav
 * helpers drive `/` redirect + slug resolution, and auth failures surface as
 * ApiError (never retried).
 */
import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse, makeBootstrap } from '../test/fixtures.js';
import { ApiError } from './api.js';
import {
  appPagesOf,
  bootstrapQuery,
  defaultPageSlug,
  findNavItemBySlug,
  findPageBySlug,
  flattenNav,
  hostedAppByKey,
  slugForTable,
} from './bootstrap.js';

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

  it('findPageBySlug and slugForTable consult hidden pages; listing helpers do not (30 follow-up)', () => {
    const bootstrap = makeBootstrap({
      hiddenPages: [
        {
          pageId: 'page_items',
          slug: 'invoice-items',
          labelKey: 'nav.invoice-items',
          fallback: 'Invoice Items',
          icon: 'table',
          order: 3,
          connectionId: 'conn_1',
          sourceTable: 'public.invoice_items',
        },
      ],
    });
    // Resolution: hidden pages answer their slug and their table.
    expect(findPageBySlug(bootstrap, 'invoice-items')?.pageId).toBe('page_items');
    expect(slugForTable(bootstrap, 'conn_1', 'public.invoice_items')).toBe('invoice-items');
    expect(slugForTable(bootstrap, 'conn_2', 'public.invoice_items')).toBeNull();
    // Nav items keep precedence and keep resolving through the same door.
    expect(findPageBySlug(bootstrap, 'orders')?.pageId).toBe('page_orders');
    // Listing: the sidebar/palette surface must NOT gain the hidden page —
    // offering it in the rail would un-hide it.
    expect(flattenNav(bootstrap.nav).some((item) => item.slug === 'invoice-items')).toBe(false);
    expect(findNavItemBySlug(bootstrap.nav, 'invoice-items')).toBeNull();
    // A bootstrap predating the field (older fixture) still works.
    expect(findPageBySlug(makeBootstrap(), 'invoice-items')).toBeNull();
  });

  /**
   * A PAUSED page (meta wave 0019) is stricter than a hidden one: hidden means
   * "not in the rail", paused means "not offered by anything". The two lists
   * are separate precisely so `slugForTable` — which related-tab cross-links
   * call — can keep reading hidden pages while never reaching a paused one.
   */
  it('paused pages answer a URL and nothing else', () => {
    const bootstrap = makeBootstrap({
      pausedPages: [
        {
          pageId: 'page_clients',
          slug: 'clients',
          labelKey: 'nav.clients',
          fallback: 'Clients',
          icon: 'users',
          order: 1,
          connectionId: 'conn_paused',
          sourceTable: 'public.clients',
        },
      ],
    });
    // The one caller: somebody who already holds the URL. Landing on the
    // `connection-paused` state beats a 404 that explains nothing.
    expect(findPageBySlug(bootstrap, 'clients')?.pageId).toBe('page_clients');
    // Everything that OFFERS a page must miss it — the rail, the palette, and
    // the related-tab cross-link resolver.
    expect(findNavItemBySlug(bootstrap.nav, 'clients')).toBeNull();
    expect(flattenNav(bootstrap.nav).some((item) => item.slug === 'clients')).toBe(false);
    expect(slugForTable(bootstrap, 'conn_paused', 'public.clients')).toBeNull();
    // A bootstrap predating the field still works.
    expect(findPageBySlug(makeBootstrap(), 'clients')).toBeNull();
  });

  it('resolves an installed app’s pages, which live in its own section', () => {
    const menu = {
      pageId: 'page_menu',
      slug: 'pos-menu',
      labelKey: 'nav.pos-menu',
      fallback: 'Menu',
      icon: 'book-open',
      order: 1,
      connectionId: 'conn_1',
      sourceTable: 'public.pos_menu_items',
      appKey: 'pos',
    };
    const bootstrap = makeBootstrap({
      appSections: [{ appKey: 'pos', label: 'Point of Sale', version: '0.2.0', groups: [{ key: 'manage', label: 'Manage', items: [menu] }], staff: null }],
    });
    expect(appPagesOf(bootstrap).map((item) => item.slug)).toEqual(['pos-menu']);
    expect(findPageBySlug(bootstrap, 'pos-menu')?.pageId).toBe('page_menu');
    expect(slugForTable(bootstrap, 'conn_1', 'public.pos_menu_items')).toBe('pos-menu');
    // An instance whose only pages are an app's opens on the app's first.
    expect(defaultPageSlug({ groups: [] }, appPagesOf(bootstrap))).toBe('pos-menu');
    expect(defaultPageSlug(bootstrap.nav, appPagesOf(bootstrap))).toBe('customers');
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

describe('hostedAppByKey', () => {
  const item = { id: 'home', path: '', label: 'Home' };
  const bootstrap = makeBootstrap({
    hostedApps: [
      { appKey: 'clients', label: 'Outline', items: [item] },
      { appKey: 'clients', instance: 'berlin', label: 'Outline · berlin', items: [item] },
    ],
  });

  it("resolves the app's own section and each instance by the sidebar's route param", () => {
    expect(hostedAppByKey(bootstrap, 'clients')?.label).toBe('Outline');
    // It compared the whole `clients~berlin` against `clients`, so every instance link was a 404.
    expect(hostedAppByKey(bootstrap, 'clients~berlin')?.label).toBe('Outline · berlin');
    expect(hostedAppByKey(bootstrap, 'clients~paris')).toBeNull();
    expect(hostedAppByKey(bootstrap, 'hotel')).toBeNull();
  });
});
