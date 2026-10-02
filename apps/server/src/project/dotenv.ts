// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A project's `.env`: read it, fill the environment from it, and add to it.
 *
 * A variable that is already set (and not empty) always wins over the file, so
 * a value exported in the shell, or set by a host, overrides what is on disk.
 * Writing never changes a value that is already in the file: the most
 * important line in it is ADMINIUM_SECRET, and replacing that makes every
 * stored connection string unreadable.
 */

import { appendFileSync, chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

export const DOTENV_FILE = '.env';

/**
 * The model connections a project keeps in its `.env`.
 *
 * These are the ONLY names the running server writes to that file, and the
 * only ones it does not copy into its environment: a provider key in
 * `process.env` is readable by every hook and inherited by every child
 * process, so it is read from the file into the one module that calls the
 * provider (`llm/ai-env.ts`) and goes nowhere else.
 */
export const AI_ENV_NAMES = [
  'ADMINIUM_AI_ANTHROPIC_API_KEY',
  'ADMINIUM_AI_OPENAI_API_KEY',
  'ADMINIUM_AI_COMPATIBLE_BASE_URL',
  'ADMINIUM_AI_COMPATIBLE_API_KEY',
  'ADMINIUM_AI_OLLAMA_BASE_URL',
  'ADMINIUM_AI_MODEL',
] as const;
export type AiEnvName = (typeof AI_ENV_NAMES)[number];

const KEPT_OUT_OF_THE_ENVIRONMENT: readonly string[] = AI_ENV_NAMES;

/** The variables in `<root>/.env`, or null when there is no such file. */
export function readDotEnv(root: string): Record<string, string> | null {
  const file = join(root, DOTENV_FILE);
  if (!existsSync(file)) return null;
  return parseEnv(readFileSync(file, 'utf8')) as Record<string, string>;
}

/**
 * Copy `<root>/.env` into `env` where `env` has no value. Returns the names it
 * filled in.
 */
export function loadDotEnv(
  root: string,
  env: Record<string, string | undefined>,
  /** Names that stay in the file: read from it where they are needed, never copied into the environment. */
  keepOut: readonly string[] = KEPT_OUT_OF_THE_ENVIRONMENT,
): string[] {
  const values = readDotEnv(root);
  if (values === null) return [];
  const filled: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    if (keepOut.includes(key)) continue;
    if (env[key] === undefined || env[key] === '') {
      env[key] = value;
      filled.push(key);
    }
  }
  return filled;
}

export interface DotEnvEntry {
  key: string;
  value: string;
  /** Comment lines written above the variable. */
  comment?: readonly string[];
}

/**
 * Create `<root>/.env` with `entries`, or append the ones it does not have yet.
 * Returns the keys written and the keys that were already there.
 */
export function addToDotEnv(
  root: string,
  entries: readonly DotEnvEntry[],
): { written: string[]; kept: string[] } {
  const file = join(root, DOTENV_FILE);
  const existing = readDotEnv(root);
  const kept = entries.filter((entry) => existing !== null && entry.key in existing).map((entry) => entry.key);
  const toWrite = entries.filter((entry) => existing === null || !(entry.key in existing));
  if (toWrite.length === 0) return { written: [], kept };

  const block = toWrite
    .map((entry) => [...(entry.comment ?? []).map((line) => `# ${line}`), `${entry.key}=${entry.value}`].join('\n'))
    .join('\n\n');

  if (existing === null) {
    writeFileSync(file, `${block}\n`, { mode: 0o600 });
  } else {
    const current = readFileSync(file, 'utf8');
    const separator = current.length === 0 || current.endsWith('\n') ? '\n' : '\n\n';
    appendFileSync(file, `${separator}${block}\n`);
  }
  return { written: toWrite.map((entry) => entry.key), kept };
}

/** A value that needs no quotes: nothing a shell or a parser reads as anything but itself. */
const BARE_VALUE = /^[A-Za-z0-9_./:@%+,-]*$/;

/** One `KEY=value` line that `parseEnv` reads back as exactly `value`. */
function assignment(key: string, value: string): string {
  if (BARE_VALUE.test(value)) return `${key}=${value}`;
  // Single quotes take everything literally; a value with one in it goes in double quotes, which only `\n` escapes.
  if (!value.includes("'")) return `${key}='${value}'`;
  if (!value.includes('"') && !value.includes('\\')) return `${key}="${value}"`;
  if (!value.includes('`')) return `${key}=\`${value}\``;
  throw new Error(`The value for ${key} holds every kind of quote and cannot be written to .env.`);
}

/**
 * Set, change or remove variables in `<root>/.env`, in place.
 *
 * Every other byte of the file stays as it was: comments, order, blank lines,
 * the lines of variables not named here. A name outside `allowed` is refused,
 * and so is a value with a line break or a NUL in it — a value is one line,
 * and a second line would be a second variable of the writer's choosing. The
 * file is written whole to a neighbour and renamed over, so a crash leaves the
 * old file; it is readable by its owner only afterwards, whatever it was.
 *
 * `null` removes the variable's line.
 */
export function setDotEnv(root: string, values: Readonly<Record<string, string | null>>, allowed: readonly string[]): void {
  for (const [key, value] of Object.entries(values)) {
    if (!allowed.includes(key)) throw new Error(`${key} is not a variable that may be written to .env here.`);
    if (value !== null && /[\r\n\0]/.test(value)) throw new Error(`The value for ${key} has a line break or a NUL in it.`);
  }
  const file = join(root, DOTENV_FILE);
  const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const lines = current.length === 0 ? [] : current.replace(/\n$/, '').split('\n');
  const NAME = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const line of lines) {
    const name = NAME.exec(line)?.[1];
    if (name === undefined || !(name in values)) {
      kept.push(line);
      continue;
    }
    // The same name twice in a file: the first line carries the value, the rest go.
    if (seen.has(name)) continue;
    seen.add(name);
    const value = values[name] ?? null;
    if (value !== null) kept.push(assignment(name, value));
  }
  const added = Object.entries(values).filter(([key, value]) => value !== null && !seen.has(key));
  if (added.length > 0 && kept.length > 0 && kept[kept.length - 1] !== '') kept.push('');
  for (const [key, value] of added) kept.push(assignment(key, value as string));
  const next = kept.length === 0 ? '' : `${kept.join('\n')}\n`;
  if (next === current) return;
  const temp = `${file}.${String(process.pid)}.tmp`;
  writeFileSync(temp, next, { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, file);
}
