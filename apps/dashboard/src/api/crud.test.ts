// SPDX-License-Identifier: AGPL-3.0-only
/**
 * CrudApi client ↔ `/api/v1/data/:connectionId/:table`
 * (apps/server/src/routes/data): URL/param serialization, reply mapping, and
 * a list → create → undo round-trip against a mocked in-memory server.
 */
import { isDeletePreview } from '@adminium/widgets';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse } from '../test/fixtures.js';
import { createCrudApi, crudListQuery } from './crud.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function captureFetch(reply: (url: string, init?: RequestInit) => Response) {
  const fetchMock = vi.fn().mockImplementation((input: unknown, init?: RequestInit) =>
    Promise.resolve(reply(String(input), init)),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const crud = createCrudApi('conn_1', 'public.customers');

describe('createCrudApi serialization', () => {
  it('serializes list params: q, order, where JSON, cursor, count', async () => {
    const fetchMock = captureFetch(() => jsonResponse(200, { data: [] }));
    await crud.list({
      q: 'ava',
      order: [{ column: 'name', dir: 'asc' }, { column: 'id', dir: 'desc' }],
      where: { and: [{ column: 'status', op: 'eq', value: 'active' }] },
      limit: 50,
      cursor: '',
      count: 'exact',
    });
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]), 'http://localhost');
    expect(url.pathname).toBe('/api/v1/data/conn_1/public.customers');
    expect(url.searchParams.get('q')).toBe('ava');
    expect(url.searchParams.get('order')).toBe('name.asc,id.desc');
    expect(url.searchParams.get('limit')).toBe('50');
    expect(url.searchParams.get('cursor')).toBe('');
    expect(url.searchParams.get('count')).toBe('exact');
    expect(JSON.parse(url.searchParams.get('where') ?? '')).toEqual({
      and: [{ column: 'status', op: 'eq', value: 'active' }],
    });
  });

  it('FK lookup hits the referenced table’s list endpoint with q= (09 §7.1)', async () => {
    const fetchMock = captureFetch(() =>
      jsonResponse(200, { data: [{ id: 7, name: 'Ava Reyes' }] }),
    );
    const options = await crud.lookup?.({ table: 'public.team_members', column: 'id' }, 'ava');
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]), 'http://localhost');
    expect(url.pathname).toBe('/api/v1/data/conn_1/public.team_members');
    expect(url.searchParams.get('q')).toBe('ava');
    expect(url.searchParams.get('limit')).toBe('20');
    expect(options).toEqual([{ value: '7', label: 'Ava Reyes' }]);
  });

  it('lists related records for detail tabs via a where filter', async () => {
    const fetchMock = captureFetch(() => jsonResponse(200, { data: [{ id: 4 }] }));
    const rows = await crud.listRelated?.({ table: 'public.orders', column: 'customer_id', value: 5 });
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]), 'http://localhost');
    expect(url.pathname).toBe('/api/v1/data/conn_1/public.orders');
    expect(JSON.parse(url.searchParams.get('where') ?? '')).toEqual({
      column: 'customer_id',
      op: 'eq',
      value: 5,
    });
    expect(rows).toEqual([{ id: 4 }]);
  });

  it('returns the delete cascade preview (dry run) untouched', async () => {
    captureFetch((url) => {
      expect(url).toContain('/5?dryRun=true');
      return jsonResponse(200, {
        references: [{ relationId: 'r1', table: 'public.orders', column: 'customer_id', count: 3 }],
        requiresConfirm: true,
      });
    });
    const result = await crud.remove('5', { dryRun: true });
    expect(isDeletePreview(result)).toBe(true);
    if (!isDeletePreview(result)) return;
    expect(result.requiresConfirm).toBe(true);
    expect(result.references[0]?.count).toBe(3);
  });

  it('fetches inbound reference counts for the cascade modal', async () => {
    const fetchMock = captureFetch(() => jsonResponse(200, { references: [] }));
    await crud.references('5');
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      '/api/v1/data/conn_1/public.customers/5/references',
    );
  });
});

describe('list → create → undo round-trip (mocked server)', () => {
  it('creates with { values }, returns the undo token, and undo restores the list', async () => {
    let rows: Array<Record<string, unknown>> = [{ id: 1, name: 'Northwind' }];
    const fetchMock = captureFetch((url, init) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET') return jsonResponse(200, { data: rows });
      if (method === 'POST' && url === '/api/v1/data/conn_1/public.customers') {
        const body = JSON.parse(String(init?.body)) as { values: Record<string, unknown> };
        const inserted = { id: 2, ...body.values };
        rows = [...rows, inserted];
        return jsonResponse(201, { data: inserted, undoToken: 'tok_undo_1' });
      }
      if (method === 'POST' && url === '/api/v1/data/undo/tok_undo_1') {
        rows = rows.filter((row) => row['id'] !== 2);
        return jsonResponse(200, { restoredIds: [2] });
      }
      return jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope', requestId: 'req_x' } });
    });

    expect((await crud.list({})).data).toHaveLength(1);

    const created = await crud.create({ name: 'Acme' });
    expect(created.data).toEqual({ id: 2, name: 'Acme' });
    expect(created.undoToken).toBe('tok_undo_1');
    expect((await crud.list({})).data).toHaveLength(2);

    const undone = await crud.undo('tok_undo_1');
    expect(undone.restoredIds).toEqual([2]);
    expect((await crud.list({})).data).toHaveLength(1);

    // Body shape sanity: create sent `{ values }` per recordCreateBody.
    const createCall = fetchMock.mock.calls.find(
      (call) => (call[1] as RequestInit | undefined)?.method === 'POST' && !String(call[0]).includes('undo'),
    );
    expect(JSON.parse(String((createCall?.[1] as RequestInit).body))).toEqual({
      values: { name: 'Acme' },
    });
  });
});

describe('crudListQuery cache discipline (09 §4)', () => {
  it('keys on [data, conn, table, params] with staleTime 0 + keepPreviousData', () => {
    const options = crudListQuery(crud, { q: 'a', limit: 25 });
    expect(options.queryKey).toEqual(['data', 'conn_1', 'public.customers', { q: 'a', limit: 25 }]);
    expect(options.staleTime).toBe(0);
    expect(options.placeholderData).toBeTypeOf('function'); // keepPreviousData
  });
});
