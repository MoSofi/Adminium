// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The one door a surface's page leaves by, and what goes with it
 * (`plugins/surface-index.ts`): the assistant's loader, on a staff side, to a
 * signed-in person who may use the assistant, and to nobody else.
 *
 * Every way a page can be reached is walked: the side's own path with and
 * without its slash, its `index.html`, a deep link, a mapped host's root and a
 * deep link there. The customer side is asked three ways and never gets it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { permissionsRepo, rolesRepo, settingsRepo, usersRepo } from '@adminium/meta';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { AdminiumServer } from '../src/app.js';
import { discoverSurfaces, type HostedSurface } from '../src/cli/surfaces-root.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { MILO_LOADER_PATH, MILO_LOADER_TAG, withLoader } from '../src/plugins/surface-index.js';
import { matrixRowsFromGrants } from '../src/rbac/permissions.js';
import type { DomainMapping } from '../src/surfaces/settings.js';
import { ADMIN_PASSWORD, adminPasswordHash, buildAuthApp, login, type AuthTestApp } from './auth-helpers.js';

const DASH_HTML = '<!doctype html><html><body data-app="dashboard"></body></html>';
const STAFF_HTML = '<!doctype html><html><body data-app="clients-staff"><p>desk</p></body></html>';
const CUSTOMER_HTML = '<!doctype html><html><body data-app="clients-customer"></body></html>';
const WITH_TAG = `<!doctype html><html><body data-app="clients-staff"><p>desk</p>${MILO_LOADER_TAG}</body></html>`;

const NAVIGATE = { 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', accept: 'text/html' };
const STAFF_HOST = 'staff.example.test';
const CUSTOMER_HOST = 'shop.example.test';

let dist: string;
let bare: string;
let surfacesDir: string;
let surfaces: HostedSurface[];
let t: AuthTestApp | undefined;

beforeAll(async () => {
  dist = await mkdtemp(join(tmpdir(), 'adminium-dash-'));
  await writeFile(join(dist, 'index.html'), DASH_HTML, 'utf8');
  await mkdir(join(dist, 'assets', 'milo'), { recursive: true });
  await writeFile(join(dist, 'assets', 'milo', 'loader.js'), 'export const loader = 1;', 'utf8');
  // A build from before the loader existed.
  bare = await mkdtemp(join(tmpdir(), 'adminium-dash-bare-'));
  await writeFile(join(bare, 'index.html'), DASH_HTML, 'utf8');
  await mkdir(join(bare, 'assets'), { recursive: true });

  surfacesDir = await mkdtemp(join(tmpdir(), 'adminium-surfaces-'));
  for (const [side, html] of [['staff', STAFF_HTML], ['customer', CUSTOMER_HTML]] as const) {
    await mkdir(join(surfacesDir, 'clients', side), { recursive: true });
    await writeFile(join(surfacesDir, 'clients', side, 'index.html'), html, 'utf8');
  }
  surfaces = discoverSurfaces(surfacesDir);
});

afterAll(async () => {
  for (const dir of [dist, bare, surfacesDir]) await rm(dir, { recursive: true, force: true });
});

afterEach(async () => {
  await t?.destroy();
  t = undefined;
});

/** The server as it is composed: the page door, and permissions over it. `on` is the workspace's answer. */
async function build(over: { staticRoot?: string; on?: boolean | null } = {}): Promise<AuthTestApp> {
  const on = over.on === undefined ? true : over.on;
  t = await buildAuthApp({ staticRoot: over.staticRoot ?? dist, surfaces, ...(on === null ? {} : { surfaceAssistant: async () => on }) });
  await t.app.register(rbacPlugin, { meta: t.meta });
  return t;
}

async function setDomains(fixture: AuthTestApp, domains: Record<string, DomainMapping>): Promise<void> {
  await settingsRepo(fixture.meta).set('surfaces.domains', domains, { updatedBy: null });
  fixture.app.surfaceSettings?.invalidate();
}

/** Somebody who opens the app's staff screens, with or without the assistant. */
async function person(fixture: AuthTestApp, email: string, grants: string[]): Promise<string> {
  const user = await usersRepo(fixture.meta).create({ email, name: email, passwordHash: await adminPasswordHash() } as never);
  const role = await rolesRepo(fixture.meta).create({ slug: email.split('@')[0] as string, name: email });
  for (const row of matrixRowsFromGrants(grants).rows) {
    await permissionsRepo(fixture.meta).grant(role.id, row.resourceKind, row.resourceRef, row.actions as never);
  }
  await rolesRepo(fixture.meta).assignToUser(user.id, role.id);
  const signedIn = await login(fixture.app, email, ADMIN_PASSWORD);
  expect(signedIn.cookie, signedIn.res.body).not.toBeNull();
  return signedIn.cookie as string;
}

const get = (app: AdminiumServer, url: string, headers: Record<string, string> = {}, method: 'GET' | 'HEAD' = 'GET') =>
  app.inject({ method, url, headers: { host: 'localhost', ...NAVIGATE, ...headers } });

describe('the page with the loader', () => {
  it('is the file with one tag before its last </body>, or nothing when the file cannot take one', () => {
    expect(withLoader(Buffer.from(STAFF_HTML))).toBe(WITH_TAG);
    // The LAST one: a page that prints "</body>" in a script is not cut there.
    expect(withLoader(Buffer.from('<body><script>"</body>"</script></BODY>'))).toBe(`<body><script>"</body>"</script>${MILO_LOADER_TAG}</BODY>`);
    expect(withLoader(Buffer.from('<p>no body tag</p>'))).toBeNull();
    // Not UTF-8: left alone, never re-encoded.
    expect(withLoader(Buffer.from([0x3c, 0x62, 0x6f, 0x64, 0x79, 0x3e, 0xff, 0xfe, 0x3c, 0x2f, 0x62, 0x6f, 0x64, 0x79, 0x3e]))).toBeNull();
  });
});

describe('a staff side, to a person who may use the assistant', () => {
  it('carries the loader by every way the page is reached, as that person\'s own page', async () => {
    const { app } = await build();
    const { cookie } = await login(app);
    await setDomains(t!, { [STAFF_HOST]: { appKey: 'clients', side: 'staff' } });

    const ways: [string, Record<string, string>][] = [
      ['/apps/clients/staff/', {}],
      ['/apps/clients/staff/index.html', {}],
      ['/apps/clients/staff', {}],
      ['/apps/clients/staff/desk/today', {}],
      ['/', { host: STAFF_HOST }],
      ['/desk/today', { host: STAFF_HOST }],
    ];
    for (const [url, headers] of ways) {
      const where = `${headers['host'] ?? 'admin host'} ${url}`;
      // A mapped host signs in on itself: the cookie is the same session here (one test server).
      const res = await get(app, url, { cookie: cookie!, ...headers });
      expect(res.statusCode, where).toBe(200);
      expect(res.body, where).toBe(WITH_TAG);
      expect(res.headers['content-type'], where).toBe('text/html; charset=utf-8');
      expect(res.headers['cache-control'], where).toBe('no-store');
      expect(String(res.headers['vary']), where).toContain('cookie');
      // Never the file's own validators: a cached copy must not outlive the session.
      expect(res.headers['etag'], where).toBeUndefined();
      expect(res.headers['last-modified'], where).toBeUndefined();
    }
    // A HEAD answers as the page would, with no body.
    const head = await get(app, '/apps/clients/staff/', { cookie: cookie! }, 'HEAD');
    expect(head.statusCode).toBe(200);
    expect(head.body).toBe('');
    expect(head.headers['cache-control']).toBe('no-store');
    // And the loader itself is a file of the build, served on the staff host too.
    expect((await get(app, MILO_LOADER_PATH, { host: STAFF_HOST, cookie: cookie! })).body).toBe('export const loader = 1;');
  });

  it('is the file as it is when the dashboard frames it, when the workspace says no, and when the build has no loader', async () => {
    let fixture = await build();
    let cookie = (await login(fixture.app)).cookie as string;
    const framed = await get(fixture.app, '/apps/clients/staff/', { cookie, 'sec-fetch-dest': 'iframe' });
    expect(framed.body).toBe(STAFF_HTML);
    await fixture.destroy();

    fixture = await build({ on: false });
    cookie = (await login(fixture.app)).cookie as string;
    expect((await get(fixture.app, '/apps/clients/staff/', { cookie })).body).toBe(STAFF_HTML);
    await fixture.destroy();

    // A server composed with no assistant at all.
    fixture = await build({ on: null });
    cookie = (await login(fixture.app)).cookie as string;
    expect((await get(fixture.app, '/apps/clients/staff/', { cookie })).body).toBe(STAFF_HTML);
    await fixture.destroy();

    fixture = await build({ staticRoot: bare });
    cookie = (await login(fixture.app)).cookie as string;
    expect((await get(fixture.app, '/apps/clients/staff/', { cookie })).body).toBe(STAFF_HTML);
    // A file of the build that is not there is a 404, never the dashboard's page handed over as a script.
    const missing = await get(fixture.app, MILO_LOADER_PATH, { cookie, 'sec-fetch-dest': 'script' });
    expect(missing.statusCode).toBe(404);
    expect(missing.body).not.toContain('data-app="dashboard"');
  });
});

describe('everybody else', () => {
  it('a person who opens the staff screens and may not use the assistant gets the file as it is', async () => {
    const fixture = await build();
    const without = await person(fixture, 'desk@example.com', ['app:clients:staff']);
    const res = await get(fixture.app, '/apps/clients/staff/', { cookie: without });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(STAFF_HTML);
    // With the permission, the same person gets it: it is the permission that decides, not the role's name.
    const withIt = await person(fixture, 'lead@example.com', ['app:clients:staff', 'system:assistant:use']);
    expect((await get(fixture.app, '/apps/clients/staff/', { cookie: withIt })).body).toBe(WITH_TAG);
  });

  it('nobody signed out sees it: the side\'s own sign-in comes first', async () => {
    const { app } = await build();
    const res = await get(app, '/apps/clients/staff/');
    expect(res.statusCode).toBe(302);
    expect(res.body).not.toContain('data-milo-loader');
  });

  it('the customer side never gets it: by its path with an owner\'s cookie, on its own host, and its host serves no loader', async () => {
    const fixture = await build();
    const { cookie } = await login(fixture.app);
    await setDomains(fixture, { [CUSTOMER_HOST]: { appKey: 'clients', side: 'customer' } });
    // The admin host: both sides share an origin and a cookie.
    for (const url of ['/apps/clients/customer/', '/apps/clients/customer/index.html', '/apps/clients/customer/orders/7']) {
      const res = await get(fixture.app, url, { cookie: cookie! });
      expect(res.statusCode, url).toBe(200);
      expect(res.body, url).toBe(CUSTOMER_HTML);
    }
    for (const url of ['/', '/orders/7']) {
      const res = await get(fixture.app, url, { host: CUSTOMER_HOST, cookie: cookie! });
      expect(res.body, url).toBe(CUSTOMER_HTML);
    }
    const loader = await get(fixture.app, MILO_LOADER_PATH, { host: CUSTOMER_HOST, cookie: cookie!, 'sec-fetch-dest': 'script' });
    expect(loader.statusCode).toBe(404);
    expect(loader.body).not.toContain('export const loader');
  });
});

describe('one door', () => {
  it('no other file of the server sends a surface\'s index.html', () => {
    const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
    const found: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith('.ts')) {
          readFileSync(path, 'utf8').split('\n').forEach((line, index) => {
            if (/sendFile\(\s*['"]index\.html['"]/.test(line) && !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//')) found.push(`${path.slice(src.length + 1)}:${String(index + 1)}: ${line.trim()}`);
          });
        }
      }
    };
    walk(src);
    // The door itself, and the dashboard's own page (which is no surface's).
    expect(found.map((line) => line.replace(/:\d+:/, ':'))).toEqual([
      "app.ts: return reply.sendFile('index.html');",
      "plugins/surface-index.ts: return reply.sendFile('index.html', surface.root);",
    ]);
  });
});
