// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Reading and unpacking a §9 archive (11-electron.md §9), from the main process.
 *
 * The suite is written against the ATTACK and the ACCIDENT, not the happy path,
 * because this module is the one place in the shell that opens a file a user
 * double-clicked — §2.2 step 1 forwards a launch argument straight here, and
 * that file may have come from an email.
 *
 * The three claims §9 makes, each pinned independently:
 *   1. checksums are verified BEFORE any data moves;
 *   2. a backup newer than the app is REFUSED ("Update Adminium first"), and an
 *      older one is accepted so the migration runner can fast-forward it;
 *   3. the unpack cannot write outside `<dataDir>`, and never restores
 *      `config.json`.
 */

import { createHash } from 'node:crypto';

import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import {
  BACKUP_CONFIG_PATH,
  BACKUP_FORMAT_VERSION,
  BACKUP_MANIFEST_PATH,
  BACKUP_META_PATH,
  BackupArchiveError,
  compareMetaMigrationVersion,
  moveDataAside,
  unpackArchive,
  validateArchive,
  type BackupManifest,
  type FsDeps,
} from './backup-archive.js';

const APP_META_VERSION = '0009_views_kind';

const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

interface BuildOptions {
  metaBytes?: Uint8Array;
  databases?: { slug: string; bytes: Uint8Array }[];
  manifest?: (base: BackupManifest) => unknown;
  /** Extra members the manifest does not describe. */
  extra?: Record<string, Uint8Array>;
  omitManifest?: boolean;
}

/** A real §9 archive, byte-for-byte the shape `createBackup` writes. */
function buildArchive(opts: BuildOptions = {}): Uint8Array {
  const metaBytes = opts.metaBytes ?? strToU8('SQLite format 3\x00 pretend meta store');
  const databases = opts.databases ?? [{ slug: 'orders', bytes: strToU8('pretend orders db') }];

  const base: BackupManifest = {
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion: '1.2.3',
    serverVersion: '0.5.0',
    metaMigrationVersion: APP_META_VERSION,
    createdAt: Date.parse('2026-07-12T14:30:00.000Z'),
    meta: { file: BACKUP_META_PATH, bytes: metaBytes.byteLength, sha256: sha(metaBytes) },
    databases: databases.map((db) => ({
      kind: 'local' as const,
      slug: db.slug,
      file: `databases/${db.slug}.sqlite`,
      bytes: db.bytes.byteLength,
      sha256: sha(db.bytes),
      connectionId: `conn_${db.slug}`,
      sourcePath: `/data/databases/${db.slug}.sqlite`,
    })),
  };

  const manifest = opts.manifest === undefined ? base : opts.manifest(base);
  const files: Record<string, Uint8Array> = {
    [BACKUP_META_PATH]: metaBytes,
    [BACKUP_CONFIG_PATH]: strToU8(JSON.stringify({ version: 1, singleUser: true })),
    ...opts.extra,
  };
  if (!opts.omitManifest) {
    files[BACKUP_MANIFEST_PATH] = strToU8(JSON.stringify(manifest, null, 2));
  }

  const nested: Record<string, unknown> = { ...files };
  const dbDir: Record<string, Uint8Array> = {};
  for (const db of databases) dbDir[`${db.slug}.sqlite`] = db.bytes;
  nested.databases = dbDir;

  return zipSync(nested as Parameters<typeof zipSync>[0]);
}

/**
 * The data dir every fixture is built for: `buildArchive` writes
 * `sourcePath: /data/databases/<slug>.sqlite`, which is exactly where an install
 * rooted at `/data` keeps them. That makes the default fixture RESTORABLE, and
 * makes `assertRestorablePaths` a thing a test has to opt INTO breaking.
 */
const DATA_DIR = '/data';

function validate(
  bytes: Uint8Array,
  appMetaVersion: string | null = APP_META_VERSION,
  dataDir: string = DATA_DIR,
) {
  return validateArchive({
    path: '/Users/ava/adminium-backup-20260712-1430.zip',
    appMetaVersion,
    dataDir,
    readFile: () => Promise.resolve(bytes),
  });
}

/** An in-memory filesystem, so a restore is assertable without touching a disk. */
function memoryFs(): FsDeps & { writes: Map<string, Uint8Array>; renames: [string, string][] } {
  const writes = new Map<string, Uint8Array>();
  const renames: [string, string][] = [];
  const existing = new Set(['/data/meta.db', '/data/meta.db-wal', '/data/databases']);
  return {
    writes,
    renames,
    mkdir: () => Promise.resolve(),
    rename: (from, to) => {
      if (!existing.has(from)) {
        // A REAL errno, not a bare Error: `moveDataAside` now distinguishes
        // ENOENT (nothing to move — fine) from everything else (abort), so a
        // fake that lost the code would test the wrong branch.
        const error = new Error(`ENOENT: no such file, rename '${from}'`) as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        return Promise.reject(error);
      }
      renames.push([from, to]);
      return Promise.resolve();
    },
    writeFile: (path, bytes) => {
      writes.set(path, bytes);
      return Promise.resolve();
    },
  };
}

// ─── Validation (§9) ─────────────────────────────────────────────────────────

describe('validateArchive', () => {
  it('accepts a well-formed archive from the same version', async () => {
    const archive = await validate(buildArchive());
    expect(archive.order).toBe('same');
    expect(archive.manifest.metaMigrationVersion).toBe(APP_META_VERSION);
    expect(archive.databases.map((d) => d.slug)).toEqual(['orders']);
  });

  it('accepts an OLDER backup so the migration runner can fast-forward it', async () => {
    // §9: "the migration runner fast-forwards an older backup". This is the
    // normal case — restoring last month's backup into this month's build — and
    // it needs no code beyond `start()` running after the unpack.
    const archive = await validate(
      buildArchive({
        manifest: (base) => ({ ...base, metaMigrationVersion: '0007_llm_runs' }),
      }),
    );
    expect(archive.order).toBe('older');
  });

  it('REFUSES a backup whose metaMigrationVersion is newer, with actionable copy', async () => {
    // §9's hard rule. Restoring it would run an incomplete migration set over a
    // schema this build has never seen.
    const promise = validate(
      buildArchive({
        manifest: (base) => ({ ...base, metaMigrationVersion: '0010_something_new' }),
      }),
    );
    await expect(promise).rejects.toThrow(BackupArchiveError);
    await expect(promise).rejects.toMatchObject({ rejection: 'migration-newer' });
    await expect(promise).rejects.toThrow(/Update Adminium first/);
  });

  it('refuses rather than skips the check when the app does not know its own version', async () => {
    // The handshake never happened (`ServerReadyInfo.metaVersion` is null). The
    // temptation is to skip the comparison; that is how an old build silently
    // accepts a newer backup. Refusing is the safe direction and says why.
    const promise = validate(buildArchive(), null);
    await expect(promise).rejects.toMatchObject({ rejection: 'unknown-app-version' });
    await expect(promise).rejects.toThrow(/server is not running/);
  });

  it('refuses a newer formatVersion before the schema can complain about it', async () => {
    // A v2 archive fails `strictObject` with a list of unknown keys. "Update
    // Adminium first" is a better answer, so the version gate runs first.
    const promise = validate(
      buildArchive({ manifest: (base) => ({ ...base, formatVersion: 2, somethingNew: true }) }),
    );
    await expect(promise).rejects.toMatchObject({ rejection: 'format-newer' });
    await expect(promise).rejects.toThrow(/Update Adminium first/);
  });

  it('rejects a zip that is not an Adminium backup', async () => {
    const promise = validate(zipSync({ 'notes.txt': strToU8('hello') }));
    await expect(promise).rejects.toMatchObject({ rejection: 'malformed' });
  });

  it('rejects bytes that are not a zip at all', async () => {
    const promise = validate(strToU8('this is a text file someone renamed'));
    await expect(promise).rejects.toMatchObject({ rejection: 'unreadable' });
  });

  it('rejects a manifest that is not valid JSON', async () => {
    const bytes = zipSync({ [BACKUP_MANIFEST_PATH]: strToU8('{ not json') });
    await expect(validate(bytes)).rejects.toMatchObject({ rejection: 'malformed' });
  });

  it('rejects a manifest with an unknown key — a hand-edit, not forward compat', async () => {
    const promise = validate(
      buildArchive({ manifest: (base) => ({ ...base, injectedField: 'surprise' }) }),
    );
    await expect(promise).rejects.toMatchObject({ rejection: 'malformed' });
  });

  it('detects a corrupted source database', async () => {
    const promise = validate(
      buildArchive({
        manifest: (base) => ({
          ...base,
          databases: [{ ...base.databases[0], sha256: 'f'.repeat(64) }],
        }),
      }),
    );
    await expect(promise).rejects.toMatchObject({ rejection: 'checksum' });
    await expect(promise).rejects.toThrow(/replace your data with a corrupted copy/);
  });

  it('detects a corrupted meta.db', async () => {
    // §9's example manifest has no checksum for meta.db. This is why it needs
    // one: an archive whose source DBs verify and whose meta.db is damaged would
    // pass validation and then destroy the install.
    const promise = validate(
      buildArchive({
        manifest: (base) => ({ ...base, meta: { ...base.meta, sha256: 'a'.repeat(64) } }),
      }),
    );
    await expect(promise).rejects.toMatchObject({ rejection: 'checksum' });
  });

  it('detects a truncated member by length before hashing it', async () => {
    const promise = validate(
      buildArchive({
        manifest: (base) => ({ ...base, meta: { ...base.meta, bytes: base.meta.bytes + 100 } }),
      }),
    );
    await expect(promise).rejects.toThrow(/manifest says/);
  });

  it('detects a member the manifest promises and the archive lacks', async () => {
    const promise = validate(
      buildArchive({
        databases: [],
        manifest: (base) => ({
          ...base,
          databases: [
            {
              kind: 'local',
              slug: 'ghost',
              file: 'databases/ghost.sqlite',
              bytes: 10,
              sha256: 'b'.repeat(64),
              connectionId: 'conn_ghost',
              sourcePath: '/data/databases/ghost.sqlite',
            },
          ],
        }),
      }),
    );
    await expect(promise).rejects.toThrow(/archive does not contain it/);
  });

  it('rejects a manifest slug outside the grammar — the zip-slip guard', async () => {
    // `../../config.json` as a slug would let a mailed .zip overwrite the file
    // holding ADMINIUM_SECRET. The grammar makes that unrepresentable, and the
    // schema is where an archive claiming otherwise is turned away.
    for (const hostile of ['../../etc/passwd', 'a/b', '..', 'UPPER', 'with space']) {
      const promise = validate(
        buildArchive({
          manifest: (base) => ({
            ...base,
            databases: [{ ...base.databases[0], slug: hostile }],
          }),
        }),
      );
      await expect(promise, hostile).rejects.toMatchObject({ rejection: 'malformed' });
    }
  });

  it('ignores a manifest `file` that disagrees with its slug', async () => {
    // `file` is data too. The member is re-derived from the (validated) slug, so
    // a manifest pointing `file` at `../../evil` describes a member that is
    // simply not there.
    const archive = await validate(
      buildArchive({
        manifest: (base) => ({
          ...base,
          databases: [{ ...base.databases[0], file: '../../evil' }],
        }),
      }),
    );
    expect(archive.databases[0]?.slug).toBe('orders');
  });

  it('does not verify members the manifest never mentioned', async () => {
    // An extra member is not a reason to refuse a good archive — but it must
    // never be extracted either. See the unpack suite.
    const archive = await validate(buildArchive({ extra: { 'stowaway.txt': strToU8('hi') } }));
    expect(archive.databases).toHaveLength(1);
  });
});

// ─── compareMetaMigrationVersion ─────────────────────────────────────────────

describe('validateArchive — the restore must be able to land correctly', () => {
  /** A manifest whose one local DB lived somewhere other than `<dataDir>/databases`. */
  const archiveWithSourcePath = (sourcePath: string): Uint8Array =>
    buildArchive({
      manifest: (base) => ({
        ...base,
        databases: base.databases.map((db) => ({ ...db, sourcePath })),
      }),
    });

  it('REFUSES a database that was opened in place, rather than silently restoring the wrong one', async () => {
    // ── THE SILENT-CORRUPTION GUARD.
    //
    // §6 step 2 card 2 registers a file where it lies: `sqlite:/Users/me/
    // archive/data.sqlite`. The backup writes it to `databases/data.sqlite`
    // (the slug comes from the BASENAME), and the restore writes that member to
    // `<dataDir>/databases/data.sqlite` — because `unpackArchive` will not
    // honour an absolute path out of an archive, and is right not to.
    //
    // Meanwhile meta.db is restored byte-for-byte, so the connection's DSN
    // still says `/Users/me/archive/data.sqlite`. Two failures, neither
    // announced: ~/archive is never written (the in-place database is NOT
    // rolled back, and still serves today's rows), and if a wizard-created
    // "Data" already owns `<dataDir>/databases/data.sqlite`, its database is
    // overwritten with a stranger's bytes. The dialog said "Restore complete".
    const promise = validate(archiveWithSourcePath('/Users/me/archive/data.sqlite'));
    await expect(promise).rejects.toThrow(BackupArchiveError);
    await expect(promise).rejects.toThrow(/cannot be restored onto this copy/);
    // It names the database — "this backup cannot be restored" alone is a dead end.
    await expect(promise).rejects.toThrow(/\/Users\/me\/archive\/data\.sqlite/);
    // And it says the truth about the user's data: validation runs before the
    // server stops and before anything moves.
    await expect(promise).rejects.toThrow(/Nothing has been changed/);
  });

  it('REFUSES a backup from another computer, whose DSNs would all dangle', async () => {
    // Same root cause, different shape: every `sourcePath` names the SOURCE
    // machine's data dir, so the bytes would land under this machine's while
    // every restored DSN pointed at a directory that does not exist here.
    const promise = validate(buildArchive(), APP_META_VERSION, '/Users/ava/Library/Adminium/data');
    await expect(promise).rejects.toThrow(/cannot be restored onto this copy/);
    // The remedy must be one that EXISTS. §9 claims `adminium import-zip`
    // accepts this archive; it does not (see `server/src/backup/format.ts`'s
    // header — the CLI reads a different format that also calls itself
    // formatVersion 1), so pointing the user at it would be a dead end dressed
    // as help. The zip is a zip; opening it is advice that works today.
    await expect(promise).rejects.toThrow(/under "databases\/"/);
    await expect(promise).rejects.not.toThrow(/import-zip/);
  });

  it('accepts the ordinary case: the databases are already where this install keeps them', async () => {
    // The restore §9's acceptance criterion names ("restore round-trips on the
    // same version"). The guard must not cost this anything.
    const result = await validate(buildArchive());
    expect(result.databases.map((d) => d.slug)).toEqual(['orders']);
  });

  it('accepts a path that differs only in spelling, not in destination', async () => {
    // `resolve` on both sides: `/data/databases/../databases/orders.sqlite` IS
    // `<dataDir>/databases/orders.sqlite`, and refusing it would be the gate
    // misfiring on a legitimate restore.
    const result = await validate(archiveWithSourcePath('/data/databases/../databases/orders.sqlite'));
    expect(result.databases).toHaveLength(1);
  });

  it('accepts an archive with no local databases at all (remote-only install)', async () => {
    // Every source is an external PG/MySQL: nothing is dumped, so there is no
    // path that could be wrong, and the meta.db restore is the whole job.
    const result = await validate(buildArchive({ databases: [] }));
    expect(result.databases).toEqual([]);
  });
});

describe('compareMetaMigrationVersion', () => {
  it('mirrors the server: lexicographic over zero-padded ordinals', () => {
    expect(compareMetaMigrationVersion('0009_views_kind', '0009_views_kind')).toBe('same');
    expect(compareMetaMigrationVersion('0001_core_auth', '0009_views_kind')).toBe('older');
    expect(compareMetaMigrationVersion('0010_new', '0009_views_kind')).toBe('newer');
    // The padding is what makes string order == apply order.
    expect(compareMetaMigrationVersion('0009_a', '0010_b')).toBe('older');
  });
});

// ─── Pre-restore safety copy (§9) ────────────────────────────────────────────

describe('moveDataAside', () => {
  /** "There is no such file" — which for a sidecar is the ordinary case. */
  const enoent = (): Promise<never> => {
    const error = new Error('ENOENT') as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    return Promise.reject(error);
  };

  it('MOVES meta.db, its WAL sidecars and databases/ into pre-restore-<ts>', async () => {
    const fs = memoryFs();
    const result = await moveDataAside('/data', 'pre-restore-2026-07-12T14-30-00-000Z', fs);

    expect(result.dir).toBe('/data/pre-restore-2026-07-12T14-30-00-000Z');
    // meta.db LAST, and the order is load-bearing rather than incidental: it is
    // the file whose absence turns a failed restore into a fresh first-run
    // install, so it is exposed for the shortest possible window.
    expect(result.moved).toEqual(['meta.db-wal', 'databases', 'meta.db']);
    // A WAL left next to a restored meta.db describes pages that database does
    // not have — and SQLite would apply them.
    expect(fs.renames).toContainEqual([
      '/data/meta.db-wal',
      '/data/pre-restore-2026-07-12T14-30-00-000Z/meta.db-wal',
    ]);
  });

  it('never deletes anything — §9: "not deleted"', async () => {
    // The module has no delete. This asserts the ABSENCE, which is the whole
    // promise the confirm dialog makes.
    const fs = memoryFs();
    await moveDataAside('/data', 'pre-restore-x', fs);
    expect(Object.keys(fs)).not.toContain('rm');
    expect(Object.keys(fs)).not.toContain('unlink');
  });

  it('tolerates a data dir with nothing to move', async () => {
    // A first restore into a fresh install. Aborting here would fail a restore
    // that had not started.
    const result = await moveDataAside('/data', 'pre-restore-x', {
      mkdir: () => Promise.resolve(),
      rename: enoent,
      writeFile: () => Promise.resolve(),
    });
    expect(result.moved).toEqual([]);
  });

  it('ABORTS when a file exists but cannot be moved, rather than letting the unpack overwrite it', async () => {
    // ── THE DATA-LOSS GUARD. A locked meta.db (Windows EBUSY, an EPERM, a full
    // disk) must not be shrugged off: the very next step WRITES meta.db at that
    // same path, so a swallowed failure means nothing moved aside, an empty
    // pre-restore folder, and the user's live meta store overwritten in place —
    // with the confirm dialog's "not deleted" promise already on screen.
    // Refusing here costs the user a retry; not refusing costs them everything.
    const ebusy = (): Promise<never> => {
      const error = new Error('EBUSY: resource busy or locked') as NodeJS.ErrnoException;
      error.code = 'EBUSY';
      return Promise.reject(error);
    };
    const promise = moveDataAside('/data', 'pre-restore-x', {
      mkdir: () => Promise.resolve(),
      rename: ebusy,
      writeFile: () => Promise.resolve(),
    });

    await expect(promise).rejects.toThrow(BackupArchiveError);
    await expect(promise).rejects.toThrow(/could not move "meta.db-wal" aside/);
    // And the message says the data is untouched, because it is.
    await expect(promise).rejects.toThrow(/Nothing has been changed/);
  });

  it('ROLLS BACK the moves it already made when a later one fails', async () => {
    // ── THE WINDOWS SCENARIO, and the one this function shipped broken.
    //
    // The user has <dataDir>/databases/orders.sqlite open in DB Browser for
    // SQLite. Windows cannot rename a directory containing an open file, so:
    // meta.db-wal moves, `databases` fails EBUSY. Before the rollback, the old
    // ordering had already moved meta.db too — and the caller then said
    // "Nothing has been changed" and restarted the server against a dataDir
    // with NO meta.db, so `firstRun` built an empty meta store and dropped the
    // user into §6's first-run wizard with zero users and zero connections.
    //
    // Every rename this made must be undone before it throws, or the message
    // below is a lie.
    const renames: [string, string][] = [];
    const promise = moveDataAside('/data', 'pre-restore-x', {
      mkdir: () => Promise.resolve(),
      rename: (from, to) => {
        if (from === '/data/databases') {
          const error = new Error('EBUSY: resource busy or locked') as NodeJS.ErrnoException;
          error.code = 'EBUSY';
          return Promise.reject(error);
        }
        // A cleanly-closed server leaves no -shm; ENOENT is "nothing to move".
        if (from === '/data/meta.db-shm') return enoent();
        renames.push([from, to]);
        return Promise.resolve();
      },
      writeFile: () => Promise.resolve(),
    });

    await expect(promise).rejects.toThrow(/could not move "databases" aside/);
    await expect(promise).rejects.toThrow(/Nothing has been changed/);

    // The claim, checked against the filesystem rather than the prose: the WAL
    // went out and came back, so `/data` holds everything it started with.
    expect(renames).toEqual([
      ['/data/meta.db-wal', '/data/pre-restore-x/meta.db-wal'],
      ['/data/pre-restore-x/meta.db-wal', '/data/meta.db-wal'],
    ]);
    // meta.db never moved at all — it is last precisely so this is true.
    expect(renames.some(([from]) => from === '/data/meta.db')).toBe(false);
  });

  it('says so honestly when the rollback ITSELF fails', async () => {
    // The one state where the user has to do something by hand. Promising
    // "Nothing has been changed" here would be the same lie in a new place, so
    // the message names the files and tells them what to do.
    const promise = moveDataAside('/data', 'pre-restore-x', {
      mkdir: () => Promise.resolve(),
      rename: (from) => {
        // The forward move of the WAL is the only thing that ever works: the
        // `databases` move fails, and so does putting the WAL back.
        if (from === '/data/meta.db-wal') return Promise.resolve();
        if (from === '/data/meta.db-shm') return enoent();
        const error = new Error('EPERM: operation not permitted') as NodeJS.ErrnoException;
        error.code = 'EPERM';
        return Promise.reject(error);
      },
      writeFile: () => Promise.resolve(),
    });

    await expect(promise).rejects.toThrow(/could not move "databases" aside/);
    await expect(promise).rejects.toThrow(/could not put "meta.db-wal" back/);
    await expect(promise).rejects.not.toThrow(/Nothing has been changed/);
  });
});

// ─── Unpack (§9) ─────────────────────────────────────────────────────────────

describe('unpackArchive', () => {
  it('writes meta.db and every local database into the data dir', async () => {
    const archive = await validate(buildArchive());
    const fs = memoryFs();
    const result = await unpackArchive(archive, '/data', fs);

    expect(result.written.sort()).toEqual(['/data/databases/orders.sqlite', '/data/meta.db']);
    expect(fs.writes.get('/data/meta.db')).toBeDefined();
  });

  it('NEVER restores config.json — it would wipe ADMINIUM_SECRET', async () => {
    // THE most important assertion in this file. The archive's config.json is
    // redacted (§9), so writing it back over <userData>/config.json would
    // replace the master secret with `null` and make every encrypted DSN, LLM
    // key and TOTP secret in the meta.db we just restored permanently
    // unreadable. The redaction that makes the archive safe to share is exactly
    // what makes it unusable as a config to restore.
    const archive = await validate(buildArchive());
    const fs = memoryFs();
    const result = await unpackArchive(archive, '/data', fs);

    expect(result.written.some((p) => p.endsWith('config.json'))).toBe(false);
    expect(fs.writes.has('/data/config.json')).toBe(false);
  });

  it('does not write the manifest either — it describes the archive, not the install', async () => {
    const archive = await validate(buildArchive());
    const fs = memoryFs();
    const result = await unpackArchive(archive, '/data', fs);
    expect(result.written.some((p) => p.endsWith('manifest.json'))).toBe(false);
  });

  it('does not extract a member the manifest never listed', async () => {
    // The allow-list is the manifest. A stowaway rides in the zip and goes
    // nowhere.
    const archive = await validate(buildArchive({ extra: { 'stowaway.txt': strToU8('hi') } }));
    const fs = memoryFs();
    await unpackArchive(archive, '/data', fs);
    expect([...fs.writes.keys()].some((p) => p.includes('stowaway'))).toBe(false);
  });

  it('writes every member inside the data dir and nowhere else', async () => {
    const archive = await validate(
      buildArchive({
        databases: [
          { slug: 'orders', bytes: strToU8('a') },
          { slug: 'people', bytes: strToU8('b') },
        ],
      }),
    );
    const fs = memoryFs();
    const result = await unpackArchive(archive, '/data', fs);
    expect(result.written.every((path) => path.startsWith('/data/'))).toBe(true);
  });
});
