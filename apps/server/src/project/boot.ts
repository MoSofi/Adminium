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
import { DOTENV_FILE, KEPT_OUT_OF_THE_ENVIRONMENT, loadDotEnv, readDotEnv } from './dotenv.js';
import { loadProjectConfig, type LoadBundler, type LoadedProjectConfig } from './build.js';
import { configFileName, findProject, type ProjectLocation } from './locate.js';

export interface PreparedProject {
  project: ProjectLocation;
  config: ProjectConfig;
  from: LoadedProjectConfig['from'];
  /** The apps' screens were built again as the kind this start needs. */
  appsRebuilt?: true;
  /** The environment the server should validate: yours, with the config's values filling gaps. */
  env: Record<string, string | undefined>;
  databases: ReturnType<typeof configuredDatabases>;
  /** Variables `.env` supplied. */
  fromDotEnv: string[];
  /** Where each variable the project supplied came from, for error messages. */
  sources: Record<string, string>;
  /** Names the folder's `.env` or config set that the host does not let a folder decide; each was ignored. */
  refused: string[];
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
  /** Who the build is for (`loadProjectConfig`); left out by a command that only reads the project. */
  dev?: boolean;
  /**
   * Names a folder may not decide, whatever its `.env` or its config says: the
   * host (the desktop app) states them itself, or leaves them unset on purpose.
   * A terminal passes none: there the folder and the person are one.
   */
  refuse?: readonly string[];
}): Promise<PreparedProject | null> {
  const project = findProject(opts.cwd, opts.env);
  if (project === null) return null;
  const refuse = opts.refuse ?? [];
  const inFile = refuse.length === 0 ? null : readDotEnv(project.root);
  const refused = new Set(inFile === null ? [] : refuse.filter((name) => name in inFile));
  const fromDotEnv = refuse.length === 0 ? loadDotEnv(project.root, opts.env) : loadDotEnv(project.root, opts.env, [...KEPT_OUT_OF_THE_ENVIRONMENT, ...refuse]);
  const loaded = await loadProjectConfig(project, {
    version: opts.version,
    ...(opts.loadBundler === undefined ? {} : { loadBundler: opts.loadBundler }),
    ...(opts.dev === undefined ? {} : { dev: opts.dev }),
  });
  const fromConfig = projectEnvironment(loaded.config, project.root);
  for (const name of refuse) {
    if (name in fromConfig && (opts.env[name] ?? '') === '') refused.add(name);
    Reflect.deleteProperty(fromConfig, name);
  }
  return {
    project,
    config: loaded.config,
    from: loaded.from,
    ...(loaded.appsRebuilt === true ? { appsRebuilt: true as const } : {}),
    env: withDefaults(opts.env, fromConfig),
    databases: configuredDatabases(loaded.config),
    fromDotEnv,
    sources: variableSources(project, loaded.config, opts.env, fromDotEnv),
    refused: [...refused].sort(),
  };
}
