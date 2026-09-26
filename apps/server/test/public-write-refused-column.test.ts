// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A public write refused by a column's own rules names the column and why, on
 * SQLite, Postgres and MySQL — so a public form can put the message under the
 * field instead of "something was refused".
 *
 * Only a refusal about the value sent is named: too long, not the format the
 * rule asks for, left empty on a create, or holding a character no engine
 * keeps alike. Each says no more than the form already does. A value already
 * taken (unique), a value outside a list, a column the entry does not let the
 * caller write, and whether a change may empty a column (which can turn on
 * what the stored row holds) all stay the one unnamed refusal.
 */
import { overridesRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { PUBLIC_ORIGIN, SOURCE_LEGS, type ServedSource, type SourceSpec } from './public-source-dialects.js';

const SPEC: SourceSpec = {
  ddl: {
    sqlite: [
      'CREATE TABLE enquiries (id INTEGER PRIMARY KEY AUTOINCREMENT, internal TEXT, ref VARCHAR(20) UNIQUE, name VARCHAR(80) NOT NULL, email VARCHAR(120), message TEXT, stage VARCHAR(20))',
    ],
    postgres: [
      'CREATE TABLE enquiries (id serial PRIMARY KEY, internal text, ref varchar(20) UNIQUE, name varchar(80) NOT NULL, email varchar(120), message text, stage varchar(20))',
    ],
    mysql: [
      'CREATE TABLE enquiries (id INT AUTO_INCREMENT PRIMARY KEY, internal TEXT, ref VARCHAR(20) UNIQUE, name VARCHAR(80) NOT NULL, email VARCHAR(120), message TEXT, stage VARCHAR(20))',
    ],
  },
  seed: ["INSERT INTO enquiries (ref, name, message) VALUES ('R1', 'Seed', 'hello')"],
};

interface Reply {
  error: { code: string; message: string; params?: Record<string, unknown> };
}

let served: ServedSource | null = null;
afterEach(async () => {
  await served?.close();
  served = null;
});

const RULES = (table: string, extra: unknown[] = []) => [
  { op: 'column.validation', tableName: table, columnName: 'name', value: { maxLength: 10 } },
  { op: 'column.validation', tableName: table, columnName: 'email', value: { format: 'email' } },
  { op: 'column.required', tableName: table, columnName: 'message', value: { required: true } },
  { op: 'column.options', tableName: table, columnName: 'stage', value: { values: [{ value: 'new' }, { value: 'won' }] } },
  ...extra,
];

async function setUp(s: ServedSource): Promise<{ table: string; token: string }> {
  const list = await s.app.inject({ method: 'GET', url: `/api/v1/public-endpoints?connectionId=${s.connectionId}`, headers: { cookie: s.cookie } });
  const table = (list.json() as { sources: { id: string }[] }).sources.find((x) => x.id.endsWith('enquiries'))?.id ?? '';
  await overridesRepo(s.meta).replaceForConnection(s.connectionId, RULES(table) as never);
  const save = await s.app.inject({
    method: 'PUT',
    url: `/api/v1/public-endpoints/${s.connectionId}/enquiries`,
    headers: { cookie: s.cookie },
    payload: {
      definition: JSON.stringify({
        path: '/enquiries',
        source: table,
        methods: ['POST', 'PATCH', 'BATCH'],
        select: ['id', 'ref', 'name', 'message', 'stage'],
        writable: ['ref', 'name', 'email', 'message', 'stage'],
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
    payload: { name: 'Site', connectionId: s.connectionId, access: [{ ref: 'enquiries', methods: ['POST', 'PATCH', 'BATCH'] }] },
  });
  expect(key.statusCode, key.body).toBe(201);
  return { table, token: (key.json() as { token: string }).token };
}

for (const leg of SOURCE_LEGS) {
  describe.skipIf(!leg.available)(`a public write refused by a column's rules [${leg.dialect}]`, () => {
    it('names the column and the reason for a value refused for itself, and nothing more', async () => {
      served = await leg.serve(SPEC);
      const s = served;
      const { table, token } = await setUp(s);
      const headers = { authorization: `Bearer ${token}`, origin: PUBLIC_ORIGIN };
      const create = (values: Record<string, unknown>) => s.app.inject({ method: 'POST', url: '/api/v1/public/records/enquiries', headers, payload: { values } });
      const refused = async (reply: Promise<{ statusCode: number; body: string; json: () => unknown }>) => {
        const r = await reply;
        expect(r.statusCode, r.body).toBe(400);
        const error = (r.json() as Reply).error;
        expect(error.code).toBe('PUBLIC_WRITE_REFUSED');
        return error.params;
      };
      const count = async () => Number((await s.query('SELECT count(*) AS n FROM enquiries'))[0]?.['n']);

      // Refused for the value itself: the form can say which field, and why.
      expect(await refused(create({ name: 'A name far too long', message: 'Hi' }))).toEqual({ column: 'name', reason: 'too-long' });
      expect(await refused(create({ name: 'Ann', email: 'not-an-address', message: 'Hi' }))).toEqual({ column: 'email', reason: 'format' });
      expect(await refused(create({ name: 'Ann' }))).toEqual({ column: 'message', reason: 'required' });
      expect(await refused(create({ name: 'Ann', message: '  ' }))).toEqual({ column: 'message', reason: 'required' });

      // Never named: a value outside a list, and a value another row already holds.
      expect(await refused(create({ name: 'Ann', message: 'Hi', stage: 'maybe' }))).toBeUndefined();
      expect(await refused(create({ name: 'Ann', message: 'Hi', ref: 'R1' }))).toBeUndefined();
      expect(await count()).toBe(1);

      const ok = await create({ name: 'Ann', email: 'ann@example.com', message: 'Hi', stage: 'new', ref: 'R2' });
      expect(ok.statusCode, ok.body).toBe(201);

      // A batch names the row too.
      const batch = await s.app.inject({
        method: 'POST',
        url: '/api/v1/public/records/enquiries/batch',
        headers,
        payload: { rows: [{ name: 'Bo', message: 'Hi' }, { name: 'Cy', email: 'nope', message: 'Hi' }] },
      });
      expect(batch.statusCode, batch.body).toBe(400);
      expect((batch.json() as Reply).error.params).toEqual({ index: 1, column: 'email', reason: 'format' });
      // U+0000 in a batch row's value is the write service's to name, as in one row; in a row's key, the route's.
      const batchNul = await s.app.inject({ method: 'POST', url: '/api/v1/public/records/enquiries/batch', headers, payload: { rows: [{ name: 'Bo\u0000', message: 'Hi' }] } });
      expect(batchNul.statusCode, batchNul.body).toBe(400);
      expect((batchNul.json() as Reply).error).toMatchObject({ code: 'PUBLIC_WRITE_REFUSED', params: { index: 0, column: 'name', reason: 'invalid-character' } });
      const keyNul = await s.app.inject({ method: 'POST', url: '/api/v1/public/records/enquiries/batch', headers, payload: { rows: [{ id: '1\u0000', name: 'Bo' }] } });
      expect(keyNul.statusCode, keyNul.body).toBe(400);
      expect((keyNul.json() as Reply).error).toMatchObject({ code: 'PUBLIC_WRITE_REFUSED', params: { index: 0, column: 'id', reason: 'invalid-character' } });

      // A change: a value refused for itself is named; emptying a required column is not.
      const patch = (values: Record<string, unknown>) => s.app.inject({ method: 'PATCH', url: '/api/v1/public/records/enquiries/1', headers, payload: { values } });
      expect(await refused(patch({ name: 'A name far too long' }))).toEqual({ column: 'name', reason: 'too-long' });
      expect(await refused(patch({ message: '' }))).toBeUndefined();

      // A column the entry fills itself is not the caller's to hear of, even for a reason that would be.
      await overridesRepo(s.meta).replaceForConnection(
        s.connectionId,
        RULES(table, [{ op: 'column.required', tableName: table, columnName: 'internal', value: { required: true } }]) as never,
      );
      expect(await refused(create({ name: 'Di', message: 'Hi' }))).toBeUndefined();
      // …while a writable column refused beside it (after it, in the table) is still named.
      expect(await refused(create({ name: 'A name far too long', message: 'Hi' }))).toEqual({ column: 'name', reason: 'too-long' });
      expect(await count()).toBe(2);
    }, 120_000);
  });
}
