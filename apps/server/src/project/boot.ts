// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What `adminium start` does first inside a project: load `.env`, load the
 * config, and work out the environment the server boots with.
 */

import {
  configFields,
  configuredDatabases,
  projectEnvironment,
  withDefaults,
  type ProjectConfig,
} from './config.js';
import { DOTENV_FILE, loadDotEnv } from './dotenv.js';
import { loadProjectConfig, type LoadBundler, type LoadedProjectConfig } from './build.js';
import { configFileName, findProject, type ProjectLocation } from './locate.js';

export interface PreparedProject {
  project: ProjectLocation;
  config: ProjectConfig;
  from: LoadedProjectConfig['from'];
  /** The environment the server should validate: yours, with the config's values filling gaps. */
  env: Record<string, string | undefined>;
  databases: ReturnType<typeof configuredDatabases>;
  /** Variables `.env` supplied. */
  fromDotEnv: string[];
  /** Where each variable the project supplied came from, for error messages. */
  sources: Record<string, string>;
}

/**
 * Where the project took each variable it supplied: `.env`, or a config field.
 * `env` is the environment after `.env` was loaded into it, so a variable
 * already set there is not the config's.
 */
export function variableSources(
  project: ProjectLocation,
  config: ProjectConfig,
  env: Readonly<Record<string, string | undefined>>,
  fromDotEnv: readonly string[],
): Record<string, string> {
  const sources: Record<string, string> = {};
  for (const key of fromDotEnv) sources[key] = DOTENV_FILE;
  for (const [key, field] of Object.entries(configFields(config))) {
    if ((env[key] ?? '') === '') sources[key] = `${configFileName(project)} (${field})`;
  }
  return sources;
}

/**
 * The project `cwd` belongs to, prepared for a boot, or null outside a
 * project. `.env` is copied into `env` itself, which is `process.env` in a real
 * run, because the config reads its values from there when it loads.
 */
export async function prepareProject(opts: {
  cwd: string;
  env: Record<string, string | undefined>;
  version: string;
  loadBundler?: LoadBundler;
}): Promise<PreparedProject | null> {
  const project = findProject(opts.cwd, opts.env);
  if (project === null) return null;
  const fromDotEnv = loadDotEnv(project.root, opts.env);
  const loaded = await loadProjectConfig(project, {
    version: opts.version,
    ...(opts.loadBundler === undefined ? {} : { loadBundler: opts.loadBundler }),
  });
  return {
    project,
    config: loaded.config,
    from: loaded.from,
    env: withDefaults(opts.env, projectEnvironment(loaded.config, project.root)),
    databases: configuredDatabases(loaded.config),
    fromDotEnv,
    sources: variableSources(project, loaded.config, opts.env, fromDotEnv),
  };
}
