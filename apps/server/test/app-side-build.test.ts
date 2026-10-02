// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app's side, built into the folder Adminium serves it from.
 *
 * The bundler is the esbuild that comes with vitest's own bundler, and React
 * is this package's dev dependency: both are linked into a temp project the
 * way a real project has them installed.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseSurfaceManifest } from '../src/cli/surfaces-root.js';
import { runCli } from '../src/cli/run.js';
import { loadProjectBundler, type Bundler } from '../src/project/build.js';
import { buildAppSides, buildSide, sideBuildDir } from '../src/project/apps/side-build.js';
import { fakeDeps, fakeIo } from './cli-helpers.js';

const fromHere = createRequire(import.meta.url);

/** The folder of an installed package, or null when this checkout has none. */
function packageFolder(name: string, from: NodeJS.Require = fromHere): string | null {
  try {
    return dirname(from.resolve(`${name}/package.json`));
  } catch {
    return null;
  }
}

function esbuildFolder(): string | null {
  try {
    const vite = createRequire(fromHere.resolve('vitest/package.json')).resolve('vite');
    return packageFolder('esbuild', createRequire(vite));
  } catch {
    return null;
  }
}

const LINKED = { esbuild: esbuildFolder(), react: packageFolder('react'), 'react-dom': packageFolder('react-dom') };
const ready = Object.values(LINKED).every((folder) => folder !== null);

let root: string;
let bundler: Bundler;

function put(file: string, text: string): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
}

const MAIN = [
  "import { createRoot } from 'react-dom/client';",
  "import { greeting } from '@adminiumjs/adminium/side';",
  "import './app.css';",
  "import logo from './logo.svg';",
  '',
  'function App() {',
  '  return <main><img src={logo} alt="" /><h1>{greeting}</h1></main>;',
  '}',
  "createRoot(document.getElementById('root')!).render(<App />);",
  '',
].join('\n');

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'adminium-side-build-'));
  writeFileSync(join(root, 'adminium.config.ts'), 'export default {};\n');
  mkdirSync(join(root, 'node_modules'));
  for (const [name, folder] of Object.entries(LINKED)) {
    if (folder !== null) symlinkSync(folder, join(root, 'node_modules', name), 'dir');
  }
  put('side-module.ts', "import { version } from 'react';\nexport const greeting: string = `Hello from React ${version}`;\n");
  put('apps/repairs/staff/src/main.tsx', MAIN);
  put('apps/repairs/staff/src/app.css', 'h1 { color: rebeccapurple; }\n');
  put('apps/repairs/staff/src/logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>\n');
  if (ready) bundler = (await loadProjectBundler(root)) as Bundler;
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const build = (change: Partial<Parameters<typeof buildSide>[0]> = {}) =>
  buildSide({ root, key: 'repairs', side: 'staff', name: 'Repairs & <Co>', bundler, sideModule: join(root, 'side-module.ts'), ...change });

describe.skipIf(!ready)('building a side', () => {
  it('writes a page with no inline script, and assets addressed under the side’s own mount', async () => {
    const built = await build();
    expect(built.dir).toBe(sideBuildDir(root, 'repairs', 'staff'));
    const html = readFileSync(join(built.dir, 'index.html'), 'utf8');
    expect(html).toContain('<title>Repairs &amp; &lt;Co&gt;</title>');
    expect(html).toContain('<div id="root"></div>');

    const scripts = [...html.matchAll(/<script([^>]*)>([^<]*)<\/script>/g)];
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.[2]).toBe('');
    const src = /src="([^"]+)"/.exec(scripts[0]?.[1] ?? '')?.[1] ?? '';
    expect(src).toMatch(/^\/apps\/repairs\/staff\/assets\/main-[A-Z0-9]+\.js$/);
    expect(html).not.toMatch(/<style|\son[a-z]+=/);
    const css = /<link rel="stylesheet" href="([^"]+)">/.exec(html)?.[1] ?? '';
    expect(css).toMatch(/^\/apps\/repairs\/staff\/assets\/main-[A-Z0-9]+\.css$/);

    // Every address the page names is a file that was written.
    for (const address of [src, css]) expect(built.files).toContain(address.replace('/apps/repairs/staff/', ''));
    expect(readFileSync(join(built.dir, css.replace('/apps/repairs/staff/', '')), 'utf8')).toContain('h1{color:');

    // The image is a file with a hash, addressed absolutely from the script.
    const script = readFileSync(join(built.dir, src.replace('/apps/repairs/staff/', '')), 'utf8');
    expect(script).toMatch(/\/apps\/repairs\/staff\/assets\/logo-[A-Z0-9]+\.svg/);
    expect(built.files.some((file) => /^assets\/logo-[A-Z0-9]+\.svg$/.test(file))).toBe(true);
    // The side module was the one handed in, with React from the project.
    expect(script).toContain('Hello from React');
    expect(built.bytes).toBeGreaterThan(1000);
  });

  it('records the project files it read, and none from node_modules', async () => {
    const built = await build();
    expect(Object.keys(built.inputs).sort()).toEqual([
      'apps/repairs/staff/src/app.css',
      'apps/repairs/staff/src/logo.svg',
      'apps/repairs/staff/src/main.tsx',
    ]);
    expect(built.inputs['apps/repairs/staff/src/main.tsx']).toMatch(/^[0-9a-f]{64}$/);
  });

  it('writes surface.json from nav.json, in the shape the server reads', async () => {
    put('apps/repairs/staff/nav.json', JSON.stringify([{ id: 'jobs', path: '', label: 'Jobs', icon: 'wrench' }, { id: 'done', path: 'done', label: 'Done', labels: { 'de-DE': 'Erledigt' } }]));
    const built = await build({ name: 'Repairs' });
    const manifest = parseSurfaceManifest(readFileSync(join(built.dir, 'surface.json'), 'utf8'));
    expect(manifest).toMatchObject({
      v: 1,
      appLabels: { 'en-US': 'Repairs' },
      nav: [
        { id: 'jobs', path: '', icon: 'wrench', labels: { 'en-US': 'Jobs' } },
        { id: 'done', path: 'done', labels: { 'en-US': 'Done', 'de-DE': 'Erledigt' } },
      ],
    });
    expect(built.inputs).toHaveProperty('apps/repairs/staff/nav.json');
  });

  it('writes no surface.json without a nav.json, and refuses a nav it cannot use', async () => {
    expect((await build()).files).not.toContain('surface.json');
    put('apps/repairs/staff/nav.json', JSON.stringify([{ id: 'jobs', path: '/jobs', label: 'Jobs' }]));
    await expect(build()).rejects.toThrow(/nav\.json\[0\] needs a "path" that does not start with "\/"/);
    put('apps/repairs/staff/nav.json', JSON.stringify([{ id: 'a', path: '', label: 'A' }, { id: 'a', path: 'b', label: 'B' }]));
    await expect(build()).rejects.toThrow(/the id "a" is used twice/);
  });

  it('copies public/ as it is', async () => {
    put('apps/repairs/staff/public/robots.txt', 'User-agent: *\n');
    expect((await build()).files).toContain('robots.txt');
  });

  it('says where the code is wrong, and leaves the last good build in place', async () => {
    const good = await build();
    put('apps/repairs/staff/src/main.tsx', 'const = ;\n');
    await expect(build()).rejects.toThrow(/Could not build the staff side of "repairs":\napps\/repairs\/staff\/src\/main\.tsx:1:\d+/);
    expect(existsSync(join(good.dir, 'index.html'))).toBe(true);
    expect(readdirSync(dirname(good.dir))).toEqual(['staff']);
  });

  it('says to install when React is missing', async () => {
    rmSync(join(root, 'node_modules', 'react-dom'));
    await expect(build()).rejects.toThrow(/Could not resolve "react-dom\/client" — install the project's dependencies first/);
  });

  it('replaces the last build whole, and removes the build of a side that is gone', async () => {
    const first = await build();
    put('apps/repairs/staff/src/app.css', 'h1 { color: teal; }\n');
    const second = await build();
    expect(second.files.filter((file) => file.endsWith('.css'))).toHaveLength(1);
    expect(second.files).not.toEqual(first.files);

    mkdirSync(sideBuildDir(root, 'repairs', 'customer'), { recursive: true });
    await buildAppSides({ root, key: 'repairs', name: 'Repairs', bundler, sides: ['staff'], sideModule: join(root, 'side-module.ts') });
    expect(readdirSync(dirname(second.dir))).toEqual(['staff']);
  });
});

describe.skipIf(!ready)('adminium app build', () => {
  const manifest = (frontends: unknown[]) => ({
    manifestVersion: 1,
    key: 'repairs',
    name: 'Repairs',
    version: '0.1.0',
    publisher: { id: 'local', name: 'Local' },
    license: 'UNLICENSED',
    description: { key: 'repairs.description', fallback: 'A repair desk.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.0' },
    frontends,
    requiredSchema: { tables: [{ ref: 'jobs', columns: [{ ref: 'id', type: 'id', role: 'pk' }] }] },
    pages: [{ ref: 'jobs', template: 'page-crud', title: { key: 'repairs.jobs', fallback: 'Jobs' }, nav: { group: 'manifest:repairs', icon: 'wrench', order: 1 }, bindings: { main: 'jobs' } }],
  });

  async function run(...argv: string[]) {
    const io = fakeIo({ interactive: false });
    const code = await runCli(['app', ...argv], { io, deps: fakeDeps({ cwd: root, env: {} }) });
    return { code, out: io.stdout(), err: io.stderr() };
  }

  it('checks, then builds each side and says where it went', async () => {
    put('apps/repairs/manifest.json', JSON.stringify(manifest([{ side: 'staff', kind: 'spa' }])));
    put('apps/repairs/staff/src/main.tsx', "import { createRoot } from 'react-dom/client';\ncreateRoot(document.getElementById('root')!).render(<p>Jobs</p>);\n");
    const { code, out, err } = await run('build');
    expect(err).toBe('');
    expect(code).toBe(0);
    expect(out).toMatch(/Built the staff side → \.adminium\/build\/apps\/repairs\/staff \(\d+ file\(s\), \d+ kB\)\./);
    expect(existsSync(join(root, '.adminium/build/apps/repairs/staff/index.html'))).toBe(true);
  });

  it('builds nothing when the check fails, and nothing for an app with no screens', async () => {
    put('apps/repairs/manifest.json', JSON.stringify(manifest([{ side: 'customer', kind: 'spa' }])));
    const failed = await run('build');
    expect(failed.code).toBe(2);
    expect(existsSync(join(root, '.adminium/build/apps'))).toBe(false);

    rmSync(join(root, 'apps/repairs/staff'), { recursive: true });
    put('apps/repairs/manifest.json', JSON.stringify(manifest([{ side: 'staff', kind: 'none' }])));
    const none = await run('build');
    expect(none.code).toBe(0);
    expect(none.out).toContain('no screens of its own, so there is nothing to build');
  });

  it('says the project needs esbuild', async () => {
    rmSync(join(root, 'node_modules', 'esbuild'));
    put('apps/repairs/manifest.json', JSON.stringify(manifest([{ side: 'staff', kind: 'spa' }])));
    const { code, err } = await run('build');
    expect(code).toBe(1);
    expect(err).toContain('needs esbuild');
  });
});
