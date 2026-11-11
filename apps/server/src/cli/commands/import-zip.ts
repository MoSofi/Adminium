// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `adminium import-zip` — restore an instance's configuration from a bundle.
 *
 * The other front door onto `src/export/import-service.ts`, exactly as
 * `export-zip` is onto `zip-service.ts`: the flags and the reporting live here,
 * the semantics live in the service, and a future Studio upload route calls the
 * same service rather than growing a second copy of the replay rules.
 *
 * `--dry-run` mirrors `apply-llm-response`: validate and report, write nothing.
 */

import { resolve } from 'node:path';

import { isInstanceArchive } from '../../archive/zip-read.js';
import { ImportZipError } from '../../export/import-service.js';
import { boolFlag, parseFlags, stringFlag } from '../args.js';
import type { Command } from '../command.js';
import { CliError, CliUsageError, EXIT_OK } from '../exit.js';
import { loadCliEnv } from '../runtime.js';
import { importExportFile } from './archive/commands.js';

export const importZipCommand: Command = {
  name: 'import-zip',
  summary: 'Import an instance configuration bundle',
  usage: 'adminium import-zip <file> [--dry-run] [--owner <email>] [--password-stdin]',
  describe:
    'Restores configuration produced by `adminium export-zip` — connections,\n' +
    'snapshots, overrides, pages and dashboards, views, settings, roles.\n' +
    '\n' +
    'The meta-store migrations run first, then every config document is replayed\n' +
    'forward to the version this build understands, so a bundle exported by an\n' +
    'older Adminium imports cleanly. A bundle from a NEWER Adminium is refused\n' +
    'rather than partially read.\n' +
    '\n' +
    'Bundles carry configuration, not source code and not your database contents.\n' +
    'Unless the bundle was exported with --include-secrets it has no credentials,\n' +
    'and connections need their connection string re-entered afterwards.\n' +
    '\n' +
    'An "Export everything" file (from Studio, or `adminium archive create --export`)\n' +
    'is restored whole into a FRESH instance: pages, people, uploads, the project\n' +
    'folder. It carries no passwords, so the import gives one of its Super Admins a\n' +
    'new password: --owner picks who (needed without a terminal when it holds more\n' +
    'than one), the password is asked twice, or read from the first line of\n' +
    'standard input with --password-stdin.',
  flags: {
    in: {
      type: 'string',
      short: 'i',
      placeholder: '<file>',
      describe: 'Bundle to import (or name it on its own)',
    },
    'dry-run': {
      type: 'boolean',
      describe: 'Validate and report without writing',
      defaultDescription: 'off',
    },
    'data-dir': {
      type: 'string',
      placeholder: '<path>',
      describe: 'Data directory',
      defaultDescription: 'ADMINIUM_DATA_DIR, else ./data or ~/.adminium',
    },
    'meta-url': { type: 'string', placeholder: '<dsn>', describe: 'Meta store DSN' },
    'project-dir': {
      type: 'string',
      placeholder: '<folder>',
      describe: 'Where an export file’s project folder goes (new or empty)',
      defaultDescription: 'ADMINIUM_PROJECT_DIR',
    },
    owner: {
      type: 'string',
      placeholder: '<email>',
      describe: 'Export file: the Super Admin who gets a new password',
      defaultDescription: 'the only or first Super Admin',
    },
    'password-stdin': {
      type: 'boolean',
      describe: 'Export file: read that password from standard input',
      defaultDescription: 'off',
    },
  },

  async run({ io, deps, argv }) {
    const { values, positionals } = parseFlags(argv, importZipCommand.flags, importZipCommand.name);
    const named = stringFlag(values.in);
    if (positionals.length > 1 || (named !== undefined && positionals.length > 0)) {
      throw new CliUsageError('Name one file to import.', importZipCommand.name);
    }
    const input = named ?? positionals[0];
    if (input === undefined) {
      throw new CliUsageError('Name the file to import: adminium import-zip <file>', importZipCommand.name);
    }
    const dryRun = boolFlag(values['dry-run']);
    const dataDir = stringFlag(values['data-dir']);
    const metaUrl = stringFlag(values['meta-url']);

    // "Export everything" (`adminium archive create --export`) is an instance
    // archive, not a config bundle: the archive restore reads it, with the
    // export's rules (no hashes, secrets or tokens), into a fresh instance.
    if (await isInstanceArchive(resolve(deps.cwd, input))) {
      return importExportFile({ io, deps }, resolve(deps.cwd, input), {
        dryRun,
        dataDir,
        metaUrl,
        projectDir: stringFlag(values['project-dir']),
        ownerEmail: stringFlag(values.owner),
        passwordStdin: boolFlag(values['password-stdin']),
      });
    }

    const env = loadCliEnv(deps.env, {
      ...(dataDir === undefined ? {} : { dataDir }),
      ...(metaUrl === undefined ? {} : { metaUrl }),
    });
    const runtime = await deps.openRuntime(env);

    try {
      const result = await deps.importZip({
        meta: runtime.metaStore.meta,
        inPath: resolve(deps.cwd, input),
        dryRun,
      });

      const { manifest } = result;
      io.out(
        `Bundle from Adminium ${manifest.appVersion} ` +
          `(config v${String(manifest.configVersion)}, meta ${manifest.metaVersion}).`,
      );
      const counts = Object.entries(result.counts).filter(([, value]) => value > 0);
      if (counts.length > 0) {
        io.out(counts.map(([key, value]) => `${key}: ${String(value)}`).join(' · '));
      }
      if (result.migratedDocuments > 0) {
        io.out(
          `Replayed ${String(result.migratedDocuments)} config document(s) forward to this build's version.`,
        );
      }
      for (const warning of result.warnings) io.err(warning);
      io.out(dryRun ? 'Dry run — nothing was written.' : 'Import complete.');
      return EXIT_OK;
    } catch (error) {
      if (error instanceof ImportZipError) {
        throw new CliError(error.message, {
          ...(error.hint === undefined ? {} : { hint: error.hint }),
          cause: error,
        });
      }
      throw error;
    } finally {
      await runtime.close();
    }
  },
};
