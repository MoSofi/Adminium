// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Which files a SQLite source may open, and the list of Adminium's own files
 * that nothing a user types may ever point at.
 *
 * A SQLite source DSN names a file, and the adapter opens it read-write with
 * the data pragmas applied. The DSN guard (`dsn.ts`) checks hosts, so a SQLite
 * string used to pass it untouched: any file the process could open was a
 * source, Adminium's own meta store included. `/data` and the schema editor
 * already refuse every `adminium_*` table, so that is not a way to edit roles;
 * the harm is a second writer on the live meta file (and on its backups), which
 * can corrupt it.
 *
 * So two rules, read from the file's REAL path, the way SQLite will open it
 * (symlinks resolved one component at a time, a `..` applied after the symlink
 * before it, the on-disk spelling on a case-insensitive volume):
 *
 *  1. Never Adminium's own files ({@link ownPathRefusal}): the meta store file
 *     and its `-wal`/`-shm`/`-journal` companions, the default `meta.db` in the
 *     data dir even when the meta store lives elsewhere, the bootstrap and kept
 *     secret files, and the data dir's own folders (`backups/`, `files/`,
 *     `tmp/`, `add-ons/`, `pre-restore-*`). A hard link to one of those files
 *     is caught too, by comparing the files themselves. The rest of the data
 *     dir stays open on purpose: `<dataDir>/databases/` is where the desktop
 *     app keeps its databases, and a project keeps `data/app.sqlite` next to
 *     its meta store.
 *  2. When the operator sets `ADMINIUM_SQLITE_DIRS`, only files under one of
 *     those folders. Unset: any other file, as before.
 *
 * The own-files list is shared: a `local` storage root has to stay off the
 * same files and folders, and must not CONTAIN them either (`folder: true`).
 */

import { realpathSync, statSync, type Stats } from 'node:fs';
import { dirname, isAbsolute, join, parse, sep } from 'node:path';

import { normalizeSqliteFile } from '@adminium/adapter-sqlite';

import { ValidationFailedError } from '../errors.js';

/** Files directly in the data dir that are Adminium's: the embedded meta store, `adminium.json`, the kept secret. */
export const OWN_DATA_DIR_FILES: readonly string[] = ['meta.db', 'adminium.json', 'secret'];

/**
 * Folders directly in the data dir that are Adminium's: backups (and their
 * `.staging`), file storage's local root, the upload spool, installed add-ons,
 * and the Export everything work folder (which every boot empties).
 * Kept in step with `BACKUPS_DIR`, `FILES_DIR`, `TMP_DIR`, `ADD_ONS_DIR` and
 * `EXPORT_EVERYTHING_DIR` by `sqlite-guard.test.ts`; spelled out here so this
 * module imports none of them.
 */
export const OWN_DATA_DIR_FOLDERS: readonly string[] = ['backups', 'files', 'tmp', 'add-ons', '.export-everything'];

/**
 * `<dataDir>/pre-restore-<ts>/`: what a restore moved aside, an older meta
 * store included. `<dataDir>/.archive-restore-<id>/`: an archive being
 * restored, unpacked before it replaces anything.
 */
export const OWN_DATA_DIR_FOLDER_PREFIXES: readonly string[] = ['pre-restore-', '.archive-restore-'];

/** The files SQLite keeps next to a database while it is open. */
export const SQLITE_COMPANION_SUFFIXES: readonly string[] = ['-wal', '-shm', '-journal'];

/** Where Adminium's own files are on this server. */
export interface OwnFiles {
  /** `ADMINIUM_DATA_DIR` as configured (relative to the working directory, like every other use). */
  dataDir: string;
  /** The meta store's SQLite file, when the meta store is a SQLite file; null otherwise. */
  metaFile: string | null;
}

export type OwnPathReason = 'meta-store' | 'meta-companion' | 'data-folder' | 'contains-data';

export interface OwnPathRefusal {
  reason: OwnPathReason;
  /** `data-folder`: which of the data dir's files or folders, e.g. `backups`. */
  name?: string;
}

// ── real paths ─────────────────────────────────────────────────────────────

/**
 * The path SQLite opens for `path`. SQLite builds the full name itself before
 * it opens anything (`unixFullPathname`): relative to the working directory,
 * one component at a time, following a symlink as soon as it is reached and
 * taking a `..` off the name built so far, so `link/..` is the link target's
 * parent, not the folder holding the link. Each existing component is read
 * back in its on-disk spelling; a missing one is kept as written.
 */
export function realPath(path: string): string {
  const absolute = isAbsolute(path) ? path : join(process.cwd(), path);
  const root = parse(absolute).root;
  let current = realpathSync.native(root);
  for (const part of absolute.slice(root.length).split(/[\\/]+/)) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      current = dirname(current);
      continue;
    }
    const next = join(current, part);
    try {
      current = realpathSync.native(next);
    } catch {
      // Missing, not a folder, a symlink loop, no permission: kept as written.
      current = next;
    }
  }
  return current;
}

const caseInsensitiveCache = new Map<string, boolean>();

/** The closest folder of `path` that exists. */
function existingAncestor(path: string): string {
  let current = path;
  for (;;) {
    try {
      statSync(current);
      return current;
    } catch {
      const parent = dirname(current);
      if (parent === current) return current;
      current = parent;
    }
  }
}

/**
 * Whether names on the volume holding `path` compare without case (macOS and
 * Windows by default): the same folder spelled with its letters' case swapped
 * is the same folder. Asked of the folder itself, because a Mac can mount a
 * case-sensitive volume too.
 */
export function caseInsensitiveAt(path: string): boolean {
  const folder = existingAncestor(path);
  const cached = caseInsensitiveCache.get(folder);
  if (cached !== undefined) return cached;
  const swapped = [...folder].map((c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase())).join('');
  let answer: boolean;
  if (swapped === folder) {
    answer = process.platform === 'darwin' || process.platform === 'win32';
  } else {
    try {
      const a = statSync(folder);
      const b = statSync(swapped);
      answer = a.dev === b.dev && a.ino === b.ino;
    } catch {
      answer = false;
    }
  }
  caseInsensitiveCache.set(folder, answer);
  return answer;
}

/** Whether real path `child` is `parent` or inside it, comparing without case where the volume does. */
export function pathWithin(child: string, parent: string): boolean {
  const fold = caseInsensitiveAt(parent);
  const c = fold ? child.toLowerCase() : child;
  const p = fold ? parent.toLowerCase() : parent;
  if (c === p) return true;
  return c.startsWith(p.endsWith(sep) ? p : `${p}${sep}`);
}

function sameName(a: string, b: string, fold: boolean): boolean {
  return fold ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function statOrNull(path: string): Stats | null {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

// ── the own-files list ─────────────────────────────────────────────────────

interface OwnFile {
  path: string;
  reason: 'meta-store' | 'meta-companion' | 'data-folder';
  name?: string;
}

function ownFiles(own: OwnFiles): { files: OwnFile[]; folders: { path: string; name: string }[]; dataDir: string } {
  const dataDir = realPath(own.dataDir);
  const files: OwnFile[] = [];
  const metaFiles = new Set<string>([join(dataDir, 'meta.db')]);
  if (own.metaFile !== null && own.metaFile !== ':memory:' && own.metaFile !== '') metaFiles.add(realPath(own.metaFile));
  for (const meta of metaFiles) {
    files.push({ path: meta, reason: 'meta-store' });
    for (const suffix of SQLITE_COMPANION_SUFFIXES) files.push({ path: `${meta}${suffix}`, reason: 'meta-companion' });
  }
  for (const name of OWN_DATA_DIR_FILES) {
    if (name !== 'meta.db') files.push({ path: join(dataDir, name), reason: 'data-folder', name });
  }
  const folders = OWN_DATA_DIR_FOLDERS.map((name) => ({ path: join(dataDir, name), name }));
  return { files, folders, dataDir };
}

/**
 * Whether `path` is one of Adminium's own files or inside one of its own
 * folders, read from its real path; null when it is neither.
 *
 * `folder: true` is for a path that will be a folder Adminium writes into (a
 * `local` storage root): it is also refused when it CONTAINS the data dir or
 * the meta store, so `/` or the data dir itself never qualify.
 */
export function ownPathRefusal(path: string, own: OwnFiles, opts: { folder?: boolean } = {}): OwnPathRefusal | null {
  const candidate = realPath(path);
  const { files, folders, dataDir } = ownFiles(own);
  const candidateStat = statOrNull(candidate);

  for (const file of files) {
    const fold = caseInsensitiveAt(dirname(file.path));
    let hit = sameName(candidate, file.path, fold);
    if (!hit && candidateStat !== null && candidateStat.isFile()) {
      // A hard link, or a spelling the walk did not canonicalise: the same file is the same file.
      const ownStat = statOrNull(file.path);
      hit = ownStat !== null && ownStat.dev === candidateStat.dev && ownStat.ino === candidateStat.ino;
    }
    if (hit) return file.name === undefined ? { reason: file.reason } : { reason: file.reason, name: file.name };
  }

  for (const folder of folders) {
    if (pathWithin(candidate, folder.path)) return { reason: 'data-folder', name: folder.name };
  }
  if (pathWithin(candidate, dataDir) && candidate !== dataDir) {
    const first = candidate.slice(dataDir.length).split(sep).find((part) => part !== '') ?? '';
    const fold = caseInsensitiveAt(dataDir);
    const prefix = OWN_DATA_DIR_FOLDER_PREFIXES.find((p) => (fold ? first.toLowerCase() : first).startsWith(p));
    if (prefix !== undefined) return { reason: 'data-folder', name: `${prefix}…` };
  }

  if (opts.folder === true) {
    if (pathWithin(dataDir, candidate)) return { reason: 'contains-data' };
    for (const file of files) {
      if (file.reason === 'meta-store' && pathWithin(file.path, candidate)) return { reason: 'contains-data' };
    }
  }
  return null;
}

// ── SQLite sources ─────────────────────────────────────────────────────────

/** What a SQLite source DSN is checked against: Adminium's own files, and `ADMINIUM_SQLITE_DIRS`. */
export interface SqliteSourcePolicy {
  own: OwnFiles;
  /** `ADMINIUM_SQLITE_DIRS`: when set, a SQLite source must lie under one of these folders. */
  dirs?: readonly string[] | undefined;
}

export interface SqliteSourceRefusal {
  message: string;
  details: Record<string, unknown>;
}

const MESSAGES: Record<OwnPathReason, (name: string | undefined) => string> = {
  'meta-store': () =>
    "This file is Adminium's own meta store. Adminium never opens it as a source database, because a second writer can damage it. Connect your app's own database file instead.",
  'meta-companion': () =>
    "This file belongs to Adminium's own meta store. Adminium never opens it as a source database. Connect your app's own database file instead.",
  'data-folder': (name) =>
    `This file is one of Adminium's own (${name ?? 'data directory'} in its data directory). Adminium never opens its own files as a source database. Copy the database somewhere else and connect the copy.`,
  'contains-data': () => "This folder holds Adminium's own data directory. Choose a folder of its own.",
};

/**
 * Why `dsn` may not be opened as a SQLite source under `policy`, or null when
 * it may (or is not a SQLite file at all: `:memory:` opens nothing on disk).
 * The path is the one the adapter opens (`normalizeSqliteFile`).
 */
export function sqliteSourceRefusal(dsn: string, policy: SqliteSourcePolicy): SqliteSourceRefusal | null {
  const file = normalizeSqliteFile({ dsn });
  if (file === null || file === ':memory:') return null;
  const own = ownPathRefusal(file, policy.own);
  if (own !== null) {
    return {
      message: MESSAGES[own.reason](own.name),
      details: { file, reason: own.reason, ...(own.name === undefined ? {} : { folder: own.name }) },
    };
  }
  const dirs = policy.dirs ?? [];
  if (dirs.length > 0) {
    const real = realPath(file);
    if (!dirs.some((dir) => pathWithin(real, realPath(dir)))) {
      return {
        message: `This SQLite file is outside the folders this server allows (ADMINIUM_SQLITE_DIRS: ${dirs.join(', ')}). Move the file into one of them, or ask whoever runs this server to add its folder to ADMINIUM_SQLITE_DIRS.`,
        details: { file, reason: 'outside-sqlite-dirs', variable: 'ADMINIUM_SQLITE_DIRS', dirs: [...dirs] },
      };
    }
  }
  return null;
}

/** {@link sqliteSourceRefusal} as a guard: throws 422 `VALIDATION_FAILED` before anything opens the file. */
export function assertSqliteSourceAllowed(dsn: string, policy: SqliteSourcePolicy): void {
  const refusal = sqliteSourceRefusal(dsn, policy);
  if (refusal !== null) throw new ValidationFailedError(refusal.message, refusal.details);
}
