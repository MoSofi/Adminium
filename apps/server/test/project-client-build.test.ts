// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Building a project's pages and widgets (`project/client-build.ts`): which
 * files count, how their settings are read, what the browser build must never
 * contain, and when the output is stale. The builds run on the real esbuild
 * that comes with vitest's own bundler.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildProject, readBuildManifest, rebuildClientCode, staleReason } from '../src/project/build.js';
import {
  bareImportsIn,
  buildClientCode,
  clientCodeSources,
  clientCodeStaleReason,
  defaultClientShims,
  readClientBuild,
  readSettings,
  type ClientBundler,
} from '../src/project/client-build.js';
import type { ProjectLocation } from '../src/project/locate.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'adminium-client-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function put(file: string, text: string): void {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), text);
}

const buildDir = (): string => join(dir, '.adminium', 'build');

const PAGE = [
  "import { useState } from 'react';",
  "import { Card, definePage, useCurrentUser } from '@adminiumjs/adminium/ui';",
  "import './revenue.css';",
  '',
  'export default definePage({',
  "  title: 'Revenue',",
  "  icon: 'chart-line',",
  "  nav: { group: 'library', order: 4 },",
  '  component: function Revenue() {',
  '    const [count] = useState(2);',
  '    const user = useCurrentUser();',
  '    return <Card title={user.name}>{count}</Card>;',
  '  },',
  '});',
  '',
].join('\n');

const CELL = [
  "import { defineWidget } from '@adminiumjs/adminium/ui';",
  '',
  'export default defineWidget({',
  "  kind: 'cell',",
  '  component: ({ value }) => (value ? <strong>Flagged</strong> : null),',
  '});',
  '',
].join('\n');

describe('the page and widget files', () => {
  it('are the code files at the top of pages/ and widgets/, and not page files, helpers or tests', () => {
    put('pages/customers.json', '{}');
    put('pages/revenue.tsx', '');
    put('pages/_chart.tsx', '');
    put('pages/revenue.test.tsx', '');
    put('pages/notes.md', '');
    put('pages/nested/deep.tsx', '');
    put('widgets/flag-cell.tsx', '');
    put('widgets/types.d.ts', '');
    expect(clientCodeSources(dir)).toEqual([
      { kind: 'pages', name: 'revenue', source: 'pages/revenue.tsx' },
      { kind: 'widgets', name: 'flag-cell', source: 'widgets/flag-cell.tsx' },
    ]);
  });

  it('refuse two files with one name, and a page file beside a page of the same address', () => {
    put('widgets/flag.tsx', '');
    put('widgets/flag.ts', '');
    expect(() => clientCodeSources(dir)).toThrow(/widgets\/flag\.tsx? and widgets\/flag\.tsx? have the same name/);
    rmSync(join(dir, 'widgets'), { recursive: true });
    put('pages/revenue.json', '{}');
    put('pages/revenue.tsx', '');
    expect(() => clientCodeSources(dir)).toThrow(
      'pages/revenue.json and pages/revenue.tsx both describe the page at /p/revenue',
    );
  });

  it('refuse names that cannot be an address or a widget id', () => {
    put('pages/Revenue.tsx', '');
    expect(() => clientCodeSources(dir)).toThrow(/pages\/Revenue\.tsx: a page's file name is its address/);
    rmSync(join(dir, 'pages'), { recursive: true });
    put('widgets/Flag Cell.tsx', '');
    expect(() => clientCodeSources(dir)).toThrow(/widgets\/Flag Cell\.tsx: a widget is named after its file/);
  });
});

describe('reading settings', () => {
  const page = { kind: 'pages' as const, name: 'revenue', source: 'pages/revenue.tsx' };
  const widget = { kind: 'widgets' as const, name: 'flag', source: 'widgets/flag.tsx' };
  const exporting = (value: string): string => `module.exports = { default: ${value} };`;

  it('fills in the defaults of a page', () => {
    expect(readSettings(page, exporting("{ title: 'Revenue', component() {} }"))).toEqual({
      kind: 'pages',
      title: 'Revenue',
      icon: 'file',
      nav: { group: 'workspace', order: null, hidden: false },
    });
  });

  it('names what is wrong with a page or a widget', () => {
    expect(() => readSettings(page, exporting("{ title: '', component: 1, extra: true }"))).toThrow(
      /pages\/revenue\.tsx: the page is not valid: .*unknown option "extra"/,
    );
    expect(() => readSettings(widget, exporting("{ kind: 'row', component() {} }"))).toThrow(
      /widgets\/flag\.tsx: the widget is not valid/,
    );
    expect(() => readSettings(page, 'module.exports = {};')).toThrow(
      'pages/revenue.tsx has no default export. End it with `export default definePage({ … })`.',
    );
  });

  it('explains top-level code that needs a browser', () => {
    expect(() => readSettings(page, `window.foo = 1; ${exporting('{}')}`)).toThrow(
      /pages\/revenue\.tsx: its top-level code failed while Adminium read its settings \(ReferenceError: window is not defined\)/,
    );
  });

  it('stops top-level code that never ends', () => {
    expect(() => readSettings(page, 'for (;;) {}', { timeoutMs: 50 })).toThrow(/top-level code failed.*timed out/);
  });

  it('reads a card title, and leaves a cell without one', () => {
    expect(readSettings(widget, exporting("{ kind: 'card', title: 'Sales', component() {} }"))).toEqual({
      kind: 'widgets',
      widget: 'card',
      title: 'Sales',
    });
    expect(readSettings(widget, exporting("{ kind: 'cell', component() {} }"))).toEqual({
      kind: 'widgets',
      widget: 'cell',
      title: null,
    });
  });
});

describe('bare imports in built code', () => {
  it('finds static and literal dynamic imports of packages, and nothing relative', () => {
    const code = [
      'import{a as b}from"./chunks/chunk-X.js";',
      'import "left-pad";',
      'export{c}from"react";',
      'const d=await import("lodash");',
      'const e=await import("./lazy.js");',
      'import*as f from"/abs.js";',
    ].join('');
    expect(bareImportsIn(code)).toEqual(['left-pad', 'lodash', 'react']);
  });
});

/** esbuild itself, when this checkout can reach it (it comes with vitest's own bundler). */
async function realEsbuild(): Promise<ClientBundler | null> {
  try {
    const fromHere = createRequire(import.meta.url);
    const vite = createRequire(fromHere.resolve('vitest/package.json')).resolve('vite');
    const esbuild = createRequire(vite).resolve('esbuild');
    const mod = (await import(pathToFileURL(esbuild).href)) as { build?: unknown; default?: ClientBundler };
    return typeof mod.build === 'function' ? (mod as unknown as ClientBundler) : (mod.default ?? null);
  } catch {
    return null;
  }
}

const esbuild = await realEsbuild();

it.runIf(Boolean(process.env.CI))('reaches the real esbuild in CI', () => {
  expect(esbuild, 'vitest no longer brings esbuild: add it to this package devDependencies').not.toBeNull();
});

describe.skipIf(esbuild === null)('with the real esbuild', () => {
  const bundler = esbuild as ClientBundler;

  it('builds pages and widgets into hashed modules with no bare import, and records their settings', async () => {
    put('pages/revenue.tsx', PAGE);
    put('pages/revenue.css', '.revenue { color: red }\n');
    put('widgets/flag-cell.tsx', CELL);
    const client = await buildClientCode(dir, buildDir(), { bundler });

    expect(client.pages).toEqual([
      expect.objectContaining({
        name: 'revenue',
        source: 'pages/revenue.tsx',
        title: 'Revenue',
        icon: 'chart-line',
        nav: { group: 'library', order: 4, hidden: false },
      }),
    ]);
    expect(client.widgets).toEqual([expect.objectContaining({ name: 'flag-cell', kind: 'cell', title: null })]);
    const [page] = client.pages;
    expect(page?.module).toMatch(/^pages\/revenue-[A-Z0-9]+\.js$/);
    expect(page?.styles).toEqual([expect.stringMatching(/^pages\/revenue-[A-Z0-9]+\.css$/)]);
    expect(page?.imports.length).toBeGreaterThan(0);
    expect(Object.keys(client.inputs).sort()).toEqual(['pages/revenue.css', 'pages/revenue.tsx', 'widgets/flag-cell.tsx']);

    for (const file of client.files) {
      const bytes = readFileSync(join(buildDir(), 'client', file.path));
      expect(file.integrity).toMatch(/^sha384-/);
      if (file.path.endsWith('.js')) expect(bareImportsIn(bytes.toString('utf8'))).toEqual([]);
    }
    const shared = client.files.map((file) => readFileSync(join(buildDir(), 'client', file.path), 'utf8')).join('\n');
    // The host runtime is read, and neither React nor the kit is bundled.
    expect(shared).toContain('__ADMINIUM_ADD_ON_RUNTIME__');
    expect(shared).not.toContain('react.production');
    expect(clientCodeStaleReason(dir, buildDir(), client)).toBeNull();

    put('widgets/flag-cell.tsx', CELL.replace('Flagged', 'Marked'));
    expect(clientCodeStaleReason(dir, buildDir(), client)).toBe('widgets/flag-cell.tsx changed since the last build');
    put('widgets/other.tsx', CELL);
    expect(clientCodeStaleReason(dir, buildDir(), client)).toBe('widgets/other.tsx is new since the last build');
  });

  it('finds the settings of each file whichever separator the output paths use', async () => {
    put('pages/revenue.tsx', PAGE);
    put('pages/revenue.css', '');
    put('widgets/flag-cell.tsx', CELL);
    // On Windows the settings pass hands back paths such as C:\project\.adminium\settings\pages\revenue.js.
    const windowsPaths: ClientBundler = {
      build: async (options) => {
        const result = await bundler.build(options);
        if (options['write'] !== false) return result;
        return {
          ...result,
          outputFiles: (result.outputFiles ?? []).map((file) => ({
            path: `C:${file.path.replaceAll('/', '\\')}`,
            text: file.text,
          })),
        };
      },
    };
    const client = await buildClientCode(dir, buildDir(), { bundler: windowsPaths });
    expect(client.pages.map((page) => [page.name, page.title])).toEqual([['revenue', 'Revenue']]);
    expect(client.widgets.map((widget) => [widget.name, widget.kind])).toEqual([['flag-cell', 'cell']]);
  });

  it('runs a built page against a host runtime that is only React-shaped', async () => {
    put('pages/revenue.tsx', PAGE);
    put('pages/revenue.css', '');
    const client = await buildClientCode(dir, buildDir(), { bundler, dev: true });
    const calls: string[] = [];
    const tag = (name: string) => (props: unknown) => ({ name, props });
    (globalThis as Record<string, unknown>)['__ADMINIUM_ADD_ON_RUNTIME__'] = {
      react: { useState: (value: unknown) => [value, () => undefined] },
      jsx: { jsx: (type: unknown, props: unknown) => ({ type, props }), jsxs: () => null, Fragment: 'F' },
      ui: {
        Card: tag('Card'),
        useCurrentUser: () => {
          calls.push('useCurrentUser');
          return { name: 'Ada' };
        },
      },
    };
    try {
      const url = pathToFileURL(join(buildDir(), 'client', client.pages[0]?.module ?? '')).href;
      const mod = (await import(url)) as { default: { title: string; component: () => { props: { title: string } } } };
      expect(mod.default.title).toBe('Revenue');
      expect(mod.default.component().props.title).toBe('Ada');
      expect(calls).toEqual(['useCurrentUser']);
    } finally {
      delete (globalThis as Record<string, unknown>)['__ADMINIUM_ADD_ON_RUNTIME__'];
    }
  });

  it('bundles a package a page imports, and still reads the page with that package stubbed', async () => {
    put('node_modules/greet/package.json', JSON.stringify({ name: 'greet', main: 'index.js' }));
    // A library that needs the browser as soon as it is imported.
    put('node_modules/greet/index.js', 'document.title; module.exports = (name) => `Hi ${name}`;\n');
    put(
      'widgets/hello.tsx',
      [
        "import { defineWidget } from '@adminiumjs/adminium/ui';",
        "import greet from 'greet';",
        "const label = greet('you');",
        "export default defineWidget({ kind: 'card', title: 'Hello', component: () => <p>{label}</p> });",
        '',
      ].join('\n'),
    );
    const client = await buildClientCode(dir, buildDir(), { bundler });
    expect(client.widgets).toEqual([expect.objectContaining({ name: 'hello', kind: 'card', title: 'Hello' })]);
    const code = readFileSync(join(buildDir(), 'client', client.widgets[0]?.module ?? ''), 'utf8');
    expect(code).toContain('Hi ');
    expect(client.inputs).toEqual({ 'widgets/hello.tsx': expect.any(String) });
  });

  it('refers to chunks and assets by relative paths, so the folder can be served under any URL', async () => {
    put('widgets/logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
    put('widgets/brand.css', '.brand { background: url(./logo.svg) }\n');
    put(
      'widgets/brand.tsx',
      [
        "import { defineWidget } from '@adminiumjs/adminium/ui';",
        "import logo from './logo.svg';",
        "import './brand.css';",
        "export default defineWidget({ kind: 'card', component: () => <img src={logo} alt='' /> });",
        '',
      ].join('\n'),
    );
    put('widgets/flag-cell.tsx', CELL);
    const client = await buildClientCode(dir, buildDir(), { bundler, dev: true });
    const brand = client.widgets.find((widget) => widget.name === 'brand');
    const code = readFileSync(join(buildDir(), 'client', brand?.module ?? ''), 'utf8');
    expect(code).toMatch(/from "\.\.\/chunks\/chunk-[A-Z0-9]+\.js"/);
    expect(code).toMatch(/new URL\(\w+, import\.meta\.url\)\.href/);
    expect(code).toMatch(/"\.\.\/assets\/logo-[A-Z0-9]+\.svg"/);
    expect(code).not.toContain('/api/v1/');
    const css = readFileSync(join(buildDir(), 'client', brand?.styles[0] ?? ''), 'utf8');
    expect(css).toMatch(/url\("\.\.\/assets\/logo-[A-Z0-9]+\.svg"\)/);
    expect(client.files.map((file) => file.path)).toContainEqual(expect.stringMatching(/^assets\/logo-[A-Z0-9]+\.svg$/));
    expect(client.inputs).toMatchObject({ 'widgets/logo.svg': expect.any(String), 'widgets/brand.css': expect.any(String) });
  });

  it('refuses browser-only imports it cannot provide, by name', async () => {
    put('pages/one.tsx', "import { createRoot } from 'react-dom/client';\nexport default { title: 'x', component: createRoot };\n");
    await expect(buildClientCode(dir, buildDir(), { bundler })).rejects.toThrow(
      /"react-dom\/client" is not available to pages and widgets/,
    );
    rmSync(join(dir, 'pages'), { recursive: true });
    put('widgets/two.tsx', "import { defineHook } from '@adminiumjs/adminium';\nexport default defineHook;\n");
    await expect(buildClientCode(dir, buildDir(), { bundler })).rejects.toThrow(
      /Pages and widgets import from "@adminiumjs\/adminium\/ui"\. "@adminiumjs\/adminium" is server code/,
    );
  });

  it('reports a file that does not compile with its line, and keeps the last good output', async () => {
    put('widgets/flag-cell.tsx', CELL);
    const good = await buildClientCode(dir, buildDir(), { bundler });
    put('widgets/flag-cell.tsx', 'export default {\n  kind: "cell",\n');
    await expect(buildClientCode(dir, buildDir(), { bundler })).rejects.toThrow(
      /Could not build the project's pages and widgets:\n.*widgets\/flag-cell\.tsx:\d+:\d+/,
    );
    for (const file of good.files) expect(existsSync(join(buildDir(), 'client', file.path))).toBe(true);
  });

  it('removes the output when the last page goes, and a manifest remembers the build', async () => {
    const location: ProjectLocation = { root: dir, configFile: join(dir, 'adminium.config.mjs') };
    put('adminium.config.mjs', "export default { databases: { main: { url: 'sqlite:./a.db' } } };\n");
    put('pages/revenue.tsx', PAGE);
    put('pages/revenue.css', '');
    const { manifest } = await buildProject(location, { version: '1', loadBundler: async () => bundler });
    expect(manifest.client?.pages.map((page) => page.name)).toEqual(['revenue']);
    expect(readClientBuild(buildDir())?.digest).toBe(manifest.client?.digest);
    expect(staleReason(location, '1')).toBeNull();

    rmSync(join(dir, 'pages', 'revenue.tsx'));
    expect(staleReason(location, '1')).toBe('pages/revenue.tsx was removed since the last build');
    const client = await rebuildClientCode(location, { loadBundler: async () => bundler });
    expect(client.digest).toBe('');
    expect(existsSync(join(buildDir(), 'client'))).toBe(false);
    expect(readBuildManifest(location)?.client?.digest).toBe('');
    expect(staleReason(location, '1')).toBeNull();
  });
});

describe('the shims', () => {
  it('are the contract package files and this package\'s kit module', () => {
    const shims = defaultClientShims();
    for (const path of Object.values(shims)) expect(existsSync(path)).toBe(true);
    expect(shims.react).toMatch(/add-on-contracts[/\\]dist[/\\]runtime[/\\]react\.js$/);
    expect(shims.ui).toMatch(/src[/\\]ui[/\\]index\.ts$/);
  });

  it('are what an unreadable manifest gives no build for', () => {
    mkdirSync(buildDir(), { recursive: true });
    writeFileSync(join(buildDir(), 'manifest.json'), '{');
    expect(readClientBuild(buildDir())).toBeNull();
    writeFileSync(join(buildDir(), 'manifest.json'), '{"client":{"digest":1}}');
    expect(readClientBuild(buildDir())?.digest).toBe('');
  });
});
