// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `GET /api/v1/readyz?deep=1` (plan 75 §5.2 A8): what plain `readyz` waits for
 * (the meta store, the bundled packages staged), and also the add-on runtime
 * load, which the boot does in the background after the server answers. A
 * waker that sends the first request after a deep yes reaches a dashboard
 * that can serve it.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSqliteMetaDb, firstRun, type MetaDb } from '@adminium/meta';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { composeServer } from '../src/compose.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { makeEnv } from './helpers.js';

let app: AdminiumServer | undefined;
let meta: MetaDb | undefined;

afterEach(async () => {
  await app?.close();
  await meta?.db.destroy();
  app = undefined;
  meta = undefined;
});

interface Ready {
  ok: boolean;
  checks: { meta: string; packages: string; addOns?: string };
}

async function server(state: { seeding: boolean; loading: boolean }): Promise<AdminiumServer> {
  meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  app = await buildServer({ env: makeEnv(), metaDb: meta, logger: false });
  // What the composed server decorates (`compose.ts`): a bare one has nothing to wait for.
  app.decorate('packagesSeeding', () => state.seeding);
  app.decorate('addOnsLoading', () => state.loading);
  await app.ready();
  return app;
}

const ask = async (url: string): Promise<{ status: number; body: Ready }> => {
  const res = await app!.inject({ method: 'GET', url });
  return { status: res.statusCode, body: res.json<Ready>() };
};

describe('readyz?deep=1', () => {
  it('waits for the add-on runtime as well; plain readyz does not', async () => {
    const state = { seeding: false, loading: true };
    await server(state);
    expect(await ask('/api/v1/readyz')).toEqual({ status: 200, body: expect.objectContaining({ ok: true, checks: { meta: 'ok', packages: 'ok' } }) });
    expect(await ask('/api/v1/readyz?deep=1')).toEqual({ status: 503, body: expect.objectContaining({ ok: false, checks: { meta: 'ok', packages: 'ok', addOns: 'loading' } }) });

    state.loading = false;
    expect(await ask('/api/v1/readyz?deep=1')).toEqual({ status: 200, body: expect.objectContaining({ ok: true, checks: { meta: 'ok', packages: 'ok', addOns: 'ok' } }) });
  });

  it('still waits for what plain readyz waits for', async () => {
    const state = { seeding: true, loading: false };
    await server(state);
    expect(await ask('/api/v1/readyz?deep=1')).toEqual({ status: 503, body: expect.objectContaining({ ok: false, checks: { meta: 'ok', packages: 'seeding', addOns: 'ok' } }) });
  });

  it('takes only 1 for deep, and refuses another value', async () => {
    await server({ seeding: false, loading: true });
    expect((await ask('/api/v1/readyz?deep=0')).status).toBe(200);
    expect((await app!.inject({ method: 'GET', url: '/api/v1/readyz?deep=yes' })).statusCode).toBe(422);
  });
});

describe('the composed server', () => {
  it('says when its add-ons have loaded', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'adminium-readyz-deep-'));
    try {
      const env = makeEnv({ ADMINIUM_DATA_DIR: dataDir });
      meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
      await firstRun(meta);
      const runService = createRunService({ meta });
      const metaStore: MetaStoreHandle = { meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() };
      const composed = await composeServer({
        env,
        metaStore,
        manager: new ConnectionManager({ meta, crypto: dsnCryptoFromSecret(env.ADMINIUM_SECRET), metaDsn: null }),
        runService,
        applyService: createApplyService({ meta, runService }),
        allowed: { templates: [], widgets: [], widgetContracts: {} },
        logger: false,
        telemetry: false,
        onMetaRelocated: () => undefined,
      });
      app = composed.app as unknown as AdminiumServer;
      await app.ready();
      // The boot loads the add-ons in the background: deep turns ready once it has, and stays so.
      await vi.waitFor(async () => expect(await ask('/api/v1/readyz?deep=1')).toEqual({ status: 200, body: expect.objectContaining({ ok: true, checks: { meta: 'ok', packages: 'ok', addOns: 'ok' } }) }), {
        timeout: 15_000,
        interval: 50,
      });
      expect((await ask('/api/v1/readyz')).body.checks).toEqual({ meta: 'ok', packages: 'ok' });
    } finally {
      await app?.close();
      app = undefined;
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
