// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `adminium archive create <file>` and `adminium archive restore <file>`: a
 * whole instance in one file, and back into a fresh one.
 */

import { parseFlags } from '../args.js';
import type { Command, CommandContext } from '../command.js';
import { CliUsageError, EXIT_OK } from '../exit.js';
import { archiveCreateCommand, archiveRestoreCommand } from './archive/commands.js';

export const ARCHIVE_COMMANDS: readonly Command[] = [archiveCreateCommand, archiveRestoreCommand];

function listing(): string {
  return [
    'Usage: adminium archive <command> [options]',
    '',
    'A whole instance in one file: the meta store, uploads, local SQLite',
    'databases and the project folder, to back up or move to another server.',
    '',
    'Commands:',
    ...ARCHIVE_COMMANDS.map((command) => `  ${command.name.padEnd(7)}  ${command.summary}`),
    '',
    'Run  adminium archive <command> --help  for a command.',
  ].join('\n');
}

export const archiveCommand: Command = {
  name: 'archive',
  summary: 'Back up a whole instance into one file, or restore one',
  usage: 'adminium archive <command> [options]',
  describe: listing().split('\n').slice(2).join('\n'),
  flags: {},
  subcommands: ARCHIVE_COMMANDS,

  async run(ctx: CommandContext) {
    const [first, ...rest] = ctx.argv;
    if (first === undefined) {
      ctx.io.out(listing());
      return EXIT_OK;
    }
    const command = ARCHIVE_COMMANDS.find((candidate) => candidate.name === first);
    if (command === undefined) {
      if (first.startsWith('-')) parseFlags([first], archiveCommand.flags, 'archive');
      throw new CliUsageError(`Unknown archive command "${first}".`, 'archive');
    }
    return command.run({ ...ctx, argv: rest });
  },
};
