// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The secret `adminium try` keeps beside its data.
 *
 * `try` is the "nothing to set up" door, yet it stopped at once without
 * `ADMINIUM_SECRET` (V21). So when the environment sets none, `try` makes one
 * and keeps it in `<data dir>/secret`, readable by the owner only, as the
 * desktop app keeps its own in `config.json`. Every later command that loads
 * the environment through `loadCliEnv` (`start`, `migrate`, `owner` …) reads it
 * back from the same folder, and `new --import` copies it into the project's
 * `.env`. A secret in the environment always wins over the file.
 *
 * It is never made for a folder that already holds an instance: that instance
 * was made with some other secret, and a new one would leave its stored
 * connection strings unreadable.
 *
 * Kept beside the data it unlocks, it protects nothing from someone who can
 * read the folder. That is the trade the desktop app makes on a machine with
 * no keychain, and fine for a person trying Adminium on their own computer. A
 * server sets `ADMINIUM_SECRET` itself.
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { holdsInstance } from '../project/adopt.js';
import { CliError } from './exit.js';

export const KEPT_SECRET_FILE = 'secret';

/** The schema's own floor for `ADMINIUM_SECRET`. */
const MIN_LENGTH = 16;

/** The secret kept in `dataDir`, or null when there is none (or it is too short to be one). */
export function readKeptSecret(dataDir: string): string | null {
  try {
    const value = readFileSync(join(dataDir, KEPT_SECRET_FILE), 'utf8').trim();
    return value.length >= MIN_LENGTH ? value : null;
  } catch {
    return null;
  }
}

/** Make a secret and keep it in `dataDir`. A file already there is never written over. */
export function keepNewSecret(dataDir: string): string {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const secret = randomBytes(32).toString('hex');
  try {
    writeFileSync(join(dataDir, KEPT_SECRET_FILE), `${secret}\n`, { mode: 0o600, flag: 'wx' });
    return secret;
  } catch (error) {
    const kept = (error as NodeJS.ErrnoException).code === 'EEXIST' ? readKeptSecret(dataDir) : null;
    if (kept !== null) return kept;
    throw error;
  }
}

/**
 * What `try` does about the secret before it loads the environment: nothing
 * when one is set or kept; makes one for a new folder (and says where); and
 * refuses, in words that fit, for a folder whose instance was made with a
 * secret nobody passed.
 */
export function prepareTrySecret(env: Record<string, string | undefined>, dataDir: string): { madeIn: string | null } {
  if ((env.ADMINIUM_SECRET ?? '').trim() !== '') return { madeIn: null };
  if (readKeptSecret(dataDir) !== null) return { madeIn: null };
  if (holdsInstance(dataDir)) {
    throw new CliError(`${dataDir} holds an Adminium instance, and no ADMINIUM_SECRET was given for it.`, {
      hint:
        'Set the secret it was made with, e.g.  export ADMINIUM_SECRET=…  and run this again.\n' +
        'A new secret would leave its stored connection strings unreadable.',
    });
  }
  keepNewSecret(dataDir);
  return { madeIn: dataDir };
}
