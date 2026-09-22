// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Requests · 24h": the accumulator, the additive flush on every meta
 * dialect, the minute schedule, the retention purge, and the tile's number
 * against a counted run.
 */

import {
  connectionsRepo,
  createFirstSuperAdmin,
  publicKeysRepo,
  publicRequestStatsRepo,
  publicScopesRepo,
  settingsRepo,
  type MetaDb,
} from '@adminium/meta';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { composeServer, PUBLIC_STATS_FLUSH_NAME, RETENTION_GC_SCHEDULE_NAME, type ComposedServer } from '../src/compose.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { generatePublishableKey } from '../src/public-api/keys.js';
import { createRequestStats, HOUR_MS } from '../src/public-api/stats.js';
import { adminPasswordHash, ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD, login } from './auth-helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';
import { INSTALL_SECRET, makeInstall, type Install } from './project-fixtures.js';

describe('createRequestStats', () => {
  it('counts per key, ref and hour, and a flush hands each bucket over once', async () => {
    const written: { keyId: string; ref: string; bucket: number; requests: number; errors: number }[] = [];
    const stats = createRequestStats({ add: async (c) => void written.push({ ...c }) });
    const t = 5 * HOUR_MS;
    stats.record('k1', 'orders', false, t + 10);
    stats.record('k1', 'orders', true, t + 20);
    stats.record('k1', 'orders', false, t + HOUR_MS + 1);
    stats.record('k2', 'orders', false, t + 30);
    await stats.flush();
    expect(written).toEqual([
      { keyId: 'k1', ref: 'orders', bucket: t, requests: 2, errors: 1 },
      { keyId: 'k1', ref: 'orders', bucket: t + HOUR_MS, requests: 1, errors: 0 },
      { keyId: 'k2', ref: 'orders', bucket: t, requests: 1, errors: 0 },
    ]);
    expect(stats.pending()).toBe(0);
    await stats.flush();
    expect(written).toHaveLength(3);
  });

  it('a failed write is reported once and dropped, never retried', async () => {
    const errors: unknown[] = [];
    let calls = 0;
    const stats = createRequestStats({
      add: async () => {
        calls += 1;
        return Promise.reject(new Error('meta store down'));
      },
      onError: (e) => errors.push(e),
    });
    stats.record('k1', 'a', false);
    stats.record('k1', 'b', false);
    await stats.flush();
    expect(calls).toBe(2);
    expect(errors).toHaveLength(1);
    await stats.flush();
    expect(calls).toBe(2);
  });
});

for (const engine of META_ENGINES) {
  describe.skipIf(!engine.available)(`two processes flushing one hour [${engine.name}]`, () => {
    let handle: MetaHandle;
    beforeAll(async () => {
      handle = await engine.make();
    }, 60_000);
    afterAll(async () => {
      await handle.destroy();
    });

    it('sum', async () => {
      const repo = publicRequestStatsRepo(handle.meta);
      const a = createRequestStats({ add: (c) => repo.add(c) });
      const b = createRequestStats({ add: (c) => repo.add(c) });
      const at = Date.now();
      for (let i = 0; i < 5; i += 1) a.record('pbk_sum', 'orders', i === 0, at);
      for (let i = 0; i < 3; i += 1) b.record('pbk_sum', 'orders', false, at);
      await Promise.all([a.flush(), b.flush()]);
      expect(await repo.totals({ since: at - HOUR_MS, keyIds: ['pbk_sum'] })).toEqual({ requests: 8, errors: 1 });
    });
  });
}

/* --------------------------------------------------------------- over the wire */

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

describe('the tile against a counted run [sqlite]', () => {
  it('counts resolved requests by ref, not 401s; flushes on its schedule; the sweep purges old hours', async () => {
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
      document: JSON.stringify({
        version: 1,
        side: 'customer',
        timezone: 'UTC',
        resources: [{ ref: 'tasks', table: 'main.tasks', actions: ['read'], expose: ['id', 'title'] }],
      }),
      createdBy: null,
    });
    const key = generatePublishableKey();
    await publicKeysRepo(meta).create({
      name: 'Site',
      prefix: key.prefix,
      tokenHash: key.tokenHash,
      tokenEncrypted: 'x',
      scopeId: scope.id,
      side: 'customer',
    });
    const call = (url: string, token = key.token) =>
      composed?.app.inject({ method: 'GET', url: `/api/v1/public/records/${url}`, headers: { authorization: `Bearer ${token}`, origin: ORIGIN } });

    for (let i = 0; i < 7; i += 1) expect((await call('tasks?limit=1'))?.statusCode).toBe(200);
    for (let i = 0; i < 2; i += 1) expect((await call('nope'))?.statusCode).toBe(404);
    expect((await call('tasks', generatePublishableKey().token))?.statusCode).toBe(401);

    await composed.jobs.scheduler.trigger(PUBLIC_STATS_FLUSH_NAME);
    const tile = await composed.app.inject({ method: 'GET', url: '/api/v1/public-api/stats', headers: { cookie: cookie ?? '' } });
    expect(tile.statusCode).toBe(200);
    expect(tile.json()).toEqual({ requests24h: 9, errors24h: 2 });
    // Scoped to a connection with no keys, it is zero.
    const other = await connectionsRepo(meta, dsnCryptoFromSecret(TEST_SECRET)).create({
      name: 'Other',
      engine: 'postgres',
      introspectDsn: 'postgres://ro@db.internal:5432/other',
    });
    const scoped = await composed.app.inject({
      method: 'GET',
      url: `/api/v1/public-api/stats?connectionId=${other.id}`,
      headers: { cookie: cookie ?? '' },
    });
    expect(scoped.json()).toEqual({ requests24h: 0, errors24h: 0 });

    // A bucket older than the 30-day retention goes with the nightly sweep.
    const repo = publicRequestStatsRepo(meta);
    const old = Math.floor((Date.now() - 40 * 24 * HOUR_MS) / HOUR_MS) * HOUR_MS;
    await repo.add({ keyId: 'pbk_old', ref: 'tasks', bucket: old, requests: 5, errors: 0 });
    await composed.jobs.scheduler.trigger(RETENTION_GC_SCHEDULE_NAME);
    expect(await repo.totals({ since: 0, keyIds: ['pbk_old'] })).toEqual({ requests: 0, errors: 0 });
    expect((await repo.totals({ since: 0 })).requests).toBe(9);
  }, 90_000);
});
