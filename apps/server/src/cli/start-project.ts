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
import type { CliIo } from './io.js';
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
  io: CliIo;
  /** The environment the project's `.env` fills in. Default: this process's. */
  env?: Record<string, string | undefined>;
  logLevel?: string;
  /** Design mode's owner and link. Default: make the project's owner when it has none; no link. */
  design?: DesignStart;
  /** Test seam. */
  deps?: Partial<CliDeps>;
}

export type StartedProject = StartedUp;

function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

export async function startProject(opts: StartProjectOptions): Promise<StartedProject> {
  const env = { ...(opts.env ?? process.env) };
  // The folder that was picked, never one named by the environment or found above it.
  delete env.ADMINIUM_PROJECT_DIR;
  // The mode is what this call says, never what was inherited.
  delete env.ADMINIUM_PROJECT_MODE;
  const located = findProject(opts.root, env);
  if (located === null || real(located.root) !== real(opts.root)) {
    throw new CliError(`${opts.root} is not a project folder (it has no adminium.config.ts).`, { code: EXIT_CONFIG });
  }
  const deps: CliDeps = { ...defaultCliDeps(), ...opts.deps, env, cwd: located.root };
  return startUp(
    { io: opts.io, deps },
    { port: opts.port, host: opts.mode === 'serve' ? (opts.host ?? '127.0.0.1') : undefined, logLevel: opts.logLevel ?? 'warn' },
    opts.mode === 'design' ? (opts.design ?? localOwnerStart(opts.io, null)) : undefined,
  );
}
