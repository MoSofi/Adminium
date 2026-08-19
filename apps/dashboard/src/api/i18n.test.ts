// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/api/v1/i18n` client (23-runtime-translations.md §6.1). Everything here is a
 * URL, and every one of them addresses a row identified by a locale id and a
 * dotted key — values that go in a query string or a path segment and must be
 * encoded to get there intact.
 *
 * The one behavioural rule worth stating: resetting a key is a DELETE, not a
 * write of `''`. An override of the empty string is a legitimate translation
 * ("show nothing here"); a reset means "fall back to the built-in". Sending the
 * wrong one leaves the UI blank instead of restoring English.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse } from '../test/fixtures.js';
import {
  createLocale,
  deleteLocale,
  fetchFormatErrors,
  fetchKeys,
  patchLocale,
  putKey,
  putKeysBulk,
  resetKey,
} from './i18n.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(body: unknown = { ok: true, version: 1 }) {
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

describe('fetchKeys', () => {
  it('sends only the locale when no filter is applied', async () => {
    const fetchMock = stubFetch({ items: [], total: 0, groups: [], version: 1 });
    await fetchKeys({ locale: 'de_DE' });
    expect(callOf(fetchMock).url).toBe('/api/v1/i18n/keys?locale=de_DE');
  });

  it('carries every filter the editor sets', async () => {
    const fetchMock = stubFetch({ items: [], total: 0, groups: [], version: 1 });
    await fetchKeys({
      locale: 'de_DE',
      namespace: 'common',
      group: 'nav',
      q: 'orders',
      state: 'stale',
      offset: 50,
      limit: 25,
    });
    const params = new URL(callOf(fetchMock).url, 'http://x').searchParams;
    expect(Object.fromEntries(params)).toEqual({
      locale: 'de_DE',
      namespace: 'common',
      group: 'nav',
      q: 'orders',
      state: 'stale',
      offset: '50',
      limit: '25',
    });
  });

  it('drops an empty search term rather than filtering on nothing', async () => {
    const fetchMock = stubFetch({ items: [], total: 0, groups: [], version: 1 });
    await fetchKeys({ locale: 'de_DE', q: '' });
    expect(callOf(fetchMock).url).toBe('/api/v1/i18n/keys?locale=de_DE');
  });

  it('sends offset 0 — a falsy page number is still a page', async () => {
    const fetchMock = stubFetch({ items: [], total: 0, groups: [], version: 1 });
    await fetchKeys({ locale: 'de_DE', offset: 0 });
    expect(new URL(callOf(fetchMock).url, 'http://x').searchParams.get('offset')).toBe('0');
  });
});

describe('the key writes', () => {
  it('puts an override as a body, not as a query', async () => {
    const fetchMock = stubFetch();
    await putKey({ locale: 'de_DE', namespace: 'common', key: 'nav.orders', value: 'Bestellungen' });
    expect(callOf(fetchMock)).toEqual({
      url: '/api/v1/i18n/keys',
      method: 'PUT',
      body: { locale: 'de_DE', namespace: 'common', key: 'nav.orders', value: 'Bestellungen' },
    });
  });

  it('resets a key with a DELETE, never a write of the empty string', async () => {
    const fetchMock = stubFetch();
    await resetKey({ locale: 'de_DE', namespace: 'common', key: 'nav.orders' });
    const call = callOf(fetchMock);
    expect(call.method).toBe('DELETE');
    expect(call.body).toBeUndefined();
    expect(Object.fromEntries(new URL(call.url, 'http://x').searchParams)).toEqual({
      locale: 'de_DE',
      namespace: 'common',
      key: 'nav.orders',
    });
  });

  it('sends a bulk write as one items array', async () => {
    const fetchMock = stubFetch({ ok: true, version: 2, written: 2, rejected: [] });
    const items = [
      { locale: 'de_DE', namespace: 'common' as const, key: 'a', value: 'A' },
      { locale: 'de_DE', namespace: 'common' as const, key: 'b', value: 'B' },
    ];
    expect((await putKeysBulk(items)).written).toBe(2);
    expect(callOf(fetchMock)).toEqual({ url: '/api/v1/i18n/keys/bulk', method: 'POST', body: { items } });
  });
});

describe('the locale writes', () => {
  it('creates a locale from the full form body', async () => {
    const fetchMock = stubFetch({ ok: true, version: 3, locale: null });
    const input = {
      locale: 'sv_SE',
      english: 'Swedish',
      native: 'Svenska',
      dir: 'ltr' as const,
      fontHint: 'latin' as const,
      intlTag: 'sv-SE',
      copyFrom: 'en_US',
    };
    await createLocale(input);
    expect(callOf(fetchMock)).toEqual({ url: '/api/v1/i18n/locales', method: 'POST', body: input });
  });

  it('patches one locale by id', async () => {
    const fetchMock = stubFetch({ ok: true, version: 4, locale: null });
    await patchLocale('zh_CN', { enabled: false });
    expect(callOf(fetchMock)).toEqual({
      url: '/api/v1/i18n/locales/zh_CN',
      method: 'PATCH',
      body: { enabled: false },
    });
  });

  it('defaults a delete to reassigning affected users to `inherit`', async () => {
    // Never left blank: the users on a deleted locale have to land somewhere,
    // and the workspace default is the only answer that always exists.
    const fetchMock = stubFetch({
      ok: true,
      version: 5,
      reassignedUsers: 2,
      deletedOverrides: 40,
      deletedEmailTemplates: 1,
      workspaceDefaultReset: false,
    });
    expect((await deleteLocale('sv_SE')).reassignedUsers).toBe(2);
    expect(callOf(fetchMock)).toMatchObject({
      url: '/api/v1/i18n/locales/sv_SE?reassignTo=inherit',
      method: 'DELETE',
    });
  });

  it('carries an explicit reassignment target', async () => {
    const fetchMock = stubFetch({ ok: true, version: 5, reassignedUsers: 0 });
    await deleteLocale('sv_SE', 'en_US');
    expect(callOf(fetchMock).url).toBe('/api/v1/i18n/locales/sv_SE?reassignTo=en_US');
  });

  it('encodes an id that would otherwise reshape the path', async () => {
    const fetchMock = stubFetch({ ok: true, version: 5, reassignedUsers: 0 });
    await deleteLocale('sv/SE', 'en US');
    expect(callOf(fetchMock).url).toBe('/api/v1/i18n/locales/sv%2FSE?reassignTo=en%20US');
  });
});

describe('fetchFormatErrors', () => {
  it('reads the ICU failure log', async () => {
    const fetchMock = stubFetch({ items: [{ key: 'nav.count', lng: 'de', message: 'bad', at: 1, count: 3 }] });
    expect((await fetchFormatErrors()).items).toHaveLength(1);
    expect(callOf(fetchMock)).toMatchObject({ url: '/api/v1/i18n/format-errors', method: 'GET' });
  });
});
