// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `adminium folder-facts`: what the project folder holds, as JSON, without
 * running anything of it. For a host that opens folders it did not make (the
 * desktop app asks before it starts one); a person at a terminal has `check`.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { readFolderFacts } from '../../project/folder-facts.js';
import { CONFIG_FILES } from '../../project/locate.js';
import type { Command } from '../command.js';
import { CliError, EXIT_CONFIG, EXIT_OK } from '../exit.js';

export const folderFactsCommand: Command = {
  name: 'folder-facts',
  summary: 'Say what this project folder holds, without running it',
  usage: 'adminium folder-facts',
  describe:
    'Prints, as JSON, whether the folder has its key and its data, which Adminium last\n' +
    'changed that data, and the accounts, API keys and public keys in it. Nothing of the\n' +
    'folder is built, imported or changed. For apps that open project folders.',
  flags: {},
  async run({ io, deps }) {
    // This folder, never a project above it: a host names the folder it means.
    if (!CONFIG_FILES.some((name) => existsSync(join(deps.cwd, name)))) {
      throw new CliError('There is no project in this folder (no adminium.config.ts).', { code: EXIT_CONFIG });
    }
    io.out(JSON.stringify(readFolderFacts(deps.cwd)));
    return EXIT_OK;
  },
};
