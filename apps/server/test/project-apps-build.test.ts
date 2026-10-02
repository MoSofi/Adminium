// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The apps a project carries, as `adminium build` leaves them for a server:
 * a composed manifest and built sides per app, listed in the build manifest
 * with a hash of each half — and the one interface a server reads an app's
 * files through, whether they are a package in the store or this folder.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppFilesError, createAppFiles } from '../src/apps/app-files.js';
import { createInstalledApps } from '../src/apps/installed.js';
import { createAppStore } from '../src/apps/store.js';
import { runCli } from '../src/cli/run.js';
import {
  appBuildDir,
  appWatchedPaths,
  appsStaleReason,
  buildProjectApps,
  createAppsBuildReader,
  folderAppsOf,
  readAppsBuild,
  type AppsBuild,
} from '../src/project/apps/build-apps.js';
import { loadProjectBundler, readBuildManifest, staleReason } from '../src/project/build.js';
import { findProject } from '../src/project/locate.js';
import { APP_VERSION } from '../src/version.js';
import { canBuildSides, tempProject } from './app-project-helpers.js';
import { fakeDeps, fakeIo } from './cli-helpers.js';

let root: string;
beforeEach(() => {
  root = tempProject('adminium-apps-build-');
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

async function cli(...argv: string[]) {
  const io = fakeIo({ interactive: false });
  const deps = fakeDeps({ cwd: root, env: {} });
  deps.runProcess = () => ({ status: 0, stdout: '' });
  const code = await runCli(argv, { io, deps });
  return { code, out: io.stdout(), err: io.stderr() };
}

const editJson = (file: string, change: (value: Record<string, unknown>) => unknown): void => {
  const path = join(root, file);
  writeFileSync(path, `${JSON.stringify(change(JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>), null, 2)}\n`);
};

const put = (file: string, text: string): void => {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
};

const build = async (): Promise<AppsBuild> =>
  buildProjectApps(root, { version: APP_VERSION, bundler: canBuildSides ? await loadProjectBundler(root) : null });

const appOf = (built: AppsBuild, key = 'repairs') => built.apps.find((app) => app.key === key)!;

describe('building the apps a project carries', () => {
  it('writes the composed manifest for an app with no screens, and lists it by its hash', async () => {
    await cli('app', 'new', 'repairs');
    const built = await build();
    const app = appOf(built);
    expect(app.problems).toBeUndefined();
    expect(app).toMatchObject({ key: 'repairs', version: '0.1.0', sides: [], sidesHash: '' });

    const file = join(appBuildDir(root, 'repairs'), 'app.json');
    const text = readFileSync(file, 'utf8');
    expect(app.hash).toBe(createHash('sha256').update(text).digest('hex'));
    // One document, as an upload would carry it: the parts are put together.
    expect(JSON.parse(text)).toMatchObject({ kind: 'app', key: 'repairs', publisher: { id: 'local' } });
    expect(built.digest).not.toBe('');

    // The same files build to the same thing.
    expect((await build()).digest).toBe(built.digest);
  });

  it('changes the manifest hash, and only it, when a part changes', async () => {
    await cli('app', 'new', 'repairs');
    const before = await build();
    editJson('apps/repairs/manifest/tables/items.json', (table) => ({
      ...table,
      columns: [...(table['columns'] as unknown[]), { ref: 'colour', type: 'text', maxLength: 40 }],
    }));
    const after = await build();
    expect(appOf(after).hash).not.toBe(appOf(before).hash);
    expect(appOf(after).sidesHash).toBe(appOf(before).sidesHash);
    expect(after.digest).not.toBe(before.digest);
    expect(after.sources).not.toBe(before.sources);
  });

  it('lists an app that does not check with its problems, and keeps the build made before them', async () => {
    await cli('app', 'new', 'repairs');
    await build();
    const file = join(appBuildDir(root, 'repairs'), 'app.json');
    const good = readFileSync(file, 'utf8');

    editJson('apps/repairs/manifest/tables/items.json', (table) => ({ ...table, columns: [{ ref: 'id', type: 'nonsense' }] }));
    const broken = await build();
    const app = appOf(broken);
    expect(app.version).toBeNull();
    expect(app.hash).toBeNull();
    expect(app.problems?.join('\n')).toContain('apps/repairs/manifest/tables/items.json');
    // What a server is serving stays whole.
    expect(readFileSync(file, 'utf8')).toBe(good);
    expect(folderAppsOf(root, broken).map((entry) => entry.key)).toEqual(['repairs']);
  });

  it('refuses an app in the folder that is not the person’s own', async () => {
    await cli('app', 'new', 'repairs');
    editJson('apps/repairs/manifest/app.json', (app) => ({ ...app, publisher: { id: 'adminium', name: 'Adminium' } }));
    const built = await build();
    expect(appOf(built).problems?.join('\n')).toContain('An app in a project folder is "local"');
    expect(existsSync(join(appBuildDir(root, 'repairs'), 'app.json'))).toBe(false);
    expect(folderAppsOf(root, built)).toEqual([]);
  });

  it('removes the build of an app whose folder is gone', async () => {
    await cli('app', 'new', 'repairs');
    await cli('app', 'new', 'bakery');
    expect((await build()).apps.map((app) => app.key)).toEqual(['bakery', 'repairs']);
    rmSync(join(root, 'apps/bakery'), { recursive: true });
    const built = await build();
    expect(built.apps.map((app) => app.key)).toEqual(['repairs']);
    expect(existsSync(appBuildDir(root, 'bakery'))).toBe(false);
    expect(existsSync(appBuildDir(root, 'repairs'))).toBe(true);
  });

  it('says the build is stale when a file under an app changed, appeared or went', async () => {
    expect(appsStaleReason(root, undefined)).toBeNull();
    await cli('app', 'new', 'repairs');
    expect(appsStaleReason(root, undefined)).toBe('its apps have not been built');
    const built = await build();
    expect(appsStaleReason(root, built)).toBeNull();

    // Sample data is read when it is added, not built: it does not make a build stale.
    writeFileSync(join(root, 'apps/repairs/seeds/extra.json'), '{}\n');
    expect(appsStaleReason(root, built)).toBeNull();

    put('apps/repairs/manifest/tables/notes.json', '{}\n');
    expect(appsStaleReason(root, built)).toBe('a file under apps/ changed since the last build');
    rmSync(join(root, 'apps/repairs/manifest/tables/notes.json'));
    expect(appsStaleReason(root, built)).toBeNull();

    rmSync(join(appBuildDir(root, 'repairs'), 'app.json'));
    expect(appsStaleReason(root, built)).toBe('the build of apps/repairs is missing');
  });

  it('watches every folder and file under apps/, and nothing hidden', async () => {
    await cli('app', 'new', 'repairs');
    put('apps/repairs/.cache/x.json', '{}');
    put('apps/repairs/staff/node_modules/pkg/index.js', '');
    const watched = appWatchedPaths(root).map((path) => path.slice(root.length + 1));
    expect(watched).toContain('apps');
    expect(watched).toContain('apps/repairs/manifest/tables');
    expect(watched).toContain('apps/repairs/manifest/tables/items.json');
    expect(watched.some((path) => path.includes('.cache') || path.includes('node_modules'))).toBe(false);
  });
});

describe.skipIf(!canBuildSides)('building an app with screens', () => {
  it('builds each side, and a changed screen changes the sides’ hash and not the manifest’s', async () => {
    await cli('app', 'new', 'repairs', '--staff');
    const before = await build();
    expect(appOf(before)).toMatchObject({ sides: ['staff'] });
    expect(appOf(before).sidesHash).not.toBe('');
    expect(existsSync(join(appBuildDir(root, 'repairs'), 'staff', 'index.html'))).toBe(true);

    const main = join(root, 'apps/repairs/staff/src/main.tsx');
    writeFileSync(main, `${readFileSync(main, 'utf8')}\nconsole.log('changed');\n`);
    const after = await build();
    expect(appOf(after).hash).toBe(appOf(before).hash);
    expect(appOf(after).sidesHash).not.toBe(appOf(before).sidesHash);
    expect(after.digest).not.toBe(before.digest);
  });

  it('lists a side that does not build as the app’s problem, and keeps the last whole build', async () => {
    await cli('app', 'new', 'repairs', '--staff');
    await build();
    const page = join(appBuildDir(root, 'repairs'), 'staff', 'index.html');
    const good = readFileSync(page, 'utf8');
    writeFileSync(join(root, 'apps/repairs/staff/src/main.tsx'), 'const = ;\n');
    const broken = await build();
    expect(appOf(broken).problems?.join('\n')).toContain('Could not build the staff side of "repairs"');
    expect(readFileSync(page, 'utf8')).toBe(good);
  });

  it('`adminium build` builds the apps with the project, and `adminium check` says how each stands', async () => {
    await cli('app', 'new', 'repairs', '--staff');
    const built = await cli('build');
    expect(built.err).toBe('');
    expect(built.code).toBe(0);
    expect(built.out).toContain('Built the app "repairs" 0.1.0 with its staff side.');

    const project = findProject(root, {})!;
    expect(readBuildManifest(project)?.apps?.apps.map((app) => app.key)).toEqual(['repairs']);
    expect(staleReason(project, APP_VERSION)).toBeNull();
    expect(readAppsBuild(join(root, '.adminium', 'build'))?.digest).toBe(readBuildManifest(project)?.apps?.digest);

    const checked = await cli('check');
    expect(checked.out).toContain('✓ the app "repairs" 0.1.0 builds (staff side)');

    // A changed part makes the build stale; a broken one fails the build, by name.
    editJson('apps/repairs/manifest/tables/items.json', (table) => ({ ...table, columns: [{ ref: 'id', type: 'nonsense' }] }));
    expect(staleReason(project, APP_VERSION)).toBe('a file under apps/ changed since the last build');
    const failed = await cli('build');
    expect(failed.code).toBe(2);
    expect(failed.err).toContain('✗ The app "repairs" was not built:');
    expect(failed.err).toContain('apps/repairs/manifest/tables/items.json');
    expect((await cli('check')).err).toContain('✗ the app "repairs" does not build:');
  });
});

describe('where an app’s files are', () => {
  it('answers a folder app from the folder and its build, and every other key from the store', async () => {
    await cli('app', 'new', 'repairs');
    const built = await build();
    const store = createAppStore({ dataDir: join(root, 'data') });
    const files = createAppFiles({ store, folder: () => folderAppsOf(root, built) });

    expect(files.sourceOf('repairs')).toBe('folder');
    expect(files.sourceOf('pos')).toBe('store');
    expect(await files.has('repairs', '0.1.0')).toBe(true);
    expect(await files.has('pos', '1.0.0')).toBe(false);
    await expect(files.verify('repairs', '0.1.0')).resolves.toBeUndefined();
    expect(files.dirFor('repairs', '0.1.0')).toBe(appBuildDir(root, 'repairs'));

    // The manifest is the composed one; everything else is the folder's own file.
    const manifest = JSON.parse((await files.readFile('repairs', '0.1.0', 'manifest.json')).toString('utf8')) as { key: string };
    expect(manifest.key).toBe('repairs');
    const sample = await files.readVerifiedFile('repairs', '0.1.0', 'seeds/sample.json');
    expect(sample.bytes.equals(readFileSync(join(root, 'apps/repairs/seeds/sample.json')))).toBe(true);
    expect(sample.sha256).toBe(createHash('sha256').update(sample.bytes).digest('hex'));
  });

  it('reads nothing outside the app’s folder: no parent, no hidden file, no link', async () => {
    await cli('app', 'new', 'repairs');
    const built = await build();
    put('.env', 'ADMINIUM_SECRET=nope\n');
    put('apps/repairs/seeds/.hidden.json', '{}');
    symlinkSync(join(root, '.env'), join(root, 'apps/repairs/seeds/leak.json'));
    mkdirSync(join(root, 'outside'));
    put('outside/secret.json', '{}');
    symlinkSync(join(root, 'outside'), join(root, 'apps/repairs/seeds/linked'));
    const files = createAppFiles({ store: createAppStore({ dataDir: join(root, 'data') }), folder: () => folderAppsOf(root, built) });

    for (const path of [
      '../../.env',
      'seeds/../../../.env',
      '/etc/hosts',
      'seeds/.hidden.json',
      'seeds/leak.json',
      'seeds/linked/secret.json',
      'seeds',
      '',
      'seeds//sample.json',
      'seeds/missing.json',
    ]) {
      await expect(files.readFile('repairs', '0.1.0', path), path).rejects.toBeInstanceOf(AppFilesError);
    }
  });

  it('reads the build list again only when the build was rewritten', async () => {
    await cli('app', 'new', 'repairs');
    const read = createAppsBuildReader(root);
    expect(read()).toBeNull();
    put('.adminium/build/manifest.json', JSON.stringify({ apps: await build() }));
    const first = read();
    expect(first?.apps.map((app) => app.key)).toEqual(['repairs']);
    expect(read()).toBe(first);
    put('.adminium/build/manifest.json', JSON.stringify({ apps: { digest: '', apps: [], sources: '', inputs: {} }, later: true }));
    expect(read()?.apps).toEqual([]);
  });
});

describe.skipIf(!canBuildSides)('a folder app in the registry of served apps', () => {
  it('serves its sides from the build folder, and is not an install whose files are gone', async () => {
    await cli('app', 'new', 'repairs', '--staff');
    await cli('app', 'new', 'ledger');
    const built = await build();
    const store = createAppStore({ dataDir: join(root, 'data') });
    const files = createAppFiles({ store, folder: () => folderAppsOf(root, built) });
    const installed = createInstalledApps({
      store,
      files,
      list: async () => [
        { key: 'repairs', version: '0.1.0', status: 'installed' },
        // No screens of its own: served nothing, and still not missing.
        { key: 'ledger', version: '0.1.0', status: 'installed' },
        // A packaged app whose files are not in the store.
        { key: 'pos', version: '1.0.0', status: 'installed' },
      ],
    });
    const surfaces = await installed.refresh();
    expect(surfaces.map((surface) => [surface.appKey, surface.side, surface.root])).toEqual([
      ['repairs', 'staff', join(appBuildDir(root, 'repairs'), 'staff')],
    ]);
    expect(surfaces[0]?.prefix).toBe('/apps/repairs/staff');
    expect(installed.missing()).toEqual([{ key: 'pos', version: '1.0.0' }]);
  });
});
