// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE INSTALL A MOUNT SERVES IS THE ONE ITS GRANT NAMES.
 *
 * The staff gate opens a mount on `app:<address>:staff`: the plain mount, and
 * an instance made before installs were per database, on the plain copy's
 * grant; a later copy's mount on its own. The screens' config hands back the
 * install id they send on every call, and it must be the same copy. A plain
 * mount or an old instance pointed at the later copy's database never serves
 * the later copy under the plain copy's grant.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { connectionsRepo, manifestsRepo, settingsRepo } from '@adminium/meta';

import { discoverSurfaces, type HostedSurface } from '../src/cli/surfaces-root.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { buildAuthApp, login, type AuthTestApp } from './auth-helpers.js';
import { makeEnv } from './helpers.js';

const PLAIN = { encrypt: (v: string) => v, decrypt: (v: string) => v };

let dist: string;
let surfacesDir: string;
let surfaces: HostedSurface[];
let t: AuthTestApp | undefined;

beforeAll(async () => {
  dist = await mkdtemp(join(tmpdir(), 'adminium-mount-dash-'));
  await writeFile(join(dist, 'index.html'), '<!doctype html><html><body data-app="dashboard"></body></html>', 'utf8');
  surfacesDir = await mkdtemp(join(tmpdir(), 'adminium-mount-surfaces-'));
  await mkdir(join(surfacesDir, 'clients', 'staff'), { recursive: true });
  await writeFile(join(surfacesDir, 'clients', 'staff', 'index.html'), '<!doctype html><html><body data-app="clients-staff"></body></html>', 'utf8');
  surfaces = discoverSurfaces(surfacesDir);
});

afterAll(async () => {
  for (const dir of [dist, surfacesDir]) await rm(dir, { recursive: true, force: true });
});

afterEach(async () => {
  await t?.destroy();
  t = undefined;
});

describe('a mount serves the install its grant names', () => {
  it('the plain mount and an old instance serve the plain copy, wherever they point; the later copy its own', async () => {
    t = await buildAuthApp({ staticRoot: dist, surfaces });
    const { cookie } = await login(t.app);
    const connections = connectionsRepo(t.meta, dsnCryptoFromSecret(makeEnv().ADMINIUM_SECRET));
    const fernhill = await connections.create({ name: 'Fernhill', engine: 'postgres', introspectDsn: 'postgres://ro:s@db/fernhill' });
    const kiln = await connections.create({ name: 'Kiln', engine: 'postgres', introspectDsn: 'postgres://ro:s@db/kiln' });
    const manifests = manifestsRepo(t.meta, PLAIN);
    const plain = await manifests.install({ manifestKey: 'clients', version: '1.0.0', kind: 'app', source: 'file', document: {}, connectionId: fernhill.id });
    const later = await manifests.install({ manifestKey: 'clients', version: '1.0.0', kind: 'app', source: 'file', document: {}, connectionId: kiln.id, instanceSlug: 'kiln' });
    // Stored before the refusal existed: the plain mount, and an old instance, pointed at Kiln's database.
    await settingsRepo(t.meta).set('surfaces.apps', { clients: { connectionId: kiln.id, instances: [{ slug: 'old', connectionId: kiln.id }] } });
    t.app.surfaceSettings?.invalidate();

    const installOf = async (url: string): Promise<unknown> => {
      const config = await t!.app.inject({ method: 'GET', url, headers: { cookie: cookie ?? '' } });
      expect(config.statusCode, `${url} ${config.body}`).toBe(200);
      const body = config.json() as { installId: string; slug: string };
      return [body.installId, body.slug];
    };
    // The copy's own address part comes with it: '' for the first copy, even under an old instance's address.
    expect(await installOf('/apps/clients/staff/surface-config.json')).toEqual([plain.row.id, '']);
    expect(await installOf('/apps/clients/old/staff/surface-config.json')).toEqual([plain.row.id, '']);
    expect(await installOf('/apps/clients/kiln/staff/surface-config.json')).toEqual([later.row.id, 'kiln']);
  });
});
