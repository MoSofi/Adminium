// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A trial's start costs a start and nothing more: it sleeps and wakes many
 * times a day, so the start does not ask adminium.dev for its lists (the daily
 * tick and the Add-ons page still do). An ordinary server started for people
 * asks, as before. Proved on a whole composed server, both ways.
 */
import BetterSqlite3 from 'better-sqlite3';
import { createSqliteMetaDb, firstRun, settingsRepo, type MetaDb } from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { composeServer, type ComposedServer } from '../src/compose.js';
import { enforceProfile } from '../src/config/env.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { CATALOG_REFRESH_KIND } from '../src/jobs/add-on-acquire.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { trialPolicy } from '../src/trial/policy.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

const TRIAL = {
  ADMINIUM_TRIAL_MODE: 'on',
  ADMINIUM_TRIAL_ENDS_AT: '2099-12-01T00:00:00Z',
  ADMINIUM_PUBLIC_ORIGIN: 'https://hollis.try.example.com',
  ADMINIUM_DATABASE_HOSTS: 'pg-trials:5432',
  ADMINIUM_SETUP_TOKEN: 'a-long-enough-setup-token',
};
const HOSTED = {
  ADMINIUM_HOSTED_MODE: 'on',
  ADMINIUM_PUBLIC_ORIGIN: 'https://hollis.try.example.com',
  ADMINIUM_DATABASE_HOSTS: 'pg-trials:5432',
};

let composed: ComposedServer | undefined;
let meta: MetaDb | undefined;

beforeEach(() => {
  // No list is really fetched: a refresh job that runs fails at once.
  vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('no network in this test'))));
});
afterEach(async () => {
  await composed?.app.close();
  composed = undefined;
  await meta?.db.destroy();
  meta = undefined;
  vi.unstubAllGlobals();
});

/** A server composed as `adminium start` composes one (it asks for the lists at start), with both lists switched on and never fetched. */
async function start(env: Record<string, string>): Promise<MetaDb> {
  const store = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  meta = store;
  await firstRun(store);
  await settingsRepo(store).set('addOns.catalogEnabled', true, { updatedBy: null });
  const parsed = enforceProfile(makeEnv({ HOST: '127.0.0.1', ADMINIUM_NETWORK_FEATURES: 'on', ...env }));
  const runService = createRunService({ meta: store });
  const metaStore: MetaStoreHandle = { meta: store, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() };
  composed = await composeServer({
    catalogBootRefresh: true,
    env: parsed,
    metaStore,
    manager: new ConnectionManager({
      meta: store,
      crypto: dsnCryptoFromSecret(TEST_SECRET),
      metaDsn: null,
      blockLoopback: true,
      databaseHosts: parsed.ADMINIUM_DATABASE_HOSTS,
      networkPolicy: parsed.ADMINIUM_NETWORK_POLICY,
      policy: trialPolicy(parsed),
    }),
    runService,
    applyService: createApplyService({ meta: store, runService }),
    allowed: { templates: [], widgets: [], widgetContracts: {} },
    logger: false,
    telemetry: false,
    onMetaRelocated: () => undefined,
  });
  await composed.app.ready();
  return store;
}

async function refreshesAsked(store: MetaDb): Promise<number> {
  const rows = await store.db.selectFrom('adminium_jobs').select('id').where('kind', '=', CATALOG_REFRESH_KIND).execute();
  return rows.length;
}

describe('the lists asked for at start', () => {
  it('an ordinary server asks for them', async () => {
    expect(await refreshesAsked(await start({}))).toBe(1);
  });

  it('a paid hosted installation asks for them, as an ordinary server does', async () => {
    expect(await refreshesAsked(await start(HOSTED))).toBe(1);
  });

  it('a trial does not', async () => {
    expect(await refreshesAsked(await start(TRIAL))).toBe(0);
  });
});
