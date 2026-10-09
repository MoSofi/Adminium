// SPDX-License-Identifier: AGPL-3.0-only
/**
 * How this server starts another program: Node, the package manager, git, a
 * browser, and the PATH an app's own build line runs with.
 *
 * ONE PLACE, because there are two answers. On a terminal the server is a Node
 * process among the person's own tools: `process.execPath` is Node, `npm` is on
 * the PATH, and nothing here changes what was always done. Inside the desktop
 * app neither is true. The server runs in a helper process whose own path
 * cannot run as Node, and the person may have no Node, no npm and no git at
 * all. There the app says where its own are, in `ADMINIUM_DESKTOP_PROGRAMS`:
 * its main program (which runs as Node when asked to), the npm it carries, a
 * folder of `node`/`npm`/`npx` stand-ins for an app's own build lines, and the
 * git it found.
 *
 * Nothing else in the server names `npm`, `pnpm`, `node` or
 * `process.execPath` to start a child: `test/programs-source.test.ts` reads
 * the sources and fails on a new one.
 */
import { existsSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';

import { detectPackageManager, projectPackageManager, type PackageManager } from './package-manager.js';

/** The name the desktop app's main process sets. A JSON value; see {@link DesktopPrograms}. */
export const DESKTOP_PROGRAMS_ENV = 'ADMINIUM_DESKTOP_PROGRAMS';

/** The one registry the carried npm installs from unless the folder's own `.npmrc` names another. */
export const NPM_REGISTRY = 'https://registry.npmjs.org/';

export interface DesktopPrograms {
  /** The app's main program. Run with `ELECTRON_RUN_AS_NODE=1` it is Node. Never the helper this server may run in. */
  binary: string;
  /** The folder of the npm the app carries (it holds `bin/npm-cli.js`). */
  npm: string;
  /** A folder holding `node`, `npm` and `npx`, each starting {@link binary} as Node. For an app's own build lines only. */
  shims: string;
  /** A git that works here, or `null`: versions are off and nothing asks for one. */
  git: string | null;
  /** npm's user and global settings: two files the app owns, so a person's own `~/.npmrc` decides nothing. */
  npmUserConfig: string;
  npmGlobalConfig: string;
  /** npm's cache, in the app's own folder. */
  npmCache: string;
  /** The folder of the lockfile a new project starts with (`starter-lock.ts`), or `null`: this build carries none. */
  starter: string | null;
}

/** What it takes to start a program: the file, its arguments, and what to add to the child's environment. */
export interface Launch {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/**
 * The desktop app's programs, or `null` on a terminal.
 *
 * A value that is there but wrong THROWS. Falling back to the terminal's
 * answer would start `npm` by name on a machine the app promised needs none,
 * or the helper as if it were Node; both fail later, in words nobody could
 * act on.
 */
export function desktopPrograms(env: Readonly<Record<string, string | undefined>> = process.env): DesktopPrograms | null {
  const raw = env[DESKTOP_PROGRAMS_ENV];
  if (raw === undefined || raw === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${DESKTOP_PROGRAMS_ENV} is not JSON.`);
  }
  const value = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<string, unknown>;
  const path = (name: string): string => {
    const found = value[name];
    if (typeof found !== 'string' || !isAbsolute(found)) throw new Error(`${DESKTOP_PROGRAMS_ENV}: "${name}" must be an absolute path.`);
    return found;
  };
  const git = value['git'];
  if (git !== null && (typeof git !== 'string' || !isAbsolute(git))) throw new Error(`${DESKTOP_PROGRAMS_ENV}: "git" must be an absolute path or null.`);
  return {
    binary: path('binary'),
    npm: path('npm'),
    shims: path('shims'),
    git,
    npmUserConfig: path('npmUserConfig'),
    npmGlobalConfig: path('npmGlobalConfig'),
    npmCache: path('npmCache'),
    starter: value['starter'] === undefined || value['starter'] === null ? null : path('starter'),
  };
}

/** Node, with arguments. */
export function nodeProgram(args: readonly string[], env: Readonly<Record<string, string | undefined>> = process.env): Launch {
  const desktop = desktopPrograms(env);
  if (desktop === null) return { command: process.execPath, args: [...args], env: {} };
  return { command: desktop.binary, args: [...args], env: { ELECTRON_RUN_AS_NODE: '1' } };
}

/** The lockfile of a package manager the desktop app does not carry, when the folder has one. */
function otherManagersLockfile(root: string): { manager: Exclude<PackageManager, 'npm'>; file: string } | null {
  for (const [manager, file] of [
    ['pnpm', 'pnpm-lock.yaml'],
    ['yarn', 'yarn.lock'],
    ['bun', 'bun.lock'],
    ['bun', 'bun.lockb'],
  ] as const) {
    if (existsSync(join(root, file))) return { manager, file };
  }
  return null;
}

export interface PackageManagerProgram {
  /** The manager that will run: the folder's own on a terminal, always npm in the desktop app. */
  manager: PackageManager;
  /** Start it with these arguments (the verb and what follows). */
  launch(args: readonly string[]): Launch;
  /**
   * In the desktop app, for a folder another manager made: what the person is
   * told. The app never starts a manager it does not carry (yarn can run a
   * file the folder names), and it leaves that manager's lockfile as it is.
   */
  note: string | null;
}

/**
 * The package manager for the project in `root`.
 *
 * On a terminal: the one the folder's lockfile names, else the one running
 * this command (`fallback`, where the caller already knows it). In the desktop
 * app: the carried npm, started as "the app's program, with npm's own entry as
 * its first argument", so no `.cmd` is involved and `shell: false` holds on
 * Windows. It runs with settings of the app's own and one registry.
 */
export function packageManagerProgram(
  root: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  fallback?: PackageManager,
): PackageManagerProgram {
  const desktop = desktopPrograms(env);
  if (desktop === null) {
    const manager = fallback ?? projectPackageManager(root, env);
    return { manager, launch: (args) => ({ command: manager, args: [...args], env: {} }), note: null };
  }
  const other = otherManagersLockfile(root);
  return {
    manager: 'npm',
    launch: (args) => ({
      command: desktop.binary,
      args: [join(desktop.npm, 'bin', 'npm-cli.js'), ...args],
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        NPM_CONFIG_USERCONFIG: desktop.npmUserConfig,
        NPM_CONFIG_GLOBALCONFIG: desktop.npmGlobalConfig,
        NPM_CONFIG_CACHE: desktop.npmCache,
        NPM_CONFIG_REGISTRY: NPM_REGISTRY,
        NPM_CONFIG_UPDATE_NOTIFIER: 'false',
        NPM_CONFIG_FUND: 'false',
        // A package's own install scripts never run: the same rule the terminal's installs already pass as a flag.
        NPM_CONFIG_IGNORE_SCRIPTS: 'true',
      },
    }),
    note: other === null ? null : `This project uses ${other.manager}. The app installs with npm; your ${other.manager} file (${other.file}) is left as it is.`,
  };
}

/** The arguments that add exact versions of packages with no install scripts, in `manager`'s own words. */
export function addPackagesArgs(manager: PackageManager, specs: readonly string[]): string[] {
  const exact = manager === 'npm' || manager === 'pnpm' ? '--save-exact' : '--exact';
  return [manager === 'npm' ? 'install' : 'add', ...specs, '--ignore-scripts', exact];
}

/** The manager running this command, for words only (a hint that says "npm install"). In the desktop app it is npm. */
export function namedPackageManager(env: Readonly<Record<string, string | undefined>> = process.env): PackageManager {
  return desktopPrograms(env) === null ? detectPackageManager(env) : 'npm';
}

/** git, or `null` where there is none to use. On a terminal it is whatever `git` the PATH finds. */
export function gitProgram(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  const desktop = desktopPrograms(env);
  return desktop === null ? 'git' : desktop.git;
}

/**
 * The PATH an app's own build line runs with. A build line is a shell line the
 * app's author wrote (`npm run build`, `node scripts/x.js`): in the desktop app
 * the stand-ins' folder comes first, so those names mean the app's own Node and
 * npm. It is the PATH of a build line's child and of nothing else.
 */
export function buildLinePath(path: string | undefined, env: Readonly<Record<string, string | undefined>> = process.env): string | undefined {
  const desktop = desktopPrograms(env);
  if (desktop === null) return path;
  return path === undefined || path === '' ? desktop.shims : `${desktop.shims}${delimiter}${path}`;
}

/** Whether this server may open a page in the person's browser. Never in the desktop app: its window is the browser. */
export function mayOpenBrowser(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return desktopPrograms(env) === null;
}
