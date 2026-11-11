// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `adminium archive create`: write a whole instance into one file.
 *
 * Contents and rules: `format.ts` (layout), `policy.ts` (what is left out),
 * `mac.ts` (the signature). This module gathers the parts:
 *
 * 1. the meta store, dumped table by table (`@adminium/meta` `dumpMetaTable`),
 *    then sanitized by the same function a restore runs;
 * 2. uploads kept on this server's disk: the implicit destination
 *    (`<data dir>/files`) and every `local` destination. Remote ones (S3,
 *    WebDAV) keep their bytes where they are;
 * 3. local SQLite sources, snapshotted with SQLite's online backup (WAL-safe,
 *    the desktop backup's own `snapshotSqliteFile`);
 * 4. the project folder, less what is the machine's and not the project's:
 *    `.env` (plain-text secrets), `.adminium/` (build output, the Designer's live
 *    id, approvals), `node_modules/`, `.git/`, the data dir when it sits inside,
 *    the live-id file, and any symlink (never followed);
 * 5. a manifest naming every member's size and SHA-256, then its MAC.
 *
 * Every member is hashed before the zip is written, so the manifest can be the
 * FIRST member and a restore can check the signature before inflating anything
 * else. The zip is written to `<out>.part` and renamed, so a failed run never
 * leaves a file that looks finished.
 */

import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { closeSync, openSync, writeSync } from 'node:fs';
import { lstat, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

import {
  dumpMetaTable,
  isId,
  metaColumnKinds,
  relocatableTables,
  type DsnCrypto,
  type MetaDb,
  type MetaTableDump,
} from '@adminium/meta';
import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';

import { snapshotSqliteFile, discoverSources } from '../backup/snapshot.js';
import { FILES_DIR } from '../files/drivers/local.js';
import { LIVE_APPS_ID_FILE } from '../designer/live.js';
import { APP_VERSION } from '../version.js';
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
  isSafeProjectPath,
  type ArchiveEntry,
  type ArchiveKind,
  type ArchiveManifest,
} from './format.js';
import { secretCheck, signManifest, type ArchiveSigningKey } from './mac.js';
import { readJsonCell, rowsOf, sanitizeDump, type SanitizeReport } from './policy.js';

/** Fixed entry time (the zip epoch, local time), so identical contents make identical members. */
const ZIP_EPOCH = new Date(1980, 0, 1, 12, 0, 0);

/** Project-folder names that are never archived, at any depth. */
const SKIPPED_ANYWHERE: ReadonlySet<string> = new Set(['node_modules', '.git']);
/** Project-folder paths (relative, `/`-separated) that are never archived. */
const SKIPPED_PROJECT_PATHS: ReadonlySet<string> = new Set(['.adminium', LIVE_APPS_ID_FILE.split(sep).join('/')]);

/** `.env` and its local variants hold plain-text secrets. `.env.example` is documentation. */
function isDotEnv(name: string): boolean {
  return name === '.env' || (name.startsWith('.env.') && name !== '.env.example');
}

export interface CreateArchiveOptions {
  meta: MetaDb;
  /** Destination `.zip`. Refused when it exists. */
  outPath: string;
  dataDir: string;
  /** The project folder, or null when the instance runs without one. */
  projectRoot: string | null;
  kind: ArchiveKind;
  /** `ADMINIUM_SECRET`: the secret check, and opening DSNs to find local SQLite files. */
  secret: string;
  dsnCrypto: DsnCrypto;
  /** Signs a full archive. An export is not signed. */
  signing: ArchiveSigningKey;
  now?: () => number;
}

export interface CreateArchiveResult {
  path: string;
  bytes: number;
  manifest: ArchiveManifest;
  sanitized: SanitizeReport;
  /** Notes worth printing: files missing on disk, symlinks skipped. */
  warnings: string[];
}

/** One member to write: bytes in memory, or a file on disk read twice (hash, then zip). */
type Member = { path: string; data: Buffer; compress: boolean } | { path: string; file: string; compress: boolean };

async function hashFile(path: string): Promise<{ bytes: number; sha256: string }> {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
    bytes += (chunk as Buffer).length;
  }
  return { bytes, sha256: hash.digest('hex') };
}

async function readMetaVersion(meta: MetaDb): Promise<string> {
  const row = await meta.db.selectFrom('adminium_migrations').select('name').orderBy('name', 'desc').limit(1).executeTakeFirst();
  if (row === undefined) throw new ArchiveFormatError('The meta store has no migrations applied; there is nothing to archive.');
  return row.name;
}

/** Regular files under `root`, relative and `/`-separated, without what {@link SKIPPED_PROJECT_PATHS} names. */
async function walkProject(
  root: string,
  skip: (relativePath: string) => boolean,
  warnings: string[],
): Promise<string[]> {
  const found: string[] = [];
  const visit = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const full = join(dir, entry.name);
      const rel = relative(root, full).split(sep).join('/');
      if (SKIPPED_ANYWHERE.has(entry.name) || SKIPPED_PROJECT_PATHS.has(rel) || skip(rel)) continue;
      if (entry.isSymbolicLink()) {
        warnings.push(`Left out ${rel}: it is a symbolic link, and an archive carries none.`);
        continue;
      }
      if (entry.isDirectory()) {
        await visit(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (isDotEnv(entry.name)) continue;
      if (!isSafeProjectPath(rel)) {
        warnings.push(`Left out ${rel}: its name cannot travel in an archive.`);
        continue;
      }
      found.push(rel);
    }
  };
  await visit(root);
  return found;
}

const inside = (child: string, parent: string): boolean => child === parent || child.startsWith(parent + sep);

export async function createArchive(opts: CreateArchiveOptions): Promise<CreateArchiveResult> {
  const now = opts.now ?? Date.now;
  const outPath = resolve(opts.outPath);
  const dataDir = resolve(opts.dataDir);
  const warnings: string[] = [];
  const exporting = opts.kind === 'export';
  if (await stat(outPath).then(() => true, () => false)) {
    throw new ArchiveFormatError(`${outPath} already exists.`, 'Name a new file; an archive never overwrites one.');
  }
  if (opts.projectRoot !== null && inside(outPath, resolve(opts.projectRoot)) && !inside(outPath, dataDir)) {
    // Not fatal, but the next archive would carry this one.
    warnings.push(`${outPath} is inside the project folder; the next archive will carry it. Keep archives elsewhere.`);
  }

  // ── 1. the meta store ──────────────────────────────────────────────────────
  const kinds = await metaColumnKinds(opts.meta);
  const tables = new Map<string, MetaTableDump>();
  for (const table of relocatableTables()) {
    const tableKinds = kinds.get(table);
    if (tableKinds === undefined) continue;
    tables.set(table, await dumpMetaTable(opts.meta, table, tableKinds));
  }
  const metaVersion = await readMetaVersion(opts.meta);
  // A full archive carries API keys; the RESTORE drops them unless asked.
  const sanitized = sanitizeDump(tables, { kind: opts.kind, dialect: opts.meta.dialect, keepApiKeys: true });

  const members: Member[] = [];
  const metaEntries: ArchiveManifest['meta'] = [];
  for (const dump of tables.values()) {
    const path = `${ARCHIVE_META_DIR}/${dump.table}.json`;
    members.push({ path, data: Buffer.from(JSON.stringify(dump)), compress: true });
    metaEntries.push({ table: dump.table, rows: dump.rows.length, path });
  }

  // ── 2. uploads on this server's disk ──────────────────────────────────────
  const localRoots = new Map<string | null, string>([[null, join(dataDir, FILES_DIR)]]);
  const destinations = tables.get('adminium_storage_destinations');
  if (destinations !== undefined) {
    for (const row of rowsOf(destinations)) {
      if (row.driver !== 'local') continue;
      const config = readJsonCell(destinations, 'config', row.config) as { root?: unknown } | null;
      if (typeof config?.root === 'string' && typeof row.id === 'string') localRoots.set(row.id, resolve(config.root));
    }
  }
  const fileEntries: ArchiveManifest['files'] = [];
  const filesDump = tables.get('adminium_files');
  if (filesDump !== undefined) {
    for (const row of rowsOf(filesDump)) {
      const destinationId = (row.destinationId ?? null) as string | null;
      const root = localRoots.get(destinationId);
      if (root === undefined) continue; // a remote destination keeps its bytes
      const id = String(row.id);
      const key = String(row.storageKey);
      if (!isId(id, 'file') || key !== id) {
        warnings.push(`Left out the bytes of ${id}: its storage key is not its id.`);
        continue;
      }
      const source = join(root, key);
      const info = await lstat(source).catch(() => null);
      if (info === null || !info.isFile()) {
        if (row.deletedAt === null) warnings.push(`File ${id} is missing from ${root}; its row travels without bytes.`);
        continue;
      }
      const path = destinationId === null ? `${ARCHIVE_FILES_DIR}/${id}` : `${ARCHIVE_FILES_DIR}/${destinationId}/${id}`;
      members.push({ path, file: source, compress: false });
      fileEntries.push({ id, destinationId, path });
    }
  }

  // ── 3. local SQLite sources ───────────────────────────────────────────────
  const scratch = join(dataDir, `.archive-tmp-${randomBytes(6).toString('hex')}`);
  await mkdir(scratch, { recursive: true, mode: 0o700 });
  try {
    const sources = await discoverSources(opts.meta, opts.dsnCrypto);
    const databases: ArchiveManifest['databases'] = [];
    const sqliteFiles = new Set<string>();
    for (const source of sources.local) {
      const snapshot = join(scratch, `${source.slug}.sqlite`);
      try {
        await snapshotSqliteFile(source.path, snapshot);
      } catch (error) {
        warnings.push(`Left out the SQLite file of connection ${source.connectionId}: ${(error as Error).message}`);
        sources.external.push({ connectionId: source.connectionId, slug: source.slug, engine: 'sqlite' });
        continue;
      }
      sqliteFiles.add(source.path);
      const path = `${ARCHIVE_DATABASES_DIR}/${source.slug}.sqlite`;
      members.push({ path, file: snapshot, compress: true });
      databases.push({ connectionId: source.connectionId, slug: source.slug, path });
    }

    // ── 4. the project folder ───────────────────────────────────────────────
    let project: ArchiveManifest['project'] = null;
    if (opts.projectRoot !== null) {
      const root = resolve(opts.projectRoot);
      const skip = (rel: string): boolean => {
        const full = join(root, ...rel.split('/'));
        if (inside(full, dataDir) || full === scratch) return true;
        for (const db of sqliteFiles) if (full === db || full.startsWith(`${db}-`)) return true;
        return false;
      };
      const files = await walkProject(root, skip, warnings);
      for (const rel of files) members.push({ path: `${ARCHIVE_PROJECT_DIR}/${rel}`, file: join(root, ...rel.split('/')), compress: true });
      project = { files };
    }

    // ── 5. manifest, signature, zip ─────────────────────────────────────────
    const entries: ArchiveEntry[] = [];
    let total = 0;
    for (const member of members) {
      const digest =
        'data' in member
          ? { bytes: member.data.length, sha256: createHash('sha256').update(member.data).digest('hex') }
          : await hashFile(member.file);
      total += digest.bytes;
      entries.push({ path: member.path, ...digest });
    }
    if (total > ARCHIVE_LIMITS.totalBytes || members.length + 2 > ARCHIVE_LIMITS.entries) {
      throw new ArchiveFormatError(
        `This instance holds ${String(Math.round(total / 1024 ** 2))} MB in ${String(members.length)} files, more than one archive carries (4 GB).`,
        'Move uploads to an S3 or WebDAV destination, which an archive leaves where it is.',
      );
    }

    const manifests = tables.get('adminium_manifests');
    const packages: ArchiveManifest['packages'] = [];
    if (manifests !== undefined) {
      for (const row of rowsOf(manifests)) {
        if (row.kind !== 'app' && row.kind !== 'add-on') continue;
        if (row.source === 'folder') continue;
        packages.push({ kind: row.kind, key: String(row.manifestKey), version: String(row.version), source: String(row.source) });
      }
    }

    const leftOut = [
      'Sessions, password-reset and invitation tokens, and public visitors’ sign-ins.',
      'Add-on trust and the Designer’s live switch: switch the Designer on again after a restore.',
      'Catalog apps and add-ons: they are downloaded and checked again after a restore.',
      'Databases on other hosts: dump those with their own tools (e.g. pg_dump).',
      'The project’s .env file and .adminium folder.',
      ...(exporting
        ? ['Password hashes, API keys, and every secret: connection strings, mail and AI keys.']
        : ['API keys travel, and a restore drops them unless asked to keep them.']),
    ];

    const manifest = archiveManifestSchema.parse({
      formatVersion: ARCHIVE_FORMAT_VERSION,
      kind: opts.kind,
      appVersion: APP_VERSION,
      createdAt: now(),
      dialect: opts.meta.dialect,
      metaVersion,
      secrets: exporting ? { policy: 'omitted', check: null } : { policy: 'encrypted', check: secretCheck(opts.secret) },
      meta: metaEntries,
      files: fileEntries,
      databases,
      external: sources.external.map(({ connectionId, engine }) => ({ connectionId, engine })),
      project,
      packages,
      leftOut,
      entries,
    } satisfies ArchiveManifest);
    const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2));
    const head: Member[] = [{ path: ARCHIVE_MANIFEST, data: manifestBytes, compress: true }];
    if (!exporting) {
      head.push({ path: ARCHIVE_SIGNATURE, data: Buffer.from(JSON.stringify(signManifest(manifestBytes, opts.signing), null, 2)), compress: false });
    }

    await mkdir(dirname(outPath), { recursive: true });
    const partPath = `${outPath}.part`;
    const bytes = await writeZip(partPath, [...head, ...members]);
    await rename(partPath, outPath);
    return { path: outPath, bytes, manifest, sanitized, warnings };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/** Stream every member into a zip at `path`; returns the zip's size. */
async function writeZip(path: string, members: readonly Member[]): Promise<number> {
  const fd = openSync(path, 'wx', 0o600);
  let written = 0;
  let failure: Error | null = null;
  try {
    const zip = new Zip((error, chunk) => {
      if (error !== null) {
        failure = error;
        return;
      }
      writeSync(fd, chunk);
      written += chunk.length;
    });
    for (const member of members) {
      const entry = member.compress ? new ZipDeflate(member.path, { level: 6 }) : new ZipPassThrough(member.path);
      entry.mtime = ZIP_EPOCH;
      zip.add(entry);
      if ('data' in member) {
        entry.push(member.data, true);
        continue;
      }
      let last: Buffer | null = null;
      for await (const chunk of createReadStream(member.file)) {
        if (last !== null) entry.push(last, false);
        last = chunk as Buffer;
      }
      entry.push(last ?? new Uint8Array(0), true);
      if (failure !== null) throw failure;
    }
    zip.end();
    if (failure !== null) throw failure;
  } catch (error) {
    closeSync(fd);
    await rm(path, { force: true });
    throw error;
  }
  closeSync(fd);
  return written;
}
