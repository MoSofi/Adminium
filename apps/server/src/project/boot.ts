// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What `adminium start` does first inside a project: load `.env`, load the
 * config, and work out the environment the server boots with.
 */

import { HOST_DECIDED_ENV } from '../config/host-decided.js';
import { holdOperatorSecrets, isOperatorSecretName, SECRET_FILE_SUFFIX, withHeldSecrets } from '../config/operator-secrets.js';
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
import { allowsIn, rawProfile } from '../trial/policy.js';

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
 * Names no folder decides, on any host, a terminal included: markers that say
 * how this process was started. `ADMINIUM_RUNTIME=desktop` says the desktop
 * app started it, which turns the setup token off (`setup/token.ts`); a line
 * in a `.env` deployed with the folder must not.
 */
export const NEVER_FROM_A_FOLDER: readonly string[] = ['ADMINIUM_RUNTIME'];

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
   * A terminal passes none: there the folder and the person are one, except
   * for {@link NEVER_FROM_A_FOLDER}, which is refused everywhere.
   */
  refuse?: readonly string[];
}): Promise<PreparedProject | null> {
  const project = findProject(opts.cwd, opts.env);
  if (project === null) return null;
  // Trial and hosted mode (plan 75 §5.1, S8): the Super Admin is a stranger who can write the folder, so its `.env`
  // is not read at all (their own AI key lives in Settings → AI), and its config decides nothing the host does.
  const dotEnv = allowsIn(rawProfile(opts.env), 'projectDotEnv').allowed;
  // A secret a folder may not set, it may not set as a file either (`<NAME>_FILE`).
  const named = [...(opts.refuse ?? []), ...(dotEnv ? [] : HOST_DECIDED_ENV), ...NEVER_FROM_A_FOLDER];
  const refuse = [...new Set([...named, ...named.filter((name) => isOperatorSecretName(name)).map((name) => `${name}${SECRET_FILE_SUFFIX}`)])];
  const inFile = refuse.length === 0 || !dotEnv ? null : readDotEnv(project.root);
  const refused = new Set(inFile === null ? [] : refuse.filter((name) => name in inFile));
  const fromDotEnv = !dotEnv ? [] : refuse.length === 0 ? loadDotEnv(project.root, opts.env) : loadDotEnv(project.root, opts.env, [...KEPT_OUT_OF_THE_ENVIRONMENT, ...refuse]);
  // The project's config is its own code, and it runs in this process: the operator's secrets (from the
  // environment and from `.env`, just read) leave `process.env` before it is imported
  // (`config/operator-secrets.ts`). The boot gets them back below, with the held values.
  if (opts.env === process.env) holdOperatorSecrets(opts.env);
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
    env: withDefaults(withHeldSecrets(opts.env), fromConfig),
    databases: configuredDatabases(loaded.config),
    fromDotEnv,
    sources: variableSources(project, loaded.config, opts.env, fromDotEnv),
    refused: [...refused].sort(),
  };
}
