// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `adminium archive restore` (and `adminium import-zip` for an export file):
 * bring an archive back into a FRESH instance.
 *
 * ─── THE ARCHIVE IS NOT TRUSTED (security review S15) ──────────────────────
 * In order, before anything is written:
 * 1. the zip's directory: no links, no directories, no unsafe names, no zip64,
 *    no more members than the limit (`zip-read.ts`);
 * 2. the manifest: a newer format is refused; a full archive's MAC is checked
 *    with this server's key, unsigned or altered is refused;
 * 3. every member is listed in the manifest with its size and digest, every
 *    listed member is there, and each is checked as it is inflated;
 * 4. every path the archive names is rebuilt from ids, slugs and checked
 *    relative paths (no `..`, nothing absolute, nothing the writer leaves out of
 *    a project folder: `isExcludedProjectPath`), and every place it lands must
 *    not exist yet and must have no symlink between it and its root;
 * 5. the rows go through `sanitizeDump` again (no sessions, tokens, add-on
 *    trust or package copies, whatever the file holds; an export loses every
 *    hash and secret), then through the save-time guards: each connection
 *    string through `checkDsn` (`ADMINIUM_DATABASE_HOSTS`, the network policy,
 *    the host looked up where loopback or private ranges are refused), each S3/WebDAV address through
 *    `checkDestinationAddress` (looked up, every answer checked, the network
 *    policy applied), each `local` folder through `storageRootRefusal` (never
 *    Adminium's own files, inside `ADMINIUM_STORAGE_DIRS` when set), each app
 *    domain through `hostIssueFor`. An export (unsigned) names no folder at
 *    all: its `local` destinations are switched off and their files land in
 *    `<data dir>/files`, re-pointed at this server's own disk.
 *    A row that fails is kept but made inert (a connection without its string,
 *    a destination switched off, a domain left out), and the CLI says so.
 *
 * ─── A FRESH INSTANCE ONLY ─────────────────────────────────────────────────
 * The target meta store must be empty (no `adminium_` tables), or hold only
 * what a first start seeds (roles, settings; no person, no page, no
 * connection) at the archive's own migration level. Restoring INTO a used
 * instance would merge two instances' ids, people and secrets, and there is no
 * merge rule that is right for both; a new data dir or database is one line.
 * So there is no flag to force it.
 *
 * An empty store is migrated up to the archive's last migration, loaded, then
 * migrated the rest of the way, so the data migrations a newer build ships run
 * over the restored rows exactly as they would over an upgraded instance.
 *
 * ─── ORDER ─────────────────────────────────────────────────────────────────
 * Files are inflated into a staging folder first; the meta store is loaded in
 * one transaction; only then are the staged files moved into place. A failure
 * before the move leaves the target as it was.
 */

import { createHash, randomBytes } from 'node:crypto';
import { constants, copyFile, lstat, mkdir, rename, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

import {
  ALL_MIGRATIONS,
  applyMigrations,
  loadMetaDump,
  probeAdminiumTables,
  relocatableTables,
  SETTINGS_REGISTRY,
  seedBuiltinRoles,
  seedSystemSettings,
  type DsnCrypto,
  type MetaDb,
  type MetaTableDump,
} from '@adminium/meta';

import { checkDsn, type DatabaseHost } from '../connections/dsn.js';
import { PROJECT_KEY_PATTERN } from '../project/config.js';
import { checkDestinationAddress } from '../files/destinations.js';
import { FILES_DIR } from '../files/drivers/local.js';
import { storageRootRefusal, type StorageRootPolicy } from '../files/root-guard.js';
import type { HostLookup } from '../net/address-guard.js';
import { hostIssueFor } from '../surfaces/validate.js';
import {
  ARCHIVE_DATABASES_DIR,
  ARCHIVE_FILES_DIR,
  ARCHIVE_FORMAT_VERSION,
  ARCHIVE_LIMITS,
  ARCHIVE_MANIFEST,
  ARCHIVE_META_DIR,
  ARCHIVE_PROJECT_DIR,
  ARCHIVE_SIGNATURE,
  ArchiveFormatError,
  archiveManifestSchema,
  archiveSignatureSchema,
  isExcludedProjectPath,
  isSafeProjectPath,
  type ArchiveEntry,
  type ArchiveKind,
  type ArchiveManifest,
  type ArchiveSignature,
} from './format.js';
import { sameSecret, verifyManifest, type ArchiveSigningKey } from './mac.js';
import { commitRows, readJsonCell, rowsOf, sanitizeDump, writeJsonCell, type SanitizeReport } from './policy.js';
import { ZipReader } from './zip-read.js';

/** Where local SQLite sources land: the desktop's own `<data dir>/databases/<slug>.sqlite`. */
export const RESTORED_DATABASES_DIR = 'databases';

/** Tables a first start fills; a store holding rows only here still counts as fresh. */
const SEEDED_TABLES: ReadonlySet<string> = new Set(['adminium_settings', 'adminium_roles', 'adminium_role_permissions']);

export interface RestoreArchiveOptions {
  inPath: string;
  /** The target meta store, opened; migrated or not. */
  meta: MetaDb;
  dataDir: string;
  /** Where the archive's project folder goes. Required when the archive has one. */
  projectRoot: string | null;
  /** This server's `ADMINIUM_SECRET`. */
  secret: string;
  dsnCrypto: DsnCrypto;
  signing: ArchiveSigningKey;
  /** `full` from `archive restore`, `export` from `import-zip`; the other kind is refused. */
  expect: ArchiveKind;
  keepApiKeys?: boolean;
  /** Restore under a different `ADMINIUM_SECRET`: every sealed value is dropped. */
  dropSecrets?: boolean;
  /** Public pages hidden, mail off, Designer off: for looking at, not for running. */
  hold?: boolean;
  /** The connection and storage guards' loopback rule (production refuses loopback). */
  blockLoopback: boolean;
  /** `ADMINIUM_NETWORK_POLICY=strict`: an S3/WebDAV address on the server's own network is refused too. */
  blockPrivate?: boolean | undefined;
  /** Where a `local` destination's folder may be (`storageRootPolicyFor`). Default: off the data dir. */
  storageRoots?: StorageRootPolicy | undefined;
  /**
   * `ADMINIUM_DATABASE_HOSTS`: a connection to one of these hosts and ports passes the loopback (and,
   * under `strict`, the private-network) check, as when it is saved. "Allow databases on this server" is
   * never read from the archive (`policy.ts`), so it is off here.
   */
  databaseHosts?: readonly DatabaseHost[] | undefined;
  /** Test seam: the storage and database hosts' lookup. Default: the system resolver's. */
  lookup?: HostLookup | undefined;
  /** Check everything, write nothing. */
  dryRun?: boolean;
  /**
   * An export brings people WITHOUT passwords, so on its own nobody could sign
   * in to the instance it makes, and a server with no mail could not send a
   * reset. `owner` is asked, once everything else has been checked and before
   * anything is written, which of the export's Super Admins signs in first and
   * with what password (its hash). Not asked on a dry run, nor for a full
   * archive, whose people keep their own passwords.
   */
  owner?: ((choice: ExportOwnerChoice) => Promise<ExportOwnerAnswer>) | undefined;
  /**
   * An export opened in the desktop app: the person `owner` picked is also this computer's owner
   * (`designer.ownerId`), whom the app signs in without a password, as it does the owner of a project
   * it made. Never read from the file: an export carries no owner setting (`policy.ts`).
   */
  localOwner?: boolean | undefined;
  now?: () => number;
}

/** A Super Admin an export brought, who could be given the first password. */
export interface ExportOwnerCandidate {
  id: string;
  email: string;
  name: string;
}

export interface ExportOwnerChoice {
  /** Active Super Admins in the export, the earliest made first. */
  candidates: readonly ExportOwnerCandidate[];
  /** The archive's own `auth.passwordMinLength`, or the default. */
  passwordMinLength: number;
}

export interface ExportOwnerAnswer {
  userId: string;
  /** argon2id, from `auth/passwords.ts`. */
  passwordHash: string;
}

export interface RestoreArchiveResult {
  manifest: ArchiveManifest;
  tables: { table: string; rows: number }[];
  files: number;
  databases: number;
  projectFiles: number;
  sanitized: SanitizeReport;
  warnings: string[];
  dryRun: boolean;
  /** Who was given a password on an export's import; null otherwise. */
  owner: ExportOwnerCandidate | null;
  /**
   * An export's active Super Admins, the earliest made first, and the
   * password length its settings ask for: what a host shows BEFORE the import
   * (a dry run) so the person can pick who signs in first. Empty for a full
   * archive.
   */
  owners: ExportOwnerCandidate[];
  passwordMinLength: number;
  /** Connections left without a connection string (an export carries none): Draft until it is entered again. */
  drafts: string[];
  /**
   * The project's databases (connections with a project key): where a restored SQLite file now is, or
   * null when its string must be entered again. What `import-zip` writes into the project's `.env`.
   */
  projectDatabases: { key: string; name: string; file: string | null }[];
}

/** The export's active Super Admins, the earliest made first. */
function exportOwnerCandidates(tables: Map<string, MetaTableDump>): ExportOwnerCandidate[] {
  const users = tables.get('adminium_users');
  const roles = tables.get('adminium_roles');
  const links = tables.get('adminium_user_roles');
  if (users === undefined || roles === undefined || links === undefined) return [];
  const superAdminRoles = new Set(rowsOf(roles).filter((row) => row.slug === 'super-admin').map((row) => String(row.id)));
  const holders = new Set(rowsOf(links).filter((row) => superAdminRoles.has(String(row.roleId))).map((row) => String(row.userId)));
  return rowsOf(users)
    .filter((row) => holders.has(String(row.id)) && row.status === 'active' && (row.deletedAt === null || row.deletedAt === undefined))
    .sort((a, b) => Number(a.createdAt ?? 0) - Number(b.createdAt ?? 0))
    .map((row) => ({ id: String(row.id), email: String(row.email), name: String(row.name ?? '') }));
}

/** A file to inflate, and where it ends up. */
interface Placement {
  entry: ArchiveEntry;
  final: string;
  /** The folder `final` must stay inside, and below which no symlink may sit. */
  root: string;
}

const inside = (child: string, parent: string): boolean => child.startsWith(parent + sep);

async function exists(path: string): Promise<boolean> {
  return lstat(path).then(
    () => true,
    () => false,
  );
}

/** Refuse when anything between `root` and `path` is a symlink or not a folder, or `path` leaves `root`. */
async function assertPlainPath(root: string, path: string): Promise<void> {
  if (!inside(path, root)) throw new ArchiveFormatError(`The archive names a path outside ${root}.`);
  let dir = dirname(path);
  while (dir !== root && inside(dir, root)) {
    const info = await lstat(dir).catch(() => null);
    if (info?.isSymbolicLink() === true) {
      throw new ArchiveFormatError(`${dir} is a symbolic link; a restore does not write through one.`);
    }
    if (info !== null && !info.isDirectory()) throw new ArchiveFormatError(`${dir} is a file, and the archive puts files inside it.`);
    dir = dirname(dir);
  }
}

function parseJson(bytes: Buffer, what: string): unknown {
  try {
    return JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    throw new ArchiveFormatError(`This is not a readable Adminium archive: ${what} is not JSON.`);
  }
}

/** A table dump read from the archive, checked for shape before anything uses it. */
function asTableDump(value: unknown, table: string): MetaTableDump {
  const dump = value as Partial<MetaTableDump> | null;
  const columns = dump?.columns;
  const kinds = dump?.kinds;
  const rows = dump?.rows;
  const ok =
    dump !== null &&
    typeof dump === 'object' &&
    dump.table === table &&
    Array.isArray(columns) &&
    columns.every((column) => typeof column === 'string' && /^[a-zA-Z0-9]+$/.test(column)) &&
    kinds !== null &&
    typeof kinds === 'object' &&
    Object.values(kinds).every((kind) => kind === 'json' || kind === 'boolean' || kind === 'other') &&
    Array.isArray(rows) &&
    rows.every((row) => Array.isArray(row) && row.length === columns.length);
  if (!ok) throw new ArchiveFormatError(`This is not a readable Adminium archive: the dump of ${table} is malformed.`);
  return { table, columns: columns, kinds: kinds, rows: rows };
}

export async function readArchiveManifest(
  zip: ZipReader,
): Promise<{ manifest: ArchiveManifest; manifestBytes: Buffer; signature: ArchiveSignature | null }> {
  const manifestBytes = await zip.readBuffer(ARCHIVE_MANIFEST, ARCHIVE_LIMITS.manifestBytes);
  const raw = parseJson(manifestBytes, 'the manifest');
  const version = (raw as { formatVersion?: unknown } | null)?.formatVersion;
  if (typeof version === 'number' && version > ARCHIVE_FORMAT_VERSION) {
    throw new ArchiveFormatError(
      `This archive was made by a newer Adminium (archive format ${String(version)}; this one reads ${String(ARCHIVE_FORMAT_VERSION)}).`,
      'Restore it with the same or a newer Adminium.',
    );
  }
  const parsed = archiveManifestSchema.safeParse(raw);
  if (!parsed.success) throw new ArchiveFormatError('This is not a readable Adminium archive: its manifest is malformed.');
  let signature: ArchiveSignature | null = null;
  if (zip.members.has(ARCHIVE_SIGNATURE)) {
    const sig = archiveSignatureSchema.safeParse(parseJson(await zip.readBuffer(ARCHIVE_SIGNATURE, 4096), 'the signature'));
    if (!sig.success) throw new ArchiveFormatError('This is not a readable Adminium archive: its signature is malformed.');
    signature = sig.data;
  }
  return { manifest: parsed.data, manifestBytes, signature };
}

/** Every member listed, every listed member present, sizes within the limit, and each section's paths in their own shape. */
function checkMembers(zip: ZipReader, manifest: ArchiveManifest): Map<string, ArchiveEntry> {
  const entries = new Map<string, ArchiveEntry>();
  let total = 0;
  for (const entry of manifest.entries) {
    if (entries.has(entry.path)) throw new ArchiveFormatError(`This archive lists ${entry.path} twice.`);
    if (!zip.members.has(entry.path)) throw new ArchiveFormatError(`This archive is incomplete: ${entry.path} is missing.`);
    total += entry.bytes;
    entries.set(entry.path, entry);
  }
  if (total > ARCHIVE_LIMITS.totalBytes) throw new ArchiveFormatError('This archive unpacks to more than an archive may hold.');
  for (const name of zip.members.keys()) {
    if (name !== ARCHIVE_MANIFEST && name !== ARCHIVE_SIGNATURE && !entries.has(name)) {
      throw new ArchiveFormatError(`This archive holds ${name}, which its manifest does not list.`);
    }
  }
  const expectPath = (path: string, shape: string): void => {
    if (path !== shape || !entries.has(path)) throw new ArchiveFormatError(`This archive names ${path} where ${shape} belongs.`);
  };
  for (const table of manifest.meta) expectPath(table.path, `${ARCHIVE_META_DIR}/${table.table}.json`);
  for (const file of manifest.files) {
    expectPath(file.path, file.destinationId === null ? `${ARCHIVE_FILES_DIR}/${file.id}` : `${ARCHIVE_FILES_DIR}/${file.destinationId}/${file.id}`);
  }
  for (const db of manifest.databases) expectPath(db.path, `${ARCHIVE_DATABASES_DIR}/${db.slug}.sqlite`);
  for (const rel of manifest.project?.files ?? []) {
    if (!isSafeProjectPath(rel)) throw new ArchiveFormatError(`This archive names a project path that is not allowed: ${rel.slice(0, 120)}`);
    // What the writer leaves out (secrets, the Designer's history, approvals, packages, git, the data dir) is
    // the machine's, not the project's: a file that carries it was not made by the writer, and is refused whole.
    if (isExcludedProjectPath(rel)) throw new ArchiveFormatError(`This archive names a project path an archive never carries: ${rel.slice(0, 120)}`);
    expectPath(`${ARCHIVE_PROJECT_DIR}/${rel}`, `${ARCHIVE_PROJECT_DIR}/${rel}`);
  }
  return entries;
}

/** Settings as a key → value map over the dump, written back on `commit`. */
function settingsOf(tables: Map<string, MetaTableDump>): {
  get(key: string): unknown;
  set(key: string, value: unknown, at: number): void;
  remove(key: string): boolean;
  commit(): void;
} {
  const dump = tables.get('adminium_settings');
  const rows = dump === undefined ? [] : rowsOf(dump);
  const index = new Map(rows.map((row) => [String(row.key), row]));
  return {
    get: (key) => {
      const row = index.get(key);
      return row === undefined || dump === undefined ? undefined : readJsonCell(dump, 'value', row.value);
    },
    set: (key, value, at) => {
      if (dump === undefined) return;
      const row = index.get(key) ?? { key, updatedBy: null };
      row.value = writeJsonCell(dump, 'value', value);
      row.updatedAt = at;
      if (!index.has(key)) {
        index.set(key, row);
        rows.push(row);
      }
    },
    remove: (key) => index.delete(key),
    commit: () => {
      if (dump !== undefined) commitRows(dump, [...index.values()]);
    },
  };
}

export async function restoreArchive(opts: RestoreArchiveOptions): Promise<RestoreArchiveResult> {
  const now = opts.now ?? Date.now;
  const dataDir = resolve(opts.dataDir);
  const warnings: string[] = [];
  const zip = await ZipReader.open(resolve(opts.inPath));
  try {
    // ── trust ────────────────────────────────────────────────────────────────
    const { manifest, manifestBytes, signature } = await readArchiveManifest(zip);
    if (manifest.kind !== opts.expect) {
      throw new ArchiveFormatError(
        manifest.kind === 'export' ? 'This file is an export, not an archive.' : 'This file is a full archive, not an export.',
        manifest.kind === 'export' ? 'Read it with `adminium import-zip --in <file>`.' : 'Restore it with `adminium archive restore <file>`.',
        manifest.kind === 'export' ? 'export-file' : 'full-archive',
      );
    }
    if (manifest.kind === 'full') verifyManifest(manifestBytes, signature, opts.signing);
    const entries = checkMembers(zip, manifest);

    const encrypted = manifest.kind === 'full' && manifest.secrets.policy === 'encrypted';
    const dropSecrets = encrypted && opts.dropSecrets === true;
    if (encrypted && !dropSecrets && (manifest.secrets.check === null || !sameSecret(manifest.secrets.check, opts.secret))) {
      throw new ArchiveFormatError(
        'This archive’s secrets were encrypted with a different ADMINIUM_SECRET.',
        'Set the ADMINIUM_SECRET the archive was made with, or pass --drop-secrets to restore without them (connection strings, mail and AI keys must then be entered again).',
      );
    }

    // ── the target must be fresh, and at a level the archive can load into ──
    const names = ALL_MIGRATIONS.map((migration) => migration.name);
    const level = names.indexOf(manifest.metaVersion);
    if (level < 0) {
      throw new ArchiveFormatError(
        `This archive comes from a newer Adminium (meta ${manifest.metaVersion}, Adminium ${manifest.appVersion}).`,
        'Restore it with the same or a newer Adminium.',
      );
    }
    const probe = await probeAdminiumTables(opts.meta);
    const empty = probe.present.length === 0;
    if (!empty) {
      const users = probe.occupied.includes('adminium_users');
      const extra = probe.occupied.filter((table) => !SEEDED_TABLES.has(table));
      if (users || extra.length > 0) {
        throw new ArchiveFormatError(
          users ? 'This instance already has people in it; a restore goes into a fresh instance only.' : `This instance is not fresh (${extra.slice(0, 5).join(', ')} hold rows); a restore goes into a fresh instance only.`,
          'Point ADMINIUM_DATA_DIR (and ADMINIUM_META_URL, if you use one) at a new, empty place and run the restore before the first start.',
        );
      }
      const ledger = await opts.meta.db.selectFrom('adminium_migrations').select('name').orderBy('name', 'desc').limit(1).executeTakeFirst();
      if (ledger?.name !== manifest.metaVersion) {
        throw new ArchiveFormatError(
          `This instance’s meta store is at ${ledger?.name ?? 'no migration'} and the archive at ${manifest.metaVersion}.`,
          'Restore into an empty database (a new ADMINIUM_DATA_DIR for the built-in store, or a new Postgres/MySQL database) before the first start; the restore migrates it itself.',
        );
      }
    }

    // ── the rows ─────────────────────────────────────────────────────────────
    const tables = new Map<string, MetaTableDump>();
    for (const { table, path } of manifest.meta) {
      const entry = entries.get(path) as ArchiveEntry;
      if (entry.bytes > ARCHIVE_LIMITS.metaTableBytes) throw new ArchiveFormatError(`The dump of ${table} is larger than a restore reads.`);
      const bytes = await zip.readBuffer(path, ARCHIVE_LIMITS.metaTableBytes);
      if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) {
        throw new ArchiveFormatError(`This archive was changed after it was made: ${path} does not match its manifest.`);
      }
      if (tables.has(table)) throw new ArchiveFormatError(`This archive holds ${table} twice.`);
      tables.set(table, asTableDump(parseJson(bytes, path), table));
    }
    const sanitized = sanitizeDump(tables, {
      kind: manifest.kind,
      dialect: manifest.dialect,
      keepApiKeys: opts.keepApiKeys === true,
      dropSecrets,
    });
    const at = now();

    // ── local SQLite sources point at their new place ───────────────────────
    const placements: Placement[] = [];
    const connections = tables.get('adminium_connections');
    const connectionRows = connections === undefined ? [] : rowsOf(connections);
    const restoredDatabases = new Map<string, string>();
    const databasesRoot = join(dataDir, RESTORED_DATABASES_DIR);
    for (const db of manifest.databases) {
      const row = connectionRows.find((candidate) => candidate.id === db.connectionId);
      if (row === undefined || row.engine !== 'sqlite') {
        warnings.push(`Skipped the SQLite file ${db.slug}: no SQLite connection ${db.connectionId} came with it.`);
        continue;
      }
      const final = join(databasesRoot, `${db.slug}.sqlite`);
      placements.push({ entry: entries.get(db.path) as ArchiveEntry, final, root: dataDir });
      const dsn = opts.dsnCrypto.encrypt(`sqlite:${final}`);
      row.introspectDsnEncrypted = dsn;
      row.dataDsnEncrypted = dsn;
      restoredDatabases.set(db.connectionId, final);
    }

    // ── the connection guard, again ─────────────────────────────────────────
    for (const row of connectionRows) {
      if (restoredDatabases.has(String(row.id))) continue;
      for (const column of ['introspectDsnEncrypted', 'dataDsnEncrypted'] as const) {
        const token = row[column];
        if (typeof token !== 'string' || token === '') continue;
        let refusal: string | null = null;
        try {
          const dsn = opts.dsnCrypto.decrypt(token);
          if (row.engine === 'sqlite') refusal = 'its SQLite file did not come with the archive';
          else {
            // The check a connection string gets when it is saved here: the list, the network policy, and
            // where loopback or private ranges are refused, a lookup of the host with every answer checked.
            await checkDsn(dsn, {
              blockLoopback: opts.blockLoopback,
              engine: String(row.engine),
              databaseHosts: opts.databaseHosts,
              blockPrivate: opts.blockPrivate === true,
              lookup: opts.lookup,
            });
          }
        } catch (error) {
          refusal = error instanceof Error ? error.message : 'it does not open';
        }
        if (refusal !== null) {
          row.introspectDsnEncrypted = null;
          row.dataDsnEncrypted = null;
          warnings.push(`Connection “${String(row.name)}” lost its connection string (${refusal}); enter it again.`);
          break;
        }
      }
      // No string left (an export carries none, or the guard took it): the state a connection
      // without one has everywhere else, so Studio shows it as one to finish, not as connected.
      const blank = (value: unknown): boolean => value === null || value === undefined || value === '';
      if (blank(row.introspectDsnEncrypted) && blank(row.dataDsnEncrypted)) row.status = 'unconfigured';
    }
    // A project key names an environment variable in the project's `.env` (`envVarFor`) and is written there:
    // the file's word for it is held to the key grammar, or the connection stays, with no project key.
    for (const row of connectionRows) {
      const key = row.projectKey;
      if (key === null || key === undefined) continue;
      if (typeof key === 'string' && PROJECT_KEY_PATTERN.test(key)) continue;
      row.projectKey = null;
      warnings.push(`Connection “${String(row.name)}” lost its project key, which is not a database key.`);
    }
    if (connections !== undefined) commitRows(connections, connectionRows);
    const drafts = connectionRows.filter((row) => row.status === 'unconfigured' && !restoredDatabases.has(String(row.id))).map((row) => String(row.name));
    const projectDatabases = connectionRows
      .filter((row) => typeof row.projectKey === 'string' && row.projectKey !== '')
      .map((row) => ({ key: String(row.projectKey), name: String(row.name), file: restoredDatabases.get(String(row.id)) ?? null }));

    // ── storage destinations, again ─────────────────────────────────────────
    const localRoots = new Map<string | null, string>([[null, join(dataDir, FILES_DIR)]]);
    const roots: StorageRootPolicy = opts.storageRoots ?? { own: { dataDir, metaFile: null } };
    const destinations = tables.get('adminium_storage_destinations');
    /** An export's `local` destinations: their files are re-pointed at this server's own disk. */
    const exportLocal = new Set<string>();
    if (destinations !== undefined) {
      const rows = rowsOf(destinations);
      for (const row of rows) {
        const config = readJsonCell(destinations, 'config', row.config) as Record<string, unknown> | null;
        let refusal: string | null = null;
        if (row.driver === 'local' && manifest.kind === 'export') {
          // An unsigned file names its folders itself, and a folder named by a file is no folder of this server's:
          // it would be made and written into before anyone looked. The bytes land on this server's own disk
          // instead (below), and the destination stays, switched off, for a Super Admin to point at a folder here.
          refusal = 'an export’s folders are another computer’s; its files are on this server’s disk now';
          exportLocal.add(String(row.id));
        } else if (row.driver === 'local') {
          const root = typeof config?.root === 'string' ? config.root : '';
          if (!isAbsolute(root)) refusal = 'its folder is not an absolute path';
          else if (resolve(root) === dataDir || inside(dataDir, resolve(root)) || inside(resolve(root), dataDir)) {
            refusal = 'its folder is the data dir, inside it, or above it';
          } else {
            refusal = storageRootRefusal(root, roots)?.message ?? null;
            if (refusal === null && (row.disabledAt === null || row.disabledAt === undefined)) localRoots.set(String(row.id), resolve(root));
          }
        } else {
          try {
            await checkDestinationAddress(row.driver as 's3' | 'webdav', config as never, {
              blockLoopback: opts.blockLoopback,
              blockPrivate: opts.blockPrivate === true,
              lookup: opts.lookup,
            });
          } catch (error) {
            refusal = error instanceof Error ? error.message : 'its address is refused';
          }
        }
        if (refusal !== null) {
          row.disabledAt = at;
          row.isDefault = typeof row.isDefault === 'boolean' ? false : 0;
          warnings.push(`Storage destination “${String(row.name ?? row.id)}” is switched off (${refusal}).`);
        }
      }
      commitRows(destinations, rows);
    }
    if (exportLocal.size > 0) {
      const filesDump = tables.get('adminium_files');
      if (filesDump !== undefined) {
        const rows = rowsOf(filesDump);
        for (const row of rows) if (exportLocal.has(String(row.destinationId))) row.destinationId = null;
        commitRows(filesDump, rows);
      }
    }
    for (const file of manifest.files) {
      if (file.destinationId !== null && exportLocal.has(file.destinationId)) {
        placements.push({ entry: entries.get(file.path) as ArchiveEntry, final: join(dataDir, FILES_DIR, file.id), root: dataDir });
        continue;
      }
      const root = localRoots.get(file.destinationId);
      if (root === undefined) {
        warnings.push(`Skipped the bytes of ${file.id}: its destination is switched off or did not come with the archive.`);
        continue;
      }
      placements.push({ entry: entries.get(file.path) as ArchiveEntry, final: join(root, file.id), root: file.destinationId === null ? dataDir : root });
    }

    // ── domains, again; hold; the export's bootstrap claim ─────────────────
    const settings = settingsOf(tables);
    for (const key of ['surfaces.domains', 'surfaces.pageHosts', 'surfaces.retiredHosts']) {
      const value = settings.get(key);
      if (value === null || typeof value !== 'object') continue;
      const kept: Record<string, unknown> = {};
      for (const [host, target] of Object.entries(value as Record<string, unknown>)) {
        const issue = hostIssueFor(host);
        if (issue === null) kept[host] = target;
        else warnings.push(`Left out the domain ${host.slice(0, 80)} (${issue}).`);
      }
      settings.set(key, kept, at);
    }
    if (opts.hold === true) {
      // Mail is off when no SMTP transport is set (`email/config.ts`); the
      // archive file keeps the setting for whoever restores it to run.
      if (settings.remove('email.smtp')) warnings.push('Hold: the SMTP setting was not restored, so no mail goes out.');
      settings.set('publicApi.enabled', false, at);
      settings.set('publicApi.docsEnabled', false, at);
      settings.remove('surfaces.pageHosts');
      const apps = (settings.get('surfaces.apps') ?? {}) as Record<string, { off?: string[] } & Record<string, unknown>>;
      const keys = new Set(Object.keys(apps));
      const domains = (settings.get('surfaces.domains') ?? {}) as Record<string, { appKey?: unknown }>;
      for (const target of Object.values(domains)) if (typeof target.appKey === 'string') keys.add(target.appKey);
      const manifests = tables.get('adminium_manifests');
      for (const row of manifests === undefined ? [] : rowsOf(manifests)) if (row.kind === 'app') keys.add(String(row.manifestKey));
      for (const rel of manifest.project?.files ?? []) {
        const match = /^apps\/([^/]+)\//.exec(rel);
        if (match?.[1] !== undefined && !match[1].startsWith('.')) keys.add(match[1]);
      }
      for (const key of keys) {
        const entry = apps[key] ?? {};
        apps[key] = { ...entry, off: [...new Set([...(entry.off ?? []), 'customer'])] };
      }
      settings.set('surfaces.apps', apps, at);
    }
    const users = tables.get('adminium_users');
    if (manifest.kind === 'export' && users !== undefined && users.rows.length > 0 && settings.get('system.superAdminCreatedAt') === undefined) {
      // People arrive; the first-run claim must arrive with them, or the setup
      // page would hand a stranger a super admin beside them.
      settings.set('system.superAdminCreatedAt', at, at);
    }
    settings.commit();

    // ── the project folder ──────────────────────────────────────────────────
    const projectFiles = manifest.project?.files ?? [];
    if (projectFiles.length > 0) {
      if (opts.projectRoot === null) {
        throw new ArchiveFormatError('This archive holds a project folder, and no place was given for it.', 'Pass --project-dir <folder> (a new or empty folder).');
      }
      const root = resolve(opts.projectRoot);
      for (const rel of projectFiles) {
        const final = join(root, ...rel.split('/'));
        // The data dir inside the project folder under another name than `data/`: its files are the instance's own.
        if (final === dataDir || inside(final, dataDir)) {
          throw new ArchiveFormatError(`This archive names a project path inside the data dir: ${rel.slice(0, 120)}`);
        }
        placements.push({ entry: entries.get(`${ARCHIVE_PROJECT_DIR}/${rel}`) as ArchiveEntry, final, root });
      }
    }

    // Every place must be new, and reached without a symlink. Compared as the file systems a restore usually
    // writes to compare names (APFS and NTFS ignore case, APFS how a letter is composed), and no place may be
    // the folder of another: either would fail only in the move, after the meta store was loaded.
    const finals = new Set<string>();
    const folded = (path: string): string => path.normalize('NFC').toLowerCase();
    for (const placement of placements) {
      await assertPlainPath(placement.root, placement.final);
      if (finals.has(folded(placement.final))) throw new ArchiveFormatError(`This archive writes ${placement.final} twice (names that differ only in case are one file).`);
      finals.add(folded(placement.final));
    }
    for (const placement of placements) {
      for (let dir = dirname(placement.final); dir !== placement.root && inside(dir, placement.root); dir = dirname(dir)) {
        if (finals.has(folded(dir))) throw new ArchiveFormatError(`This archive writes ${dir} as a file and as a folder.`);
      }
    }
    for (const placement of placements) {
      if (await exists(placement.final)) {
        throw new ArchiveFormatError(`${placement.final} already exists; a restore never overwrites a file.`, 'Restore into a fresh instance (a new data dir and project folder).');
      }
    }

    const owners = manifest.kind === 'export' ? exportOwnerCandidates(tables) : [];
    const minimum = settings.get('auth.passwordMinLength');
    const passwordMinLength = typeof minimum === 'number' && Number.isInteger(minimum) ? minimum : SETTINGS_REGISTRY['auth.passwordMinLength'].default;
    let owner: ExportOwnerCandidate | null = null;
    const result = (tablesLoaded: { table: string; rows: number }[]): RestoreArchiveResult => ({
      owner,
      owners,
      passwordMinLength,
      drafts,
      projectDatabases,
      manifest,
      tables: tablesLoaded,
      files: placements.filter((p) => p.entry.path.startsWith(`${ARCHIVE_FILES_DIR}/`)).length,
      databases: restoredDatabases.size,
      projectFiles: projectFiles.length,
      sanitized,
      warnings,
      dryRun: opts.dryRun === true,
    });
    if (opts.dryRun === true) {
      return result([...tables.values()].map((dump) => ({ table: dump.table, rows: dump.rows.length })));
    }

    // ── an export's first way in ────────────────────────────────────────────
    if (manifest.kind === 'export' && opts.owner !== undefined) {
      const candidates = owners;
      const users = tables.get('adminium_users');
      if (candidates.length === 0 || users === undefined) {
        warnings.push('This export holds no active Super Admin, so no password was set; sign in through “Forgot password”.');
      } else {
        const answer = await opts.owner({ candidates, passwordMinLength });
        const chosen = candidates.find((candidate) => candidate.id === answer.userId);
        if (chosen === undefined) throw new ArchiveFormatError('That person is not one of this export’s Super Admins.');
        const rows = rowsOf(users);
        for (const row of rows) if (String(row.id) === chosen.id) row.passwordHash = answer.passwordHash;
        commitRows(users, rows);
        owner = chosen;
        if (opts.localOwner === true) {
          settings.set('designer.ownerId', chosen.id, at);
          settings.commit();
        }
      }
    }

    // ── write: stage, load, move ────────────────────────────────────────────
    await mkdir(dataDir, { recursive: true });
    const staging = join(dataDir, `.archive-restore-${randomBytes(6).toString('hex')}`);
    await mkdir(staging, { mode: 0o700 });
    try {
      const staged: { from: string; to: string }[] = [];
      let index = 0;
      for (const placement of placements) {
        const from = join(staging, String(index++));
        await zip.extractTo(placement.entry.path, from, placement.entry);
        staged.push({ from, to: placement.final });
      }

      if (empty) {
        await applyMigrations(opts.meta.db, { dialect: opts.meta.dialect, migrations: ALL_MIGRATIONS.slice(0, level + 1) });
      }
      const loaded = await loadMetaDump(opts.meta, [...tables.values()], { wipe: relocatableTables() });
      await applyMigrations(opts.meta.db, { dialect: opts.meta.dialect });
      await seedBuiltinRoles(opts.meta, at);
      await seedSystemSettings(opts.meta, at);

      for (const { from, to } of staged) {
        await mkdir(dirname(to), { recursive: true });
        await moveFile(from, to);
      }
      return result(loaded.tables);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  } finally {
    await zip.close();
  }
}

/** Rename, or copy and delete across file systems (a project folder on another disk). */
async function moveFile(from: string, to: string): Promise<void> {
  if (await exists(to)) throw new ArchiveFormatError(`${to} appeared during the restore; it was not overwritten.`);
  try {
    await rename(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    await copyFile(from, to, constants.COPYFILE_EXCL);
  }
}
