// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `GET /public/records/:ref/:id` — one row by key.
 *
 * The route is built on the list, so the assertions are about sameness: the
 * row it answers is the row the list answers, a resource that hides its key
 * does not hand it back, and every way of not being allowed to see a row is
 * the same 404 byte for byte.
 */

import { publicKeysRepo, publicScopesRepo, settingsRepo, type MetaDb } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { composeServer, type ComposedServer } from '../src/compose.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { generatePublishableKey } from '../src/public-api/keys.js';
import { makeEnv } from './helpers.js';
import { INSTALL_SECRET, makeInstall, type Install } from './project-fixtures.js';

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

async function serve(resources: Record<string, unknown>[]): Promise<{ app: ComposedServer['app']; token: string }> {
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
  await settingsRepo(meta).set('publicApi.enabled', true);
  const scope = await publicScopesRepo(meta).create({
    connectionId: install.mainId,
    side: 'customer',
    name: 'Tasks',
    timezone: 'UTC',
    document: JSON.stringify({ version: 1, side: 'customer', timezone: 'UTC', resources }),
    createdBy: null,
  });
  const key = generatePublishableKey();
  await publicKeysRepo(meta).create({
    name: 'Site',
    prefix: key.prefix,
    tokenHash: key.tokenHash,
    tokenEncrypted: 'not-needed-here',
    scopeId: scope.id,
    side: 'customer',
    origins: [],
  });
  return { app: composed.app, token: key.token };
}

const get = (app: ComposedServer['app'], token: string, url: string) =>
  app.inject({ method: 'GET', url: `/api/v1/public/records/${url}`, headers: { authorization: `Bearer ${token}`, origin: ORIGIN } });

// Task i has status taskStatuses[i % 5]: backlog, todo, in_progress, review, done → i=5 is 'backlog', i=4 is 'done'.
const open = { ref: 'tasks', table: 'main.tasks', actions: ['read'], expose: ['id', 'title', 'status'], where: [{ column: 'status', op: 'neq', value: 'done' }] };

describe('GET /public/records/:ref/:id', () => {
  it('answers the same row, with the same projection, as the list', async () => {
    const { app, token } = await serve([open]);
    const one = await get(app, token, 'tasks/5');
    expect(one.statusCode).toBe(200);
    const listed = (await get(app, token, 'tasks?limit=200')).json() as { data: { id: number }[] };
    expect((one.json() as { data: unknown }).data).toEqual(listed.data.find((r) => r.id === 5));
    expect(Object.keys((one.json() as { data: object }).data)).toEqual(['id', 'title', 'status']);
  }, 60_000);

  it('a row outside the predicate, a missing row and a bad id are one 404; an unknown ref shares the code', async () => {
    const { app, token } = await serve([open]);
    const outside = await get(app, token, 'tasks/4');
    const missing = await get(app, token, 'tasks/9999');
    const garbage = await get(app, token, 'tasks/not-a-number');
    const unknown = await get(app, token, 'nope/1');
    // Every row-level answer is byte-identical: nothing tells a row outside
    // the predicate from one that does not exist.
    for (const res of [outside, missing, garbage]) {
      expect(res.statusCode).toBe(404);
      expect(res.body).toBe(outside.body);
    }
    // An unknown ref shares the code; which refs a key has is already public
    // through `/public/config`.
    expect(unknown.statusCode).toBe(404);
    expect((unknown.json() as { error: { code: string } }).error.code).toBe('PUBLIC_REF_NOT_FOUND');
  }, 60_000);

  it('a resource that does not expose its key does not return it', async () => {
    const { app, token } = await serve([{ ...open, expose: ['title', 'status'] }]);
    const res = await get(app, token, 'tasks/5');
    expect(res.statusCode).toBe(200);
    expect(Object.keys((res.json() as { data: object }).data)).toEqual(['title', 'status']);
  }, 60_000);

  it('a key without read on the ref gets the same 404', async () => {
    const { app, token } = await serve([
      { ref: 'tasks', table: 'main.tasks', actions: ['create'], expose: ['id', 'title'], writable: ['title'] },
    ]);
    expect((await get(app, token, 'tasks/5')).statusCode).toBe(404);
  }, 60_000);
});
