// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `adminium workspace <command>`: the server's workspaces, and Save workspace
 * from the command line.
 *
 *  - `workspace list` prints each workspace with its databases.
 *  - `workspace save --workspace <id|name> --out <file>` makes one app per
 *    database of the workspace and writes them as one workspace file, through
 *    the same service the dashboard's Save workspace calls. Like
 *    `adminium app save`, it runs with host access (every right held) and
 *    keeps no copy in the Files library.
 *
 * A workspace file is installed through the dashboard only: its review asks,
 * per app, where it goes and what to allow.
 */
import { parseFlags } from '../args.js';
import type { Command } from '../command.js';
import { CliUsageError, EXIT_OK } from '../exit.js';
import { workspaceListCommand } from './workspace/list.js';
import { workspaceSaveCommand } from './workspace/save.js';

export const WORKSPACE_COMMANDS: readonly Command[] = [workspaceListCommand, workspaceSaveCommand];

function listing(): string {
  const width = Math.max(...WORKSPACE_COMMANDS.map((command) => command.name.length));
  return [
    'Usage: adminium workspace <command> [options]',
    '',
    "A workspace groups this server's databases. Save workspace makes one app",
    'per database and writes them as one file.',
    '',
    'Commands:',
    ...WORKSPACE_COMMANDS.map((command) => `  ${command.name.padEnd(width)}  ${command.summary}`),
    '',
    'Run  adminium workspace <command> --help  for a command.',
  ].join('\n');
}

export const workspaceCommand: Command = {
  name: 'workspace',
  summary: "List this server's workspaces, or save one as a workspace file",
  usage: 'adminium workspace <command> [options]',
  describe: listing().split('\n').slice(2).join('\n'),
  flags: {},
  subcommands: WORKSPACE_COMMANDS,

  async run(ctx) {
    const [first, ...rest] = ctx.argv;
    if (first === undefined) {
      ctx.io.out(listing());
      return EXIT_OK;
    }
    const command = WORKSPACE_COMMANDS.find((candidate) => candidate.name === first);
    if (command === undefined) {
      if (first.startsWith('-')) parseFlags([first], workspaceCommand.flags, 'workspace');
      throw new CliUsageError(`Unknown workspace command "${first}".`, 'workspace');
    }
    return command.run({ ...ctx, argv: rest });
  },
};
