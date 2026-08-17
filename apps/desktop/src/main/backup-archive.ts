// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Reading a §9 backup archive from the main process (11-electron.md §9).
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ THIS FILE IS THE SANCTIONED EXCEPTION TO §1 PRINCIPLE 2.                 │
 * │                                                                         │
 * │ "The server is the only data owner. The main process never opens the     │
 * │  meta-store or source DBs directly (single exception: integrity check of │
 * │  a backup zip before restore, which opens files read-only)."             │
 * │                                                                         │
 * │ So: this module READS a zip and HASHES its bytes. It opens no database,  │
 * │ imports no `better-sqlite3`, and knows nothing about what is inside      │
 * │ `meta.db` beyond its length and its digest. {@link unpackArchive} writes │
 * │ files, but only ones the manifest named and only under a directory the   │
 * │ caller passed — and only while the server is stopped (§9's flow), which  │
 * │ is what makes it a file move rather than a second writer.                │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ─── The archive is UNTRUSTED INPUT ──────────────────────────────────────────
 *
 * §9 hands this path three ways — File → "Restore from backup…", Settings →
 * Desktop → Backups, and §2.2 step 1's launch argument — and the last one is a
 * file the user DOUBLE-CLICKED. It may have come from an email. So nothing here
 * trusts the zip: every member name is checked against an allow-list derived
 * from the manifest, every slug is re-validated against the format's grammar,
 * every digest is recomputed, and the manifest itself is parsed with zod rather
 * than cast. See {@link BACKUP_SLUG_PATTERN} for the one that would actually
 * hurt.
 *
 * ─── The schema is mirrored, not imported ────────────────────────────────────
 *
 * `@adminium/server` owns the format (`backup/format.ts`) and this module must
 * agree with it, but a runtime `import { backupManifestSchema } from
 * '@adminium/server'` would pull Fastify, Kysely and the whole route tree into
 * the MAIN process to parse one JSON file — `externalizeDeps` keeps it out of
 * the bundle, not out of memory. So the schema is restated here in zod (which
 * this package already depends on) and pinned to the server's types by the
 * `import type` assertions at the bottom, which cost nothing at runtime and fail
 * the typecheck the moment the two drift. Same pattern, and same reason, as
 * `main/ipc.ts`'s contract assertions against `preload/api.d.ts`.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

import { unzipSync } from 'fflate';
import { z } from 'zod';

// TYPE-ONLY. Erased at build; see the module header.
import type {
  BackupManifest as ServerBackupManifest,
  BackupVersionOrder as ServerVersionOrder,
} from '@adminium/server';

// ─── The format, mirrored (see the module header) ────────────────────────────

/** FROZEN — `@adminium/server`'s `BACKUP_FORMAT_VERSION`. */
export const BACKUP_FORMAT_VERSION = 1;

export const BACKUP_MANIFEST_PATH = 'manifest.json';
export const BACKUP_META_PATH = 'meta.db';
export const BACKUP_CONFIG_PATH = 'config.json';
export const BACKUP_DATABASES_DIR = 'databases';

/**
 * THE ZIP-SLIP GRAMMAR. The reason the slug rule is this narrow, restated here
 * because this is the module where getting it wrong would be exploitable.
 *
 * A zip entry name is arbitrary attacker-controlled text. `../../config.json` is
 * a valid one, and `<dataDir>/databases/../../config.json` resolves to
 * `<userData>/config.json` — the file holding `ADMINIUM_SECRET`. An unpacker
 * that joined an entry name onto a directory would let a mailed .zip overwrite
 * the master secret (or `~/.zshrc`, or a launch agent) the moment somebody
 * double-clicked it. Lowercase alnum + `-`/`_` cannot express `.`, `/`, `\`, a
 * drive letter or a NUL, so the traversal is not blocked — it is unrepresentable.
 *
 * {@link unpackArchive} additionally re-derives every destination from the SLUG
 * rather than from the entry name, and asserts containment, so even a grammar
 * bug here would not reach outside the target directory.
 */
export const BACKUP_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const backupSlugSchema = z.string().regex(BACKUP_SLUG_PATTERN);
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

const backupLocalDatabaseSchema = z.strictObject({
  kind: z.literal('local'),
  slug: backupSlugSchema,
  file: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  sha256: sha256Schema,
  connectionId: z.string().min(1),
  sourcePath: z.string().min(1),
});

const backupExternalDatabaseSchema = z.strictObject({
  kind: z.literal('external'),
  slug: backupSlugSchema,
  connectionId: z.string().min(1),
  engine: z.string().min(1),
});

const backupDatabaseEntrySchema = z.discriminatedUnion('kind', [
  backupLocalDatabaseSchema,
  backupExternalDatabaseSchema,
]);

export const backupManifestSchema = z.strictObject({
  formatVersion: z.number().int().positive(),
  appVersion: z.string().min(1).nullable(),
  serverVersion: z.string().min(1),
  metaMigrationVersion: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  meta: z.strictObject({
    file: z.literal(BACKUP_META_PATH),
    bytes: z.number().int().nonnegative(),
    sha256: sha256Schema,
  }),
  databases: z.array(backupDatabaseEntrySchema),
});

export type BackupManifest = z.infer<typeof backupManifestSchema>;
export type BackupLocalDatabase = z.infer<typeof backupLocalDatabaseSchema>;

/** See `@adminium/server`'s `compareMetaMigrationVersion` for why this is `<`. */
export type BackupVersionOrder = 'older' | 'same' | 'newer';

export function compareMetaMigrationVersion(
  backupVersion: string,
  appVersion: string,
): BackupVersionOrder {
  if (backupVersion === appVersion) return 'same';
  return backupVersion > appVersion ? 'newer' : 'older';
}

// ─── Contract assertions (compile-time only; see the module header) ──────────

type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;

/**
 * The mirrored schema parses EXACTLY what the server writes.
 *
 * This is the assertion that matters, and it is the one nothing else can catch.
 * A field added to `apps/server/src/backup/format.ts` and forgotten here would
 * compile on both sides, ship, and then be REJECTED at runtime by `strictObject`
 * — turning every restore into "this backup is corrupt" for a backup that is
 * perfectly fine. It fails at typecheck instead.
 */
export type _ManifestMatchesServer = Assert<Mutual<BackupManifest, ServerBackupManifest>>;
export type _VersionOrderMatchesServer = Assert<Mutual<BackupVersionOrder, ServerVersionOrder>>;

// ─── Errors ─────────────────────────────────────────────────────────────────

/** Why an archive was refused. The dialog copy branches on this. */
export type BackupRejection =
  /** Not a zip, or unreadable. */
  | 'unreadable'
  /** No `manifest.json`, or it does not parse. */
  | 'malformed'
  /** `formatVersion` this build does not know. */
  | 'format-newer'
  /** §9: `metaMigrationVersion` newer than the app. "Update Adminium first." */
  | 'migration-newer'
  /** A member is missing, or its sha256 does not match the manifest. */
  | 'checksum'
  /** The app does not know its own migration version — see the coordinator. */
  | 'unknown-app-version'
  /**
   * A local database in this archive does not live where this install would put
   * it, so unpacking it could not produce a working restore. See
   * {@link assertRestorablePaths} — this is the one rejection that is about the
   * TARGET rather than the archive.
   */
  | 'foreign-paths';

export class BackupArchiveError extends Error {
  override readonly name = 'BackupArchiveError';
  constructor(
    readonly rejection: BackupRejection,
    message: string,
  ) {
    super(message);
  }
}

// ─── Validation ─────────────────────────────────────────────────────────────

export interface ValidatedArchive {
  path: string;
  manifest: BackupManifest;
  /** Every local DB entry, checksum-verified. */
  databases: BackupLocalDatabase[];
  /** `older` ⇒ the migration runner fast-forwards it at the next boot (§9). */
  order: BackupVersionOrder;
}

/** The decoded members, keyed by archive path. */
type Members = Record<string, Uint8Array>;

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export interface ValidateArchiveOptions {
  /** Absolute path of the `.zip`. */
  path: string;
  /**
   * The newest migration THIS app ships — `ServerReadyInfo.metaVersion`, which
   * the §2.2 step 7 handshake carries.
   *
   * `null` is a real state, not a lazy default: a boot whose server never
   * handshook has no answer, and §9's refusal rule cannot be evaluated without
   * one. The honest response is to refuse the restore ({@link BackupRejection}'s
   * `unknown-app-version`), NOT to skip the check — skipping it is how an
   * old build silently accepts a newer backup and runs an incomplete migration
   * set over it.
   */
  appMetaVersion: string | null;
  /**
   * `ADMINIUM_DATA_DIR` — the directory this install would restore INTO.
   *
   * Required, and the check it feeds ({@link assertRestorablePaths}) is the
   * reason validation is about the target and not only the archive.
   */
  dataDir: string;
  /** Injected for tests. */
  readFile?: ((path: string) => Promise<Uint8Array>) | undefined;
}

/** Where this install keeps the local database for `slug`. */
export function localDatabasePath(dataDir: string, slug: string): string {
  return resolve(dataDir, BACKUP_DATABASES_DIR, `${slug}.sqlite`);
}

/**
 * Refuse an archive whose local databases do not live where this install keeps
 * them — because unpacking it could not produce a working restore, and could
 * produce a silently WRONG one.
 *
 * ─── THE PROBLEM THIS EXISTS FOR ────────────────────────────────────────────
 *
 * {@link unpackArchive} writes every local database to
 * `<dataDir>/databases/<slug>.sqlite`, where `slug` is derived from the file's
 * BASENAME at backup time (`format.ts`'s `deriveDatabaseSlug` + `uniqueSlug`).
 * `meta.db` is restored byte-for-byte, so `adminium_connections.dsn` keeps
 * whatever absolute path it had. Nothing rewrites it — main may not open the
 * meta store (§1 principle 2), and `sourcePath` is deliberately provenance
 * rather than an instruction (an unpacker that honoured an absolute path out of
 * an archive would be a remote-file-write primitive).
 *
 * So a restore only lands correctly when `sourcePath` ALREADY equals
 * `<dataDir>/databases/<slug>.sqlite` on this machine. When it does not, two
 * things go wrong at once, and neither announces itself:
 *
 *  - THE FILE IS WRITTEN SOMEWHERE NOTHING POINTS AT. A database registered in
 *    place (§6 step 2 card 2, `sqlite:/Users/me/archive/data.sqlite`) is never
 *    written back to `~/archive`, so the connection still serves TODAY's rows
 *    while the user believes they restored last week's.
 *  - AND IT LANDS ON TOP OF SOMEBODY ELSE'S. Slugs are per-basename and
 *    `discoverSources` orders by `createdAt`, so an in-place `~/archive/
 *    data.sqlite` opened first claims slug `data`, and a wizard-created "Data"
 *    at `<dataDir>/databases/data.sqlite` gets `data-2`. Restoring then
 *    overwrites the WIZARD's database with the archive file's bytes, and the
 *    connection named "Data" serves a completely different database. The dialog
 *    says "Restore complete".
 *
 * The same test also catches a restore onto a SECOND MACHINE, where every
 * `sourcePath` names the source machine's dataDir: the bytes would land under
 * the target's dataDir while every DSN dangled at the old one.
 *
 * ─── WHY REFUSE RATHER THAN WARN ────────────────────────────────────────────
 *
 * There is no partial answer worth giving. The failure is not "one database is
 * missing" — it is "a connection now serves a different database than its name
 * says", which is indistinguishable from a working restore until someone reads
 * a row. §9's whole promise is that restore is the safe operation ("Current data
 * will be moved to `<dataDir>/pre-restore-<ts>/`, not deleted"), and it is
 * checked HERE, in validation, precisely so the refusal happens while the user's
 * data is still exactly where it was — before the server stops and before
 * anything moves.
 *
 * The message names the databases, because "this backup cannot be restored" with
 * no subject is a dead end. The pre-restore folder is not mentioned: nothing has
 * moved, and nothing will.
 */
export function assertRestorablePaths(databases: readonly BackupLocalDatabase[], dataDir: string): void {
  const foreign = databases.filter(
    (entry) => resolve(entry.sourcePath) !== localDatabasePath(dataDir, entry.slug),
  );
  if (foreign.length === 0) return;

  const named = foreign.map((entry) => `"${entry.slug}" (${entry.sourcePath})`).join(', ');
  throw new BackupArchiveError(
    'foreign-paths',
    `This backup cannot be restored onto this copy of Adminium. ${
      foreign.length === 1 ? 'A database in it was' : 'Databases in it were'
    } stored outside this computer's data folder — ${named} — so restoring would put the ` +
      'file somewhere Adminium is not looking, and could overwrite a different database ' +
      'that happens to share its name. Nothing has been changed. This usually means the ' +
      'backup came from another computer, or from a database opened in place from its own ' +
      'folder. Open the zip to copy those files out by hand: your databases are inside it, ' +
      'under "databases/".',
  );
}

/**
 * §9's "validate manifest + checksums (read-only, main process)".
 *
 * Reads the whole archive into memory and verifies it before returning. That is
 * deliberate and is the same trade `createBackup` makes on the writing side: a
 * desktop backup is a laptop's databases, and the alternative — validating with
 * a streaming pass and then re-reading to unpack — would check one set of bytes
 * and write another. The archive is decoded exactly once, and
 * {@link unpackArchive} writes the members THIS function verified.
 */
export async function validateArchive(
  opts: ValidateArchiveOptions,
): Promise<ValidatedArchive & { members: Members }> {
  const read = opts.readFile ?? ((path: string) => readFile(path));

  let members: Members;
  try {
    members = unzipSync(await read(opts.path));
  } catch (error) {
    throw new BackupArchiveError(
      'unreadable',
      `${opts.path} could not be read as an Adminium backup: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const manifestBytes = members[BACKUP_MANIFEST_PATH];
  if (manifestBytes === undefined) {
    throw new BackupArchiveError(
      'malformed',
      'This zip has no manifest.json, so it is not an Adminium backup.',
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(new TextDecoder().decode(manifestBytes));
  } catch {
    throw new BackupArchiveError('malformed', "This backup's manifest.json is not valid JSON.");
  }

  // formatVersion BEFORE the schema. A newer archive is expected to fail
  // `strictObject` (it has fields we have never heard of), and "Update Adminium
  // first" is a far better answer than a list of unrecognized keys.
  const probe = z.looseObject({ formatVersion: z.number().int().optional() }).safeParse(parsedJson);
  const formatVersion = probe.success ? probe.data.formatVersion : undefined;
  if (formatVersion !== undefined && formatVersion > BACKUP_FORMAT_VERSION) {
    throw new BackupArchiveError(
      'format-newer',
      `This backup uses format version ${String(formatVersion)}; this build understands ` +
        `version ${String(BACKUP_FORMAT_VERSION)}. Update Adminium first.`,
    );
  }

  const parsed = backupManifestSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new BackupArchiveError(
      'malformed',
      `This backup's manifest.json does not match the expected shape: ${formatIssues(parsed.error)}`,
    );
  }
  const manifest = parsed.data;

  // §9's refusal, and it runs BEFORE the checksums on purpose: verifying the
  // digests of an archive we are about to refuse anyway is time the user spends
  // watching a spinner for an answer we already have.
  if (opts.appMetaVersion === null) {
    throw new BackupArchiveError(
      'unknown-app-version',
      'Adminium cannot check this backup because its server is not running. Restart ' +
        'Adminium and try again.',
    );
  }
  const order = compareMetaMigrationVersion(manifest.metaMigrationVersion, opts.appMetaVersion);
  if (order === 'newer') {
    throw new BackupArchiveError(
      'migration-newer',
      'This backup was made by a newer version of Adminium. Update Adminium first — ' +
        'restoring it into this version would leave your data in a state this build ' +
        'does not understand.',
    );
  }

  verifyMember(members, BACKUP_META_PATH, manifest.meta.bytes, manifest.meta.sha256);

  const databases: BackupLocalDatabase[] = [];
  for (const entry of manifest.databases) {
    if (entry.kind !== 'local') continue;
    // The manifest's `file` is data too. Re-derive it from the slug rather than
    // trusting it, so a manifest claiming `file: "../../evil"` describes a
    // member that simply is not there.
    const member = `${BACKUP_DATABASES_DIR}/${entry.slug}.sqlite`;
    verifyMember(members, member, entry.bytes, entry.sha256);
    databases.push(entry);
  }

  // LAST, and after the checksums: a damaged archive is a worse fact than a
  // misplaced one, and the user should hear about it first. Still before any
  // caller has moved anything — §9's validation phase is the whole point.
  assertRestorablePaths(databases, opts.dataDir);

  return { path: opts.path, manifest, databases, order, members };
}

function verifyMember(
  members: Members,
  path: string,
  expectedBytes: number,
  expectedSha256: string,
): void {
  const bytes = members[path];
  if (bytes === undefined) {
    throw new BackupArchiveError(
      'checksum',
      `This backup is incomplete: its manifest lists "${path}", but the archive does not ` +
        'contain it.',
    );
  }
  if (bytes.byteLength !== expectedBytes) {
    throw new BackupArchiveError(
      'checksum',
      `This backup is damaged: "${path}" is ${String(bytes.byteLength)} bytes, but its ` +
        `manifest says ${String(expectedBytes)}.`,
    );
  }
  if (sha256Hex(bytes) !== expectedSha256) {
    throw new BackupArchiveError(
      'checksum',
      `This backup is damaged: "${path}" does not match the checksum in its manifest. ` +
        'Restoring it would replace your data with a corrupted copy.',
    );
  }
}

// ─── Pre-restore safety copy (§9) ───────────────────────────────────────────

/**
 * The files a restore replaces, i.e. exactly what {@link unpackArchive} writes.
 *
 * `-wal` and `-shm` are here because leaving them behind is a corruption bug
 * wearing a "harmless leftover" costume: a fresh `meta.db` from the archive
 * next to the OLD database's write-ahead log is a database whose WAL describes
 * pages it does not have. SQLite would open it and apply them.
 */
const SQLITE_SIDECARS = ['-wal', '-shm'] as const;

export interface MoveAsideResult {
  /** `<dataDir>/pre-restore-<ts>` — created only if something moved into it. */
  dir: string;
  /** Paths (relative to dataDir) that were moved. */
  moved: string[];
}

/**
 * §9: "Current data will be moved to `<dataDir>/pre-restore-<ts>/`, not deleted."
 *
 * MOVED, NOT COPIED, and never deleted. A move is atomic, is instant regardless
 * of database size, and — the part that matters — cannot half-succeed and leave
 * the user with neither copy. §9 is unambiguous that the folder stays: "The
 * pre-restore folder is kept; the user empties it manually — the app never
 * permanently deletes data." Nothing in this module removes it, and nothing
 * anywhere else may either.
 *
 * The rename is same-filesystem by construction (`<dataDir>/pre-restore-*` is
 * inside `<dataDir>`), so it cannot EXDEV.
 *
 * ─── ALL OR NOTHING ─────────────────────────────────────────────────────────
 *
 * Each individual rename is atomic; this FUNCTION is three of them, and that is
 * the part that needed making atomic. It used to move `meta.db`, then the
 * sidecars, then `databases/`, and throw on the first failure with the words
 * "Nothing has been changed" — true only if the FIRST move was the one that
 * failed. The two real failures it produced:
 *
 *  - Windows, `databases/orders.sqlite` open in DB Browser. `meta.db` moves,
 *    `databases/` fails EBUSY (Windows cannot rename a directory containing an
 *    open file), we throw. The caller shows "Nothing has been changed", then
 *    restarts the server — against a dataDir with no `meta.db`. `firstRun`
 *    creates an empty meta store and the user lands in §6's first-run wizard
 *    with zero users and zero connections, having just been told nothing
 *    changed. Their real meta.db is recoverable only by hand.
 *  - `meta.db` moves, `meta.db-wal` fails. The server creates a fresh `meta.db`
 *    beside the OLD `-wal`, and SQLite validates a WAL by its own header/salt
 *    checksums — not against the database it sits next to — so it recovers
 *    stale frames into the new file. That is verbatim the corruption
 *    {@link SQLITE_SIDECARS} says it exists to prevent.
 *
 * So a failure now ROLLS BACK every rename it already made, and the message
 * tells the truth either way — including in the case where the rollback itself
 * fails, which is the only remaining state where the user must go look in the
 * pre-restore folder by hand.
 *
 * `meta.db` moves LAST for the same reason: it is the file whose absence turns a
 * failed restore into a fresh install, so it is the one that should be exposed
 * for the shortest time and be the first to survive a rollback that itself goes
 * wrong. The sidecars move immediately before it — never after, or a rollback
 * failure could leave `meta.db` sitting next to a WAL that has already been
 * carried off.
 */
export async function moveDataAside(
  dataDir: string,
  preRestoreDir: string,
  deps: FsDeps = nodeFsDeps,
): Promise<MoveAsideResult> {
  const root = resolve(dataDir);
  const target = join(root, preRestoreDir);
  const moved: string[] = [];

  /** Undo, newest first. Returns the paths it could NOT put back. */
  const rollback = async (): Promise<string[]> => {
    const stranded: string[] = [];
    for (const relative of [...moved].reverse()) {
      try {
        await deps.rename(join(target, relative), join(root, relative));
      } catch {
        // Swallowed deliberately: we are already on the failure path and the
        // ORIGINAL error is the one worth reporting. What matters is which
        // files did not make it home, which is what this list is.
        stranded.push(relative);
      }
    }
    return stranded;
  };

  const move = async (relative: string): Promise<void> => {
    const from = join(root, relative);
    const to = join(target, relative);
    try {
      await deps.mkdir(dirname(to));
      await deps.rename(from, to);
      moved.push(relative);
    } catch (error) {
      // ENOENT ONLY. A first restore into a data dir with no `databases/` has
      // nothing to move, and that is not a failure.
      //
      // EVERYTHING ELSE ABORTS, and this distinction is the difference between
      // §9's promise and a data-loss bug. A blanket catch here reads as
      // harmless — "we could not move it, carry on" — but the very next step
      // WRITES `meta.db` at that same path. So a locked file (Windows EBUSY, an
      // EPERM, a full disk) would mean: nothing moved aside, pre-restore folder
      // empty, live meta store overwritten in place. "Current data will be
      // moved to <dataDir>/pre-restore-<ts>/, not deleted" — the sentence the
      // confirm dialog just showed the user — would be false, and the data
      // would be gone. Refusing before the unpack is the only safe answer: the
      // user still has everything, and the message names the file.
      if (isErrno(error, 'ENOENT')) return;
      const code = (error as NodeJS.ErrnoException).code ?? 'unknown error';
      const stranded = await rollback();
      throw new BackupArchiveError(
        'unreadable',
        stranded.length === 0
          ? `Adminium could not move "${relative}" aside before restoring (${code}). ` +
            'Nothing has been changed. Close anything using your Adminium data ' +
            'folder and try again.'
          : // The one case where the user has to do something. Naming the files
            // beats "an error occurred": they are sitting intact in a folder
            // whose name this message does not know, so the caller appends it.
            `Adminium could not move "${relative}" aside before restoring (${code}), ` +
            `and could not put ${stranded.map((path) => `"${path}"`).join(', ')} back ` +
            'afterwards. Your data is safe but not all of it is where Adminium ' +
            'expects it. Close anything using your Adminium data folder, then move ' +
            'those files back yourself before starting Adminium again.',
      );
    }
  };

  for (const sidecar of SQLITE_SIDECARS) await move(`${BACKUP_META_PATH}${sidecar}`);
  await move(BACKUP_DATABASES_DIR);
  await move(BACKUP_META_PATH);

  return { dir: target, moved };
}

// ─── Unpack ─────────────────────────────────────────────────────────────────

export interface UnpackResult {
  /** Absolute paths written. */
  written: string[];
}

/**
 * Write the verified members into `<dataDir>` (§9's "unpack").
 *
 * ─── WHAT IS NOT WRITTEN, AND WHY IT IS THE MOST IMPORTANT LINE HERE ─────────
 *
 * `config.json`. The archive carries one (§9 requires it) with its secrets
 * STRIPPED — that is the whole point of the redaction. Restoring it over
 * `<userData>/config.json` would therefore replace a file containing
 * `ADMINIUM_SECRET` with a file containing `null`, and every encrypted DSN, LLM
 * key and TOTP secret in the meta.db we just restored would become permanently
 * unreadable. The redaction that makes the archive safe to share is exactly what
 * makes it unusable as a config to restore. It travels for the human reading the
 * zip and for the M10 CLI's import to inspect; nothing writes it back.
 *
 * `manifest.json` is not written either: it describes the archive, not the
 * install.
 *
 * Only entries the manifest listed and this module verified are written, and
 * every destination is re-derived from a validated slug — never from an entry
 * name. See {@link BACKUP_SLUG_PATTERN}.
 */
export async function unpackArchive(
  archive: ValidatedArchive & { members: Members },
  dataDir: string,
  deps: FsDeps = nodeFsDeps,
): Promise<UnpackResult> {
  const root = resolve(dataDir);
  const written: string[] = [];

  const write = async (relative: string, bytes: Uint8Array): Promise<void> => {
    // Defence in depth behind the slug grammar: if `relative` ever escaped, this
    // is what notices. `resolve` collapses `..`, so containment is decidable —
    // and the `sep` suffix is what stops `<dataDir>-evil/x` from passing a bare
    // `startsWith(root)`.
    const path = resolve(root, relative);
    if (path !== root && !path.startsWith(`${root}${sep}`)) {
      throw new BackupArchiveError(
        'malformed',
        `This backup tried to write outside the data directory ("${relative}"). Refusing.`,
      );
    }
    await deps.mkdir(dirname(path));
    await deps.writeFile(path, bytes);
    written.push(path);
  };

  const metaBytes = archive.members[BACKUP_META_PATH];
  if (metaBytes === undefined) {
    // Unreachable — validateArchive verified it — but an unpack that silently
    // wrote no meta.db would leave an install with no users at all.
    throw new BackupArchiveError('checksum', 'This backup has no meta.db.');
  }
  await write(BACKUP_META_PATH, metaBytes);

  for (const entry of archive.databases) {
    const bytes = archive.members[`${BACKUP_DATABASES_DIR}/${entry.slug}.sqlite`];
    if (bytes === undefined) continue;
    await write(`${BACKUP_DATABASES_DIR}/${entry.slug}.sqlite`, bytes);
  }

  return { written };
}

// ─── Filesystem port ────────────────────────────────────────────────────────

/** The filesystem surface this module uses, injected so restores are testable. */
export interface FsDeps {
  mkdir(dir: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
}

export const nodeFsDeps: FsDeps = {
  mkdir: async (dir) => {
    await mkdir(dir, { recursive: true });
  },
  rename: (from, to) => rename(from, to),
  writeFile: (path, bytes) => writeFile(path, bytes),
};

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

function isErrno(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === code
  );
}
