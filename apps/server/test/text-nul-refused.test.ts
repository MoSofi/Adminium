// SPDX-License-Identifier: AGPL-3.0-only
/**
 * U+0000 in text, through every door a row is written by, on SQLite, Postgres
 * and MySQL.
 *
 * Postgres refuses the character in any text it is sent, and its escape in a
 * `jsonb` value; MySQL and SQLite store both. So the same enquiry was a 500
 * from the dashboard on one engine and a stored row on the other two. Now it
 * is refused on all three, before anything is sent, with the column named:
 * `VALIDATION_FAILED` for staff, `PUBLIC_WRITE_REFUSED` with the column and
 * the reason for a stranger, a refused row for an import — and nothing is
 * stored anywhere.
 */
import { Readable } from 'node:stream';

import { filesRepo, importsRepo, overridesRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import type { FileStore } from '../src/files/store.js';
import { registerImportRunHandler } from '../src/jobs/import-run.js';
import { PUBLIC_ORIGIN, SOURCE_LEGS, type ServedSource, type SourceSpec } from './public-source-dialects.js';

const SPEC: SourceSpec = {
  ddl: {
    sqlite: ['CREATE TABLE enquiries (id INTEGER PRIMARY KEY AUTOINCREMENT, name VARCHAR(80) NOT NULL, message TEXT, details JSON)'],
    postgres: ['CREATE TABLE enquiries (id serial PRIMARY KEY, name varchar(80) NOT NULL, message text, details jsonb)'],
    mysql: ['CREATE TABLE enquiries (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(80) NOT NULL, message TEXT, details JSON)'],
  },
  seed: ["INSERT INTO enquiries (name, message) VALUES ('seed', 'hello')"],
};

/** A client copied onto an enquiry through a text key: filling the copy reads the client by the key sent. */
const COPIED: SourceSpec = {
  ddl: {
    sqlite: [
      'CREATE TABLE clients (code VARCHAR(20) PRIMARY KEY, name VARCHAR(80))',
      'CREATE TABLE enquiries (id INTEGER PRIMARY KEY AUTOINCREMENT, client_code VARCHAR(20) REFERENCES clients(code), client_name VARCHAR(80))',
    ],
    postgres: [
      'CREATE TABLE clients (code varchar(20) PRIMARY KEY, name varchar(80))',
      'CREATE TABLE enquiries (id serial PRIMARY KEY, client_code varchar(20) REFERENCES clients(code), client_name varchar(80))',
    ],
    mysql: [
      'CREATE TABLE clients (code VARCHAR(20) PRIMARY KEY, name VARCHAR(80))',
      'CREATE TABLE enquiries (id INT AUTO_INCREMENT PRIMARY KEY, client_code VARCHAR(20), client_name VARCHAR(80), FOREIGN KEY (client_code) REFERENCES clients(code))',
    ],
  },
  seed: ["INSERT INTO clients (code, name) VALUES ('c1', 'Ann')"],
};

interface Refusal {
  error: { code: string; params?: Record<string, unknown>; details?: { fields?: Record<string, { code: string }> } };
}

let served: ServedSource | null = null;
afterEach(async () => {
  await served?.close();
  served = null;
});

/** The table's id as the snapshot knows it, and a browser key that may create enquiries. */
async function setUp(s: ServedSource): Promise<{ table: string; token: string }> {
  const list = await s.app.inject({ method: 'GET', url: `/api/v1/public-endpoints?connectionId=${s.connectionId}`, headers: { cookie: s.cookie } });
  const table = (list.json() as { sources: { id: string }[] }).sources.find((x) => x.id.endsWith('enquiries'))?.id ?? '';
  const save = await s.app.inject({
    method: 'PUT',
    url: `/api/v1/public-endpoints/${s.connectionId}/enquiries`,
    headers: { cookie: s.cookie },
    payload: {
      definition: JSON.stringify({
        path: '/enquiries',
        source: table,
        methods: ['POST'],
        select: ['id', 'name', 'message', 'details'],
        writable: ['name', 'message', 'details'],
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
    payload: { name: 'Site', connectionId: s.connectionId, access: [{ ref: 'enquiries', methods: ['POST'] }] },
  });
  expect(key.statusCode, key.body).toBe(201);
  return { table, token: (key.json() as { token: string }).token };
}

/** Import `csv` into the table, skipping refused rows: the job's end state and its error report. */
async function importCsv(s: ServedSource, table: string, csv: string): Promise<{ status: string | undefined; report: string }> {
  let report = '';
  const storage = {
    read: async () => Readable.from([csv]),
    write: async (input: { bytes: string }) => {
      report = input.bytes;
      return { storageKey: 'report', sizeBytes: 0, sha256: '', destinationId: null, storage: 'memory' };
    },
  } as unknown as FileStore;
  const file = await filesRepo(s.meta).create({ filename: 'enquiries.csv', mime: 'text/csv', sizeBytes: csv.length, sha256: 'x', kind: 'upload' });
  const imports = importsRepo(s.meta);
  const job = await imports.create({
    connectionId: s.connectionId,
    tableName: table,
    requestedBy: String((await s.meta.db.selectFrom('adminium_users').select('id').executeTakeFirstOrThrow()).id),
    fileId: file.id,
    mapping: { columns: [{ from: 'name', to: 'name' }, { from: 'message', to: 'message' }] },
    options: { mode: 'insert', skipInvalid: true },
  });
  await imports.markReady(job.id, { total: 2 });
  let handler: ((payload: unknown, ctx: unknown) => Promise<unknown>) | null = null;
  registerImportRunHandler({ registerJobHandler: (_kind: string, _schema: unknown, run: typeof handler) => (handler = run) } as never, {
    meta: s.meta,
    manager: s.manager,
    storage,
  });
  await handler!({ importId: job.id }, { jobId: 'job_1', signal: new AbortController().signal, progress: () => {}, log: () => {} });
  return { status: (await imports.findById(job.id))?.status, report };
}

for (const leg of SOURCE_LEGS) {
  describe.skipIf(!leg.available)(`U+0000 in text is refused on every door [${leg.dialect}]`, () => {
    it('refuses it from a stranger, from staff, in a bulk edit and in an import — naming the column, storing nothing', async () => {
      served = await leg.serve(SPEC);
      const s = served;
      const { table, token } = await setUp(s);
      const stored = async () => s.query('SELECT id, name, message FROM enquiries ORDER BY id');
      const before = await stored();

      // A stranger's enquiry: the column and why, never a 500 and never a row.
      const pub = (values: Record<string, unknown>) =>
        s.app.inject({ method: 'POST', url: '/api/v1/public/records/enquiries', headers: { authorization: `Bearer ${token}`, origin: PUBLIC_ORIGIN }, payload: { values } });
      const text = await pub({ name: 'Ann\u0000', message: 'Hello' });
      expect(text.statusCode, text.body).toBe(400);
      expect((text.json() as Refusal).error).toMatchObject({ code: 'PUBLIC_WRITE_REFUSED', params: { column: 'name', reason: 'invalid-character' } });
      const member = await pub({ name: 'Ann', details: { note: ['fine', 'x\u0000y'] } });
      expect(member.statusCode, member.body).toBe(400);
      expect((member.json() as Refusal).error.params).toEqual({ column: 'details', reason: 'invalid-character' });
      const key = await pub({ name: 'Ann', details: { 'a\u0000': 1 } });
      expect((key.json() as Refusal).error.params).toEqual({ column: 'details', reason: 'invalid-character' });

      // Staff: the dashboard's form (a create and a change) and a bulk edit.
      const staff = (method: 'POST' | 'PATCH', url: string, payload: Record<string, unknown>) =>
        s.app.inject({ method, url: `/api/v1/data/${s.connectionId}/${table}${url}`, headers: { cookie: s.cookie }, payload });
      const fieldsOf = (reply: { json: () => unknown }) => (reply.json() as Refusal).error.details?.fields;
      const created = await staff('POST', '', { values: { name: 'a\u0000b' } });
      expect(created.statusCode, created.body).toBe(422);
      expect((created.json() as Refusal).error.code).toBe('VALIDATION_FAILED');
      expect(fieldsOf(created)).toEqual({ name: { code: 'invalid-character' } });
      const changed = await staff('PATCH', '/1', { values: { message: 'p\u0000q' } });
      expect(changed.statusCode, changed.body).toBe(422);
      expect(fieldsOf(changed)).toEqual({ message: { code: 'invalid-character' } });
      // JSON text carrying the escape: the character itself once the database parses it.
      const escaped = await staff('PATCH', '/1', { values: { details: '{"a":"\\u0000"}' } });
      expect(escaped.statusCode, escaped.body).toBe(422);
      expect(fieldsOf(escaped)).toEqual({ details: { code: 'invalid-character' } });
      const bulk = await staff('POST', '/bulk', { action: 'update', ids: [1], values: { message: '\u0000' } });
      expect(bulk.statusCode, bulk.body).toBe(422);
      expect(fieldsOf(bulk)).toEqual({ message: { code: 'invalid-character' } });
      // What the body reads rows WITH (a bulk edit's ids, a form's child key) is not a row's value: the request's own refusal, by its path.
      const ids = await staff('POST', '/bulk', { action: 'update', ids: ['1\u0000'], values: { message: 'x' } });
      expect(ids.statusCode, ids.body).toBe(400);
      expect((ids.json() as { error: { code: string; details: unknown } }).error).toMatchObject({
        code: 'VALIDATION_FAILED',
        details: { in: 'body', issues: [{ path: 'ids.0', code: 'invalid-character' }] },
      });

      // An import: the row is refused and reported by its column; the good row goes in.
      const imported = await importCsv(s, table, ['name,message', 'Bo,fine', 'Cy,bad\u0000cell', ''].join('\n'));
      expect(imported.status).toBe('succeeded');
      expect(imported.report).toContain('message: invalid-character');

      expect(await stored()).toEqual([...before, { id: expect.anything(), name: 'Bo', message: 'fine' }]);

      // What only LOOKS like the character is text like any other: a backslash
      // and five letters in a text column, and an escaped backslash in JSON.
      const literal = await staff('POST', '', { values: { name: 'Di', message: 'type \\u0000 to end', details: '{"a":"\\\\u0000"}' } });
      expect(literal.statusCode, literal.body).toBe(201);
      expect(await s.query("SELECT message FROM enquiries WHERE name = 'Di'")).toEqual([{ message: 'type \\u0000 to end' }]);
    }, 120_000);

    it('refuses it before a rule reads anything with it', async () => {
      served = await leg.serve(COPIED);
      const s = served;
      const list = await s.app.inject({ method: 'GET', url: `/api/v1/public-endpoints?connectionId=${s.connectionId}`, headers: { cookie: s.cookie } });
      const table = (list.json() as { sources: { id: string }[] }).sources.find((x) => x.id.endsWith('enquiries'))?.id ?? '';
      await overridesRepo(s.meta).replaceForConnection(s.connectionId, [
        { op: 'column.copy', tableName: table, columnName: 'client_name', value: { via: 'client_code', from: 'name', mode: 'always' } },
      ] as never);
      const create = (values: Record<string, unknown>) =>
        s.app.inject({ method: 'POST', url: `/api/v1/data/${s.connectionId}/${table}`, headers: { cookie: s.cookie }, payload: { values } });
      const ok = await create({ client_code: 'c1' });
      expect(ok.statusCode, ok.body).toBe(201);
      expect((ok.json() as { data: Record<string, unknown> }).data).toMatchObject({ client_name: 'Ann' });
      const refused = await create({ client_code: 'c1\u0000' });
      expect(refused.statusCode, refused.body).toBe(422);
      expect((refused.json() as Refusal).error.details?.fields).toEqual({ client_code: { code: 'invalid-character' } });
      expect(await s.query('SELECT client_code FROM enquiries')).toEqual([{ client_code: 'c1' }]);
    }, 120_000);
  });
}
