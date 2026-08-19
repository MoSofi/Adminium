// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Command-palette search client (08-server-api.md §2.9). The query string is
 * the whole contract here: the palette sends `types`/`limit`/`connectionId`
 * only when it means them, because the server's defaults are different from
 * "empty" — an empty `types=` would ask for no result types at all, and a
 * missing `limit` is what lets the server pick its own.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse } from '../test/fixtures.js';
import { PALETTE_SEARCH_LIMIT, recordHits, search, type SearchGroup } from './search.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubSearch(groups: SearchGroup[] = []) {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { groups } }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** The `?…` half of the URL the client asked for. */
function queryOf(fetchMock: ReturnType<typeof vi.fn>): URLSearchParams {
  return new URL(String(fetchMock.mock.calls[0]?.[0]), 'http://localhost').searchParams;
}

describe('search', () => {
  it('sends only the term when no options are given', async () => {
    const fetchMock = stubSearch();
    await search('ava');
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/v1/search?q=ava');
  });

  it('percent-encodes a term the palette would otherwise break the URL with', async () => {
    const fetchMock = stubSearch();
    await search('a&b c=d');
    expect(queryOf(fetchMock).get('q')).toBe('a&b c=d');
  });

  it('carries limit, types and connectionId when the caller sets them', async () => {
    const fetchMock = stubSearch();
    await search('ava', { limit: PALETTE_SEARCH_LIMIT, types: ['page', 'record'], connectionId: 'conn_1' });
    const params = queryOf(fetchMock);
    expect(params.get('limit')).toBe('3');
    expect(params.get('types')).toBe('page,record');
    expect(params.get('connectionId')).toBe('conn_1');
  });

  it('omits `types` entirely when the list is empty, rather than asking for none', async () => {
    const fetchMock = stubSearch();
    await search('ava', { types: [] });
    expect(queryOf(fetchMock).has('types')).toBe(false);
  });

  it('unwraps the groups out of the §1.4 envelope', async () => {
    const groups: SearchGroup[] = [{ type: 'page', hits: [{ pageId: 'page_orders' }] } as SearchGroup];
    stubSearch(groups);
    expect(await search('orders')).toEqual(groups);
  });
});

describe('recordHits', () => {
  it('flattens every record group and drops the page groups', () => {
    const groups = [
      { type: 'page', hits: [{ pageId: 'page_orders' }] },
      { type: 'record', hits: [{ id: '1' }, { id: '2' }] },
      { type: 'record', hits: [{ id: '3' }] },
    ] as unknown as SearchGroup[];
    expect(recordHits(groups).map((hit) => (hit as unknown as { id: string }).id)).toEqual(['1', '2', '3']);
  });

  it('is empty when nothing matched a record', () => {
    expect(recordHits([])).toEqual([]);
    expect(recordHits([{ type: 'page', hits: [] } as unknown as SearchGroup])).toEqual([]);
  });
});
