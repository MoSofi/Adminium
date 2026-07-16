/**
 * `adminium introspect` — introspect a connection and print/persist the snapshot.
 *
 * Calls `runIntrospection` (src/connections/introspect.ts), which is the same
 * function `POST /api/v1/connections/:id/introspect` runs — synchronously here,
 * as an `introspect` job there. Snapshot creation, checksum de-duplication, and
 * the auto-proposed PII masks are that pipeline's behavior, inherited whole.
 */

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { runIntrospection } from '../../connections/introspect.js';
import { numberFlag, parseFlags, stringFlag } from '../args.js';
import type { Command } from '../command.js';
import { CliError, EXIT_OK } from '../exit.js';
import { loadCliEnv } from '../runtime.js';

/** Table count off the stored model (the same shape the connections route reads). */
function tableCount(schema: unknown): number | null {
  if (schema === null || typeof schema !== 'object') return null;
  const tables = (schema as { tables?: unknown }).tables;
  return Array.isArray(tables) ? tables.length : null;
}

export const introspectCommand: Command = {
  name: 'introspect',
  summary: 'Introspect a connection and store the schema snapshot',
  usage: 'adminium introspect --connection <id> [--out <file>]',
  describe:
    'Reads the source database schema — never its rows — classifies it, and\n' +
    'stores a snapshot. Re-running with an unchanged schema is a no-op: the\n' +
    'checksum matches and no new snapshot is written.',
  flags: {
    connection: {
      type: 'string',
      short: 'c',
      placeholder: '<id>',
      describe: 'Connection id to introspect (required)',
    },
    out: {
      type: 'string',
      short: 'o',
      placeholder: '<file>',
      describe: 'Also write the snapshot schema to this JSON file',
    },
    timeout: {
      type: 'string',
      placeholder: '<ms>',
      describe: 'Introspection budget in milliseconds',
      defaultDescription: '30000',
    },
    'data-dir': { type: 'string', placeholder: '<path>', describe: 'Data directory' },
    'meta-url': { type: 'string', placeholder: '<dsn>', describe: 'Meta store DSN' },
  },

  async run({ io, deps, argv }) {
    const { values } = parseFlags(argv, introspectCommand.flags, introspectCommand.name);
    const connectionId = stringFlag(values.connection);
    if (connectionId === undefined) {
      throw new CliError('--connection <id> is required.', {
        hint: 'List your connections in Studio, or check `adminium introspect --help`.',
      });
    }
    const timeoutMs = numberFlag(values.timeout, 'timeout', introspectCommand.name);
    const dataDir = stringFlag(values['data-dir']);
    const metaUrl = stringFlag(values['meta-url']);

    const env = loadCliEnv(deps.env, {
      ...(dataDir === undefined ? {} : { dataDir }),
      ...(metaUrl === undefined ? {} : { metaUrl }),
    });
    const runtime = await deps.openRuntime(env);

    try {
      const result = await runIntrospection({
        manager: runtime.manager,
        meta: runtime.metaStore.meta,
        connectionId,
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
      });

      const count = tableCount(result.snapshot.schema);
      if (result.noop) {
        io.out(
          `Schema unchanged — kept snapshot ${result.snapshot.id}` +
            `${count === null ? '' : ` (${String(count)} tables)`}.`,
        );
      } else {
        io.out(
          `Snapshot ${result.snapshot.id} stored` +
            `${count === null ? '' : ` — ${String(count)} tables`}` +
            `, checksum ${result.snapshot.checksum.slice(0, 12)}.`,
        );
        if (result.proposedMasks > 0) {
          io.out(`Proposed ${String(result.proposedMasks)} PII mask override(s) — masking is on by default.`);
        }
      }

      const out = stringFlag(values.out);
      if (out !== undefined) {
        const path = resolve(deps.cwd, out);
        await writeFile(path, `${JSON.stringify(result.snapshot.schema, null, 2)}\n`, 'utf8');
        io.out(`Wrote ${path}`);
      }
      return EXIT_OK;
    } finally {
      await runtime.close();
    }
  },
};
