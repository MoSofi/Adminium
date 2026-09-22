// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The docs switch and the API catalogue, through
 * `composeServer` over a real SQLite source.
 *
 * What is pinned:
 *  - both switches of `PUT /public-api` apply on the NEXT request, each alone;
 *  - `GET /api/v1/api-docs` is the router's 404 while the page is off;
 *  - it lists only STORED endpoints a LIVE key grants, with the granted
 *    methods — never a virtual default, never an ungranted row;
 *  - a recursive scan of the whole body finds no physical table, no filter
 *    and no count;
 *  - a service-role endpoint is listed when granted (O5);
 *  - `baseUrl` never comes from `Origin`.
 */

import { auditRepo, settingsRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { SOURCE_LEGS, type ServedSource, type SourceSpec } from './public-source-dialects.js';

const SPEC: SourceSpec = {
  ddl: {
    sqlite: [
      'CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, body VARCHAR(100) NOT NULL, code VARCHAR(20) UNIQUE)',
      'CREATE TABLE tags (id INTEGER PRIMARY KEY AUTOINCREMENT, note_id INTEGER REFERENCES notes(id), label VARCHAR(40) NOT NULL)',
      'CREATE TABLE audit_trail (id INTEGER PRIMARY KEY AUTOINCREMENT, line VARCHAR(40) NOT NULL)',
    ],
    postgres: [],
    mysql: [],
  },
  seed: ["INSERT INTO notes (body, code) VALUES ('one', 'a')"],
};
const sqlite = SOURCE_LEGS.find((l) => l.dialect === 'sqlite') as (typeof SOURCE_LEGS)[number];
const FILTER_VALUE = 'never-published-filter-value';

let served: ServedSource | null = null;
afterEach(async () => {
  await served?.close();
  served = null;
});

const docs = (s: ServedSource, headers: Record<string, string> = {}) =>
  s.app.inject({ method: 'GET', url: '/api/v1/api-docs', headers });

const toggle = (s: ServedSource, payload: Record<string, unknown>) =>
  s.app.inject({ method: 'PUT', url: '/api/v1/public-api', headers: { cookie: s.cookie }, payload });

async function definitionOf(s: ServedSource, ref: string): Promise<Record<string, unknown>> {
  const list = await s.app.inject({
    method: 'GET',
    url: `/api/v1/public-endpoints?connectionId=${s.connectionId}`,
    headers: { cookie: s.cookie },
  });
  const found = (list.json() as { endpoints: { ref: string; definition: string }[] }).endpoints.find((e) => e.ref === ref);
  return JSON.parse(found?.definition ?? '{}') as Record<string, unknown>;
}

async function save(s: ServedSource, ref: string, patch: Record<string, unknown>) {
  const res = await s.app.inject({
    method: 'PUT',
    url: `/api/v1/public-endpoints/${s.connectionId}/${ref}`,
    headers: { cookie: s.cookie },
    payload: { definition: JSON.stringify({ ...(await definitionOf(s, ref)), ...patch }) },
  });
  expect(res.statusCode, res.body).toBe(200);
}

async function createKey(s: ServedSource, access: { ref: string; methods: string[] }[], extra: Record<string, unknown> = {}) {
  const res = await s.app.inject({
    method: 'POST',
    url: '/api/v1/public-keys',
    headers: { cookie: s.cookie },
    payload: { name: 'Site', connectionId: s.connectionId, access, ...extra },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as { key: { id: string } };
}

/** Every object key and every string value anywhere in `value`. */
function walk(value: unknown, keys: Set<string>, strings: Set<string>): void {
  if (typeof value === 'string') strings.add(value);
  else if (Array.isArray(value)) for (const v of value) walk(v, keys, strings);
  else if (typeof value === 'object' && value !== null) {
    for (const [k, v] of Object.entries(value)) {
      keys.add(k);
      walk(v, keys, strings);
    }
  }
}

interface Catalogue {
  apiEnabled: boolean;
  registered: boolean;
  baseUrl: string;
  connections: {
    label: string | null;
    endpoints: { ref: string; methods: string[]; auth: string; columns: { name: string; type: string; tags: string[] }[]; writable: string[] }[];
  }[];
}

describe('the docs switch', () => {
  it('reports docsEnabled, applies each switch alone on the next request, and audits each', async () => {
    served = await sqlite.serve(SPEC);
    const s = served;
    const state = await s.app.inject({ method: 'GET', url: '/api/v1/public-api', headers: { cookie: s.cookie } });
    expect(state.json()).toMatchObject({ enabled: true, registered: true, docsEnabled: false });

    expect((await docs(s)).statusCode).toBe(404);
    const on = await toggle(s, { docsEnabled: true });
    expect(on.statusCode, on.body).toBe(200);
    // The other switch is untouched.
    expect(on.json()).toMatchObject({ enabled: true, docsEnabled: true });
    expect((await docs(s)).statusCode).toBe(200);

    const apiOff = await toggle(s, { enabled: false });
    expect(apiOff.json()).toMatchObject({ enabled: false, docsEnabled: true });
    // The page stays up and says the API is off.
    expect(((await docs(s)).json() as Catalogue).apiEnabled).toBe(false);

    await toggle(s, { docsEnabled: false });
    expect((await docs(s)).statusCode).toBe(404);

    const actions = (await auditRepo(s.meta).list({ limit: 50 })).map((r) => r.action);
    expect(actions.filter((a) => a === 'public-api.docs-toggle')).toHaveLength(2);
    expect(actions.filter((a) => a === 'public-api.toggle')).toHaveLength(1);
  }, 90_000);

  it('refuses a body naming neither switch', async () => {
    served = await sqlite.serve(SPEC);
    const res = await toggle(served, {});
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
    expect((await auditRepo(served.meta).list({ limit: 50 })).some((r) => r.action.startsWith('public-api.'))).toBe(false);
  }, 90_000);
});

describe('GET /api/v1/api-docs', () => {
  it('is the router 404 while off — the same envelope as a route that does not exist', async () => {
    served = await sqlite.serve(SPEC);
    const off = await docs(served);
    const never = await served.app.inject({ method: 'GET', url: '/api/v1/api-docz' });
    expect(off.statusCode).toBe(404);
    expect(never.statusCode).toBe(404);
    const code = (r: typeof off) => (r.json() as { error: { code: string; message: string } }).error;
    expect(code(off).code).toBe(code(never).code);
    expect(code(off).message).toBe('Route GET:/api/v1/api-docs not found.');
  }, 90_000);

  it('lists only stored endpoints a live key grants, with the granted methods, and publishes no rule', async () => {
    served = await sqlite.serve(SPEC);
    const s = served;
    await settingsRepo(s.meta).set('publicApi.docsEnabled', true);

    // Nothing granted: every table has a virtual default, and none is listed.
    expect(((await docs(s)).json() as Catalogue).connections).toEqual([]);

    // A stored endpoint no key grants is not listed either.
    await save(s, 'audit_trail', {});
    await save(s, 'notes', { filters: [{ column: 'body', op: 'neq', value: FILTER_VALUE }] });
    // `notes` offers every method; the key holds two of them.
    const { key } = await createKey(s, [{ ref: 'notes', methods: ['GET', 'PATCH'] }]);

    const res = await docs(s);
    expect(res.statusCode).toBe(200);
    const body = res.json() as Catalogue;
    // Two connections exist (the fixture's own and this source), one has
    // listed endpoints, so no connection name is published.
    expect(body.connections).toHaveLength(1);
    expect(body.connections[0]?.label).toBeNull();
    const refs = body.connections[0]?.endpoints.map((e) => e.ref);
    expect(refs).toEqual(['notes']);
    const notes = body.connections[0]?.endpoints[0];
    expect(notes?.methods).toEqual(['GET', 'PATCH']);
    expect(notes?.auth).toBe('anon');
    expect(notes?.columns.find((c) => c.name === 'id')?.tags).toEqual(['pk']);
    expect(notes?.columns.find((c) => c.name === 'code')?.tags).toEqual(['unique']);
    expect(notes?.writable).toContain('code');
    expect(notes?.writable).not.toContain('id');
    // The filter column is never writable, and the filter is never published.
    expect(notes?.writable).not.toContain('body');

    const keys = new Set<string>();
    const strings = new Set<string>();
    walk(body, keys, strings);
    for (const forbidden of ['filters', 'source', 'table', 'count', 'rowCount', 'rowCountEstimate', 'op', 'value', 'where']) {
      expect(keys.has(forbidden), `key "${forbidden}"`).toBe(false);
    }
    expect(strings.has(FILTER_VALUE)).toBe(false);
    for (const str of strings) expect(str.startsWith('main.'), str).toBe(false);
    expect(JSON.stringify(body)).not.toContain(FILTER_VALUE);

    // A revoke reaches the page on the very next request.
    const revoke = await s.app.inject({ method: 'DELETE', url: `/api/v1/public-keys/${key.id}`, headers: { cookie: s.cookie } });
    expect(revoke.statusCode, revoke.body).toBe(200);
    expect(((await docs(s)).json() as Catalogue).connections).toEqual([]);
  }, 90_000);

  it('lists a granted service-role endpoint and a foreign key tag', async () => {
    served = await sqlite.serve(SPEC);
    const s = served;
    await settingsRepo(s.meta).set('publicApi.docsEnabled', true);
    await save(s, 'tags', { auth: { role: 'service_role' } });
    await createKey(s, [{ ref: 'tags', methods: ['GET'] }], { kind: 'server' });

    const tags = ((await docs(s)).json() as Catalogue).connections[0]?.endpoints[0];
    expect(tags?.ref).toBe('tags');
    expect(tags?.auth).toBe('service_role');
    expect(tags?.columns.find((c) => c.name === 'note_id')?.tags).toEqual(['fk']);
    expect(tags?.writable).toEqual([]);
  }, 90_000);

  it('takes baseUrl from system.publicOrigin, else the Host — never from Origin', async () => {
    served = await sqlite.serve(SPEC);
    const s = served;
    await settingsRepo(s.meta).set('publicApi.docsEnabled', true);
    const forged = (await docs(s, { origin: 'https://evil.example', host: 'admin.example.com' })).json() as Catalogue;
    expect(forged.baseUrl).toBe('http://admin.example.com');

    await settingsRepo(s.meta).set('system.publicOrigin', 'https://adminium.example.org');
    const stored = (await docs(s, { origin: 'https://evil.example' })).json() as Catalogue;
    expect(stored.baseUrl).toBe('https://adminium.example.org');
  }, 90_000);
});
