// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A boot on an EMPTY data directory while the meta store still records what was
 * installed — which is what every redeploy looks like on a host with no
 * persistent disk (DigitalOcean App Platform, a container with no volume).
 *
 * Reproduced on the published 0.2.9 on 2026-09-16, with the image's bundled
 * add-on set in place and a Postgres meta store:
 *
 *  - The boot seed put the bundled `invoices` package back 60–90 ms AFTER the
 *    add-on runtime had been built without it. The runtime was never built
 *    again, so the add-on stayed "installed" in Studio with no server half and
 *    `GET /documents/kinds` answered `[]` until an unrelated install or toggle.
 *  - The installed-app registry is read before the bundled app seed runs, so an
 *    app restored by that seed was still not served.
 *  - A package the build does not carry cannot come back at all, and the boot
 *    said nothing about it. This file pins that the boot now names it.
 *
 * `compose.ts` reads both bundle directories from the environment when the
 * module loads, so it is imported only after they are set.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { gzipSync } from 'fflate';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { validateManifest } from '@adminium/manifest';
import { createSqliteMetaDb, firstRun, manifestsRepo, type MetaDb } from '@adminium/meta';

import { addOnCredentialCryptoFromSecret } from '../src/add-ons/credential-crypto.js';
import { sha512Integrity } from '../src/add-ons/store.js';
import type { ComposedServer } from '../src/compose.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

const BLOCK = 512;

function put(b: Uint8Array, at: number, len: number, v: string): void {
  b.set(Buffer.from(v, 'latin1').subarray(0, len), at);
}

/** A real npm-shaped tarball, so the store's own hardening runs on the seed. */
function packageTarball(files: Record<string, string>): Uint8Array {
  const members: Uint8Array[] = [];
  for (const [path, content] of Object.entries(files)) {
    const body = Buffer.from(content, 'utf8');
    const h = new Uint8Array(BLOCK);
    put(h, 0, 100, `package/${path}`);
    put(h, 100, 8, '0000644\0');
    put(h, 124, 12, `${body.length.toString(8).padStart(11, '0')}\0`);
    put(h, 136, 12, '00000000000\0');
    put(h, 156, 1, '0');
    put(h, 257, 6, 'ustar\0');
    put(h, 263, 2, '00');
    h.set(Buffer.from('        ', 'latin1'), 148);
    let sum = 0;
    for (let i = 0; i < BLOCK; i += 1) sum += h[i] ?? 0;
    put(h, 148, 8, `${sum.toString(8).padStart(6, '0')}\0 `);
    const pad = (BLOCK - (body.length % BLOCK)) % BLOCK;
    const m = new Uint8Array(BLOCK + body.length + pad);
    m.set(h, 0);
    m.set(body, BLOCK);
    members.push(m);
  }
  const out = new Uint8Array(members.reduce((n, m) => n + m.byteLength, 0) + BLOCK * 2);
  let at = 0;
  for (const m of members) {
    out.set(m, at);
    at += m.byteLength;
  }
  // `mtime: 0` leaves the gzip header's timestamp at zero, as `npm pack` does.
  // fflate's default is the current second, so the same files packed a second
  // apart would hash differently.
  return gzipSync(out, { mtime: 0 });
}

/** A valid add-on manifest that provides `document-render@1` from a server half. */
function renderAddOn(key: string, version: string) {
  return {
    kind: 'add-on',
    manifestVersion: 1,
    key,
    name: key,
    version,
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: `addon.${key}.line`, fallback: 'x' },
    categories: ['data'],
    compatibility: { minAdminiumVersion: '1.0.0', requires: [] },
    addOn: {
      attaches: [{ app: '*' }],
      provides: [{ contract: 'document-render', version: 1, server: 'dist/server.js' }],
      consumes: [],
      slots: [{ slot: 'settings.add-on.panel', client: 'dist/client.js', order: 10 }],
      events: [],
      connect: { kind: 'none' },
      scopes: [],
    },
  };
}

function appManifest(key: string, version: string) {
  return { kind: 'app', manifestVersion: 1, key, name: key, version };
}

/** Writes `<key>-<version>.tgz` + its `.integrity` sidecar, as the image does. */
async function bundle(dir: string, key: string, version: string, files: Record<string, string>) {
  const tarball = packageTarball(files);
  await writeFile(join(dir, `${key}-${version}.tgz`), tarball);
  await writeFile(join(dir, `${key}-${version}.tgz.integrity`), `${sha512Integrity(tarball)}\n`);
}

const APP_MARKER = 'desk-customer-surface-marker';
/**
 * The dashboard shell. The CLI always serves one, and its SPA fallback answers
 * an unserved `/apps/...` path with 200 — which is exactly how a lost app looked
 * on 0.2.9 — so a status code alone proves nothing here.
 */
const DASHBOARD_MARKER = 'dashboard-shell-marker';

interface LogLine {
  level: number;
  msg: string;
  key?: string;
  version?: string;
}

let root: string;
let meta: MetaDb;
let composed: ComposedServer;
const lines: LogLine[] = [];

async function eventually<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const until = Date.now() + 5_000;
  let value = await read();
  while (!done(value) && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 25));
    value = await read();
  }
  return value;
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'boot-empty-data-dir-'));
  const dataDir = join(root, 'data');
  const addOnBundle = join(root, 'add-ons-bundle');
  const appBundle = join(root, 'apps-bundle');
  const dashboard = join(root, 'dashboard');
  await Promise.all([mkdir(dataDir), mkdir(addOnBundle), mkdir(appBundle), mkdir(dashboard)]);
  await writeFile(join(dashboard, 'index.html'), `<!doctype html><title>${DASHBOARD_MARKER}</title>`);

  // The build's bundled set. The fillers sort first and make the seed take
  // several packages' worth of disk work before it reaches `render-kit`, the
  // window in which 0.2.9 built the runtime without it.
  for (const filler of ['filler-a', 'filler-b', 'filler-c', 'filler-d']) {
    await bundle(addOnBundle, filler, '1.0.0', {
      'manifest.json': JSON.stringify(renderAddOn(filler, '1.0.0')),
      'dist/server.js': 'export default {};\n',
      'dist/client.js': 'export const register = () => {};\n',
    });
  }
  await bundle(addOnBundle, 'render-kit', '1.0.0', {
    'manifest.json': JSON.stringify(renderAddOn('render-kit', '1.0.0')),
    'dist/server.js': 'export default {};\n',
    'dist/client.js': 'export const register = () => {};\n',
  });
  await bundle(appBundle, 'desk', '0.1.0', {
    'manifest.json': JSON.stringify(appManifest('desk', '0.1.0')),
    'customer/index.html': `<!doctype html><title>${APP_MARKER}</title><script src="/apps/desk/customer/app.js"></script>`,
  });

  // What the meta store remembers from before the redeploy: two installs the
  // bundle can restore, and two it cannot.
  meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  const manifests = manifestsRepo(meta, addOnCredentialCryptoFromSecret(TEST_SECRET));
  const installs = [
    { manifestKey: 'render-kit', version: '1.0.0', kind: 'add-on' as const, document: renderAddOn('render-kit', '1.0.0') },
    { manifestKey: 'gone-kit', version: '2.0.0', kind: 'add-on' as const, document: renderAddOn('gone-kit', '2.0.0') },
    { manifestKey: 'desk', version: '0.1.0', kind: 'app' as const, document: appManifest('desk', '0.1.0') },
    { manifestKey: 'lost-app', version: '0.3.0', kind: 'app' as const, document: appManifest('lost-app', '0.3.0') },
  ];
  for (const install of installs) {
    await manifests.install({ ...install, source: 'marketplace', attachTo: install.kind === 'add-on' ? ['desk'] : [] });
  }

  process.env['ADMINIUM_BUNDLED_ADD_ONS'] = addOnBundle;
  process.env['ADMINIUM_BUNDLED_APPS'] = appBundle;
  const { composeServer } = await import('../src/compose.js');

  const runService = createRunService({ meta });
  const metaStore: MetaStoreHandle = {
    meta,
    url: 'sqlite::memory:',
    engine: 'sqlite',
    source: 'embedded',
    close: async () => Promise.resolve(),
  };
  composed = await composeServer({
    env: makeEnv({ ADMINIUM_DATA_DIR: dataDir, HOST: '127.0.0.1' }),
    metaStore,
    manager: new ConnectionManager({ meta, crypto: dsnCryptoFromSecret(TEST_SECRET), metaDsn: null }),
    runService,
    applyService: createApplyService({ meta, runService }),
    allowed: { templates: [], widgets: [], widgetContracts: {} },
    staticRoot: dashboard,
    logger: pino({ level: 'info' }, { write: (line: string) => void lines.push(JSON.parse(line) as LogLine) }),
    telemetry: false,
    onMetaRelocated: () => {
      /* never relocates */
    },
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

async function session(): Promise<string> {
  const created = await composed.app.inject({
    method: 'POST',
    url: '/api/v1/setup/super-admin',
    payload: { name: 'Owner', email: 'owner@boot.test', password: 'boot-empty-data-dir-1' },
  });
  expect(created.statusCode).toBe(201);
  const setCookie = created.headers['set-cookie'];
  return String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0] ?? '';
}

describe('a boot on an empty data directory', () => {
  it('fixtures: the add-on manifests are valid, so a skip cannot pass for a load', () => {
    expect(validateManifest(renderAddOn('render-kit', '1.0.0')).ok).toBe(true);
    expect(validateManifest(renderAddOn('gone-kit', '2.0.0')).ok).toBe(true);
  });

  it('loads the server half of an add-on the bundled seed restored', async () => {
    const cookie = await session();
    const providers = await eventually(
      async () =>
        (
          await composed.app.inject({ method: 'GET', url: '/api/v1/documents/providers', headers: { cookie } })
        ).json() as { installed: boolean; addOnKeys: string[] },
      (reply) => reply.addOnKeys.includes('render-kit'),
    );
    expect(
      providers.addOnKeys,
      JSON.stringify(lines.filter((line) => line.key === 'render-kit')),
    ).toContain('render-kit');
    expect(
      lines.filter((line) => line.key === 'render-kit' && line.level >= 40).map((line) => line.msg),
      'the runtime must not have been built before the seed restored the package',
    ).toEqual([]);
  });

  it('serves an app the bundled seed restored', async () => {
    const res = await eventually(
      () => composed.app.inject({ method: 'GET', url: '/apps/desk/customer/' }),
      (reply) => reply.body.includes(APP_MARKER),
    );
    expect(res.statusCode).toBe(200);
    expect(res.body, 'the dashboard answered in the app’s place').not.toContain(DASHBOARD_MARKER);
    expect(res.body).toContain(APP_MARKER);
  });

  it('names, once, each installed package that has no files on this server', async () => {
    const missing = await eventually(
      () => Promise.resolve(lines.filter((line) => /not on this server/.test(line.msg))),
      (found) => found.length >= 2,
    );
    expect(missing.map((line) => [line.key, line.version, line.level])).toEqual(
      expect.arrayContaining([
        ['gone-kit', '2.0.0', 50],
        ['lost-app', '0.3.0', 50],
      ]),
    );
    // The restored ones are not reported, and nothing is reported twice.
    expect(missing).toHaveLength(2);
    expect(missing.find((line) => line.key === 'gone-kit')?.msg).toMatch(/add-on/);
    expect(missing.find((line) => line.key === 'lost-app')?.msg).toMatch(/app/);
  });
});
