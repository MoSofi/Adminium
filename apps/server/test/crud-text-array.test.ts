// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A Postgres `text[]` column, end to end (live PG). The page's column facts
 * mark it a list — the form edits it as chips and sends a JSON array — and the
 * data routes store that array as the database's own array and read it back
 * as one. MySQL and SQLite have no array type.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { providerFromModule } from '../src/connections/register-adapters.js';
import { columnFactsFor } from '../src/routes/pages/column-facts.js';
import {
  asUser,
  buildDataTestApp,
  createConnectionViaApi,
  createNorthwindDb,
  introspectViaApi,
  pgAvailable,
  psql,
  type DataTestContext,
  type TestPg,
} from './connections-helpers.js';

const adapterReady = await (async () => {
  try {
    return providerFromModule(await import('@adminium/adapter-postgres')) !== null;
  } catch {
    return false;
  }
})();

describe.skipIf(!(adapterReady && pgAvailable()))('a text[] column (live PG)', () => {
  let pg: TestPg;
  let t: DataTestContext;
  let connId: string;

  beforeAll(async () => {
    pg = createNorthwindDb();
    psql(pg.database, 'CREATE TABLE notes (id serial PRIMARY KEY, title text NOT NULL, tags text[], codes varchar(8)[])');
    t = await buildDataTestApp();
    connId = await createConnectionViaApi(t, pg.dsn);
    await introspectViaApi(t, connId);
    await t.grantTable(t.roles.admin, connId, '*', { read: true, create: true, update: true, delete: true });
  });

  afterAll(async () => {
    await t.app.close();
    pg.drop();
  });

  it('is a list in the column facts', async () => {
    const block = await columnFactsFor(t.meta, connId, 'public.notes');
    const spec = (name: string) => block?.columns.find((column) => column.spec['name'] === name)?.spec;
    expect(spec('tags')).toMatchObject({ logicalType: 'text', list: true });
    expect(spec('codes')).toMatchObject({ list: true });
    expect(spec('title')).not.toHaveProperty('list');
  });

  it('stores a sent array as an array, and reads it back as one', async () => {
    const created = await t.app.inject({
      method: 'POST',
      url: `/api/v1/data/${connId}/public.notes`,
      headers: asUser(t.users.admin),
      payload: { values: { title: 'First', tags: ['red', 'with, comma', 'with "quote"'], codes: ['A1'] } },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = (created.json() as { data: { id: number } }).data.id;
    expect(psql(pg.database, `SELECT array_length(tags, 1), tags[2], tags[3] FROM notes WHERE id = ${id}`).trim()).toBe(
      '3|with, comma|with "quote"',
    );

    const updated = await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/data/${connId}/public.notes/${id}`,
      headers: asUser(t.users.admin),
      payload: { values: { tags: ['blue'] } },
    });
    expect(updated.statusCode, updated.body).toBe(200);

    const read = await t.app.inject({
      method: 'GET',
      url: `/api/v1/data/${connId}/public.notes/${id}`,
      headers: asUser(t.users.admin),
    });
    expect((read.json() as { data: Record<string, unknown> }).data).toMatchObject({ tags: ['blue'], codes: ['A1'] });

    const emptied = await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/data/${connId}/public.notes/${id}`,
      headers: asUser(t.users.admin),
      payload: { values: { tags: [] } },
    });
    expect(emptied.statusCode, emptied.body).toBe(200);
    expect(psql(pg.database, `SELECT cardinality(tags) FROM notes WHERE id = ${id}`).trim()).toBe('0');
  });
});
