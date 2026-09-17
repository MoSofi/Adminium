// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Building a project's config and loading it back: when the build is used,
 * when it is redone, and what happens without esbuild.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildProject,
  isNativePackage,
  loadProjectConfig,
  packageNameOf,
  readBuildManifest,
  rebuildServerCode,
  serverCodeSources,
  staleReason,
  type Bundler,
} from '../src/project/build.js';
import { loadProjectCode } from '../src/project/code/load.js';
import type { ProjectLocation } from '../src/project/locate.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'adminium-build-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function project(file: string, source: string): ProjectLocation {
  writeFileSync(join(dir, file), source);
  return { root: dir, configFile: join(dir, file) };
}

/** Stands in for esbuild: copies the entry to the outfile and reports it as the only input. */
function copyingBundler(): Bundler & { build: ReturnType<typeof vi.fn> } {
  return {
    build: vi.fn(async (options: Record<string, unknown>) => {
      const entry = (options.entryPoints as string[])[0] as string;
      writeFileSync(options.outfile as string, readFileSync(entry, 'utf8'));
      return { metafile: { inputs: { [entry.slice(dir.length + 1)]: {}, 'adminium-helpers:@adminiumjs/adminium': {} } } };
    }),
  };
}

const CONFIG = "export default { databases: { main: { url: 'sqlite:./a.db' } } };\n";

describe('building', () => {
  it('writes the output and a manifest of the version and the inputs', async () => {
    const p = project('adminium.config.ts', CONFIG);
    const bundler = copyingBundler();
    const { configOutput, manifest } = await buildProject(p, { version: '9.9.9', loadBundler: async () => bundler });
    expect(existsSync(configOutput)).toBe(true);
    expect(manifest.adminiumVersion).toBe('9.9.9');
    expect(manifest.config.entry).toBe('adminium.config.ts');
    // The virtual helpers module is not a file, so it is not an input.
    expect(Object.keys(manifest.config.inputs)).toEqual(['adminium.config.ts']);
    expect(readBuildManifest(p)).toEqual(manifest);
    const options = bundler.build.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(options).toMatchObject({ bundle: true, platform: 'node', format: 'esm', metafile: true });
  });

  it('says how to get esbuild when the project has none', async () => {
    const p = project('adminium.config.ts', CONFIG);
    await expect(buildProject(p, { version: '1', loadBundler: async () => null })).rejects.toThrow(/needs esbuild/);
  });

  it('turns an esbuild failure into lines that name the file and position', async () => {
    const p = project('adminium.config.ts', CONFIG);
    const failing: Bundler = {
      build: async () => {
        throw Object.assign(new Error('Build failed'), {
          errors: [{ text: 'Expected ";"', location: { file: 'adminium.config.ts', line: 3, column: 7 } }],
        });
      },
    };
    await expect(buildProject(p, { version: '1', loadBundler: async () => failing })).rejects.toThrow(
      'adminium.config.ts:3:7: Expected ";"',
    );
  });
});

/** Write a file under the project, creating its folder. */
function put(path: string, text: string): void {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), text);
}

describe('finding hooks and actions', () => {
  it('takes the top level of hooks/ and actions/, in TypeScript or JavaScript', () => {
    for (const path of [
      'hooks/orders.ts',
      'hooks/customers.mjs',
      'hooks/_shared.ts',
      'hooks/.draft.ts',
      'hooks/types.d.ts',
      'hooks/orders.test.ts',
      'hooks/notes.md',
      'hooks/nested/deep.ts',
      'actions/refund-order.ts',
      'actions/export.js',
    ]) {
      put(path, 'export default {};\n');
    }
    expect(serverCodeSources(dir)).toEqual([
      { kind: 'actions', name: 'export', source: 'actions/export.js' },
      { kind: 'actions', name: 'refund-order', source: 'actions/refund-order.ts' },
      { kind: 'hooks', name: 'customers', source: 'hooks/customers.mjs' },
      { kind: 'hooks', name: 'orders', source: 'hooks/orders.ts' },
    ]);
  });

  it('refuses two files with the same name', () => {
    put('actions/refund.ts', '');
    put('actions/refund.js', '');
    expect(() => serverCodeSources(dir)).toThrow(/actions\/refund\.(ts|js) and actions\/refund\.(ts|js) have the same name/);
  });

  it('knows a package by its import and a native one by its files', () => {
    expect(packageNameOf('pg/lib/client')).toBe('pg');
    expect(packageNameOf('@scope/name/deep')).toBe('@scope/name');
    put('node_modules/gyp-thing/package.json', JSON.stringify({ name: 'gyp-thing', gypfile: true }));
    put('node_modules/prebuilt/package.json', JSON.stringify({ name: 'prebuilt', dependencies: { 'node-gyp-build': '^4' } }));
    put('node_modules/binding/package.json', JSON.stringify({ name: 'binding' }));
    put('node_modules/binding/binding.gyp', '{}');
    put('node_modules/plain/package.json', JSON.stringify({ name: 'plain', dependencies: { lodash: '^4' } }));
    expect(['gyp-thing', 'prebuilt', 'binding', 'plain', 'missing'].map((name) => isNativePackage(join(dir, 'node_modules', name)))).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
  });
});

describe('knowing when a build is out of date', () => {
  it('is out of date until it is built, then when the version or an input changes', async () => {
    const p = project('adminium.config.ts', CONFIG);
    expect(staleReason(p, '1.0.0')).toMatch(/not been built/);
    await buildProject(p, { version: '1.0.0', loadBundler: async () => copyingBundler() });
    expect(staleReason(p, '1.0.0')).toBeNull();
    expect(staleReason(p, '1.0.1')).toMatch(/built by Adminium 1.0.0, and this is 1.0.1/);
    writeFileSync(p.configFile, `${CONFIG}// edited\n`);
    expect(staleReason(p, '1.0.0')).toMatch(/adminium.config.ts changed/);
  });

  it('is out of date when a hook or an action is added, removed or changed', async () => {
    const p = project('adminium.config.ts', CONFIG);
    const bundler: Bundler = {
      build: vi.fn(async (options: Record<string, unknown>) => {
        if (options.outdir === undefined) return copyingBundler().build(options);
        const entries = options.entryPoints as { in: string; out: string }[];
        for (const entry of entries) {
          const output = join(options.outdir as string, `${entry.out}.mjs`);
          mkdirSync(dirname(output), { recursive: true });
          writeFileSync(output, readFileSync(entry.in, 'utf8'));
        }
        return { metafile: { inputs: Object.fromEntries(entries.map((entry) => [entry.in.slice(dir.length + 1), {}])) } };
      }),
    };
    await buildProject(p, { version: '1', loadBundler: async () => bundler });
    expect(readBuildManifest(p)?.server).toEqual({ digest: '', files: [], inputs: {} });
    expect(staleReason(p, '1')).toBeNull();

    put('hooks/orders.ts', 'export default {};\n');
    expect(staleReason(p, '1')).toBe('hooks/orders.ts is new since the last build');
    const { manifest } = await buildProject(p, { version: '1', loadBundler: async () => bundler });
    expect(manifest.server?.files).toEqual([
      {
        kind: 'hooks',
        name: 'orders',
        source: 'hooks/orders.ts',
        output: 'server/hooks/orders.mjs',
        hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    ]);
    expect(manifest.server?.inputs).toEqual({ 'hooks/orders.ts': expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(staleReason(p, '1')).toBeNull();

    put('hooks/orders.ts', 'export default { changed: true };\n');
    expect(staleReason(p, '1')).toBe('hooks/orders.ts changed since the last build');
    const first = manifest.server?.digest;
    const rebuilt = await rebuildServerCode(p, { loadBundler: async () => bundler });
    expect(rebuilt.digest).not.toBe(first);
    expect(readBuildManifest(p)?.server?.digest).toBe(rebuilt.digest);
    expect(readBuildManifest(p)?.adminiumVersion).toBe('1');
    expect(staleReason(p, '1')).toBeNull();

    writeFileSync(join(dir, '.adminium', 'build', 'server', 'hooks', 'orders.mjs'), 'tampered');
    expect(staleReason(p, '1')).toBe('server/hooks/orders.mjs is missing or was changed');

    rmSync(join(dir, 'hooks', 'orders.ts'));
    expect(staleReason(p, '1')).toBe('hooks/orders.ts was removed since the last build');
  });

  it('needs a build, not the source, for a JavaScript config once there are hooks', async () => {
    const p = project('adminium.config.mjs', CONFIG);
    put('actions/refund.ts', 'export default {};\n');
    await expect(loadProjectConfig(p, { version: '1', loadBundler: async () => null })).rejects.toThrow(
      /cannot be loaded: the project has not been built/,
    );
    await expect(rebuildServerCode(p, { loadBundler: async () => null })).rejects.toThrow(/has not been built yet/);
  });
});

describe('loading the config', () => {
  it('uses a current build without building again', async () => {
    const p = project('adminium.config.ts', CONFIG);
    await buildProject(p, { version: '1', loadBundler: async () => copyingBundler() });
    const bundler = copyingBundler();
    const loaded = await loadProjectConfig(p, { version: '1', loadBundler: async () => bundler });
    expect(loaded.from).toBe('build');
    expect(loaded.config.databases?.main?.url).toBe('sqlite:./a.db');
    expect(bundler.build).not.toHaveBeenCalled();
  });

  it('builds first when the build is out of date and esbuild is there', async () => {
    const p = project('adminium.config.ts', CONFIG);
    const loaded = await loadProjectConfig(p, { version: '1', loadBundler: async () => copyingBundler() });
    expect(loaded.from).toBe('new-build');
  });

  it('imports a JavaScript config directly when there is no esbuild', async () => {
    const p = project('adminium.config.mjs', CONFIG);
    const loaded = await loadProjectConfig(p, { version: '1', loadBundler: async () => null });
    expect(loaded.from).toBe('source');
    expect(loaded.config.databases?.main?.url).toBe('sqlite:./a.db');
  });

  it('explains what to run for a TypeScript config with no build and no esbuild', async () => {
    const p = project('adminium.config.ts', CONFIG);
    await expect(loadProjectConfig(p, { version: '1', loadBundler: async () => null })).rejects.toThrow(
      /cannot be loaded: the project has not been built/,
    );
  });

  it('lists what is wrong with an invalid config', async () => {
    const p = project('adminium.config.mjs', "export default { databases: { Main: {} }, port: 1 };\n");
    await expect(loadProjectConfig(p, { version: '1', loadBundler: async () => null })).rejects.toThrow(
      /databases\.Main[\s\S]*port/,
    );
  });
});

describe('finding esbuild', () => {
  it('finds it only in a node_modules folder of the project or above', async () => {
    const { loadProjectBundler } = await import('../src/project/build.js');
    expect(await loadProjectBundler(dir)).toBeNull();
  });
});

/**
 * esbuild itself, when this checkout can reach it (it comes with vitest's own
 * bundler). This is the check that the plugin shape and the options really
 * work, rather than only a stand-in.
 */
async function realEsbuild(): Promise<Bundler | null> {
  try {
    const fromHere = createRequire(import.meta.url);
    const vite = createRequire(fromHere.resolve('vitest/package.json')).resolve('vite');
    const esbuild = createRequire(vite).resolve('esbuild');
    const mod = (await import(pathToFileURL(esbuild).href)) as { build?: unknown; default?: Bundler };
    return typeof mod.build === 'function' ? (mod as Bundler) : (mod.default ?? null);
  } catch {
    return null;
  }
}

const esbuild = await realEsbuild();

// Vite 8 no longer depends on esbuild, so a vitest upgrade would skip the block
// below. In CI that fails here instead of passing with the real build unrun.
it.runIf(Boolean(process.env.CI))('reaches the real esbuild in CI', () => {
  expect(esbuild, 'vitest no longer brings esbuild: add it to this package devDependencies').not.toBeNull();
});

describe.skipIf(esbuild === null)('with the real esbuild', () => {
  it('compiles TypeScript, inlines the helpers and bundles a local import', async () => {
    writeFileSync(join(dir, 'ports.ts'), 'export const port: number = 8123;\n');
    const p = project(
      'adminium.config.ts',
      [
        "import { defineConfig, env } from '@adminiumjs/adminium';",
        "import { port } from './ports';",
        'export default defineConfig({',
        "  databases: { main: { url: env('ADMINIUM_TEST_BUILD_URL', 'sqlite:./fallback.db') } },",
        '  server: { port },',
        '});',
        '',
      ].join('\n'),
    );
    const { configOutput, manifest } = await buildProject(p, { version: '1', loadBundler: async () => esbuild });
    expect(Object.keys(manifest.config.inputs).sort()).toEqual(['adminium.config.ts', 'ports.ts']);
    // The helpers are inlined: nothing is imported from the package at run time.
    const output = readFileSync(configOutput, 'utf8');
    expect(output).not.toMatch(/(from|import)\s*["']@adminiumjs\/adminium["']/);
    expect(output).toContain('process.env');
    expect(dirname(configOutput)).toBe(join(dir, '.adminium', 'build'));

    const loaded = await loadProjectConfig(p, { version: '1', loadBundler: async () => esbuild });
    expect(loaded.from).toBe('build');
    expect(loaded.config).toEqual({
      databases: { main: { url: 'sqlite:./fallback.db' } },
      server: { port: 8123 },
    });

    // A change to the imported file makes the build stale too.
    writeFileSync(join(dir, 'ports.ts'), 'export const port: number = 8124;\n');
    expect(staleReason(p, '1')).toMatch(/ports.ts changed/);
  });

  it('bundles hooks and actions with their packages, and leaves native ones as imports', async () => {
    const p = project('adminium.config.ts', CONFIG);
    // A CommonJS package that requires a built-in: the bundle needs `require`.
    put('node_modules/shout/package.json', JSON.stringify({ name: 'shout', main: 'index.js' }));
    put('node_modules/shout/index.js', "const { sep } = require('node:path');\nmodule.exports = (text) => text.toUpperCase() + sep;\n");
    // A package with native code stays an import, loaded from node_modules.
    put('node_modules/native-thing/package.json', JSON.stringify({ name: 'native-thing', main: 'index.js', gypfile: true }));
    put('node_modules/native-thing/index.js', 'module.exports = { native: true };\n');
    put('hooks/_shared.ts', "export const prefix: string = 'order';\n");
    put(
      'hooks/orders.ts',
      [
        "import { defineHook } from '@adminiumjs/adminium';",
        "import shout from 'shout';",
        "import native from 'native-thing';",
        "import { prefix } from './_shared';",
        '',
        'export default defineHook({',
        "  table: 'orders',",
        '  beforeCreate({ values }) {',
        '    values.label = shout(prefix) + String(native.native);',
        '  },',
        '});',
        '',
      ].join('\n'),
    );
    put(
      'actions/refund-order.ts',
      [
        "import { defineAction } from '@adminiumjs/adminium';",
        'export default defineAction({',
        "  table: 'orders',",
        "  label: 'Refund',",
        "  run: () => ({ message: 'done' }),",
        '});',
        '',
      ].join('\n'),
    );

    const { manifest } = await buildProject(p, { version: '1', loadBundler: async () => esbuild });
    expect(manifest.server?.files.map((file) => file.output)).toEqual([
      'server/actions/refund-order.mjs',
      'server/hooks/orders.mjs',
    ]);
    expect(Object.keys(manifest.server?.inputs ?? {}).sort()).toEqual([
      'actions/refund-order.ts',
      'hooks/_shared.ts',
      'hooks/orders.ts',
    ]);
    const hookOutput = readFileSync(join(dir, '.adminium', 'build', 'server', 'hooks', 'orders.mjs'), 'utf8');
    expect(hookOutput).not.toMatch(/(from|import)\s*["']@adminiumjs\/adminium["']/);
    expect(hookOutput).toMatch(/from\s*["']native-thing["']/);
    expect(hookOutput).not.toMatch(/from\s*["']shout["']/);

    const code = await loadProjectCode(join(dir, '.adminium', 'build'));
    expect(code.problems).toEqual([]);
    expect([...code.actions.keys()]).toEqual(['refund-order']);
    const values: Record<string, unknown> = {};
    await code.hooks[0]?.definition.beforeCreate?.({ values } as never);
    expect(values.label).toBe(`ORDER${join('a', 'b').slice(1, 2)}true`);
    expect(staleReason(p, '1')).toBeNull();
  });

  it('reports a hook that does not compile with its file and line', async () => {
    const p = project('adminium.config.ts', CONFIG);
    put('hooks/orders.ts', 'export default {\n  table: "orders",\n  beforeCreate() {\n');
    await expect(buildProject(p, { version: '1', loadBundler: async () => esbuild })).rejects.toThrow(
      /Could not build the project's hooks and actions:\n.*hooks\/orders\.ts:\d+:\d+/,
    );
  });
});
