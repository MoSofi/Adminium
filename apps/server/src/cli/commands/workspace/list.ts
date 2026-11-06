// SPDX-License-Identifier: AGPL-3.0-only
/** `adminium workspace list`: this server's workspaces and their databases. */
import { workspacesRepo } from '@adminium/meta';

import { parseFlags } from '../../args.js';
import type { Command } from '../../command.js';
import { EXIT_OK } from '../../exit.js';
import { connectionNames, envOf, storeFlags } from './shared.js';

export const workspaceListCommand: Command = {
  name: 'list',
  summary: "List this server's workspaces and their databases",
  usage: 'adminium workspace list',
  describe: 'Prints each workspace (its id, its name) and the databases it holds.\nA database may be in several workspaces, or in none.',
  flags: storeFlags,

  async run({ io, deps, argv }) {
    const { values } = parseFlags(argv, storeFlags, 'workspace list');
    const runtime = await deps.openRuntime(envOf(deps, values));
    try {
      const meta = runtime.metaStore.meta;
      const all = await workspacesRepo(meta).list();
      if (all.length === 0) {
        io.out('No workspaces on this server.');
        return EXIT_OK;
      }
      const names = await connectionNames(meta);
      for (const workspace of all) {
        const databases = workspace.connectionIds.map((id) => names.get(id) ?? id).sort((a, b) => a.localeCompare(b));
        io.out(`${workspace.id}  ${workspace.name}`);
        io.out(`  ${databases.length === 0 ? '(no databases)' : databases.join(', ')}`);
      }
      return EXIT_OK;
    } finally {
      await runtime.close();
    }
  },
};

