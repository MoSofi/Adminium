/**
 * The command contract + `--help` rendering.
 *
 * Help text is DERIVED from each command's {@link FlagSpecs}, never written
 * twice: a flag that exists is documented, and a documented flag exists.
 */

import type { FlagSpecs } from './args.js';
import type { CliIo } from './io.js';
import type { CliDeps } from './runtime.js';
import type { ExitCode } from './exit.js';

export interface CommandContext {
  io: CliIo;
  deps: CliDeps;
  /** Flags after parsing + coercion. */
  argv: readonly string[];
}

export interface Command {
  name: string;
  /** One-line summary for the root `--help` list. */
  summary: string;
  /** Usage line, e.g. `adminium introspect --connection <id>`. */
  usage: string;
  /** Prose under the usage line: what it does and any contract worth stating. */
  describe?: string;
  flags: FlagSpecs;
  /** Returns the process exit code. Throwing `CliError` is equivalent. */
  run(ctx: CommandContext): Promise<ExitCode>;
}

const INDENT = '  ';

/** `--out <path>` / `--dry-run` — the left column of the flag list. */
function flagLabel(name: string, spec: FlagSpecs[string]): string {
  const short = spec.short === undefined ? '' : `-${spec.short}, `;
  const value = spec.type === 'string' ? ` ${spec.placeholder ?? '<value>'}` : '';
  return `${short}--${name}${value}`;
}

export function renderFlags(flags: FlagSpecs): string {
  const entries = Object.entries(flags);
  if (entries.length === 0) return '';
  const labels = entries.map(([name, spec]) => flagLabel(name, spec));
  const width = Math.max(...labels.map((label) => label.length));
  return entries
    .map(([, spec], i) => {
      const suffix = spec.defaultDescription === undefined ? '' : ` (default: ${spec.defaultDescription})`;
      return `${INDENT}${(labels[i] ?? '').padEnd(width)}  ${spec.describe}${suffix}`;
    })
    .join('\n');
}

export function renderCommandHelp(command: Command): string {
  const parts = [`Usage: ${command.usage}`];
  if (command.describe !== undefined) parts.push('', command.describe);
  const flags = renderFlags(command.flags);
  if (flags !== '') parts.push('', 'Options:', flags);
  return parts.join('\n');
}

export function renderRootHelp(commands: readonly Command[], version: string): string {
  const width = Math.max(...commands.map((command) => command.name.length));
  const list = commands
    .map((command) => `${INDENT}${command.name.padEnd(width)}  ${command.summary}`)
    .join('\n');

  return [
    `adminium ${version} — the open-source admin panel generator`,
    '',
    'Usage: adminium [command] [options]',
    '',
    'Run with no command to start the interactive setup wizard.',
    '',
    'Commands:',
    list,
    '',
    'Options:',
    `${INDENT}-h, --help     Show help (\`adminium <command> --help\` for a command)`,
    `${INDENT}-v, --version  Show the version`,
    '',
    'Environment:',
    `${INDENT}ADMINIUM_SECRET    Required. Derives the key encrypting stored DSNs and API keys.`,
    `${INDENT}ADMINIUM_META_URL  Meta store DSN (postgres://, mysql://, sqlite:<path>).`,
    `${INDENT}ADMINIUM_DATA_DIR  Writable data directory (default ./data).`,
    `${INDENT}PORT, HOST         Listen address (default 4600, 0.0.0.0).`,
    '',
    'Flags override the environment. Docs: https://docs.adminium.dev',
  ].join('\n');
}
