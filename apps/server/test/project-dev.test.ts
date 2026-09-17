// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `adminium dev` supervisor: start, restart on a change, rebuild hooks,
 * actions, pages and widgets without one, survive a bad build or a crash, and
 * stop.
 */
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDevSupervisor, fingerprint, type DevChild, type DevCodeGroup } from '../src/project/dev.js';

let dir: string;
let config: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'adminium-dev-'));
  config = join(dir, 'adminium.config.ts');
  writeFileSync(config, 'v1');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A child process that exits when told to, or when a test crashes it. */
class FakeChild implements DevChild {
  signals: string[] = [];
  private listeners: ((code: number | null, signal: NodeJS.Signals | null) => void)[] = [];
  kill(signal: NodeJS.Signals): void {
    this.signals.push(signal);
    queueMicrotask(() => this.exit(null, signal));
  }
  onExit(listener: (code: number | null, signal: NodeJS.Signals | null) => void): void {
    this.listeners.push(listener);
  }
  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    const listeners = this.listeners;
    this.listeners = [];
    for (const listener of listeners) listener(code, signal);
  }
}

function harness(
  build: () => Promise<void> = async () => undefined,
  code?: DevCodeGroup,
  client?: DevCodeGroup,
) {
  const children: FakeChild[] = [];
  const log: string[] = [];
  const warn: string[] = [];
  const watchedDirs: string[] = [];
  const supervisor = createDevSupervisor({
    watched: () => [config],
    build: vi.fn(build),
    ...(code === undefined ? {} : { code }),
    ...(client === undefined ? {} : { client }),
    spawnServer: () => {
      const child = new FakeChild();
      children.push(child);
      return child;
    },
    watchDir: (watched) => {
      watchedDirs.push(watched);
      return { close: () => undefined };
    },
    log: (message) => log.push(message),
    warn: (message) => warn.push(message),
    stopGraceMs: 50,
  });
  return { supervisor, children, log, warn, watchedDirs };
}

describe('the dev supervisor', () => {
  it('builds, starts the server, and stops it on request', async () => {
    const { supervisor, children } = harness();
    const running = supervisor.run();
    await vi.waitFor(() => expect(children).toHaveLength(1));
    await supervisor.stop();
    await running;
    expect(children[0]?.signals).toEqual(['SIGTERM']);
  });

  it('restarts the server when a watched file changes, and only then', async () => {
    const { supervisor, children, log } = harness();
    void supervisor.run();
    await vi.waitFor(() => expect(children).toHaveLength(1));

    await supervisor.checkForChanges();
    expect(children).toHaveLength(1);

    writeFileSync(config, 'v2');
    await supervisor.checkForChanges();
    expect(children).toHaveLength(2);
    expect(children[0]?.signals).toEqual(['SIGTERM']);
    expect(log.join('\n')).toContain('adminium.config.ts changed');
    await supervisor.stop();
  });

  it('waits for a fix after a failed build instead of exiting', async () => {
    let broken = true;
    const { supervisor, children, warn } = harness(async () => {
      if (broken) throw new Error('adminium.config.ts:1:1: Unexpected token');
    });
    void supervisor.run();
    await vi.waitFor(() => expect(warn.join('\n')).toContain('Unexpected token'));
    expect(children).toHaveLength(0);

    broken = false;
    writeFileSync(config, 'fixed');
    await supervisor.checkForChanges();
    expect(children).toHaveLength(1);
    await supervisor.stop();
  });

  it('reports a crash and starts again on the next change', async () => {
    const { supervisor, children, warn } = harness();
    void supervisor.run();
    await vi.waitFor(() => expect(children).toHaveLength(1));
    children[0]?.exit(1);
    expect(warn.join('\n')).toContain('Adminium stopped (exit 1)');

    writeFileSync(config, 'v2');
    await supervisor.checkForChanges();
    expect(children).toHaveLength(2);
    await supervisor.stop();
  });

  it('rebuilds hooks and actions without a restart, including a new file', async () => {
    const hooks = join(dir, 'hooks');
    const hook = join(hooks, 'orders.ts');
    const rebuild = vi.fn(async () => undefined);
    const { supervisor, children, log, watchedDirs } = harness(async () => undefined, {
      watched: () => [hooks, join(dir, 'actions'), hook],
      rebuild,
    });
    void supervisor.run();
    await vi.waitFor(() => expect(children).toHaveLength(1));
    // The project folder is watched, so a hooks/ folder created later is seen.
    expect(watchedDirs).toContain(dir);

    mkdirSync(hooks);
    await supervisor.checkForChanges();
    expect(rebuild).toHaveBeenCalledTimes(1);
    expect(watchedDirs).toContain(hooks);

    writeFileSync(hook, 'export default {};');
    await supervisor.checkForChanges();
    expect(rebuild).toHaveBeenCalledTimes(2);

    writeFileSync(hook, 'export default { changed: true };');
    await supervisor.checkForChanges();
    expect(rebuild).toHaveBeenCalledTimes(3);
    expect(children).toHaveLength(1);
    expect(children[0]?.signals).toEqual([]);
    expect(log.join('\n')).toContain('orders.ts changed, rebuilding hooks and actions');

    // A config change still restarts, and wins over a code change.
    writeFileSync(config, 'v2');
    writeFileSync(hook, 'export default { again: true };');
    await supervisor.checkForChanges();
    expect(children).toHaveLength(2);
    await supervisor.stop();
  });

  it('keeps the server running when hooks fail to build', async () => {
    const hook = join(dir, 'hook.ts');
    writeFileSync(hook, 'ok');
    const { supervisor, children, warn } = harness(async () => undefined, {
      watched: () => [hook],
      rebuild: async () => {
        throw new Error('hooks/orders.ts:3:1: Expected "}"');
      },
    });
    void supervisor.run();
    await vi.waitFor(() => expect(children).toHaveLength(1));
    writeFileSync(hook, 'broken');
    await supervisor.checkForChanges();
    expect(warn.join('\n')).toContain('Expected "}"');
    expect(warn.join('\n')).toContain('the server keeps the hooks and actions it has');
    expect(children[0]?.signals).toEqual([]);
    await supervisor.stop();
  });

  it('rebuilds pages and widgets on their own, and both groups when both changed', async () => {
    const pages = join(dir, 'pages');
    mkdirSync(pages);
    const page = join(pages, 'revenue.tsx');
    const hook = join(dir, 'hook.ts');
    writeFileSync(page, 'v1');
    writeFileSync(hook, 'v1');
    const rebuildCode = vi.fn(async () => undefined);
    const rebuildClient = vi.fn(async () => undefined);
    // Like `adminium dev`: a page folder changes only when a code file comes or goes.
    const codeOnly = (path: string): string =>
      path === pages ? readdirSync(pages).filter((name) => name.endsWith('.tsx')).sort().join('/') : readFileSync(path, 'utf8');
    const { supervisor, children, log } = harness(
      async () => undefined,
      { watched: () => [hook], rebuild: rebuildCode },
      { label: 'pages and widgets', watched: () => [pages, page], rebuild: rebuildClient, fingerprint: codeOnly },
    );
    void supervisor.run();
    await vi.waitFor(() => expect(children).toHaveLength(1));

    writeFileSync(page, 'v2');
    await supervisor.checkForChanges();
    expect(rebuildClient).toHaveBeenCalledTimes(1);
    expect(rebuildCode).not.toHaveBeenCalled();
    expect(log.join('\n')).toContain('revenue.tsx changed, rebuilding pages and widgets');

    // A page file written by Studio is the sync's business, not a rebuild.
    writeFileSync(join(pages, 'customers.json'), '{}');
    await supervisor.checkForChanges();
    expect(rebuildClient).toHaveBeenCalledTimes(1);

    writeFileSync(page, 'v3');
    writeFileSync(hook, 'v2');
    await supervisor.checkForChanges();
    expect(rebuildClient).toHaveBeenCalledTimes(2);
    expect(rebuildCode).toHaveBeenCalledTimes(1);
    expect(children).toHaveLength(1);
    await supervisor.stop();
  });

  it('keeps the last pages and widgets when they fail to build', async () => {
    const page = join(dir, 'page.tsx');
    writeFileSync(page, 'ok');
    const { supervisor, children, warn } = harness(async () => undefined, undefined, {
      label: 'pages and widgets',
      watched: () => [page],
      rebuild: async () => {
        throw new Error('pages/revenue.tsx:2:1: Unexpected end of file');
      },
    });
    void supervisor.run();
    await vi.waitFor(() => expect(children).toHaveLength(1));
    writeFileSync(page, 'broken');
    await supervisor.checkForChanges();
    expect(warn.join('\n')).toContain('Unexpected end of file');
    expect(warn.join('\n')).toContain('the server keeps the pages and widgets it has');
    await supervisor.stop();
  });

  it('keeps a change made during a restart or a rebuild, and acts on it after', async () => {
    const hook = join(dir, 'hook.ts');
    writeFileSync(hook, 'v1');
    let releaseBuild: (() => void) | null = null;
    let builds = 0;
    const build = async (): Promise<void> => {
      builds += 1;
      // The second build (the restart) waits until the test lets it go.
      if (builds === 2) await new Promise<void>((resolve) => (releaseBuild = resolve));
    };
    let releaseRebuild: (() => void) | null = null;
    const rebuild = vi.fn(async () => {
      if (rebuild.mock.calls.length === 1) await new Promise<void>((resolve) => (releaseRebuild = resolve));
    });
    const { supervisor, children } = harness(build, { watched: () => [hook], rebuild });
    void supervisor.run();
    await vi.waitFor(() => expect(children).toHaveLength(1));

    writeFileSync(config, 'v2');
    const restarting = supervisor.checkForChanges();
    await vi.waitFor(() => expect(releaseBuild).not.toBeNull());
    // Saved while the restart is still building: nothing may be lost.
    writeFileSync(config, 'v3');
    await supervisor.checkForChanges();
    expect(children).toHaveLength(1);
    (releaseBuild as unknown as () => void)();
    await restarting;
    expect(children).toHaveLength(3);
    expect(builds).toBe(3);

    writeFileSync(hook, 'v2');
    const rebuilding = supervisor.checkForChanges();
    await vi.waitFor(() => expect(releaseRebuild).not.toBeNull());
    writeFileSync(hook, 'v3');
    await supervisor.checkForChanges();
    expect(rebuild).toHaveBeenCalledTimes(1);
    (releaseRebuild as unknown as () => void)();
    await rebuilding;
    expect(rebuild).toHaveBeenCalledTimes(2);
    expect(children).toHaveLength(3);
    await supervisor.stop();
  });

  // Root reads any file, and Windows ignores these modes.
  it.skipIf(process.getuid?.() === 0 || process.platform === 'win32')(
    'reads a file it may not open as unreadable, not as a crash',
    () => {
      const locked = join(dir, 'locked.ts');
      writeFileSync(locked, 'x');
      chmodSync(locked, 0o000);
      try {
        expect(fingerprint(locked)).toBe('unreadable');
      } finally {
        chmodSync(locked, 0o644);
      }
      expect(fingerprint(locked)).not.toBe('unreadable');
      expect(fingerprint(join(dir, 'missing.ts'))).toBe('missing');
    },
  );

  it('kills a server that ignores SIGTERM', async () => {
    const { supervisor, children } = harness();
    void supervisor.run();
    await vi.waitFor(() => expect(children).toHaveLength(1));
    const stubborn = children[0] as FakeChild;
    stubborn.kill = function (signal) {
      this.signals.push(signal);
      if (signal === 'SIGKILL') queueMicrotask(() => this.exit(null, signal));
    };
    await supervisor.stop();
    expect(stubborn.signals).toEqual(['SIGTERM', 'SIGKILL']);
  });
});
