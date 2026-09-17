// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `adminium` with no command.
 *
 *   - Inside a project: prints the project's commands.
 *   - Outside one, in a terminal: asks for a folder name (`.` for the current
 *     folder) and runs `adminium new`.
 *   - Outside one, with no terminal: explains what to run instead.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { findProject } from '../../project/locate.js';
import { detectPackageManager, runScript } from '../../project/package-manager.js';
import type { Command } from '../command.js';
import { CliError, EXIT_OK } from '../exit.js';
import { newCommand, projectNameProblem } from './new.js';

/** The package.json scripts that run Adminium commands, by command. */
function adminiumScripts(root: string): Map<string, string> {
  const found = new Map<string, string>();
  const file = join(root, 'package.json');
  if (!existsSync(file)) return found;
  try {
    const scripts = (JSON.parse(readFileSync(file, 'utf8')) as { scripts?: Record<string, string> }).scripts ?? {};
    for (const [name, command] of Object.entries(scripts)) {
      const match = /^adminium ([a-z-]+)$/.exec(command.trim());
      if (match?.[1] !== undefined && !found.has(match[1])) found.set(match[1], name);
    }
  } catch {
    // An unreadable package.json just means no scripts to list.
  }
  return found;
}

export const homeCommand: Command = {
  name: 'adminium',
  summary: 'Create a project, or show the current project’s commands',
  usage: 'adminium [new options]',
  describe:
    'Inside a project, lists its commands. Anywhere else, asks for a folder name\n' +
    'and creates a project there (`.` means this folder). Accepts the options of\n' +
    '`adminium new`.',
  flags: newCommand.flags,
  hidden: true,

  async run(ctx) {
    const { io, deps, argv } = ctx;
    const project = findProject(deps.cwd, deps.env);
    if (project !== null) {
      const pm = detectPackageManager(deps.env);
      const scripts = adminiumScripts(project.root);
      const where = relative(deps.cwd, project.root) || '.';
      io.out(`This is an Adminium project (${where}).`);
      io.out('');
      const rows: [string, string][] = [
        ['dev', 'run it; page files and Studio stay in step'],
        ['build', 'compile it for a server'],
        ['start', 'run the build'],
        ['check', 'check it and its page files without starting'],
        ['pull', 'write pages into the folder (--from <url> for a server)'],
      ];
      for (const [id, what] of rows) {
        const script = scripts.get(id);
        io.out(`  ${(script === undefined ? `npx @adminiumjs/adminium ${id}` : runScript(pm, script)).padEnd(34)} ${what}`);
      }
      io.out(`  ${'npx @adminiumjs/adminium eject <address>'} turn a page file into a page written in React`);
      return EXIT_OK;
    }

    if (!io.isInteractive) {
      throw new CliError('Tell Adminium what to do.', {
        hint:
          'Create a project:        adminium new <name>\n' +
          'Run a server:            adminium start\n' +
          'Try it without a folder: adminium try\n' +
          'Every command:           adminium --help',
      });
    }

    const name = (
      await io.ask('Project folder', {
        default: 'my-admin',
        hint: 'a new folder name, or . for this folder',
        validate: (answer) => {
          const value = answer.trim();
          if (value === '' || value === '.') return null;
          const problem = projectNameProblem(value);
          return problem === null ? null : `That cannot be a project name: ${problem}.`;
        },
      })
    ).trim();
    return newCommand.run({ ...ctx, argv: [name === '' ? 'my-admin' : name, ...argv] });
  },
};
