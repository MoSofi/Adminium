// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `startProject` — serve one project folder from a host that is not a terminal.
 *
 * The desktop app's server child calls this. It runs the same path `adminium
 * start` and `adminium design` run (`startUp`), not a copy of it, and hands
 * back what a terminal never needed: a way to stop the server and know when it
 * has stopped, and a way to ask what it is in the middle of.
 */
import { realpathSync } from 'node:fs';

import { findProject } from '../project/locate.js';
import { localOwnerStart, type DesignStart, type StartedUp, startUp } from './commands/start.js';
import { CliError, EXIT_CONFIG } from './exit.js';
import { nodeIo, type CliIo } from './io.js';
import { defaultCliDeps, type CliDeps } from './runtime.js';

export interface StartProjectOptions {
  /** The project's folder. It must hold the project itself: a parent's project is never used. */
  root: string;
  port: number;
  /**
   * `design`: Adminium Designer on this machine only, the folder as the master
   * copy. `serve`: the project as `adminium start` serves it, no Designer.
   */
  mode: 'design' | 'serve';
  /** `serve` only (design mode is 127.0.0.1 whatever is given). Default 127.0.0.1. */
  host?: string;
  /** Where its lines go. Default: this process's own output. */
  io?: CliIo;
  /**
   * Design mode: 64 hex characters that sign the project's owner in once, at
   * `/design#designToken=…`, while that owner has no password. The host mints
   * it and opens that address itself. Left out: no such link.
   */
  token?: string;
  /**
   * The environment the project's `.env` fills in. Default: this process's.
   *
   * It is filled IN PLACE, as a terminal's is. Pass `process.env` itself (the
   * default) for a project that is really served: `adminium.config.ts` reads
   * its values with `env('DATABASE_URL')`, which is this process's
   * environment, so a copy would start a project whose config never saw its
   * own `.env`. The two names that say which folder and which mode are
   * removed from it: this call decides both.
   */
  env?: Record<string, string | undefined>;
  logLevel?: string;
  /** Design mode's owner and link. Default: make the project's owner when it has none; no link. */
  design?: DesignStart;
  /**
   * Design mode, for a host that IS the person's own computer (the desktop
   * app): `token` signs the owner this project was made for in even when they
   * have a password. The password is for other devices. Default: off, and the
   * link is only for an owner with no password, as `adminium design`'s is.
   */
  ownerOnThisComputer?: boolean;
  /**
   * Names the folder's `.env` and config may not set. A host that opens other
   * people's folders passes {@link HOST_DECIDED_ENV}; the default is none.
   */
  refuse?: readonly string[];
  /** Test seam. */
  deps?: Partial<CliDeps>;
}

export type StartedProject = StartedUp;

/**
 * What a host that opens folders it did not make must decide itself: where the
 * server listens, what it trusts, what it runs and where its own files are. A
 * folder's `.env` that names one of these is not obeyed (and is told so).
 *
 * `NODE_OPTIONS`, `PATH` and `ELECTRON_RUN_AS_NODE` are here because the
 * environment the file fills is handed on to every program the server starts.
 */
export const HOST_DECIDED_ENV: readonly string[] = [
  'HOST',
  'PORT',
  'ADMINIUM_HOST',
  'ADMINIUM_PORT',
  'ADMINIUM_RUNTIME',
  'ADMINIUM_BOOT_TOKEN',
  'ADMINIUM_STATIC_ROOT',
  'ADMINIUM_BUNDLED_ADD_ONS',
  'ADMINIUM_BUNDLED_APPS',
  'ADMINIUM_DEMO_SEED_SCRIPT',
  'ADMINIUM_TRUST_PROXY',
  'ADMINIUM_TRUSTED_PROXIES',
  'ADMINIUM_DESIGNER',
  'ADMINIUM_PROJECT_MODE',
  'ADMINIUM_PROJECT_DIR',
  'ADMINIUM_DESKTOP_PROJECT',
  'ADMINIUM_DESKTOP_PROGRAMS',
  'ADMINIUM_DESKTOP_SINGLE_USER',
  'NODE_OPTIONS',
  'PATH',
  'ELECTRON_RUN_AS_NODE',
];

function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

export async function startProject(opts: StartProjectOptions): Promise<StartedProject> {
  const env = opts.env ?? process.env;
  // The folder that was picked, never one named by the environment or found above it.
  delete env.ADMINIUM_PROJECT_DIR;
  // The mode is what this call says, never what was inherited.
  delete env.ADMINIUM_PROJECT_MODE;
  const located = findProject(opts.root, env);
  if (located === null || real(located.root) !== real(opts.root)) {
    throw new CliError(`${opts.root} is not a project folder (it has no adminium.config.ts).`, { code: EXIT_CONFIG });
  }
  const deps: CliDeps = { ...defaultCliDeps(), ...opts.deps, env, cwd: located.root };
  const io = opts.io ?? nodeIo();
  return startUp(
    { io, deps },
    { port: opts.port, host: opts.mode === 'serve' ? (opts.host ?? '127.0.0.1') : undefined, logLevel: opts.logLevel ?? 'warn', refuse: opts.refuse },
    opts.mode === 'design' ? (opts.design ?? localOwnerStart(io, opts.token ?? null, undefined, { thisComputer: opts.ownerOnThisComputer === true })) : undefined,
  );
}
