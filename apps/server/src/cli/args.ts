/**
 * Argument parsing for the `adminium` CLI (01-architecture.md §4.1).
 *
 * WHY NO CLI FRAMEWORK. `npx adminium` is advertised as "a complete install"
 * — the published tarball already carries the server, the dashboard build, and
 * the meta migrations, so every extra runtime dependency is weight on the very
 * first thing a new user does. Node 22's built-in `node:util` `parseArgs`
 * covers the whole surface this CLI needs (long flags, `--flag=value`, short
 * aliases, repeatables, `--` passthrough, strict unknown-flag rejection) at
 * zero dependencies, and Zod — already a dependency, already the house rule for
 * external input — does the typing and coercion `parseArgs` deliberately omits.
 * A framework would buy help-text formatting we want to control anyway.
 *
 * The shape below is deliberately declarative: a command's flags are data, so
 * `--help` renders from the same spec the parser enforces and the two cannot
 * drift.
 */

import { parseArgs, type ParseArgsConfig } from 'node:util';

import { CliUsageError } from './exit.js';

export type FlagType = 'string' | 'boolean';

export interface FlagSpec {
  type: FlagType;
  /** Single-character alias, e.g. `-p` for `--port`. */
  short?: string;
  /** Repeatable → the parsed value is an array (`--sections a --sections b`). */
  multiple?: boolean;
  /** Rendered in `--help`. */
  describe: string;
  /** Placeholder for the value in `--help`, e.g. `<id>`; string flags only. */
  placeholder?: string;
  /** Shown in `--help` as `(default: …)`. Documentation only — commands own defaults. */
  defaultDescription?: string;
}

export type FlagSpecs = Readonly<Record<string, FlagSpec>>;

/** What `parseArgs` hands back, before a command's Zod schema refines it. */
export interface ParsedArgs {
  /** Flag values keyed by the long flag name (no leading `--`). */
  values: Record<string, string | boolean | string[] | undefined>;
  /** Non-flag operands, in order. */
  positionals: string[];
}

/** `{ port: { type: 'string', short: 'p' } }` → the `parseArgs` options shape. */
function toParseArgsOptions(specs: FlagSpecs): NonNullable<ParseArgsConfig['options']> {
  const options: NonNullable<ParseArgsConfig['options']> = {};
  for (const [name, spec] of Object.entries(specs)) {
    options[name] = {
      type: spec.type,
      ...(spec.short === undefined ? {} : { short: spec.short }),
      ...(spec.multiple === true ? { multiple: true } : {}),
    };
  }
  return options;
}

/**
 * Parse `argv` against `specs`. Unknown flags are rejected (strict) and
 * re-thrown as a {@link CliUsageError} so the dispatcher can print help rather
 * than a raw Node error — `parseArgs`'s own message is good but its stack is not
 * something a user should ever see.
 */
export function parseFlags(argv: readonly string[], specs: FlagSpecs, command: string | null = null): ParsedArgs {
  try {
    const { values, positionals } = parseArgs({
      args: [...argv],
      options: toParseArgsOptions(specs),
      allowPositionals: true,
      strict: true,
    });
    return { values: values as ParsedArgs['values'], positionals };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliUsageError(message, command);
  }
}

/**
 * Split a repeatable-or-CSV flag into items. 06-llm-assist.md §10.4 writes
 * `--sections labels,enums,…` and `--locales en_US,de_DE`; supporting the
 * repeated form too costs nothing and is what people reflexively try.
 * `--sections a,b --sections c` → `['a','b','c']`.
 */
export function splitList(value: string | boolean | string[] | undefined): string[] {
  if (value === undefined || typeof value === 'boolean') return [];
  const raw = Array.isArray(value) ? value : [value];
  return raw
    .flatMap((entry) => entry.split(','))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** A string flag's value, or `undefined`. Repeated flags take the LAST value. */
export function stringFlag(value: string | boolean | string[] | undefined): string | undefined {
  if (value === undefined || typeof value === 'boolean') return undefined;
  return Array.isArray(value) ? value.at(-1) : value;
}

/** A boolean flag's presence. */
export function boolFlag(value: string | boolean | string[] | undefined): boolean {
  return value === true;
}

/**
 * A numeric flag, validated. `--port banana` must say so in one line rather
 * than surface later as `NaN` from `app.listen`.
 */
export function numberFlag(
  value: string | boolean | string[] | undefined,
  flagName: string,
  command: string | null = null,
): number | undefined {
  const raw = stringFlag(value);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new CliUsageError(`--${flagName} must be a number (got "${raw}").`, command);
  }
  return parsed;
}
