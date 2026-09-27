// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A guest's write the engine gave up in a lock race (a deadlock, a lock wait
 * run out) is told as a moment's wait — 409 `PUBLIC_SLOT_BUSY` — on every
 * door that writes one row or many: a create, a change, a batch. Never 400
 * `PUBLIC_WRITE_REFUSED`, which says the write itself was wrong. Nothing is
 * kept, and the same write a moment later goes through. On every engine.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loseRaceAt } from './lose-race.helpers.js';
import { PUBLIC_ORIGIN, SOURCE_LEGS, type ServedSource, type SourceSpec } from './public-source-dialects.js';

const SPEC: SourceSpec = {
  ddl: {
    sqlite: ['CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, owner VARCHAR(20) NOT NULL, body VARCHAR(100) NOT NULL)'],
    postgres: ['CREATE TABLE notes (id serial PRIMARY KEY, owner varchar(20) NOT NULL, body varchar(100) NOT NULL)'],
    mysql: ['CREATE TABLE notes (id INT AUTO_INCREMENT PRIMARY KEY, owner VARCHAR(20) NOT NULL, body VARCHAR(100) NOT NULL)'],
  },
  seed: ["INSERT INTO notes (owner, body) VALUES ('alice', 'a1')"],
};

let served: ServedSource | null = null;
afterEach(async () => {
  vi.restoreAllMocks();
  await served?.close();
  served = null;
});

async function setUp(s: ServedSource): Promise<string> {
  const list = await s.app.inject({ method: 'GET', url: `/api/v1/public-endpoints?connectionId=${s.connectionId}`, headers: { cookie: s.cookie } });
  const source = (list.json() as { sources: { id: string }[] }).sources.find((x) => x.id.endsWith('notes'))?.id ?? '';
  const methods = ['GET', 'POST', 'PATCH', 'BATCH'];
  const save = await s.app.inject({
    method: 'PUT',
    url: `/api/v1/public-endpoints/${s.connectionId}/notes`,
    headers: { cookie: s.cookie },
    payload: {
      definition: JSON.stringify({
        path: '/notes',
        source,
        methods,
        select: ['id', 'owner', 'body'],
        filters: [{ column: 'owner', op: 'eq', value: 'alice' }],
        pagination: { default_limit: 20, max_limit: 200, order: 'id.desc' },
        auth: { role: 'anon' },
        rate_limit: { requests: 10000, window: '1m' },
        response: { shape: 'object', envelope: 'data' },
        writable: ['body'],
        defaults: { owner: 'alice' },
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

/** The INSERT into the notes table, however the engine's schema qualifies it. */
const insertNotes = /insert into (?:[`"]?\w+[`"]?\.)?[`"]?notes/i;

for (const leg of SOURCE_LEGS) {
  describe.skipIf(!leg.available)(`a guest write that lost a lock race [${leg.dialect}]`, () => {
    it('is a moment\'s wait on a create, a change and a batch — and goes through a moment later', async () => {
      served = await leg.serve(SPEC);
      const s = served;
      const token = await setUp(s);
      const call = (method: 'POST' | 'PATCH', url: string, payload: unknown) =>
        s.app.inject({ method, url: `/api/v1/public/records/${url}`, headers: { authorization: `Bearer ${token}`, origin: PUBLIC_ORIGIN }, payload: payload as never });
      const doors: [string, RegExp, () => ReturnType<typeof call>][] = [
        ['create', insertNotes, () => call('POST', 'notes', { values: { body: 'new' } })],
        ['change', /update (?:[`"]?\w+[`"]?\.)?[`"]?notes/i, () => call('PATCH', 'notes/1', { values: { body: 'changed' } })],
        ['batch', insertNotes, () => call('POST', 'notes/batch', { rows: [{ body: 'b1' }, { body: 'b2' }] })],
      ];
      for (const [door, statement, write] of doors) {
        const before = await s.query('SELECT id, body FROM notes ORDER BY id');
        const restore = loseRaceAt(leg.dialect, statement);
        const lost = await write();
        restore();
        expect(lost.statusCode, `${door}: ${lost.body}`).toBe(409);
        expect((lost.json() as { error: { code: string } }).error.code, door).toBe('PUBLIC_SLOT_BUSY');
        expect(await s.query('SELECT id, body FROM notes ORDER BY id'), door).toEqual(before);
        const again = await write();
        expect(again.statusCode, `${door} again: ${again.body}`).toBeLessThan(300);
      }
    }, 120_000);
  });
}
