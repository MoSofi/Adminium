// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `adminium app new` — write a starter app into this project.
 */

import { checkApp } from '../../../project/apps/check-app.js';
import { appPath, type AppSide } from '../../../project/apps/read-app.js';
import { addSideDependencies, appKeyProblem, nameFromKey, scaffoldApp } from '../../../project/apps/scaffold-app.js';
import { refreshInstallStamp } from '../../../project/install-stamp.js';
import { packageManagerProgram } from '../../../project/programs.js';
import { APP_VERSION } from '../../../version.js';
import { parseFlags, type FlagSpecs } from '../../args.js';
import type { Command } from '../../command.js';
import { CliError, CliUsageError, EXIT_ERROR, EXIT_OK } from '../../exit.js';
import { runProcess as defaultRunProcess } from '../../runtime.js';
import { hasErrors, printCheck, requireProject } from './shared.js';

const flags: FlagSpecs = {
  name: { type: 'string', placeholder: '<text>', describe: "The app's name as people read it", defaultDescription: 'made from the key' },
  staff: { type: 'boolean', describe: 'Add screens for staff (apps/<key>/staff/)' },
  customer: { type: 'boolean', describe: 'Add public screens for customers (apps/<key>/customer/)' },
  'no-install': { type: 'boolean', describe: 'Do not install the packages the screens need' },
};

export const appNewCommand: Command = {
  name: 'new',
  summary: 'Write a starter app into apps/<key>/',
  usage: 'adminium app new <key> [--name <text>] [--staff] [--customer] [--no-install]',
  describe:
    'Writes a small working app: two tables, a dashboard page for each, one role\n' +
    'and sample data, with its manifest as part files. --staff and --customer add a\n' +
    'side each, with one screen over that table; with neither, the app is its\n' +
    'tables and pages alone. The app carries the publisher "local": it is yours,\n' +
    'and installs from a file. Then edit the files and run  adminium app check.',
  flags,

  async run({ io, deps, argv }) {
    const { values, positionals } = parseFlags(argv, flags, 'app new');
    const key = positionals[0];
    if (key === undefined || positionals.length > 1) throw new CliUsageError('Give the app one key:  adminium app new <key>', 'app new');
    const problem = appKeyProblem(key);
    if (problem !== null) throw new CliUsageError(`"${key}" cannot be an app key: ${problem}.`, 'app new');
    const project = requireProject({ deps }, 'new');

    const sides: AppSide[] = [...(values['staff'] === true ? (['staff'] as const) : []), ...(values['customer'] === true ? (['customer'] as const) : [])];
    const name = typeof values['name'] === 'string' && values['name'].trim() !== '' ? values['name'].trim() : nameFromKey(key);
    if (name.length > 80) throw new CliUsageError('--name is at most 80 characters.', 'app new');

    const created = scaffoldApp({ root: project.root, key, name, sides, version: APP_VERSION });
    io.out(`Created ${appPath(key)}/ (${String(created.length)} files).`);

    const added = addSideDependencies(project.root, sides, APP_VERSION);
    let installFailed = false;
    if (added.length > 0) {
      io.out(`Added to package.json: ${added.join(', ')}.`);
      const program = packageManagerProgram(project.root, deps.env);
      const launch = program.launch(['install']);
      // What is said is the manager's own name, whatever file starts it.
      const command = program.manager;
      const args = ['install'];
      if (program.note !== null) io.out(program.note);
      if (values['no-install'] === true) {
        io.out(`Install them before building:  ${command} ${args.join(' ')}`);
      } else {
        io.out(`Running ${command} ${args.join(' ')} …`);
        const result = (deps.runProcess ?? defaultRunProcess)(launch.command, launch.args, { cwd: project.root, inherit: true, ...(Object.keys(launch.env).length === 0 ? {} : { env: launch.env }) });
        if (result.status === 0) refreshInstallStamp(project.root, APP_VERSION);
        if (result.status !== 0) {
          installFailed = true;
          io.err(`\`${command} ${args.join(' ')}\` failed. The app's files are in place; run it again before building.`);
        }
      }
    }

    // What was just written is checked like anything else: a starter that fails its own check is a bug to see now.
    const check = checkApp(project.root, key, { version: APP_VERSION });
    printCheck(io, check);
    if (hasErrors(check)) throw new CliError('The starter did not pass its own check. This is a fault in Adminium, not in your project.');

    io.out('');
    io.out('Next:');
    io.out(`  edit ${appPath(key, 'manifest')}/ — tables, pages, roles${sides.includes('customer') ? ', access' : ''}`);
    io.out('  npm run dev                               runs it from this folder: save a file and it is applied');
    io.out(`  npx @adminiumjs/adminium app check ${key}`);
    io.out(`  npx @adminiumjs/adminium app try ${key}     packs it and installs it on a throwaway Adminium`);
    return installFailed ? EXIT_ERROR : EXIT_OK;
  },
};
