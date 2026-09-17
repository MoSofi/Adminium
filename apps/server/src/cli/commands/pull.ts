// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `adminium pull [--from <url>]` — write pages and schema customizations into
 * the project folder.
 *
 * Without `--from` it writes what this project's own database says: every
 * page and schema file, and it deletes the files of pages that are gone. That
 * is how an existing instance's pages first become files.
 *
 * With `--from` it asks a server running this project for what was changed
 * there (`GET /api/v1/project/export`, authenticated with `ADMINIUM_API_KEY`)
 * and writes only those files. The server is not changed: its "changed on
 * server" flags clear when the pulled files are deployed back to it.
 */

import type { z } from 'zod';

import { prepareProject } from '../../project/boot.js';
import { readDotEnv } from '../../project/dotenv.js';
import { diskFileStore } from '../../project/file-store.js';
import { parseJsonText } from '../../project/json.js';
import { findProject } from '../../project/locate.js';
import { parseProjectPath } from '../../project/paths.js';
import { pullProject } from '../../project/reconcile.js';
import { projectExportReply } from '../../routes/project/index.js';
import { APP_VERSION } from '../../version.js';
import { parseFlags, stringFlag } from '../args.js';
import type { Command } from '../command.js';
import { CliError, EXIT_OK, type ExitCode } from '../exit.js';
import type { CliIo } from '../io.js';
import { readyMetaStore } from '../project-store.js';
import { loadCliEnv, type CliDeps } from '../runtime.js';

const STATUS_NOTE = {
  'changed-on-server': 'changed on the server',
  conflict: 'changed on the server and in the project; check `git diff`',
  'not-in-project': 'made on the server',
} as const;

function printOutside(io: CliIo, outside: readonly { slug: string; reason: string }[]): void {
  for (const page of outside) io.err(`Left out page "${page.slug}": ${page.reason}.`);
}

async function pullLocal(io: CliIo, deps: CliDeps): Promise<ExitCode> {
  const prepared = await prepareProject({ cwd: deps.cwd, env: deps.env, version: APP_VERSION });
  if (prepared === null) throw new CliError('adminium pull runs inside a project, and this folder is not in one.');
  const env = loadCliEnv(prepared.env, {}, prepared.sources);
  const runtime = await deps.openRuntime(env);
  try {
    await readyMetaStore({ runtime, env, io, migrate: false });
    const report = await pullProject({ meta: runtime.metaStore.meta, store: diskFileStore(prepared.project.root) });
    for (const path of report.written) io.out(`Wrote ${path}`);
    for (const path of report.deletedFiles) io.out(`Deleted ${path} (gone from the database)`);
    for (const path of report.notApplied) io.err(`Kept ${path}: the database has not seen it yet; \`npm run dev\` applies it.`);
    printOutside(io, report.outside);
    if (report.written.length + report.deletedFiles.length === 0) io.out('The project files already match the database.');
    return EXIT_OK;
  } finally {
    await runtime.close();
  }
}

const exportBody = projectExportReply;
type ExportData = z.infer<typeof exportBody>['data'];

async function fetchChanges(url: string, key: string, deps: CliDeps): Promise<ExportData> {
  const doFetch = deps.fetch ?? fetch;
  const endpoint = `${url.replace(/\/+$/, '')}/api/v1/project/export`;
  let response: Response;
  try {
    response = await doFetch(endpoint, { headers: { authorization: `Bearer ${key}`, accept: 'application/json' } });
  } catch (error) {
    throw new CliError(`Could not reach ${endpoint}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (response.status === 401) {
    throw new CliError('The server did not accept ADMINIUM_API_KEY.', {
      hint: 'Check the key in .env; it may have been revoked or have expired.',
    });
  }
  if (response.status === 403) {
    throw new CliError('ADMINIUM_API_KEY may not read this project.', {
      hint: 'Give the key a role with "Read pages and schema changes for a project pull" (Admin has it).',
    });
  }
  if (response.status === 404) {
    throw new CliError(`${url} does not serve an Adminium project.`, {
      hint: 'Pull from the server this project is deployed to. Servers older than 0.2.10 have no project export.',
    });
  }
  if (!response.ok) throw new CliError(`${endpoint} answered ${String(response.status)}.`);
  const parsed = exportBody.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new CliError(`${endpoint} did not answer with a project export.`);
  return parsed.data.data;
}

async function pullFrom(io: CliIo, deps: CliDeps, from: string): Promise<ExitCode> {
  const project = findProject(deps.cwd, deps.env);
  if (project === null) throw new CliError('adminium pull runs inside a project, and this folder is not in one.');
  const key = deps.env.ADMINIUM_API_KEY?.trim() || readDotEnv(project.root)?.ADMINIUM_API_KEY?.trim() || '';
  if (key === '') {
    throw new CliError('pull --from needs an API key for that server.', {
      hint:
        'Create one in Studio → Settings → API keys, with a role that may read the project (Admin can),\n' +
        'and put it in .env as ADMINIUM_API_KEY=adm_sk_…',
    });
  }

  const data = await fetchChanges(from, key, deps);
  if (data.version !== APP_VERSION) {
    io.err(`The server runs Adminium ${data.version}, and this project ${APP_VERSION}. Keep them equal when you deploy.`);
  }
  const store = diskFileStore(project.root);
  let changed = 0;
  for (const change of data.changes) {
    const kind = parseProjectPath(change.path);
    if (kind === null || !kind.valid) {
      io.err(`Skipped ${change.path}: not a page or schema file.`);
      continue;
    }
    if (change.content === null) {
      await store.remove(change.path);
      io.out(`Deleted ${change.path} (deleted on the server)`);
      changed += 1;
      continue;
    }
    if (!parseJsonText(change.content).ok) {
      io.err(`Skipped ${change.path}: the server sent something that is not JSON.`);
      continue;
    }
    await store.write(change.path, change.content);
    io.out(`Wrote ${change.path} (${STATUS_NOTE[change.status]})`);
    changed += 1;
  }
  printOutside(io, data.outside);
  if (changed === 0) {
    io.out('Nothing to pull: the server matches the files it was deployed with.');
  } else {
    io.out('');
    io.out('Commit the files and deploy them; the server clears its "changed on server" notes then.');
  }
  return EXIT_OK;
}

export const pullCommand: Command = {
  name: 'pull',
  summary: 'Write pages and schema changes into the project',
  usage: 'adminium pull [--from <url>]',
  describe:
    "Writes the project's page and schema files from its own database. With\n" +
    '--from, asks a server running this project for what was changed there and\n' +
    'writes those files instead; that needs ADMINIUM_API_KEY. Neither changes a\n' +
    'page.',
  flags: {
    from: {
      type: 'string',
      placeholder: '<url>',
      describe: 'A server running this project, e.g. https://admin.example.com',
    },
  },

  async run({ io, deps, argv }) {
    const { values } = parseFlags(argv, pullCommand.flags, pullCommand.name);
    const from = stringFlag(values.from);
    return from === undefined ? pullLocal(io, deps) : pullFrom(io, deps, from);
  },
};
