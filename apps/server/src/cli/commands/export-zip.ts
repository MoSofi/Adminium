/**
 * `adminium export-zip` — bundle the instance's server + configuration.
 *
 * The flags, the resolution of configuration, and the reporting are here; the
 * bundling itself lives behind the `src/export/zip-service.ts` `exportZip(opts)`
 * contract, so a future Studio download route produces byte-identical bundles
 * by calling the same service. `adminium import-zip` is the inverse.
 *
 * The distinction the docs insist on and this command's copy repeats: the export
 * is **server + config, not source code** (BRIEF §3). Adminium interprets
 * configuration at runtime; it never emits an app.
 */

import { resolve } from 'node:path';

import { PlaintextSecretError } from '../../export/redaction.js';
import { APP_VERSION } from '../../version.js';
import { boolFlag, parseFlags, stringFlag } from '../args.js';
import type { Command } from '../command.js';
import { CliError, EXIT_OK } from '../exit.js';
import { loadCliEnv } from '../runtime.js';

/** Human-readable size for the summary line. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit] ?? 'GB'}`;
}

export const exportZipCommand: Command = {
  name: 'export-zip',
  summary: 'Export the instance configuration as a runnable bundle',
  usage: 'adminium export-zip [--connection <id>] [--out <file>] [--include-secrets]',
  describe:
    'Bundles the server plus its configuration — connections, snapshots,\n' +
    'overrides, pages and dashboards, views, settings, roles — so it can be\n' +
    'restored or replayed elsewhere.\n' +
    '\n' +
    'This is configuration, not source code: Adminium interprets it at runtime\n' +
    'and does not emit a generated app. Secrets are excluded unless you ask for\n' +
    'them with --include-secrets.',
  flags: {
    connection: {
      type: 'string',
      short: 'c',
      placeholder: '<id>',
      describe: 'Export only this connection',
      defaultDescription: 'the whole instance',
    },
    out: {
      type: 'string',
      short: 'o',
      placeholder: '<file>',
      describe: 'Destination archive path',
      defaultDescription: './adminium-export.zip',
    },
    'include-secrets': {
      type: 'boolean',
      describe: 'Include encrypted DSNs and provider keys in the bundle',
      defaultDescription: 'off',
    },
    'data-dir': { type: 'string', placeholder: '<path>', describe: 'Data directory' },
    'meta-url': { type: 'string', placeholder: '<dsn>', describe: 'Meta store DSN' },
  },

  async run({ io, deps, argv }) {
    const { values } = parseFlags(argv, exportZipCommand.flags, exportZipCommand.name);
    const connectionId = stringFlag(values.connection);
    const out = stringFlag(values.out) ?? './adminium-export.zip';
    const dataDir = stringFlag(values['data-dir']);
    const metaUrl = stringFlag(values['meta-url']);

    const env = loadCliEnv(deps.env, {
      ...(dataDir === undefined ? {} : { dataDir }),
      ...(metaUrl === undefined ? {} : { metaUrl }),
    });
    const runtime = await deps.openRuntime(env);

    try {
      const result = await deps.exportZip({
        meta: runtime.metaStore.meta,
        ...(connectionId === undefined ? {} : { connectionId }),
        outPath: resolve(deps.cwd, out),
        includeSecrets: boolFlag(values['include-secrets']),
        dataDir: env.ADMINIUM_DATA_DIR,
        appVersion: APP_VERSION,
      });

      io.out(`Wrote ${result.path} (${formatBytes(result.bytes)}, ${String(result.entries.length)} entries).`);
      const counts = Object.entries(result.counts);
      if (counts.length > 0) {
        io.out(counts.map(([key, value]) => `${key}: ${String(value)}`).join(' · '));
      }
      if (boolFlag(values['include-secrets'])) {
        io.err(
          'This bundle contains encrypted secrets — treat it as sensitive. They only decrypt ' +
            'under this instance\'s ADMINIUM_SECRET.',
        );
      }
      return EXIT_OK;
    } catch (error) {
      // The export refused to write a value that should have been ciphertext.
      // Surface it as a first-class failure rather than a stack trace: it means
      // something upstream stored a secret in plaintext.
      if (error instanceof PlaintextSecretError) {
        throw new CliError(error.message, { cause: error });
      }
      throw error;
    } finally {
      await runtime.close();
    }
  },
};
