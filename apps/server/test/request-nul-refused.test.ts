// SPDX-License-Identifier: AGPL-3.0-only
/**
 * U+0000 in what a request READS with, on SQLite, Postgres and MySQL.
 *
 * Postgres refuses the character in any text it is sent, so an id, a search,
 * a filter's value or a sort carrying one (`%00`) was a 500 from the data API
 * and a 503 from the public API there — and an empty answer on the other two.
 * Now every `/api/` request's path parameters and query string are read for it
 * before any route runs: 400 `VALIDATION_FAILED` naming the parameter for
 * staff, `PUBLIC_QUERY_REFUSED` with the parameter for the public API — the
 * same on every engine, and on Adminium's own store.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { decodeDocumentCursor } from '../src/routes/public/documents.js';
import { PUBLIC_ORIGIN, SOURCE_LEGS, type ServedSource, type SourceSpec } from './public-source-dialects.js';

const SPEC: SourceSpec = {
  ddl: {
    sqlite: ['CREATE TABLE enquiries (id INTEGER PRIMARY KEY AUTOINCREMENT, name VARCHAR(80) NOT NULL, message TEXT)'],
    postgres: ['CREATE TABLE enquiries (id serial PRIMARY KEY, name varchar(80) NOT NULL, message text)'],
    mysql: ['CREATE TABLE enquiries (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(80) NOT NULL, message TEXT)'],
  },
  seed: ["INSERT INTO enquiries (name, message) VALUES ('seed', 'hello')"],
};

interface Refusal {
  error: { code: string; params?: Record<string, unknown>; details?: { in?: string; issues?: { path: string; code: string }[] } };
}

let served: ServedSource | null = null;
afterEach(async () => {
  await served?.close();
  served = null;
});

async function publicKey(s: ServedSource, table: string): Promise<string> {
  const save = await s.app.inject({
    method: 'PUT',
    url: `/api/v1/public-endpoints/${s.connectionId}/enquiries`,
    headers: { cookie: s.cookie },
    payload: {
      definition: JSON.stringify({
        path: '/enquiries',
        source: table,
        methods: ['GET', 'PATCH'],
        select: ['id', 'name', 'message'],
        writable: ['message'],
        filters: [],
        filterable: ['name'],
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
    payload: { name: 'Site', connectionId: s.connectionId, access: [{ ref: 'enquiries', methods: ['GET', 'PATCH'] }] },
  });
  expect(key.statusCode, key.body).toBe(201);
  return (key.json() as { token: string }).token;
}

for (const leg of SOURCE_LEGS) {
  describe.skipIf(!leg.available)(`U+0000 in a request's path or query [${leg.dialect}]`, () => {
    it('is refused, naming the parameter, by the staff API, the public API and Adminium’s own routes — never a 500 or 503', async () => {
      served = await leg.serve(SPEC);
      const s = served;
      const list = await s.app.inject({ method: 'GET', url: `/api/v1/public-endpoints?connectionId=${s.connectionId}`, headers: { cookie: s.cookie } });
      const table = (list.json() as { sources: { id: string }[] }).sources.find((x) => x.id.endsWith('enquiries'))?.id ?? '';
      const token = await publicKey(s, table);
      const staff = (path: string) => s.app.inject({ method: 'GET', url: `/api/v1/data/${s.connectionId}/${table}${path}`, headers: { cookie: s.cookie } });
      const pub = (method: 'GET' | 'PATCH', path: string) =>
        s.app.inject({ method, url: `/api/v1/public/records/enquiries${path}`, headers: { authorization: `Bearer ${token}`, origin: PUBLIC_ORIGIN }, ...(method === 'PATCH' ? { payload: { values: { message: 'x' } } } : {}) });
      const refusedStaff = async (reply: Promise<{ statusCode: number; body: string; json: () => unknown }>, where: string, parameter: string) => {
        const r = await reply;
        expect(r.statusCode, r.body).toBe(400);
        const error = (r.json() as Refusal).error;
        expect(error.code).toBe('VALIDATION_FAILED');
        expect(error.details).toMatchObject({ in: where, issues: [{ path: parameter, code: 'invalid-character' }] });
      };
      const refusedPublic = async (reply: Promise<{ statusCode: number; body: string; json: () => unknown }>, parameter: string) => {
        const r = await reply;
        expect(r.statusCode, r.body).toBe(400);
        expect((r.json() as Refusal).error).toMatchObject({ code: 'PUBLIC_QUERY_REFUSED', params: { parameter } });
      };
      const where = (value: string) => encodeURIComponent(JSON.stringify({ column: 'name', op: 'eq', value }));

      // Staff: an id, a search, a filter's value (escaped in its JSON, or raw), a sort.
      await refusedStaff(staff('/1%00'), 'params', 'recordId');
      await refusedStaff(staff('?q=%00'), 'querystring', 'q');
      await refusedStaff(staff(`?where=${where('a\u0000')}`), 'querystring', 'where');
      await refusedStaff(staff(`?where=${encodeURIComponent('{"column":"name","op":"eq","value":"a')}%00${encodeURIComponent('"}')}`), 'querystring', 'where');
      await refusedStaff(staff('?order=name%00.asc'), 'querystring', 'order');
      // Adminium's own routes, whichever store answers them.
      await refusedStaff(s.app.inject({ method: 'GET', url: `/api/v1/connections/${s.connectionId}%00/schema`, headers: { cookie: s.cookie } }), 'params', 'id');

      // The public API: an id, a change by id, a list filter.
      await refusedPublic(pub('GET', '/1%00'), 'id');
      await refusedPublic(pub('PATCH', '/1%00'), 'id');
      await refusedPublic(pub('GET', '?name=eq.a%00'), 'name');

      // Inside a list's cursor (base64url, so the request never shows it): the list's own "malformed cursor".
      const cursor = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
      const staffCursor = await staff(`?order=name.asc&limit=1&cursor=${cursor({ k: ['a\u0000', 1] })}`);
      expect(staffCursor.statusCode, staffCursor.body).toBe(422);
      expect((staffCursor.json() as Refusal).error.code).toBe('VALIDATION_FAILED');
      const publicCursor = await pub('GET', `?limit=1&cursor=${cursor({ k: ['1\u0000'] })}`);
      expect(publicCursor.statusCode, publicCursor.body).toBe(400);
      expect((publicCursor.json() as Refusal).error.code).toBe('PUBLIC_QUERY_REFUSED');
      expect(decodeDocumentCursor(cursor([1, 'doc_\u0000']))).toBeNull();
      expect(decodeDocumentCursor(cursor([1, 'doc_1']))).toEqual({ createdAt: 1, id: 'doc_1' });

      // What only looks like it is text like any other (written through the API: MySQL reads a backslash in SQL text), and nothing else changed.
      const made = await s.app.inject({ method: 'POST', url: `/api/v1/data/${s.connectionId}/${table}`, headers: { cookie: s.cookie }, payload: { values: { name: 'type \\u0000', message: 'literal' } } });
      expect(made.statusCode, made.body).toBe(201);
      const literal = await staff(`?where=${where('type \\u0000')}`);
      expect(literal.statusCode, literal.body).toBe(200);
      expect((literal.json() as { data: { name: string }[] }).data.map((r) => r.name)).toEqual(['type \\u0000']);
      expect((await staff('?q=seed')).statusCode).toBe(200);
      expect((await staff('/1')).statusCode).toBe(200);
      expect((await pub('GET', '/1')).statusCode).toBe(200);
      expect((await pub('GET', '?name=eq.seed')).statusCode).toBe(200);
      expect(await s.query('SELECT message FROM enquiries WHERE id = 1')).toEqual([{ message: 'hello' }]);
    }, 120_000);
  });
}
