// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The endpoint admin routes and key create from endpoints, over the wire,
 * against a REAL introspected SQLite source.
 *
 * The point of going end to end: a key made from endpoints is only proven by
 * a public request that it answers. So the key made here is used — its token
 * lists rows from the granted ref and is refused on one it was not granted —
 * and an endpoint save is proven by the very next public response.
 */

import { auditRepo, publicEndpointsRepo, publicScopesRepo, settingsRepo, type MetaDb } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { composeServer, type ComposedServer } from '../src/compose.js';
import { runIntrospection } from '../src/connections/introspect.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { adminPasswordHash, ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD, login } from './auth-helpers.js';
import { makeEnv } from './helpers.js';
import { INSTALL_SECRET, makeInstall, type Install } from './project-fixtures.js';
import { createFirstSuperAdmin } from '@adminium/meta';

const ORIGIN = 'https://shop.example.com';

function memoryStore(meta: MetaDb): MetaStoreHandle {
  return { meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() };
}

let install: Install | null = null;
let composed: ComposedServer | null = null;
afterEach(async () => {
  await composed?.app.close();
  await install?.close();
  composed = null;
  install = null;
});

interface Served {
  app: ComposedServer['app'];
  meta: MetaDb;
  cookie: string;
  connectionId: string;
}

async function serve(): Promise<Served> {
  install = await makeInstall();
  const { meta } = install;
  // A derived scope inherits its zone from the connection.
  await meta.db.updateTable('adminium_connections').set({ timezone: 'UTC' }).where('id', '=', install.mainId).execute();
  await runIntrospection({ manager: install.manager, meta, connectionId: install.mainId });
  const runService = createRunService({ meta });
  composed = await composeServer({
    env: makeEnv({ ADMINIUM_PUBLIC_API_ORIGINS: ORIGIN, HOST: '127.0.0.1', ADMINIUM_SECRET: INSTALL_SECRET }),
    metaStore: memoryStore(meta),
    manager: install.manager,
    runService,
    applyService: createApplyService({ meta, runService }),
    allowed: null,
    logger: false,
    telemetry: false,
  });
  await composed.app.ready();
  await createFirstSuperAdmin(meta, { email: ADMIN_EMAIL, name: ADMIN_NAME, passwordHash: await adminPasswordHash() });
  const { cookie } = await login(composed.app, ADMIN_EMAIL, ADMIN_PASSWORD);
  await settingsRepo(meta).set('publicApi.enabled', true);
  return { app: composed.app, meta, cookie: cookie ?? '', connectionId: install.mainId };
}

interface EndpointDto {
  id: string | null;
  ref: string;
  stored: boolean;
  origin: string;
  definition: string;
  source: string | null;
  methods: string[];
  selectHash: string | null;
  issues: { code: string }[];
}

async function listEndpoints(s: Served): Promise<{ endpoints: EndpointDto[]; sources: { id: string; columns: { name: string; pii: boolean }[] }[]; snapshot: boolean }> {
  const res = await s.app.inject({ method: 'GET', url: `/api/v1/public-endpoints?connectionId=${s.connectionId}`, headers: { cookie: s.cookie } });
  expect(res.statusCode).toBe(200);
  return res.json() as never;
}

const endpointOf = async (s: Served, ref: string): Promise<EndpointDto> => {
  const found = (await listEndpoints(s)).endpoints.find((e) => e.ref === ref);
  if (found === undefined) throw new Error(`no endpoint ${ref}`);
  return found;
};

async function createKey(s: Served, access: { ref: string; methods: string[]; source?: string; selectHash?: string }[]) {
  return s.app.inject({
    method: 'POST',
    url: '/api/v1/public-keys',
    headers: { cookie: s.cookie },
    payload: { name: 'Storefront', connectionId: s.connectionId, access },
  });
}

async function mintKey(s: Served, access: { ref: string; methods: string[] }[]) {
  const res = await createKey(s, access);
  expect(res.statusCode).toBe(201);
  return res.json() as { key: { id: string; scopeId: string; access: { ref: string; methods: string[]; suspended: string[] }[]; issues: unknown[] }; token: string };
}

const publicGet = (s: Served, token: string, path: string) =>
  s.app.inject({ method: 'GET', url: `/api/v1/public/records/${path}`, headers: { authorization: `Bearer ${token}`, origin: ORIGIN } });

async function putEndpoint(s: Served, ref: string, definition: Record<string, unknown>) {
  return s.app.inject({
    method: 'PUT',
    url: `/api/v1/public-endpoints/${s.connectionId}/${ref}`,
    headers: { cookie: s.cookie },
    payload: { definition: JSON.stringify(definition) },
  });
}

const parsed = (e: EndpointDto) => JSON.parse(e.definition) as Record<string, unknown> & { select: string[]; methods: string[] };

describe('GET /public-endpoints', () => {
  it('lists a generated endpoint for every addressable table, with the sources and no secret column', async () => {
    const s = await serve();
    const { endpoints, sources, snapshot } = await listEndpoints(s);
    expect(snapshot).toBe(true);
    expect(endpoints.map((e) => e.ref)).toEqual(expect.arrayContaining(['customers', 'orders', 'order_items', 'tasks', 'events']));
    for (const e of endpoints) {
      expect(e).toMatchObject({ id: null, stored: false, origin: 'generated', issues: [] });
      expect(e.selectHash).toMatch(/^[0-9a-f]{16}$/);
    }
    // orders is referenced by order_items ON DELETE CASCADE: no DELETE by default.
    expect((await endpointOf(s, 'orders')).methods).not.toContain('DELETE');
    expect(sources.map((x) => x.id)).toContain('main.tasks');
    // The customer email is personal data: listed as a source column, marked, and not selected by default.
    expect(sources.find((x) => x.id === 'main.customers')?.columns.find((c) => c.name === 'email')?.pii).toBe(true);
    expect(parsed(await endpointOf(s, 'customers')).select).not.toContain('email');
  }, 60_000);
});

describe('POST /public-keys from endpoints', () => {
  it('makes a key that answers its granted ref, refuses the rest, and hides its scope', async () => {
    const s = await serve();
    const tasks = await endpointOf(s, 'tasks');
    const { key, token } = await mintKey(s, [
      { ref: 'tasks', methods: ['GET'] },
      { ref: 'customers', methods: ['GET'] },
    ]);
    expect(key.access.map((a) => [a.ref, a.methods, a.suspended]).sort()).toEqual([
      ['customers', ['GET'], []],
      ['tasks', ['GET'], []],
    ]);
    expect(key.issues).toEqual([]);

    // The generated endpoints it was granted are stored now, frozen as shown.
    const stored = await publicEndpointsRepo(s.meta).findByRef(s.connectionId, 'tasks');
    expect(stored).toMatchObject({ origin: 'generated', definition: tasks.definition });

    const list = await publicGet(s, token, 'tasks?limit=3');
    expect(list.statusCode).toBe(200);
    const rows = (list.json() as { data: Record<string, unknown>[] }).data;
    expect(rows).toHaveLength(3);
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual([...parsed(tasks).select].sort());
    expect((await publicGet(s, token, 'orders')).statusCode).toBe(404);

    // The derived scope is the key's alone.
    const scopes = await s.app.inject({ method: 'GET', url: '/api/v1/public-scopes', headers: { cookie: s.cookie } });
    expect((scopes.json() as { scopes: unknown[] }).scopes).toEqual([]);
    for (const probe of [
      { method: 'PATCH' as const, url: `/api/v1/public-scopes/${key.scopeId}`, payload: { name: 'x' } },
      { method: 'DELETE' as const, url: `/api/v1/public-scopes/${key.scopeId}` },
    ]) {
      expect((await s.app.inject({ ...probe, headers: { cookie: s.cookie } })).statusCode).toBe(404);
    }
    const riding = await s.app.inject({
      method: 'POST',
      url: '/api/v1/public-keys',
      headers: { cookie: s.cookie },
      payload: { name: 'Rider', scopeId: key.scopeId },
    });
    expect(riding.statusCode).toBe(404);

    const audit = await auditRepo(s.meta).list({ limit: 50 });
    expect(audit.some((r) => r.action === 'public-key.create')).toBe(true);
  }, 60_000);

  it('refuses no method, an unknown ref, a method not offered, and a mixed body — with every issue', async () => {
    const s = await serve();
    const codes = async (payload: unknown) => {
      const res = await s.app.inject({ method: 'POST', url: '/api/v1/public-keys', headers: { cookie: s.cookie }, payload: payload as never });
      expect(res.statusCode).toBe(422);
      return ((res.json() as { error: { details: { issues: { code: string }[] } } }).error.details.issues).map((i) => i.code);
    };
    expect(await codes({ name: 'k', connectionId: s.connectionId, access: [{ ref: 'tasks', methods: [] }] })).toEqual(['KEY_NO_METHOD']);
    expect(await codes({ name: 'k', connectionId: s.connectionId, access: [{ ref: 'nope', methods: ['GET'] }] })).toEqual(
      expect.arrayContaining(['KEY_REF_UNKNOWN']),
    );
    expect(await codes({ name: 'k', connectionId: s.connectionId, access: [{ ref: 'orders', methods: ['GET', 'DELETE'] }] })).toEqual([
      'KEY_METHOD_NOT_OFFERED',
    ]);
    expect(await codes({ name: 'k', scopeId: 'psc_x', connectionId: s.connectionId, access: [] })).toEqual(['KEY_SHAPE_INVALID']);
    expect(await publicEndpointsRepo(s.meta).listByConnection(s.connectionId)).toEqual([]);
  }, 60_000);

  it('refuses a generated endpoint that is no longer what the sheet showed', async () => {
    const s = await serve();
    const tasks = await endpointOf(s, 'tasks');
    const res = await createKey(s, [{ ref: 'tasks', methods: ['GET'], source: tasks.source ?? '', selectHash: 'ffffffffffffffff' }]);
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string; details: { refs: string[] } } }).error).toMatchObject({
      code: 'PUBLIC_ENDPOINT_CHANGED',
      details: { refs: ['tasks'] },
    });
    const ok = await createKey(s, [{ ref: 'tasks', methods: ['GET'], source: tasks.source ?? '', selectHash: tasks.selectHash ?? '' }]);
    expect(ok.statusCode).toBe(201);
  }, 60_000);
});

describe('PUT /public-endpoints/:connectionId/:ref', () => {
  it('a narrowing save reaches the very next public request of every key that grants it', async () => {
    const s = await serve();
    const { token } = await mintKey(s, [{ ref: 'tasks', methods: ['GET'] }]);
    expect(Object.keys(((await publicGet(s, token, 'tasks?limit=1')).json() as { data: object[] }).data[0] ?? {})).toContain('title');

    const def = parsed(await endpointOf(s, 'tasks'));
    const save = await putEndpoint(s, 'tasks', { ...def, select: ['id', 'status'], pagination: { ...(def['pagination'] as object), order: 'id.desc' } });
    expect(save.statusCode).toBe(200);
    expect((save.json() as { endpoint: EndpointDto }).endpoint.stored).toBe(true);

    const after = (await publicGet(s, token, 'tasks?limit=1')).json() as { data: object[] };
    expect(Object.keys(after.data[0] ?? {}).sort()).toEqual(['id', 'status']);
    const audit = await auditRepo(s.meta).list({ limit: 50 });
    expect(audit.some((r) => r.action === 'public-endpoint.save')).toBe(true);
  }, 60_000);

  it('refuses an edit that would break a live key, names the key, and changes nothing', async () => {
    const s = await serve();
    const { key, token } = await mintKey(s, [{ ref: 'tasks', methods: ['GET'] }]);
    const def = parsed(await endpointOf(s, 'tasks'));
    const res = await putEndpoint(s, 'tasks', { ...def, auth: { role: 'service_role' } });
    expect(res.statusCode).toBe(422);
    const details = (res.json() as { error: { details: { issues: { code: string }[]; keys: { id: string }[] } } }).error.details;
    expect(details.issues.map((i) => i.code)).toEqual(['KEY_SERVICE_ROLE_BROWSER']);
    expect(details.keys.map((k) => k.id)).toEqual([key.id]);
    expect((await publicGet(s, token, 'tasks?limit=1')).statusCode).toBe(200);
  }, 60_000);

  it("refuses the definition's own issues, and a path that is not the ref", async () => {
    const s = await serve();
    const def = parsed(await endpointOf(s, 'tasks'));
    const res = await putEndpoint(s, 'tasks', { ...def, path: '/jobs', select: ['id', 'nope'] });
    expect(res.statusCode).toBe(422);
    const issues = (res.json() as { error: { details: { issues: { code: string }[] } } }).error.details.issues;
    expect(issues.map((i) => i.code)).toEqual(expect.arrayContaining(['ENDPOINT_PATH_MISMATCH', 'ENDPOINT_SELECT_UNKNOWN_COLUMN']));
    const bad = await s.app.inject({
      method: 'PUT',
      url: `/api/v1/public-endpoints/${s.connectionId}/tasks`,
      headers: { cookie: s.cookie },
      payload: { definition: '{"path":' },
    });
    expect(bad.statusCode).toBe(422);
  }, 60_000);

  it('/check reports issues, and what a live browser key would gain, without writing', async () => {
    const s = await serve();
    await mintKey(s, [{ ref: 'tasks', methods: ['GET'] }]);
    const def = parsed(await endpointOf(s, 'tasks'));
    const narrowed = await putEndpoint(s, 'tasks', { ...def, select: ['id', 'status'] });
    expect(narrowed.statusCode).toBe(200);
    const res = await s.app.inject({
      method: 'POST',
      url: '/api/v1/public-endpoints/check',
      headers: { cookie: s.cookie },
      payload: { connectionId: s.connectionId, ref: 'tasks', definition: JSON.stringify({ ...def, select: ['id', 'status', 'title'] }) },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { issues: unknown[]; widened: { gains: { columns: string[] }[] }[] };
    expect(body.issues).toEqual([]);
    expect(body.widened[0]?.gains[0]?.columns).toEqual(['title']);
    expect(parsed(await endpointOf(s, 'tasks')).select).toEqual(['id', 'status']);
  }, 60_000);

  it('narrowing the methods suspends a grant, which the key list shows', async () => {
    const s = await serve();
    const { key } = await mintKey(s, [{ ref: 'tasks', methods: ['GET', 'PATCH'] }]);
    const def = parsed(await endpointOf(s, 'tasks'));
    expect((await putEndpoint(s, 'tasks', { ...def, methods: ['GET'] })).statusCode).toBe(200);
    const res = await s.app.inject({ method: 'GET', url: '/api/v1/public-keys', headers: { cookie: s.cookie } });
    const listed = (res.json() as { keys: { id: string; access: { ref: string; methods: string[]; suspended: string[] }[] }[] }).keys;
    expect(listed.find((k) => k.id === key.id)?.access).toEqual([
      expect.objectContaining({ ref: 'tasks', methods: ['GET'], suspended: ['PATCH'] }),
    ]);
  }, 60_000);
});

describe('DELETE and rename', () => {
  it('refuses while a live key grants it; after revoke a generated endpoint is switched off, not revived', async () => {
    const s = await serve();
    const { key } = await mintKey(s, [{ ref: 'tasks', methods: ['GET'] }]);
    const url = `/api/v1/public-endpoints/${s.connectionId}/tasks`;
    const refused = await s.app.inject({ method: 'DELETE', url, headers: { cookie: s.cookie } });
    expect(refused.statusCode).toBe(409);
    expect((refused.json() as { error: { code: string; details: { keys: { id: string }[] } } }).error).toMatchObject({
      code: 'PUBLIC_KEYS_LIVE',
      details: { keys: [expect.objectContaining({ id: key.id })] },
    });

    await s.app.inject({ method: 'DELETE', url: `/api/v1/public-keys/${key.id}`, headers: { cookie: s.cookie } });
    const removed = await s.app.inject({ method: 'DELETE', url, headers: { cookie: s.cookie } });
    expect(removed.statusCode).toBe(200);
    expect((removed.json() as { outcome: string }).outcome).toBe('switched-off');
    const after = await endpointOf(s, 'tasks');
    expect(after).toMatchObject({ stored: true, methods: [] });
  }, 60_000);

  it('a custom endpoint is deleted; rename refuses a taken ref and a live grant', async () => {
    const s = await serve();
    const def = parsed(await endpointOf(s, 'tasks'));
    expect((await putEndpoint(s, 'open_tasks', { ...def, path: '/open_tasks', filters: [{ column: 'status', op: 'neq', value: 'done' }] })).statusCode).toBe(200);
    expect((await endpointOf(s, 'open_tasks')).origin).toBe('custom');

    const rename = (ref: string, to: string) =>
      s.app.inject({ method: 'POST', url: `/api/v1/public-endpoints/${s.connectionId}/${ref}/rename`, headers: { cookie: s.cookie }, payload: { ref: to } });
    // A stored `tasks` row makes that ref taken.
    await putEndpoint(s, 'tasks', def);
    expect((await rename('open_tasks', 'tasks')).statusCode).toBe(409);
    const moved = await rename('open_tasks', 'todo');
    expect(moved.statusCode).toBe(200);
    expect(JSON.parse((moved.json() as { endpoint: EndpointDto }).endpoint.definition)).toMatchObject({ path: '/todo' });

    await mintKey(s, [{ ref: 'todo', methods: ['GET'] }]);
    const live = await rename('todo', 'backlog');
    expect(live.statusCode).toBe(409);
    expect((live.json() as { error: { code: string } }).error.code).toBe('PUBLIC_KEYS_LIVE');

    // With no key on it, a custom endpoint is really deleted.
    await putEndpoint(s, 'spare', { ...def, path: '/spare' });
    const gone = await s.app.inject({ method: 'DELETE', url: `/api/v1/public-endpoints/${s.connectionId}/spare`, headers: { cookie: s.cookie } });
    expect((gone.json() as { outcome: string }).outcome).toBe('deleted');
    expect(await publicEndpointsRepo(s.meta).findByRef(s.connectionId, 'spare')).toBeNull();
    expect(await publicScopesRepo(s.meta).list()).toHaveLength(1);
  }, 60_000);
});
