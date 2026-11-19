// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An operator project: a trial (or the hosted installation it became) run as
 * a project, with no config file.
 *
 * `ADMINIUM_OPERATOR_PROJECT=on`, in trial or hosted mode only. A project's
 * config is code (`adminium.config.ts` is imported), and the Super Admin of a
 * trial is a stranger who can write files into the project folder through the
 * Designer. So here nothing in the folder is ever read as configuration or run:
 *
 *  - the config is built in memory from the environment ({@link operatorProjectConfig}):
 *    `main` is `ADMINIUM_SOURCE_URL`'s database, the data folder is
 *    `ADMINIUM_DATA_DIR`. The user's own database (`ADMINIUM_YOUR_DATABASE`) is
 *    not in it: it is connected after the server listens (`project/your-database.ts`),
 *    so a database the operator does not run never holds up the boot;
 *  - the folder is `<ADMINIUM_DATA_DIR>/project` (or `ADMINIUM_PROJECT_DIR`, which
 *    the archive and restore one-offs are given), and holds only `apps/` and
 *    `.adminium/`. It is made before the project is looked for;
 *  - finding the project never looks for a config file there
 *    ({@link operatorProjectAt}): an `adminium.config.ts` written into the folder
 *    is never loaded, and every caller (`findProject`, the Designer's own lookups,
 *    which pass no environment) gets the same in-memory project.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import { BUILD_DIR } from './build-shared.js';
import { CONFIG_FILES, type ProjectLocation } from './locate.js';
import type { ProjectConfig } from './config.js';

/** The name the in-memory config goes by where a file name is shown. Never a file. */
export const OPERATOR_CONFIG_NAME = '(operator project)';

/** The folder under the data folder. */
export const OPERATOR_PROJECT_FOLDER = 'project';

const TRUTHY = new Set(['on', 'true', '1']);

type RawEnv = Readonly<Record<string, string | undefined>>;

/** Whether the raw environment asks for an operator project: the switch, in trial or hosted mode. */
export function operatorProjectOn(env: RawEnv): boolean {
  if (!TRUTHY.has((env['ADMINIUM_OPERATOR_PROJECT'] ?? '').trim().toLowerCase())) return false;
  const on = (name: string): boolean => TRUTHY.has((env[name] ?? '').trim().toLowerCase());
  return on('ADMINIUM_TRIAL_MODE') || on('ADMINIUM_HOSTED_MODE');
}

/** The operator project's folder: `ADMINIUM_PROJECT_DIR` when given, else `<ADMINIUM_DATA_DIR>/project`. */
export function operatorProjectRoot(env: RawEnv, cwd: string = process.cwd()): string {
  const named = env['ADMINIUM_PROJECT_DIR']?.trim() ?? '';
  if (named !== '') return resolve(cwd, named);
  const dataDir = env['ADMINIUM_DATA_DIR']?.trim() ?? '';
  return resolve(cwd, dataDir === '' ? 'data' : dataDir, OPERATOR_PROJECT_FOLDER);
}

/** Every operator project root this process opened. One server opens one; a test may open more. */
const roots = new Set<string>();

/** Remember a root, so lookups with no environment (the Designer's) find it. */
export function registerOperatorProject(root: string): void {
  roots.add(resolve(root));
}

/** Tests: forget them all. */
export function forgetOperatorProjects(): void {
  roots.clear();
}

function locationOf(root: string): ProjectLocation {
  return { root, configFile: join(root, OPERATOR_CONFIG_NAME) };
}

/** Whether a location is an operator project's (its config is in memory). */
export function isOperatorLocation(project: Pick<ProjectLocation, 'configFile'>): boolean {
  return project.configFile.endsWith(`${sep}${OPERATOR_CONFIG_NAME}`) && roots.has(resolve(project.configFile, '..'));
}

/**
 * The operator project `start` belongs to, or null: the one the environment
 * names (switch on), else a registered root that `start` is at or under. Never
 * reads the folder.
 */
export function operatorProjectAt(start: string, env: RawEnv): ProjectLocation | null {
  if (operatorProjectOn(env)) {
    const root = operatorProjectRoot(env, start);
    registerOperatorProject(root);
    return locationOf(root);
  }
  const at = resolve(start);
  for (const root of roots) {
    if (at === root || at.startsWith(`${root}${sep}`)) return locationOf(root);
  }
  return null;
}

/**
 * Make the folder: `apps/` and `.adminium/` with a build manifest of its own (the
 * apps' screens are built into it), and nothing else. A config file found there is
 * said and left alone: it is never read.
 */
export function prepareOperatorFolder(root: string, version: string, warn: (message: string) => void = () => undefined): void {
  mkdirSync(join(root, 'apps'), { recursive: true });
  mkdirSync(join(root, BUILD_DIR), { recursive: true });
  const manifest = join(root, BUILD_DIR, 'manifest.json');
  if (!existsSync(manifest)) {
    writeFileSync(manifest, `${JSON.stringify({ adminiumVersion: version, builtAt: new Date().toISOString(), config: { entry: OPERATOR_CONFIG_NAME, inputs: {} } }, null, 2)}\n`);
  }
  const planted = readdirSync(root).filter((name) => (CONFIG_FILES as readonly string[]).includes(name));
  if (planted.length > 0) warn(`The operator project's folder holds ${planted.join(', ')}; it is not read: this project's config comes from the environment.`);
  registerOperatorProject(root);
}

/** The config, from the environment alone. `main` only when `ADMINIUM_SOURCE_URL` is set. */
export function operatorProjectConfig(env: RawEnv, cwd: string = process.cwd()): ProjectConfig {
  const source = env['ADMINIUM_SOURCE_URL']?.trim() ?? '';
  const dataDir = env['ADMINIUM_DATA_DIR']?.trim() ?? '';
  return {
    ...(source === '' ? {} : { databases: { main: { url: source } } }),
    // Absolute: the data folder is the instance's, never a folder inside the project.
    dataDir: resolve(cwd, dataDir === '' ? 'data' : dataDir),
  };
}
