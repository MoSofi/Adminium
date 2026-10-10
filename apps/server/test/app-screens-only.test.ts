// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Someone whose every role opens only an app's own screens — a till's cashier:
 * the dashboard sends them to their screens, the API answers only what those
 * screens need, and the screens' own config carries who they are and the
 * token their writes carry.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createFirstSuperAdmin,
  createSqliteMetaDb,
  firstRun,
  permissionsRepo,
  rolesRepo,
  settingsRepo,
  usersRepo,
  assistantSessionsRepo,
  type MetaDb,
} from '@adminium/meta';

import type { AdminiumServer } from '../src/app.js';
import { ADD_ON_DOCUMENT_ROUTE, ADD_ON_LOOK_UP_ROUTE, STAFF_WORDS_ROUTE, allowedForScreensOnly } from '../src/apps/screens-only.js';
import { discoverSurfaces } from '../src/cli/surfaces-root.js';
import { composeServer } from '../src/compose.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { matrixRowsFromGrants } from '../src/rbac/permissions.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

let surfacesDir: string;
let meta: MetaDb;
let app: AdminiumServer;

beforeAll(async () => {
  surfacesDir = await mkdtemp(join(tmpdir(), 'adminium-screens-'));
  await mkdir(join(surfacesDir, 'clients', 'staff'), { recursive: true });
  await writeFile(join(surfacesDir, 'clients', 'staff', 'index.html'), '<body data-app="clients-staff"></body>', 'utf8');
  meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  await createFirstSuperAdmin(meta, { email: 'owner@example.com', name: 'Owner', passwordHash: await adminPasswordHash() });
  const store: MetaStoreHandle = { meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() };
  const runService = createRunService({ meta });
  const composed = await composeServer({
    env: makeEnv(),
    metaStore: store,
    manager: new ConnectionManager({ meta, crypto: dsnCryptoFromSecret(TEST_SECRET), metaDsn: null }),
    runService,
    applyService: createApplyService({ meta, runService }),
    allowed: { templates: [], widgets: [], widgetContracts: {} },
    logger: false,
    telemetry: false,
    onMetaRelocated: () => undefined,
    surfaces: discoverSurfaces(surfacesDir),
  });
  app = composed.app;
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await rm(surfacesDir, { recursive: true, force: true });
});

/** Someone holding the given roles (made fresh), signed in. */
async function person(email: string, roles: { screensOnly: boolean }[]): Promise<string> {
  const user = await usersRepo(meta).create({ email, name: 'Cara Cashier', passwordHash: await adminPasswordHash() });
  for (const [index, spec] of roles.entries()) {
    const role = await rolesRepo(meta).create({
      slug: `${email.split('@')[0]!}-${String(index)}`,
      name: 'Role',
      ...(spec.screensOnly ? { appKey: 'clients', screensOnly: true } : {}),
    });
    await permissionsRepo(meta).grant(role.id, 'app', 'clients', { staff: true });
    await rolesRepo(meta).assignToUser(user.id, role.id);
  }
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: ADMIN_PASSWORD } });
  expect(res.statusCode, res.body).toBe(200);
  return sessionCookie(res.headers['set-cookie']);
}

/** The first test's cashier, signed in. */
let cara = '';

const get = (url: string, cookie: string) => app.inject({ method: 'GET', url, headers: { cookie } });

describe('someone who opens only an app’s own screens', () => {
  it('is sent to their screens by the dashboard, and refused the rest of the API', async () => {
    const cookie = await person('cara@example.com', [{ screensOnly: true }]);
    cara = cookie;
    const bootstrap = await get('/api/v1/bootstrap', cookie);
    expect(bootstrap.statusCode).toBe(403);
    expect(bootstrap.json().error).toMatchObject({ code: 'APP_SCREENS_ONLY', details: { openUrl: '/apps/clients/staff/' } });
    expect((await get('/api/v1/connections', cookie)).json().error?.code).toBe('APP_SCREENS_ONLY');
    expect((await get('/api/v1/roles', cookie)).json().error?.code).toBe('APP_SCREENS_ONLY');
    // The same routes spelled another way on the request line reach them just the same: refused alike.
    for (const url of ['/%61pi/v1/roles', '/%61pi/v1/connections', '/api/v1/%72oles']) {
      expect((await get(url, cookie)).json().error?.code, url).toBe('APP_SCREENS_ONLY');
    }
    // What the screens need still answers.
    expect((await get('/api/v1/me', cookie)).statusCode).toBe(200);
    expect((await get('/%61pi/v1/me', cookie)).statusCode).toBe(200);
    expect((await get('/api/v1/i18n/bundles/en_US/common', cookie)).json().error?.code).not.toBe('APP_SCREENS_ONLY');
    expect((await get('/api/v1/data/conn_x/main.items', cookie)).json().error?.code).not.toBe('APP_SCREENS_ONLY');
    // Their own app's documents are drawn and printed at the desk; another app's are not theirs.
    const render = (key: string) => app.inject({ method: 'POST', url: `/api/v1/apps/${key}/documents/render`, headers: { cookie }, payload: { kind: 'folio', ref: 'stays', pk: { id: 1 } } });
    expect((await render('clients')).json().error?.code).not.toBe('APP_SCREENS_ONLY');
    expect((await render('other')).json().error?.code).toBe('APP_SCREENS_ONLY');
    expect((await get('/api/v1/documents/doc_1/print', cookie)).json().error?.code).not.toBe('APP_SCREENS_ONLY');
    expect((await get('/api/v1/documents/doc_1/content', cookie)).json().error?.code).not.toBe('APP_SCREENS_ONLY');
    expect((await get('/api/v1/documents', cookie)).json().error?.code).toBe('APP_SCREENS_ONLY');
    // An add-on's stock words are for the screens of an app that uses it: no add-on is connected to theirs.
    for (const url of ['/api/v1/words/stock/item?table=stock:items&ids=1', '/%61pi/v1/words/stock/item?table=stock:items&ids=1']) {
      expect((await get(url, cookie)).json().error?.code, url).toBe('APP_SCREENS_ONLY');
    }
  });

  it('reaches the assistant only when their role was given it, and then only its two kinds of conversation', async () => {
    // The gate itself: the assistant's routes for a person who holds the permission, its settings for nobody here.
    const gate = (route: string, assistant: boolean) => allowedForScreensOnly('GET', route, {}, new Set(['conn_1']), ['clients'], new Set(), assistant);
    expect(gate('/api/v1/assistant/availability', false)).toBe(false);
    expect(gate('/api/v1/assistant/availability', true)).toBe(true);
    expect(gate('/api/v1/assistant/sessions/:id/turns', true)).toBe(true);
    expect(gate('/api/v1/assistant/settings', true)).toBe(false);
    expect(gate('/api/v1/roles', true)).toBe(false);

    // No role holds the assistant by default: a cashier is refused it like the rest of the API.
    // The cashier of the test above (one sign-in fewer: this file's sign-ins share one minute's allowance).
    const cookie = cara;
    expect((await get('/api/v1/assistant/availability', cookie)).json().error?.code).toBe('APP_SCREENS_ONLY');

    // Given it by an administrator, on their own role.
    const role = await rolesRepo(meta).findBySlug('cara-0');
    for (const row of matrixRowsFromGrants(['system:assistant:use']).rows) await permissionsRepo(meta).grant(role!.id, row.resourceKind, row.resourceRef, row.actions as never);
    const open = await get('/api/v1/assistant/availability', cookie);
    expect(open.statusCode, open.body).toBe(200);
    expect(open.json()).toMatchObject({ name: 'Milo' });
    expect((await get('/api/v1/assistant/availability?context=data', cookie)).statusCode).toBe(200);
    // The document pages are not their screens, so neither are those conversations.
    for (const context of ['email', 'invoices', 'report', 'automation']) {
      const refused = await get(`/api/v1/assistant/availability?context=${context}`, cookie);
      expect(refused.statusCode, context).toBe(403);
      expect(refused.json().error, context).toMatchObject({ code: 'FORBIDDEN', details: { reason: 'screens-only', context } });
    }
    // A conversation from before, held on a page that is not theirs any more (they had another role then):
    // it is closed the moment they come back, and they are handed none of it.
    const me = await usersRepo(meta).findByEmail('cara@example.com');
    const sessions = assistantSessionsRepo(meta);
    const old = await sessions.create({ context: 'email', host: { connectionIds: [] }, createdBy: me!.id, kind: 'panel' });
    const current = await get('/api/v1/assistant/sessions/current', cookie);
    expect(current.statusCode, current.body).toBe(200);
    expect(current.json()).toMatchObject({ session: null, turns: [] });
    expect((await sessions.findSession(old.id))?.status).toBe('closed');
    // One on their own kind of page is theirs to go on with.
    const mine = await sessions.create({ context: 'general', host: { connectionIds: [] }, createdBy: me!.id, kind: 'panel' });
    expect((await get('/api/v1/assistant/sessions/current', cookie)).json().session).toMatchObject({ id: mine.id });
    await sessions.close(mine.id);

    // Everything else is as closed as it was.
    expect((await get('/api/v1/assistant/settings', cookie)).json().error?.code).toBe('APP_SCREENS_ONLY');
    expect((await get('/api/v1/roles', cookie)).json().error?.code).toBe('APP_SCREENS_ONLY');
    expect((await get('/api/v1/bootstrap', cookie)).statusCode).toBe(403);
  });

  it('may ask the stock words of an add-on their app uses: that route, read only, and that add-on', () => {
    const WORDS = '/api/v1/words/:addOn/:wordsId';
    const theirs = new Set(['stock']);
    const allowed = (method: string, route: string, params: unknown, addOns: ReadonlySet<string> = theirs) => allowedForScreensOnly(method, route, params, new Set(['conn_1']), ['clients'], addOns);
    expect(allowed('GET', WORDS, { addOn: 'stock', wordsId: 'item' })).toBe(true);
    expect(STAFF_WORDS_ROUTE).toBe(WORDS);
    // Another add-on, none at all, another method, another route under the same name, a parameter that is no name.
    expect(allowed('GET', WORDS, { addOn: 'offers', wordsId: 'item' })).toBe(false);
    expect(allowed('GET', WORDS, { addOn: 'stock', wordsId: 'item' }, new Set())).toBe(false);
    expect(allowedForScreensOnly('GET', WORDS, { addOn: 'stock', wordsId: 'item' }, new Set(['conn_1']), ['clients'])).toBe(false);
    expect(allowed('POST', WORDS, { addOn: 'stock', wordsId: 'item' })).toBe(false);
    expect(allowed('GET', '/api/v1/words/:addOn', { addOn: 'stock' })).toBe(false);
    expect(allowed('GET', '/api/v1/add-ons/:addOn/words', { addOn: 'stock' })).toBe(false);
    expect(allowed('GET', WORDS, { addOn: ['stock'], wordsId: 'item' })).toBe(false);
    expect(allowed('GET', WORDS, null)).toBe(false);
  });

  it('may look a scanned or typed code up in an add-on their app uses: that route, a POST, and that add-on', () => {
    const LOOK_UP = '/api/v1/add-ons/:key/look-up';
    const allowed = (method: string, route: string, params: unknown, addOns: ReadonlySet<string> = new Set(['offers'])) => allowedForScreensOnly(method, route, params, new Set(['conn_1']), ['clients'], addOns);
    expect(ADD_ON_LOOK_UP_ROUTE).toBe(LOOK_UP);
    expect(allowed('POST', LOOK_UP, { key: 'offers' })).toBe(true);
    // Another add-on, none of theirs, another method, and the add-on's other routes.
    expect(allowed('POST', LOOK_UP, { key: 'stock' })).toBe(false);
    expect(allowed('POST', LOOK_UP, { key: 'offers' }, new Set())).toBe(false);
    expect(allowed('GET', LOOK_UP, { key: 'offers' })).toBe(false);
    expect(allowed('POST', '/api/v1/add-ons/:key/connect', { key: 'offers' })).toBe(false);
    expect(allowed('PATCH', '/api/v1/add-ons/:key', { key: 'offers' })).toBe(false);
    expect(allowed('POST', LOOK_UP, { key: ['offers'] })).toBe(false);
    // …and draw that add-on's own document (a card printed once as it is sold), then open the page by its one-time ticket.
    const RENDER = '/api/v1/add-ons/:key/documents/render';
    expect(ADD_ON_DOCUMENT_ROUTE).toBe(RENDER);
    expect(allowed('POST', RENDER, { key: 'offers' })).toBe(true);
    expect(allowed('POST', RENDER, { key: 'stock' })).toBe(false);
    expect(allowed('GET', RENDER, { key: 'offers' })).toBe(false);
    expect(allowed('GET', '/api/v1/documents/print-once/:ticket', { ticket: 't' })).toBe(true);
  });

  it('finds who they are, and their token, in the staff config', async () => {
    const cookie = await person('dan@example.com', [{ screensOnly: true }]);
    const config = await get('/apps/clients/staff/surface-config.json', cookie);
    expect(config.statusCode, config.body).toBe(200);
    expect(config.json()).toMatchObject({ user: { email: 'dan@example.com', name: 'Cara Cashier' }, csrfToken: expect.any(String) });
  });

  it('is sent to the app’s own address when its staff screens have one', async () => {
    const cookie = await person('eve@example.com', [{ screensOnly: true }]);
    await settingsRepo(meta).set('surfaces.domains', { 'till.example.test': { appKey: 'clients', side: 'staff' } });
    app.surfaceSettings?.invalidate();
    try {
      const bootstrap = await get('/api/v1/bootstrap', cookie);
      expect(bootstrap.json().error.details.openUrl).toBe('http://till.example.test/');
    } finally {
      await settingsRepo(meta).set('surfaces.domains', {});
      app.surfaceSettings?.invalidate();
    }
  });

  it('keeps the dashboard for anyone who also holds an ordinary role', async () => {
    const cookie = await person('fay@example.com', [{ screensOnly: true }, { screensOnly: false }]);
    expect((await get('/api/v1/bootstrap', cookie)).statusCode).toBe(200);
    expect((await get('/api/v1/roles', cookie)).json().error?.code).not.toBe('APP_SCREENS_ONLY');
  });
});

describe('an app’s own staff address', () => {
  it('names the app and the venue to its sign-in page, and nothing on other hosts', async () => {
    await settingsRepo(meta).set('surfaces.domains', { 'till.example.test': { appKey: 'clients', side: 'staff' } });
    await settingsRepo(meta).set('branding.appName', 'Daybreak Coffee');
    app.surfaceSettings?.invalidate();
    try {
      const mapped = await app.inject({ method: 'GET', url: '/api/v1/branding', headers: { host: 'till.example.test' } });
      expect(mapped.json().data.surface).toEqual({ appKey: 'clients', appName: 'clients', name: 'Daybreak Coffee' });
      const own = await app.inject({ method: 'GET', url: '/api/v1/branding' });
      expect(own.json().data.surface).toBeUndefined();
    } finally {
      await settingsRepo(meta).set('surfaces.domains', {});
      await settingsRepo(meta).set('branding.appName', 'Adminium');
      app.surfaceSettings?.invalidate();
    }
  });

  it('tells someone who may not open it so, with who they are and a way out', async () => {
    const user = await usersRepo(meta).create({ email: 'gus@example.com', name: 'Gus Guest', passwordHash: await adminPasswordHash() });
    const role = await rolesRepo(meta).create({ slug: 'gus-role', name: 'Gus' });
    await rolesRepo(meta).assignToUser(user.id, role.id);
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'gus@example.com', password: ADMIN_PASSWORD } });
    const cookie = sessionCookie(res.headers['set-cookie']);
    const page = await app.inject({
      method: 'GET',
      url: '/apps/clients/staff/',
      headers: { cookie, 'sec-fetch-mode': 'navigate', accept: 'text/html' },
    });
    expect(page.statusCode).toBe(403);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.body).not.toMatch(/<script/i);
    expect(page.body).toContain('This account can’t open clients.');
    expect(page.body).toContain('Gus Guest');
    expect(page.body).toMatch(/<form method="post"/);
    // Anything else keeps the coded answer.
    const fetched = await app.inject({ method: 'GET', url: '/apps/clients/staff/surface-config.json', headers: { cookie } });
    expect(fetched.json().error.details).toMatchObject({ reason: 'NO_STAFF_ACCESS' });
  });
});
