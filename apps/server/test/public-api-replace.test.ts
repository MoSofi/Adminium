// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `PUT /public/records/:ref/:id` — replace the writable set, on SQLite,
 * Postgres and MySQL.
 *
 * PUT is PATCH with a complete body: the same statement, the same predicate
 * in its own WHERE. So the two claims are that an incomplete body is refused
 * before anything runs, and that a row outside the scope is untouched.
 */

import { auditRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { PUBLIC_ORIGIN, SOURCE_LEGS, type ServedSource, type SourceSpec } from './public-source-dialects.js';

const SPEC: SourceSpec = {
  ddl: {
    sqlite: ['CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, owner VARCHAR(20) NOT NULL, title VARCHAR(40), body VARCHAR(100))'],
    postgres: ['CREATE TABLE notes (id serial PRIMARY KEY, owner varchar(20) NOT NULL, title varchar(40), body varchar(100))'],
    mysql: ['CREATE TABLE notes (id INT AUTO_INCREMENT PRIMARY KEY, owner VARCHAR(20) NOT NULL, title VARCHAR(40), body VARCHAR(100))'],
  },
  seed: [
    "INSERT INTO notes (owner, title, body) VALUES ('alice', 't1', 'a1')",
    "INSERT INTO notes (owner, title, body) VALUES ('bob', 't2', 'b1')",
  ],
};

let served: ServedSource | null = null;
afterEach(async () => {
  await served?.close();
  served = null;
});

async function setUp(s: ServedSource): Promise<string> {
  const list = await s.app.inject({ method: 'GET', url: `/api/v1/public-endpoints?connectionId=${s.connectionId}`, headers: { cookie: s.cookie } });
  const source = (list.json() as { sources: { id: string }[] }).sources.find((x) => x.id.endsWith('notes'))?.id ?? '';
  const save = await s.app.inject({
    method: 'PUT',
    url: `/api/v1/public-endpoints/${s.connectionId}/notes`,
    headers: { cookie: s.cookie },
    payload: {
      definition: JSON.stringify({
        path: '/notes',
        source,
        methods: ['GET', 'PUT'],
        select: ['id', 'owner', 'title', 'body'],
        filters: [{ column: 'owner', op: 'eq', value: 'alice' }],
        pagination: { default_limit: 20, max_limit: 200, order: 'id.desc' },
        auth: { role: 'anon' },
        rate_limit: { requests: 120, window: '1m' },
        response: { shape: 'object', envelope: 'data' },
      }),
    },
  });
  expect(save.statusCode, save.body).toBe(200);
  const key = await s.app.inject({
    method: 'POST',
    url: '/api/v1/public-keys',
    headers: { cookie: s.cookie },
    payload: { name: 'Site', connectionId: s.connectionId, access: [{ ref: 'notes', methods: ['GET', 'PUT'] }] },
  });
  expect(key.statusCode, key.body).toBe(201);
  return (key.json() as { token: string }).token;
}

const put = (s: ServedSource, token: string, id: number, values: Record<string, unknown>) =>
  s.app.inject({
    method: 'PUT',
    url: `/api/v1/public/records/notes/${String(id)}`,
    headers: { authorization: `Bearer ${token}`, origin: PUBLIC_ORIGIN },
    payload: { values },
  });

for (const leg of SOURCE_LEGS) {
  describe.skipIf(!leg.available)(`public PUT [${leg.dialect}]`, () => {
    it('replaces with a complete body, refuses an incomplete one, and never touches a row outside the scope', async () => {
      served = await leg.serve(SPEC);
      const s = served;
      const token = await setUp(s);

      // The writable set is title + body: the key and the filtered owner are not the caller's.
      const partial = await put(s, token, 1, { body: 'x' });
      expect(partial.statusCode).toBe(400);
      expect((partial.json() as { error: { code: string } }).error.code).toBe('PUBLIC_WRITE_REFUSED');
      expect(await s.query('SELECT title, body FROM notes WHERE id = 1')).toEqual([{ title: 't1', body: 'a1' }]);

      const owner = await put(s, token, 1, { title: 'n', body: 'n', owner: 'bob' });
      expect(owner.statusCode).toBe(400);

      const outside = await put(s, token, 2, { title: 'hijack', body: null });
      expect(outside.statusCode).toBe(404);
      expect(await s.query('SELECT title, body FROM notes WHERE id = 2')).toEqual([{ title: 't2', body: 'b1' }]);

      const ok = await put(s, token, 1, { title: 'new', body: null });
      expect(ok.statusCode, ok.body).toBe(200);
      expect((ok.json() as { data: Record<string, unknown> }).data).toMatchObject({ id: 1, title: 'new', body: null, owner: 'alice' });

      const rows = (await auditRepo(s.meta).list({ category: 'data', limit: 10 })).filter((r) => r.action === 'public.record.update');
      expect(JSON.stringify(rows[0]?.changes)).toContain('"replace":true');
    }, 90_000);
  });
}
