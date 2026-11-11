// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE INSTANCE ARCHIVE FORMAT (`adminium archive create/restore`), version 1.
 *
 * One zip holding a whole instance, as far as one file can:
 *
 * ```
 * adminium-archive/manifest.json            what is inside, with every member's size and SHA-256
 * adminium-archive/signature.json           HMAC-SHA256 over manifest.json (full archives)
 * adminium-archive/meta/<table>.json        the meta store, one table per member, any dialect
 * adminium-archive/files/<file id>          uploads kept on this server's own disk
 * adminium-archive/files/<dest id>/<id>     uploads of another `local` destination
 * adminium-archive/databases/<slug>.sqlite  local SQLite sources, snapshotted online
 * adminium-archive/project/<path>           the project folder (apps, sides, sites, pages …)
 * ```
 *
 * TWO KINDS, ONE WRITER. `full` is the same instance coming back: people with
 * their password hashes, secrets still encrypted with `ADMINIUM_SECRET`, signed.
 * `export` is "Export everything": the same contents less password hashes,
 * secrets, keys and tokens, unsigned, read back by `adminium import-zip`. The
 * restore applies the export rules itself whatever the file says, so a file
 * that CLAIMS to be an export carries nothing an export may not.
 *
 * A wire contract: changing the layout or the manifest is a
 * {@link ARCHIVE_FORMAT_VERSION} bump, and a reader refuses a newer number.
 * It is not the desktop backup format (`backup/format.ts`), whose `meta.db` is
 * a SQLite file and cannot be restored into Postgres or MySQL.
 */

import { isId } from '@adminium/meta';
import { z } from 'zod';

export const ARCHIVE_FORMAT_VERSION = 1;

export const ARCHIVE_ROOT = 'adminium-archive';
export const ARCHIVE_MANIFEST = `${ARCHIVE_ROOT}/manifest.json`;
export const ARCHIVE_SIGNATURE = `${ARCHIVE_ROOT}/signature.json`;
export const ARCHIVE_META_DIR = `${ARCHIVE_ROOT}/meta`;
export const ARCHIVE_FILES_DIR = `${ARCHIVE_ROOT}/files`;
export const ARCHIVE_DATABASES_DIR = `${ARCHIVE_ROOT}/databases`;
export const ARCHIVE_PROJECT_DIR = `${ARCHIVE_ROOT}/project`;

/** `adminium-archive-YYYYMMDD-HHMMSS.zip`, in UTC. */
export function archiveFileName(at: number, kind: ArchiveKind = 'full'): string {
  const iso = new Date(at).toISOString();
  const stamp = `${iso.slice(0, 10).replace(/-/g, '')}-${iso.slice(11, 19).replace(/:/g, '')}`;
  return `${kind === 'export' ? 'adminium-export' : 'adminium-archive'}-${stamp}.zip`;
}

/**
 * Limits a restore holds every archive to, signed or not. The signed manifest
 * names each member's size and the reader stops inflating one byte past it, so
 * a zip bomb needs the key; these bound what even a signed file may ask for.
 */
export const ARCHIVE_LIMITS = {
  /** Members, all kinds together. */
  entries: 200_000,
  /** Everything unpacked. A zip without zip64 cannot hold more than 4 GiB anyway. */
  totalBytes: 4 * 1024 ** 3,
  /** `manifest.json` and `signature.json`. */
  manifestBytes: 64 * 1024 ** 2,
  /** One meta table's JSON (parsed in memory). */
  metaTableBytes: 1024 ** 3,
  /** A member path. */
  pathLength: 512,
} as const;

export type ArchiveKind = 'full' | 'export';

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);

/** One member's size and digest; every member but the manifest and signature is listed. */
export const archiveEntrySchema = z.strictObject({
  path: z.string().min(1).max(ARCHIVE_LIMITS.pathLength),
  bytes: z.number().int().nonnegative(),
  sha256,
});

export type ArchiveEntry = z.infer<typeof archiveEntrySchema>;

/** File and destination ids name paths on restore, so they are held to the exact id grammar. */
const fileId = z.string().refine((value) => isId(value, 'file'), 'must be a file id');
const destinationId = z.string().refine((value) => isId(value, 'dest'), 'must be a destination id');
/** Never a path: only matched against rows. */
const rowId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const slug = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);

export const archiveManifestSchema = z.strictObject({
  formatVersion: z.number().int().positive(),
  kind: z.enum(['full', 'export']),
  appVersion: z.string().min(1).max(64),
  createdAt: z.number().int().nonnegative(),
  /** The meta store's dialect when it was archived (any restores into any). */
  dialect: z.enum(['sqlite', 'postgres', 'mysql']),
  /** The source ledger's last migration name: restore migrates up to it, loads, then runs the rest. */
  metaVersion: z.string().regex(/^\d{4}_[a-z0-9_]+$/),
  secrets: z.strictObject({
    /** `encrypted`: values travel as `enc:v1:` tokens only the same secret opens. `omitted`: none travel. */
    policy: z.enum(['encrypted', 'omitted']),
    /** An HMAC that only the same `ADMINIUM_SECRET` reproduces; null when nothing is encrypted. */
    check: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  }),
  meta: z.array(z.strictObject({ table: z.string().regex(/^adminium_[a-z0-9_]+$/), rows: z.number().int().nonnegative(), path: z.string() })),
  files: z.array(
    z.strictObject({
      id: fileId,
      /** `null`: the server's own disk (`<data dir>/files`). Otherwise a `local` destination. */
      destinationId: destinationId.nullable(),
      path: z.string(),
    }),
  ),
  databases: z.array(z.strictObject({ connectionId: rowId, slug, path: z.string() })),
  /** Sources whose rows stay where they are (other hosts, or a SQLite file this server could not read). */
  external: z.array(z.strictObject({ connectionId: rowId, engine: z.string().max(32) })),
  /** Relative to the project folder; `null` when the instance runs without one. */
  project: z.strictObject({ files: z.array(z.string()) }).nullable(),
  /** Installed catalog apps and add-ons: fetched and verified again after a restore, never carried. */
  packages: z.array(
    z.strictObject({
      kind: z.enum(['app', 'add-on']),
      key: z.string().max(80),
      version: z.string().max(64),
      source: z.string().max(32),
    }),
  ),
  /** What the writer left out on purpose, in words, for the person reading the manifest. */
  leftOut: z.array(z.string().max(300)).max(200),
  entries: z.array(archiveEntrySchema),
});

export type ArchiveManifest = z.infer<typeof archiveManifestSchema>;

export const archiveSignatureSchema = z.strictObject({
  alg: z.literal('HMAC-SHA256'),
  /** Which key signed it, so a refusal can say which one to set. Not trusted for anything else. */
  key: z.enum(['archive-key', 'secret']),
  mac: z.string().regex(/^[0-9a-f]{64}$/),
});

export type ArchiveSignature = z.infer<typeof archiveSignatureSchema>;

/** A refusal a host acts on by kind, not by its words: the file is the other kind of archive. */
export type ArchiveRefusalCode = 'full-archive' | 'export-file';

export class ArchiveFormatError extends Error {
  override readonly name = 'ArchiveFormatError';
  constructor(
    message: string,
    readonly hint?: string,
    readonly code?: ArchiveRefusalCode,
  ) {
    super(message);
  }
}

/**
 * Whether a member path is one this format can write. Archive paths are
 * untrusted input: `..`, `.`, empty segments, a leading `/`, backslashes, a
 * drive letter, NUL and control characters are all refused, so no member can
 * name a place outside the folder it is unpacked into.
 */
export function isSafeArchivePath(path: string): boolean {
  if (path.length === 0 || path.length > ARCHIVE_LIMITS.pathLength) return false;
  if (path.startsWith('/') || path.includes('\\')) return false;
  // eslint-disable-next-line no-control-regex -- control characters are exactly what this refuses.
  if (/[\u0000-\u001f\u007f]/.test(path)) return false;
  if (/^[A-Za-z]:/.test(path)) return false;
  return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

/** A path under `project/`, relative to the project folder, checked the same way. */
export function isSafeProjectPath(path: string): boolean {
  return isSafeArchivePath(path) && !path.split('/').some((segment) => segment.length > 255);
}
