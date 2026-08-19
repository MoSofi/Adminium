// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The two desktop-only setup endpoints (11-electron.md §6 step 2).
 *
 * `createLocalDatabase` builds its body by OMISSION — `schemaFile` is absent
 * for a blank database, `format: 'auto'` is absent because "auto" is the
 * server's own default and sending the word would ask the emitter for a format
 * called `auto`. Each omission is a branch, and each one is the difference
 * between a blank database and a 422.
 *
 * `demoConflictConnectionId` reads an id out of an `unknown` — the 409 details
 * blob — so the wizard can route to the demo that already exists instead of
 * offering a retry that can never succeed. A wizard that navigated to
 * `undefined` would be worse than one that showed the error, hence the
 * narrowing, hence these tests.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse } from '../../test/fixtures.js';
import { createDemoDatabase, createLocalDatabase, demoConflictConnectionId } from './setupApi.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse(status, body));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function bodyOf(fetchMock: ReturnType<typeof vi.fn>): unknown {
  return JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
}

const LOCAL = {
  connectionId: 'conn_1',
  name: 'Orders',
  slug: 'orders',
  file: '/data/databases/orders.sqlite',
  tables: ['orders'],
  rows: { orders: 12 },
  warnings: [],
};

describe('createLocalDatabase', () => {
  it('sends only the name and the placeholder flag for a blank database', async () => {
    const fetchMock = stubFetch(200, { data: LOCAL });
    expect(await createLocalDatabase({ name: 'Orders', placeholderRows: false })).toEqual(LOCAL);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/v1/desktop/local-database');
    expect(bodyOf(fetchMock)).toEqual({ name: 'Orders', placeholderRows: false });
  });

  it('carries a schema file with its format and filename', async () => {
    const fetchMock = stubFetch(200, { data: LOCAL });
    await createLocalDatabase({
      name: 'Orders',
      schemaFile: { content: 'CREATE TABLE orders (id INT);', format: 'sql', fileName: 'orders.sql' },
      placeholderRows: true,
    });
    expect(bodyOf(fetchMock)).toEqual({
      name: 'Orders',
      schemaFile: { content: 'CREATE TABLE orders (id INT);', format: 'sql', fileName: 'orders.sql' },
      placeholderRows: true,
    });
  });

  it('omits `format` when the user left the picker on auto-detect', async () => {
    // "auto" is the server's own default; forwarding the word would ask the
    // emitter for a format by that name.
    const fetchMock = stubFetch(200, { data: LOCAL });
    await createLocalDatabase({
      name: 'Orders',
      schemaFile: { content: 'x', format: 'auto' },
      placeholderRows: false,
    });
    expect(bodyOf(fetchMock)).toEqual({
      name: 'Orders',
      schemaFile: { content: 'x' },
      placeholderRows: false,
    });
  });

  it('omits `format` and `fileName` when neither was supplied', async () => {
    const fetchMock = stubFetch(200, { data: LOCAL });
    await createLocalDatabase({ name: 'Orders', schemaFile: { content: 'x' }, placeholderRows: false });
    expect(bodyOf(fetchMock)).toEqual({
      name: 'Orders',
      schemaFile: { content: 'x' },
      placeholderRows: false,
    });
  });
});

describe('createDemoDatabase', () => {
  it('posts an empty body when the card offers no name', async () => {
    const fetchMock = stubFetch(200, { data: { connectionId: 'conn_2', seeded: true } });
    await createDemoDatabase();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/v1/desktop/demo-database');
    expect(bodyOf(fetchMock)).toEqual({});
  });

  it('carries a name when one was typed, and unwraps the reply', async () => {
    const fetchMock = stubFetch(200, {
      data: { connectionId: 'conn_2', name: 'Demo', file: '/data/demo.sqlite', seeded: false, rows: {} },
    });
    const result = await createDemoDatabase('Demo');
    expect(bodyOf(fetchMock)).toEqual({ name: 'Demo' });
    // `seeded: false` ⇒ the call adopted a demo.sqlite already on disk.
    expect(result.seeded).toBe(false);
    expect(result.connectionId).toBe('conn_2');
  });
});

describe('demoConflictConnectionId', () => {
  it('names the demo the 409 pointed at', () => {
    expect(demoConflictConnectionId({ connectionId: 'conn_2' })).toBe('conn_2');
  });

  it('is null for anything that is not that failure', () => {
    expect(demoConflictConnectionId(undefined)).toBeNull();
    expect(demoConflictConnectionId(null)).toBeNull();
    expect(demoConflictConnectionId('conn_2')).toBeNull();
    expect(demoConflictConnectionId({})).toBeNull();
  });

  it('refuses an id that is present but unusable, rather than routing to it', () => {
    expect(demoConflictConnectionId({ connectionId: '' })).toBeNull();
    expect(demoConflictConnectionId({ connectionId: 42 })).toBeNull();
  });
});
