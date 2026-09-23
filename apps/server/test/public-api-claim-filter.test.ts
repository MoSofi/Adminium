// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A claim cannot find a row the endpoint hides.
 *
 * The claim lookup matched its declared columns and nothing else, so a row the
 * resource's mandatory predicate keeps out of every read — here a `done` task
 * — could still be claimed, and the session minted for it then reached it.
 * Executed against a real SQLite source: the fixture's task 4 is `done`,
 * task 5 is not.
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

async function serve(): Promise<{ app: ComposedServer['app']; token: string }> {
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
        {
          ref: 'tasks',
          table: 'main.tasks',
          actions: ['read'],
          expose: ['id', 'title', 'status'],
          where: [{ column: 'status', op: 'neq', value: 'done' }],
          claim: { column: 'id' },
        },
      ],
      claim: { strategy: 'lookup', ref: 'tasks', match: ['id', 'status'] },
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

const claim = (app: ComposedServer['app'], token: string, match: Record<string, unknown>) =>
  app.inject({
    method: 'POST',
    url: '/api/v1/public/claim',
    headers: { authorization: `Bearer ${token}`, origin: ORIGIN, 'content-type': 'application/json' },
    payload: { match },
  });

describe("claim honours the endpoint's own filter", () => {
  it('claims a row the endpoint shows, and refuses one it hides with the ordinary no-match', async () => {
    const { app, token } = await serve();
    const shown = await claim(app, token, { id: 5, status: 'backlog' });
    expect(shown.statusCode).toBe(200);
    const session = (shown.json() as { data: { session: string } }).data.session;
    expect(session).toMatch(/^adm_pubs_/);

    // The positive control the isolation sweep leans on: the session is real,
    // and a claim-gated read with it answers exactly the claimed row.
    const mine = await app.inject({
      method: 'GET',
      url: '/api/v1/public/records/tasks',
      headers: { authorization: `Bearer ${token}`, origin: ORIGIN, 'x-adminium-public-session': session },
    });
    expect(mine.statusCode).toBe(200);
    expect((mine.json() as { data: { id: number }[] }).data.map((r) => r.id)).toEqual([5]);
    // Without it, a claim-gated resource is unreachable.
    const anon = await app.inject({
      method: 'GET',
      url: '/api/v1/public/records/tasks',
      headers: { authorization: `Bearer ${token}`, origin: ORIGIN },
    });
    expect(anon.statusCode).not.toBe(200);

    // Task 4 exists and is `done`: the endpoint never shows it, so nothing may claim it.
    const hidden = await claim(app, token, { id: 4, status: 'done' });
    expect(hidden.statusCode).toBe(403);
    expect((hidden.json() as { error: { code: string } }).error.code).toBe('PUBLIC_CLAIM_NO_MATCH');
    // Byte-identical to a row that does not exist at all.
    const missing = await claim(app, token, { id: 9999, status: 'done' });
    expect(hidden.body).toBe(missing.body);
  }, 60_000);
});
