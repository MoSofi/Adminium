// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `adminium app build` — build an app's own screens.
 */

import { loadProjectBundler, type LoadBundler } from '../../../project/build.js';
import { checkApp, type AppCheck } from '../../../project/apps/check-app.js';
import { resolveAppKey } from '../../../project/apps/read-app.js';
import { buildAppSides, sideBuildPath, type BuiltSide } from '../../../project/apps/side-build.js';
import type { ProjectLocation } from '../../../project/locate.js';
import { APP_VERSION } from '../../../version.js';
import { parseFlags, type FlagSpecs } from '../../args.js';
import type { Command, CommandContext } from '../../command.js';
import { CliError, EXIT_OK, EXIT_VALIDATION_FAILED } from '../../exit.js';
import { hasErrors, printCheck, requireProject } from './shared.js';

const flags: FlagSpecs = {};

export interface BuiltApp {
  check: AppCheck;
  sides: BuiltSide[];
}

/**
 * Check the app, then build its sides. Null when the check failed: the
 * problems were printed and nothing was built.
 */
export async function checkAndBuild(
  io: CommandContext['io'],
  project: ProjectLocation,
  key: string,
  opts: { loadBundler?: LoadBundler; quiet?: boolean; brief?: boolean } = {},
): Promise<BuiltApp | null> {
  const check = checkApp(project.root, key, { version: APP_VERSION });
  if (hasErrors(check) || check.manifest === null) {
    printCheck(io, check);
    return null;
  }
  if (opts.quiet !== true) printCheck(io, check, { brief: opts.brief === true });
  if (check.sides.length === 0) return { check, sides: [] };

  const bundler = await (opts.loadBundler ?? loadProjectBundler)(project.root);
  if (bundler === null) {
    throw new CliError("Building an app's sides needs esbuild, and this project does not have it.", {
      hint: 'Install it as a dev dependency:\n  npm install --save-dev esbuild',
    });
  }
  const sides = await buildAppSides({ root: project.root, key, name: check.manifest.name, bundler, sides: check.sides });
  return { check, sides };
}

export const appBuildCommand: Command = {
  name: 'build',
  summary: "Build the app's staff and customer screens",
  usage: 'adminium app build [key]',
  describe:
    'Checks the app, then bundles each side in apps/<key>/<side>/src/ (entered\n' +
    'at main.tsx) into .adminium/build/apps/<key>/<side>/: an index.html, the\n' +
    'script and stylesheet, and surface.json when the side has a nav.json.\n' +
    'Needs the esbuild dev dependency and the project\'s packages installed.',
  flags,

  async run({ io, deps, argv }) {
    const { positionals } = parseFlags(argv, flags, 'app build');
    const project = requireProject({ deps }, 'build');
    const key = resolveAppKey(project.root, positionals[0], 'build');
    const built = await checkAndBuild(io, project, key);
    if (built === null) return EXIT_VALIDATION_FAILED;
    if (built.sides.length === 0) {
      io.out('This app has no screens of its own, so there is nothing to build.');
      return EXIT_OK;
    }
    for (const side of built.sides) {
      io.out(
        `Built the ${side.side} side → ${sideBuildPath(project.root, key, side.side)} ` +
          `(${String(side.files.length)} file(s), ${String(Math.ceil(side.bytes / 1024))} kB).`,
      );
    }
    return EXIT_OK;
  },
};
