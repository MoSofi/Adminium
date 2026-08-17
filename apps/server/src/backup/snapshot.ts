// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SQLite snapshotting for the §9 backup (11-electron.md §9), and the discovery
 * of what there is to snapshot.
 *
 * ─── Why `backup()` and not `copyFile()` ─────────────────────────────────────
 *
 * §9 is specific — "the server snapshots each SQLite file with the
 * `better-sqlite3` online `backup()` API (WAL-safe, no locking of live writers)"
 * — and the alternative it rules out is not merely inferior, it is silently
 * wrong. Every local database runs `journal_mode = WAL` (§9's pragma block), so
 * a committed row lives in `<db>-wal` until a checkpoint folds it back. Copying
 * the `.sqlite` file therefore copies a database that is missing its most recent
 * commits; copying all three files copies them at three different instants, so
 * the WAL can describe pages the main file does not have yet. Both produce an
 * archive that unzips, opens, passes `PRAGMA integrity_check`, and has lost
 * data — the worst failure a backup can have, because it is invisible until the
 * restore.
 *
 * `backup()` runs SQLite's own online backup: it reads through the same page
 * cache and WAL a reader would, restarts itself if a writer changes the source
 * mid-copy, and lands a self-contained, checkpointed file. The destination is
 * complete at whatever instant the copy finished, and live writers are never
 * blocked.
 *
 * ─── Why a second connection ─────────────────────────────────────────────────
 *
 * The obvious move is to reach through `ConnectionManager` for the handle the
 * server already holds. It is the wrong move: those handles are role-branded
 * (01 §3's privilege model), pooled, and owned by request-scoped code, and a
 * backup that borrowed one would serialize itself behind whatever CRUD is in
 * flight — the exact locking §9 says not to do. A second connection to a WAL
 * database is the normal, supported thing (WAL exists so readers and a writer
 * coexist), so this module opens its own, READONLY, and closes it. `readonly`
 * is belt and braces: a backup is the one operation in the product with no
 * reason whatsoever to be able to write to a source database, and
 * `fileMustExist` keeps a stale DSN from CREATING an empty database and
 * cheerfully backing it up.
 */

import { mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

import { normalizeSqliteFile } from '@adminium/adapter-sqlite';
import { connectionsRepo, type Connection, type DsnCrypto, type MetaDb } from '@adminium/meta';
import Database from 'better-sqlite3';

import { deriveDatabaseSlug, uniqueSlug } from './format.js';

/** A local SQLite source DB found in `adminium_connections`, ready to snapshot. */
export interface LocalDatabaseSource {
  connectionId: string;
  slug: string;
  /** Absolute path of the live file. */
  path: string;
}

/** A source DB the backup lists but never dumps (§9's "external"). */
export interface ExternalDatabaseSource {
  connectionId: string;
  slug: string;
  engine: string;
}

export interface DiscoveredSources {
  local: LocalDatabaseSource[];
  external: ExternalDatabaseSource[];
}

/**
 * `:memory:` and a relative path are both "not a file on this disk we can
 * snapshot", for different reasons, and both must be classified rather than
 * crashed on.
 *
 * `:memory:` is a real, supported SQLite target (`adapter-sqlite`'s own file
 * normalizer names it for demos and tests) that has no bytes to copy. A relative
 * path is a DSN whose meaning depends on the server's cwd — which, for a
 * utilityProcess forked by Electron, is not a place anybody chose. Backing up
 * "whatever `./app.db` resolves to from the app bundle's working directory"
 * would be worse than not backing it up, because the manifest would claim it.
 */
function localFileOf(dsn: string | null): string | null {
  if (dsn === null) return null;
  const file = normalizeSqliteFile({ dsn });
  if (file === null || file === ':memory:') return null;
  return isAbsolute(file) ? file : null;
}

/**
 * Split every configured connection into "we dump this" and "we list this".
 *
 * §9's rule is about the ENGINE, not about reachability: a Postgres on
 * `localhost` is still external (we do not have a byte-level snapshot mechanism
 * for it, and `pg_dump` is not a thing this process may assume exists), and a
 * SQLite file on a network share is still local. Anything that is neither — a
 * `sqlite:` connection whose DSN is `:memory:` or relative — is listed as
 * external too, which is the honest answer: the manifest says the connection
 * existed and says its bytes are not in this archive.
 */
export async function discoverSources(
  meta: MetaDb,
  crypto: DsnCrypto,
): Promise<DiscoveredSources> {
  const repo = connectionsRepo(meta, crypto);
  const connections: Connection[] = await repo.list();

  const local: LocalDatabaseSource[] = [];
  const external: ExternalDatabaseSource[] = [];
  const taken = new Set<string>();

  const claim = (candidate: string): string => {
    const slug = uniqueSlug(candidate, taken);
    taken.add(slug);
    return slug;
  };

  for (const connection of connections) {
    const file = connection.engine === 'sqlite' ? localFileOf(await dataDsnOf(repo, connection)) : null;

    if (file === null) {
      external.push({
        connectionId: connection.id,
        slug: claim(deriveDatabaseSlug(connection.name, connection.id)),
        engine: connection.engine,
      });
      continue;
    }

    local.push({
      connectionId: connection.id,
      slug: claim(deriveDatabaseSlug(file, connection.id)),
      path: resolve(file),
    });
  }

  return { local, external };
}

/**
 * The data DSN, or `null` when it cannot be read.
 *
 * A decrypt failure means `ADMINIUM_SECRET` no longer opens this row — the
 * keyring case `config.ts`'s {@link SecretUnavailableError} exists for, seen from
 * the other side. It must NOT become an exception here: a backup is precisely
 * what a user with one unreadable connection needs to take before touching
 * anything, and failing the whole archive over one row would deny them the copy
 * of the other nine. The row still appears in the manifest, as external — i.e.
 * "this connection existed and its bytes are not in here", which is true.
 */
async function dataDsnOf(
  repo: ReturnType<typeof connectionsRepo>,
  connection: Connection,
): Promise<string | null> {
  try {
    return (await repo.getDsns(connection.id))?.dataDsn ?? null;
  } catch {
    return null;
  }
}

/**
 * Snapshot `sourcePath` to `destPath` with SQLite's online backup.
 *
 * Awaited rather than fire-and-forget: better-sqlite3's `backup()` returns a
 * promise that resolves when `remainingPages` hits 0, and a caller that hashed
 * the destination without waiting would hash a partial file and write a checksum
 * for a database that does not exist yet.
 */
export async function snapshotSqliteFile(sourcePath: string, destPath: string): Promise<void> {
  await mkdir(dirname(destPath), { recursive: true });
  const db = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    await db.backup(destPath);
  } finally {
    db.close();
  }
}
