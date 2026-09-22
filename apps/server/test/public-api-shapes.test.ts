// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A list's response shape. Shapes apply to the list route only: one row by
 * key and every write keep `{ data }`, and errors keep their envelope
 * whatever the shape.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { PUBLIC_ORIGIN, SOURCE_LEGS, type ServedSource, type SourceSpec } from './public-source-dialects.js';

const SPEC: SourceSpec = {
  ddl: {
    sqlite: ['CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, body VARCHAR(100) NOT NULL, data TEXT)'],
    postgres: ['CREATE TABLE notes (id serial PRIMARY KEY, body varchar(100) NOT NULL, data text)'],
    mysql: ['CREATE TABLE notes (id INT AUTO_INCREMENT PRIMARY KEY, body VARCHAR(100) NOT NULL, data TEXT)'],
  },
  seed: ["INSERT INTO notes (body, data) VALUES ('one', 'x')", "INSERT INTO notes (body) VALUES ('two')", "INSERT INTO notes (body) VALUES ('three')"],
};

let served: ServedSource | null = null;
afterEach(async () => {
  await served?.close();
  served = null;
});

async function keyFor(s: ServedSource, response: Record<string, unknown>, extra: Record<string, unknown> = {}): Promise<string> {
  const list = await s.app.inject({ method: 'GET', url: `/api/v1/public-endpoints?connectionId=${s.connectionId}`, headers: { cookie: s.cookie } });
  const def = JSON.parse(
    (list.json() as { endpoints: { ref: string; definition: string }[] }).endpoints.find((e) => e.ref === 'notes')?.definition ?? '{}',
  ) as Record<string, unknown>;
  const save = await s.app.inject({
    method: 'PUT',
    url: `/api/v1/public-endpoints/${s.connectionId}/notes`,
    headers: { cookie: s.cookie },
    payload: { definition: JSON.stringify({ ...def, response, ...extra }) },
  });
  expect(save.statusCode, save.body).toBe(200);
  const key = await s.app.inject({
    method: 'POST',
    url: '/api/v1/public-keys',
    headers: { cookie: s.cookie },
    payload: { name: 'Site', connectionId: s.connectionId, access: [{ ref: 'notes', methods: ['GET'] }] },
  });
  expect(key.statusCode, key.body).toBe(201);
  return (key.json() as { token: string }).token;
}

const get = (s: ServedSource, token: string, url: string) =>
  s.app.inject({ method: 'GET', url: `/api/v1/public/records/${url}`, headers: { authorization: `Bearer ${token}`, origin: PUBLIC_ORIGIN } });

const sqlite = SOURCE_LEGS.find((l) => l.dialect === 'sqlite') as (typeof SOURCE_LEGS)[number];

describe('list response shapes [sqlite]', () => {
  it('wrapped is today’s { data, page, cursor }', async () => {
    served = await sqlite.serve(SPEC);
    const token = await keyFor(served, { shape: 'object', envelope: 'data' });
    const body = (await get(served, token, 'notes')).json() as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(3);
  }, 90_000);

  it('array is the bare rows, the next cursor in an exposed header; one row and errors keep their envelope', async () => {
    served = await sqlite.serve(SPEC);
    const token = await keyFor(served, { shape: 'array' }, { pagination: { default_limit: 2, max_limit: 200, order: 'id.desc' } });
    // An empty `cursor=` starts keyset paging; the next cursor rides a header.
    const first = await get(served, token, 'notes?cursor=');
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toHaveLength(2);
    expect(first.headers['access-control-expose-headers']).toContain('X-Next-Cursor');
    const next = first.headers['x-next-cursor'];
    expect(typeof next).toBe('string');
    const second = await get(served, token, `notes?cursor=${encodeURIComponent(String(next))}`);
    expect((second.json() as { id: number }[]).map((r) => r.id)).toEqual([1]);
    const one = await get(served, token, 'notes/1');
    expect(one.json()).toMatchObject({ data: { id: 1 } });
    const missing = await get(served, token, 'notes/999');
    expect((missing.json() as { error: { code: string } }).error.code).toBe('PUBLIC_REF_NOT_FOUND');
  }, 90_000);

  it('single is exactly one bare row: none is the 404, two is a refusal', async () => {
    served = await sqlite.serve(SPEC);
    const one = await keyFor(served, { shape: 'single' }, { filters: [{ column: 'body', op: 'eq', value: 'one' }] });
    const row = (await get(served, one, 'notes')).json() as Record<string, unknown>;
    // A column named `data` survives: the row is not mistaken for the wrapped shape.
    expect(row).toMatchObject({ id: 1, body: 'one', data: 'x' });
    await served.close();

    served = await sqlite.serve(SPEC);
    const many = await keyFor(served, { shape: 'single' });
    const refused = await get(served, many, 'notes');
    expect(refused.statusCode).toBe(400);
    expect((refused.json() as { error: { code: string } }).error.code).toBe('PUBLIC_QUERY_REFUSED');
    await served.close();

    served = await sqlite.serve(SPEC);
    const none = await keyFor(served, { shape: 'single' }, { filters: [{ column: 'body', op: 'eq', value: 'nope' }] });
    expect((await get(served, none, 'notes')).statusCode).toBe(404);
  }, 120_000);
});
