// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `DELETE /public/records/:ref/:id` on SQLite, Postgres and MySQL.
 *
 * Everything here goes through the model end to end: an endpoint is
 * saved through the admin API, a key is minted from it, and the key deletes.
 * The claims, per dialect:
 *
 * - the scope predicate is in the DELETE's own statement — a row outside it is
 *   NOT deleted and answers the same 404 as a missing one;
 * - a foreign key the database enforces is one opaque refusal, naming no
 *   constraint;
 * - a delete leaves one audit row carrying what was removed;
 * - an `anon` endpoint may offer DELETE, like any other.
 */

import { auditRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { PUBLIC_ORIGIN, SOURCE_LEGS, type ServedSource, type SourceSpec } from './public-source-dialects.js';

const SPEC: SourceSpec = {
  ddl: {
    sqlite: [
      'CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, owner VARCHAR(20) NOT NULL, body VARCHAR(100))',
      'CREATE TABLE authors (id INTEGER PRIMARY KEY AUTOINCREMENT, name VARCHAR(40) NOT NULL)',
      'CREATE TABLE books (id INTEGER PRIMARY KEY AUTOINCREMENT, author_id INTEGER NOT NULL REFERENCES authors(id), title VARCHAR(80))',
    ],
    postgres: [
      'CREATE TABLE notes (id serial PRIMARY KEY, owner varchar(20) NOT NULL, body varchar(100))',
      'CREATE TABLE authors (id serial PRIMARY KEY, name varchar(40) NOT NULL)',
      'CREATE TABLE books (id serial PRIMARY KEY, author_id integer NOT NULL REFERENCES authors(id), title varchar(80))',
    ],
    mysql: [
      'CREATE TABLE notes (id INT AUTO_INCREMENT PRIMARY KEY, owner VARCHAR(20) NOT NULL, body VARCHAR(100))',
      'CREATE TABLE authors (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(40) NOT NULL)',
      'CREATE TABLE books (id INT AUTO_INCREMENT PRIMARY KEY, author_id INT NOT NULL, title VARCHAR(80), CONSTRAINT fk_books_author FOREIGN KEY (author_id) REFERENCES authors(id))',
    ],
  },
  seed: [
    "INSERT INTO notes (owner, body) VALUES ('alice', 'a1')",
    "INSERT INTO notes (owner, body) VALUES ('bob', 'b1')",
    "INSERT INTO notes (owner, body) VALUES ('alice', 'a2')",
    "INSERT INTO authors (name) VALUES ('Austen')",
    "INSERT INTO authors (name) VALUES ('Bronte')",
    "INSERT INTO books (author_id, title) VALUES (1, 'Emma')",
  ],
};

let served: ServedSource | null = null;
afterEach(async () => {
  await served?.close();
  served = null;
});

async function saveEndpoint(s: ServedSource, ref: string, definition: Record<string, unknown>): Promise<void> {
  const res = await s.app.inject({
    method: 'PUT',
    url: `/api/v1/public-endpoints/${s.connectionId}/${ref}`,
    headers: { cookie: s.cookie },
    payload: { definition: JSON.stringify(definition) },
  });
  expect(res.statusCode, res.body).toBe(200);
}

async function mint(s: ServedSource, access: { ref: string; methods: string[] }[]): Promise<string> {
  const res = await s.app.inject({
    method: 'POST',
    url: '/api/v1/public-keys',
    headers: { cookie: s.cookie },
    payload: { name: 'Site', connectionId: s.connectionId, access },
  });
  expect(res.statusCode, res.body).toBe(201);
  return (res.json() as { token: string }).token;
}

async function sourceIdOf(s: ServedSource, table: string): Promise<string> {
  const res = await s.app.inject({ method: 'GET', url: `/api/v1/public-endpoints?connectionId=${s.connectionId}`, headers: { cookie: s.cookie } });
  const source = (res.json() as { sources: { id: string }[] }).sources.find((x) => x.id.endsWith(`.${table}`) || x.id === table);
  if (source === undefined) throw new Error(`no source ${table}`);
  return source.id;
}

const del = (s: ServedSource, token: string, path: string) =>
  s.app.inject({ method: 'DELETE', url: `/api/v1/public/records/${path}`, headers: { authorization: `Bearer ${token}`, origin: PUBLIC_ORIGIN } });

const ids = async (s: ServedSource, table: string): Promise<number[]> =>
  (await s.query(`SELECT id FROM ${table} ORDER BY id`)).map((r) => Number(r['id']));

function notesEndpoint(source: string): Record<string, unknown> {
  return {
    path: '/notes',
    source,
    methods: ['GET', 'DELETE'],
    select: ['id', 'owner', 'body'],
    filters: [{ column: 'owner', op: 'eq', value: 'alice' }],
    pagination: { default_limit: 20, max_limit: 200, order: 'id.desc' },
    auth: { role: 'anon' },
    rate_limit: { requests: 120, window: '1m' },
    response: { shape: 'object', envelope: 'data' },
  };
}

for (const leg of SOURCE_LEGS) {
  describe.skipIf(!leg.available)(`public DELETE [${leg.dialect}]`, () => {
    it('deletes in scope, refuses outside it with the same 404, and audits what it removed', async () => {
      served = await leg.serve(SPEC);
      const s = served;
      // An `anon` endpoint offering DELETE saves (O4).
      await saveEndpoint(s, 'notes', notesEndpoint(await sourceIdOf(s, 'notes')));
      const token = await mint(s, [{ ref: 'notes', methods: ['GET', 'DELETE'] }]);

      const outside = await del(s, token, 'notes/2');
      const missing = await del(s, token, 'notes/999');
      expect(outside.statusCode).toBe(404);
      expect(outside.body).toBe(missing.body);
      expect(await ids(s, 'notes')).toEqual([1, 2, 3]);

      const ok = await del(s, token, 'notes/1');
      expect(ok.statusCode, ok.body).toBe(200);
      expect(ok.json()).toEqual({ data: {} });
      expect(await ids(s, 'notes')).toEqual([2, 3]);
      expect((await del(s, token, 'notes/1')).body).toBe(missing.body);

      const rows = (await auditRepo(s.meta).list({ category: 'data', limit: 20 })).filter(
        (r) => r.action === 'public.record.delete',
      );
      expect(rows).toHaveLength(1);
      expect(JSON.stringify(rows[0]?.changes)).toContain('a1');
    }, 90_000);

    it('a foreign key the database enforces is one opaque refusal', async () => {
      served = await leg.serve(SPEC);
      const s = served;
      const token = await mint(s, [{ ref: 'authors', methods: ['GET', 'DELETE'] }]);
      const refused = await del(s, token, 'authors/1');
      expect(refused.statusCode).toBe(400);
      const body = refused.json() as { error: { code: string; message: string; params?: unknown } };
      expect(body.error.code).toBe('PUBLIC_WRITE_REFUSED');
      expect(body.error.params).toBeUndefined();
      expect(refused.body).not.toMatch(/fk_|foreign|constraint|books/i);
      expect(await ids(s, 'authors')).toEqual([1, 2]);
      expect((await del(s, token, 'authors/2')).statusCode).toBe(200);
    }, 90_000);

    it('a key granted GET only cannot delete', async () => {
      served = await leg.serve(SPEC);
      const s = served;
      const token = await mint(s, [{ ref: 'authors', methods: ['GET'] }]);
      expect((await del(s, token, 'authors/2')).statusCode).toBe(404);
      expect(await ids(s, 'authors')).toEqual([1, 2]);
    }, 90_000);
  });
}
