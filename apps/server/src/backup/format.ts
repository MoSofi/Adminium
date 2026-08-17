// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE DESKTOP BACKUP FORMAT (11-electron.md §9), frozen at `formatVersion: 1`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS FILE IS A WIRE CONTRACT, NOT AN IMPLEMENTATION DETAIL. A zip written by
 * any build must be readable by any other, so the layout, the manifest shape and
 * the slug grammar live in ONE module, imported by the writer
 * (`backup-service.ts`), the reader (`apps/desktop/src/main/backup-archive.ts`,
 * via a mirrored schema pinned to these types) and the tests. Changing anything
 * here is a `formatVersion` bump, not an edit.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ─── THE M10 CLI DOES NOT READ THIS FORMAT. §9's INTEROP CLAIM IS UNBUILT ────
 *
 * §9 says the backup zip "doubles as the migration path to self-host/Cloud:
 * `npx adminium` import accepts the same format". IT DOES NOT, and this header
 * used to assert that it did. The truth, so nobody plans around the fiction:
 *
 * There are TWO unrelated archive formats that both independently call
 * themselves `formatVersion: 1`.
 *
 *  - THIS one (§9 backup): `manifest.json` at the archive ROOT, carrying
 *    `{ formatVersion, appVersion, serverVersion, metaMigrationVersion,
 *    createdAt, meta, databases }`, plus `meta.db` and `databases/*.sqlite` —
 *    a byte-level snapshot of a whole desktop install.
 *  - The M10 CONFIG BUNDLE (`export/bundle.ts`): `adminium-export/manifest.json`
 *    with a required, DISJOINT shape (`{ appVersion, configVersion, metaVersion,
 *    exportedAt, connectionId, secrets, counts }`), describing rows to upsert.
 *
 * `cli/commands/import-zip.ts` → `export/import-service.ts` reads only the
 * second: `parseBundle` demands `adminium-export/manifest.json` and throws
 * "it is not an Adminium configuration bundle" for anything else. A desktop user
 * who follows §9's stated migration path is told their backup is not an Adminium
 * file. Nothing outside the desktop reader and a parity test has ever imported
 * {@link BACKUP_FORMAT_VERSION}.
 *
 * WHY IT IS NOT MERELY A MISSING `if`. The two formats are not dialects, they
 * are different operations. The bundle import replays CONFIG ROWS into whatever
 * meta store the target runs; this archive's `meta.db` is a SQLite FILE, and a
 * self-host target's meta store is routinely Postgres or MySQL. Making the CLI
 * "accept the same archive" therefore means reading a SQLite meta store and
 * translating every table into another dialect — a cross-dialect meta migration,
 * not a branch. That is a real feature with a real design, and no task in
 * 11-T12 or M10 covers it.
 *
 * WHOEVER PICKS THIS UP: sniffing a root `manifest.json` in `parseBundle` is the
 * entry point, and the version gate below is ready for it. Until then, the
 * desktop restore (`main/backup.ts`) is the only reader of this format, and
 * anything telling a user otherwise — docs, dialog copy, this comment — is
 * making a promise the code does not keep.
 *
 * The archive (§9, verbatim):
 *
 * ```
 * adminium-backup-20260712-1430.zip
 *   manifest.json              { formatVersion, appVersion, serverVersion,
 *                                metaMigrationVersion, createdAt, databases: [...] }
 *   meta.db                    meta-store snapshot
 *   config.json                desktop config, secrets REDACTED
 *   databases/<slug>.sqlite    every LOCAL source DB
 * ```
 *
 * ─── Two places this completes §9 rather than quoting it ─────────────────────
 *
 * 1. **`databases[]` is a discriminated union.** §9's example row is
 *    `{ slug, file, bytes, sha256 }`, and its prose says remote PG/MySQL "are
 *    listed in manifest.json as 'external', never dumped". A row that is not
 *    dumped has no `file`, no `bytes` and no `sha256` to carry, so the two cases
 *    cannot be one shape. {@link BackupDatabaseEntry} is therefore
 *    `kind: 'local' | 'external'`; the local arm is §9's four fields exactly,
 *    plus the provenance (`connectionId`, `sourcePath`) a restore needs to
 *    explain itself. Reading the union back as §9's example means: take the
 *    local arm.
 * 2. **`meta` carries its own checksum.** §9 lists `meta.db` as an archive
 *    member and puts checksums only on `databases[]`. That asymmetry cannot be
 *    right: a restore validates checksums *before* it moves the live data aside
 *    (§9's flow), and meta.db is the file whose corruption is unrecoverable —
 *    it holds every connection, page and user. A backup whose source DBs verify
 *    and whose meta.db is truncated would pass validation and then destroy the
 *    install. Since `formatVersion: 1` is being frozen by this task rather than
 *    inherited, the hole is closed now instead of being shipped and versioned
 *    around.
 *
 * NOTHING ELSE IS ADDED. In particular there is no `secrets` block: `config.json`
 * travels redacted, unconditionally, and a manifest field describing a policy
 * with one possible value would only invite a second value later.
 */

import { createHash } from 'node:crypto';
import { basename, extname } from 'node:path';

import { z } from 'zod';

/**
 * FROZEN (§9: "format frozen here as `formatVersion: 1`").
 *
 * READ BY: the desktop restore's `validateArchive`, which refuses a higher
 * number rather than parsing leniently — the same rule `config.ts`'s version
 * gate and the M10 bundle's already obey.
 *
 * NOT read by the M10 CLI, whatever §9 says — see the module header. This
 * doc-comment used to claim it was; the claim was never true and the number is
 * the same either way, which is exactly why nobody noticed.
 */
export const BACKUP_FORMAT_VERSION = 1;

/** Archive member paths. The reader allow-lists against these — see below. */
export const BACKUP_MANIFEST_PATH = 'manifest.json';
export const BACKUP_META_PATH = 'meta.db';
export const BACKUP_CONFIG_PATH = 'config.json';
export const BACKUP_DATABASES_DIR = 'databases';

/** `databases/<slug>.sqlite` — the ONLY shape a source-DB member may have. */
export function backupDatabasePath(slug: string): string {
  return `${BACKUP_DATABASES_DIR}/${slug}.sqlite`;
}

/**
 * The slug grammar, and the reason it is this narrow.
 *
 * A slug is interpolated into an archive member path and then, on restore, into
 * a filesystem path under `<dataDir>/databases/`. That makes it the one value in
 * this format that can escape its directory: `../../config.json` is a perfectly
 * good zip entry name, and an unpacker that trusted it would overwrite the
 * desktop config — with the master secret in it — from inside an archive a user
 * double-clicked. Lowercase alnum + `-` + `_` cannot express a separator, a
 * drive letter, a dot segment, or a NUL, so the traversal is not defended
 * against, it is unrepresentable.
 *
 * The reader re-validates every slug it reads (it must: the archive is untrusted
 * input, and the writer's guarantees are the writer's), which is why this regex
 * is exported rather than inlined at the point of use.
 */
export const BACKUP_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export const backupSlugSchema = z.string().regex(BACKUP_SLUG_PATTERN, {
  message: 'must be 1-64 chars of lowercase a-z, 0-9, "-" or "_", starting alphanumeric',
});

/** SHA-256, lowercase hex — the digest every checksum field carries. */
export const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, {
  message: 'must be a lowercase hex SHA-256 digest',
});

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * A LOCAL source database: dumped, checksummed, restorable.
 *
 * `sourcePath` is provenance, not an instruction. It records where the file was
 * when the backup ran; the restore does NOT write to it. See
 * `apps/desktop/src/main/backup-archive.ts` for why an unpacker that honoured an
 * absolute path out of an archive would be a remote-file-write primitive.
 *
 * It is READ, though — by `assertRestorablePaths`, which refuses any archive
 * whose `sourcePath` is not already `<dataDir>/databases/<slug>.sqlite` on the
 * target. That check is the whole reason this field is load-bearing rather than
 * decorative: the unpack writes to the slug-derived path and `meta.db` is
 * restored byte-for-byte, so a `sourcePath` that disagrees means the restored
 * DSN would point somewhere the bytes are not — and the slug might belong to a
 * different connection entirely. Provenance is exactly what is needed to notice
 * that, and refusing is exactly what may be done with it.
 */
export const backupLocalDatabaseSchema = z.strictObject({
  kind: z.literal('local'),
  slug: backupSlugSchema,
  /** §9's `file` — the archive member, i.e. `databases/<slug>.sqlite`. */
  file: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  sha256: sha256Schema,
  /** `adminium_connections.id` this snapshot came from. */
  connectionId: z.string().min(1),
  /** Absolute path of the live file at backup time. Provenance only. */
  sourcePath: z.string().min(1),
});

/**
 * A REMOTE source database (§9: "remote PG/MySQL are listed in manifest.json as
 * 'external', never dumped").
 *
 * Listed rather than omitted, because the difference between "this instance had
 * no Postgres" and "this instance had a Postgres we did not dump" is the whole
 * question a person asks when a restore comes up short. No DSN, not even
 * encrypted: the DSN is in meta.db, and a manifest is the one file in the
 * archive that is read before anything is trusted.
 */
export const backupExternalDatabaseSchema = z.strictObject({
  kind: z.literal('external'),
  slug: backupSlugSchema,
  connectionId: z.string().min(1),
  /** `postgres` | `mysql` | … — whatever `adminium_connections.engine` said. */
  engine: z.string().min(1),
});

export const backupDatabaseEntrySchema = z.discriminatedUnion('kind', [
  backupLocalDatabaseSchema,
  backupExternalDatabaseSchema,
]);

export type BackupLocalDatabase = z.infer<typeof backupLocalDatabaseSchema>;
export type BackupExternalDatabase = z.infer<typeof backupExternalDatabaseSchema>;
export type BackupDatabaseEntry = z.infer<typeof backupDatabaseEntrySchema>;

/** `meta.db`'s own entry — see point 2 in the module header. */
export const backupMetaEntrySchema = z.strictObject({
  file: z.literal(BACKUP_META_PATH),
  bytes: z.number().int().nonnegative(),
  sha256: sha256Schema,
});

export type BackupMetaEntry = z.infer<typeof backupMetaEntrySchema>;

/**
 * `manifest.json` (§9).
 *
 * `strictObject`, like `config.json`'s schema and for the same reason: an
 * unknown key is a hand-edit or a typo, and a genuinely newer archive is caught
 * one field earlier by {@link BACKUP_FORMAT_VERSION}, with a message the user
 * can act on.
 */
export const backupManifestSchema = z.strictObject({
  formatVersion: z.number().int().positive(),
  /** The Electron shell's `app.getVersion()`, or `null` outside it. */
  appVersion: z.string().min(1).nullable(),
  /** `@adminium/server`'s `APP_VERSION`. */
  serverVersion: z.string().min(1),
  /**
   * The meta-store's migration high-water mark — the ledger's last applied
   * name (`0009_views_kind`), NOT the count and NOT the build's own latest.
   * What replay needs to know is what the SOURCE actually ran.
   */
  metaMigrationVersion: z.string().min(1),
  /** Epoch ms. */
  createdAt: z.number().int().nonnegative(),
  meta: backupMetaEntrySchema,
  databases: z.array(backupDatabaseEntrySchema),
});

export type BackupManifest = z.infer<typeof backupManifestSchema>;

// ─── Migration-version comparison (§9's refuse/fast-forward rule) ────────────

/**
 * §9: "the migration runner fast-forwards an older backup; a backup whose
 * `metaMigrationVersion` is **newer** than the app is refused".
 *
 * LEXICOGRAPHIC, and that is a property of the names rather than a hope about
 * them: `@adminium/meta`'s ledger names every migration `NNNN_slug` with a
 * zero-padded, append-only ordinal (`0001_core_auth` … `0009_views_kind`), so
 * string order IS apply order for as long as the counter has four digits — about
 * 9,990 migrations from now. That matters because the comparison has to work in
 * the Electron MAIN process, which may not import `@adminium/meta` (§1
 * principle 2 / `.dependency-cruiser.cjs` `desktop-shell-only`) and therefore
 * cannot look a name up in `ALL_MIGRATIONS`. Two strings and `<` it can do.
 *
 * `same` and `older` are both restorable; only `newer` is refused. `older` is
 * not merely tolerated but EXPECTED — it is what restoring last month's backup
 * into this month's build is — and the meta migrator fast-forwards it at the
 * next boot with no special casing anywhere.
 */
export type BackupVersionOrder = 'older' | 'same' | 'newer';

export function compareMetaMigrationVersion(
  backupVersion: string,
  appVersion: string,
): BackupVersionOrder {
  if (backupVersion === appVersion) return 'same';
  return backupVersion > appVersion ? 'newer' : 'older';
}

// ─── Naming ─────────────────────────────────────────────────────────────────

/** §9's `adminium-backup-20260712-1430.zip`. */
export const BACKUP_FILE_PREFIX = 'adminium-backup-';
export const BACKUP_FILE_EXTENSION = '.zip';

/**
 * Matches {@link backupFileName}'s output. The rotation sweep uses it as an
 * allow-list rather than deleting whatever is in `<dataDir>/backups/`: that
 * directory is `showItemInFolder`-revealed (§9) and users put things in folders
 * they can see. Rotation deletes files THIS code wrote and nothing else.
 */
export const BACKUP_FILE_PATTERN = /^adminium-backup-\d{8}-\d{6}\.zip$/;

/**
 * `adminium-backup-YYYYMMDD-HHMMSS.zip`, in UTC.
 *
 * §9's example shows minutes (`…-1430.zip`); seconds are here because rotation
 * sorts by NAME (the only ordering that survives a file copy, an rsync, or a
 * restored-from-Time-Machine backups folder — mtime does not), and two backups
 * in one minute would then be indistinguishable and unorderable. UTC for the
 * same reason: a local-time name goes backwards for an hour every autumn, and a
 * rotation that sorts names would delete the wrong one.
 */
export function backupFileName(createdAt: number): string {
  const iso = new Date(createdAt).toISOString();
  const date = iso.slice(0, 10).replace(/-/g, '');
  const time = iso.slice(11, 19).replace(/:/g, '');
  return `${BACKUP_FILE_PREFIX}${date}-${time}${BACKUP_FILE_EXTENSION}`;
}

/** `<dataDir>/pre-restore-<ts>` (§9). The folder a restore never deletes. */
export const PRE_RESTORE_PREFIX = 'pre-restore-';

export function preRestoreDirName(at: number): string {
  return `${PRE_RESTORE_PREFIX}${new Date(at).toISOString().replace(/[:.]/g, '-')}`;
}

// ─── Slugs ──────────────────────────────────────────────────────────────────

/**
 * A slug for a local database file, derived from its BASENAME.
 *
 * The basename, not the connection name, because on desktop they are the same
 * thing by construction: §6 step 2 creates `<dataDir>/databases/<slug>.sqlite`
 * from the name the user typed, so the file already carries the slug the user
 * chose and round-tripping through it keeps `databases/orders.sqlite` in the
 * archive named `orders`. Deriving from `connection.name` instead would rename
 * everything the moment somebody edited a label, and "Open an existing SQLite
 * file" (§6 step 2, opened in place) has a real filename and a name the user
 * never picked.
 *
 * Falls back to the connection id for a basename that survives none of the
 * grammar — a file called `数据.sqlite` is legitimate and must not fail a backup.
 */
export function deriveDatabaseSlug(filePath: string, connectionId: string): string {
  const base = basename(filePath, extname(filePath));
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .slice(0, 64);
  if (BACKUP_SLUG_PATTERN.test(slug)) return slug;
  return `db-${connectionId.toLowerCase().replace(/[^a-z0-9]+/g, '')}`.slice(0, 64);
}

/**
 * Make `slug` unique against `taken`, appending `-2`, `-3`, …
 *
 * Needed because slugs come from basenames and basenames are only unique within
 * a directory: "Open an existing SQLite file" can register
 * `~/work/app.sqlite` and `~/archive/app.sqlite` as two connections, and two
 * archive members called `databases/app.sqlite` means the second silently
 * replaces the first — a backup that looks complete and has lost a database.
 */
export function uniqueSlug(slug: string, taken: ReadonlySet<string>): string {
  if (!taken.has(slug)) return slug;
  for (let n = 2; ; n += 1) {
    const suffix = `-${String(n)}`;
    const candidate = `${slug.slice(0, 64 - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}
