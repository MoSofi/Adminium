// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `adminium check-source` — can this database be the user's own in a trial,
 * and which tables does it have? (`connections/check-source.ts` holds the
 * rules and the answer's shape.)
 *
 * The connection string comes on stdin, one line, never as an argument: an
 * argument is visible to every process on the machine (`ps`). Needs no meta
 * store and no `ADMINIUM_SECRET`; reads `ADMINIUM_DATABASE_DENY_ADDRESSES` when
 * it is set. Prints exactly one JSON line on stdout, and nothing else there.
 *
 * Exit codes: 0 when the class is `ok`, 1 for every other class (the JSON says
 * which), 78 when `ADMINIUM_DATABASE_DENY_ADDRESSES` does not parse.
 */
import { adapterRegistry } from '@adminium/engine/adapter';

import { checkSource, type CheckSourceOptions, type CheckSourceResult } from '../../connections/check-source.js';
import { registerAdapters } from '../../connections/register-adapters.js';
import { parseDenyAddresses } from '../../connections/user-host.js';
import type { Command, CommandContext } from '../command.js';
import { parseFlags } from '../args.js';
import { CliError, EXIT_CONFIG, EXIT_ERROR, EXIT_OK, type ExitCode } from '../exit.js';

/** The most stdin read: a connection string is far shorter. */
const MAX_INPUT_BYTES = 8 * 1024;

/** stdin, to its end or {@link MAX_INPUT_BYTES}. */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin as AsyncIterable<Buffer | string>) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    size += buffer.length;
    if (size > MAX_INPUT_BYTES) break;
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** The one connection string: the first line with anything on it. Null for none, or for more than one. */
export function oneDsn(input: string): string | null {
  const lines = input
    .slice(0, MAX_INPUT_BYTES)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.length === 1 ? (lines[0] ?? null) : null;
}

/** The command's work, stdin given: for tests, and for the command itself. */
export async function runCheckSource(
  ctx: Pick<CommandContext, 'io' | 'deps'>,
  input: string,
  seams: Pick<CheckSourceOptions, 'lookup' | 'registry' | 'testListedHosts' | 'deadlineMs'> = {},
): Promise<{ code: ExitCode; result: CheckSourceResult }> {
  const rawDeny = ctx.deps.env.ADMINIUM_DATABASE_DENY_ADDRESSES?.trim() ?? '';
  const deny = rawDeny === '' ? { ok: true as const, ranges: [] } : parseDenyAddresses(rawDeny);
  if (!deny.ok) {
    throw new CliError('ADMINIUM_DATABASE_DENY_ADDRESSES is not a list of IP addresses or CIDR ranges.', { code: EXIT_CONFIG });
  }
  const dsn = oneDsn(input);
  const result: CheckSourceResult =
    dsn === null
      ? { ok: false, class: 'refused-by-us', engine: null, version: null, tables: [], schemas: [] }
      : await checkSource(dsn, { denyAddresses: deny.ranges, ...seams });
  ctx.io.out(JSON.stringify(result));
  return { code: result.ok ? EXIT_OK : EXIT_ERROR, result };
}

export const checkSourceCommand: Command = {
  name: 'check-source',
  summary: 'Check a database for a trial: reachable, allowed, and its tables (connection string on stdin)',
  usage: 'adminium check-source < dsn.txt',
  describe:
    'Reads one connection string from stdin and checks it as a trial would\n' +
    'connect it: a database port, public addresses only (none in\n' +
    'ADMINIUM_DATABASE_DENY_ADDRESSES), TLS by default. Reads the catalog\n' +
    'only, never a row, within 15 seconds. Prints one JSON line:\n' +
    '{ok, class, engine, version, tables, schemas}. Exit 0 when the class is\n' +
    'ok, 1 otherwise.',
  flags: {},
  hidden: true,
  async run({ io, deps, argv }: CommandContext): Promise<ExitCode> {
    parseFlags(argv, this.flags, 'check-source');
    await registerAdapters(adapterRegistry);
    const { code } = await runCheckSource({ io, deps }, await readStdin());
    return code;
  },
};
