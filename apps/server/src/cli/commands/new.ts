// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `adminium new [name]` — create a project folder, or turn the current folder
 * into one.
 *
 * With a name, the folder must not exist yet, or be empty. Without one (or
 * with `.`), the current folder becomes the project. There, nothing that
 * exists is overwritten: missing files are added, `package.json` and
 * `.gitignore` are added to, and everything else is left alone. It refuses
 * the home folder and the filesystem root, which are never projects.
 *
 * A folder that already holds an Adminium instance in `data/` keeps it, and
 * `--import <folder>` copies one in first (`~/.adminium` after `adminium
 * try`, say). Its secret is the one thing that must not be replaced, so a new
 * one is only generated when there is no instance to protect. The instance's
 * connections become the project's databases, and its pages and schema
 * customizations are written as files (`project/adopt.ts`).
 */

import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, parse as parsePath, resolve } from 'node:path';

import { parseDsn } from '../../connections/dsn.js';
import { adoptConnections, expandFolder, holdsInstance, importInstance, writeConfig } from '../../project/adopt.js';
import { addToDotEnv, readDotEnv } from '../../project/dotenv.js';
import { diskFileStore } from '../../project/file-store.js';
import { configFileIn } from '../../project/locate.js';
import { pullProject } from '../../project/reconcile.js';
import {
  detectPackageManager,
  installCommand,
  isPackageManager,
  PACKAGE_MANAGERS,
  runScript,
  type PackageManager,
} from '../../project/package-manager.js';
import { createSampleDatabase } from '../../project/sample.js';
import { scaffoldProject } from '../../project/scaffold.js';
import { APP_VERSION } from '../../version.js';
import { boolFlag, parseFlags, stringFlag } from '../args.js';
import type { Command } from '../command.js';
import { CliError, CliUsageError, EXIT_ERROR, EXIT_OK } from '../exit.js';
import { CliCancelled, type CliIo } from '../io.js';
import { readyMetaStore } from '../project-store.js';
import { loadCliEnv, runProcess as defaultRunProcess, type CliDeps, type RunProcess } from '../runtime.js';

/** The sample database, relative to the project. */
export const SAMPLE_DATABASE = join('data', 'sample.sqlite');
const SAMPLE_URL = 'sqlite:./data/sample.sqlite';

/** npm's rules for an unscoped package name, which is also a safe folder name. */
const NAME_PATTERN = /^[a-z0-9-~][a-z0-9-._~]*$/;

/** Why `name` cannot name a project, or null when it can. */
export function projectNameProblem(name: string): string | null {
  if (name.length > 214) return 'it is longer than 214 characters';
  if (name === 'node_modules' || name === 'favicon.ico') return 'that name is reserved';
  if (!NAME_PATTERN.test(name)) {
    return 'use lowercase letters, digits, "-", "." or "_", starting with a letter or digit';
  }
  return null;
}

/** A valid package name made from a folder name. */
export function packageNameFor(folder: string): string {
  const name = folder
    .toLowerCase()
    .replace(/[^a-z0-9-._~]+/g, '-')
    .replace(/^[._]+/, '')
    .replace(/-+$/, '')
    .slice(0, 214);
  return name === '' || projectNameProblem(name) !== null ? 'adminium-project' : name;
}

function isEmptyFolder(dir: string): boolean {
  return !existsSync(dir) || readdirSync(dir).filter((entry) => entry !== '.DS_Store').length === 0;
}

/** Folders that are never a project. */
function refusal(dir: string, home: string): string | null {
  if (dir === parsePath(dir).root) return 'The filesystem root cannot be a project.';
  if (home !== '' && dir === resolve(home)) return 'Your home folder cannot be a project.';
  return null;
}

/** `file:<absolute path>` for a tarball or folder path; anything else as given. */
export function adminiumSpec(value: string, cwd: string): string {
  const path = value.startsWith('file:') ? value.slice('file:'.length) : value;
  const looksLikePath =
    value.startsWith('file:') || /\.(tgz|tar\.gz)$/.test(value) || /^(\.{1,2}[\\/]|[\\/])/.test(value);
  return looksLikePath ? `file:${resolve(cwd, path)}` : value;
}

type DatabaseChoice = { kind: 'url'; url: string } | { kind: 'sample' } | { kind: 'later' };

function dsnProblem(url: string): string | null {
  try {
    parseDsn(url);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function chooseDatabase(io: CliIo): Promise<DatabaseChoice> {
  const choice = await io.select('Which database should the admin be built from?', [
    { label: 'The sample database', hint: 'a small demo company, in SQLite' },
    { label: 'My own database', hint: 'a Postgres, MySQL or SQLite URL' },
    { label: 'Decide later', hint: 'set DATABASE_URL in .env' },
  ]);
  if (choice === 0) return { kind: 'sample' };
  if (choice === 2) return { kind: 'later' };
  const url = await io.ask('Database URL', {
    hint: 'postgres://user:password@localhost:5432/shop',
    validate: (answer) => (answer.trim() === '' ? 'Enter a URL.' : dsnProblem(answer.trim())),
  });
  return { kind: 'url', url: url.trim() };
}

/**
 * Make the instance in `root/data` this project's: bring its tables up to
 * date, give its connections keys, name them in `adminium.config.ts` and
 * `.env`, and write its pages and schema customizations as files.
 */
async function adoptInstance(root: string, secret: string, deps: CliDeps, io: CliIo): Promise<void> {
  const env = loadCliEnv({
    ...deps.env,
    ADMINIUM_SECRET: secret,
    ADMINIUM_DATA_DIR: join(root, 'data'),
    // The instance is the one in data/, whatever the shell points at.
    ADMINIUM_META_URL: undefined,
  });
  const runtime = await deps.openRuntime(env);
  try {
    await readyMetaStore({ runtime, env, io, migrate: true });
    let adopted: Awaited<ReturnType<typeof adoptConnections>>;
    try {
      adopted = await adoptConnections(runtime.manager);
    } catch (error) {
      throw new CliError(error instanceof Error ? error.message : String(error));
    }
    if (adopted.length > 0) {
      writeConfig(root, adopted);
      addToDotEnv(
        root,
        adopted.map((database) => ({
          key: database.envVar,
          value: '',
          comment: [`"${database.key}" (${database.name}) is stored in data/ already; set this to replace its URL.`],
        })),
      );
      io.out(`The project's databases: ${adopted.map((database) => `${database.key} (${database.name})`).join(', ')}.`);
    }
    const pulled = await pullProject({ meta: runtime.metaStore.meta, store: diskFileStore(root) });
    io.out(`Wrote ${String(pulled.written.length)} page and schema file(s) from the instance.`);
    for (const page of pulled.outside) io.err(`Left out page "${page.slug}": ${page.reason}.`);
  } finally {
    await runtime.close();
  }
}

function initGit(root: string, run: RunProcess, io: CliIo): void {
  if (run('git', ['--version'], { cwd: root }).status !== 0) return;
  const inside = run('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root });
  if (inside.status === 0 && inside.stdout.trim() === 'true') return;
  if (run('git', ['init', '--quiet'], { cwd: root }).status === 0) {
    io.out('Started a git repository.');
  }
}

export const newCommand: Command = {
  name: 'new',
  summary: 'Create a project folder, or make this folder one',
  usage: 'adminium new [name] [--database <url> | --sample] [--yes]',
  describe:
    'Creates <name>/ with an Adminium project in it, installs its dependencies\n' +
    'and prints how to start it. Without a name, the current folder becomes the\n' +
    'project: missing files are added, package.json and .gitignore are added to,\n' +
    'and nothing that exists is changed.',
  flags: {
    database: {
      type: 'string',
      placeholder: '<url>',
      describe: 'The database the admin is built from (written to .env)',
    },
    sample: { type: 'boolean', describe: 'Create and use a sample SQLite database' },
    yes: { type: 'boolean', short: 'y', describe: 'Answer every question with its default' },
    'no-install': { type: 'boolean', describe: 'Do not install dependencies' },
    'no-git': { type: 'boolean', describe: 'Do not start a git repository' },
    'package-manager': {
      type: 'string',
      placeholder: '<name>',
      describe: `${PACKAGE_MANAGERS.join(', ')}`,
      defaultDescription: 'the one running this command',
    },
    import: {
      type: 'string',
      placeholder: '<folder>',
      describe: 'Copy the instance in this data folder (e.g. ~/.adminium) into the project first',
    },
    adminium: {
      type: 'string',
      placeholder: '<spec>',
      describe: 'Adminium to install: a version, or a tarball path',
      defaultDescription: `${APP_VERSION}, this version`,
    },
  },

  async run({ io, deps, argv }) {
    const { values, positionals } = parseFlags(argv, newCommand.flags, newCommand.name);
    if (positionals.length > 1) {
      throw new CliUsageError('Give one folder name at most.', newCommand.name);
    }
    const run = deps.runProcess ?? defaultRunProcess;
    const cwd = resolve(deps.cwd);
    const nameArg = positionals[0];
    const here = nameArg === undefined || nameArg === '.';
    const root = here ? cwd : resolve(cwd, nameArg);
    const yes = boolFlag(values.yes);

    if (!here) {
      const problem = projectNameProblem(nameArg);
      if (problem !== null) {
        throw new CliUsageError(`"${nameArg}" cannot be a project name: ${problem}.`, newCommand.name);
      }
      if (!isEmptyFolder(root)) {
        throw new CliError(`${nameArg} already exists and is not empty.`, {
          hint: `To add Adminium to that folder, run \`adminium new\` inside it.`,
        });
      }
    } else {
      const refused = refusal(root, homedir());
      if (refused !== null) {
        throw new CliError(refused, { hint: 'Create a folder for it instead:  adminium new my-admin' });
      }
    }
    if (existsSync(root) && configFileIn(root) !== null) {
      throw new CliError(`${here ? 'This folder' : nameArg} is already an Adminium project.`, {
        hint: 'Start it with its dev script, e.g.  npm run dev',
      });
    }

    const pmFlag = stringFlag(values['package-manager']);
    if (pmFlag !== undefined && !isPackageManager(pmFlag)) {
      throw new CliUsageError(
        `--package-manager must be one of ${PACKAGE_MANAGERS.join(', ')} (got "${pmFlag}").`,
        newCommand.name,
      );
    }
    const packageManager: PackageManager = pmFlag ?? detectPackageManager(deps.env);

    const databaseFlag = stringFlag(values.database);
    const sampleFlag = boolFlag(values.sample);
    if (databaseFlag !== undefined && sampleFlag) {
      throw new CliUsageError('--database and --sample both choose the database; pass one.', newCommand.name);
    }
    if (databaseFlag !== undefined) {
      const problem = dsnProblem(databaseFlag);
      if (problem !== null) throw new CliUsageError(`--database: ${problem}`, newCommand.name);
    }
    const specFlag = stringFlag(values.adminium);
    const spec = specFlag === undefined ? APP_VERSION : adminiumSpec(specFlag, cwd);

    if (here && !isEmptyFolder(root) && !yes) {
      if (!io.isInteractive) {
        throw new CliError('This folder is not empty.', {
          hint: 'Adminium only adds files and never changes existing ones. Pass --yes to go ahead.',
        });
      }
      io.out('Adminium will add a project to this folder. It creates missing files, adds to');
      io.out('package.json and .gitignore, and changes nothing else.');
      if (!(await io.confirm('Continue?', true))) throw new CliCancelled();
    }

    const importFlag = stringFlag(values.import);
    const importFrom = importFlag === undefined ? null : expandFolder(importFlag, cwd);
    if (importFrom !== null) {
      if (!holdsInstance(importFrom)) {
        throw new CliError(`${importFlag ?? ''} holds no Adminium instance.`, {
          hint: 'Point --import at a data folder with a meta.db or adminium.json in it, like ~/.adminium.',
        });
      }
      if (holdsInstance(join(root, 'data'))) {
        throw new CliError('data/ already holds an Adminium instance, so there is nowhere to import another.');
      }
    }

    // The secret: keep the one in .env; never mint a new one over an instance.
    const dotenv = existsSync(root) ? readDotEnv(root) : null;
    const hasInstance = importFrom !== null || holdsInstance(join(root, 'data'));
    if (hasInstance && (databaseFlag !== undefined || sampleFlag)) {
      throw new CliError('The project takes its databases from the existing instance.', {
        hint: 'Leave out --database and --sample; add more databases in adminium.config.ts afterwards.',
      });
    }
    let secret: string | null = null;
    if ((dotenv?.ADMINIUM_SECRET ?? '') === '') {
      const inherited = deps.env.ADMINIUM_SECRET?.trim() ?? '';
      if (!hasInstance) {
        secret = randomBytes(32).toString('hex');
      } else if (inherited.length >= 16) {
        secret = inherited;
        io.out('data/ holds an Adminium instance; its ADMINIUM_SECRET was taken from your environment.');
      } else if (io.isInteractive) {
        secret = (
          await io.ask('data/ holds an Adminium instance. Enter the ADMINIUM_SECRET it was created with', {
            mask: true,
            validate: (answer) => (answer.trim().length >= 16 ? null : 'It is at least 16 characters long.'),
          })
        ).trim();
      } else {
        throw new CliError('data/ holds an Adminium instance, and .env has no ADMINIUM_SECRET for it.', {
          hint:
            'Put the secret it was created with in .env (ADMINIUM_SECRET=…) or the environment, and run this\n' +
            'again. A new secret would make its stored connection strings unreadable.',
        });
      }
    }

    let database: DatabaseChoice;
    if (databaseFlag !== undefined) database = { kind: 'url', url: databaseFlag };
    else if (sampleFlag) database = { kind: 'sample' };
    else if (yes || hasInstance || !io.isInteractive) database = { kind: 'later' };
    else database = await chooseDatabase(io);

    const result = scaffoldProject({
      root,
      packageName: here ? packageNameFor(basename(root)) : nameArg,
      adminiumSpec: spec,
      version: APP_VERSION,
      packageManager,
    });

    const databaseUrl = database.kind === 'url' ? database.url : database.kind === 'sample' ? SAMPLE_URL : '';
    const dotenvResult = addToDotEnv(root, [
      ...(secret === null
        ? []
        : [
            {
              key: 'ADMINIUM_SECRET',
              value: secret,
              comment: ['Encrypts every stored connection string. Keep a copy somewhere safe, and never change it.'],
            },
          ]),
      {
        key: 'DATABASE_URL',
        value: databaseUrl,
        comment: ['The database the admin is built from; adminium.config.ts reads it.'],
      },
    ]);
    if (dotenvResult.kept.includes('DATABASE_URL') && database.kind !== 'later') {
      io.err('.env already sets DATABASE_URL, so it was kept. Change it there to use a different database.');
    }

    if (database.kind === 'sample') {
      const file = join(root, SAMPLE_DATABASE);
      if (existsSync(file)) {
        io.out(`${SAMPLE_DATABASE} already exists; it was kept.`);
      } else {
        const counts = await createSampleDatabase(file);
        const rows = Object.values(counts).reduce((sum, n) => sum + n, 0);
        io.out(`Created the sample database, ${SAMPLE_DATABASE} (${String(rows)} rows).`);
      }
    }

    if (hasInstance) {
      if (importFrom !== null) {
        importInstance(importFrom, join(root, 'data'));
        io.out(`Copied the instance in ${importFrom} into data/.`);
      }
      await adoptInstance(root, secret ?? dotenv?.ADMINIUM_SECRET ?? '', deps, io);
    }

    if (!boolFlag(values['no-git'])) initGit(root, run, io);

    let installed: boolean | null = null;
    if (!boolFlag(values['no-install'])) {
      const { command, args } = installCommand(packageManager);
      io.out(`Installing dependencies with ${command}…`);
      installed = run(command, args, { cwd: root, inherit: true }).status === 0;
      if (!installed) io.err(`\`${command} ${args.join(' ')}\` failed. Fix the problem above and run it again.`);
    }

    const env = [...dotenvResult.written.map((key) => `.env (${key})`)];
    io.out('');
    io.out(here ? 'This folder is now an Adminium project.' : `Created ${nameArg}.`);
    if (result.created.length > 0) io.out(`  Added:       ${result.created.join(', ')}`);
    if (result.merged.length > 0) io.out(`  Added to:    ${result.merged.join(', ')}`);
    if (env.length > 0) io.out(`  Wrote:       ${env.join(', ')}`);
    if (result.skipped.length > 0) io.out(`  Left alone:  ${result.skipped.join(', ')}`);
    for (const note of result.notes) io.out(`  ${note}`);
    io.out('');
    io.out('Next:');
    if (!here) io.out(`  cd ${nameArg}`);
    if (installed !== true) io.out(`  ${installCommand(packageManager).command} install`);
    if (database.kind === 'later' && !hasInstance) io.out('  set DATABASE_URL in .env');
    io.out(`  ${runScript(packageManager, result.scripts.dev)}`);
    return installed === false ? EXIT_ERROR : EXIT_OK;
  },
};
