// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The project folder on Windows: the file writer, the dev folder watch and the
 * `adminium dev` supervisor, each given `path.win32` and a file system keyed by
 * Windows paths. File keys stay `pages/orders.json` whatever the platform
 * writes, and a name Windows would read as a path into another folder is
 * refused.
 */
import { win32 } from 'node:path';

import { pagesRepo } from '@adminium/meta';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDevSupervisor, type DevChild } from '../src/project/dev.js';
import { diskFileStore, type FileStoreFs } from '../src/project/file-store.js';
import { parseJsonText, stableStringify } from '../src/project/json.js';
import { pullProject } from '../src/project/reconcile.js';
import { createProjectService, type ProjectService, type ProjectWatchFs } from '../src/project/service.js';
import { makeInstall, type Install } from './project-fixtures.js';

const ROOT = 'C:\\Users\\dev\\my-admin';

interface DiskEntry {
  text: string;
  mtimeMs: number;
}

/** A file system keyed by Windows paths, with a log of every call. */
function windowsDisk() {
  const files = new Map<string, DiskEntry>();
  const dirs = new Set<string>();
  const calls: string[] = [];
  let clock = 1;
  const missing = (path: string): Error => Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
  const fs: FileStoreFs = {
    readdir: async (dir) => {
      calls.push(`readdir ${dir}`);
      if (!dirs.has(dir)) throw missing(dir);
      return [...files.keys()].filter((file) => win32.dirname(file) === dir).map((file) => win32.basename(file));
    },
    readFile: async (file) => {
      calls.push(`read ${file}`);
      const entry = files.get(file);
      if (entry === undefined) throw missing(file);
      return entry.text;
    },
    writeFile: async (file, text) => {
      calls.push(`write ${file}`);
      if (!dirs.has(win32.dirname(file))) throw missing(file);
      files.set(file, { text, mtimeMs: clock++ });
    },
    rename: async (from, to) => {
      calls.push(`rename ${from} -> ${to}`);
      const entry = files.get(from);
      if (entry === undefined) throw missing(from);
      files.delete(from);
      files.set(to, entry);
    },
    rm: async (file) => {
      calls.push(`rm ${file}`);
      files.delete(file);
    },
    mkdir: async (dir) => {
      calls.push(`mkdir ${dir}`);
      for (let current = dir; !dirs.has(current); current = win32.dirname(current)) {
        dirs.add(current);
        if (win32.dirname(current) === current) break;
      }
    },
  };
  /** Save a file the way an editor does: new content, new modification time. */
  const save = (file: string, text: string): void => {
    files.set(file, { text, mtimeMs: clock++ });
  };
  return { files, calls, fs, save };
}

describe('the project file writer on Windows', () => {
  it('writes, lists, reads and removes files under Windows paths, and names them with /', async () => {
    const disk = windowsDisk();
    const store = diskFileStore(ROOT, win32, disk.fs);

    await store.write('pages/orders.json', '{"title":1}\n');
    await store.write('schema/main.json', '{}\n');
    expect([...disk.files.keys()].sort()).toEqual([`${ROOT}\\pages\\orders.json`, `${ROOT}\\schema\\main.json`]);
    // The temporary file sits beside its target, so the rename never crosses a folder.
    expect(disk.calls.filter((call) => call.startsWith('rename '))[0]).toMatch(
      /^rename C:\\Users\\dev\\my-admin\\pages\\\.[0-9a-f]{12}\.tmp -> C:\\Users\\dev\\my-admin\\pages\\orders\.json$/,
    );

    disk.save(`${ROOT}\\pages\\README.md`, '# Pages\n');
    expect(await store.list()).toEqual(['pages/orders.json', 'schema/main.json']);
    expect(await store.read('pages/orders.json')).toBe('{"title":1}\n');
    expect(await store.read('pages/customers.json')).toBeNull();

    await store.remove('pages/orders.json');
    expect(disk.calls).toContain(`rm ${ROOT}\\pages\\orders.json`);
    expect(await store.list()).toEqual(['schema/main.json']);
  });

  it('refuses a name that Windows reads as a path into another folder', async () => {
    const disk = windowsDisk();
    const store = diskFileStore(ROOT, win32, disk.fs);
    const escapes = {
      'pages/x\\..\\..\\..\\startup.json': 'pages',
      'pages/nested\\orders.json': 'pages',
      'schema/x\\..\\..\\hooks\\main.json': 'schema',
    };
    for (const [key, dir] of Object.entries(escapes)) {
      const refusal = `${key} is not a file in ${dir}/`;
      await expect(store.write(key, '{}\n'), key).rejects.toThrow(refusal);
      await expect(store.read(key), key).rejects.toThrow(refusal);
      await expect(store.remove(key), key).rejects.toThrow(refusal);
    }
    expect(disk.calls).toEqual([]);
  });

  it('passes on every error but a missing file, and removes its temporary file when the rename fails', async () => {
    const disk = windowsDisk();
    const denied = Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
    const store = diskFileStore(ROOT, win32, {
      ...disk.fs,
      readdir: async () => Promise.reject(denied),
      readFile: async () => Promise.reject(denied),
      rename: async () => Promise.reject(denied),
    });
    await expect(store.list()).rejects.toBe(denied);
    await expect(store.read('pages/orders.json')).rejects.toBe(denied);
    await expect(store.write('pages/orders.json', '{}\n')).rejects.toBe(denied);
    expect([...disk.files.keys()]).toEqual([]);
    expect(disk.calls.filter((call) => call.startsWith('rm '))).toEqual([
      expect.stringMatching(/^rm C:\\Users\\dev\\my-admin\\pages\\\.[0-9a-f]{12}\.tmp$/),
    ]);
  });
});

describe('the dev folder watch on Windows', () => {
  let install: Install | null = null;
  let service: ProjectService | null = null;
  afterEach(async () => {
    await service?.close();
    await install?.close();
    service = null;
    install = null;
  });

  /** A project whose files were written from its database into a Windows folder. */
  async function windowsProject() {
    const one = await makeInstall();
    install = one;
    const disk = windowsDisk();
    const store = diskFileStore(ROOT, win32, disk.fs);
    await pullProject({ meta: one.meta, store });
    const watched: string[] = [];
    const events: (() => void)[] = [];
    const stats: string[] = [];
    const logs: string[] = [];
    const fs: ProjectWatchFs = {
      watch: (dir, onEvent) => {
        watched.push(dir);
        events.push(onEvent);
        return { close: () => undefined };
      },
      mkdir: (dir) => disk.fs.mkdir(dir),
      stat: async (file) => {
        stats.push(file);
        const entry = disk.files.get(file);
        return entry === undefined ? null : { mtimeMs: entry.mtimeMs, size: entry.text.length };
      },
    };
    /** Rename the orders page in its file, as an editor on Windows would save it. */
    const renameOrders = (title: string): void => {
      const file = `${ROOT}\\pages\\orders.json`;
      const parsed = parseJsonText(disk.files.get(file)?.text ?? '');
      if (!parsed.ok) throw new Error(parsed.message);
      const doc = parsed.value as { title: { fallback: string } };
      doc.title.fallback = title;
      disk.save(file, stableStringify(doc));
    };
    const ordersTitle = async (): Promise<string | undefined> =>
      (await pagesRepo(one.meta).findBySlug(one.mainId, 'orders'))?.title;
    return { install: one, store, fs, watched, events, stats, logs, renameOrders, ordersTitle };
  }

  it('watches pages\\ and schema\\, and applies a saved file under its / key', async () => {
    const project = await windowsProject();
    service = createProjectService({
      meta: project.install.meta,
      root: ROOT,
      mode: 'dev',
      store: project.store,
      pathApi: win32,
      fs: project.fs,
      debounceMs: 5,
      pollMs: 0,
      log: (line) => project.logs.push(line),
      warn: (line) => project.logs.push(line),
    });
    service.start();
    await vi.waitFor(() => {
      expect([...project.watched].sort()).toEqual([`${ROOT}\\pages`, `${ROOT}\\schema`]);
    });

    project.renameOrders('Sales orders');
    for (const onEvent of project.events) onEvent();
    await vi.waitFor(() => {
      expect(project.logs).toContain('Applied pages/orders.json.');
    });
    expect(await project.ordersTitle()).toBe('Sales orders');
  });

  it('notices a changed file by its Windows path, with no event from the watch', async () => {
    const project = await windowsProject();
    service = createProjectService({
      meta: project.install.meta,
      root: ROOT,
      mode: 'dev',
      store: project.store,
      pathApi: win32,
      fs: project.fs,
      debounceMs: 5,
      pollMs: 10,
      watchFiles: false,
      log: (line) => project.logs.push(line),
      warn: (line) => project.logs.push(line),
    });
    service.start();
    await vi.waitFor(() => {
      expect(project.stats).toContain(`${ROOT}\\pages\\orders.json`);
    });
    expect(project.stats.every((file) => file.startsWith(`${ROOT}\\`) && !file.includes('/'))).toBe(true);

    project.renameOrders('Orders to ship');
    await vi.waitFor(() => {
      expect(project.logs).toContain('Applied pages/orders.json.');
    });
    expect(await project.ordersTitle()).toBe('Orders to ship');
    expect(project.watched).toEqual([]);
  });
});

/** A server child that exits when told to. */
class FakeChild implements DevChild {
  private listeners: ((code: number | null, signal: NodeJS.Signals | null) => void)[] = [];
  kill(signal: NodeJS.Signals): void {
    queueMicrotask(() => {
      const listeners = this.listeners;
      this.listeners = [];
      for (const listener of listeners) listener(null, signal);
    });
  }
  onExit(listener: (code: number | null, signal: NodeJS.Signals | null) => void): void {
    this.listeners.push(listener);
  }
}

describe('adminium dev on Windows', () => {
  it('watches the folders of Windows paths and names the file that changed', async () => {
    const config = `${ROOT}\\adminium.config.ts`;
    const dotenv = `${ROOT}\\.env`;
    const hooks = `${ROOT}\\hooks`;
    const hook = `${ROOT}\\hooks\\orders.ts`;
    const prints = new Map([
      [config, 'config one'],
      [dotenv, 'env one'],
      [hooks, 'folder:orders.ts'],
      [hook, 'hook one'],
    ]);
    const watchedDirs = new Set<string>();
    const log: string[] = [];
    const children: FakeChild[] = [];
    const rebuild = vi.fn(async () => undefined);
    const supervisor = createDevSupervisor({
      watched: () => [config, dotenv],
      build: async () => undefined,
      code: { watched: () => [hooks, hook], rebuild },
      spawnServer: () => {
        const child = new FakeChild();
        children.push(child);
        return child;
      },
      watchDir: (dir) => {
        watchedDirs.add(dir);
        return { close: () => undefined };
      },
      log: (line) => log.push(line),
      warn: (line) => log.push(line),
      stopGraceMs: 50,
      pathApi: win32,
      files: { fingerprint: (path) => prints.get(path) ?? 'missing', isDirectory: (path) => path === hooks },
    });

    const running = supervisor.run();
    await vi.waitFor(() => {
      expect(children).toHaveLength(1);
    });
    expect([...watchedDirs].sort()).toEqual([ROOT, hooks]);

    prints.set(hook, 'hook two');
    await supervisor.checkForChanges();
    expect(log).toContain('orders.ts changed, rebuilding hooks and actions…');
    expect(rebuild).toHaveBeenCalledTimes(1);
    expect(children).toHaveLength(1);

    prints.set(config, 'config two');
    await supervisor.checkForChanges();
    expect(log).toContain('adminium.config.ts changed, restarting Adminium…');
    expect(children).toHaveLength(2);

    await supervisor.stop();
    await running;
  });
});
