// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The kit for an app's own screens, as the server hands it over.
 *
 * A screen cannot guess the hashed name of the kit's entry, and it does not
 * read the dashboard's bootstrap, so its side's config tells it: `kit` (the
 * file to import) and `maps` (whether maps are on, and where from). Worth
 * proving: the config says the same on the app's own mount, an instance's
 * mount and a mapped staff host; the files it names are served, kept for good
 * by their hashed names and never by the manifest's; a mapped staff host
 * passes them and a customer host refuses them; a customer side is told
 * nothing of it; and a build with no kit, or a broken manifest, leaves the
 * field out instead of naming a file that is not there.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { connectionsRepo, settingsRepo } from '@adminium/meta';

import { kitCacheControl, kitOf, parseKitManifest } from '../src/apps/kit.js';
import { discoverSurfaces, type HostedSurface } from '../src/cli/surfaces-root.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import type { DomainMapping } from '../src/surfaces/settings.js';
import { buildAuthApp, login, type AuthTestApp } from './auth-helpers.js';
import { makeEnv } from './helpers.js';

const ENTRY = 'kit-BHhBq5nz.js';
const SHEET = 'mentions-DF31DXoR.css';
const KIT = { contract: 1, entry: `/assets/kit/${ENTRY}`, styles: `/assets/kit/${SHEET}` };
const STAFF_HOST = 'staff.example.test';
const CUSTOMER_HOST = 'shop.example.test';

let dist: string;
let bare: string;
let surfacesDir: string;
let surfaces: HostedSurface[];
let t: AuthTestApp | undefined;

beforeAll(async () => {
  dist = await mkdtemp(join(tmpdir(), 'adminium-kit-dash-'));
  await writeFile(join(dist, 'index.html'), '<!doctype html><html><body data-app="dashboard"></body></html>', 'utf8');
  await mkdir(join(dist, 'assets', 'kit'), { recursive: true });
  await writeFile(join(dist, 'assets', 'index-AAAAAAAA.js'), 'export const dashboard = 1;', 'utf8');
  await writeFile(join(dist, 'assets', 'kit', 'kit.json'), JSON.stringify({ contract: 1, entry: ENTRY, styles: SHEET }), 'utf8');
  await writeFile(join(dist, 'assets', 'kit', ENTRY), 'export const contract = 1; export async function mount() {}', 'utf8');
  await writeFile(join(dist, 'assets', 'kit', SHEET), '.adm-kit{color:red}', 'utf8');

  // A dashboard build from before the kit.
  bare = await mkdtemp(join(tmpdir(), 'adminium-kit-bare-'));
  await writeFile(join(bare, 'index.html'), '<!doctype html><html><body data-app="dashboard"></body></html>', 'utf8');

  surfacesDir = await mkdtemp(join(tmpdir(), 'adminium-kit-surfaces-'));
  for (const side of ['staff', 'customer']) {
    await mkdir(join(surfacesDir, 'clients', side), { recursive: true });
    await writeFile(join(surfacesDir, 'clients', side, 'index.html'), `<!doctype html><html><body data-app="clients-${side}"></body></html>`, 'utf8');
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

async function build(staticRoot: string = dist, env: Record<string, string> = {}): Promise<{ fixture: AuthTestApp; cookie: string }> {
  t = await buildAuthApp({ staticRoot, surfaces, ...(Object.keys(env).length === 0 ? {} : { env: makeEnv(env) }) });
  const { cookie } = await login(t.app);
  return { fixture: t, cookie: cookie ?? '' };
}

async function setDomains(fixture: AuthTestApp, domains: Record<string, DomainMapping>): Promise<void> {
  await settingsRepo(fixture.meta).set('surfaces.domains', domains, { updatedBy: null });
  fixture.app.surfaceSettings?.invalidate();
}

describe('the staff side’s config names the kit and the map', () => {
  it('on the app’s own mount, with what the dashboard’s bootstrap says of maps', async () => {
    const { fixture, cookie } = await build();
    const config = await fixture.app.inject({ method: 'GET', url: '/apps/clients/staff/surface-config.json', headers: { cookie } });
    expect(config.statusCode).toBe(200);
    expect(config.headers['cache-control']).toBe('no-store');
    expect(config.json().kit).toEqual(KIT);
    const bootstrap = await fixture.app.inject({ method: 'GET', url: '/api/v1/bootstrap', headers: { cookie } });
    expect(bootstrap.statusCode).toBe(200);
    const maps = (bootstrap.json() as { data: { maps: { enabled: boolean; server: string | null; routing: boolean } } }).data.maps;
    expect(maps.enabled).toBe(true);
    expect(typeof maps.server).toBe('string');
    expect(config.json().maps).toEqual(maps);
  });

  it('the same on an instance’s mount and on a mapped staff host', async () => {
    const { fixture, cookie } = await build();
    const berlin = await connectionsRepo(fixture.meta, dsnCryptoFromSecret(makeEnv().ADMINIUM_SECRET)).create({ name: 'berlin db', engine: 'postgres', introspectDsn: 'postgres://ro:s@db/berlin' });
    await settingsRepo(fixture.meta).set('surfaces.apps', { clients: { instances: [{ slug: 'berlin', connectionId: berlin.id }] } });
    await setDomains(fixture, { [STAFF_HOST]: { appKey: 'clients', side: 'staff' }, 'berlin.example.test': { appKey: 'clients', side: 'staff', instance: 'berlin' } });
    const own = (await fixture.app.inject({ method: 'GET', url: '/apps/clients/staff/surface-config.json', headers: { cookie } })).json();
    for (const [url, host] of [
      ['/apps/clients/berlin/staff/surface-config.json', 'localhost'],
      ['/surface-config.json', STAFF_HOST],
      ['/surface-config.json', 'berlin.example.test'],
    ] as const) {
      const config = await fixture.app.inject({ method: 'GET', url, headers: { host, cookie } });
      expect(config.statusCode, `${host}${url}`).toBe(200);
      expect(config.json().kit, `${host}${url}`).toEqual(KIT);
      expect(config.json().maps, `${host}${url}`).toEqual(own.maps);
    }
  });

  it('says maps are off when the operator wants none, and still names the kit', async () => {
    const { fixture, cookie } = await build(dist, { ADMINIUM_MAP_SERVER: 'off' });
    const config = (await fixture.app.inject({ method: 'GET', url: '/apps/clients/staff/surface-config.json', headers: { cookie } })).json();
    expect(config.maps).toEqual({ enabled: false, server: null, routing: false });
    expect(config.kit).toEqual(KIT);
  });

  it('leaves the kit out for a build that has none', async () => {
    const { fixture, cookie } = await build(bare);
    const config = (await fixture.app.inject({ method: 'GET', url: '/apps/clients/staff/surface-config.json', headers: { cookie } })).json();
    expect('kit' in config).toBe(false);
    expect(config.maps.enabled).toBe(true);
  });

  it('tells a customer side nothing of either', async () => {
    const { fixture } = await build();
    // With no key bound the customer config is refused; either way it never names the kit.
    const config = await fixture.app.inject({ method: 'GET', url: '/apps/clients/customer/surface-config.json' });
    expect(config.body).not.toContain('assets/kit');
    expect(config.body).not.toContain('"maps"');
  });
});

describe('the kit’s files are served', () => {
  it('kept for good by their hashed names, and the manifest never', async () => {
    const { fixture } = await build();
    const entry = await fixture.app.inject({ method: 'GET', url: KIT.entry });
    expect(entry.statusCode).toBe(200);
    expect(String(entry.headers['content-type'])).toMatch(/javascript/);
    expect(entry.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(entry.body).toContain('export async function mount');
    const sheet = await fixture.app.inject({ method: 'GET', url: KIT.styles });
    expect(String(sheet.headers['content-type'])).toMatch(/text\/css/);
    expect(sheet.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    const manifest = await fixture.app.inject({ method: 'GET', url: '/assets/kit/kit.json' });
    expect(manifest.statusCode).toBe(200);
    expect(manifest.headers['cache-control']).toBe('no-store');
    // The dashboard's own files keep the answer they always had.
    const dashboard = await fixture.app.inject({ method: 'GET', url: '/assets/index-AAAAAAAA.js' });
    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.headers['cache-control']).not.toContain('immutable');
  });

  it('a mapped staff host passes them; a mapped customer host refuses them', async () => {
    const { fixture, cookie } = await build();
    await setDomains(fixture, { [STAFF_HOST]: { appKey: 'clients', side: 'staff' }, [CUSTOMER_HOST]: { appKey: 'clients', side: 'customer' } });
    // Before anybody is signed in too: the sign-in page on that host loads the same directory.
    for (const headers of [{ host: STAFF_HOST }, { host: STAFF_HOST, cookie }]) {
      const entry = await fixture.app.inject({ method: 'GET', url: KIT.entry, headers });
      expect(entry.statusCode).toBe(200);
      expect(entry.body).toContain('export async function mount');
      expect(entry.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    }
    const refused = await fixture.app.inject({ method: 'GET', url: KIT.entry, headers: { host: CUSTOMER_HOST } });
    expect(refused.statusCode).toBe(404);
    expect(refused.body).not.toContain('export async function mount');
  });

  it('under a policy that lets a screen import a same-origin file and nothing inline', async () => {
    const { fixture, cookie } = await build();
    const page = await fixture.app.inject({ method: 'GET', url: '/apps/clients/staff/', headers: { cookie, 'sec-fetch-mode': 'navigate', accept: 'text/html' } });
    expect(page.statusCode).toBe(200);
    const policy = String(page.headers['content-security-policy']);
    const scripts = /script-src ([^;]*)/.exec(policy)?.[1] ?? '';
    expect(scripts.split(' ')).toContain("'self'");
    expect(scripts).not.toContain('unsafe-inline');
    expect(scripts).not.toContain('unsafe-eval');
    expect(/worker-src ([^;]*)/.exec(policy)?.[1]).toBe("'self' blob:");
  });
});

describe('reading kit.json', () => {
  it('takes a manifest as the build writes it', () => {
    expect(parseKitManifest(JSON.stringify({ contract: 1, entry: ENTRY, styles: SHEET }))).toEqual(KIT);
    expect(parseKitManifest(JSON.stringify({ contract: 2, entry: ENTRY, styles: null }))).toEqual({ contract: 2, entry: KIT.entry, styles: null });
  });

  it.each([
    ['not JSON', '{'],
    ['not an object', '"kit"'],
    ['no contract', JSON.stringify({ entry: ENTRY })],
    ['a contract that is no whole number', JSON.stringify({ contract: 1.5, entry: ENTRY })],
    ['an entry in another directory', JSON.stringify({ contract: 1, entry: '../index.js' })],
    ['an entry on another origin', JSON.stringify({ contract: 1, entry: 'https://evil.example/kit.js' })],
    ['an entry that is not a script', JSON.stringify({ contract: 1, entry: SHEET })],
  ])('answers nothing for %s', (_what, text) => {
    expect(parseKitManifest(text)).toBeNull();
  });

  it('drops a sheet it cannot name safely and keeps the entry', () => {
    expect(parseKitManifest(JSON.stringify({ contract: 1, entry: ENTRY, styles: '/etc/passwd' }))).toEqual({ ...KIT, styles: null });
  });

  it('reads the file again when it changes, and answers nothing once it is gone', async () => {
    const root = await mkdtemp(join(tmpdir(), 'adminium-kit-read-'));
    try {
      expect(await kitOf(null)).toBeNull();
      expect(await kitOf(root)).toBeNull();
      await mkdir(join(root, 'assets', 'kit'), { recursive: true });
      const file = join(root, 'assets', 'kit', 'kit.json');
      await writeFile(file, JSON.stringify({ contract: 1, entry: ENTRY, styles: null }), 'utf8');
      expect(await kitOf(root)).toEqual({ ...KIT, styles: null });
      expect(await kitOf(root)).toEqual({ ...KIT, styles: null });
      await new Promise((resolve) => setTimeout(resolve, 20));
      await writeFile(file, JSON.stringify({ contract: 1, entry: 'kit-ZZZZZZZZ.js', styles: null }), 'utf8');
      expect((await kitOf(root))?.entry).toBe('/assets/kit/kit-ZZZZZZZZ.js');
      await rm(file);
      expect(await kitOf(root)).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps only a hashed kit file for good', () => {
    const root = join(tmpdir(), 'dash');
    const at = (name: string): string => join(root, 'assets', 'kit', name);
    expect(kitCacheControl(root, at(ENTRY))).toBe('public, max-age=31536000, immutable');
    expect(kitCacheControl(root, at('kit.json'))).toBe('no-store');
    expect(kitCacheControl(root, at('notes.txt'))).toBeUndefined();
    expect(kitCacheControl(root, at('loader.js'))).toBeUndefined();
    expect(kitCacheControl(root, join(root, 'assets', 'index-AAAAAAAA.js'))).toBeUndefined();
    expect(kitCacheControl(root, join(root, 'assets', 'kitchen-AAAAAAAA.js'))).toBeUndefined();
  });
});
