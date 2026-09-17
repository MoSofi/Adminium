// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `adminium dev`: run the project's server, and restart it when its settings
 * change.
 *
 * The server runs as a child process (`adminium start`), so every restart is a
 * clean boot with fresh module state. The supervisor watches the config file,
 * the files it imports and `.env`. On a change it rebuilds, stops the child,
 * waits for it to exit (so the port is free) and starts a new one. A failed
 * build or a crashed server does not end the session: the supervisor says so
 * and waits for the next change.
 *
 * Hooks and actions do not restart anything. When one of them, or a file it
 * imports, changes, the supervisor rebuilds only them; the running server
 * sees the new build and swaps them in (`project/code/runtime.ts`). Pages and
 * widgets work the same way: the supervisor rebuilds them, and the server
 * tells open dashboards to load the new files (49 §6.4).
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, watch as nodeWatch } from 'node:fs';
import nodePath from 'node:path';

import type { PathApi } from './paths.js';

export interface DevChild {
  kill(signal: NodeJS.Signals): void;
  onExit(listener: (code: number | null, signal: NodeJS.Signals | null) => void): void;
}

export type SpawnServer = () => DevChild;

export type WatchDir = (dir: string, onEvent: () => void) => { close(): void };

/** Files whose change rebuilds one part of the build without a restart. */
export interface DevCodeGroup {
  /** Absolute paths; read again after each build. */
  watched: () => string[];
  rebuild: () => Promise<void>;
  /** For log lines: "hooks and actions". */
  label?: string | undefined;
  /**
   * What makes a watched path "changed". The default is a file's content,
   * and a folder's list of file names.
   */
  fingerprint?: ((path: string) => string) | undefined;
}

export interface DevSupervisorOptions {
  /** Absolute paths whose change restarts the server; read again after each build. */
  watched: () => string[];
  /** Compile the project; throws with a message a person can act on. */
  build: () => Promise<void>;
  /**
   * Paths whose change rebuilds the hooks and actions without a restart. A
   * folder counts as changed when a file is added to it or removed from it.
   */
  code?: DevCodeGroup | undefined;
  /** The same, for the pages and widgets. */
  client?: DevCodeGroup | undefined;
  spawnServer: SpawnServer;
  watchDir?: WatchDir;
  log: (message: string) => void;
  warn: (message: string) => void;
  debounceMs?: number;
  /** How long a stopping server gets before SIGKILL. */
  stopGraceMs?: number;
  /** The platform's path functions; tests pass `path.win32`. */
  pathApi?: Pick<PathApi, 'dirname' | 'basename'>;
  /** How a watched path is read; tests pass fakes. */
  files?: DevFiles;
}

export interface DevFiles {
  /** What makes a watched path "changed" (see {@link fingerprint}). */
  fingerprint(path: string): string;
  isDirectory(path: string): boolean;
}

export interface DevSupervisor {
  /** Build, start, and watch. Resolves once {@link DevSupervisor.stop} has finished. */
  run(): Promise<void>;
  stop(): Promise<void>;
  /** Test seam: check the watched files now instead of on a file-system event. */
  checkForChanges(): Promise<void>;
}

const defaultWatchDir: WatchDir = (dir, onEvent) => {
  const watcher = nodeWatch(dir, { persistent: true }, () => onEvent());
  watcher.on('error', () => undefined);
  return watcher;
};

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function fingerprint(path: string): string {
  if (!existsSync(path)) return 'missing';
  try {
    if (isDirectory(path)) return `folder:${readdirSync(path).sort().join('/')}`;
    return createHash('sha256').update(readFileSync(path)).digest('hex');
  } catch {
    return 'unreadable';
  }
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const diskFiles: DevFiles = { fingerprint, isDirectory };

export function createDevSupervisor(opts: DevSupervisorOptions): DevSupervisor {
  const watchDir = opts.watchDir ?? defaultWatchDir;
  const debounceMs = opts.debounceMs ?? 150;
  const stopGraceMs = opts.stopGraceMs ?? 10_000;
  const { dirname, basename } = opts.pathApi ?? nodePath;
  const files = opts.files ?? diskFiles;

  let child: DevChild | null = null;
  let expectingExit = false;
  let exitWaiter: (() => void) | null = null;
  let stopped = false;
  let busy = false;
  let pending = false;
  let timer: NodeJS.Timeout | null = null;
  let fingerprints = new Map<string, string>();
  const groups = [opts.code, opts.client].filter((group): group is DevCodeGroup => group !== undefined);
  let groupFingerprints: Map<string, string>[] = groups.map(() => new Map());
  let watchers: { close(): void }[] = [];
  let finish: () => void = () => undefined;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });

  const printOf = (group: DevCodeGroup, path: string): string => (group.fingerprint ?? files.fingerprint)(path);

  interface Readings {
    main: Map<string, string>;
    groups: Map<string, string>[];
  }

  /** Every watched path as it reads now. */
  function read(): Readings {
    return {
      main: new Map(opts.watched().map((file) => [file, files.fingerprint(file)])),
      groups: groups.map((group) => new Map(group.watched().map((path) => [path, printOf(group, path)]))),
    };
  }

  /**
   * Remember the watched paths, which a build may have changed, and watch
   * their folders. A path keeps the reading taken before the build, so a file
   * saved while the build ran still counts as changed afterwards.
   */
  function snapshot(before: Readings): void {
    fingerprints = new Map(opts.watched().map((file) => [file, before.main.get(file) ?? files.fingerprint(file)]));
    groupFingerprints = groups.map(
      (group, index) =>
        new Map(group.watched().map((path) => [path, before.groups[index]?.get(path) ?? printOf(group, path)])),
    );
    for (const watcher of watchers) watcher.close();
    const paths = [...fingerprints.keys(), ...groupFingerprints.flatMap((prints) => [...prints.keys()])];
    const dirs = new Set([
      ...paths.map((path) => dirname(path)),
      ...paths.filter((path) => files.isDirectory(path)),
    ]);
    watchers = [...dirs].map((dir) => watchDir(dir, onEvent));
  }

  function changed(prints: Map<string, string>, print: (path: string) => string = files.fingerprint): string | null {
    for (const [path, previous] of prints) {
      if (print(path) !== previous) return path;
    }
    return null;
  }

  function spawnChild(): void {
    const current = opts.spawnServer();
    child = current;
    current.onExit((code, signal) => {
      if (child === current) child = null;
      const requested = expectingExit;
      expectingExit = false;
      exitWaiter?.();
      exitWaiter = null;
      if (!requested && !stopped) {
        opts.warn(`Adminium stopped (${signal ?? `exit ${String(code)}`}). Save a change to start it again.`);
      }
    });
  }

  async function stopChild(): Promise<void> {
    const current = child;
    if (current === null) return;
    expectingExit = true;
    const exited = new Promise<void>((resolve) => {
      exitWaiter = resolve;
    });
    current.kill('SIGTERM');
    const kill = setTimeout(() => current.kill('SIGKILL'), stopGraceMs);
    await exited;
    clearTimeout(kill);
  }

  async function buildAndStart(): Promise<void> {
    const before = read();
    try {
      await opts.build();
    } catch (error) {
      snapshot(before);
      opts.warn(`${message(error)}\nFix it and save; Adminium starts again then.`);
      return;
    }
    snapshot(before);
    if (!stopped) spawnChild();
  }

  async function restart(file: string): Promise<void> {
    if (busy) {
      pending = true;
      return;
    }
    busy = true;
    try {
      opts.log(`${basename(file)} changed, restarting Adminium…`);
      await stopChild();
      if (!stopped) await buildAndStart();
    } finally {
      busy = false;
    }
    if (pending && !stopped) {
      pending = false;
      await checkForChanges();
    }
  }

  /** Rebuild every group that changed, then look at the files again once. */
  async function rebuildCode(changes: readonly { group: DevCodeGroup; path: string }[]): Promise<void> {
    if (busy) {
      pending = true;
      return;
    }
    busy = true;
    try {
      const before = read();
      for (const { group, path } of changes) {
        const label = group.label ?? 'hooks and actions';
        opts.log(`${basename(path)} changed, rebuilding ${label}…`);
        try {
          await group.rebuild();
        } catch (error) {
          opts.warn(`${message(error)}\nFix it and save. Until then the server keeps the ${label} it has.`);
        }
      }
      snapshot(before);
    } finally {
      busy = false;
    }
    if (pending && !stopped) {
      pending = false;
      await checkForChanges();
    }
  }

  async function checkForChanges(): Promise<void> {
    if (stopped) return;
    const file = changed(fingerprints);
    if (file !== null) {
      await restart(file);
      return;
    }
    const changes = groups.flatMap((group, index) => {
      const path = changed(groupFingerprints[index] ?? new Map(), (candidate) => printOf(group, candidate));
      return path === null ? [] : [{ group, path }];
    });
    if (changes.length > 0) await rebuildCode(changes);
  }

  function onEvent(): void {
    if (stopped) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void checkForChanges();
    }, debounceMs);
  }

  return {
    async run() {
      await buildAndStart();
      return finished;
    },
    async stop() {
      if (stopped) return finished;
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      for (const watcher of watchers) watcher.close();
      watchers = [];
      await stopChild();
      finish();
      return finished;
    },
    checkForChanges,
  };
}
