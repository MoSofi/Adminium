// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app whose files are a project folder, as the app routes read it: listed
 * as the folder's and never as an install whose files are gone, its sample
 * data read from the folder, and its key refused to a package.
 */
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { manifestsRepo } from '@adminium/meta';

import { sha512Integrity } from '../src/add-ons/store.js';
import type { FolderApp } from '../src/apps/app-files.js';
import { runCli } from '../src/cli/run.js';
import { appBuildDir, buildProjectApps, folderAppsOf } from '../src/project/apps/build-apps.js';
import { APP_VERSION } from '../src/version.js';
import { packageTarball } from './app-bundle-helpers.js';
import { installHarness, type Harness } from './app-install-harness.js';
import { tempProject } from './app-project-helpers.js';
import { fakeDeps, fakeIo } from './cli-helpers.js';

let root: string;
let harness: Harness;
let folder: FolderApp[];
let manifest: Record<string, unknown>;

beforeEach(async () => {
  root = tempProject('adminium-folder-source-');
  const io = fakeIo({ interactive: false });
  const deps = fakeDeps({ cwd: root, env: {} });
  deps.runProcess = () => ({ status: 0, stdout: '' });
  expect(await runCli(['app', 'new', 'repairs'], { io, deps })).toBe(0);
  folder = folderAppsOf(root, await buildProjectApps(root, { version: APP_VERSION, bundler: null }));
  manifest = JSON.parse(readFileSync(join(appBuildDir(root, 'repairs'), 'app.json'), 'utf8')) as Record<string, unknown>;
  harness = await installHarness('sqlite', { full: true, folder: () => folder });
  // The row a folder app has: no package stands behind it.
  await manifestsRepo(harness.meta, { encrypt: (v) => v, decrypt: (v) => v }).install({
    manifestKey: 'repairs',
    version: '0.1.0',
    kind: 'app',
    source: 'folder',
    document: manifest,
    connectionId: harness.connectionId,
  });
});
afterEach(async () => {
  await harness.close();
  rmSync(root, { recursive: true, force: true });
});

interface Listed {
  apps: { key: string; source: string; folder?: { state: string }; missing: boolean; sides: unknown[] }[];
  staged: unknown[];
}

const list = async (): Promise<Listed> => JSON.parse((await harness.inject({ method: 'GET', url: '/apps' })).body) as Listed;

describe('an app the project folder carries, in the app routes', () => {
  it('is listed as the folder’s, whole, with no package in the store', async () => {
    const listed = await list();
    expect(listed.apps).toHaveLength(1);
    expect(listed.apps[0]).toMatchObject({ key: 'repairs', source: 'folder', folder: { state: 'here' }, missing: false, sides: [] });
    expect(listed.staged).toEqual([]);

    // On the shelf it is an installed app described by its own manifest, not a damaged install.
    const shelf = JSON.parse((await harness.inject({ method: 'GET', url: '/apps/catalog' })).body) as {
      apps: { key: string; name: string; state: string; readable: boolean; installed: boolean }[];
    };
    expect(shelf.apps).toEqual([expect.objectContaining({ key: 'repairs', name: manifest['name'], state: 'installed', readable: true, installed: true })]);
  });

  it('is said to be gone, and missing, once its folder is no longer in the build', async () => {
    folder = [];
    const listed = await list();
    expect(listed.apps[0]).toMatchObject({ key: 'repairs', source: 'folder', folder: { state: 'gone' }, missing: true });
  });

  it('refuses a package under its key: the folder would shadow it', async () => {
    const tarball = packageTarball({ 'manifest.json': JSON.stringify(manifest) });
    const reply = await harness.inject({
      method: 'POST',
      url: `/apps/upload?expectedSha512=${encodeURIComponent(sha512Integrity(tarball))}`,
      // The harness types a JSON payload; the upload route takes the raw bytes.
      ...({ headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from(tarball) } as object),
    });
    expect(reply.statusCode, reply.body).toBe(422);
    expect(reply.body).toContain('KEY_IN_PROJECT');
    expect(reply.body).toContain('apps/repairs/');
    expect((await list()).staged).toEqual([]);
  });

  it('reads its sample data from the folder', async () => {
    const reply = await harness.inject({ method: 'GET', url: '/apps/repairs/sample-data' });
    expect(reply.statusCode, reply.body).toBe(200);
    // The count is the folder's own file, read through the same door a package's is.
    const sample = JSON.parse(readFileSync(join(root, 'apps/repairs/seeds/sample.json'), 'utf8')) as { tables: { rows: unknown[] }[] };
    const rows = sample.tables.reduce((sum, table) => sum + table.rows.length, 0);
    expect(rows).toBeGreaterThan(0);
    expect(JSON.parse(reply.body)).toMatchObject({ offered: true, loaded: false, available: { total: rows } });
  });
});
