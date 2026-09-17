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

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

export const DOTENV_FILE = '.env';

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
export function loadDotEnv(root: string, env: Record<string, string | undefined>): string[] {
  const values = readDotEnv(root);
  if (values === null) return [];
  const filled: string[] = [];
  for (const [key, value] of Object.entries(values)) {
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
