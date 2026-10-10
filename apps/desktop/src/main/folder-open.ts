// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What main does to a project folder between "the person agreed to open it"
 * and "its server is started": read what the engine
 * says the folder holds, make what a folder with no data needs, answer the
 * question of a missing key, and take the sender's settings out of a version
 * store that travelled.
 *
 * ELECTRON-FREE, and it starts nothing of the folder. The facts themselves are
 * the engine's (`adminium folder-facts`, run by `make-project.ts`): this file
 * only reads its answer and writes the few files the answers call for.
 */
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { z } from 'zod';

const named = z.object({ count: z.number().int().nonnegative(), names: z.array(z.string()) });

/** The engine's answer (`apps/server/src/project/folder-facts.ts`), as far as the app reads it. */
export const folderFactsSchema = z.object({
  secret: z.boolean(),
  database: z.enum(['none', 'sqlite', 'elsewhere']),
  dataDir: z.string().nullable(),
  lastEngine: z.string().nullable(),
  newer: z.array(z.object({ name: z.string(), appliedBy: z.string().nullable() })),
  people: named,
  apiKeys: named,
  publicKeys: named,
  ownerHasPassword: z.boolean().nullable(),
  running: z.object({ port: z.number().int(), by: z.enum(['cli', 'desktop']) }).nullable(),
  otherManager: z.object({ manager: z.string(), file: z.string() }).nullable(),
  engine: z.object({ installed: z.string().nullable(), declared: z.string().nullable(), here: z.string() }),
  install: z.enum(['no-packages', 'not-finished', 'another-machine', 'changed']).nullable(),
});

export type FolderFacts = z.infer<typeof folderFactsSchema>;

/** The last line of the command's output that is its JSON answer, or `null`. */
export function parseFolderFacts(output: string): FolderFacts | null {
  const lines = output.split(/\r?\n/).filter((line) => line.trim().startsWith('{'));
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const parsed = folderFactsSchema.safeParse(JSON.parse(lines[i] ?? ''));
      if (parsed.success) return parsed.data;
    } catch {
      // Not the answer: a line a package printed.
    }
  }
  return null;
}

// ─── Versions ────────────────────────────────────────────────────────────────

const parts = (version: string): [number, number, number] | null => {
  const found = /^[\^~=v\s]*(\d+)\.(\d+)\.(\d+)/.exec(version);
  return found === null ? null : [Number(found[1]), Number(found[2]), Number(found[3])];
};

/** Whether `a` is an earlier release than `b`. A version that does not read is not earlier than anything. */
export function olderThan(a: string, b: string): boolean {
  const left = parts(a);
  const right = parts(b);
  if (left === null || right === null) return false;
  for (let i = 0; i < 3; i += 1) {
    if ((left[i] as number) !== (right[i] as number)) return (left[i] as number) < (right[i] as number);
  }
  return false;
}

/** The Adminium a project's own code imports: what is installed, else what `package.json` asks for. As `x.y.z`. */
export function enginePin(facts: Pick<FolderFacts, 'engine'>): string | null {
  const pin = facts.engine.installed ?? facts.engine.declared;
  const read = pin === null ? null : parts(pin);
  return read === null ? null : read.join('.');
}

/** A folder that brought more than a new project has: other people, keys, or an owner with a password of their own. */
export function cameWithAccounts(facts: FolderFacts): boolean {
  return facts.database === 'sqlite' && (facts.people.count > 1 || facts.apiKeys.count > 0 || facts.publicKeys.count > 0 || facts.ownerHasPassword === true);
}

// ─── `.env`, as text ─────────────────────────────────────────────────────────

const ENV_FILE = '.env';
const SECRET_NAME = 'ADMINIUM_SECRET';

/** One name's value in a `.env` text, quotes taken off; `null` when the name is not set. Never loaded anywhere. */
export function envValue(text: string, name: string): string | null {
  let found: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (match === null || match[1] !== name) continue;
    const raw = (match[2] ?? '').trim();
    found = /^(["']).*\1$/.test(raw) ? raw.slice(1, -1) : raw.replace(/\s+#.*$/, '');
  }
  return found;
}

/** A `.env` text with `name` set to `value`: its line replaced where it is, or added at the end. */
export function withEnvValue(text: string, name: string, value: string): string {
  const lines = text === '' ? [] : text.replace(/\r?\n$/, '').split(/\r?\n/);
  const at = lines.findIndex((line) => new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`).test(line));
  if (at === -1) lines.push(`${name}=${value}`);
  else lines[at] = `${name}=${value}`;
  return `${lines.join('\n')}\n`;
}

const readEnv = (root: string): string => {
  try {
    return readFileSync(join(root, ENV_FILE), 'utf8');
  } catch {
    return '';
  }
};

/** Whether `path` is a file or folder below `root`, by where both really are (links read through). */
export function strictlyInside(root: string, path: string): boolean {
  let from: string;
  let to: string;
  try {
    from = realpathSync(root);
    to = realpathSync(path);
  } catch {
    return false;
  }
  const way = relative(from, to);
  return way !== '' && !way.startsWith('..') && !isAbsolute(way);
}

/** A new key, as the engine's own `new` makes one. */
export const newSecret = (): string => randomBytes(32).toString('hex');

// ─── A folder with no data yet ───────────────────────────────────────────────

/** The SQLite file a project's `DATABASE_URL` names, absolute, or `null` (another kind of database, or none named). */
export function projectDatabaseFile(root: string, envText: string): string | null {
  const url = envValue(envText, 'DATABASE_URL') ?? '';
  const match = /^sqlite:(?:\/\/)?(.+)$/i.exec(url.trim());
  if (match === null || match[1] === undefined || match[1] === ':memory:') return null;
  return isAbsolute(match[1]) ? match[1] : resolve(root, match[1]);
}

/**
 * Where this project keeps its data, as its own `.env` says: the database file with the files SQLite keeps beside
 * it, and the data folder. What "the apps only" must not carry, whatever the folder calls them.
 */
export function projectDataPaths(root: string): string[] {
  const text = readEnv(root);
  const database = projectDatabaseFile(root, text);
  const named = (envValue(text, 'ADMINIUM_DATA_DIR') ?? '').trim();
  return [...(database === null ? [] : [database, `${database}-wal`, `${database}-shm`, `${database}-journal`]), named === '' ? join(root, 'data') : resolve(root, named)];
}

export interface MadeForFolder {
  key: boolean;
  database: boolean;
}

/**
 * For a folder whose store does not exist yet: a key in `.env` when it has
 * none, and the empty database file where the project's address points (a
 * SQLite connection opens only a file that is there). Never for a folder that
 * HAS data and no key: that one is asked about ({@link resolveMissingKey}).
 */
export function prepareNewData(root: string, facts: Pick<FolderFacts, 'secret' | 'database'>, secret: () => string = newSecret): MadeForFolder {
  const made: MadeForFolder = { key: false, database: false };
  if (facts.database !== 'none') return made;
  let text = readEnv(root);
  if (!facts.secret) {
    text = withEnvValue(text, SECRET_NAME, secret());
    writeFileSync(join(root, ENV_FILE), text, { mode: 0o600 });
    made.key = true;
  }
  const file = projectDatabaseFile(root, text);
  if (file !== null && !existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, '');
    made.database = true;
  }
  return made;
}

// ─── Data with no key ────────────────────────────────────────────────────────

/** `data.before-2026-10-09`: where "start the data fresh" moves the old data. Never deleted. */
export function dataBeforeName(now: Date): string {
  return `data.before-${now.toISOString().slice(0, 10)}`;
}

export type MissingKeyAnswer = { readonly kind: 'env'; readonly file: string } | { readonly kind: 'fresh' } | { readonly kind: 'new' };

export type MissingKeyOutcome = { readonly ok: true } | { readonly ok: false; readonly reason: 'not-a-key-file' | 'failed'; readonly detail?: string };

/**
 * The three answers to "this project's data is here, but its key is missing".
 * `env`: the picked file must hold a key; it becomes the project's `.env`
 * (one that was there is kept beside it). `fresh`: the data folder is moved
 * aside, then a new key. `new`: a new key over the data that is there.
 */
export function resolveMissingKey(root: string, facts: Pick<FolderFacts, 'dataDir'>, answer: MissingKeyAnswer, opts: { now?: Date; secret?: () => string } = {}): MissingKeyOutcome {
  const target = join(root, ENV_FILE);
  try {
    if (answer.kind === 'env') {
      let picked: string;
      try {
        picked = readFileSync(answer.file, 'utf8');
      } catch {
        return { ok: false, reason: 'not-a-key-file' };
      }
      if ((envValue(picked, SECRET_NAME) ?? '').trim() === '') return { ok: false, reason: 'not-a-key-file' };
      if (existsSync(target) && resolve(answer.file) !== resolve(target)) copyFileSync(target, `${target}.before`);
      if (resolve(answer.file) !== resolve(target)) writeFileSync(target, picked, { mode: 0o600 });
      return { ok: true };
    }
    if (answer.kind === 'fresh') {
      const data = facts.dataDir ?? join(root, 'data');
      // Only a folder of this project's own is moved: a `.env` that names the project itself, or a place outside it
      // (another program's data, by a folder somebody sent), is never renamed on a click here.
      if (existsSync(data) && !strictlyInside(root, data)) return { ok: false, reason: 'failed', detail: 'This project keeps its data outside its own folder. Adminium does not move data it did not put there.' };
      if (existsSync(data)) {
        const base = join(dirname(data), dataBeforeName(opts.now ?? new Date()));
        let to = base;
        for (let n = 2; existsSync(to); n += 1) to = `${base}-${String(n)}`;
        renameSync(data, to);
      }
    }
    writeFileSync(target, withEnvValue(readEnv(root), SECRET_NAME, (opts.secret ?? newSecret)()), { mode: 0o600 });
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: 'failed', detail: error instanceof Error ? error.message : String(error) };
  }
}

// ─── A version store that travelled ──────────────────────────────────────────

const VERSION_STORE = join('.adminium', 'designer', 'versions.git');
/** What a bare store's settings are when the engine makes one: nothing of the sender's survives being written over. */
const PLAIN_STORE_CONFIG = '[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = true\n';

/**
 * A folder from someone else may bring its version store, and a store's own
 * `config` and `hooks/` are things git obeys (a `config` can name a program to
 * run). On the first open here both are replaced with a plain store's.
 * Returns whether there was a store to clean.
 */
/** The settings git itself writes into a new store. None of them names a program. */
const PLAIN_SETTINGS = new Set(['repositoryformatversion', 'filemode', 'bare', 'ignorecase', 'symlinks', 'precomposeunicode', 'logallrefupdates']);

/**
 * At a later opening: the store is cleaned again only when it holds something
 * git would obey that git did not write (a setting outside the plain ones, a
 * hook that is not a sample). The store's settings are not part of what the
 * "open this folder?" question is asked about, so files unpacked over a
 * project already agreed to could otherwise bring a sender's. A store the
 * app made is left exactly as git wrote it for this system.
 */
export function tidyVersionStore(root: string): boolean {
  const store = join(root, VERSION_STORE);
  if (!existsSync(join(store, 'HEAD'))) return false;
  let plain = true;
  try {
    for (const raw of readFileSync(join(store, 'config'), 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (line === '' || line.startsWith('#') || line.startsWith(';') || /^\[core\]$/i.test(line)) continue;
      const name = /^([A-Za-z][A-Za-z0-9-]*)\s*=/.exec(line)?.[1]?.toLowerCase();
      if (name === undefined || !PLAIN_SETTINGS.has(name)) plain = false;
    }
  } catch {
    plain = false;
  }
  try {
    if (readdirSync(join(store, 'hooks')).some((name) => !name.endsWith('.sample'))) plain = false;
  } catch {
    // No hooks folder: nothing to obey.
  }
  return plain ? false : cleanVersionStore(root);
}

export function cleanVersionStore(root: string): boolean {
  const store = join(root, VERSION_STORE);
  if (!existsSync(join(store, 'HEAD'))) return false;
  rmSync(join(store, 'hooks'), { recursive: true, force: true });
  writeFileSync(join(store, 'config'), PLAIN_STORE_CONFIG);
  return true;
}
