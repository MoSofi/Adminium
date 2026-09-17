// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `adminium build` — compile the project into `.adminium/build/`.
 */

import { relative } from 'node:path';

import { buildProject } from '../../project/build.js';
import { findProject } from '../../project/locate.js';
import { APP_VERSION } from '../../version.js';
import { parseFlags } from '../args.js';
import type { Command } from '../command.js';
import { CliError, EXIT_OK } from '../exit.js';

export const buildCommand: Command = {
  name: 'build',
  summary: "Compile the project's config and code into .adminium/build",
  usage: 'adminium build',
  describe:
    'Compiles adminium.config.ts, the hooks and actions, and the pages and\n' +
    'widgets into .adminium/build/, which `adminium start` loads. Needs the\n' +
    'esbuild dev dependency. Run it before deploying; a project image runs it in\n' +
    'its build stage.',
  flags: {},

  async run({ io, deps, argv }) {
    parseFlags(argv, buildCommand.flags, buildCommand.name);
    const project = findProject(deps.cwd, deps.env);
    if (project === null) {
      throw new CliError('adminium build runs inside a project, and this folder is not in one.', {
        hint: 'Create one with  adminium new <name>',
      });
    }
    const { configOutput, manifest } = await buildProject(project, { version: APP_VERSION });
    io.out(
      `Built ${manifest.config.entry} → ${relative(project.root, configOutput)} ` +
        `(${String(Object.keys(manifest.config.inputs).length)} file(s), Adminium ${manifest.adminiumVersion}).`,
    );
    const server = manifest.server?.files.length ?? 0;
    const pages = manifest.client?.pages.length ?? 0;
    const widgets = manifest.client?.widgets.length ?? 0;
    if (server + pages + widgets > 0) {
      io.out(
        `Built ${String(server)} hook and action file(s), ${String(pages)} page(s) and ${String(widgets)} widget(s).`,
      );
    }
    return EXIT_OK;
  },
};
