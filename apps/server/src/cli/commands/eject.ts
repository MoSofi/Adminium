// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `adminium eject <address>` — turn a page file into a page written in React
 * (49-developer-projects.md §7).
 *
 * It writes `pages/<address>.tsx`, which draws the page file's settings with
 * the UI kit's `GeneratedPage`, and deletes `pages/<address>.json`. Only the
 * folder changes here. `adminium dev`, or the next start of a server, gives
 * the page's row to the new code (`project/project-pages.ts`), so the page
 * keeps its address, grants and views, and regeneration leaves it alone.
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadProjectConfig } from '../../project/build.js';
import { hasCodePage } from '../../project/client-build.js';
import { ejectedPageSource } from '../../project/eject.js';
import { findProject } from '../../project/locate.js';
import { PAGES_DIR, isPageSlug, pagePath } from '../../project/paths.js';
import { checkProjectFile, offlineRefs } from '../../project/project-files.js';
import { APP_VERSION } from '../../version.js';
import { parseFlags } from '../args.js';
import type { Command } from '../command.js';
import { CliError, CliUsageError, EXIT_OK } from '../exit.js';

export const ejectCommand: Command = {
  name: 'eject',
  summary: 'Turn a page file into a page written in React',
  usage: 'adminium eject <address>',
  describe:
    'Writes pages/<address>.tsx, which draws the page with the settings in\n' +
    'pages/<address>.json, and deletes that file. The page keeps its address, who can\n' +
    'see it and its saved views, and regenerating the database no longer changes it.\n' +
    'Needs no database.',
  flags: {},

  async run({ io, deps, argv }) {
    const { positionals } = parseFlags(argv, ejectCommand.flags, ejectCommand.name);
    const [slug] = positionals;
    if (slug === undefined || positionals.length > 1) {
      throw new CliUsageError('adminium eject takes one page address, such as `adminium eject orders`.', ejectCommand.name);
    }
    const project = findProject(deps.cwd, deps.env);
    if (project === null) {
      throw new CliError('adminium eject runs inside a project, and this folder is not in one.', {
        hint: 'Create one with  adminium new <name>',
      });
    }
    if (!isPageSlug(slug)) {
      throw new CliError(
        `"${slug}" is not a page address: those are lowercase letters, digits and "-", at most 31 characters.`,
      );
    }
    const file = pagePath(slug);
    if (hasCodePage(project.root, slug)) {
      throw new CliError(`The page at /p/${slug} is already written in React, in ${PAGES_DIR}/.`);
    }
    const absolute = join(project.root, file);
    if (!existsSync(absolute)) {
      throw new CliError(`${file} does not exist.`, {
        hint: `adminium eject takes the address of a page file in ${PAGES_DIR}/, such as  adminium eject orders`,
      });
    }

    const { config } = await loadProjectConfig(project, { version: APP_VERSION });
    const checked = checkProjectFile(file, readFileSync(absolute, 'utf8'), offlineRefs(Object.keys(config.databases ?? {})));
    if (!checked.valid) {
      throw new CliError(`${file} is not valid, so it was not ejected:\n  ${checked.problems.join('\n  ')}`);
    }
    if (checked.kind !== 'page') throw new CliError(`${file} is not a page file.`);
    if (!checked.doc.enabled) {
      throw new CliError(`${file} is turned off ("enabled": false), and a page written in React is always on.`, {
        hint: 'Turn the page on first, or delete the file.',
      });
    }

    const target = `${PAGES_DIR}/${slug}.tsx`;
    writeFileSync(join(project.root, target), ejectedPageSource(slug, checked.doc.portable));
    rmSync(absolute);
    io.out(`Wrote ${target} and deleted ${file}.`);
    io.out('The page keeps its address, who can see it and its saved views, and regenerating the');
    io.out('database no longer changes it. `npm run dev` switches it over now; a server does at its');
    io.out('next deploy.');
    return EXIT_OK;
  },
};
