// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Zip-export service (M10-T03, 01-architecture.md §4.1/§6.1/§8.2; BRIEF §3).
 *
 * WHAT IT EXPORTS — the design decision the docs make loudly, so the
 * implementation cannot drift: **server + config, never source code.** The zip
 * carries the runtime-interpreted configuration — connection definitions
 * (secrets excluded unless {@link ExportZipOptions.includeSecrets} is set),
 * schema snapshots, overrides, pages/dashboards, views, settings, roles — plus a
 * manifest for version replay on re-import and a README that says all of this in
 * its first heading. Adminium does not emit an app; the bundle names its runtime
 * by pinning the `@adminiumjs/adminium` npm package (01 §4.1: that one package *is* the
 * complete install — server + dashboard dist + meta migrations), it does not
 * carry a copy of it.
 *
 * The secret policy lives in `redaction.ts` and fails closed: every field that
 * leaves is on an allow-list, and any value that must be ciphertext is asserted
 * to be ciphertext before it is written. See that module's header.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { CONFIG_VERSION } from '@adminium/engine/config';
import { ALL_MIGRATIONS, writeBool, type MetaDb } from '@adminium/meta';
import { strToU8, zipSync, type Zippable } from 'fflate';

import { APP_VERSION } from '../version.js';
import {
  BUNDLE_RESOURCES,
  MANIFEST_PATH,
  PACKAGE_JSON_PATH,
  README_PATH,
  resourcePath,
  type BundleManifest,
  type ConfigBundle,
} from './bundle.js';
import { renderPackageJson, renderReadme } from './readme.js';
import {
  EXPORTED_COLUMNS,
  assertCiphertext,
  assertNoCredentialColumns,
  pickColumns,
  redactSettings,
  secretColumnsFor,
} from './redaction.js';

/** Bumped when the bundle layout changes (re-import replay). */
export const EXPORT_ZIP_MANIFEST_VERSION = 1;

/**
 * Fixed entry timestamp, so two exports of identical config are byte-identical
 * and bundles stay diffable. The zip format cannot represent anything before
 * 1980, so this — the zip epoch — is the earliest fixed point available; the
 * real export time lives in the manifest's `exportedAt`, where it is readable.
 */
const ZIP_EPOCH = new Date('1980-01-01T00:00:00.000Z');

export interface ExportZipOptions {
  /** The meta store to read the configuration out of. */
  meta: MetaDb;
  /**
   * Restrict the bundle to one connection's configuration. `null`/omitted
   * exports the whole instance (every connection + instance-level settings).
   */
  connectionId?: string | null | undefined;
  /** Absolute or cwd-relative destination path for the `.zip`. */
  outPath: string;
  /**
   * Include encrypted DSNs / provider keys in the bundle. Default `false` —
   * an export is shareable by default; secrets are re-entered on re-import.
   */
  includeSecrets?: boolean | undefined;
  /** `ADMINIUM_DATA_DIR` — the bootstrap file + any file-backed artifacts. */
  dataDir: string;
  /** Version stamped into the manifest (defaults to the running app version). */
  appVersion?: string | undefined;
  /** Clock override — tests. */
  now?: () => number;
}

export interface ExportZipResult {
  /** Absolute path of the written archive. */
  path: string;
  /** Size of the written archive in bytes. */
  bytes: number;
  /** Archive member paths, for the CLI's summary line and the tests. */
  entries: string[];
  /** {@link EXPORT_ZIP_MANIFEST_VERSION} the bundle was written at. */
  manifestVersion: number;
  /** Row counts per exported resource, e.g. `{ pages: 12, overrides: 41 }`. */
  counts: Readonly<Record<string, number>>;
}

/** The seam the CLI (and, later, the Studio download route) call. */
export type ExportZip = (opts: ExportZipOptions) => Promise<ExportZipResult>;

/**
 * The meta-schema high-water mark for the manifest (§8.2 `metaVersion`): the
 * name of the last migration this store has applied. Read from the ledger, not
 * from {@link ALL_MIGRATIONS}, because what matters for replay is what the
 * *source* actually ran, not what its build happened to ship.
 */
async function readMetaVersion(meta: MetaDb): Promise<string> {
  const rows = await meta.db
    .selectFrom('adminium_migrations')
    .select('name')
    .orderBy('name', 'desc')
    .limit(1)
    .execute();
  const latest = rows[0]?.name;
  if (latest !== undefined) return latest;
  // An unmigrated store has no config worth exporting, but refusing here would
  // be unhelpful — record the build's own baseline instead.
  return ALL_MIGRATIONS[ALL_MIGRATIONS.length - 1]?.name ?? '0000_empty';
}

/** Kysely rows come back with dialect-shaped booleans (0/1) — normalize. */
function toBool(value: unknown): boolean {
  return value === true || value === 1;
}

/**
 * JSON columns arrive parsed (PG jsonb) or as a string (SQLite/MySQL). The
 * bundle must carry structure, not a dialect artifact, so normalize both ways.
 */
function toJson(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * `ssl` is `{ mode, caFileId }` — no inline key material, so it travels. The
 * `caFileId` points at an `adminium_files` row the bundle does not carry, so it
 * is nulled rather than left dangling at the target.
 */
function redactSsl(ssl: unknown): unknown {
  if (ssl === null || typeof ssl !== 'object' || Array.isArray(ssl)) return ssl;
  const record = ssl as Record<string, unknown>;
  if (!('caFileId' in record)) return ssl;
  return { ...record, caFileId: null };
}

interface ReadOptions {
  meta: MetaDb;
  connectionId: string | null;
  includeSecrets: boolean;
}

interface ReadResult extends Omit<ConfigBundle, 'manifest'> {
  /** Secret settings dropped because secrets were not requested. */
  droppedSecretKeys: string[];
  /** Secret settings carried as ciphertext. */
  encryptedSettingKeys: string[];
}

/**
 * Read every allow-listed row. Each block projects through {@link pickColumns}
 * against {@link EXPORTED_COLUMNS}, so a column added by a future migration
 * cannot ride along unnoticed.
 */
async function readBundle(opts: ReadOptions): Promise<ReadResult> {
  const { meta, connectionId, includeSecrets } = opts;
  const { db } = meta;

  // ── settings ──────────────────────────────────────────────────────────────
  // Instance-level; a connection-scoped export carries none — they are not that
  // connection's config, and copying them would silently restyle the target.
  const settingRows =
    connectionId === null
      ? await db.selectFrom('adminium_settings').select(['key', 'value']).execute()
      : [];
  const settings = redactSettings(
    settingRows.map((row) => ({ key: row.key, value: toJson(row.value) })),
    includeSecrets,
  );

  // ── roles + permissions ───────────────────────────────────────────────────
  const roleRows =
    connectionId === null ? await db.selectFrom('adminium_roles').selectAll().execute() : [];
  const roles = roleRows.map((row) => ({
    ...pickColumns(row, EXPORTED_COLUMNS.adminium_roles),
    isBuiltin: toBool(row.isBuiltin),
    description: row.description ?? null,
  })) as ConfigBundle['roles'];

  const permissionRows =
    connectionId === null
      ? await db.selectFrom('adminium_role_permissions').selectAll().execute()
      : [];
  const rolePermissions = permissionRows.map((row) => ({
    ...pickColumns(row, EXPORTED_COLUMNS.adminium_role_permissions),
    actions: toJson(row.actions),
  })) as ConfigBundle['rolePermissions'];

  // ── connections ───────────────────────────────────────────────────────────
  let connectionQuery = db.selectFrom('adminium_connections').selectAll();
  if (connectionId !== null) connectionQuery = connectionQuery.where('id', '=', connectionId);
  const connectionRows = await connectionQuery.execute();

  const connections = connectionRows.map((row) => {
    const base = {
      ...pickColumns(row, EXPORTED_COLUMNS.adminium_connections),
      readOnly: toBool(row.readOnly),
      ssl: redactSsl(toJson(row.ssl)),
      settings: toJson(row.settings),
    };
    if (!includeSecrets) return base;

    // Ciphertext only — assertCiphertext throws rather than let a plaintext DSN
    // out, whatever the write path did.
    const secrets: Record<string, string | null> = {};
    for (const column of secretColumnsFor('adminium_connections')) {
      secrets[column] = assertCiphertext(
        (row as Record<string, unknown>)[column],
        `connections.${row.id}.${column}`,
      );
    }
    return { ...base, ...secrets };
  }) as ConfigBundle['connections'];

  const connectionIds = connectionRows.map((row) => row.id);

  // ── snapshots ─────────────────────────────────────────────────────────────
  // Only the ACTIVE snapshot per connection: history is instance data, and a
  // bundle carrying every introspection ever run would be enormous for no gain.
  const snapshotRows =
    connectionIds.length === 0
      ? []
      : await db
          .selectFrom('adminium_schema_snapshots')
          .selectAll()
          .where('connectionId', 'in', connectionIds)
          // Dialect-correct bind (`repos/util.ts`): sqlite stores 0/1, PG a real
          // boolean, and neither driver accepts the other's form.
          .where('isActive', '=', writeBool(meta, true))
          .execute();
  const snapshots = snapshotRows.map((row) => ({
    ...pickColumns(row, EXPORTED_COLUMNS.adminium_schema_snapshots),
    schema: toJson(row.schema),
    stats: toJson(row.stats),
    isActive: toBool(row.isActive),
    importFormat: row.importFormat ?? null,
    engineVersion: row.engineVersion ?? null,
  })) as ConfigBundle['snapshots'];

  // ── overrides ─────────────────────────────────────────────────────────────
  const overrideRows =
    connectionIds.length === 0
      ? []
      : await db
          .selectFrom('adminium_schema_overrides')
          .selectAll()
          .where('connectionId', 'in', connectionIds)
          .execute();
  const overrides = overrideRows.map((row) => ({
    ...pickColumns(row, EXPORTED_COLUMNS.adminium_schema_overrides),
    value: toJson(row.value),
    columnName: row.columnName ?? null,
    confidence: row.confidence ?? null,
  })) as ConfigBundle['overrides'];

  // ── pages ─────────────────────────────────────────────────────────────────
  let pageQuery = db.selectFrom('adminium_pages').selectAll();
  if (connectionId !== null) pageQuery = pageQuery.where('connectionId', '=', connectionId);
  const pageRows = await pageQuery.execute();

  const snapshotIds = new Set(snapshotRows.map((row) => row.id));
  const pages = pageRows.map((row) => ({
    ...pickColumns(row, EXPORTED_COLUMNS.adminium_pages),
    config: toJson(row.config),
    isEnabled: toBool(row.isEnabled),
    icon: row.icon ?? null,
    navGroup: row.navGroup ?? null,
    // Keep the provenance link only when its snapshot travels with us; a
    // dangling id would point at a snapshot the target has never seen.
    generatedFromSnapshotId:
      row.generatedFromSnapshotId !== null && snapshotIds.has(row.generatedFromSnapshotId)
        ? row.generatedFromSnapshotId
        : null,
  })) as ConfigBundle['pages'];

  // ── views ─────────────────────────────────────────────────────────────────
  // Shared views only (`user_id IS NULL`). A per-user view belongs to a user the
  // target install does not have; it is personal state, not instance config.
  const pageIds = pageRows.map((row) => row.id);
  const viewRows =
    pageIds.length === 0
      ? []
      : await db
          .selectFrom('adminium_views')
          .selectAll()
          .where('pageId', 'in', pageIds)
          .where('userId', 'is', null)
          .execute();
  const views = viewRows.map((row) => ({
    ...pickColumns(row, EXPORTED_COLUMNS.adminium_views),
    config: toJson(row.config),
    isDefault: toBool(row.isDefault),
  })) as ConfigBundle['views'];

  return {
    settings: settings.rows,
    roles,
    rolePermissions,
    connections,
    snapshots,
    overrides,
    pages,
    views,
    droppedSecretKeys: settings.droppedSecretKeys,
    encryptedSettingKeys: settings.encryptedKeys,
  };
}

/** Stable JSON — two exports of identical config should be identical bytes, so
 *  bundles stay diffable and reviewable. */
function toJsonBytes(value: unknown): Uint8Array {
  return strToU8(JSON.stringify(value, null, 2) + '\n');
}

/** fflate takes a nested object; our paths are flat `a/b/c` strings. */
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

/**
 * Export the instance's configuration to `outPath`.
 *
 * Ordering carries the secret guarantee: redaction runs while reading, the
 * manifest is built from what redaction actually *did* (not from what was
 * asked for), and only then are bytes produced.
 */
export const exportZip: ExportZip = async (opts) => {
  // Cheap, and turns a future bad edit to the allow-list into a thrown error at
  // the top of the export rather than a leak at the bottom of it.
  assertNoCredentialColumns();

  const connectionId = opts.connectionId ?? null;
  const includeSecrets = opts.includeSecrets ?? false;
  const now = opts.now ?? Date.now;

  const body = await readBundle({ meta: opts.meta, connectionId, includeSecrets });

  // What actually travelled encrypted — enumerated from the data, so the
  // manifest and README can never overstate or understate the bundle.
  const encrypted: string[] = [...body.encryptedSettingKeys];
  if (includeSecrets) {
    for (const connection of body.connections) {
      for (const column of secretColumnsFor('adminium_connections')) {
        if ((connection as Record<string, unknown>)[column] != null) {
          encrypted.push(`connections.${connection.id}.${column}`);
        }
      }
    }
  }

  const counts: Record<string, number> = {};
  for (const resource of BUNDLE_RESOURCES) counts[resource] = body[resource].length;

  const manifest: BundleManifest = {
    formatVersion: EXPORT_ZIP_MANIFEST_VERSION,
    appVersion: opts.appVersion ?? APP_VERSION,
    configVersion: CONFIG_VERSION,
    metaVersion: await readMetaVersion(opts.meta),
    exportedAt: now(),
    connectionId,
    secrets: {
      policy: encrypted.length > 0 ? 'encrypted' : 'omitted',
      encrypted,
      omitted: body.droppedSecretKeys,
    },
    counts,
  };

  const files: Record<string, Uint8Array> = {
    [MANIFEST_PATH]: toJsonBytes(manifest),
    [README_PATH]: strToU8(renderReadme(manifest)),
    [PACKAGE_JSON_PATH]: strToU8(renderPackageJson(manifest)),
  };
  for (const resource of BUNDLE_RESOURCES) {
    files[resourcePath(resource)] = toJsonBytes(body[resource]);
  }

  const zipped = zipSync(nest(files), { level: 6, mtime: ZIP_EPOCH });

  const path = resolve(opts.outPath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, zipped);

  return {
    path,
    bytes: zipped.byteLength,
    entries: Object.keys(files).sort(),
    manifestVersion: EXPORT_ZIP_MANIFEST_VERSION,
    counts,
  };
};
