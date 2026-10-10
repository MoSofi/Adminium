// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Install a project's packages, whole, and mark that it was done.
 *
 * One place for "the folder has a `package.json`; make its `node_modules`
 * right": the desktop app runs it before it starts a project's server (a new
 * project, a folder with none, a folder from another machine), through the
 * hidden `adminium install`.
 *
 * - From the lockfile when there is one (`npm ci`: exactly what the lockfile
 *   says, or a refusal), else a plain install that writes one.
 * - No package's own install scripts run. The engine's packages need none
 *   (their programs come prebuilt), and a script is somebody else's code run
 *   before the person was asked anything about it.
 * - The mark is taken away first and written last, so an install that is
 *   stopped or fails leaves a folder that says "install me" (`install-stamp.ts`).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { runChild } from '../designer/child.js';
import { APP_VERSION } from '../version.js';
import { clearInstallStamp, installNeed, writeInstallStamp, type InstallNeed } from './install-stamp.js';
import { packageManagerProgram } from './programs.js';

export const PROJECT_INSTALL_TIMEOUT_MS = 15 * 60_000;

export interface InstallResult {
  ok: boolean;
  /** Stopped by the signal (the person cancelled), as against a failure. */
  stopped: boolean;
  timedOut: boolean;
  /** The manager that ran, and the words it was run with (for the screen and the log). */
  manager: string;
  command: string;
  /** For a folder another manager made, in the desktop app: what the person is told. */
  note: string | null;
  /** The end of what the manager printed. */
  output: string;
}

/** The packages that are Adminium itself: a project's pins of them follow the engine that serves it. */
export const ENGINE_PACKAGES = ['@adminiumjs/adminium', '@adminiumjs/public-client'] as const;

/**
 * Set the project's pins of Adminium's own packages to `version` (exactly, as a
 * new project has them). Returns whether `package.json` changed. The lockfile
 * is left to the install that follows, which must then be a whole one
 * (`installProject(root, { whole: true })`): `npm ci` refuses a lockfile that
 * no longer matches.
 */
export function pinEngine(root: string, version: string = APP_VERSION): boolean {
  const file = join(root, 'package.json');
  const manifest = JSON.parse(readFileSync(file, 'utf8')) as Record<string, Record<string, string> | undefined>;
  let changed = false;
  for (const group of ['dependencies', 'devDependencies'] as const) {
    const listed = manifest[group];
    if (listed === undefined || typeof listed !== 'object') continue;
    for (const name of ENGINE_PACKAGES) {
      if (typeof listed[name] === 'string' && listed[name] !== version) {
        listed[name] = version;
        changed = true;
      }
    }
  }
  if (changed) writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  return changed;
}

/** The arguments for a whole install with `manager`: from the lockfile when npm has one. */
export function wholeInstallArgs(manager: string, root: string): string[] {
  if (manager === 'npm' && existsSync(join(root, 'package-lock.json'))) return ['ci', '--ignore-scripts'];
  return ['install', '--ignore-scripts'];
}

export async function installProject(
  root: string,
  opts: { env?: Readonly<Record<string, string | undefined>>; signal?: AbortSignal; timeoutMs?: number; run?: typeof runChild; /** Not from the lockfile even when there is one: the list of packages was just changed. */ whole?: boolean } = {},
): Promise<InstallResult> {
  const env = opts.env ?? process.env;
  const program = packageManagerProgram(root, env);
  const args = opts.whole === true ? ['install', '--ignore-scripts'] : wholeInstallArgs(program.manager, root);
  const launch = program.launch(args);
  clearInstallStamp(root);
  const result = await (opts.run ?? runChild)(launch.command, launch.args, {
    cwd: root,
    timeoutMs: opts.timeoutMs ?? PROJECT_INSTALL_TIMEOUT_MS,
    ...(opts.signal === undefined ? {} : { signal: opts.signal }),
    env: { ...env, ...launch.env },
  });
  const ok = result.code === 0 && !result.stopped && !result.timedOut;
  if (ok) writeInstallStamp(root, APP_VERSION);
  return {
    ok,
    stopped: result.stopped,
    timedOut: result.timedOut,
    manager: program.manager,
    command: `${program.manager} ${args.join(' ')}`,
    note: program.note,
    output: result.output.split('\n').slice(-40).join('\n'),
  };
}

/** What the person is told for each reason a project's packages must be installed. */
export function installNeedWords(need: Exclude<InstallNeed, null>): string {
  switch (need) {
    case 'no-packages':
      return 'This project’s building blocks are not installed yet.';
    case 'not-finished':
      return 'The last install of this project’s building blocks did not finish.';
    case 'another-machine':
      return 'This project’s building blocks were installed on another kind of computer.';
    case 'changed':
      return 'This project’s list of building blocks changed since they were installed.';
  }
}

export { installNeed };
