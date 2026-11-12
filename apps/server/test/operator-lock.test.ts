// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Set by the operator": a setting the environment decides
 * travels in its reply with `{ allowed: false, reason }`, reads as the value
 * it is locked to, and a save that would change it is refused with
 * `SET_BY_OPERATOR`. Proved on a whole composed server for the settings the
 * trial environment decides today: the two outbound-call consents and "Allow
 * databases on this server".
 */
import BetterSqlite3 from 'better-sqlite3';
import { createSqliteMetaDb, firstRun, settingsRepo, type MetaDb } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { composeServer, type ComposedServer } from '../src/compose.js';
import { enforceProfile } from '../src/config/env.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { createUpdateCheckService } from '../src/telemetry/update-check.js';
import { trialPolicy } from '../src/trial/policy.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

const PASSWORD = 'a-long-enough-test-password-1!';

const TRIAL = {
  ADMINIUM_TRIAL_MODE: 'on',
  ADMINIUM_TRIAL_ENDS_AT: '2099-12-01T00:00:00Z',
  ADMINIUM_PUBLIC_ORIGIN: 'https://hollis.try.example.com',
  ADMINIUM_DATABASE_HOSTS: 'pg-trials:5432',
  ADMINIUM_SETUP_TOKEN: 'a-long-enough-setup-token',
};
const HOSTED = { ADMINIUM_HOSTED_MODE: 'on', ADMINIUM_PUBLIC_ORIGIN: 'https://hollis.example.com', ADMINIUM_DATABASE_HOSTS: 'pg-trials:5432' };

let composed: ComposedServer | undefined;
let meta: MetaDb | undefined;
afterEach(async () => {
  await composed?.app.close();
  composed = undefined;
  await meta?.db.destroy();
  meta = undefined;
});

interface Server {
  call(method: 'GET' | 'PUT', url: string, payload?: unknown): Promise<{ status: number; body: Record<string, unknown> }>;
  meta: MetaDb;
}

/** A composed server on `env`, its first account made with the consent `consent`. */
async function server(env: Record<string, string>, consent = { telemetry: true, updateCheck: true }, before?: (store: MetaDb) => Promise<void>): Promise<Server> {
  const store = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  meta = store;
  await firstRun(store);
  await before?.(store);
  // As the boot reads it: what the profile implies is enforced.
  const parsed = enforceProfile(makeEnv({ HOST: '127.0.0.1', ...env }));
  const runService = createRunService({ meta: store });
  const metaStore: MetaStoreHandle = { meta: store, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() };
  composed = await composeServer({
    env: parsed,
    metaStore,
    manager: new ConnectionManager({ meta: store, crypto: dsnCryptoFromSecret(TEST_SECRET), metaDsn: null, blockLoopback: true, databaseHosts: parsed.ADMINIUM_DATABASE_HOSTS }),
    runService,
    applyService: createApplyService({ meta: store, runService }),
    allowed: { templates: [], widgets: [], widgetContracts: {} },
    logger: false,
    telemetry: false,
    onMetaRelocated: () => undefined,
  });
  const { app } = composed;
  await app.ready();
  const setup = await app.inject({
    method: 'POST',
    url: '/api/v1/setup/super-admin',
    payload: { email: 'owner@example.test', password: PASSWORD, name: 'Dana Price', consent, setupToken: TRIAL.ADMINIUM_SETUP_TOKEN },
  });
  expect(setup.statusCode, setup.body).toBe(201);
  const cookie = String(setup.headers['set-cookie']).split(';')[0] ?? '';
  return {
    meta: store,
    call: async (method, url, payload) => {
      const res = await app.inject({ method, url, headers: { cookie }, ...(payload === undefined ? {} : { payload: payload as object }) });
      return { status: res.statusCode, body: res.json() as Record<string, unknown> };
    },
  };
}

const LOCKED_TRIAL = { allowed: false, reason: 'trial-mode' };
const OPEN = { allowed: true, reason: null };

describe('the outbound-call consents', { timeout: 60_000 }, () => {
  it('in trial mode: locked off, read as off, a change refused, nothing written', async () => {
    const s = await server(TRIAL);
    // Setup's consent cannot switch them on: the operator's word stands.
    const settings = settingsRepo(s.meta);
    expect(await settings.get('telemetry.enabled')).toBe(false);
    expect(await settings.get('updates.checkEnabled')).toBe(false);

    expect((await s.call('GET', '/api/v1/settings/telemetry')).body).toEqual({
      data: { telemetry: false, updateCheck: false, locks: { telemetry: LOCKED_TRIAL, updateCheck: LOCKED_TRIAL } },
    });

    const refused = await s.call('PUT', '/api/v1/settings/telemetry', { telemetry: false, updateCheck: true });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ error: { code: 'SET_BY_OPERATOR', details: { setting: 'updates.checkEnabled', reason: 'trial-mode' } } });
    expect(await settings.get('updates.checkEnabled')).toBe(false);

    // Saying what it is locked to is no change.
    expect((await s.call('PUT', '/api/v1/settings/telemetry', { telemetry: false, updateCheck: false })).status).toBe(200);
  });

  it('in trial mode a value stored before the lock is not obeyed: About says off, and the release check stays quiet', async () => {
    const s = await server(TRIAL, { telemetry: false, updateCheck: false }, async (store) => {
      await settingsRepo(store).set('updates.checkEnabled', true);
    });
    await settingsRepo(s.meta).set('updates.checkEnabled', true);
    await settingsRepo(s.meta).set('telemetry.enabled', true);
    expect((await s.call('GET', '/api/v1/settings/telemetry')).body).toMatchObject({ data: { telemetry: false, updateCheck: false } });
    expect((await s.call('GET', '/api/v1/about')).body).toMatchObject({ data: { telemetry: { enabled: false }, updates: { checkEnabled: false } } });
    expect(await s.call('GET', '/api/v1/about/update-check')).toEqual({ status: 200, body: { data: { status: 'disabled' } } });

    let fetched = 0;
    const updates = createUpdateCheckService({
      meta: s.meta,
      version: '0.0.1',
      policy: trialPolicy(makeEnv(TRIAL)),
      fetchImpl: async () => {
        fetched += 1;
        return new Response('[]');
      },
    });
    expect(await updates.isEnabled()).toBe(false);
    expect(await updates.check()).toEqual({ status: 'disabled' });
    expect(fetched).toBe(0);
  });

  it('on an ordinary server and a hosted one: open, as before', async () => {
    for (const env of [{}, HOSTED]) {
      const s = await server(env);
      expect((await s.call('GET', '/api/v1/settings/telemetry')).body).toEqual({ data: { telemetry: true, updateCheck: true, locks: { telemetry: OPEN, updateCheck: OPEN } } });
      expect((await s.call('PUT', '/api/v1/settings/telemetry', { telemetry: false, updateCheck: true })).status).toBe(200);
      expect(await settingsRepo(s.meta).get('telemetry.enabled')).toBe(false);
      await composed?.app.close();
      composed = undefined;
      await meta?.db.destroy();
      meta = undefined;
    }
  });
});

describe('"Allow databases on this server"', { timeout: 60_000 }, () => {
  for (const [name, env, reason] of [
    ['trial mode', TRIAL, 'trial-mode'],
    ['the hosted profile', HOSTED, 'hosted-mode'],
  ] as const) {
    it(`under ${name}: locked off with the profile's reason, a switch-on refused as SET_BY_OPERATOR`, async () => {
      const s = await server(env, undefined, async (store) => {
        await settingsRepo(store).set('connections.allowLocalDatabases', true);
      });
      expect((await s.call('GET', '/api/v1/settings/local-databases')).body).toMatchObject({ allowed: false, on: false, reason, hosts: ['pg-trials:5432'] });
      const refused = await s.call('PUT', '/api/v1/settings/local-databases', { on: true, password: PASSWORD });
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({ error: { code: 'SET_BY_OPERATOR', details: { setting: 'connections.allowLocalDatabases', reason } } });
    });
  }

  it('locked by ADMINIUM_LOCAL_DATABASES=off alone: the same refusal, reason not-allowed', async () => {
    const s = await server({ ADMINIUM_LOCAL_DATABASES: 'off' });
    expect((await s.call('GET', '/api/v1/settings/local-databases')).body).toMatchObject({ allowed: false, reason: 'not-allowed' });
    const refused = await s.call('PUT', '/api/v1/settings/local-databases', { on: true, password: PASSWORD });
    expect(refused.body).toMatchObject({ error: { code: 'SET_BY_OPERATOR', details: { setting: 'connections.allowLocalDatabases', reason: 'not-allowed' } } });
  });
});
