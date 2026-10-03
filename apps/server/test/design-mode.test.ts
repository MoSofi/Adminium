// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A server running `adminium design`: who it answers, who it signs in, and
 * what its preview can reach.
 *
 * Each rule here is a door someone would try: a page on another name that
 * now points at this machine (DNS rebinding), the preview's own code calling
 * the Designer, the sign-in link used twice or from elsewhere, an owner with
 * a password signed in without one, a preview session that can do more than
 * the app's staff.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import {
  createFirstSuperAdmin,
  createLocalOwner,
  createSqliteMetaDb,
  firstRun,
  LOCAL_OWNER_EMAIL,
  rolesRepo,
  settingsRepo,
  usersRepo,
  type MetaDb,
} from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { composeServer, type ComposedServer } from '../src/compose.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { previewUser, safeTarget } from '../src/designer/preview.js';
import { createSessionStore } from '../src/designer/session-store.js';
import { hashPassword } from '../src/auth/passwords.js';
import { makeInstall, type Install } from './project-fixtures.js';
import { asProject } from './app-project-helpers.js';
import { makeEnv } from './helpers.js';

const PORT = 4788;
const DESIGNER = `127.0.0.1:${String(PORT)}`;
const PREVIEW = `localhost:${String(PORT)}`;
const TOKEN = 'b'.repeat(64);

let composed: ComposedServer | undefined;
let install: Install | null = null;
afterEach(async () => {
  await composed?.app.close();
  composed = undefined;
  await install?.close();
  install = null;
});

function memoryStore(meta: MetaDb): MetaStoreHandle {
  return { meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() };
}

async function server(opts: { designer?: boolean; owner?: 'local' | 'password' | 'none' } = {}): Promise<{ meta: MetaDb; app: ComposedServer['app'] }> {
  install = await makeInstall();
  const root = asProject(install.dir);
  mkdirSync(join(root, '.adminium', 'build'), { recursive: true });
  writeFileSync(join(root, '.adminium', 'build', 'manifest.json'), JSON.stringify({ adminiumVersion: '0', builtAt: '', config: { entry: 'adminium.config.ts', inputs: {} } }));
  const { meta } = install;
  if (opts.owner === 'local' || opts.owner === undefined) await createLocalOwner(meta);
  if (opts.owner === 'password') await createFirstSuperAdmin(meta, { email: 'owner@example.test', passwordHash: await hashPassword('a-long-enough-test-password-1!') });
  const runService = createRunService({ meta });
  composed = await composeServer({
    env: makeEnv({ HOST: '127.0.0.1', PORT: String(PORT) }),
    metaStore: memoryStore(meta),
    manager: install.manager,
    runService,
    applyService: createApplyService({ meta, runService }),
    allowed: { templates: [], widgets: [], widgetContracts: {} },
    logger: false,
    telemetry: false,
    onMetaRelocated: () => undefined,
    project: { root, mode: 'dev', log: () => undefined, warn: () => undefined, databases: ['main'] },
    ...(opts.designer === false ? {} : { designer: { mode: 'local' as const, token: opts.owner === 'password' ? null : TOKEN, port: PORT } }),
  });
  await composed.app.ready();
  return { meta, app: composed.app };
}

const exchange = (app: ComposedServer['app'], host = DESIGNER, token = TOKEN, extra: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url: '/api/v1/auth/design-session', headers: { host, origin: `http://${host}`, ...extra }, payload: { designToken: token } });

describe('a server running adminium design', () => {
  it('answers to this machine’s names only, on every address, the socket included', async () => {
    const { app } = await server();
    for (const host of ['evil.example', `evil.example:${String(PORT)}`, 'localhost:80', '127.0.0.1', `192.168.1.5:${String(PORT)}`]) {
      for (const url of ['/', '/api/v1/system/info', '/ws', '/design', '/apps/x/staff/']) {
        const res = await app.inject({ method: 'GET', url, headers: { host } });
        expect(res.statusCode, `${host} ${url}`).toBe(421);
      }
    }
    for (const host of [DESIGNER, PREVIEW, `[::1]:${String(PORT)}`]) {
      expect((await app.inject({ method: 'GET', url: '/api/v1/system/info', headers: { host } })).statusCode, host).toBe(200);
    }
  });

  it('says it runs the Designer, and a plain server says it does not', async () => {
    const { app } = await server();
    expect((await app.inject({ method: 'GET', url: '/api/v1/system/info', headers: { host: DESIGNER } })).json()).toMatchObject({ designer: { mode: 'local' } });
    await composed?.app.close();
    await install?.close();
    const plain = await server({ designer: false });
    expect((await plain.app.inject({ method: 'GET', url: '/api/v1/system/info' })).json()).toMatchObject({ designer: { mode: 'off' } });
    expect((await plain.app.inject({ method: 'POST', url: '/api/v1/auth/design-session', payload: { designToken: TOKEN } })).statusCode).toBe(404);
    expect((await plain.app.inject({ method: 'GET', url: '/api/v1/designer/state' })).statusCode).toBe(404);
  });

  it('signs the owner it made in once, with a cookie named for its port, and refuses the link a second time', async () => {
    const { app } = await server();
    const first = await exchange(app);
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toMatchObject({ data: { user: { email: LOCAL_OWNER_EMAIL } } });
    const cookie = String(first.headers['set-cookie']);
    expect(cookie).toMatch(new RegExp(`^adminium_session_${String(PORT)}=`));
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');

    const again = await exchange(app);
    expect(again.statusCode).toBe(401);
    expect(again.json()).toMatchObject({ error: { details: { reason: 'DESIGN_LINK_USED' } } });

    // The session it made reaches the Designer.
    const session = cookie.split(';')[0] ?? '';
    expect((await app.inject({ method: 'GET', url: '/api/v1/designer/state', headers: { host: DESIGNER, cookie: session } })).statusCode).toBe(200);
  });

  it('works with a stale cookie from another project on this machine', async () => {
    const { app } = await server();
    const res = await exchange(app, DESIGNER, TOKEN, { cookie: 'adminium_session=s%3Aadms_stale.sig; adminium_session_4700=s%3Aadms_other.sig' });
    expect(res.statusCode, res.body).toBe(200);
  });

  it('refuses the link on the preview’s name, from another machine, and with a wrong token — without spending it', async () => {
    const { app } = await server();
    expect((await exchange(app, PREVIEW)).statusCode).toBe(403);
    const remote = await app.inject({ method: 'POST', url: '/api/v1/auth/design-session', remoteAddress: '192.168.1.20', headers: { host: DESIGNER, origin: `http://${DESIGNER}` }, payload: { designToken: TOKEN } });
    expect(remote.statusCode).toBe(403);
    expect((await exchange(app, DESIGNER, 'c'.repeat(64))).statusCode).toBe(401);
    // None of those spent the owner's link: a stranger cannot use it up. (64 hex characters, five tries a minute: it cannot be guessed.)
    expect((await exchange(app)).statusCode).toBe(200);
  });

  it('never signs in an owner who has a password, and has no link at all then', async () => {
    const { app } = await server({ owner: 'password' });
    expect((await exchange(app)).statusCode).toBe(404);
  });

  it('refuses an owner given a password after the link was made', async () => {
    const { app, meta } = await server();
    const ownerId = (await settingsRepo(meta).get('designer.localOwnerId')) as string;
    await usersRepo(meta).updatePassword(ownerId, await hashPassword('a-long-enough-test-password-1!'));
    const res = await exchange(app);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { details: { reason: 'OWNER_HAS_PASSWORD' } } });
  });

  it('keeps the preview’s name away from everything that acts for the person', async () => {
    const { app } = await server();
    const session = (String((await exchange(app)).headers['set-cookie']).split(';')[0] ?? '');
    for (const url of ['/api/v1/designer/state', '/api/v1/llm/connections', '/api/v1/setup/state', '/api/v1/users', '/api/v1/settings', '/api/v1/api-keys']) {
      const res = await app.inject({ method: 'GET', url, headers: { host: PREVIEW, cookie: session } });
      expect(res.statusCode, url).toBe(403);
      expect(res.json(), url).toMatchObject({ error: { details: { reason: 'PREVIEW_HOST' } } });
    }
    // Nor any door that would leave a session other than the preview user's on that name.
    for (const url of ['/api/v1/auth/login', '/api/v1/auth/2fa/verify', '/api/v1/auth/password/reset', '/api/v1/auth/desktop-session']) {
      const res = await app.inject({ method: 'POST', url, headers: { host: PREVIEW, origin: `http://${PREVIEW}` }, payload: {} });
      expect(res.statusCode, url).toBe(403);
      expect(res.json(), url).toMatchObject({ error: { details: { reason: 'PREVIEW_HOST' } } });
    }
  });

  it('lets the Designer frame the preview, and only the Designer', async () => {
    const { app } = await server();
    const designerPage = await app.inject({ method: 'GET', url: '/api/v1/system/info', headers: { host: DESIGNER } });
    expect(String(designerPage.headers['content-security-policy'])).toContain(`frame-src 'self' http://localhost:${String(PORT)}`);
    expect(designerPage.headers['x-frame-options']).toBe('SAMEORIGIN');
    const previewPage = await app.inject({ method: 'GET', url: '/api/v1/system/info', headers: { host: PREVIEW } });
    expect(String(previewPage.headers['content-security-policy'])).toContain(`frame-ancestors 'self' http://127.0.0.1:${String(PORT)}`);
    expect(previewPage.headers['x-frame-options']).toBeUndefined();
  });
});

describe('the preview’s own sign-in', () => {
  it('spends a ticket once, on the preview’s name only, for a user that holds only the app’s roles', async () => {
    const { app, meta } = await server();
    const session = (String((await exchange(app)).headers['set-cookie']).split(';')[0] ?? '');
    // A session to ask the ticket for: the routes need one.
    const created = await app.inject({ method: 'GET', url: '/api/v1/designer/sessions', headers: { host: DESIGNER, cookie: session } });
    expect(created.statusCode, created.body).toBe(200);

    const role = await rolesRepo(meta).create({ slug: 'repairs-staff', name: 'Repairs staff', appKey: 'repairs' } as never);
    const user = await previewUser(meta, 'repairs');
    expect((await rolesRepo(meta).rolesForUser(user.id)).map((held) => held.id)).toEqual([role.id]);
    expect(user.passwordHash).toBeNull();
    // Another app's preview takes this app's roles away.
    await previewUser(meta, 'other');
    expect(await rolesRepo(meta).rolesForUser(user.id)).toEqual([]);
  });

  it('issues a ticket on the Designer’s name and spends it once on the preview’s, for a session of its own', async () => {
    const { app } = await server();
    const owner = (String((await exchange(app)).headers['set-cookie']).split(';')[0] ?? '');
    const session = createSessionStore(install!.dir).create({ appKey: 'repairs', title: 'Repairs', target: 'auto', connectionId: 'env:ollama', model: 'm', createdApp: false });
    // As the page does: the CSRF token from the bootstrap.
    const csrf = ((await app.inject({ method: 'GET', url: '/api/v1/bootstrap', headers: { host: DESIGNER, cookie: owner } })).json() as { data: { csrfToken: string } }).data.csrfToken;
    const asked = await app.inject({
      method: 'POST',
      url: `/api/v1/designer/sessions/${session.id}/preview-ticket`,
      headers: { host: DESIGNER, origin: `http://${DESIGNER}`, cookie: owner, 'x-adminium-csrf': csrf },
      payload: { to: '/apps/repairs/staff/' },
    });
    expect(asked.statusCode, asked.body).toBe(200);
    const { url, origin } = asked.json() as { url: string; origin: string };
    expect(origin).toBe(`http://${PREVIEW}`);
    const path = url.slice(origin.length);

    // On the Designer's own name the enter address does not exist.
    expect((await app.inject({ method: 'GET', url: path, headers: { host: DESIGNER } })).statusCode).toBe(404);
    const entered = await app.inject({ method: 'GET', url: path, headers: { host: PREVIEW } });
    expect(entered.statusCode).toBe(303);
    expect(entered.headers.location).toBe('/apps/repairs/staff/');
    expect(String(entered.headers['set-cookie'])).toMatch(new RegExp(`^adminium_session_${String(PORT)}=`));
    // Framed by the Designer, another site: only a SameSite=None (so Secure) cookie is sent inside the frame.
    expect(String(entered.headers['set-cookie'])).toMatch(/; HttpOnly/);
    expect(String(entered.headers['set-cookie'])).toMatch(/; Secure/);
    expect(String(entered.headers['set-cookie'])).toMatch(/; SameSite=None/);
    expect(String(entered.headers['set-cookie'])).toMatch(/; Partitioned/);
    // Once.
    expect((await app.inject({ method: 'GET', url: path, headers: { host: PREVIEW } })).statusCode).toBe(401);
    // Never to another app's address.
    const elsewhere = await app.inject({
      method: 'POST',
      url: `/api/v1/designer/sessions/${session.id}/preview-ticket`,
      headers: { host: DESIGNER, origin: `http://${DESIGNER}`, cookie: owner, 'x-adminium-csrf': csrf },
      payload: { to: '/apps/other/staff/' },
    });
    expect(elsewhere.statusCode).toBe(404);
  });

  it('sends a preview only to a page of the app', () => {
    expect(safeTarget('/apps/repairs/staff/', 'repairs')).toBe('/apps/repairs/staff/');
    expect(safeTarget('/p/repairs-items', 'repairs')).toBe('/p/repairs-items');
    for (const to of ['https://evil.example/', '//evil.example', '/apps/other/staff/', '/api/v1/users', '/apps/repairs/../../x', '/designer-preview/enter', 'repairs']) {
      expect(safeTarget(to, 'repairs'), to).toBeNull();
    }
  });
});
