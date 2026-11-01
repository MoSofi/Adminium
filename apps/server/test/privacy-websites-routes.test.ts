// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "YOUR WEBSITES" AND THE REACH CARD on the whole server, its meta store on
 * SQLite, Postgres and MySQL:
 *
 *  - a holder of the privacy action lists websites several at once, every
 *    line checked, all or none (each refused line comes back with its code,
 *    and nothing is added), sees who listed each, and removes one; each add
 *    and remove is in the audit log with the origins;
 *  - a staff member without the action (the settings grant alone) is
 *    refused every one of these routes;
 *  - the reach card reads the forms door's own answer: no public address,
 *    an https one, and a proxy that is not trusted;
 *  - listing a website opens nothing to it: no `/api/v1/` route answers it
 *    with `Access-Control-Allow-Origin`, signed in or not.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AdapterRegistry, type AdapterProvider } from '@adminium/engine/adapter';
import { createFirstSuperAdmin, permissionsRepo, rolesRepo, settingsRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { composeServer, type ComposedServer } from '../src/compose.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { registerAdapters } from '../src/connections/register-adapters.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

const STUDIO = 'https://studio.meridian.example';
const SHOP = 'https://shop.meridian.example';

interface Site {
  origin: string;
  addedBy: { id: string; name: string } | null;
  addedAt: number;
}

describe.each(META_ENGINES)('"Your websites" and the reach card — $name', (engine) => {
  let handle: MetaHandle;
  let composed: ComposedServer;
  let dataDir = '';
  const cookie: Record<string, string> = {};
  const ids: Record<string, string> = {};
  let logins = 0;

  const call = (who: string | null, method: 'GET' | 'POST', url: string, payload?: unknown, headers: Record<string, string> = {}) =>
    composed.app.inject({ method, url, headers: { host: 'crm.meridian.example', ...(who === null ? {} : { cookie: cookie[who]! }), ...headers }, ...(payload === undefined ? {} : { payload: payload as never }) });
  const sites = (res: { json: () => unknown }) => (res.json() as { data: { websites: Site[] } }).data.websites;

  beforeAll(async () => {
    if (!engine.available) return;
    handle = await engine.make();
    const { meta } = handle;
    dataDir = await mkdtemp(join(tmpdir(), 'privacy-websites-'));
    const hash = await adminPasswordHash();
    await createFirstSuperAdmin(meta, { email: 'owner@websites.test', name: 'Tessa Marlow', passwordHash: hash });
    const users = usersRepo(meta);
    const roles = rolesRepo(meta);
    const grants = permissionsRepo(meta);
    // Pia answers access requests: the privacy action alone. Mara runs the settings: everything but it.
    const officer = await roles.create({ slug: 'privacy-officer', name: 'Privacy officer' });
    await grants.grant(officer.id, 'system', 'privacy.manage', { allowed: true });
    const settingsOnly = await roles.create({ slug: 'settings-only', name: 'Settings' });
    await grants.grant(settingsOnly.id, 'system', 'settings.manage', { allowed: true });
    for (const [name, role] of [['pia', officer.id], ['mara', settingsOnly.id]] as const) {
      const user = await users.create({ email: `${name}@websites.test`, name: name === 'pia' ? 'Pia Lund' : 'Mara Holt', passwordHash: hash });
      await roles.assignToUser(user.id, role);
    }
    const registry = new AdapterRegistry<AdapterProvider>();
    await registerAdapters(registry);
    const manager = new ConnectionManager({ meta, crypto: dsnCryptoFromSecret(TEST_SECRET), registry, metaDsn: null, blockLoopback: false });
    const runService = createRunService({ meta });
    const store: MetaStoreHandle = { meta, url: `${engine.name}://test`, engine: engine.name, source: 'embedded', close: async () => Promise.resolve() };
    composed = await composeServer({
      env: makeEnv({ HOST: '127.0.0.1', ADMINIUM_DATA_DIR: dataDir, ADMINIUM_SECRET: TEST_SECRET, ADMINIUM_CORS_ORIGINS: STUDIO }),
      metaStore: store,
      manager,
      runService,
      applyService: createApplyService({ meta, runService }),
      allowed: null,
      logger: false,
      telemetry: false,
    });
    await composed.app.ready();
    await composed.jobs.worker.stop();
    composed.jobs.scheduler.stop();
    for (const name of ['owner', 'pia', 'mara']) {
      logins += 1;
      const res = await composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.21.0.${String(logins)}`, payload: { email: `${name}@websites.test`, password: ADMIN_PASSWORD } });
      expect(res.statusCode, res.body).toBe(200);
      cookie[name] = sessionCookie(res.headers['set-cookie']);
      ids[name] = (await users.findByEmail(`${name}@websites.test`))!.id;
    }
  }, 120_000);

  afterAll(async () => {
    if (!engine.available) return;
    await composed?.app.close();
    await handle?.destroy();
    await rm(dataDir, { recursive: true, force: true });
  });

  it.skipIf(!engine.available)('lists websites all or none, names who listed each, removes one, and audits both', async () => {
    await settingsRepo(handle.meta).set('system.publicOrigin', 'https://crm.meridian.example', { updatedBy: null });
    const empty = await call('pia', 'GET', '/api/v1/privacy/websites');
    expect(empty.statusCode, empty.body).toBe(200);
    expect(empty.json()).toEqual({ data: { websites: [], max: 50 } });

    // The comp's sample: every line refused with its own code, in order, and nothing added.
    const refused = await call('pia', 'POST', '/api/v1/privacy/websites', { lines: ['http://events.meridian.example', 'https://*.meridian.example', 'https://crm.meridian.example', 'https://events.meridian.example/forms', 'https://www.meridian.example'] });
    expect(refused.statusCode, refused.body).toBe(422);
    const details = (refused.json() as { error: { details: { lines: { line: string; code: string }[]; tooMany: boolean } } }).error.details;
    expect(details.lines.map((line) => line.code)).toEqual(['https', 'one-per-line', 'self', 'path', 'ok']);
    expect(details.tooMany).toBe(false);
    expect(sites(await call('pia', 'GET', '/api/v1/privacy/websites'))).toEqual([]);

    const added = await call('pia', 'POST', '/api/v1/privacy/websites', { lines: ['https://WWW.meridian.example/', `${SHOP}:443`] });
    expect(added.statusCode, added.body).toBe(200);
    expect(sites(added)).toEqual([
      { origin: 'https://www.meridian.example', addedBy: { id: ids['pia'], name: 'Pia Lund' }, addedAt: expect.any(Number) },
      { origin: SHOP, addedBy: { id: ids['pia'], name: 'Pia Lund' }, addedAt: expect.any(Number) },
    ]);
    const twice = await call('owner', 'POST', '/api/v1/privacy/websites', { lines: [SHOP] });
    expect((twice.json() as { error: { details: { lines: { code: string }[] } } }).error.details.lines.map((line) => line.code)).toEqual(['listed']);

    const removed = await call('owner', 'POST', '/api/v1/privacy/websites/remove', { origin: 'https://www.meridian.example' });
    expect(removed.statusCode, removed.body).toBe(200);
    expect(sites(removed).map((site) => site.origin)).toEqual([SHOP]);
    expect((await call('owner', 'POST', '/api/v1/privacy/websites/remove', { origin: 'https://www.meridian.example' })).statusCode).toBe(404);

    const audit = await handle.meta.db.selectFrom('adminium_audit_log').select(['action', 'actorId', 'changes']).where('action', 'like', 'privacy.websites.%').orderBy('createdAt', 'asc').execute();
    const changes = (value: unknown) => (typeof value === 'string' ? JSON.parse(value) : value) as Record<string, unknown>;
    expect(audit.map((row) => [row.action, row.actorId, changes(row.changes)])).toEqual([
      ['privacy.websites.add', ids['pia'], { after: { origins: ['https://www.meridian.example', SHOP] } }],
      ['privacy.websites.remove', ids['owner'], { before: { origin: 'https://www.meridian.example' } }],
    ]);
  });

  it.skipIf(!engine.available)('refuses a staff member without the privacy action every route, and asks nothing of a list they cannot see', async () => {
    for (const [method, url, payload] of [
      ['GET', '/api/v1/privacy/websites', undefined],
      ['POST', '/api/v1/privacy/websites', { lines: ['https://mara.example'] }],
      ['POST', '/api/v1/privacy/websites/remove', { origin: SHOP }],
      ['GET', '/api/v1/privacy/reach', undefined],
    ] as const) {
      const res = await call('mara', method, url, payload);
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
    expect((await call(null, 'GET', '/api/v1/privacy/websites')).statusCode).toBe(401);
    expect(sites(await call('pia', 'GET', '/api/v1/privacy/websites')).map((site) => site.origin)).toEqual([SHOP]);
  });

  it.skipIf(!engine.available)('the reach card reads the forms door’s own answer', async () => {
    const settings = settingsRepo(handle.meta);
    const reach = async (headers: Record<string, string> = {}) => (await call('pia', 'GET', '/api/v1/privacy/reach', undefined, headers)).json() as { data: { state: string; origin: string | null; checkedAt: number } };
    await settings.set('system.publicOrigin', null, { updatedBy: null });
    expect((await reach()).data).toMatchObject({ state: 'not-set', origin: null });
    await settings.set('system.publicOrigin', 'http://crm.meridian.example', { updatedBy: null });
    expect((await reach()).data).toMatchObject({ state: 'not-https', origin: 'http://crm.meridian.example' });
    await settings.set('system.publicOrigin', 'https://crm.meridian.example', { updatedBy: null });
    const ok = (await reach()).data;
    expect(ok).toMatchObject({ state: 'reachable', origin: 'https://crm.meridian.example' });
    expect(ok.checkedAt).toBeGreaterThan(0);
    // A proxy forwards the request and is not trusted: the forms door refuses, and the card says so.
    expect((await reach({ 'x-forwarded-for': '203.0.113.9' })).data.state).toBe('proxy-hidden');
  });

  it.skipIf(!engine.available)('opens nothing to a listed website: no /api/v1/ route answers it with an allowed origin', async () => {
    expect(sites(await call('pia', 'GET', '/api/v1/privacy/websites')).map((site) => site.origin)).toContain(SHOP);
    for (const url of ['/api/v1/healthz', '/api/v1/auth/me', '/api/v1/bootstrap', '/api/v1/privacy/websites', '/api/v1/privacy/notice/public', '/api/v1/public/challenge?purpose=write']) {
      for (const who of [null, 'pia'] as const) {
        const res = await call(who, 'GET', url, undefined, { origin: SHOP });
        expect(res.headers['access-control-allow-origin'], `${url} ${who ?? 'stranger'}`).toBeUndefined();
      }
      const preflight = await composed.app.inject({ method: 'OPTIONS', url, headers: { host: 'crm.meridian.example', origin: SHOP, 'access-control-request-method': 'POST' } });
      expect(preflight.headers['access-control-allow-origin'], `OPTIONS ${url}`).toBeUndefined();
    }
    // The server's own listed origin still is.
    const studio = await call(null, 'GET', '/api/v1/healthz', undefined, { origin: STUDIO });
    expect(studio.headers['access-control-allow-origin']).toBe(STUDIO);
  });
});
