// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A running server's project code: the hooks and actions it loaded, the
 * files that failed to load, the hook failures since it started, and the
 * built pages and widgets it serves to the dashboard.
 *
 * `start` loads the code once, before the server listens, so no write escapes
 * the hooks. Under `adminium dev` the supervisor rebuilds changed files into
 * the build folder, and this runtime notices the new manifest and swaps the
 * whole set in one step. A reload that finds broken files keeps the rest. New
 * pages and widgets are handed to `onClientChanged`, which updates the page
 * rows and tells open dashboards.
 */

import { join } from 'node:path';

import { BUILD_DIR } from '../build.js';
import { EMPTY_CLIENT_BUILD, readClientBuild, type ClientBuild } from '../client-build.js';
import { createHookFailureLog, type HookFailureLog } from './hooks.js';
import {
  EMPTY_PROJECT_CODE,
  loadProjectCode,
  readServerCodeFiles,
  type ImportModule,
  type ProjectCode,
} from './load.js';

export interface ProjectCodeRuntime {
  current(): ProjectCode;
  /** The built pages and widgets. */
  client(): ClientBuild;
  /** The build folder the client files are served from. */
  readonly buildDir: string;
  /** Load the build's code now, and make it current. */
  load(): Promise<ProjectCode>;
  /** Read the build's pages and widgets now, and make them current. */
  loadClient(): ClientBuild;
  /** In dev, watch the build for new code. */
  start(): void;
  close(): void;
  readonly failures: HookFailureLog;
}

export interface ProjectCodeRuntimeOptions {
  root: string;
  mode: 'dev' | 'server';
  log: (message: string) => void;
  warn: (message: string) => void;
  /** How often dev looks for a new build. */
  pollMs?: number;
  importer?: ImportModule;
  now?: () => number;
  /** Dev: the pages and widgets were rebuilt. */
  onClientChanged?: ((client: ClientBuild) => Promise<void>) | undefined;
}

const plural = (count: number, one: string, many: string): string => `${String(count)} ${count === 1 ? one : many}`;

export function createProjectCodeRuntime(opts: ProjectCodeRuntimeOptions): ProjectCodeRuntime {
  const buildDir = join(opts.root, BUILD_DIR);
  const failures = createHookFailureLog();
  let code = EMPTY_PROJECT_CODE;
  let client: ClientBuild = EMPTY_CLIENT_BUILD;
  let timer: NodeJS.Timeout | null = null;
  let loading: Promise<ProjectCode> | null = null;
  const reported = new Set<string>();

  function describe(next: ProjectCode, previous: ProjectCode): void {
    const hooks = next.hooks.length;
    const actions = next.actions.size;
    if (hooks + actions > 0 || previous.hooks.length + previous.actions.size > 0) {
      opts.log(`Project code: ${plural(hooks, 'hook', 'hooks')} and ${plural(actions, 'action', 'actions')} loaded.`);
    }
    for (const problem of next.problems) {
      const key = `${next.digest}:${problem.source}:${problem.message}`;
      if (reported.has(key)) continue;
      reported.add(key);
      opts.warn(`${problem.source} was not loaded. ${problem.message}`);
    }
  }

  async function load(): Promise<ProjectCode> {
    loading ??= (async () => {
      try {
        const next = await loadProjectCode(buildDir, {
          ...(opts.importer === undefined ? {} : { importer: opts.importer }),
          ...(opts.now === undefined ? {} : { now: opts.now }),
        });
        const previous = code;
        code = next;
        describe(next, previous);
        return next;
      } finally {
        loading = null;
      }
    })();
    return loading;
  }

  let clientBusy = false;

  async function pollClient(): Promise<void> {
    if (clientBusy) return;
    const next = readClientBuild(buildDir);
    if (next === null || next.digest === client.digest) return;
    clientBusy = true;
    client = next;
    try {
      await opts.onClientChanged?.(next);
    } catch (error) {
      opts.warn(`Could not apply the rebuilt pages and widgets: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clientBusy = false;
    }
  }

  async function poll(): Promise<void> {
    await pollClient();
    if (loading !== null) return;
    const listed = readServerCodeFiles(buildDir);
    if (listed === null || listed.digest === code.digest) return;
    try {
      await load();
    } catch (error) {
      opts.warn(`Could not reload the project code: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    current: () => code,
    client: () => client,
    buildDir,
    load,
    loadClient() {
      const read = readClientBuild(buildDir);
      if (read === null) {
        opts.warn(`${join(buildDir, 'manifest.json')} could not be read, so no pages or widgets were loaded.`);
      } else {
        client = read;
      }
      return client;
    },
    start() {
      if (opts.mode !== 'dev' || timer !== null) return;
      timer = setInterval(() => void poll(), opts.pollMs ?? 1000);
      timer.unref();
    },
    close() {
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
    failures,
  };
}
