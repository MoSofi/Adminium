// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `adminium app try` — prove the packed app installs and is served.
 */

import { resolve } from 'node:path';

import { resolveAppKey } from '../../../project/apps/read-app.js';
import { tryApp } from '../../../project/apps/try-app.js';
import { parseFlags, type FlagSpecs } from '../../args.js';
import type { Command } from '../../command.js';
import { EXIT_OK, EXIT_VALIDATION_FAILED } from '../../exit.js';
import { checkBuildAndPack } from './pack.js';
import { requireProject } from './shared.js';

const flags: FlagSpecs = {
  'add-ons': { type: 'string', placeholder: '<dir>', describe: 'A folder of add-on packages (<key>-<version>.tgz with .tgz.integrity) the app needs' },
  keep: { type: 'boolean', describe: 'Keep the throwaway Adminium’s folder, and print where it is' },
  json: { type: 'boolean', describe: 'Print the result as JSON' },
};

export const appTryCommand: Command = {
  name: 'try',
  summary: 'Install the packed app on a throwaway Adminium and probe it',
  usage: 'adminium app try [key] [--add-ons <dir>] [--keep] [--json]',
  describe:
    'Packs the app, then starts a fresh Adminium in a temp folder with an empty\n' +
    'SQLite database and does what a person would do in Studio, through the same\n' +
    'routes: upload the package, check the tables, install, add the sample data.\n' +
    'It then opens each side and every file its page names, reads a table as the\n' +
    'signed-in person, and asks the public API for what the manifest grants and\n' +
    'for what it does not. Nothing listens on a port and nothing of your project\n' +
    'is changed. Exits 2 when a step fails. It does not run the screens in a\n' +
    'browser: an error inside a screen only shows when a person opens it.',
  flags,

  async run({ io, deps, argv }) {
    const { values, positionals } = parseFlags(argv, flags, 'app try');
    const project = requireProject({ deps }, 'try');
    const key = resolveAppKey(project.root, positionals[0], 'try');
    const json = values['json'] === true;
    const done = await checkBuildAndPack(io, project, key, { quiet: json });
    if (done === null) return EXIT_VALIDATION_FAILED;
    const manifest = done.built.check.manifest;
    if (manifest === null) return EXIT_VALIDATION_FAILED;

    const result = await tryApp({
      packed: done.packed,
      manifest,
      sides: done.built.sides.map((side) => side.side),
      ...(typeof values['add-ons'] === 'string' ? { addOnsDir: resolve(deps.cwd, values['add-ons']) } : {}),
      keep: values['keep'] === true,
      openRuntime: deps.openRuntime,
      ...(json
        ? {}
        : {
            onStep: (step) => {
              if (step.ok) io.out(`✓ ${step.text}`);
              else io.err(`✗ ${step.text}${step.detail === undefined ? '' : `\n    ${step.detail.split('\n').join('\n    ')}`}`);
            },
          }),
    });

    if (json) io.out(JSON.stringify({ ok: result.ok, key, version: done.packed.version, steps: result.steps }, null, 2));
    else {
      io.out('');
      if (result.ok) io.out(`${manifest.name} ${done.packed.version} installs and is served. Pack it with  adminium app pack ${key}`);
      else io.err(`${String(result.steps.filter((step) => !step.ok).length)} step(s) failed.`);
      if (result.kept !== null) io.out(`Kept: ${result.kept}`);
    }
    return result.ok ? EXIT_OK : EXIT_VALIDATION_FAILED;
  },
};
