// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app's side, built into the folder Adminium serves it from.
 *
 * The bundler is the esbuild that comes with vitest's own bundler, and React
 * is this package's dev dependency: both are linked into a temp project the
 * way a real project has them installed.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseSurfaceManifest } from '../src/cli/surfaces-root.js';
import { runCli } from '../src/cli/run.js';
import { loadProjectBundler, type Bundler } from '../src/project/build.js';
import { buildAppSides, buildSide, projectTailwind, sideBuildDir } from '../src/project/apps/side-build.js';
import { addUiParts, UI_PARTS } from '../src/project/apps/scaffold-app.js';
import { canBuildSides, tempProject } from './app-project-helpers.js';
import { fakeDeps, fakeIo } from './cli-helpers.js';

const ready = canBuildSides;

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
  root = tempProject('adminium-side-build-');
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

describe.skipIf(!ready)('the starter that `adminium app new` writes', () => {
  it('builds both sides with the engine’s own side module, and each page names files that exist', async () => {
    rmSync(join(root, 'apps'), { recursive: true });
    const io = fakeIo({ interactive: false });
    const deps = fakeDeps({ cwd: root, env: {} });
    deps.runProcess = () => ({ status: 0, stdout: '' });
    expect(await runCli(['app', 'new', 'repairs', '--staff', '--customer'], { io, deps })).toBe(0);

    const built = fakeIo({ interactive: false });
    const code = await runCli(['app', 'build'], { io: built, deps: fakeDeps({ cwd: root, env: {} }) });
    expect(built.stderr()).toBe('');
    expect(code).toBe(0);
    for (const side of ['staff', 'customer'] as const) {
      const dir = sideBuildDir(root, 'repairs', side);
      const html = readFileSync(join(dir, 'index.html'), 'utf8');
      for (const [, address] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
        expect(address?.startsWith(`/apps/repairs/${side}/assets/`), address).toBe(true);
        expect(existsSync(join(dir, (address ?? '').replace(`/apps/repairs/${side}/`, ''))), address).toBe(true);
      }
    }
    // The staff side lists its screen for the sidebar; the customer side has none to list.
    expect(parseSurfaceManifest(readFileSync(join(sideBuildDir(root, 'repairs', 'staff'), 'surface.json'), 'utf8'))?.nav).toHaveLength(1);
    expect(existsSync(join(sideBuildDir(root, 'repairs', 'customer'), 'surface.json'))).toBe(false);
    // The key and side were baked in, and the plumbing came from the engine.
    const staff = readdirSync(join(sideBuildDir(root, 'repairs', 'staff'), 'assets')).find((file) => file.endsWith('.js')) ?? '';
    const script = readFileSync(join(sideBuildDir(root, 'repairs', 'staff'), 'assets', staff), 'utf8');
    expect(script).toContain('surface-config.json');
    expect(script).toContain('x-adminium-csrf');
  });
});

/** The repository's own Tailwind 4 (the dashboard's), linked into the project as an install would put it. Null when this checkout has none. */
function tailwindFolder(): string | null {
  try {
    return dirname(createRequire(join(import.meta.dirname, '..', '..', 'dashboard', 'package.json')).resolve('tailwindcss/package.json'));
  } catch {
    return null;
  }
}

describe.skipIf(!ready)('what the build brings and what it keeps out', () => {
  const cssOf = (dir: string): string => readFileSync(join(dir, 'assets', readdirSync(join(dir, 'assets')).find((name) => name.endsWith('.css')) ?? ''), 'utf8');

  it('loads a side’s stylesheets itself, in their order, whether or not main.tsx imports them', async () => {
    // main.tsx imports app.css and nothing else: the look and the app's own rules still arrive, the theme first.
    put('apps/repairs/staff/src/theme.css', ':root { --accent: #a04e26; }\n');
    put('apps/repairs/staff/src/design.css', '.mine { color: var(--accent); }\n');
    put('apps/repairs/staff/src/style.css', '.of-the-style { margin: 0; }\n');
    const css = cssOf((await build()).dir);
    const at = (text: string): number => css.indexOf(text);
    expect(at('--accent')).toBeGreaterThanOrEqual(0);
    expect(at('--accent')).toBeLessThan(at('h1{'));
    expect(at('h1{')).toBeLessThan(at('.of-the-style'));
    expect(at('.of-the-style')).toBeLessThan(at('.mine'));
    // A stylesheet main.tsx imports too is bundled once.
    expect(css.split('h1{')).toHaveLength(2);
  });

  it('refuses an import that leaves the app’s folder, by a path, by a link or by a name mapped onto the project', async () => {
    put('secret.json', '{"key":"do-not-ship"}');
    put('.adminium/keys.json', '{"key":"do-not-ship"}');
    const tries: [string, string][] = [
      ["import secret from '../../../../secret.json';\nconsole.log(secret);", '../../../../secret.json'],
      ["import keys from '../../../../.adminium/keys.json';\nconsole.log(keys);", '.adminium/keys.json'],
      ["import pkg from '../../../../package.json';\nconsole.log(pkg);", 'package.json'],
    ];
    for (const [line, named] of tries) {
      put('apps/repairs/staff/src/main.tsx', `${line}\n${MAIN}`);
      await expect(build(), named).rejects.toThrow(/is outside this app: a screen may import files of apps\/repairs\/ and installed packages/);
    }
    // A stylesheet reaching out with @import is an import like any other.
    put('apps/repairs/staff/src/main.tsx', MAIN);
    put('outside.css', '.leak { color: red }');
    put('apps/repairs/staff/src/app.css', '@import "../../../../outside.css";\nh1 { color: rebeccapurple; }\n');
    await expect(build()).rejects.toThrow(/is outside this app/);
    put('apps/repairs/staff/src/app.css', 'h1 { color: rebeccapurple; }\n');
    // A link inside the app that points out of it.
    symlinkSync(join(root, 'secret.json'), join(root, 'apps/repairs/staff/src/linked.json'));
    put('apps/repairs/staff/src/main.tsx', `import linked from './linked.json';\nconsole.log(linked);\n${MAIN}`);
    await expect(build()).rejects.toThrow(/is outside this app/);
    rmSync(join(root, 'apps/repairs/staff/src/linked.json'));
    // A name mapped onto the project by a tsconfig of the app's own.
    put('apps/repairs/tsconfig.json', JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { 'handy/*': ['../../*'] } } }));
    put('apps/repairs/staff/src/main.tsx', `import mapped from 'handy/secret.json';\nconsole.log(mapped);\n${MAIN}`);
    await expect(build()).rejects.toThrow(/is outside this app/);
    rmSync(join(root, 'apps/repairs/tsconfig.json'));
    // The app's own files, from anywhere in its folder, and installed packages: fine.
    put('apps/repairs/assets/pictures/hero.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>\n');
    put('apps/repairs/staff/src/main.tsx', `import hero from '../../assets/pictures/hero.svg';\nconsole.log(hero);\n${MAIN}`);
    const built = await build();
    expect(built.files.some((file) => /^assets\/hero-[A-Z0-9]+\.svg$/.test(file))).toBe(true);
    expect(readdirSync(join(built.dir, 'assets')).map((name) => readFileSync(join(built.dir, 'assets', name), 'utf8')).join('')).not.toContain('do-not-ship');
  });

  it('makes the app’s logo the page’s icon', async () => {
    put('apps/repairs/assets/logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>\n');
    const built = await build();
    const icon = /<link rel="icon" type="image\/svg\+xml" href="([^"]+)">/.exec(readFileSync(join(built.dir, 'index.html'), 'utf8'))?.[1] ?? '';
    expect(icon).toMatch(/^\/apps\/repairs\/staff\/assets\/logo-[0-9a-f]{8}\.svg$/);
    expect(existsSync(join(built.dir, 'assets', icon.split('/').pop() ?? ''))).toBe(true);
  });
});

describe.skipIf(!ready || tailwindFolder() === null)('Tailwind in a side', () => {
  const cssOf = (dir: string): string => readFileSync(join(dir, 'assets', readdirSync(join(dir, 'assets')).find((name) => name.endsWith('.css')) ?? ''), 'utf8');
  const withTailwind = (): void => {
    symlinkSync(tailwindFolder() as string, join(root, 'node_modules', 'tailwindcss'), 'dir');
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'my-admin', private: true, type: 'module', dependencies: { tailwindcss: '4.3.3' } }));
  };
  const SCREEN = [
    "import { createRoot } from 'react-dom/client';",
    'function App() {',
    '  return <main className="bg-surface text-accent md:p-8 rounded-theme grid-cols-[1fr_2fr] made-part not-a-class">Hello</main>;',
    '}',
    "createRoot(document.getElementById('root')!).render(<App />);",
    '',
  ].join('\n');

  it('is off, and the build is as it always was, until the project itself lists the package', async () => {
    put('apps/repairs/staff/src/main.tsx', SCREEN);
    // Reachable is not installed: a package the project does not name is not its Tailwind.
    symlinkSync(tailwindFolder() as string, join(root, 'node_modules', 'tailwindcss'), 'dir');
    expect(projectTailwind(root)).toBeNull();
    expect(cssOf((await build()).dir)).not.toContain('md\\:p-8');
  });

  it('compiles the classes a screen uses, with the theme’s names, and puts the made parts under them', async () => {
    withTailwind();
    put('apps/repairs/staff/src/main.tsx', SCREEN);
    put('apps/repairs/staff/src/theme.css', ':root { --surface: #fffdf8; --accent: #a04e26; --radius: 18px; }\n');
    put('apps/repairs/staff/src/app.css', '.made-part { padding: 1px; }\n');
    put('apps/repairs/staff/src/design.css', '@import "./extra.css";\n.mine { color: var(--accent); }\n');
    put('apps/repairs/staff/src/extra.css', '.extra { margin: 0; }\n');
    const built = await build();
    const css = cssOf(built.dir);
    for (const used of ['.bg-surface{background-color:var(--surface)}', '.text-accent{color:var(--accent)}', '.rounded-theme{border-radius:var(--radius)}', 'md\\:p-8', 'grid-cols-\\[1fr_2fr\\]']) expect(css, used).toContain(used);
    expect(css).not.toContain('not-a-class');
    // The made parts and the app's own rules sit in the components layer, so a class on the element wins over them.
    expect(css).toMatch(/@layer components\{[^}]*\.made-part/);
    expect(css).toMatch(/@layer components\{[^}]*\.mine/);
    expect(css).toContain('.extra');
    // The screen Tailwind read class names from is a build input: a class changed there changes the stylesheet.
    expect(Object.keys(built.inputs)).toContain('apps/repairs/staff/src/main.tsx');
  });

  it('never hands Tailwind a file of the app: an @import, @plugin or @config written into a stylesheet reaches no compiler', async () => {
    withTailwind();
    put('apps/repairs/staff/src/main.tsx', SCREEN);
    put('secret.css', '.leak { color: red }');
    // A tailwind.css in the side is not read at all: the build makes Tailwind's text itself.
    put('apps/repairs/staff/src/tailwind.css', '@import "tailwindcss";\n@import "../../../../secret.css";\n@plugin "./evil.js";\n@config "./evil.js";\n@source "../../../../";\n');
    put('apps/repairs/staff/src/evil.js', "throw new Error('ran');");
    const css = cssOf((await build()).dir);
    expect(css).not.toContain('.leak');
    expect(css).toContain('md\\:p-8');
  });

  it('understands @apply in the app’s own stylesheet, names a class it cannot apply, and lets such a stylesheet load nothing', async () => {
    withTailwind();
    put('apps/repairs/staff/src/main.tsx', SCREEN);
    put('apps/repairs/staff/src/theme.css', ':root { --surface: #fffdf8; --accent: #a04e26; --radius: 18px; }\n');
    put('apps/repairs/staff/src/design.css', '.form-box {\n  @apply mx-auto p-8 bg-surface rounded-theme;\n}\n');
    const css = cssOf((await build()).dir);
    expect(css).toMatch(/\.form-box\{[^}]*background-color:var\(--surface\)/);
    expect(css).not.toContain('@apply');
    put('apps/repairs/staff/src/design.css', '.form-box { @apply shadow-soft; }\n');
    await expect(build()).rejects.toThrow(/shadow-soft/);
    put('secret.css', '.leak { color: red }');
    for (const line of ['@import "../../../../secret.css";', '@plugin "./evil.js";', '@config "./evil.js";', '@source "../../../../";', '@reference "../../../../secret.css";']) {
      put('apps/repairs/staff/src/design.css', `${line}\n.form-box { @apply p-8; }\n`);
      await expect(build(), line).rejects.toThrow(/uses @apply and @(import|plugin|config|source|reference) together/);
    }
  });

  it('builds every ready-made part as it is copied into a side: they compile, and their classes come out of Tailwind', async () => {
    withTailwind();
    for (const name of ["clsx", "tailwind-merge"]) symlinkSync(join(import.meta.dirname, "..", "..", "..", "packages", "ui", "node_modules", name), join(root, "node_modules", name), "dir");
    put('apps/repairs/staff/src/theme.css', ':root { --surface: #fffdf8; --accent: #a04e26; --accent-ink: #fff; --line: #ddd; --text: #111; --muted: #555; --radius: 18px; --shadow: none; }\n');
    const written = addUiParts({ root, key: 'repairs', side: 'staff', parts: Object.keys(UI_PARTS) });
    expect(written.map((file) => file.split('/').pop()).sort()).toEqual(['accordion.tsx', 'badge.tsx', 'button.tsx', 'card.tsx', 'dialog.tsx', 'input.tsx', 'tabs.tsx', 'utils.ts']);
    // A second copy leaves the app's own files as they are.
    expect(addUiParts({ root, key: 'repairs', side: 'staff', parts: ['button', 'no-such-part'] })).toEqual([]);
    put(
      'apps/repairs/staff/src/main.tsx',
      [
        "import { createRoot } from 'react-dom/client';",
        "import { useState } from 'react';",
        "import { Accordion } from './ui/accordion';",
        "import { Badge, Separator } from './ui/badge';",
        "import { Button } from './ui/button';",
        "import { Card, CardBody, CardFooter, CardHeader, CardText, CardTitle } from './ui/card';",
        "import { Dialog, DialogBody, Sheet } from './ui/dialog';",
        "import { Field, Input, Select, Textarea } from './ui/input';",
        "import { Tabs } from './ui/tabs';",
        'function App() {',
        '  const [open, setOpen] = useState(false);',
        '  return (',
        '    <Card><CardHeader><CardTitle>T</CardTitle><CardText>x</CardText></CardHeader><CardBody>',
        '      <Field label="Name" htmlFor="n" hint="h"><Input id="n" /></Field><Textarea /><Select><option>a</option></Select>',
        '      <Badge tone="accent">new</Badge><Separator />',
        "      <Tabs tabs={[{ id: 'a', label: 'A', content: 'a' }]} />",
        "      <Accordion items={[{ id: 'q', question: 'Q', answer: 'A' }]} />",
        '      <Dialog open={open} onClose={() => setOpen(false)} title="D"><DialogBody>d</DialogBody></Dialog>',
        '      <Sheet open={false} onClose={() => undefined} title="S">s</Sheet>',
        '    </CardBody><CardFooter><Button variant="outline" size="lg" onClick={() => setOpen(true)}>Go</Button></CardFooter></Card>',
        '  );',
        '}',
        "createRoot(document.getElementById('root')!).render(<App />);",
        '',
      ].join('\n'),
    );
    const css = cssOf((await build()).dir);
    for (const used of ['.rounded-theme', '.bg-accent', '.text-accent-ink', '.border-line', '.shadow-theme', 'backdrop\\:bg-black\\/50', '.h-11', 'focus-visible\\:outline-accent']) expect(css, used).toContain(used);
  });

  it('refuses a Tailwind it does not know, with a sentence', async () => {
    mkdirSync(join(root, 'node_modules', 'tailwindcss'), { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'my-admin', dependencies: { tailwindcss: '3.4.0' } }));
    writeFileSync(join(root, 'node_modules', 'tailwindcss', 'package.json'), JSON.stringify({ name: 'tailwindcss', version: '3.4.0', main: 'index.js' }));
    writeFileSync(join(root, 'node_modules', 'tailwindcss', 'index.js'), 'module.exports = {};');
    await expect(build()).rejects.toThrow(/this build knows Tailwind 4/);
    writeFileSync(join(root, 'node_modules', 'tailwindcss', 'package.json'), JSON.stringify({ name: 'not-tailwind', version: '4.0.0', main: 'index.js' }));
    await expect(build()).rejects.toThrow(/is not Tailwind/);
    writeFileSync(join(root, 'node_modules', 'tailwindcss', 'package.json'), JSON.stringify({ name: 'tailwindcss', version: '4.0.0', main: 'index.js', dependencies: { extra: '1.0.0' } }));
    await expect(build()).rejects.toThrow(/brings packages of its own/);
  });
});
