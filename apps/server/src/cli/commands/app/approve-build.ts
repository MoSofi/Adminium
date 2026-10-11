// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `adminium app approve-build` — say yes to an app's own build command.
 *
 * An app copied from a published one builds its screens with the build it was
 * written with, named in `apps/<key>/build.json`. That command is a shell, so
 * nothing runs it until a person has read it and said yes. This is where they
 * say it from a terminal; the Designer's "Start with an app" sheet is the
 * other place.
 */

import { existsSync } from 'node:fs';

import { approveBuild, isBuildApproved, readAppBuild } from '../../../project/apps/own-build.js';
import { PHONE_BUILD_WORDS, PHONE_INSTALL_WORDS, approvePhone, isPhoneApproved, phoneDir, phoneShapeProblems } from '../../../project/apps/phone.js';
import { installPhone, phoneInstalled } from '../../../project/apps/phone-build.js';
import { resolveAppKey } from '../../../project/apps/read-app.js';
import { parseFlags, type FlagSpecs } from '../../args.js';
import type { Command } from '../../command.js';
import { CliError, EXIT_OK, EXIT_VALIDATION_FAILED } from '../../exit.js';
import { requireProject } from './shared.js';

const flags: FlagSpecs = {
  yes: { type: 'boolean', describe: 'Approve without being asked (for a script that has shown the command another way)' },
};

export const appApproveBuildCommand: Command = {
  name: 'approve-build',
  summary: 'Approve the build command of an app that has its own',
  usage: 'adminium app approve-build [key] [--yes]',
  describe:
    'Shows the two commands in apps/<key>/build.json (the install and the build)\n' +
    'and asks whether they may run. They run in the app’s folder, as you, whenever\n' +
    'the project is built. The approval is of their exact words: change one\n' +
    'character of build.json and it has to be given again. It is kept in\n' +
    '.adminium/approved-builds.json, outside the app’s folder.\n' +
    'For an app with a phone app (apps/<key>/mobile/) it asks the same of\n' +
    'Expo’s install and build, and then installs the phone app’s packages.',
  flags,

  async run({ io, deps, argv }) {
    const { values, positionals } = parseFlags(argv, flags, 'app approve-build');
    const project = requireProject({ deps }, 'approve-build');
    const key = resolveAppKey(project.root, positionals[0], 'approve-build');
    // A phone side: Expo's install and build, of the files as they read now.
    if (existsSync(phoneDir(project.root, key))) {
      const shape = phoneShapeProblems(project.root, key);
      if (shape.length > 0) throw new CliError(`apps/${key}/mobile cannot be approved as it is:\n${shape.map((problem) => `  ${problem.file} ${problem.message}`).join('\n')}`);
      if (!isPhoneApproved(project.root, key)) {
        io.out(`apps/${key} has a phone app, built with Expo. Its preview needs, run in apps/${key}/mobile/ as you:`);
        io.out('');
        io.out(`  ${PHONE_INSTALL_WORDS}     Expo's packages, about 350 MB`);
        io.out(`  ${PHONE_BUILD_WORDS}`);
        io.out('');
        io.out('Expo’s build runs the code of those packages. The approval is of the phone app’s package list and settings as they read now: change one and it is asked again.');
        if (values['yes'] !== true) {
          if (!io.isInteractive) throw new CliError('Nobody is here to ask.', { hint: `Read the lines above, then run:  adminium app approve-build ${key} --yes` });
          if (!(await io.confirm('Let them run?', false))) {
            io.out('Not approved. Nothing was run.');
            return EXIT_VALIDATION_FAILED;
          }
        }
        approvePhone(project.root, key);
        io.out('Approved.');
      }
      if (!phoneInstalled(project.root, key)) {
        io.out('Installing the phone app’s packages (about a minute) …');
        const installed = await (deps.installPhone ?? installPhone)(project.root, key);
        if (!installed.ok) throw new CliError(installed.words);
        io.out('Installed. The next build makes its preview (adminium design, adminium dev).');
      } else io.out(`The phone app of apps/${key} is approved and its packages are installed.`);
      if (readAppBuild(project.root, key) === null) return EXIT_OK;
    }
    const build = readAppBuild(project.root, key);
    if (build === null) throw new CliError(`apps/${key} has no build.json: its screens are built by Adminium, and there is nothing to approve.`);
    if ('problem' in build) throw new CliError(build.problem);
    if (isBuildApproved(project.root, key, build)) {
      io.out(`The build of apps/${key} is already approved as it reads now.`);
      return EXIT_OK;
    }
    io.out(`apps/${key} builds its screens with these commands, run in apps/${key}/ as you:`);
    io.out('');
    io.out(`  ${build.install}`);
    io.out(`  ${build.command}`);
    io.out('');
    io.out(`and takes what they leave in apps/${key}/${build.output}/.`);
    if (values['yes'] !== true) {
      if (!io.isInteractive) throw new CliError('Nobody is here to ask.', { hint: `Read the commands above, then run:  adminium app approve-build ${key} --yes` });
      if (!(await io.confirm('Let them run?', false))) {
        io.out('Not approved. Nothing was run.');
        return EXIT_VALIDATION_FAILED;
      }
    }
    approveBuild(project.root, key, build);
    io.out(`Approved. The next build runs them (adminium dev, adminium build).`);
    return EXIT_OK;
  },
};
