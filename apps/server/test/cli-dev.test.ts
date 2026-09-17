// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `adminium dev` and `adminium build` as commands: what `dev` builds, the
 * server it starts, what it rebuilds without a restart, and how it stops. The
 * server is a stand-in. Builds use the esbuild that comes with vitest's
 * bundler, linked into the project the way a project installs it.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runCli } from '../src/cli/run.js';
import type { SpawnDevServer } from '../src/cli/runtime.js';
import { APP_VERSION } from '../src/version.js';
import { fakeDeps, fakeIo, type FakeIo } from './cli-helpers.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'adminium-cli-dev-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function put(file: string, text: string): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
}

/** The folder of the esbuild vitest's bundler uses, or null when this checkout has none. */
function esbuildFolder(): string | null {
  try {
    const fromHere = createRequire(import.meta.url);
    const vite = createRequire(fromHere.resolve('vitest/package.json')).resolve('vite');
    return dirname(createRequire(vite).resolve('esbuild/package.json'));
  } catch {
    return null;
  }
}
const esbuild = esbuildFolder();

const CONFIG_TS = [
  "import { defineConfig } from '@adminiumjs/adminium';",
  '',
  'export default defineConfig({ databases: {} });',
  '',
].join('\n');

const HOOK = [
  "import { defineHook } from '@adminiumjs/adminium';",
  '',
  "export default defineHook({ table: 'orders', beforeCreate() {} });",
  '',
].join('\n');

const PAGE = [
  "import { definePage } from '@adminiumjs/adminium/ui';",
  '',
  "export default definePage({ title: 'Revenue', component: () => null });",
  '',
].join('\n');

const WIDGET = [
  "import { defineWidget } from '@adminiumjs/adminium/ui';",
  '',
  "export default defineWidget({ kind: 'cell', component: () => null });",
  '',
].join('\n');

interface Spawned {
  args: readonly string[];
  cwd: string;
  env: Record<string, string | undefined>;
  signals: NodeJS.Signals[];
}

/** Runs `adminium dev` with a stand-in server until the returned `stop` is called. */
function startDev(argv: string[] = []) {
  const spawned: Spawned[] = [];
  const spawnDevServer: SpawnDevServer = (args, opts) => {
    const record: Spawned = { args, cwd: opts.cwd, env: opts.env, signals: [] };
    spawned.push(record);
    const listeners: ((code: number | null, signal: NodeJS.Signals | null) => void)[] = [];
    return {
      kill: (signal) => {
        record.signals.push(signal);
        queueMicrotask(() => {
          for (const listener of listeners.splice(0)) listener(null, signal);
        });
      },
      onExit: (listener) => {
        listeners.push(listener);
      },
    };
  };
  const controller = new AbortController();
  const io = fakeIo({ interactive: false });
  const deps = { ...fakeDeps({ cwd: root, env: { PATH: process.env.PATH } }), spawnDevServer, signal: controller.signal };
  const exit = runCli(['dev', ...argv], { io, deps });
  return {
    io,
    spawned,
    exit,
    stop: async (): Promise<number> => {
      controller.abort();
      return exit;
    },
  };
}

const count = (io: FakeIo, pattern: RegExp): number => io.stdout().split('\n').filter((line) => pattern.test(line)).length;

describe('adminium dev', () => {
  it('runs only inside a project', async () => {
    const io = fakeIo({ interactive: false });
    await expect(runCli(['dev'], { io, deps: fakeDeps({ cwd: root, env: {} }) })).resolves.toBe(1);
    expect(io.stderr()).toContain('adminium dev runs inside a project');
  });

  it('starts a JavaScript project with no code without building it, and stops it', async () => {
    put('adminium.config.mjs', 'export default { databases: {} };\n');
    const dev = startDev(['--port', '4700', '--host', '127.0.0.1', '--log-level', 'warn']);
    await vi.waitFor(() => {
      expect(dev.spawned).toHaveLength(1);
    });
    const [server] = dev.spawned;
    expect(server?.args).toEqual(['start', '--port', '4700', '--host', '127.0.0.1', '--log-level', 'warn']);
    expect(server?.cwd).toBe(root);
    expect(server?.env).toMatchObject({ ADMINIUM_PROJECT_DIR: root, ADMINIUM_PROJECT_MODE: 'dev' });
    expect(dev.io.stdout()).toContain(`Running ${root} in development.`);
    expect(existsSync(join(root, '.adminium'))).toBe(false);

    await expect(dev.stop()).resolves.toBe(0);
    expect(server?.signals).toEqual(['SIGTERM']);
  });

  it('says a TypeScript project needs esbuild, and starts nothing until then', async () => {
    put('adminium.config.ts', CONFIG_TS);
    const dev = startDev();
    await vi.waitFor(() => {
      expect(dev.io.stderr()).toContain('needs esbuild');
    });
    expect(dev.io.stderr()).toContain('Fix it and save; Adminium starts again then.');
    expect(dev.spawned).toHaveLength(0);
    await expect(dev.stop()).resolves.toBe(0);
  });
});

describe.skipIf(esbuild === null)('adminium dev and build with esbuild', () => {
  beforeEach(() => {
    put('adminium.config.ts', CONFIG_TS);
    mkdirSync(join(root, 'node_modules'));
    symlinkSync(esbuild as string, join(root, 'node_modules', 'esbuild'), 'dir');
  });

  it('build compiles the config and the code, and says what it built', async () => {
    put('hooks/orders.ts', HOOK);
    put('pages/revenue.tsx', PAGE);
    const io = fakeIo({ interactive: false });
    await expect(runCli(['build'], { io, deps: fakeDeps({ cwd: root, env: {} }) })).resolves.toBe(0);
    expect(io.stdout()).toContain(
      `Built adminium.config.ts → ${join('.adminium', 'build', 'config.mjs')} (1 file(s), Adminium ${APP_VERSION}).`,
    );
    expect(io.stdout()).toContain('Built 1 hook and action file(s), 1 page(s) and 0 widget(s).');
  });

  it('rebuilds hooks, pages and widgets without a restart, ignores page files, and restarts for the config', async () => {
    const dev = startDev();
    await vi.waitFor(() => {
      expect(dev.spawned).toHaveLength(1);
    });
    expect(existsSync(join(root, '.adminium', 'build', 'config.mjs'))).toBe(true);

    // The sync makes pages/ for its first page files: no page code came with it.
    put('pages/customers.json', '{}\n');
    await new Promise((resolve) => setTimeout(resolve, 600));
    put('hooks/orders.ts', HOOK);
    await vi.waitFor(
      () => {
        expect(dev.io.stdout()).toContain('Rebuilt 1 hook and action file(s).');
      },
      { timeout: 10_000, interval: 100 },
    );
    expect(count(dev.io, /^Rebuilt \d+ page\(s\)/)).toBe(0);

    put('pages/revenue.tsx', PAGE);
    await vi.waitFor(
      () => {
        expect(dev.io.stdout()).toContain('Rebuilt 1 page(s) and 0 widget(s); open dashboards reload them.');
      },
      { timeout: 10_000, interval: 100 },
    );

    // Studio writes page files into pages/ all the time; they are the sync's business.
    put('pages/orders.json', '{}\n');
    await new Promise((resolve) => setTimeout(resolve, 600));
    put('widgets/flag-cell.tsx', WIDGET);
    await vi.waitFor(
      () => {
        expect(dev.io.stdout()).toContain('Rebuilt 1 page(s) and 1 widget(s); open dashboards reload them.');
      },
      { timeout: 10_000, interval: 100 },
    );
    expect(count(dev.io, /^Rebuilt \d+ page\(s\)/)).toBe(2);
    expect(dev.spawned).toHaveLength(1);

    put('adminium.config.ts', `${CONFIG_TS}// edited\n`);
    await vi.waitFor(
      () => {
        expect(dev.spawned).toHaveLength(2);
      },
      { timeout: 10_000, interval: 100 },
    );
    expect(dev.io.stdout()).toContain('adminium.config.ts changed, restarting Adminium…');
    expect(dev.spawned[0]?.signals).toEqual(['SIGTERM']);

    await expect(dev.stop()).resolves.toBe(0);
    expect(dev.spawned[1]?.signals).toEqual(['SIGTERM']);
  });
});
