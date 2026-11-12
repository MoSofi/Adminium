// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Trial mode's switches, one `describe` each: every switch OFF under
 * `ADMINIUM_TRIAL_MODE=on`, ON without it, and as the hosted profile keeps or
 * drops it. Proved on a whole composed server wherever a route is the door,
 * and on the hook itself where the door is a job or a client.
 *
 * Connections (A1), storage (A1b), outgoing traffic and AI (A2).
 */
import BetterSqlite3 from 'better-sqlite3';
import { llmKeyCryptoFromSecret, ProviderError, type ProviderClient } from '@adminium/llm';
import { createSqliteMetaDb, firstRun, settingsRepo, type Automation, type MetaDb } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { ActionFailure, type ActionContext } from '../src/automations/actions/types.js';
import { runWebhookAction } from '../src/automations/actions/webhook.js';
import { TRACE_EN } from '../src/automations/trace.js';
import { resolveRule } from '../src/automations/validate.js';
import { createAddOnHttpClient, AddOnEgressError } from '../src/add-ons/egress.js';
import { openRuntime } from '../src/cli/runtime.js';
import { composeServer, type ComposedServer } from '../src/compose.js';
import { enforceProfile, type Env } from '../src/config/env.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { decryptSecret, deriveKey, encryptSecret } from '../src/config/secrets.js';
import { createAiEnv } from '../src/llm/ai-env.js';
import { createAiConnections } from '../src/llm/connections.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import { guardBootMetaUrl, MetaUrlError, type MetaStoreHandle } from '../src/meta/store.js';
import type { HostLookup } from '../src/net/address-guard.js';
import { trialPolicy } from '../src/trial/policy.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

const PASSWORD = 'a-long-enough-test-password-1!';
const SETUP_TOKEN = 'a-long-enough-setup-token';

const TRIAL = {
  ADMINIUM_TRIAL_MODE: 'on',
  ADMINIUM_TRIAL_ENDS_AT: '2099-12-01T00:00:00Z',
  ADMINIUM_PUBLIC_ORIGIN: 'https://hollis.try.example.com',
  ADMINIUM_DATABASE_HOSTS: 'pg-trials:5432,*.pooler.supabase.com:6543',
  ADMINIUM_SETUP_TOKEN: SETUP_TOKEN,
  ADMINIUM_SOURCE_URL: 'postgres://trial_hollis:secret@pg-trials:5432/trial_hollis',
};
const HOSTED = {
  ADMINIUM_HOSTED_MODE: 'on',
  ADMINIUM_PUBLIC_ORIGIN: 'https://hollis.example.com',
  ADMINIUM_DATABASE_HOSTS: 'pg-trials:5432,*.pooler.supabase.com:6543',
  ADMINIUM_SOURCE_URL: 'postgres://trial_hollis:secret@pg-trials:5432/trial_hollis',
};
/** An ordinary server with the same host list, so only the profile differs. */
const OFF = { ADMINIUM_DATABASE_HOSTS: 'pg-trials:5432,*.pooler.supabase.com:6543' };

/** No name resolves: a DSN that gets past the profile ends at the lookup (502), never at a database. */
const NOTHING_RESOLVES: HostLookup = async () => Promise.reject(new Error('ENOTFOUND'));

let composed: ComposedServer | undefined;
let meta: MetaDb | undefined;
afterEach(async () => {
  await composed?.app.close();
  composed = undefined;
  await meta?.db.destroy();
  meta = undefined;
});

interface Reply {
  status: number;
  body: Record<string, unknown>;
}

interface Server {
  /** As the first account, once it exists; anonymous before. */
  call(method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: unknown): Promise<Reply>;
  env: Env;
}

/** A composed server on `env`, its manager built as the boot builds it; the first account made unless `account` is false. */
async function server(raw: Record<string, string>, opts: { account?: boolean } = {}): Promise<Server> {
  const store = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  meta = store;
  await firstRun(store);
  const env = enforceProfile(makeEnv({ HOST: '127.0.0.1', ...raw }));
  const runService = createRunService({ meta: store });
  const metaStore: MetaStoreHandle = { meta: store, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() };
  composed = await composeServer({
    env,
    metaStore,
    // As `openRuntime` builds it: the profile, the host list and the operator's login.
    manager: new ConnectionManager({
      meta: store,
      crypto: dsnCryptoFromSecret(TEST_SECRET),
      metaDsn: null,
      blockLoopback: true,
      databaseHosts: env.ADMINIUM_DATABASE_HOSTS,
      networkPolicy: env.ADMINIUM_NETWORK_POLICY,
      lookup: NOTHING_RESOLVES,
      policy: trialPolicy(env),
      operatorSourceUrl: env.ADMINIUM_SOURCE_URL,
    }),
    runService,
    applyService: createApplyService({ meta: store, runService }),
    allowed: { templates: [], widgets: [], widgetContracts: {} },
    logger: false,
    telemetry: false,
    onMetaRelocated: () => undefined,
  });
  const { app } = composed;
  await app.ready();
  let cookie = '';
  if (opts.account !== false) {
    const setup = await app.inject({
      method: 'POST',
      url: '/api/v1/setup/super-admin',
      payload: { email: 'owner@example.test', password: PASSWORD, name: 'Dana Price', setupToken: SETUP_TOKEN },
    });
    expect(setup.statusCode, setup.body).toBe(201);
    cookie = String(setup.headers['set-cookie']).split(';')[0] ?? '';
  }
  return {
    env,
    call: async (method, url, payload) => {
      const res = await app.inject({ method, url, headers: cookie === '' ? {} : { cookie }, ...(payload === undefined ? {} : { payload: payload as object }) });
      return { status: res.statusCode, body: res.json() as Record<string, unknown> };
    },
  };
}

const offBy = (question: string, reason = 'trial-mode') => ({ error: { code: 'OFF_BY_OPERATOR', details: { question, reason } } });
const code = (reply: Reply): unknown => (reply.body['error'] as { code?: unknown } | undefined)?.code;

// ── A1 connections ─────────────────────────────────────────────────────────

describe('A1 connections', { timeout: 60_000 }, () => {
  const test = (s: Server, engine: string, dsn: string) => s.call('POST', '/api/v1/connections/test', { engine, dsn });

  it('a SQLite source: refused in trial mode and the hosted profile, opened as before on an ordinary server', async () => {
    for (const [env, reason] of [
      [TRIAL, 'trial-mode'],
      [HOSTED, 'hosted-mode'],
    ] as const) {
      const s = await server(env);
      const refused = await test(s, 'sqlite', 'sqlite:/tmp/p75-t11-anything.db');
      expect(refused.status).toBe(403);
      expect(refused.body).toMatchObject(offBy('sqliteSources', reason));
      // The other front door, saving one, is the same guard.
      expect((await s.call('POST', '/api/v1/connections', { name: 'Local', engine: 'sqlite', dsn: 'sqlite:/tmp/p75-t11-anything.db' })).body).toMatchObject(offBy('sqliteSources', reason));
      await composed?.app.close();
      composed = undefined;
    }
    const open = await test(await server(OFF), 'sqlite', 'sqlite:/tmp/p75-t11-missing.db');
    expect(code(open)).not.toBe('OFF_BY_OPERATOR');
  });

  it('a host not on the list: refused in trial mode before any lookup; an ordinary server looks it up', async () => {
    const trial = await server(TRIAL);
    expect((await test(trial, 'postgres', 'postgres://me:pw@db.elsewhere.example:5432/shop')).body).toMatchObject(offBy('unlistedDatabaseHosts'));
    // MySQL passes only through a listed entry that takes MySQL: this list names Postgres's port.
    expect((await test(trial, 'mysql', 'mysql://trial_hollis:pw@pg-trials:3306/trial_hollis')).body).toMatchObject(offBy('unlistedDatabaseHosts'));
    await composed?.app.close();
    composed = undefined;

    const open = await test(await server(OFF), 'postgres', 'postgres://me:pw@db.elsewhere.example:5432/shop');
    expect(open.status).toBe(502);
    expect(code(open)).toBe('HOST_LOOKUP_FAILED');
  });

  it('on an operator host only the operator\'s login: another refused in trial mode, the person\'s own Supabase project left alone', async () => {
    const trial = await server(TRIAL);
    for (const dsn of [
      'postgres://trial_other:pw@pg-trials:5432/trial_other',
      'postgres://trial_hollis:pw@pg-trials:5432/trial_other',
      'postgres://postgres:pw@pg-trials:5432/trial_hollis',
    ]) {
      expect((await test(trial, 'postgres', dsn)).body, dsn).toMatchObject(offBy('anyDatabaseLogin'));
    }
    // The operator's own login (any password: the database checks that) passes on to the lookup.
    expect(code(await test(trial, 'postgres', 'postgres://trial_hollis:typed@pg-trials:5432/trial_hollis'))).toBe('HOST_LOOKUP_FAILED');
    // A Supabase pooler on the list is the person's own project: any login of theirs.
    expect(code(await test(trial, 'postgres', 'postgres://postgres.abcd:pw@aws-0-eu.pooler.supabase.com:6543/postgres'))).toBe('HOST_LOOKUP_FAILED');
    await composed?.app.close();
    composed = undefined;

    const open = await server(OFF);
    expect(code(await test(open, 'postgres', 'postgres://trial_other:pw@pg-trials:5432/trial_other'))).toBe('HOST_LOOKUP_FAILED');
  });

  it('connection tests: one budget for the whole installation in trial mode, none on an ordinary server', async () => {
    const trial = await server(TRIAL);
    for (let i = 0; i < 10; i += 1) expect((await test(trial, 'postgres', 'postgres://trial_hollis:pw@pg-trials:5432/trial_hollis')).status).toBe(502);
    const limited = await test(trial, 'postgres', 'postgres://trial_hollis:pw@pg-trials:5432/trial_hollis');
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ error: { code: 'RATE_LIMITED', details: { scope: 'instance', limit: 10 } } });
    await composed?.app.close();
    composed = undefined;

    const open = await server(OFF);
    for (let i = 0; i < 11; i += 1) expect((await test(open, 'postgres', 'postgres://trial_hollis:pw@pg-trials:5432/trial_hollis')).status).toBe(502);
  });

  it('the meta store is fixed: relocate, probe and adopt answer 403 in trial mode, the setup token opening none of them', async () => {
    // Before the first account, with the right token: the token is the trial user's, so it must not open these.
    const fresh = await server(TRIAL, { account: false });
    const dsn = 'postgres://u:p@pg-trials:5432/other';
    expect(await fresh.call('POST', '/api/v1/setup/probe', { dsn, setupToken: SETUP_TOKEN })).toMatchObject({ status: 403, body: offBy('metaStoreRoutes') });
    expect(await fresh.call('POST', '/api/v1/setup/adopt', { dsn, setupToken: SETUP_TOKEN })).toMatchObject({ status: 403, body: offBy('metaStoreRoutes') });
    await composed?.app.close();
    composed = undefined;

    const trial = await server(TRIAL);
    expect(await trial.call('POST', '/api/v1/meta/relocate', { dsn })).toMatchObject({ status: 403, body: offBy('metaStoreRoutes') });
    expect((await trial.call('GET', '/api/v1/meta/placement')).body).toMatchObject({ data: { canRelocate: false, reason: expect.stringContaining('operator') } });
    await composed?.app.close();
    composed = undefined;

    const hosted = await server(HOSTED, { account: false });
    expect(await hosted.call('POST', '/api/v1/setup/probe', { dsn, setupToken: SETUP_TOKEN })).toMatchObject({ status: 403, body: offBy('metaStoreRoutes', 'hosted-mode') });
    await composed?.app.close();
    composed = undefined;

    // An ordinary server: the probe answers (the host does not resolve, so it says it could not reach it).
    const open = await server(OFF, { account: false });
    const probe = await open.call('POST', '/api/v1/setup/probe', { dsn: 'sqlite::memory:', setupToken: SETUP_TOKEN });
    expect(probe.status, JSON.stringify(probe.body)).toBe(200);
    expect((await open.call('GET', '/api/v1/setup/state')).status).toBe(200);
  });
});

// ── the meta store's address at boot ───────────────────────────────────────

describe('the meta store address at boot', () => {
  const resolved = (url: string) => ({ url, engine: 'postgres' as const, source: 'env' as const });
  const answers =
    (table: Record<string, string[]>): HostLookup =>
    async (host) =>
      table[host] ?? Promise.reject(new Error('ENOTFOUND'));

  it('every install refuses a name, an address or a host parameter that reaches cloud metadata', async () => {
    const lookup = answers({ 'meta.internal.example': ['169.254.169.254'] });
    for (const url of [
      'postgres://u:p@meta.internal.example:5432/adminium',
      'postgres://u:p@169.254.169.254:5432/adminium',
      'postgres://u:p@db.example:5432/adminium?host=169.254.169.254',
    ]) {
      await expect(guardBootMetaUrl(resolved(url), { lookup }), url).rejects.toThrow(MetaUrlError);
    }
  });

  it('every install keeps a meta store on this machine, its own network, or a name that does not resolve yet', async () => {
    const lookup = answers({ postgres: ['172.18.0.2'], localhost: ['127.0.0.1'] });
    for (const url of ['postgres://u:p@localhost:5432/adminium', 'postgres://u:p@postgres:5432/adminium', 'postgres://u:p@not-up-yet:5432/adminium']) {
      await expect(guardBootMetaUrl(resolved(url), { lookup }), url).resolves.toBeUndefined();
    }
    await expect(guardBootMetaUrl({ url: 'sqlite:/elsewhere/meta.db', engine: 'sqlite', source: 'env' })).resolves.toBeUndefined();
  });

  it('trial mode holds it to the typed meta DSN guard before it dials; an ordinary server goes on to dial', async () => {
    // A parameter the source guard refuses (it would have the driver read a file); a missing file, so nothing here can hang.
    const url = 'postgres://u:p@localhost:1/adminium?sslrootcert=/nonexistent/p75-t11-root.pem';
    const trial = enforceProfile(makeEnv({ ...TRIAL, ADMINIUM_META_URL: url, ADMINIUM_DATA_DIR: '/tmp/p75-t11-boot' }));
    await expect(openRuntime(trial)).rejects.toThrow(/ADMINIUM_META_URL is refused/);
    // Without the profile the parameter is the operator's business: the boot reaches the database (nothing listens on port 1).
    const open = makeEnv({ ADMINIUM_META_URL: url, ADMINIUM_DATA_DIR: '/tmp/p75-t11-boot' });
    await expect(openRuntime(open)).rejects.not.toThrow(/is refused/);
  });
});

// ── A1b storage ────────────────────────────────────────────────────────────

describe('A1b storage', { timeout: 60_000 }, () => {
  const s3 = { name: 'Bucket', driver: 's3', config: { bucket: 'b', region: 'eu-west-1', endpoint: 'https://s3.example.com', prefix: 'files', forcePathStyle: false }, secret: { accessKeyId: 'AKIAEXAMPLE', secretAccessKey: 'example-secret' } };

  it('in trial mode and the hosted profile: no destination made, tested or picked; only local', async () => {
    for (const [env, reason] of [
      [TRIAL, 'trial-mode'],
      [HOSTED, 'hosted-mode'],
    ] as const) {
      const s = await server(env);
      expect(await s.call('POST', '/api/v1/storage/destinations', s3)).toMatchObject({ status: 403, body: offBy('storageDestinations', reason) });
      expect(await s.call('POST', '/api/v1/storage/destinations/test', s3)).toMatchObject({ status: 403, body: offBy('storageDestinations', reason) });
      expect(await s.call('POST', '/api/v1/storage/destinations/dst_any/test')).toMatchObject({ status: 403, body: offBy('storageDestinations', reason) });
      expect(await s.call('POST', '/api/v1/storage/destinations/dst_any/default')).toMatchObject({ status: 403, body: offBy('storageDestinations', reason) });
      // The default local destination is still listed.
      expect((await s.call('GET', '/api/v1/storage/destinations')).status).toBe(200);
      await composed?.app.close();
      composed = undefined;
    }
  });

  it('on an ordinary server: the same calls reach the destination code', async () => {
    const s = await server(OFF);
    expect(code(await s.call('POST', '/api/v1/storage/destinations/dst_any/test'))).toBe('NOT_FOUND');
    expect(code(await s.call('POST', '/api/v1/storage/destinations/dst_any/default'))).toBe('NOT_FOUND');
    expect(code(await s.call('POST', '/api/v1/storage/destinations', s3))).not.toBe('OFF_BY_OPERATOR');
  });
});

// ── A2 outgoing traffic ────────────────────────────────────────────────────

describe('A2 the webhook step', () => {
  const webhook = { kind: 'webhook', url: 'https://hooks.example.com/in', method: 'POST', bodyKind: 'json', body: null, headerName: null, headerValueEncrypted: null } as const;
  const graph = { version: 1, nodes: [{ id: 'n1', kind: 'trigger', title: 'Trigger' }, { id: 'n2', kind: 'action', title: 'Tell', onError: false, action: webhook }] } as never;
  const trigger = { kind: 'schedule', connectionId: null, schedule: { kind: 'interval', everyMinutes: '15' } } as never;
  const save = (env: Record<string, string>) => () => resolveRule(trigger, graph, { view: null, templateKeys: new Set<string>(), blockLoopback: false, policy: trialPolicy(makeEnv(env)) });

  it('is refused at the save in trial mode, kept by the hosted profile and an ordinary server', () => {
    expect(save(TRIAL)).toThrow(expect.objectContaining({ code: 'OFF_BY_OPERATOR', details: { question: 'webhooks', reason: 'trial-mode' } }));
    expect(save(HOSTED)).not.toThrow();
    expect(save(OFF)).not.toThrow();
  });

  it('is refused at the run in trial mode, before anything is sent; sent otherwise', async () => {
    const sent: string[] = [];
    const ctx = (env: Record<string, string>) =>
      ({
        meta: null,
        manager: { outboundPolicy: { blockLoopback: false, blockPrivate: false, lookup: async () => ['203.0.113.7'] } },
        app: { trialPolicy: trialPolicy(makeEnv(env)) },
        rule: { id: 'rule_1', name: 'Tell the hook' } as Automation,
        runId: 'run_1',
        hops: 0,
        now: Date.now(),
        source: null,
        tokens: {},
        text: TRACE_EN,
        secret: 's'.repeat(32),
        fetch: async (url: string | URL) => {
          sent.push(String(url));
          return new Response('ok');
        },
      }) as unknown as ActionContext;
    await expect(runWebhookAction(webhook as never, ctx(TRIAL))).rejects.toThrow(ActionFailure);
    expect(sent).toEqual([]);
    await runWebhookAction(webhook as never, ctx(OFF));
    await runWebhookAction(webhook as never, ctx(HOSTED));
    expect(sent).toHaveLength(2);
  });
});

describe('A2 add-on HTTP', () => {
  it('every add-on is refused in trial mode, a declared host included; the hosted profile and an ordinary server call it', async () => {
    let calls = 0;
    const client = (env: Record<string, string>) =>
      createAddOnHttpClient({
        key: 'payments-stripe',
        allow: ['api.stripe.com'],
        hasOutboundHttp: true,
        policy: trialPolicy(makeEnv(env)),
        fetchImpl: async () => {
          calls += 1;
          return new Response('{}');
        },
      });
    await expect(client(TRIAL)('https://api.stripe.com/v1/balance')).rejects.toMatchObject({ name: 'AddOnEgressError', reason: 'OFF_BY_OPERATOR' });
    await expect(client(TRIAL)('https://api.stripe.com/v1/balance')).rejects.toBeInstanceOf(AddOnEgressError);
    expect(calls).toBe(0);
    expect((await client(HOSTED)('https://api.stripe.com/v1/balance')).status).toBe(200);
    expect((await client(OFF)('https://api.stripe.com/v1/balance')).status).toBe(200);
    expect(calls).toBe(2);
  });
});

describe('A2 payment services, maps, the update check and telemetry', { timeout: 60_000 }, () => {
  it('in trial mode: payments say the operator switched them off and refuse a key; maps and routing are off; both calls home locked off', async () => {
    const s = await server(TRIAL);
    expect((await s.call('GET', '/api/v1/payments/setup')).body).toMatchObject({ data: { reachability: { state: 'operator-off' } } });
    expect(await s.call('PUT', '/api/v1/payments/services/payments-stripe/modes/test/fields/secret_key', { value: 'rk_test_abc' })).toMatchObject({
      status: 403,
      body: offBy('paymentProviders'),
    });
    expect((await s.call('GET', '/api/v1/settings/maps')).body).toMatchObject({ data: { mapServerOff: true, routingServerOff: true } });
    expect((await s.call('GET', '/api/v1/settings/telemetry')).body).toMatchObject({ data: { telemetry: false, updateCheck: false } });
    expect(await s.call('GET', '/api/v1/about/update-check')).toEqual({ status: 200, body: { data: { status: 'disabled' } } });
    expect(s.env.ADMINIUM_TELEMETRY).toBe(false);
  });

  it('on an ordinary server and a hosted one: payments reach the service code, maps keep their servers', async () => {
    for (const env of [OFF, HOSTED]) {
      const s = await server(env);
      expect((await s.call('GET', '/api/v1/payments/setup')).body).not.toMatchObject({ data: { reachability: { state: 'operator-off' } } });
      expect(code(await s.call('PUT', '/api/v1/payments/services/payments-stripe/modes/test/fields/secret_key', { value: 'rk_test_abc' }))).not.toBe('OFF_BY_OPERATOR');
      expect((await s.call('GET', '/api/v1/settings/maps')).body).toMatchObject({ data: { mapServerOff: false } });
      await composed?.app.close();
      composed = undefined;
    }
  });
});

describe('A2 the Designer\'s picture search and Figma', () => {
  it('call out only where the server does, and never in trial mode', async () => {
    const { designerCallsOut } = await import('../src/trial/refuse.js');
    expect(designerCallsOut(true, trialPolicy(makeEnv(TRIAL)))).toBe(false);
    expect(designerCallsOut(true, trialPolicy(makeEnv(HOSTED)))).toBe(true);
    expect(designerCallsOut(true, trialPolicy(makeEnv(OFF)))).toBe(true);
    expect(designerCallsOut(false, trialPolicy(makeEnv(OFF)))).toBe(false);
  });
});

// ── A2 AI ──────────────────────────────────────────────────────────────────

describe('A2 AI addresses', { timeout: 60_000 }, () => {
  it('in trial mode: no typed address and no provider reached at one; the person\'s own key to a fixed provider stays', async () => {
    const s = await server(TRIAL);
    expect(await s.call('PUT', '/api/v1/llm/config', { provider: 'openai-compatible', baseUrl: 'https://models.example.com/v1', model: 'm' })).toMatchObject({
      status: 403,
      body: offBy('customAiProviders'),
    });
    expect(await s.call('PUT', '/api/v1/llm/config', { provider: 'ollama' })).toMatchObject({ status: 403, body: offBy('customAiProviders') });
    expect(await s.call('PUT', '/api/v1/llm/config', { provider: 'anthropic', baseUrl: 'https://proxy.example.com' })).toMatchObject({
      status: 409,
      body: { error: { code: 'SET_BY_OPERATOR', details: { setting: 'llm.baseUrl', reason: 'trial-mode' } } },
    });
    const own = await s.call('PUT', '/api/v1/llm/config', { provider: 'anthropic', apiKey: 'sk-ant-own-key-1234', model: 'claude-sonnet-5-5' });
    expect(own.status, JSON.stringify(own.body)).toBe(200);
    expect(own.body).toMatchObject({
      provider: 'anthropic',
      baseUrl: null,
      locks: { baseUrl: { allowed: false, reason: 'trial-mode' }, customProviders: { allowed: false, reason: 'trial-mode' } },
    });
  });

  it('a model connection: a typed address refused in a test and a save, a saved one never dialled, in trial mode only', async () => {
    const store = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    meta = store;
    await firstRun(store);
    const keyCrypto = llmKeyCryptoFromSecret(TEST_SECRET, { deriveKey, encryptSecret, decryptSecret });
    let listed = 0;
    const connections = (env: Record<string, string>) =>
      createAiConnections({
        settings: settingsRepo(store),
        keyCrypto,
        aiEnv: createAiEnv({ root: null, fromEnvironment: {} }),
        networkFeatures: true,
        production: false,
        resolve: async () => ['93.184.216.34'],
        createClient: () => ({ listModels: async () => { listed += 1; return []; } }) as unknown as ProviderClient,
        policy: trialPolicy(makeEnv(env)),
      });
    const draft = { provider: 'openai-compatible' as const, baseUrl: 'https://models.example.com/v1' };
    expect(await connections(TRIAL).test(draft)).toMatchObject({ ok: false, error: { code: 'config' } });
    await expect(connections(TRIAL).save({ ...draft, model: 'm' })).rejects.toMatchObject({ code: 'OFF_BY_OPERATOR', details: { question: 'aiBaseUrl' } });
    expect(listed).toBe(0);
    expect(await connections(OFF).test(draft)).toMatchObject({ ok: true });
    expect(listed).toBe(1);

    // Saved before the switch (or carried in): refused where it would be dialled.
    await settingsRepo(store).set('llm.provider', 'openai-compatible');
    await settingsRepo(store).set('llm.baseUrl', 'https://models.example.com/v1');
    await expect(connections(TRIAL).client('database')).rejects.toBeInstanceOf(ProviderError);
    await expect(connections(OFF).client('database')).resolves.toMatchObject({ provider: 'openai-compatible' });
  });

  it('on an ordinary server: an address of one\'s own is saved as before', async () => {
    const s = await server(OFF);
    const saved = await s.call('PUT', '/api/v1/llm/config', { provider: 'openai-compatible', baseUrl: 'https://models.example.com/v1', model: 'm' });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toMatchObject({ provider: 'openai-compatible', baseUrl: 'https://models.example.com/v1', locks: { baseUrl: { allowed: true }, customProviders: { allowed: true } } });
  });
});
