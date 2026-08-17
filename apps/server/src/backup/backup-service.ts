// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The §9 backup writer (11-electron.md §9) — the thing behind
 * `POST /api/v1/desktop/backup`.
 *
 * It runs HERE, in the server, and not in the Electron main process, because §1
 * principle 2 says so and because the reason it says so is load-bearing: this
 * process is the one holding `ADMINIUM_SECRET`, the meta connection and the
 * source-DB pools. A main process that produced the archive itself would have to
 * open every database behind the back of the process writing to them.
 *
 * ─── Order is the guarantee ──────────────────────────────────────────────────
 *
 * discover → snapshot to a scratch dir → hash what was actually written →
 * build the manifest FROM THOSE HASHES → zip → move into place.
 *
 * Every step reads the previous step's output rather than its intent. The
 * manifest cannot overstate the archive (its checksums are of the bytes that
 * went in, not of the files that were meant to), and the destination does not
 * exist until the whole archive does — a crash mid-backup leaves a scratch
 * directory, never a truncated `.zip` that a restore would cheerfully open.
 *
 * ─── Redaction ───────────────────────────────────────────────────────────────
 *
 * `config.json` travels with `secretEncrypted`/`secretPlain` stripped (§9). This
 * module does not do the stripping and must not learn how: the desktop config is
 * the main process's (§2.3), so the REDACTED body arrives as a parameter, and
 * {@link assertNoSecrets} refuses to write it if it carries a secret-shaped key
 * anyway. That is the `export/redaction.ts` rule — fail closed at the boundary,
 * do not trust the caller's promise — applied to the one config this server does
 * not own.
 */

import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import type { DsnCrypto, MetaDb } from '@adminium/meta';
import { strToU8, zipSync, type Zippable } from 'fflate';

import { APP_VERSION } from '../version.js';
import {
  BACKUP_CONFIG_PATH,
  BACKUP_FILE_PATTERN,
  BACKUP_FORMAT_VERSION,
  BACKUP_MANIFEST_PATH,
  BACKUP_META_PATH,
  backupDatabasePath,
  backupFileName,
  sha256Hex,
  type BackupDatabaseEntry,
  type BackupManifest,
} from './format.js';
import { discoverSources, snapshotSqliteFile } from './snapshot.js';

/** `<dataDir>/backups` — §9's auto-backup home and the staging root. */
export const BACKUPS_DIR = 'backups';

/**
 * §9's rotation depth, default 7.
 *
 * Stated here AND in `apps/desktop/src/main/config.ts`, which is a duplication
 * with a reason: that file is the schema for `config.json`, whose default this
 * genuinely is, and this file is the server, which may not import the Electron
 * app (`.dependency-cruiser.cjs` — the edge only runs the other way). The value
 * is a number in a spec, not a decision either module gets to make, and the two
 * are pinned to each other by `backup-defaults.test.ts`.
 */
export const DEFAULT_AUTO_BACKUP_KEEP = 7;

/**
 * Where a `staged` archive lands before the main process moves it to the path
 * the user picked in the save dialog.
 *
 * Dot-prefixed and inside `backups/` on purpose. Inside, because the move to the
 * user's chosen path is then a same-filesystem `rename` in the common case
 * (both under the data dir's volume) instead of a cross-device copy. Dotted,
 * because `<dataDir>/backups` is a folder §9 reveals to the user, and a
 * half-written staging file appearing in it next to their real backups is
 * confusing at best; the rotation sweep also skips it, since
 * `BACKUP_FILE_PATTERN` cannot match a directory name.
 */
export const BACKUP_STAGING_DIR = '.staging';

/**
 * `secretEncrypted` and `secretPlain` are §9's named pair, but the assertion is
 * SHAPE-based rather than a list of two, for the reason `export/redaction.ts`
 * gives at length: a deny-list rots. A future `config.json` field called
 * `apiToken` would be invisible to a two-name check and would ship in every
 * backup from the day it was added.
 */
const SECRET_KEY_PATTERN = /secret|password|token|apikey|credential/i;

/**
 * The one key that is secret-SHAPED and is not a secret: `config.secretStorage`.
 *
 * It names WHERE the secret lives — `"safeStorage"` or `"plain"` — and §2.2
 * step 3 / §13 require it to survive, because it is what makes the About screen
 * warn that the master secret is sitting in cleartext. `redactConfig` keeps it
 * on purpose (see its allow-list); a check that dropped it would silence a
 * security warning in the name of security.
 *
 * Exempted by EXACT name AND by value: the two enum members are the only strings
 * that can pass, so a future field called `secretStorage` holding anything else
 * — a token, a path, a key — still fails. An exception to a fail-closed rule has
 * to be narrower than the rule.
 */
const SECRET_STORAGE_KEY = 'secretStorage';
const SECRET_STORAGE_VALUES: ReadonlySet<unknown> = new Set(['safeStorage', 'plain']);

/** Thrown when a redacted config is not, in fact, redacted. The backup aborts. */
export class BackupRedactionError extends Error {
  override readonly name = 'BackupRedactionError';
  constructor(key: string) {
    super(
      `refusing to write config.json into a backup: it still carries "${key}", which is ` +
        'secret-shaped. 11-electron.md §9 requires the desktop config to travel with its ' +
        'secrets stripped — the caller redacts (main/config.ts redactConfig), this asserts. ' +
        'A backup zip is a file users email to support.',
    );
  }
}

/**
 * Refuse a config body carrying anything secret-shaped, at any depth.
 *
 * Recursive because `config.json` is nested (`lanShare`, `updates`, `window`)
 * and a top-level-only check would pass `{ updates: { token: "…" } }` — which is
 * exactly the shape a future field would take.
 */
export function assertNoSecrets(value: unknown, path = 'config'): void {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) assertNoSecrets(item, `${path}[${String(index)}]`);
    return;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === SECRET_STORAGE_KEY && SECRET_STORAGE_VALUES.has(item)) continue;
    if (SECRET_KEY_PATTERN.test(key)) throw new BackupRedactionError(`${path}.${key}`);
    assertNoSecrets(item, `${path}.${key}`);
  }
}

export interface CreateBackupOptions {
  meta: MetaDb;
  /** Decrypts source DSNs so local SQLite files can be found (`connections/crypto.ts`). */
  crypto: DsnCrypto;
  /** `ADMINIUM_DATA_DIR` — the meta.db's home, `backups/`'s parent. */
  dataDir: string;
  /** Absolute path of the live meta store file. */
  metaPath: string;
  /**
   * The desktop `config.json`, ALREADY REDACTED by its owner (§2.3 makes the
   * main process the only reader of that file). `null` outside the Electron
   * shell — the archive then simply has no `config.json` member, which is
   * honest: there is no desktop config to describe.
   */
  redactedConfig: unknown;
  /** `app.getVersion()` from the shell; `null` when there is no shell. */
  appVersion?: string | null | undefined;
  /**
   * `auto`  → `<dataDir>/backups/adminium-backup-<ts>.zip`, rotated.
   * `staged` → `<dataDir>/backups/.staging/<id>.zip`, for the main process to
   *            move to the user's chosen path. See {@link BACKUP_STAGING_DIR}.
   */
  destination: 'auto' | 'staged';
  now?: (() => number) | undefined;
}

export interface CreateBackupResult {
  /** Absolute path of the written archive. */
  path: string;
  bytes: number;
  manifest: BackupManifest;
}

/**
 * The meta store's migration high-water mark — the ledger's last applied name.
 *
 * Read from `adminium_migrations`, not from `ALL_MIGRATIONS`, and the difference
 * is the whole point of the field: what a restore has to reason about is the
 * schema the ARCHIVE actually carries, not the one the build that wrote it
 * happened to ship. They are normally equal (every boot fast-forwards), and when
 * they are not it is because something went wrong — which is precisely when a
 * manifest that reported the build's number would lie.
 */
async function readMetaMigrationVersion(meta: MetaDb): Promise<string> {
  const rows = await meta.db
    .selectFrom('adminium_migrations')
    .select('name')
    .orderBy('name', 'desc')
    .limit(1)
    .execute();
  const latest = rows[0]?.name;
  if (latest === undefined) {
    throw new Error(
      'refusing to back up a meta store with no applied migrations — there is nothing ' +
        'here to restore, and an archive claiming otherwise would be worse than none.',
    );
  }
  return latest;
}

/**
 * Produce a §9 archive. Returns where it landed and what went in it.
 *
 * `zipSync` + in-memory buffers rather than a streaming writer: a desktop
 * install's databases are the ones a person keeps on a laptop, the snapshots are
 * already on disk before any of this runs, and a streaming zip would trade a
 * bounded, obvious memory profile for a partially-written archive on the failure
 * path. `mtime: createdAt` (not the zip epoch the M10 config bundle uses)
 * because a backup is a MOMENT, not a diffable artifact — the reproducibility
 * that matters there is exactly what would be wrong here.
 */
export async function createBackup(opts: CreateBackupOptions): Promise<CreateBackupResult> {
  const now = opts.now ?? Date.now;
  const createdAt = now();
  const dataDir = resolve(opts.dataDir);

  if (opts.redactedConfig !== null && opts.redactedConfig !== undefined) {
    assertNoSecrets(opts.redactedConfig);
  }

  // Staging is a HANDOFF, and every handoff drops things. A staged archive is
  // claimed by the main process moving it to the user's chosen path — but that
  // move can fail (the destination drive unplugged, permissions) or never happen
  // at all (the app is killed between the reply and the move). Nothing else
  // would ever remove it: rotation is documented to skip this directory, and
  // these are FULL copies of every database. Left alone, a dot-directory nobody
  // looks in grows by a whole install's worth of data every time a save goes
  // wrong. So each backup sweeps the leftovers of the ones before it.
  await sweepStaging(dataDir, createdAt);

  const metaMigrationVersion = await readMetaMigrationVersion(opts.meta);
  const sources = await discoverSources(opts.meta, opts.crypto);

  // A scratch dir per run: `backup()` needs a real destination file, two backups
  // must never collide over one, and a crash must leave its debris somewhere
  // sweepable rather than in `backups/`.
  const scratch = join(dataDir, BACKUPS_DIR, BACKUP_STAGING_DIR, `work-${randomBytes(8).toString('hex')}`);
  await mkdir(scratch, { recursive: true });

  try {
    const files: Record<string, Uint8Array> = {};

    // meta.db first: it is the file whose loss is unrecoverable, so if the disk
    // is going to be full, be full before the source snapshots waste minutes.
    const metaSnapshot = join(scratch, 'meta.db');
    await snapshotSqliteFile(opts.metaPath, metaSnapshot);
    const metaBytes = await readFile(metaSnapshot);
    files[BACKUP_META_PATH] = metaBytes;

    const databases: BackupDatabaseEntry[] = [];
    for (const source of sources.local) {
      const dest = join(scratch, `${source.slug}.sqlite`);
      await snapshotSqliteFile(source.path, dest);
      const bytes = await readFile(dest);
      const member = backupDatabasePath(source.slug);
      files[member] = bytes;
      databases.push({
        kind: 'local',
        slug: source.slug,
        file: member,
        bytes: bytes.byteLength,
        sha256: sha256Hex(bytes),
        connectionId: source.connectionId,
        sourcePath: source.path,
      });
    }
    for (const source of sources.external) {
      databases.push({
        kind: 'external',
        slug: source.slug,
        connectionId: source.connectionId,
        engine: source.engine,
      });
    }

    const manifest: BackupManifest = {
      formatVersion: BACKUP_FORMAT_VERSION,
      appVersion: opts.appVersion ?? null,
      serverVersion: APP_VERSION,
      metaMigrationVersion,
      createdAt,
      meta: {
        file: BACKUP_META_PATH,
        bytes: metaBytes.byteLength,
        sha256: sha256Hex(metaBytes),
      },
      databases,
    };

    if (opts.redactedConfig !== null && opts.redactedConfig !== undefined) {
      files[BACKUP_CONFIG_PATH] = strToU8(`${JSON.stringify(opts.redactedConfig, null, 2)}\n`);
    }
    files[BACKUP_MANIFEST_PATH] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

    const zipped = zipSync(nest(files), { level: 6, mtime: new Date(createdAt) });

    const path =
      opts.destination === 'auto'
        ? join(dataDir, BACKUPS_DIR, backupFileName(createdAt))
        : join(dataDir, BACKUPS_DIR, BACKUP_STAGING_DIR, `${randomBytes(8).toString('hex')}.zip`);

    // Write beside the target and rename, for the same reason `saveConfig` does:
    // a reader (the restore path, the CLI import) must never see a `.zip` that
    // is still being written. Same directory ⇒ the rename is atomic.
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.part`;
    await writeFile(tmp, zipped);
    await rename(tmp, path);

    return { path, bytes: zipped.byteLength, manifest };
  } finally {
    await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * How long a staged archive is allowed to sit unclaimed before a later backup
 * removes it.
 *
 * Generous on purpose: the only thing between the server writing a staged
 * archive and the main process moving it is one `rename`, so anything still
 * there an hour later was abandoned. The window exists at all because a sweep
 * that deleted by mtime alone could race a move that is genuinely in flight —
 * on a slow cross-device copy to a USB stick, of a multi-gigabyte archive.
 */
export const STAGING_TTL_MS = 60 * 60 * 1000;

/**
 * Remove abandoned staging entries older than {@link STAGING_TTL_MS}.
 *
 * Best-effort throughout: this is housekeeping, and a backup must never fail
 * because a leftover from last week could not be deleted. Confined to
 * `<dataDir>/backups/.staging`, which only this module ever writes to — unlike
 * `backups/` itself, it is not a folder users are shown, so age is a safe
 * criterion here in a way it explicitly is not one directory up.
 */
async function sweepStaging(dataDir: string, now: number): Promise<void> {
  const dir = join(dataDir, BACKUPS_DIR, BACKUP_STAGING_DIR);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const path = join(dir, name);
    try {
      const info = await stat(path);
      if (now - info.mtimeMs < STAGING_TTL_MS) continue;
      await rm(path, { recursive: true, force: true });
    } catch {
      // Locked, vanished under us, or a permission we do not have. The next
      // backup tries again.
    }
  }
}

/** fflate takes a nested object; our member paths are flat `a/b` strings. */
function nest(files: Record<string, Uint8Array>): Zippable {
  const root: Zippable = {};
  for (const [path, bytes] of Object.entries(files)) {
    const parts = path.split('/');
    let cursor = root;
    for (const part of parts.slice(0, -1)) {
      cursor[part] ??= {} satisfies Zippable;
      cursor = cursor[part] as Zippable;
    }
    cursor[parts[parts.length - 1] as string] = bytes;
  }
  return root;
}

/** A rotation sweep's outcome, so the caller can log/report what it removed. */
export interface RotateBackupsResult {
  kept: string[];
  removed: string[];
}

/**
 * §9: keep the newest `keep` archives in `<dataDir>/backups/`, delete the rest.
 *
 * ─── The two rules that keep this from being a data-loss bug ─────────────────
 *
 * 1. It only ever considers files matching {@link BACKUP_FILE_PATTERN}. That
 *    directory is `showItemInFolder`-revealed (§9), so users WILL put things in
 *    it — a copy of a backup they renamed, a note. "Delete the oldest files in
 *    the folder" would eat them. This deletes archives this code wrote, and
 *    nothing else.
 * 2. It sorts by NAME, not mtime. The names are UTC-stamped and
 *    lexicographically ordered by construction ({@link backupFileName}), whereas
 *    mtime is metadata that a file copy, an rsync, or a restore-from-Time-Machine
 *    rewrites — and a rotation that sorted on it after such an event would delete
 *    a real backup and keep an old one.
 *
 * Best-effort per file: a locked archive (Windows, an open zip viewer) must not
 * fail the BACKUP that just succeeded. The next sweep gets it.
 */
export async function rotateBackups(
  dataDir: string,
  keep: number,
  deps: {
    readdir: (dir: string) => Promise<string[]>;
    rm: (path: string) => Promise<void>;
  },
): Promise<RotateBackupsResult> {
  const dir = join(resolve(dataDir), BACKUPS_DIR);
  let names: string[];
  try {
    names = await deps.readdir(dir);
  } catch {
    return { kept: [], removed: [] };
  }

  const archives = names.filter((name) => BACKUP_FILE_PATTERN.test(name)).sort();
  const cut = Math.max(0, archives.length - keep);
  const doomed = archives.slice(0, cut);
  const removed: string[] = [];
  for (const name of doomed) {
    try {
      await deps.rm(join(dir, name));
      removed.push(name);
    } catch {
      // See above: a sweep that fails is a sweep, not a failed backup.
    }
  }
  return { kept: archives.slice(cut), removed };
}

/** The real filesystem, for {@link rotateBackups}. */
export function rotateBackupsOnDisk(dataDir: string, keep: number): Promise<RotateBackupsResult> {
  return rotateBackups(dataDir, keep, {
    readdir: (dir) => readdir(dir),
    rm: (path) => rm(path, { force: true }),
  });
}
