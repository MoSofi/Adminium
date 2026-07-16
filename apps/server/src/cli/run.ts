/**
 * The dispatcher: argv → command → exit code.
 *
 * Returns a code rather than calling `process.exit`, so the whole CLI is a pure
 * function of (argv, deps) in tests — including the 06 §10.4 exit-code contract,
 * which is asserted against this function's return value.
 */

import { APP_VERSION } from '../version.js';
import { renderCommandHelp, renderRootHelp, type Command } from './command.js';
import { applyLlmResponseCommand } from './commands/apply-llm-response.js';
import { exportZipCommand } from './commands/export-zip.js';
import { generatePromptCommand } from './commands/generate-prompt.js';
import { importZipCommand } from './commands/import-zip.js';
import { initCommand } from './commands/init.js';
import { introspectCommand } from './commands/introspect.js';
import { migrateCommand } from './commands/migrate.js';
import { startCommand } from './commands/start.js';
import { CliError, CliUsageError, EXIT_ERROR, EXIT_OK, type ExitCode } from './exit.js';
import { nodeIo, type CliIo } from './io.js';
import { defaultCliDeps, type CliDeps } from './runtime.js';

/** Registry order == the order `--help` lists them: setup first, then the rest. */
export const COMMANDS: readonly Command[] = [
  initCommand,
  startCommand,
  migrateCommand,
  introspectCommand,
  generatePromptCommand,
  applyLlmResponseCommand,
  exportZipCommand,
  importZipCommand,
];

export function findCommand(name: string): Command | undefined {
  return COMMANDS.find((command) => command.name === name);
}

const HELP_FLAGS = new Set(['--help', '-h', 'help']);
const VERSION_FLAGS = new Set(['--version', '-v']);

/**
 * Is `token` a string-valued flag of `command`, i.e. does it CONSUME the next
 * argv token as its value? `--flag=value` carries its own value and consumes
 * nothing.
 */
function consumesNextToken(token: string, command: Command): boolean {
  if (token.includes('=')) return false;
  if (token.startsWith('--')) {
    return command.flags[token.slice(2)]?.type === 'string';
  }
  // A short cluster (`-abc`) can only end in a value-taking flag; resolving the
  // last character is enough, and `-p` is the shape that actually occurs.
  if (token.startsWith('-') && token.length >= 2) {
    const short = token[token.length - 1];
    return Object.values(command.flags).some(
      (spec) => spec.short === short && spec.type === 'string',
    );
  }
  return false;
}

/**
 * True when argv asks for help — matching only tokens in FLAG POSITION.
 *
 * The old check was `argv.some((arg) => HELP_FLAGS.has(arg))`, which cannot tell
 * a flag from a flag's VALUE: `--name help` and `--in help` are a connection
 * named "help" and a bundle file named `help`, not requests for documentation.
 * Both printed help and exited 0 — a silent no-op that a calling script reads as
 * success. Everything after a `--` separator is passthrough and never a flag.
 */
export function wantsHelp(argv: readonly string[], command: Command): boolean {
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] as string;
    if (token === '--') return false;
    if (HELP_FLAGS.has(token)) return true;
    if (consumesNextToken(token, command)) i += 1; // skip the value
  }
  return false;
}

export interface RunCliOptions {
  io?: CliIo;
  deps?: CliDeps;
  version?: string;
}

/**
 * Parse and dispatch. `adminium` with no arguments runs the setup wizard, which
 * is the whole point of `npx adminium` (01 §4.1).
 */
export async function runCli(argv: readonly string[], opts: RunCliOptions = {}): Promise<ExitCode> {
  const io = opts.io ?? nodeIo();
  const deps = opts.deps ?? defaultCliDeps();
  const version = opts.version ?? APP_VERSION;

  const [first, ...rest] = argv;

  if (first !== undefined && VERSION_FLAGS.has(first)) {
    io.out(version);
    return EXIT_OK;
  }

  // Bare `--help` / `help`, and `help <command>`.
  if (first !== undefined && HELP_FLAGS.has(first)) {
    const target = rest[0] === undefined ? undefined : findCommand(rest[0]);
    io.out(target === undefined ? renderRootHelp(COMMANDS, version) : renderCommandHelp(target));
    return EXIT_OK;
  }

  // No command → the wizard. Its own flags still parse (`adminium --port 8080`).
  const command = first === undefined || first.startsWith('-') ? initCommand : findCommand(first);
  const commandArgv = command === initCommand && first !== 'init' ? [...argv] : rest;

  if (command === undefined) {
    io.err(`Unknown command "${String(first)}".`);
    io.err('');
    io.err(renderRootHelp(COMMANDS, version));
    return EXIT_ERROR;
  }

  // `adminium <command> --help` — before the command parses, so `--help` never
  // has to be a flag on every command.
  //
  // Only tokens in FLAG POSITION count. A blind `argv.includes('--help')` also
  // matched flag VALUES: `adminium init --name help` (a connection named
  // "help") and `adminium import-zip --in help` (a bundle file named `help`)
  // both printed help and returned EXIT_OK, so a script branching on exit 0
  // concluded the command had run.
  if (wantsHelp(commandArgv, command)) {
    io.out(renderCommandHelp(command));
    return EXIT_OK;
  }

  try {
    return await command.run({ io, deps, argv: commandArgv });
  } catch (error) {
    if (error instanceof CliUsageError) {
      io.err(error.message);
      io.err('');
      io.err(renderCommandHelp(command));
      return error.code;
    }
    if (error instanceof CliError) {
      io.err(error.message);
      if (error.hint !== null) {
        io.err('');
        io.err(error.hint);
      }
      return error.code;
    }
    io.err(error instanceof Error ? error.message : String(error));
    return EXIT_ERROR;
  }
}
