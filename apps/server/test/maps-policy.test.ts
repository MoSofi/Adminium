// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Whether maps are on, and what follows from it: the content security
 * policy names the map server only while they are, the bootstrap hands a
 * signed-in page the address only then, and Settings → Maps reads and writes
 * the two switches without ever taking an address.
 */
import BetterSqlite3 from 'better-sqlite3';
import { auditRepo, createFirstSuperAdmin, createSqliteMetaDb, firstRun, rolesRepo, settingsRepo, usersRepo, type MetaDb } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { composeServer, type ComposedServer } from '../src/compose.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { createMapPolicy, MAP_SETTING_LIFE_MS, withMapServer } from '../src/geo/map-policy.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import { ADMIN_PASSWORD, adminPasswordHash, buildAuthApp, login, sessionCookie, type AuthTestApp } from './auth-helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

const DEFAULT = 'https://tiles.openfreemap.org';

/** Each directive of a policy by its name. */
function directives(policy: unknown): Map<string, string> {
  return new Map(
    String(policy)
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part !== '')
      .map((part) => [part.split(' ')[0] as string, part] as const),
  );
}

/** The directives that name `host`. */
function naming(policy: unknown, host: string): string[] {
  return [...directives(policy)].filter(([, text]) => text.includes(host)).map(([name]) => name);
}

/** Every source in the policy that is another site (not this server's own socket). */
function outside(policy: unknown): string[] {
  return String(policy)
    .split(/[\s;]+/)
    .filter((word) => /^https?:\/\//.test(word));
}

let fixture: AuthTestApp | undefined;
let composed: { server: ComposedServer; meta: MetaDb } | undefined;

afterEach(async () => {
  await fixture?.destroy();
  fixture = undefined;
  if (composed !== undefined) {
    await composed.server.app.close();
    await composed.meta.db.destroy();
    composed = undefined;
  }
});

async function policyOf(env: Record<string, string> = {}): Promise<unknown> {
  fixture = await buildAuthApp({ env: makeEnv(env) });
  const res = await fixture.app.inject({ method: 'GET', url: '/api/v1/healthz' });
  return res.headers['content-security-policy'];
}

describe('the content security policy and the map server', () => {
  it('names the default map server for connections and pictures, and nowhere else', async () => {
    const policy = await policyOf();
    expect(naming(policy, DEFAULT)).toEqual(['img-src', 'connect-src']);
    expect(directives(policy).get('img-src')).toBe(`img-src 'self' data: blob: ${DEFAULT}`);
    expect(directives(policy).get('connect-src')).toBe(`connect-src 'self' ws://localhost:80 wss://localhost:80 ${DEFAULT}`);
    // The map draws in a worker made from a blob: that stays whatever the switch says.
    expect(directives(policy).get('worker-src')).toBe("worker-src 'self' blob:");
    expect(outside(policy)).toEqual([DEFAULT, DEFAULT]);
  });

  it('names no outside host when the operator says off', async () => {
    const policy = await policyOf({ ADMINIUM_MAP_SERVER: 'off' });
    expect(outside(policy)).toEqual([]);
    expect(directives(policy).get('img-src')).toBe("img-src 'self' data: blob:");
    expect(directives(policy).get('connect-src')).toBe("connect-src 'self' ws://localhost:80 wss://localhost:80");
    expect(directives(policy).get('worker-src')).toBe("worker-src 'self' blob:");
  });

  it('names no outside host in the desktop app', async () => {
    expect(outside(await policyOf({ ADMINIUM_RUNTIME: 'desktop' }))).toEqual([]);
  });

  it('names a server of the operator’s own, and only that one', async () => {
    const policy = await policyOf({ ADMINIUM_MAP_SERVER: 'https://tiles.example.com:8443' });
    expect(naming(policy, 'https://tiles.example.com:8443')).toEqual(['img-src', 'connect-src']);
    expect(String(policy)).not.toContain('openfreemap');
    expect(outside(policy)).toEqual(['https://tiles.example.com:8443', 'https://tiles.example.com:8443']);
  });

  it('follows the setting: off from the next reply once somebody says no, on again after a yes', async () => {
    fixture = await buildAuthApp();
    const read = async (): Promise<unknown> => (await fixture!.app.inject({ method: 'GET', url: '/api/v1/healthz' })).headers['content-security-policy'];
    // Nobody was asked yet: maps are on.
    expect(await settingsRepo(fixture.meta).get('maps.enabled')).toBeNull();
    expect(outside(await read())).toEqual([DEFAULT, DEFAULT]);

    await settingsRepo(fixture.meta).set('maps.enabled', false, { updatedBy: null });
    fixture.app.maps.drop();
    expect(outside(await read())).toEqual([]);

    await settingsRepo(fixture.meta).set('maps.enabled', true, { updatedBy: null });
    fixture.app.maps.drop();
    expect(outside(await read())).toEqual([DEFAULT, DEFAULT]);
  });

  it('leaves a policy of another shape alone', () => {
    // A sandboxed document's own policy shows none of this server's pages: it gains nothing.
    const sandboxed = "default-src 'none'; img-src data:; sandbox";
    expect(withMapServer(sandboxed, DEFAULT)).toBe(sandboxed);
  });
});

describe('the one answer everybody reads', () => {
  const env = { ADMINIUM_MAP_SERVER: DEFAULT, ADMINIUM_ROUTING_SERVER: 'https://router.project-osrm.org', ADMINIUM_RUNTIME: 'self-host', ADMINIUM_NETWORK_FEATURES: true } as const;

  function reader(values: { enabled: boolean | null; routing: boolean }) {
    let reads = 0;
    return {
      values,
      reads: () => reads,
      get: (async (key: 'maps.enabled' | 'maps.routing') => {
        reads += 1;
        return key === 'maps.enabled' ? values.enabled : values.routing;
      }) as never,
    };
  }

  it('is on with nobody asked, and routing is off until somebody says yes', async () => {
    const policy = createMapPolicy(env);
    expect(await policy.read()).toEqual({ enabled: true, server: DEFAULT, routing: false, routingServer: null });
    const settings = reader({ enabled: null, routing: true });
    policy.attach(settings);
    expect(await policy.read()).toEqual({ enabled: true, server: DEFAULT, routing: true, routingServer: 'https://router.project-osrm.org' });
  });

  it('is off, with no address, on any of the three noes', async () => {
    const off = { enabled: false, server: null, routing: false, routingServer: null };
    const yes = reader({ enabled: true, routing: true });
    const byEnv = createMapPolicy({ ...env, ADMINIUM_MAP_SERVER: 'off' });
    byEnv.attach(yes);
    expect(await byEnv.read()).toEqual(off);
    // Decided without asking the store at all.
    expect(yes.reads()).toBe(0);
    const byRuntime = createMapPolicy({ ...env, ADMINIUM_RUNTIME: 'desktop' });
    byRuntime.attach(yes);
    expect(await byRuntime.read()).toEqual(off);
    const bySetting = createMapPolicy(env);
    bySetting.attach(reader({ enabled: false, routing: true }));
    expect(await bySetting.read()).toEqual(off);
  });

  it('keeps routing off when the routing server is off or outside calls are', async () => {
    const yes = reader({ enabled: true, routing: true });
    const noServer = createMapPolicy({ ...env, ADMINIUM_ROUTING_SERVER: 'off' });
    noServer.attach(yes);
    expect(await noServer.read()).toMatchObject({ enabled: true, routing: false, routingServer: null });
    const airGapped = createMapPolicy({ ...env, ADMINIUM_NETWORK_FEATURES: false });
    airGapped.attach(yes);
    expect(await airGapped.read()).toMatchObject({ enabled: true, server: DEFAULT, routing: false, routingServer: null });
  });

  it('remembers the setting for half a minute at most, and forgets it when told', async () => {
    let clock = 1_000;
    const policy = createMapPolicy(env, () => clock);
    const settings = reader({ enabled: true, routing: false });
    policy.attach(settings);
    await policy.read();
    await policy.read();
    expect(settings.reads()).toBe(2);
    // Another process wrote the store: this one follows when the memory runs out.
    settings.values.enabled = false;
    clock += MAP_SETTING_LIFE_MS - 1;
    expect((await policy.read()).enabled).toBe(true);
    clock += 1;
    expect((await policy.read()).enabled).toBe(false);
    settings.values.enabled = true;
    policy.drop();
    expect((await policy.read()).enabled).toBe(true);
  });
});

async function compose(env: Record<string, string> = {}): Promise<{ server: ComposedServer; meta: MetaDb; cookie: string; viewer: string }> {
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  const hash = await adminPasswordHash();
  await createFirstSuperAdmin(meta, { email: 'owner@maps.test', name: 'Owner', passwordHash: hash });
  const viewer = await usersRepo(meta).create({ email: 'viewer@maps.test', name: 'Viewer', passwordHash: hash });
  await rolesRepo(meta).assignToUser(viewer.id, (await rolesRepo(meta).findBySlug('viewer'))!.id);
  const manager = new ConnectionManager({ meta, crypto: dsnCryptoFromSecret(TEST_SECRET), metaDsn: null });
  const runService = createRunService({ meta });
  const server = await composeServer({
    env: makeEnv({ HOST: '127.0.0.1', ...env }),
    metaStore: { meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() },
    manager,
    runService,
    applyService: createApplyService({ meta, runService }),
    allowed: null,
    logger: false,
    telemetry: false,
  });
  await server.app.ready();
  await server.jobs.worker.stop();
  server.jobs.scheduler.stop();
  composed = { server, meta };
  const sign = async (email: string): Promise<string> => {
    const res = await server.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: ADMIN_PASSWORD } });
    expect(res.statusCode, res.body).toBe(200);
    return sessionCookie(res.headers['set-cookie']);
  };
  return { server, meta, cookie: await sign('owner@maps.test'), viewer: await sign('viewer@maps.test') };
}

async function csrfOf(server: ComposedServer, cookie: string): Promise<string> {
  const res = await server.app.inject({ method: 'GET', url: '/api/v1/bootstrap', headers: { cookie } });
  return (res.json() as { data: { csrfToken: string } }).data.csrfToken;
}

describe('Settings → Maps', () => {
  it('shows the switches and the servers, and writes the switches only', async () => {
    const { server, meta, cookie } = await compose();
    const app = server.app;
    const first = await app.inject({ method: 'GET', url: '/api/v1/settings/maps', headers: { cookie } });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toEqual({
      data: {
        enabled: true,
        routing: false,
        mapServer: DEFAULT,
        mapServerOff: false,
        routingServer: 'https://router.project-osrm.org',
        routingServerOff: false,
        runtime: 'self-host',
      },
    });
    const headers = { cookie, 'x-csrf-token': await csrfOf(server, cookie) };

    // The policy named the map server a moment ago; the write counts on the very next reply.
    expect(outside(first.headers['content-security-policy'])).toEqual([DEFAULT, DEFAULT]);
    const off = await app.inject({ method: 'PUT', url: '/api/v1/settings/maps', headers, payload: { enabled: false } });
    expect(off.statusCode, off.body).toBe(200);
    expect((off.json() as { data: { enabled: boolean; routing: boolean } }).data).toMatchObject({ enabled: false, routing: false, mapServer: DEFAULT });
    expect(await settingsRepo(meta).get('maps.enabled')).toBe(false);
    const after = await app.inject({ method: 'GET', url: '/api/v1/healthz' });
    expect(outside(after.headers['content-security-policy'])).toEqual([]);
    const boot = await app.inject({ method: 'GET', url: '/api/v1/bootstrap', headers: { cookie } });
    expect((boot.json() as { data: { maps: unknown } }).data.maps).toEqual({ enabled: false, server: null, routing: false });

    // Each switch on its own: routing on leaves "show maps" as it was.
    const routed = await app.inject({ method: 'PUT', url: '/api/v1/settings/maps', headers, payload: { routing: true } });
    expect((routed.json() as { data: unknown }).data).toMatchObject({ enabled: false, routing: true });
    // Routing follows roads only while maps are on.
    expect(((await app.inject({ method: 'GET', url: '/api/v1/bootstrap', headers: { cookie } })).json() as { data: { maps: unknown } }).data.maps).toEqual({ enabled: false, server: null, routing: false });
    await app.inject({ method: 'PUT', url: '/api/v1/settings/maps', headers, payload: { enabled: true } });
    expect(((await app.inject({ method: 'GET', url: '/api/v1/bootstrap', headers: { cookie } })).json() as { data: { maps: unknown } }).data.maps).toEqual({ enabled: true, server: DEFAULT, routing: true });

    // An address is never taken here.
    for (const payload of [{ mapServer: 'https://evil.example.com' }, { enabled: true, routingServer: 'https://evil.example.com' }, { enabled: 'yes' }]) {
      const refused = await app.inject({ method: 'PUT', url: '/api/v1/settings/maps', headers, payload });
      expect(refused.statusCode, JSON.stringify(payload)).toBe(422);
    }
    expect(String((await app.inject({ method: 'GET', url: '/api/v1/healthz' })).headers['content-security-policy'])).not.toContain('evil');

    const audit = (await auditRepo(meta).list({ category: 'settings' })).filter((entry) => entry.action === 'settings.maps.update');
    expect(audit).toHaveLength(3);
    expect(audit.map((entry) => entry.changes)).toContainEqual({ before: { enabled: true, routing: false }, after: { enabled: false, routing: false } });
  });

  it('is for whoever manages settings', async () => {
    const { server, viewer } = await compose();
    const read = await server.app.inject({ method: 'GET', url: '/api/v1/settings/maps', headers: { cookie: viewer } });
    expect(read.statusCode).toBe(403);
    const write = await server.app.inject({ method: 'PUT', url: '/api/v1/settings/maps', headers: { cookie: viewer, 'x-csrf-token': await csrfOf(server, viewer) }, payload: { enabled: false } });
    expect(write.statusCode).toBe(403);
    expect(outside((await server.app.inject({ method: 'GET', url: '/api/v1/healthz' })).headers['content-security-policy'])).toEqual([DEFAULT, DEFAULT]);
    // Signed out, nothing answers.
    expect((await server.app.inject({ method: 'GET', url: '/api/v1/settings/maps' })).statusCode).toBe(401);
  });

  it('says what the operator switched off, and the switches then do nothing', async () => {
    const { server, cookie } = await compose({ ADMINIUM_MAP_SERVER: 'off', ADMINIUM_ROUTING_SERVER: 'off' });
    const res = await server.app.inject({ method: 'GET', url: '/api/v1/settings/maps', headers: { cookie } });
    expect((res.json() as { data: unknown }).data).toEqual({ enabled: true, routing: false, mapServer: null, mapServerOff: true, routingServer: null, routingServerOff: true, runtime: 'self-host' });
    const boot = await server.app.inject({ method: 'GET', url: '/api/v1/bootstrap', headers: { cookie } });
    expect((boot.json() as { data: { maps: unknown } }).data.maps).toEqual({ enabled: false, server: null, routing: false });
  });

  it('counts an air-gapped install’s routing server as off', async () => {
    const { server, cookie } = await compose({ ADMINIUM_NETWORK_FEATURES: 'off' });
    const res = await server.app.inject({ method: 'GET', url: '/api/v1/settings/maps', headers: { cookie } });
    expect((res.json() as { data: unknown }).data).toMatchObject({ mapServer: DEFAULT, mapServerOff: false, routingServer: null, routingServerOff: true });
  });
});

describe('the bootstrap', () => {
  it('hands a signed-in page the map server while maps are on', async () => {
    fixture = await buildAuthApp();
    const { cookie } = await login(fixture.app);
    const res = await fixture.app.inject({ method: 'GET', url: '/api/v1/bootstrap', headers: { cookie: cookie as string } });
    expect((res.json() as { data: { maps: unknown } }).data.maps).toEqual({ enabled: true, server: DEFAULT, routing: false });
  });

  it('holds no address in the desktop app', async () => {
    fixture = await buildAuthApp({ env: makeEnv({ ADMINIUM_RUNTIME: 'desktop' }) });
    const { cookie } = await login(fixture.app);
    const res = await fixture.app.inject({ method: 'GET', url: '/api/v1/bootstrap', headers: { cookie: cookie as string } });
    expect((res.json() as { data: { maps: unknown } }).data.maps).toEqual({ enabled: false, server: null, routing: false });
  });
});
