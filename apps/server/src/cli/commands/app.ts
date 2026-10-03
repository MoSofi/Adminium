// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `adminium app <command>` — an app in this project's `apps/` folder.
 *
 * One entry in the command list that hands its arguments to a sub-command,
 * so the root help stays the length it is and each sub-command keeps its own
 * flags and its own help.
 */

import { parseFlags } from '../args.js';
import type { Command } from '../command.js';
import { CliUsageError, EXIT_OK } from '../exit.js';
import { appBuildCommand } from './app/build.js';
import { appCheckCommand } from './app/check.js';
import { appNewCommand } from './app/new.js';
import { appApproveBuildCommand } from './app/approve-build.js';
import { appPackCommand } from './app/pack.js';
import { appTryCommand } from './app/try.js';

/** In the order a person meets them. */
export const APP_COMMANDS: readonly Command[] = [appNewCommand, appCheckCommand, appBuildCommand, appTryCommand, appPackCommand, appApproveBuildCommand];

function listing(): string {
  const width = Math.max(...APP_COMMANDS.map((command) => command.name.length));
  return [
    'Usage: adminium app <command> [key] [options]',
    '',
    "An app lives in this project's apps/<key>/ folder: a manifest (tables, pages,",
    'roles, what customers may reach), optional staff and customer screens, and',
    'sample data. [key] may be left out when the project holds one app.',
    '',
    'Commands:',
    ...APP_COMMANDS.map((command) => `  ${command.name.padEnd(width)}  ${command.summary}`),
    '',
    'Run  adminium app <command> --help  for a command.',
  ].join('\n');
}

export const appCommand: Command = {
  name: 'app',
  summary: 'Create, check, build, pack and try an app in this project',
  usage: 'adminium app <command> [key] [options]',
  describe: listing().split('\n').slice(2).join('\n'),
  flags: {},
  subcommands: APP_COMMANDS,

  async run(ctx) {
    const [first, ...rest] = ctx.argv;
    if (first === undefined) {
      ctx.io.out(listing());
      return EXIT_OK;
    }
    const command = APP_COMMANDS.find((candidate) => candidate.name === first);
    if (command === undefined) {
      // A flag before the sub-command is this command's own, and it has none.
      if (first.startsWith('-')) parseFlags([first], appCommand.flags, 'app');
      throw new CliUsageError(`Unknown app command "${first}".`, 'app');
    }
    return command.run({ ...ctx, argv: rest });
  },
};
