// SPDX-License-Identifier: AGPL-3.0-only
/**
 * App surfaces on an API-ONLY server: one composed with no dashboard build
 * (`staticRoot` omitted), as a from-source run without a dashboard is.
 *
 * Surfaces send their files with `reply.sendFile`, and until 2026-09-17 only
 * the dashboard's static registration added it — so with no dashboard, every
 * request to an installed app answered 500 `reply.sendFile is not a function`.
 * A boot-discovered surface's client-side routes broke the same way: the
 * not-found handler answers those with the same call.
 *
 * Composed with `composeServer`, because that is where the installed-app
 * registry is wired. `compose.ts` reads the bundle directories when the module
 * loads, so they are pointed at an empty directory before it is imported. The
 * app is staged straight into the data directory, not seeded.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createSqliteMetaDb, firstRun, manifestsRepo, type MetaDb } from '@adminium/meta';

import { addOnCredentialCryptoFromSecret } from '../src/add-ons/credential-crypto.js';
import { discoverSurfaces } from '../src/cli/surfaces-root.js';
import type { ComposedServer } from '../src/compose.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

const INSTALLED_MARKER = 'installed-desk-customer-marker';
const BOOT_MARKER = 'boot-clients-customer-marker';
const DESK_JS = 'export const desk = 1;\n';

let root: string;
let meta: MetaDb;
let composed: ComposedServer;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'surfaces-api-only-'));
  const dataDir = join(root, 'data');
  const noBundle = join(root, 'no-bundle');
  const surfacesDir = join(root, 'surfaces');
  await mkdir(noBundle);

  // An installed app, where the app store keeps one:
  // <dataDir>/apps/<key>/<version>/<side>/
  const desk = join(dataDir, 'apps', 'desk', '0.1.0', 'customer');
  await mkdir(desk, { recursive: true });
  await writeFile(join(desk, 'index.html'), `<!doctype html><title>${INSTALLED_MARKER}</title>`);
  await writeFile(join(desk, 'app.js'), DESK_JS);

  // A boot-discovered surface, as `ADMINIUM_SURFACES_DIR` supplies one.
  const clients = join(surfacesDir, 'clients', 'customer');
  await mkdir(clients, { recursive: true });
  await writeFile(join(clients, 'index.html'), `<!doctype html><title>${BOOT_MARKER}</title>`);

  meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  await manifestsRepo(meta, addOnCredentialCryptoFromSecret(TEST_SECRET)).install({
    manifestKey: 'desk',
    version: '0.1.0',
    kind: 'app',
    document: { kind: 'app', manifestVersion: 1, key: 'desk', name: 'desk', version: '0.1.0' },
    source: 'marketplace',
    attachTo: [],
  });

  process.env['ADMINIUM_BUNDLED_ADD_ONS'] = noBundle;
  process.env['ADMINIUM_BUNDLED_APPS'] = noBundle;
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
    manager: new ConnectionManager({
      meta,
      crypto: dsnCryptoFromSecret(TEST_SECRET),
      metaDsn: null,
    }),
    runService,
    applyService: createApplyService({ meta, runService }),
    allowed: null,
    // No `staticRoot`: this is the API-only server.
    surfaces: discoverSurfaces(surfacesDir),
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

describe('app surfaces on a server with no dashboard build', () => {
  it('fixtures: no dashboard is served, and both surfaces are mounted', () => {
    // Without these, a default dashboard would turn this into the case every
    // other surface test already covers, and the file would still pass.
    expect(composed.app.spaRoot).toBeNull();
    expect(composed.app.surfaces.map((s) => s.prefix)).toEqual([
      '/apps/clients/customer',
      '/apps/desk/customer',
    ]);
  });

  it('serves an installed app', async () => {
    const res = await composed.app.inject({ method: 'GET', url: '/apps/desk/customer/' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain(INSTALLED_MARKER);
  });

  it('serves an installed app’s files, and its index for a client-side route', async () => {
    const asset = await composed.app.inject({ method: 'GET', url: '/apps/desk/customer/app.js' });
    expect(asset.statusCode, asset.body).toBe(200);
    expect(asset.body).toBe(DESK_JS);

    const deep = await composed.app.inject({ method: 'GET', url: '/apps/desk/customer/orders/42' });
    expect(deep.statusCode, deep.body).toBe(200);
    expect(deep.body).toContain(INSTALLED_MARKER);
  });

  it('serves a client-side route in a boot-discovered surface', async () => {
    const res = await composed.app.inject({
      method: 'GET',
      url: '/apps/clients/customer/orders/42',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.body).toContain(BOOT_MARKER);
  });
});
