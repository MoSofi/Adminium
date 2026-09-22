// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A list's default page size and order.
 *
 * `limit` used to be both the default page and the cap. A resource may now say
 * `defaultLimit` and `defaultOrder`, and a scope written before either existed
 * must page exactly as it did — which is the case that matters most, because
 * every hosted surface in the field runs one.
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

/** A serving instance with one key on a `tasks` resource shaped by `extra`. */
async function serve(extra: Record<string, unknown>): Promise<{ app: ComposedServer['app']; token: string }> {
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
    document: JSON.stringify({
      version: 1,
      side: 'customer',
      timezone: 'UTC',
      resources: [
        { ref: 'tasks', table: 'main.tasks', actions: ['read'], expose: ['id', 'title'], orderable: ['id'], ...extra },
      ],
    }),
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

async function ids(app: ComposedServer['app'], token: string, query = ''): Promise<number[]> {
  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/public/records/tasks${query}`,
    headers: { authorization: `Bearer ${token}`, origin: ORIGIN },
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { data: { id: number }[] }).data.map((r) => r.id);
}

describe('a list with no limit or order of its own', () => {
  it('a scope written before this widening pages by `limit`, as it always did', async () => {
    const { app, token } = await serve({ limit: 7 });
    expect(await ids(app, token)).toHaveLength(7);
    expect(await ids(app, token, '?limit=3')).toHaveLength(3);
    // The cap still holds for a caller asking for more.
    expect(await ids(app, token, '?limit=50')).toHaveLength(7);
  });

  it('`defaultLimit` is the page size, and `limit` stays the cap', async () => {
    const { app, token } = await serve({ limit: 30, defaultLimit: 4 });
    expect(await ids(app, token)).toHaveLength(4);
    expect(await ids(app, token, '?limit=25')).toHaveLength(25);
    expect(await ids(app, token, '?limit=200')).toHaveLength(30);
  });

  it('`defaultOrder` applies when the caller names none, and the caller still wins', async () => {
    const { app, token } = await serve({ limit: 5, defaultOrder: 'id.desc' });
    expect(await ids(app, token)).toEqual([40, 39, 38, 37, 36]);
    expect(await ids(app, token, '?order=id.asc')).toEqual([1, 2, 3, 4, 5]);
  });
});
