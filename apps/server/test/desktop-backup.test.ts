// SPDX-License-Identifier: AGPL-3.0-only
/**
 * 11-T12 — the §9 desktop backup, from the server side (11-electron.md §9).
 *
 * The suite is built around the claims §9 makes about an archive:
 *   1. it matches the §9 layout, and `formatVersion: 1` is FROZEN;
 *   2. every local SQLite DB is snapshotted with the ONLINE backup API — so a
 *      row committed to the WAL and never checkpointed is in the archive;
 *   3. remote PG/MySQL are listed as "external" and never dumped;
 *   4. `config.json` travels with its secrets stripped, and the writer refuses
 *      to write one that is not;
 *   5. `<dataDir>/backups` rotates to `autoBackup.keep`;
 *   6. the route exists only on desktop, refuses non-loopback peers, and needs
 *      a super-admin session.
 *
 * Claim 2 is the one worth the setup cost. A `copyFile` implementation passes
 * every OTHER assertion here — the zip has the right members, the checksums
 * match the bytes, the manifest is well-formed — and silently loses the last
 * commits. It is the exact failure §9 wrote "WAL-safe, no locking of live
 * writers" to prevent, and `wal-safe` below is the only thing standing between
 * that sentence and a backup nobody notices is short.
 */

import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  connectionsRepo,
  createFirstSuperAdmin,
  createSqliteMetaDb,
  destroyMetaDb,
  firstRun,
  initMetaDb,
  type MetaDb,
  type User,
} from '@adminium/meta';

import {
  BACKUP_CONFIG_PATH,
  BACKUP_FORMAT_VERSION,
  BACKUP_MANIFEST_PATH,
  BACKUP_META_PATH,
  BACKUP_FILE_PATTERN,
  backupFileName,
  backupManifestSchema,
  compareMetaMigrationVersion,
  deriveDatabaseSlug,
  preRestoreDirName,
  sha256Hex,
  uniqueSlug,
  type BackupManifest,
} from '../src/backup/format.js';
import {
  BackupRedactionError,
  DEFAULT_AUTO_BACKUP_KEEP,
  assertNoSecrets,
  createBackup,
  rotateBackups,
} from '../src/backup/backup-service.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';

const MASTER_SECRET = 'test-secret-that-is-at-least-32-chars-long';

/**
 * Deliberately absurd and unique. If this string ever appears in an archive, a
 * secret leaked — there is no innocent reason for the bytes
 * "SENTINEL-DESKTOP-SECRET-…" to be inside a backup zip. Same device the M10
 * export suite uses, for the same reason.
 */
const SECRET_SENTINEL = 'SENTINEL-DESKTOP-SECRET-8c41fa02';

interface Fixture {
  dir: string;
  meta: MetaDb;
  metaPath: string;
  admin: User;
  crypto: ReturnType<typeof dsnCryptoFromSecret>;
  destroy: () => Promise<void>;
}

/**
 * A real desktop-shaped install: a meta store ON DISK (an in-memory one has no
 * file to snapshot, which is the whole subject here) plus `<dataDir>/databases`.
 */
async function fixture(): Promise<Fixture> {
  const dir = await mkdtemp(join(tmpdir(), 'adminium-backup-'));
  const metaPath = join(dir, 'meta.db');
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(metaPath) });
  await initMetaDb(meta);
  await firstRun(meta);
  const admin = await createFirstSuperAdmin(meta, {
    email: 'ava@adminium.io',
    name: 'Ava Reyes',
    passwordHash: 'not-a-real-hash-but-a-real-row',
  });
  return {
    dir,
    meta,
    metaPath,
    admin,
    crypto: dsnCryptoFromSecret(MASTER_SECRET),
    destroy: async () => {
      await destroyMetaDb(meta);
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/** A WAL-mode SQLite source DB, registered as a local connection. */
async function addLocalDatabase(
  f: Fixture,
  slug: string,
  seed: (db: BetterSqlite3.Database) => void,
): Promise<{ path: string; connectionId: string; db: BetterSqlite3.Database }> {
  const path = join(f.dir, 'databases', `${slug}.sqlite`);
  await writeFile(path, '', { flag: 'w' }).catch(async () => {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(f.dir, 'databases'), { recursive: true });
  });
  const { mkdir } = await import('node:fs/promises');
  await mkdir(join(f.dir, 'databases'), { recursive: true });

  const db = new BetterSqlite3(path);
  // §9's pragma block. WAL is not incidental here — it is the condition under
  // which a naive copy loses data.
  db.pragma('journal_mode = WAL');
  seed(db);

  const connection = await connectionsRepo(f.meta, f.crypto).create({
    name: slug,
    engine: 'sqlite',
    introspectDsn: `sqlite:${path}`,
    dataDsn: `sqlite:${path}`,
    status: 'connected',
  });
  return { path, connectionId: connection.id, db };
}

function readArchive(bytes: Uint8Array): {
  members: Record<string, Uint8Array>;
  manifest: BackupManifest;
} {
  const members = unzipSync(bytes);
  const raw = members[BACKUP_MANIFEST_PATH];
  expect(raw, 'the archive has a manifest.json').toBeDefined();
  const manifest = backupManifestSchema.parse(
    JSON.parse(new TextDecoder().decode(raw as Uint8Array)),
  );
  return { members, manifest };
}

/** The redacted `config.json` the main process sends (`redactConfig`'s output). */
function redactedConfig(): Record<string, unknown> {
  return {
    version: 1,
    dataDir: '/data',
    secretStorage: 'safeStorage',
    singleUser: true,
    lanShare: { enabled: false, port: 4600 },
    updates: { mode: 'notify' },
    telemetryOptIn: false,
    autoBackup: { enabled: true, keep: 7 },
    window: { width: 1440, height: 900, maximized: false },
  };
}

// ─── The format (§9) ─────────────────────────────────────────────────────────

describe('§9 backup format', () => {
  it('freezes formatVersion at 1', () => {
    // §9: "format frozen here as `formatVersion: 1`". The M10 CLI's import reads
    // this number to decide whether it understands the archive at all, so
    // bumping it is a compatibility event, not an edit. If this test fails,
    // that is the conversation it is asking for.
    expect(BACKUP_FORMAT_VERSION).toBe(1);
  });

  it('names archives adminium-backup-YYYYMMDD-HHMMSS.zip in UTC', () => {
    const name = backupFileName(Date.parse('2026-07-12T14:30:05.000Z'));
    expect(name).toBe('adminium-backup-20260712-143005.zip');
    expect(BACKUP_FILE_PATTERN.test(name)).toBe(true);
  });

  it('sorts names in chronological order, which is what rotation relies on', () => {
    // Rotation sorts by NAME because mtime does not survive a file copy. That is
    // only safe if the names are ordered — so pin it.
    const early = backupFileName(Date.parse('2026-07-12T09:00:00.000Z'));
    const late = backupFileName(Date.parse('2026-07-12T14:30:00.000Z'));
    const nextYear = backupFileName(Date.parse('2027-01-01T00:00:00.000Z'));
    expect([nextYear, late, early].sort()).toEqual([early, late, nextYear]);
  });

  it('derives a slug from the file basename, not the connection name', () => {
    expect(deriveDatabaseSlug('/data/databases/orders.sqlite', 'conn_1')).toBe('orders');
    expect(deriveDatabaseSlug('/Users/ava/My Ops DB.sqlite', 'conn_1')).toBe('my-ops-db');
  });

  it('falls back to the connection id for a basename outside the grammar', () => {
    // A file called 数据.sqlite is legitimate and must not fail a backup.
    const slug = deriveDatabaseSlug('/data/数据.sqlite', 'conn_01ABCdef');
    expect(slug).toMatch(/^[a-z0-9][a-z0-9_-]*$/);
    expect(slug.startsWith('db-')).toBe(true);
  });

  it('cannot produce a slug that escapes its directory', () => {
    // The zip-slip guarantee, at its source. `../../config.json` as a slug would
    // let an archive overwrite the file holding ADMINIUM_SECRET.
    for (const hostile of ['../../etc/passwd', '..', 'a/b', 'C:\\evil', 'x\x00y']) {
      expect(deriveDatabaseSlug(hostile, 'conn_1')).toMatch(/^[a-z0-9][a-z0-9_-]*$/);
    }
  });

  it('de-duplicates slugs so two same-named files cannot collide', () => {
    // "Open an existing SQLite file" can register ~/work/app.sqlite and
    // ~/archive/app.sqlite. One member name for both = a backup that looks
    // complete and has lost a database.
    const taken = new Set(['app']);
    expect(uniqueSlug('app', taken)).toBe('app-2');
    taken.add('app-2');
    expect(uniqueSlug('app', taken)).toBe('app-3');
  });

  it('orders meta migration versions lexicographically', () => {
    expect(compareMetaMigrationVersion('0009_views_kind', '0009_views_kind')).toBe('same');
    expect(compareMetaMigrationVersion('0008_llm_overrides', '0009_views_kind')).toBe('older');
    expect(compareMetaMigrationVersion('0010_future', '0009_views_kind')).toBe('newer');
  });

  it('builds a pre-restore folder name that is filesystem-safe', () => {
    // Colons are illegal on Windows and awkward everywhere; an ISO timestamp
    // straight into a path would fail the one operation that must not.
    const name = preRestoreDirName(Date.parse('2026-07-12T14:30:05.123Z'));
    expect(name).toBe('pre-restore-2026-07-12T14-30-05-123Z');
    expect(name).not.toMatch(/[:.]/);
  });
});

// ─── Redaction (§9) ──────────────────────────────────────────────────────────

describe('§9 secret redaction', () => {
  it('accepts a properly redacted config', () => {
    expect(() => {
      assertNoSecrets(redactedConfig());
    }).not.toThrow();
  });

  it('refuses a config that still carries secretEncrypted', () => {
    expect(() => {
      assertNoSecrets({ ...redactedConfig(), secretEncrypted: SECRET_SENTINEL });
    }).toThrow(BackupRedactionError);
  });

  it('refuses a config that still carries secretPlain', () => {
    expect(() => {
      assertNoSecrets({ ...redactedConfig(), secretPlain: SECRET_SENTINEL });
    }).toThrow(BackupRedactionError);
  });

  it('refuses a secret-shaped key nested inside the config', () => {
    // The reason the check is recursive and shape-based rather than a list of
    // §9's two names: a future field would be invisible to a two-name check.
    expect(() => {
      assertNoSecrets({ ...redactedConfig(), updates: { mode: 'notify', apiKey: 'x' } });
    }).toThrow(BackupRedactionError);
  });

  it('lets `secretStorage` through — it is a mode, not a secret', () => {
    // §2.2 step 3 / §13: this field is what makes the About screen warn that
    // ADMINIUM_SECRET is in cleartext. Dropping it would silence a security
    // warning in the name of security.
    for (const mode of ['safeStorage', 'plain']) {
      expect(() => {
        assertNoSecrets({ ...redactedConfig(), secretStorage: mode });
      }).not.toThrow();
    }
  });

  it('does not let the `secretStorage` exemption smuggle a value', () => {
    // The exemption is by name AND value, so a future field that reused the
    // name to hold a token still fails. An exception to a fail-closed rule has
    // to be narrower than the rule.
    expect(() => {
      assertNoSecrets({ ...redactedConfig(), secretStorage: SECRET_SENTINEL });
    }).toThrow(BackupRedactionError);
  });
});

// ─── Rotation (§9) ───────────────────────────────────────────────────────────

describe('§9 rotation', () => {
  const names = (count: number): string[] =>
    Array.from({ length: count }, (_, i) =>
      backupFileName(Date.parse(`2026-07-${String(i + 1).padStart(2, '0')}T03:00:00.000Z`)),
    );

  it('keeps the newest `keep` archives and removes the rest', async () => {
    const present = names(10);
    const removed: string[] = [];
    const result = await rotateBackups('/data', DEFAULT_AUTO_BACKUP_KEEP, {
      readdir: () => Promise.resolve([...present].reverse()),
      rm: (path) => {
        removed.push(path);
        return Promise.resolve();
      },
    });

    expect(result.kept).toHaveLength(7);
    expect(result.removed).toEqual(names(3));
    expect(removed.every((path) => path.startsWith('/data/backups/'))).toBe(true);
  });

  it('never touches a file it did not write', async () => {
    // `<dataDir>/backups` is showItemInFolder-revealed (§9), so users put things
    // in it. "Delete the oldest files" would eat them.
    const removed: string[] = [];
    const result = await rotateBackups('/data', 1, {
      readdir: () =>
        Promise.resolve([
          ...names(3),
          'my-important-notes.txt',
          'adminium-backup-copy.zip',
          '.staging',
        ]),
      rm: (path) => {
        removed.push(path);
        return Promise.resolve();
      },
    });

    expect(result.removed).toEqual(names(2));
    expect(removed.join('|')).not.toContain('notes');
    expect(removed.join('|')).not.toContain('adminium-backup-copy');
    expect(removed.join('|')).not.toContain('.staging');
  });

  it('keeps everything when there are fewer archives than `keep`', async () => {
    const result = await rotateBackups('/data', 7, {
      readdir: () => Promise.resolve(names(3)),
      rm: () => Promise.reject(new Error('rotation must not delete anything here')),
    });
    expect(result.removed).toEqual([]);
    expect(result.kept).toHaveLength(3);
  });

  it('survives a backups directory that does not exist yet', async () => {
    const result = await rotateBackups('/data', 7, {
      readdir: () => Promise.reject(new Error('ENOENT')),
      rm: () => Promise.resolve(),
    });
    expect(result).toEqual({ kept: [], removed: [] });
  });

  it('does not fail the backup when one archive cannot be deleted', async () => {
    // Windows, an open zip viewer. The sweep is a sweep; the backup succeeded.
    const result = await rotateBackups('/data', 1, {
      readdir: () => Promise.resolve(names(3)),
      rm: (path) =>
        path.endsWith(`${names(1)[0] ?? ''}`)
          ? Promise.reject(new Error('EBUSY'))
          : Promise.resolve(),
    });
    expect(result.removed).toHaveLength(1);
  });
});

// ─── createBackup (§9) ───────────────────────────────────────────────────────

describe('§9 createBackup', () => {
  let f: Fixture;

  beforeEach(async () => {
    f = await fixture();
  });

  afterEach(async () => {
    await f.destroy();
  });

  it('writes the §9 layout: manifest, meta.db, config.json, databases/<slug>.sqlite', async () => {
    await addLocalDatabase(f, 'orders', (db) => {
      db.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY, total REAL)');
      db.exec('INSERT INTO orders (total) VALUES (42.5)');
    });

    const result = await createBackup({
      meta: f.meta,
      crypto: f.crypto,
      dataDir: f.dir,
      metaPath: f.metaPath,
      redactedConfig: redactedConfig(),
      appVersion: '1.2.3',
      destination: 'auto',
    });

    const { members, manifest } = readArchive(await readFile(result.path));

    // Files only: fflate emits a `databases/` directory entry alongside the
    // members, which is ordinary zip structure and not part of §9's layout.
    expect(
      Object.keys(members)
        .filter((name) => !name.endsWith('/'))
        .sort(),
    ).toEqual([BACKUP_CONFIG_PATH, 'databases/orders.sqlite', BACKUP_MANIFEST_PATH, BACKUP_META_PATH]);
    expect(manifest.formatVersion).toBe(1);
    expect(manifest.appVersion).toBe('1.2.3');
    expect(manifest.serverVersion).toBeTypeOf('string');
    expect(manifest.metaMigrationVersion).toMatch(/^\d{4}_/);
    // The pattern is a BASENAME rule — rotation matches it against readdir()
    // output, not against paths.
    expect(basename(result.path)).toMatch(BACKUP_FILE_PATTERN);
  });

  it('checksums every member against the bytes that actually went in', async () => {
    await addLocalDatabase(f, 'orders', (db) => {
      db.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY)');
    });

    const result = await createBackup({
      meta: f.meta,
      crypto: f.crypto,
      dataDir: f.dir,
      metaPath: f.metaPath,
      redactedConfig: redactedConfig(),
      destination: 'auto',
    });
    const { members, manifest } = readArchive(await readFile(result.path));

    // meta.db carries its own digest — §9's example omits it, and an archive
    // whose source DBs verify while its meta.db is truncated would pass
    // validation and then destroy the install.
    const metaBytes = members[BACKUP_META_PATH] as Uint8Array;
    expect(manifest.meta.sha256).toBe(sha256Hex(metaBytes));
    expect(manifest.meta.bytes).toBe(metaBytes.byteLength);

    for (const entry of manifest.databases) {
      if (entry.kind !== 'local') continue;
      const bytes = members[entry.file] as Uint8Array;
      expect(bytes).toBeDefined();
      expect(entry.sha256).toBe(sha256Hex(bytes));
      expect(entry.bytes).toBe(bytes.byteLength);
    }
  });

  it('snapshots WAL-committed rows that a file copy would miss', async () => {
    // ── THE CLAIM §9 MAKES: "the better-sqlite3 online backup() API (WAL-safe,
    // no locking of live writers)". A copyFile passes every other test in this
    // file and silently loses these rows.
    const { path, db } = await addLocalDatabase(f, 'orders', (source) => {
      source.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY, note TEXT)');
    });

    // Commit into the WAL and do NOT checkpoint. The main .sqlite file on disk
    // does not contain this row yet; `<db>-wal` does.
    db.exec("INSERT INTO orders (note) VALUES ('committed-to-wal')");
    const mainFileBytes = await readFile(path);
    expect(
      mainFileBytes.includes(Buffer.from('committed-to-wal')),
      'precondition: the row is in the WAL, not the main file — otherwise this test proves nothing',
    ).toBe(false);

    const result = await createBackup({
      meta: f.meta,
      crypto: f.crypto,
      dataDir: f.dir,
      metaPath: f.metaPath,
      redactedConfig: redactedConfig(),
      destination: 'auto',
    });

    // The snapshot must have it, and must be self-contained (no WAL sidecar
    // travels in the archive), which is exactly what backup() produces.
    const { members } = readArchive(await readFile(result.path));
    const snapshot = join(f.dir, 'restored.sqlite');
    await writeFile(snapshot, members['databases/orders.sqlite'] as Uint8Array);
    const restored = new BetterSqlite3(snapshot, { readonly: true });
    try {
      expect(restored.prepare('SELECT note FROM orders').all()).toEqual([
        { note: 'committed-to-wal' },
      ]);
    } finally {
      restored.close();
      db.close();
    }
  });

  it('does not lock live writers while it runs', async () => {
    const { db } = await addLocalDatabase(f, 'orders', (source) => {
      source.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY, note TEXT)');
    });
    try {
      const backup = createBackup({
        meta: f.meta,
        crypto: f.crypto,
        dataDir: f.dir,
        metaPath: f.metaPath,
        redactedConfig: redactedConfig(),
        destination: 'auto',
      });
      // The whole point of the online API: a writer keeps working. If this
      // throws SQLITE_BUSY the backup is holding a lock it must not hold.
      db.exec("INSERT INTO orders (note) VALUES ('written-during-backup')");
      await backup;
      expect(db.prepare('SELECT COUNT(*) AS n FROM orders').get()).toEqual({ n: 1 });
    } finally {
      db.close();
    }
  });

  it('lists remote Postgres as external and never dumps it (§9)', async () => {
    await connectionsRepo(f.meta, f.crypto).create({
      name: 'Northwind',
      engine: 'postgres',
      introspectDsn: 'postgres://ava:hunter2@db.internal:5432/northwind',
      dataDsn: 'postgres://ava:hunter2@db.internal:5432/northwind',
      status: 'connected',
    });

    const result = await createBackup({
      meta: f.meta,
      crypto: f.crypto,
      dataDir: f.dir,
      metaPath: f.metaPath,
      redactedConfig: redactedConfig(),
      destination: 'auto',
    });
    const { members, manifest } = readArchive(await readFile(result.path));

    expect(manifest.databases).toHaveLength(1);
    expect(manifest.databases[0]).toMatchObject({ kind: 'external', engine: 'postgres' });
    expect(Object.keys(members).some((name) => name.startsWith('databases/'))).toBe(false);
    // And no DSN rode along in the manifest — it is the one file read before
    // anything is trusted.
    expect(JSON.stringify(manifest)).not.toContain('hunter2');
  });

  it('lists a :memory: sqlite connection as external rather than claiming to have dumped it', async () => {
    await connectionsRepo(f.meta, f.crypto).create({
      name: 'Scratch',
      engine: 'sqlite',
      introspectDsn: 'sqlite::memory:',
      dataDsn: 'sqlite::memory:',
      status: 'connected',
    });

    const result = await createBackup({
      meta: f.meta,
      crypto: f.crypto,
      dataDir: f.dir,
      metaPath: f.metaPath,
      redactedConfig: redactedConfig(),
      destination: 'auto',
    });
    const { manifest } = readArchive(await readFile(result.path));
    expect(manifest.databases[0]?.kind).toBe('external');
  });

  it('refuses to write an unredacted config, and leaves no archive behind', async () => {
    await expect(
      createBackup({
        meta: f.meta,
        crypto: f.crypto,
        dataDir: f.dir,
        metaPath: f.metaPath,
        redactedConfig: { ...redactedConfig(), secretPlain: SECRET_SENTINEL },
        destination: 'auto',
      }),
    ).rejects.toThrow(BackupRedactionError);
  });

  it('never lets a secret sentinel reach the archive bytes', async () => {
    // The blunt end-to-end version of the claim: grep the whole zip.
    await addLocalDatabase(f, 'orders', (db) => {
      db.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY)');
    });
    const result = await createBackup({
      meta: f.meta,
      crypto: f.crypto,
      dataDir: f.dir,
      metaPath: f.metaPath,
      redactedConfig: redactedConfig(),
      destination: 'auto',
    });

    const { members } = readArchive(await readFile(result.path));
    const config = JSON.parse(
      new TextDecoder().decode(members[BACKUP_CONFIG_PATH] as Uint8Array),
    ) as Record<string, unknown>;

    // §9: "secrets redacted: secretEncrypted/secretPlain stripped". Removed, not
    // nulled — a null still tells a reader the field exists to look for.
    expect('secretEncrypted' in config).toBe(false);
    expect('secretPlain' in config).toBe(false);
    expect(config.dataDir).toBe('/data');
  });

  it('stages a manual backup outside the rotation, and lands an auto one inside it', async () => {
    const staged = await createBackup({
      meta: f.meta,
      crypto: f.crypto,
      dataDir: f.dir,
      metaPath: f.metaPath,
      redactedConfig: redactedConfig(),
      destination: 'staged',
    });
    // Dotted + inside `backups/`: a same-filesystem rename for the main process,
    // and invisible to both the user and the rotation sweep.
    expect(staged.path).toContain('/backups/.staging/');
    expect(staged.path).not.toMatch(BACKUP_FILE_PATTERN);

    const auto = await createBackup({
      meta: f.meta,
      crypto: f.crypto,
      dataDir: f.dir,
      metaPath: f.metaPath,
      redactedConfig: redactedConfig(),
      destination: 'auto',
    });
    expect(auto.path).toBe(join(f.dir, 'backups', backupFileName(auto.manifest.createdAt)));
  });

  it('omits config.json entirely when there is no desktop config to describe', async () => {
    const result = await createBackup({
      meta: f.meta,
      crypto: f.crypto,
      dataDir: f.dir,
      metaPath: f.metaPath,
      redactedConfig: null,
      destination: 'auto',
    });
    const { members, manifest } = readArchive(await readFile(result.path));
    expect(BACKUP_CONFIG_PATH in members).toBe(false);
    expect(manifest.appVersion).toBeNull();
  });

  it('cleans up its scratch directory', async () => {
    await addLocalDatabase(f, 'orders', (db) => {
      db.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY)');
    });
    await createBackup({
      meta: f.meta,
      crypto: f.crypto,
      dataDir: f.dir,
      metaPath: f.metaPath,
      redactedConfig: redactedConfig(),
      destination: 'auto',
    });
    const { readdir } = await import('node:fs/promises');
    const staging = await readdir(join(f.dir, 'backups', '.staging')).catch(() => []);
    expect(staging.filter((name) => name.startsWith('work-'))).toEqual([]);
  });

  it('sweeps abandoned staged archives, which nothing else would ever remove', async () => {
    // Staging is a handoff, and handoffs drop things: main's move to the user's
    // chosen path can fail, or the app can be killed between the reply and the
    // move. Rotation is documented to skip this directory, so without a sweep
    // these FULL copies of every database accumulate forever in a dot-directory
    // nobody looks in.
    const { mkdir, utimes, writeFile: write } = await import('node:fs/promises');
    const staging = join(f.dir, 'backups', '.staging');
    await mkdir(staging, { recursive: true });

    const abandoned = join(staging, 'abandoned.zip');
    const inFlight = join(staging, 'in-flight.zip');
    await write(abandoned, 'a stale archive nobody claimed');
    await write(inFlight, 'a move that is still happening');
    // Two hours old vs now.
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await utimes(abandoned, old, old);

    await createBackup({
      meta: f.meta,
      crypto: f.crypto,
      dataDir: f.dir,
      metaPath: f.metaPath,
      redactedConfig: redactedConfig(),
      destination: 'auto',
    });

    await expect(stat(abandoned)).rejects.toThrow();
    // The young one survives: a slow cross-device copy of a multi-gigabyte
    // archive to a USB stick is a move genuinely in flight, and deleting by age
    // alone would race it.
    expect((await stat(inFlight)).size).toBeGreaterThan(0);
  });

  it('leaves no .part file behind — a reader must never see a half-written zip', async () => {
    const result = await createBackup({
      meta: f.meta,
      crypto: f.crypto,
      dataDir: f.dir,
      metaPath: f.metaPath,
      redactedConfig: redactedConfig(),
      destination: 'auto',
    });
    await expect(stat(`${result.path}.part`)).rejects.toThrow();
    expect((await stat(result.path)).size).toBe(result.bytes);
  });
});
