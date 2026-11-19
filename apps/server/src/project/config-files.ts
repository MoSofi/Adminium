// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a project's config file is called and where a project is: shared by the
 * lookup (`locate.ts`) and the operator project (`operator-project.ts`), which
 * finds its project without the file.
 */

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
