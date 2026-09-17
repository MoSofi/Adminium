// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `adminium dev` — run the project, restart it when its settings change, and
 * rebuild its hooks and actions when they change.
 */

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SERVER_CODE_FOLDERS,
  buildProject,
  hasProjectCode,
  loadProjectBundler,
  readBuildManifest,
  rebuildClientCode,
  rebuildServerCode,
} from '../../project/build.js';
import { CLIENT_CODE_FOLDERS } from '../../project/client-build.js';
import { createDevSupervisor, fingerprint, type DevChild } from '../../project/dev.js';
import { DOTENV_FILE } from '../../project/dotenv.js';
import { findProject, type ProjectLocation } from '../../project/locate.js';
import { APP_VERSION } from '../../version.js';
import { numberFlag, parseFlags, stringFlag } from '../args.js';
import type { Command } from '../command.js';
import { CliError, EXIT_OK } from '../exit.js';

/** The CLI entry, run again as the server child. */
const CLI_ENTRY = fileURLToPath(new URL('../index.js', import.meta.url));

/**
 * Build when esbuild is there. A plain JavaScript config with no hooks,
 * actions, pages or widgets also runs without it.
 */
async function buildIfNeeded(project: ProjectLocation): Promise<void> {
  const bundler = await loadProjectBundler(project.root);
  if (bundler === null && ['.js', '.mjs'].includes(extname(project.configFile)) && !hasProjectCode(project)) {
    return;
  }
  await buildProject(project, { version: APP_VERSION, loadBundler: async () => bundler, dev: true });
}

/** The hook and action folders, and every file their build read. */
function codeWatched(project: ProjectLocation): string[] {
  const inputs = Object.keys(readBuildManifest(project)?.server?.inputs ?? {}).map((path) =>
    resolve(project.root, path),
  );
  return [...new Set([...SERVER_CODE_FOLDERS.map((folder) => join(project.root, folder)), ...inputs])];
}

/** The page and widget folders, and every file their build read. */
function clientWatched(project: ProjectLocation): string[] {
  const inputs = Object.keys(readBuildManifest(project)?.client?.inputs ?? {}).map((path) =>
    resolve(project.root, path),
  );
  return [...new Set([...CLIENT_CODE_FOLDERS.map((folder) => join(project.root, folder)), ...inputs])];
}

/**
 * A page or widget folder changes when a code file is added or removed.
 * Studio writes page files (`.json`) into `pages/` all the time in dev, and
 * those are the project sync's business, not a reason to rebuild code. A
 * folder that does not exist yet reads as an empty one, so the sync creating
 * `pages/` for the first page files rebuilds nothing either.
 */
function clientFingerprintIn(project: ProjectLocation): (path: string) => string {
  const folders = new Set(CLIENT_CODE_FOLDERS.map((folder) => join(project.root, folder)));
  return (path) => (folders.has(path) && !existsSync(path) ? 'folder:' : clientFingerprint(path));
}

function clientFingerprint(path: string): string {
  let folder = false;
  try {
    folder = existsSync(path) && statSync(path).isDirectory();
  } catch {
    folder = false;
  }
  if (!folder) return fingerprint(path);
  const names = readdirSync(path)
    .filter((name) => /\.[cm]?[jt]sx?$/.test(name))
    .sort();
  return `folder:${names.join('/')}`;
}

function watchedFiles(project: ProjectLocation): string[] {
  const inputs = Object.keys(readBuildManifest(project)?.config.inputs ?? {}).map((path) =>
    resolve(project.root, path),
  );
  return [...new Set([project.configFile, join(project.root, DOTENV_FILE), ...inputs])];
}

export const devCommand: Command = {
  name: 'dev',
  summary: 'Run the project, restarting when its config or .env changes',
  usage: 'adminium dev [--port <n>] [--host <addr>]',
  describe:
    'Builds the project and runs `adminium start` for it. When adminium.config.ts,\n' +
    'a file it imports, or .env changes, it builds again and restarts the server.\n' +
    'A change to hooks/ or actions/ rebuilds them and swaps them in without a\n' +
    'restart; a change to a page or widget rebuilds it, and open dashboards\n' +
    'load the new version. Stop it with Ctrl-C.',
  flags: {
    port: { type: 'string', short: 'p', placeholder: '<n>', describe: 'Port to listen on', defaultDescription: 'PORT or 4600' },
    host: { type: 'string', placeholder: '<addr>', describe: 'Address to bind', defaultDescription: 'HOST or 0.0.0.0' },
    'log-level': {
      type: 'string',
      placeholder: '<level>',
      describe: 'fatal|error|warn|info|debug|trace',
      defaultDescription: 'ADMINIUM_LOG_LEVEL or info',
    },
  },

  async run({ io, deps, argv }) {
    const { values } = parseFlags(argv, devCommand.flags, devCommand.name);
    const port = numberFlag(values.port, 'port', devCommand.name);
    const host = stringFlag(values.host);
    const logLevel = stringFlag(values['log-level']);
    const project = findProject(deps.cwd, deps.env);
    if (project === null) {
      throw new CliError('adminium dev runs inside a project, and this folder is not in one.', {
        hint: 'Create one with  adminium new <name>',
      });
    }

    const forwarded = [
      ...(port === undefined ? [] : ['--port', String(port)]),
      ...(host === undefined ? [] : ['--host', host]),
      ...(logLevel === undefined ? [] : ['--log-level', logLevel]),
    ];
    // The child is `start` with the folder as the master copy of pages and
    // schema customizations (`ADMINIUM_PROJECT_MODE=dev`).
    const env = { ...deps.env, ADMINIUM_PROJECT_DIR: project.root, ADMINIUM_PROJECT_MODE: 'dev' };

    const supervisor = createDevSupervisor({
      watched: () => watchedFiles(project),
      build: () => buildIfNeeded(project),
      code: {
        label: 'hooks and actions',
        watched: () => codeWatched(project),
        rebuild: async () => {
          const server = await rebuildServerCode(project, {});
          io.out(`Rebuilt ${String(server.files.length)} hook and action file(s).`);
        },
      },
      client: {
        label: 'pages and widgets',
        watched: () => clientWatched(project),
        fingerprint: clientFingerprintIn(project),
        rebuild: async () => {
          const client = await rebuildClientCode(project, { dev: true });
          io.out(
            `Rebuilt ${String(client.pages.length)} page(s) and ${String(client.widgets.length)} widget(s); open dashboards reload them.`,
          );
        },
      },
      spawnServer: (): DevChild => {
        const args = ['start', ...forwarded];
        if (deps.spawnDevServer !== undefined) return deps.spawnDevServer(args, { cwd: project.root, env });
        const child = spawn(process.execPath, [CLI_ENTRY, ...args], {
          cwd: project.root,
          env,
          stdio: 'inherit',
        });
        return {
          kill: (signal) => {
            child.kill(signal);
          },
          onExit: (listener) => {
            child.once('exit', listener);
          },
        };
      },
      log: (message) => {
        io.out(message);
      },
      warn: (message) => {
        io.err(message);
      },
    });

    const stop = (): void => {
      void supervisor.stop();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    deps.signal?.addEventListener('abort', stop, { once: true });
    try {
      io.out(`Running ${project.root} in development. Ctrl-C stops it.`);
      await supervisor.run();
    } finally {
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
      deps.signal?.removeEventListener('abort', stop);
    }
    return EXIT_OK;
  },
};
