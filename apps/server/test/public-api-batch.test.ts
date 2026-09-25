// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `POST /public/records/:ref/batch` on SQLite, Postgres and MySQL
 * (insert rows, update rows by key).
 *
 * All or nothing is the property: after any refusal the table is exactly as
 * it was, whichever row caused it and whichever dialect ran it.
 */

import { auditRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { PUBLIC_ORIGIN, SOURCE_LEGS, type ServedSource, type SourceSpec } from './public-source-dialects.js';

const SPEC: SourceSpec = {
  ddl: {
    sqlite: ['CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, owner VARCHAR(20) NOT NULL, body VARCHAR(100) NOT NULL, code VARCHAR(40))'],
    postgres: ['CREATE TABLE notes (id serial PRIMARY KEY, owner varchar(20) NOT NULL, body varchar(100) NOT NULL, code varchar(40))'],
    mysql: ['CREATE TABLE notes (id INT AUTO_INCREMENT PRIMARY KEY, owner VARCHAR(20) NOT NULL, body VARCHAR(100) NOT NULL, code VARCHAR(40))'],
  },
  seed: [
    "INSERT INTO notes (owner, body) VALUES ('alice', 'a1')",
    "INSERT INTO notes (owner, body) VALUES ('bob', 'b1')",
  ],
};

let served: ServedSource | null = null;
afterEach(async () => {
  await served?.close();
  served = null;
});

/** An endpoint pinned to alice's notes, minting a `code` per row; a key with `methods`. */
async function setUp(s: ServedSource, methods: string[]): Promise<string> {
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
        methods: ['GET', 'POST', 'PATCH', 'BATCH'],
        select: ['id', 'owner', 'body', 'code'],
        filters: [{ column: 'owner', op: 'eq', value: 'alice' }],
        pagination: { default_limit: 20, max_limit: 200, order: 'id.desc' },
        auth: { role: 'anon' },
        rate_limit: { requests: 10000, window: '1m' },
        response: { shape: 'object', envelope: 'data' },
        writable: ['body'],
        defaults: { owner: 'alice', code: { $generate: 'uuid' } },
      }),
    },
  });
  expect(save.statusCode, save.body).toBe(200);
  const key = await s.app.inject({
    method: 'POST',
    url: '/api/v1/public-keys',
    headers: { cookie: s.cookie },
    payload: { name: 'Site', connectionId: s.connectionId, access: [{ ref: 'notes', methods }] },
  });
  expect(key.statusCode, key.body).toBe(201);
  return (key.json() as { token: string }).token;
}

const batch = (s: ServedSource, token: string, rows: Record<string, unknown>[]) =>
  s.app.inject({
    method: 'POST',
    url: '/api/v1/public/records/notes/batch',
    headers: { authorization: `Bearer ${token}`, origin: PUBLIC_ORIGIN },
    payload: { rows },
  });

const snapshot = async (s: ServedSource) => s.query('SELECT id, owner, body, code FROM notes ORDER BY id');

for (const leg of SOURCE_LEGS) {
  describe.skipIf(!leg.available)(`public BATCH [${leg.dialect}]`, () => {
    it('500 rows in one transaction, each with its own server values, and one audit row', async () => {
      served = await leg.serve(SPEC);
      const s = served;
      const token = await setUp(s, ['GET', 'BATCH']);
      const rows = Array.from({ length: 500 }, (_, i) => ({ body: `row ${String(i)}` }));
      const res = await batch(s, token, rows);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toEqual({ data: { count: 500, created: 500, updated: 0 } });
      const stored = await s.query("SELECT owner, code FROM notes WHERE body LIKE 'row %'");
      expect(stored).toHaveLength(500);
      expect(new Set(stored.map((r) => r['owner']))).toEqual(new Set(['alice']));
      expect(new Set(stored.map((r) => r['code'])).size).toBe(500);
      const audits = (await auditRepo(s.meta).list({ category: 'data', limit: 50 })).filter((r) => r.action === 'public.record.batch');
      expect(audits).toHaveLength(1);

      const tooMany = await batch(s, token, [...rows, { body: 'one more' }]);
      expect(tooMany.statusCode).toBe(400);
      expect((tooMany.json() as { error: { params: unknown } }).error.params).toEqual({ max: 500 });
      expect((await batch(s, token, [])).statusCode).toBe(400);
    }, 120_000);

    it('a bad row refuses the whole batch before anything is written, naming its index', async () => {
      served = await leg.serve(SPEC);
      const s = served;
      const token = await setUp(s, ['GET', 'BATCH']);
      const before = await snapshot(s);
      const res = await batch(s, token, [{ body: 'x' }, { body: 'y' }, { body: 'z', owner: 'bob' }]);
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: { code: string; params: unknown } }).error).toMatchObject({
        code: 'PUBLIC_WRITE_REFUSED',
        params: { index: 2 },
      });
      expect(await snapshot(s)).toEqual(before);
    }, 120_000);

    it('a constraint the database refuses mid-batch rolls back every row, naming nothing', async () => {
      served = await leg.serve(SPEC);
      const s = served;
      const token = await setUp(s, ['GET', 'BATCH']);
      const before = await snapshot(s);
      const res = await batch(s, token, [{ body: 'fine' }, { body: null }]);
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: { params?: unknown } }).error.params).toBeUndefined();
      expect(await snapshot(s)).toEqual(before);
    }, 120_000);

    it('keyed rows update in scope; one outside the scope, or missing, fails the batch identically', async () => {
      served = await leg.serve(SPEC);
      const s = served;
      const token = await setUp(s, ['GET', 'PATCH', 'BATCH']);
      const before = await snapshot(s);

      const outside = await batch(s, token, [{ body: 'new' }, { id: 2, body: 'hijack' }]);
      const missing = await batch(s, token, [{ body: 'new' }, { id: 999, body: 'ghost' }]);
      expect(outside.statusCode).toBe(400);
      expect(outside.body).toBe(missing.body);
      expect(await snapshot(s)).toEqual(before);

      const ok = await batch(s, token, [{ id: 1, body: 'edited' }, { body: 'added' }]);
      expect(ok.statusCode, ok.body).toBe(200);
      expect(ok.json()).toEqual({ data: { count: 2, created: 1, updated: 1 } });
      const after = await snapshot(s);
      expect(after.find((r) => Number(r['id']) === 1)?.['body']).toBe('edited');
      expect(after.find((r) => r['body'] === 'added')?.['owner']).toBe('alice');
      expect(after.find((r) => Number(r['id']) === 2)?.['body']).toBe('b1');
    }, 120_000);

    it('a rule judged on the stored row reads it in scope: a row outside answers as a missing one', async () => {
      // Bob's second note has a code; alice's scope cannot see it.
      served = await leg.serve({ ...SPEC, seed: [...SPEC.seed, "INSERT INTO notes (owner, body, code) VALUES ('bob', 'b2', 'kept')"] });
      const s = served;
      const token = await setUp(s, ['GET', 'PATCH', 'BATCH']);
      const list = await s.app.inject({ method: 'GET', url: `/api/v1/public-endpoints?connectionId=${s.connectionId}`, headers: { cookie: s.cookie } });
      const table = (list.json() as { sources: { id: string }[] }).sources.find((x) => x.id.endsWith('notes'))!.id;
      // A secret note keeps a code.
      const rule = await s.app.inject({
        method: 'PUT',
        url: `/api/v1/connections/${s.connectionId}/overrides`,
        headers: { cookie: s.cookie },
        payload: { overrides: [{ op: 'column.requiredWhen', tableName: table, columnName: 'code', value: { column: 'body', in: ['secret'] } }] },
      });
      expect(rule.statusCode, rule.body).toBe(200);
      const before = await snapshot(s);
      const outside = await batch(s, token, [{ id: 3, body: 'secret' }]);
      const missing = await batch(s, token, [{ id: 999, body: 'secret' }]);
      expect(outside.statusCode).toBe(400);
      expect(outside.body).toBe(missing.body);
      expect(await snapshot(s)).toEqual(before);
    }, 120_000);

    it('a keyed row needs PATCH too; a caller never chooses the key of a new row', async () => {
      served = await leg.serve(SPEC);
      const s = served;
      const token = await setUp(s, ['GET', 'BATCH']);
      const res = await batch(s, token, [{ id: 1, body: 'edited' }]);
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: { params: unknown } }).error.params).toEqual({ index: 0 });
      expect((await snapshot(s)).find((r) => Number(r['id']) === 1)?.['body']).toBe('a1');
    }, 120_000);
  });
}
