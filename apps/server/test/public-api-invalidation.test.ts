// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Admin writes reach the public surface on the NEXT request.
 *
 * THE BUG THIS PINS. The key resolver caches a compiled scope per token for
 * 30 s. It was built inside the public plugin, so `compose.ts` had no handle to
 * pass the admin routes. Their `invalidateResolver` calls on revoke, rotate
 * and scope edit reached nothing, and a revoked key kept answering until its
 * cache entry expired. The route suites mount one plugin at a time and cannot
 * see this, so everything here goes through `composeServer` against a real
 * SQLite source: warm the cache with a request, make the admin write, then
 * send the very next request.
 *
 * The last case pins the other half of the task: a burst of reads writes the
 * key's `last_used_at` once, not once per read.
 */

import {
  createFirstSuperAdmin,
  publicApiStateRepo,
  publicKeysRepo,
  publicScopesRepo,
  settingsRepo,
  type MetaDb,
} from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { composeServer, type ComposedServer } from '../src/compose.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { generatePublishableKey } from '../src/public-api/keys.js';
import { adminPasswordHash, ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD, login } from './auth-helpers.js';
import { makeEnv } from './helpers.js';
import { INSTALL_SECRET, makeInstall, type Install } from './project-fixtures.js';

const ORIGIN = 'https://shop.example.com';

function memoryStore(meta: MetaDb): MetaStoreHandle {
  return { meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() };
}

function tasksScope(expose: string[]): string {
  return JSON.stringify({
    version: 1,
    side: 'customer',
    timezone: 'UTC',
    resources: [{ ref: 'tasks', table: 'main.tasks', actions: ['read'], expose }],
  });
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
  scopeId: string;
  keyId: string;
  token: string;
}

async function serve(): Promise<Served> {
  install = await makeInstall();
  const { meta } = install;
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

  const scope = await publicScopesRepo(meta).create({
    connectionId: install.mainId,
    side: 'customer',
    name: 'Tasks',
    timezone: 'UTC',
    document: tasksScope(['id', 'title']),
    createdBy: null,
  });
  const key = generatePublishableKey();
  const row = await publicKeysRepo(meta).create({
    name: 'Site',
    prefix: key.prefix,
    tokenHash: key.tokenHash,
    tokenEncrypted: 'not-needed-here',
    scopeId: scope.id,
    side: 'customer',
    origins: [],
  });
  return { app: composed.app, meta, cookie: cookie ?? '', scopeId: scope.id, keyId: row.id, token: key.token };
}

const list = (app: ComposedServer['app'], token: string) =>
  app.inject({
    method: 'GET',
    url: '/api/v1/public/records/tasks?limit=2',
    headers: { authorization: `Bearer ${token}`, origin: ORIGIN },
  });

describe('an admin write reaches the very next public request', () => {
  it('revoking a key refuses the next request, with the entry still warm', async () => {
    const { app, cookie, keyId, token } = await serve();
    expect((await list(app, token)).statusCode).toBe(200);

    const revoke = await app.inject({ method: 'DELETE', url: `/api/v1/public-keys/${keyId}`, headers: { cookie } });
    expect(revoke.statusCode).toBe(200);

    expect((await list(app, token)).statusCode).toBe(401);
  });

  it('rotating a key refuses the old token next, and serves the new one', async () => {
    const { app, cookie, keyId, token } = await serve();
    expect((await list(app, token)).statusCode).toBe(200);

    const rotate = await app.inject({ method: 'POST', url: `/api/v1/public-keys/${keyId}/rotate`, headers: { cookie } });
    expect(rotate.statusCode).toBe(200);
    const next = (rotate.json() as { token: string }).token;

    expect((await list(app, token)).statusCode).toBe(401);
    expect((await list(app, next)).statusCode).toBe(200);
  });

  it('a scope edit narrows the next response', async () => {
    const { app, cookie, scopeId, token } = await serve();
    const before = await list(app, token);
    expect(before.statusCode).toBe(200);
    expect(Object.keys((before.json() as { data: Record<string, unknown>[] }).data[0] ?? {}).sort()).toEqual(['id', 'title']);

    const edit = await app.inject({
      method: 'PATCH',
      url: `/api/v1/public-scopes/${scopeId}`,
      headers: { cookie },
      payload: { document: tasksScope(['id']) },
    });
    expect(edit.statusCode).toBe(200);

    const after = await list(app, token);
    expect(after.statusCode).toBe(200);
    expect(Object.keys((after.json() as { data: Record<string, unknown>[] }).data[0] ?? {})).toEqual(['id']);
  });
});

describe('a change made by ANOTHER process', () => {
  it("reaches this process's warm key cache on the gate's next refresh", async () => {
    const { app, meta, cookie, keyId, token } = await serve();
    expect((await list(app, token)).statusCode).toBe(200);

    // Another replica revokes the key: the row changes and the shared revision
    // moves, but nothing here is told.
    await publicKeysRepo(meta).revoke(keyId);
    await publicApiStateRepo(meta).bump();
    expect((await list(app, token)).statusCode).toBe(200);

    // The gate refreshes (its TTL, forced here through the toggle's own
    // invalidation), reads the moved revision, and drops the cached keys.
    const toggle = await app.inject({ method: 'PUT', url: '/api/v1/public-api', headers: { cookie }, payload: { enabled: true } });
    expect(toggle.statusCode).toBe(200);
    expect((await list(app, token)).statusCode).toBe(401);
  });
});

describe('last_used_at', () => {
  it('a burst of reads writes it once', async () => {
    const { app, meta, keyId, token } = await serve();
    expect((await list(app, token)).statusCode).toBe(200);
    const first = (await publicKeysRepo(meta).findById(keyId))?.lastUsedAt ?? null;
    expect(first).not.toBeNull();

    for (let i = 0; i < 99; i += 1) {
      expect((await list(app, token)).statusCode).toBe(200);
    }

    // Every write stamps the request's own time, and 99 requests span many
    // milliseconds, so an unchanged value means no further write happened.
    expect((await publicKeysRepo(meta).findById(keyId))?.lastUsedAt).toBe(first);
  });
});
