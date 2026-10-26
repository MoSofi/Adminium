// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The mail door on the real server (`composeServer`): registered on every
 * install with the public API closed, its form parser kept to itself (the
 * rest of the API still answers a form body 415), its paths never falling
 * through to the dashboard, and served on a host mapped to an app's customer
 * side, the notice route included.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createSqliteMetaDb, firstRun, settingsRepo, type MetaDb } from '@adminium/meta';

import { discoverSurfaces } from '../src/cli/surfaces-root.js';
import type { ComposedServer } from '../src/compose.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { mailLinkKeys } from '../src/email/link-keys.js';
import { createNoticeEndpoints } from '../src/email/notices/endpoints.js';
import { makeUnsubscribeToken } from '../src/email/unsubscribe-token.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { customerHostAllows, isHostReservedPath } from '../src/plugins/surfaces.js';
import { makeEnv, TEST_SECRET } from './helpers.js';
import { fixtureText } from './relay-notice-helpers.js';

const DASH_HTML = '<!doctype html><html><body data-app="dashboard"></body></html>';
const CUSTOMER_HTML = '<!doctype html><html><body data-app="clients-customer"></body></html>';
const CUSTOMER_HOST = 'shop.meridian.example';
const NAVIGATE = { 'sec-fetch-mode': 'navigate', accept: 'text/html' };

let root: string;
let meta: MetaDb;
let composed: ComposedServer;
let token: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'mail-door-server-'));
  const dist = join(root, 'dist');
  await mkdir(join(dist, 'assets'), { recursive: true });
  await writeFile(join(dist, 'index.html'), DASH_HTML);
  const customer = join(root, 'surfaces', 'clients', 'customer');
  await mkdir(customer, { recursive: true });
  await writeFile(join(customer, 'index.html'), CUSTOMER_HTML);
  const noBundle = join(root, 'no-bundle');
  await mkdir(noBundle);

  meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  await settingsRepo(meta).set('system.publicOrigin', 'https://news.meridian.example', { updatedBy: null });
  await settingsRepo(meta).set('system.instanceId', 'install-1', { updatedBy: null });
  await settingsRepo(meta).set('branding.appName', 'Meridian', { updatedBy: null });
  await settingsRepo(meta).set('surfaces.domains', { [CUSTOMER_HOST]: { appKey: 'clients', side: 'customer' } }, { updatedBy: null });
  token = makeUnsubscribeToken(await mailLinkKeys(meta, TEST_SECRET).unsubscribe(), 'install-1', { address: 'marta@cobaltlegal.example', purpose: 'newsletter' });

  process.env['ADMINIUM_BUNDLED_ADD_ONS'] = noBundle;
  process.env['ADMINIUM_BUNDLED_APPS'] = noBundle;
  const { composeServer } = await import('../src/compose.js');
  const runService = createRunService({ meta });
  const metaStore: MetaStoreHandle = { meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() };
  composed = await composeServer({
    // The public API is NOT opened: the door must not depend on it.
    env: makeEnv({ ADMINIUM_DATA_DIR: join(root, 'data'), HOST: '127.0.0.1' }),
    metaStore,
    manager: new ConnectionManager({ meta, crypto: dsnCryptoFromSecret(TEST_SECRET), metaDsn: null }),
    runService,
    applyService: createApplyService({ meta, runService }),
    allowed: null,
    staticRoot: dist,
    surfaces: discoverSurfaces(join(root, 'surfaces')),
    logger: false,
    telemetry: false,
  });
  await composed.app.ready();
});

afterAll(async () => {
  delete process.env['ADMINIUM_BUNDLED_ADD_ONS'];
  delete process.env['ADMINIUM_BUNDLED_APPS'];
  await composed?.app.close();
  await meta?.db.destroy();
  await rm(root, { recursive: true, force: true });
});

describe('the mail door on the real server', () => {
  it('serves the unsubscribe page with the public API closed, and takes the one-click form body', async () => {
    const page = await composed.app.inject({ method: 'GET', url: `/m/u/${token}`, headers: NAVIGATE });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('name="act" value="one"');
    // Its own policy, not the dashboard's: no script source at all.
    expect(String(page.headers['content-security-policy'])).toContain("default-src 'none'");
    expect(String(page.headers['content-security-policy'])).not.toContain('script-src');
    const oneClick = await composed.app.inject({
      method: 'POST',
      url: `/m/u/${token}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'List-Unsubscribe=One-Click',
    });
    expect(oneClick.statusCode).toBe(200);
  });

  it('the rest of the API still answers a form body 415: the form parser is the door’s alone', async () => {
    for (const url of ['/api/v1/auth/login', '/api/v1/auth/logout', '/api/v1/consent/stop-list']) {
      const res = await composed.app.inject({ method: 'POST', url, headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'email=a%40b.example&password=x' });
      expect(res.statusCode, url).toBe(415);
    }
  });

  it('never falls through to the dashboard: /m/c/ and the rest say "not available", other verbs a plain 404', async () => {
    for (const url of ['/m/c/abc', '/m/', '/m/nope/deeper']) {
      const res = await composed.app.inject({ method: 'GET', url, headers: NAVIGATE });
      expect(res.statusCode, url).toBe(404);
      expect(res.body, url).toContain('This page isn’t available.');
      expect(res.body, url).not.toContain('data-app=');
    }
    for (const req of [
      { method: 'GET' as const, url: '/m' },
      { method: 'POST' as const, url: '/m/c/abc' },
      { method: 'DELETE' as const, url: `/m/u/${token}` },
    ]) {
      const res = await composed.app.inject({ ...req, headers: NAVIGATE });
      expect(res.statusCode, `${req.method} ${req.url}`).toBe(404);
      expect(res.body, `${req.method} ${req.url}`).not.toContain('data-app=');
    }
  });

  it('answers on a host mapped to an app’s customer side: the page, the click path and the notices', async () => {
    const page = await composed.app.inject({ method: 'GET', url: `/m/u/${token}`, headers: { host: CUSTOMER_HOST, ...NAVIGATE } });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('marta@cobaltlegal.example');
    expect(page.body).not.toContain('clients-customer');
    const reserved = await composed.app.inject({ method: 'GET', url: '/m/c/abc', headers: { host: CUSTOMER_HOST, ...NAVIGATE } });
    expect(reserved.body).toContain('This page isn’t available.');
    // The app's own pages are still the app's.
    expect((await composed.app.inject({ method: 'GET', url: '/mine', headers: { host: CUSTOMER_HOST, ...NAVIGATE } })).body).toContain('clients-customer');

    const other = (await createNoticeEndpoints({ meta, secret: TEST_SECRET }).open('other'))!;
    const notice = await composed.app.inject({
      method: 'POST',
      url: `/api/v1/email/notices/other/${other.token}`,
      headers: { host: CUSTOMER_HOST, 'content-type': 'application/json' },
      payload: fixtureText('other-events.json'),
    });
    expect(notice.statusCode).toBe(200);
    expect(notice.json()).toEqual({ received: true });
    // Another part of the API is still not the customer host's.
    expect((await composed.app.inject({ method: 'GET', url: '/api/v1/consent/stop-list', headers: { host: CUSTOMER_HOST } })).statusCode).toBe(404);
  });

  it('the host rules name the door’s paths, and no wider', () => {
    for (const side of ['staff', 'customer'] as const) {
      expect(isHostReservedPath('/m/u/abc', side)).toBe(true);
      expect(isHostReservedPath('/m', side)).toBe(true);
      expect(isHostReservedPath('/mine', side)).toBe(false);
    }
    expect(customerHostAllows('/m/u/abc', 'clients')).toBe(true);
    expect(customerHostAllows('/m/l/abc', 'clients')).toBe(true);
    expect(customerHostAllows('/api/v1/email/notices/ses/tok', 'clients')).toBe(true);
    expect(customerHostAllows('/api/v1/email/other', 'clients')).toBe(false);
  });
});
