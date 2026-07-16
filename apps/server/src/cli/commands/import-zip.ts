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

import { ImportZipError } from '../../export/import-service.js';
import { boolFlag, parseFlags, stringFlag } from '../args.js';
import type { Command } from '../command.js';
import { CliError, CliUsageError, EXIT_OK } from '../exit.js';
import { loadCliEnv } from '../runtime.js';

export const importZipCommand: Command = {
  name: 'import-zip',
  summary: 'Import an instance configuration bundle',
  usage: 'adminium import-zip --in <file> [--dry-run]',
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
    'and connections need their connection string re-entered afterwards.',
  flags: {
    in: {
      type: 'string',
      short: 'i',
      placeholder: '<file>',
      describe: 'Bundle to import',
    },
    'dry-run': {
      type: 'boolean',
      describe: 'Validate and report without writing',
      defaultDescription: 'off',
    },
    'data-dir': { type: 'string', placeholder: '<path>', describe: 'Data directory' },
    'meta-url': { type: 'string', placeholder: '<dsn>', describe: 'Meta store DSN' },
  },

  async run({ io, deps, argv }) {
    const { values } = parseFlags(argv, importZipCommand.flags, importZipCommand.name);
    const input = stringFlag(values.in);
    if (input === undefined) {
      throw new CliUsageError('--in <file> is required.', importZipCommand.name);
    }
    const dryRun = boolFlag(values['dry-run']);
    const dataDir = stringFlag(values['data-dir']);
    const metaUrl = stringFlag(values['meta-url']);

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
