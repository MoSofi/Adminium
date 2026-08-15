/**
 * Moving a live meta store to a different database (01-architecture.md §3.1
 * meta placement; §7.2 bootstrap precedence).
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * Meta placement used to be answerable only before the store existed, which the
 * terminal wizard can do (it asks at step 0, before `openRuntime`) and the
 * browser wizard fundamentally cannot: the Studio is served BY a running
 * server, so a store already exists by the time anyone can be asked where it
 * should live. The Studio's meta step therefore validated a choice and then
 * dropped it, and picking "same database" in the browser silently left the
 * embedded SQLite store in place. This is the missing half.
 *
 * ── ORDER OF OPERATIONS, AND WHY NOTHING IS DESTRUCTIVE UNTIL THE END ───────
 * Every step before the bootstrap write is either a read or a write to the NEW
 * database. Nothing touches the old store, and nothing tells the next boot
 * where to look, until the copy has been made and verified. So a failure at any
 * point leaves an instance that is still completely operational on its existing
 * store — the target is rolled back by {@link copyMetaStore}'s transaction, and
 * the worst residue is an empty set of `adminium_*` tables in a database the
 * operator chose.
 *
 * The bootstrap write is the commit point. After it, `resolveMetaUrl` will
 * answer with the new DSN.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ──────────────────────────────────────
 * It does not close the source, and it does not rename the retired SQLite file.
 * Both belong to the caller, and specifically to the caller AFTER it has torn
 * the server down: the server still holds an open better-sqlite3 handle on that
 * file, and Windows refuses to rename an open file (the same EBUSY trap
 * `desktop/main/backup-archive.ts` documents at length). The path comes back as
 * {@link RelocateMetaStoreResult.retiredSqlitePath} for the caller to deal with
 * once the handle is gone.
 */

import { randomUUID } from 'node:crypto';
import { rename } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  applyMigrations,
  assertMetaStoreEmpty,
  copyMetaStore,
  MetaRelocateError,
  MetaStoreNotEmptyError,
} from '@adminium/meta';

import { bootstrapPath, readBootstrap, writeBootstrap } from '../config/bootstrap.js';
import {
  connectMetaStore,
  metaEngineFromUrl,
  metaUrlCryptoFromSecret,
  sqlitePathFromUrl,
  type MetaEngine,
  type MetaStoreHandle,
} from './store.js';

export { MetaRelocateError, MetaStoreNotEmptyError };

/** The target is the store we are already using — a move to nowhere. */
export class MetaAlreadyThereError extends MetaRelocateError {
  override readonly name = 'MetaAlreadyThereError';
  constructor(url: string) {
    super(`Adminium's tables already live there (${url}). Nothing to move.`);
  }
}

/**
 * `ADMINIUM_META_URL` is set, so §7.2 precedence would override the bootstrap
 * file this writes and the instance would return to the old store on restart.
 *
 * Refusing is the only honest answer: performing the copy would produce a
 * populated new database, a bootstrap file nobody reads, and an instance still
 * serving from the old store — a "successful" relocation that silently did not
 * happen.
 */
export class MetaUrlPinnedError extends MetaRelocateError {
  override readonly name = 'MetaUrlPinnedError';
  constructor() {
    super(
      "This instance's meta store is pinned by ADMINIUM_META_URL, which takes precedence over " +
        'the setup file this would write — the move would be undone by the next restart. ' +
        'Unset ADMINIUM_META_URL (or point it at the new database yourself) and try again.',
    );
  }
}

/** The target role cannot host a meta store. */
export class MetaTargetNotWritableError extends MetaRelocateError {
  override readonly name = 'MetaTargetNotWritableError';
  constructor(cause: unknown) {
    super(
      'Could not create Adminium’s tables in the target database — the role needs write and ' +
        `CREATE TABLE privileges there. (${cause instanceof Error ? cause.message : String(cause)})`,
      { cause },
    );
  }
}

/**
 * Best-effort identity for a DSN, for the "you are already there" guard.
 *
 * SQLite compares by resolved path. Everything else compares scheme, host, port
 * and database, ignoring credentials — connecting as a different user to the
 * same database is still the same store. Deliberately not exhaustive: this
 * catches the mistake a person makes, not every alias a DNS layer could invent,
 * and a miss costs a {@link MetaStoreNotEmptyError} rather than data.
 */
function storeIdentity(url: string): string {
  if (metaEngineFromUrl(url) === 'sqlite') {
    const path = sqlitePathFromUrl(url);
    return path === ':memory:' ? 'sqlite::memory:' : `sqlite:${resolve(path)}`;
  }
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

/**
 * What the relocation route reports once the copy has committed.
 *
 * Declared HERE, beside the service that produces it, rather than in
 * `cli/relocation-host.ts` where it is consumed: the host imports from
 * `cli/runtime.ts`, and `cli/runtime.ts` needs this type to describe
 * `StartServerOptions` — so a home in the host would make that pair circular.
 */
export interface MetaRelocation {
  /** The DSN the store now lives at. */
  url: string;
  engine: MetaEngine;
  /**
   * The SQLite file the instance moved OFF, or null. Retired by the HOST, once
   * it has released the server's better-sqlite3 handle — see the module note.
   */
  retiredSqlitePath: string | null;
}

/**
 * Fired by `POST /api/v1/meta/relocate` AFTER its response has flushed. Returns
 * void: the caller is an HTTP handler whose reply is already on the wire, and
 * it has nothing useful to do with a promise for its own teardown.
 */
export type OnMetaRelocated = (relocation: MetaRelocation) => void;

export interface RelocateMetaStoreOptions {
  /** The live store. Read only — never written, never closed, by this. */
  from: MetaStoreHandle;
  /** Where it should live. */
  toUrl: string;
  /** `ADMINIUM_SECRET` — encrypts the DSN into the bootstrap file. */
  secret: string;
  dataDir: string;
  /** `ADMINIUM_META_URL`, when the environment pins one. */
  envMetaUrl?: string | undefined;
  poolSize?: number | undefined;
  onProgress?: ((table: string, rows: number) => void) | undefined;
}

export interface RelocateMetaStoreResult {
  url: string;
  engine: MetaEngine;
  totalRows: number;
  tables: { table: string; rows: number }[];
  /** Where the bootstrap file was written. */
  bootstrapFile: string;
  /**
   * The SQLite file the instance just moved OFF, when it was on one. The caller
   * renames it AFTER closing the store — see the module note.
   */
  retiredSqlitePath: string | null;
}

/**
 * Copy the whole meta store to `toUrl` and record it as this instance's store.
 *
 * On success the bootstrap file names the new DSN, so the next `resolveMetaUrl`
 * answers with it. The caller is responsible for actually restarting against
 * the new store — until it does, the server is still serving from `from`.
 */
export async function relocateMetaStore(
  opts: RelocateMetaStoreOptions,
): Promise<RelocateMetaStoreResult> {
  const { from, toUrl, secret, dataDir } = opts;

  if (opts.envMetaUrl !== undefined && opts.envMetaUrl !== '') throw new MetaUrlPinnedError();

  // Throws MetaUrlError with the three supported forms spelled out.
  const engine = metaEngineFromUrl(toUrl);

  if (storeIdentity(toUrl) === storeIdentity(from.url)) throw new MetaAlreadyThereError(toUrl);

  if (engine === 'sqlite' && sqlitePathFromUrl(toUrl) === ':memory:') {
    throw new MetaRelocateError(
      'An in-memory SQLite store would be discarded the moment Adminium restarts.',
    );
  }

  const target = await connectMetaStore(
    { url: toUrl, engine, source: 'bootstrap' },
    { poolSize: opts.poolSize },
  );

  try {
    // The migration run IS the write + DDL probe (01 §3.1's rule for same-db
    // placement): a read-only or DDL-less role cannot get past it, and saying so
    // in those terms beats surfacing a raw driver permission error.
    try {
      await applyMigrations(target.meta.db, { dialect: target.meta.dialect });
    } catch (error) {
      throw new MetaTargetNotWritableError(error);
    }

    // Before a single row is written: merging two stores would collide on
    // primary keys halfway through and leave the operator reasoning about which
    // half of which instance they are now looking at.
    await assertMetaStoreEmpty(target.meta);

    const copied = await copyMetaStore({
      from: from.meta,
      to: target.meta,
      onProgress: opts.onProgress,
    });

    // ── commit point ────────────────────────────────────────────────────────
    // An existing instanceId is preserved: it is this installation's identity
    // across restarts, and minting a new one because the tables moved would
    // make the instance look like a different one to anything keyed on it.
    const existing = await readBootstrap(dataDir);
    await writeBootstrap(dataDir, {
      v: 1,
      metaUrl: metaUrlCryptoFromSecret(secret).encrypt(toUrl),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      instanceId: existing?.instanceId ?? randomUUID(),
    });

    return {
      url: toUrl,
      engine,
      totalRows: copied.totalRows,
      tables: copied.tables,
      bootstrapFile: resolve(bootstrapPath(dataDir)),
      retiredSqlitePath:
        from.engine === 'sqlite' ? resolve(sqlitePathFromUrl(from.url)) : null,
    };
  } finally {
    // The target is opened for the copy and nothing else — the server rebuilds
    // its own handle when it restarts. Leaving this pool open would leak one
    // per relocation attempt, failures included.
    await target.close();
  }
}

/**
 * The sidecars a SQLite database keeps beside itself. Copied from
 * `desktop/main/backup-archive.ts`, and for the identical reason it gives:
 * leaving them behind "is a corruption bug wearing a harmless leftover
 * costume". SQLite validates a write-ahead log by its own header and salt
 * rather than against the database sitting next to it, so a fresh `meta.db`
 * created beside a retired one's `-wal` will recover stale frames into it.
 */
const SQLITE_SIDECARS = ['-wal', '-shm'] as const;

export type RetireResult = { renamedTo: string; moved: string[] } | { error: Error };

/**
 * Rename a retired SQLite store out of the way, once nothing holds it open.
 *
 * RENAMED, NOT DELETED: this file is the only copy of everything the instance
 * knew a moment ago, and the minutes after a migration are exactly when someone
 * wants it back. Renaming also disarms it — if the bootstrap file is ever lost
 * (a changed `ADMINIUM_SECRET` is the documented way that happens), §7.2's third
 * rung would otherwise reopen this stale store and present the pre-move
 * instance as the real one.
 *
 * ALL OR NOTHING, for the reason `backup-archive.ts` learned the hard way: a
 * run that moved `meta.db` but failed on `meta.db-wal` leaves the exact
 * corruption the sidecar list exists to prevent. A partial failure therefore
 * rolls back every rename it made, leaving the store exactly where it was.
 *
 * Failure is reported, never thrown. By the time this runs the relocation has
 * committed and the bootstrap file already points at the new store, so a file
 * that could not be renamed is untidy, not broken.
 */
export async function retireSqliteStore(path: string, now: Date = new Date()): Promise<RetireResult> {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const suffix = `.relocated-${stamp}`;
  const done: { from: string; to: string }[] = [];

  try {
    for (const source of [path, ...SQLITE_SIDECARS.map((tail) => `${path}${tail}`)]) {
      const target =
        source === path ? `${path}${suffix}` : `${path}${suffix}${source.slice(path.length)}`;
      try {
        await rename(source, target);
        done.push({ from: source, to: target });
      } catch (error) {
        // A sidecar that is not there is the normal case — the meta store runs
        // in SQLite's default rollback-journal mode, where `-wal`/`-shm` exist
        // only if something enabled WAL on it.
        if ((error as NodeJS.ErrnoException).code === 'ENOENT' && source !== path) continue;
        throw error;
      }
    }
    return { renamedTo: `${path}${suffix}`, moved: done.map((entry) => entry.from) };
  } catch (error) {
    for (const entry of done.reverse()) {
      await rename(entry.to, entry.from).catch(() => undefined);
    }
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }
}
