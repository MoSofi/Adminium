// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `adminium design` — build an app by describing it.
 *
 * Opens Adminium Designer in the browser, signed in, on this machine:
 *
 *   - outside a project it makes one first, as `adminium new` would, with a
 *     database of its own and no questions;
 *   - it starts the server IN THIS PROCESS (not as `adminium dev`'s child), so
 *     the one-use link and a turn that is running are never lost to a restart;
 *   - the server listens on this machine only, and answers to its own names;
 *   - the first time, it makes the project's owner with no password, and the
 *     link it opens signs that owner in, once. `adminium owner set` gives them
 *     a password later; a project whose owner has one signs in as usual.
 *
 * The link carries its token after `#`, so it is never part of a request a
 * log could hold.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';

import Database from 'better-sqlite3';

import { runChild } from '../../designer/child.js';
import { DESIGNER_REACT_VERSION } from '../../designer/tools.js';
import { PUBLIC_CLIENT_PACKAGE } from '../../project/apps/scaffold-app.js';
import { findProject } from '../../project/locate.js';
import { addPackagesArgs, packageManagerProgram } from '../../project/programs.js';
import { APP_VERSION } from '../../version.js';
import { boolFlag, numberFlag, parseFlags, stringFlag } from '../args.js';
import type { Command } from '../command.js';
import { CliUsageError, EXIT_OK } from '../exit.js';
import { newCommand } from './new.js';
import { localOwnerStart, runStart } from './start.js';

/**
 * What an app's own screens are built with, added to a project the Designer
 * was asked to make: React and Adminium's public client. A first build then
 * shows its screens without first asking for three packages. It is tried
 * once and quietly: where it does not work (no network), the Designer asks
 * for them on one card when a side is first added.
 */
async function addScreenPackages(root: string, env: NodeJS.ProcessEnv): Promise<void> {
  const program = packageManagerProgram(root, env);
  const specs = [`react@${DESIGNER_REACT_VERSION}`, `react-dom@${DESIGNER_REACT_VERSION}`, `${PUBLIC_CLIENT_PACKAGE}@${APP_VERSION}`];
  const launch = program.launch(addPackagesArgs(program.manager, specs));
  await runChild(launch.command, launch.args, { cwd: root, timeoutMs: 180_000, signal: new AbortController().signal, env: { ...process.env, ...launch.env } }).catch(() => undefined);
}

/** The ports `design` tries, in order, when none is named. */
export const DESIGN_PORTS = { first: 4700, last: 4799 } as const;

/** The first port from `from` that nothing on this machine listens on. */
export async function freePort(from: number, to: number, host = '127.0.0.1'): Promise<number | null> {
  for (let port = from; port <= to; port += 1) {
    const free = await new Promise<boolean>((done) => {
      const probe = createServer();
      probe.once('error', () => done(false));
      probe.listen(port, host, () => probe.close(() => done(true)));
    });
    if (free) return port;
  }
  return null;
}

/** The database a project `design` makes keeps its tables in: a file in the project. */
export const DESIGN_DATABASE = 'sqlite:./data/app.sqlite';

/**
 * Make that file, empty. A SQLite connection opens only a file that exists (a
 * mistyped path must not quietly become a new, empty database), so the
 * project `design` makes would otherwise start with its database refused.
 */
export function makeDesignDatabase(root: string): void {
  const file = resolve(root, DESIGN_DATABASE.slice('sqlite:'.length));
  if (existsSync(file)) return;
  mkdirSync(dirname(file), { recursive: true });
  new Database(file).close();
}

export const designCommand: Command = {
  name: 'design',
  summary: 'Build an app by describing it, with Adminium Designer',
  usage: 'adminium design [folder] [--port <n>] [--no-open]',
  describe:
    'Opens Adminium Designer in your browser, signed in, on this machine only.\n' +
    'Describe an app; a model you choose writes it into apps/<key>/, and Adminium\n' +
    'checks it, applies it and shows it. Outside a project it makes one first\n' +
    '(in <folder>, default my-app), with a database file of its own.',
  flags: {
    port: { type: 'string', short: 'p', placeholder: '<n>', describe: 'Port to listen on', defaultDescription: `the first free one from ${String(DESIGN_PORTS.first)}` },
    'no-open': { type: 'boolean', describe: 'Print the link instead of opening the browser' },
    'log-level': { type: 'string', placeholder: '<level>', describe: 'fatal|error|warn|info|debug|trace', defaultDescription: 'warn' },
  },

  async run({ io, deps, argv }) {
    const { values, positionals } = parseFlags(argv, designCommand.flags, designCommand.name);
    if (positionals.length > 1) throw new CliUsageError('Give one folder name at most.', designCommand.name);
    const named = numberFlag(values.port, 'port', designCommand.name);

    let cwd = deps.cwd;
    const project = findProject(cwd, deps.env);
    if (project === null) {
      const folder = positionals[0] ?? 'my-app';
      io.out(`There is no project here: making one in ${folder}/ for the Designer.`);
      const made = await newCommand.run({ io, deps, argv: [folder, '--yes', '--database', DESIGN_DATABASE] });
      if (made !== EXIT_OK) return made;
      cwd = resolve(cwd, folder);
      if (!existsSync(cwd)) throw new CliUsageError(`${folder}/ was not made.`, designCommand.name);
      makeDesignDatabase(cwd);
      await addScreenPackages(cwd, deps.env);
    } else if (positionals.length > 0) {
      throw new CliUsageError(`This folder is already in a project (${project.root}); run \`adminium design\` without a folder name.`, designCommand.name);
    }

    const port = named ?? (await freePort(DESIGN_PORTS.first, DESIGN_PORTS.last));
    if (port === null) throw new CliUsageError(`No port from ${String(DESIGN_PORTS.first)} to ${String(DESIGN_PORTS.last)} is free; name one with --port.`, designCommand.name);
    const token = randomBytes(32).toString('hex');
    const logLevel = stringFlag(values['log-level']) ?? 'warn';

    return runStart(
      { io, deps: { ...deps, cwd }, argv: ['--port', String(port), '--log-level', logLevel] },
      localOwnerStart(io, token, async (_url, listening, minted) => {
        const page = `http://127.0.0.1:${String(listening)}/design`;
        const link = minted === null ? page : `${page}#designToken=${minted}`;
        io.out(`Adminium Designer is running at ${page}`);
        if (minted === null) io.out('Sign in with your account.');
        const opened = boolFlag(values['no-open']) ? false : await deps.openBrowser(link);
        if (!opened) io.out(minted === null ? `Open ${page}` : `Open this link once to sign in: ${link}`);
        io.out('Ctrl-C stops it.');
      }),
    );
  },
};
