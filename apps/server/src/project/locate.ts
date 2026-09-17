// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Finding the project a command runs in.
 *
 * A project is a folder holding one `adminium.config.*` file. Commands look in
 * the working directory and then each parent, the way npm finds a
 * package.json. `ADMINIUM_PROJECT_DIR` names the folder outright; the project
 * Docker image sets it, because its server does not run from the project.
 */

import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import { CliError } from '../cli/exit.js';

/** Accepted config file names, in the order they are looked for. */
export const CONFIG_FILES = [
  'adminium.config.ts',
  'adminium.config.mts',
  'adminium.config.js',
  'adminium.config.mjs',
] as const;

export interface ProjectLocation {
  /** Absolute path of the project folder. */
  root: string;
  /** Absolute path of its config file. */
  configFile: string;
}

type Exists = (path: string) => boolean;

/** The config file in `dir`, or null. Two of them is an error: which one counts? */
export function configFileIn(dir: string, exists: Exists = existsSync): string | null {
  const found = CONFIG_FILES.filter((name) => exists(join(dir, name)));
  if (found.length > 1) {
    throw new CliError(`${dir} has more than one Adminium config file: ${found.join(', ')}.`, {
      hint: 'Keep one of them and delete the others.',
    });
  }
  return found.length === 1 ? join(dir, found[0] as string) : null;
}

/**
 * The project `start` belongs to: `ADMINIUM_PROJECT_DIR` if set, else the
 * nearest folder at or above `start` with a config file, else null.
 */
export function findProject(
  start: string,
  env: Readonly<Record<string, string | undefined>>,
  exists: Exists = existsSync,
): ProjectLocation | null {
  const named = env.ADMINIUM_PROJECT_DIR?.trim() ?? '';
  if (named !== '') {
    const root = resolve(start, named);
    const configFile = configFileIn(root, exists);
    if (configFile === null) {
      throw new CliError(`ADMINIUM_PROJECT_DIR is ${root}, and that folder has no adminium.config.ts.`, {
        hint: 'Point it at a project folder, or unset it to run without a project.',
      });
    }
    return { root, configFile };
  }

  let dir = resolve(start);
  for (;;) {
    const configFile = configFileIn(dir, exists);
    if (configFile !== null) return { root: dir, configFile };
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** `adminium.config.ts`, for messages. */
export function configFileName(project: ProjectLocation): string {
  return basename(project.configFile);
}
