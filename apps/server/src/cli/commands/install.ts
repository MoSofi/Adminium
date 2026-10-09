// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `adminium install` — install the project's packages, whole.
 *
 * On a terminal a person's own package manager does the same job; this is the
 * desktop app's way to make a folder ready before it starts that folder's
 * server, with the npm the app carries, and to learn whether that is needed
 * at all (`--check`).
 */
import { findProject } from '../../project/locate.js';
import { installNeed, installNeedWords, installProject } from '../../project/install.js';
import { boolFlag, parseFlags } from '../args.js';
import type { Command } from '../command.js';
import { CliError, EXIT_CONFIG, EXIT_ERROR, EXIT_OK } from '../exit.js';

export const installCommand: Command = {
  name: 'install',
  summary: 'Install the project’s packages',
  usage: 'adminium install [--check]',
  describe:
    'Installs the packages the project in this folder lists, from its lockfile when it\n' +
    'has one, with no install scripts, and marks the install as finished.\n' +
    '--check installs nothing: it says whether an install is needed and why (exit 0: in place; 3: needed).',
  flags: {
    check: { type: 'boolean', describe: 'Say whether an install is needed; install nothing' },
  },
  async run({ io, deps, argv }) {
    const { values } = parseFlags(argv, installCommand.flags, installCommand.name);
    const project = findProject(deps.cwd, deps.env);
    if (project === null) throw new CliError('There is no project in this folder (no adminium.config.ts).', { code: EXIT_CONFIG });
    const need = installNeed(project.root);
    if (boolFlag(values.check)) {
      io.out(need === null ? 'in place' : `needed: ${need}`);
      if (need !== null) io.out(installNeedWords(need));
      return need === null ? EXIT_OK : 3;
    }
    if (need !== null) io.out(installNeedWords(need));
    const result = await installProject(project.root, { env: deps.env, ...(deps.signal === undefined ? {} : { signal: deps.signal }) });
    if (result.note !== null) io.out(result.note);
    if (result.output.trim() !== '') io.out(result.output);
    if (!result.ok) {
      io.err(result.stopped ? 'The install was stopped.' : result.timedOut ? 'The install took too long and was stopped.' : `\`${result.command}\` failed.`);
      return EXIT_ERROR;
    }
    io.out('Installed.');
    return EXIT_OK;
  },
};
