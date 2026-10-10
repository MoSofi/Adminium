// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a project folder holds, read WITHOUT running anything of it: no config
 * file is built or imported, no `.env` is loaded into the environment, nothing
 * is written. A host that opens folders from other people (the desktop app)
 * asks this before it starts the folder's server, so that it can say what it
 * found, ask about a missing key, name the accounts a folder brought with it,
 * and refuse a database a newer Adminium wrote, in words of its own.
 *
 * Only a SQLite store in the project's data folder is looked into. A project
 * whose store is elsewhere (Postgres, MySQL) answers `elsewhere`: it is asked
 * nothing here and starts as it would on a terminal.
 */
import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import { ALL_MIGRATIONS } from '@adminium/meta';
import Database from 'better-sqlite3';

import { readDotEnv } from './dotenv.js';

/** The account design mode signs the preview in as: not a person. */
const PREVIEW_EMAIL = 'preview@adminium.localhost';
/** How many names of each kind are given: enough to recognise a folder by, not a dump of it. */
const NAMES_MOST = 20;

export interface FolderFacts {
  /** `.env` has a non-empty `ADMINIUM_SECRET`. */
  secret: boolean;
  /** `none`: no store yet. `sqlite`: the file is there and was read. `elsewhere`: not a file this can read. */
  database: 'none' | 'sqlite' | 'elsewhere';
  /** Where the store's file is (or would be), for a host that must move or make it. `null` when it is elsewhere. */
  dataDir: string | null;
  /** The Adminium that last changed the store's own tables, or `null`. */
  lastEngine: string | null;
  /** Changes in the store that this build does not know: a NEWER Adminium made them. */
  newer: { name: string; appliedBy: string | null }[];
  people: { count: number; names: string[] };
  apiKeys: { count: number; names: string[] };
  /** Keys that let a page with no sign-in reach an app. */
  publicKeys: { count: number; names: string[] };
  /** The owner design mode made has a password of their own; `null` when there is no such owner. */
  ownerHasPassword: boolean | null;
}

const EMPTY = { count: 0, names: [] as string[] };

export function readFolderFacts(root: string, known: readonly string[] = ALL_MIGRATIONS.map((migration) => migration.name)): FolderFacts {
  const dotenv = readDotEnv(root) ?? {};
  const secret = (dotenv['ADMINIUM_SECRET'] ?? '').trim() !== '';
  const metaUrl = (dotenv['ADMINIUM_META_URL'] ?? '').trim();
  const base: FolderFacts = { secret, database: 'none', dataDir: null, lastEngine: null, newer: [], people: EMPTY, apiKeys: EMPTY, publicKeys: EMPTY, ownerHasPassword: null };
  if (metaUrl !== '' && !/^(sqlite:|file:)/i.test(metaUrl)) return { ...base, database: 'elsewhere' };

  const named = (dotenv['ADMINIUM_DATA_DIR'] ?? '').trim();
  const dataDir = named === '' ? join(root, 'data') : isAbsolute(named) ? named : resolve(root, named);
  const file = join(dataDir, 'meta.db');
  if (!existsSync(file)) return { ...base, dataDir };

  let db: Database.Database;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
  } catch {
    // Not a database this can open (a zero-byte file a start left, a file of something else): the start will say.
    return { ...base, dataDir };
  }
  try {
    const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((row) => row.name));
    // A file with none of the store's tables is a store nobody has started yet.
    if (!tables.has('adminium_migrations')) return { ...base, dataDir };
    const facts: FolderFacts = { ...base, database: 'sqlite', dataDir };

    const ledger = db.prepare('SELECT name, adminium_version AS version FROM adminium_migrations ORDER BY name').all() as { name: string; version: string | null }[];
    facts.lastEngine = ledger.at(-1)?.version ?? null;
    facts.newer = ledger.filter((row) => !known.includes(row.name)).map((row) => ({ name: row.name, appliedBy: row.version }));
    // A store from the future is not read further: its tables may not be the ones named below.
    if (facts.newer.length > 0) return facts;

    const list = (sql: string, ...args: unknown[]): { count: number; names: string[] } => {
      const rows = db.prepare(sql).all(...args) as { name: string }[];
      return { count: rows.length, names: rows.slice(0, NAMES_MOST).map((row) => row.name) };
    };
    if (tables.has('adminium_users')) facts.people = list("SELECT CASE WHEN name = '' THEN email ELSE name END AS name FROM adminium_users WHERE email <> ? ORDER BY created_at", PREVIEW_EMAIL);
    if (tables.has('adminium_api_keys')) facts.apiKeys = list('SELECT name FROM adminium_api_keys WHERE revoked_at IS NULL ORDER BY created_at');
    if (tables.has('adminium_public_keys')) facts.publicKeys = list('SELECT name FROM adminium_public_keys WHERE revoked_at IS NULL ORDER BY created_at');
    if (tables.has('adminium_settings') && tables.has('adminium_users')) {
      const owner = db.prepare("SELECT u.password_hash AS hash FROM adminium_settings s JOIN adminium_users u ON u.id = json_extract(s.value, '$') WHERE s.key = 'designer.localOwnerId'").get() as { hash: string | null } | undefined;
      facts.ownerHasPassword = owner === undefined ? null : owner.hash !== null;
    }
    return facts;
  } catch {
    // A store this cannot read is not judged here: the start will say what is wrong with it.
    return { ...base, dataDir };
  } finally {
    db.close();
  }
}
