/**
 * The bundle format: layout, manifest, and the Zod schemas both front doors
 * (export, import) validate against (M10-T03; 01-architecture.md §6.1, §8.2).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS, STATED ONCE SO IT CANNOT DRIFT: an Adminium bundle is
 * **configuration for a server, not a server and not source code**. Adminium
 * interprets config at runtime; it never emits an app. The bundle therefore
 * carries the instance's `adminium_*` config content as portable JSON, plus a
 * manifest that pins the versions needed to replay it, plus a README saying
 * exactly this. `package.json` in the bundle pins the `@adminiumjs/adminium` npm package at
 * the exporting version — per 01 §4.1 that single package *is* the complete
 * install (server + dashboard dist + meta migrations), so pinning it is how the
 * bundle names its runtime without shipping (unshippable, platform-specific,
 * natively-compiled) copies of it.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * VERSION REPLAY (§8.2): the manifest embeds `{ appVersion, configVersion,
 * metaVersion }`. On import the meta migrator brings the target schema up, and
 * `runConfigMigrations` from `@adminium/engine/config` replays every config
 * document's `v` up to the running build's — so a bundle exported at N imports
 * into any instance at ≥ N. A bundle from a *newer* build is refused rather
 * than silently half-read.
 */

import { z } from 'zod';

/** Bundle root inside the archive — one directory, so unzipping is tidy. */
export const BUNDLE_ROOT = 'adminium-export';

export const MANIFEST_PATH = `${BUNDLE_ROOT}/manifest.json`;
export const README_PATH = `${BUNDLE_ROOT}/README.md`;
export const PACKAGE_JSON_PATH = `${BUNDLE_ROOT}/package.json`;
export const CONFIG_DIR = `${BUNDLE_ROOT}/config`;

/** The config resources the bundle carries, in import (FK-safe) order. */
export const BUNDLE_RESOURCES = [
  'settings',
  'roles',
  'rolePermissions',
  'connections',
  'snapshots',
  'overrides',
  'pages',
  'views',
] as const;

export type BundleResource = (typeof BUNDLE_RESOURCES)[number];

export function resourcePath(resource: BundleResource): string {
  return `${CONFIG_DIR}/${resource}.json`;
}

// ─── Manifest ────────────────────────────────────────────────────────────────

/**
 * How secrets were treated. `omitted` is the default and means the target must
 * re-enter DSNs and provider keys. `encrypted` means the ciphertext travelled
 * and only the *same* `ADMINIUM_SECRET` can re-open it — stated explicitly so a
 * bundle can never be mistaken for a self-contained credential store.
 */
export const secretsPolicySchema = z.enum(['omitted', 'encrypted']);
export type SecretsPolicy = z.infer<typeof secretsPolicySchema>;

export const bundleManifestSchema = z.object({
  /** Bundle-layout version; bumped when this file's shape changes. */
  formatVersion: z.number().int().min(1),
  /** The `adminium` version that wrote the bundle (§8.2). */
  appVersion: z.string().min(1),
  /** Config-envelope version of the documents inside (§6.1 `v`, §8.2). */
  configVersion: z.number().int().min(1),
  /** Meta-schema high-water mark: the last applied migration name (§8.2). */
  metaVersion: z.string().min(1),
  exportedAt: z.number().int().nonnegative(),
  /** Set when the export was scoped to one connection. */
  connectionId: z.string().nullable(),
  secrets: z.object({
    policy: secretsPolicySchema,
    /**
     * Keys/columns carried as AES-256-GCM ciphertext. Non-empty ⇒ the bundle is
     * sensitive and needs the source instance's ADMINIUM_SECRET.
     */
    encrypted: z.array(z.string()),
    /** Secret settings dropped because secrets were not requested. */
    omitted: z.array(z.string()),
  }),
  counts: z.record(z.string(), z.number().int().nonnegative()),
});

export type BundleManifest = z.infer<typeof bundleManifestSchema>;

// ─── Resource payloads ───────────────────────────────────────────────────────

/**
 * Rows are validated structurally (ids/strings/JSON), not semantically: the
 * semantic authority for a page's `config` is `@adminium/engine/config`, and the
 * import runs documents through it *after* the config migrations replay. Keeping
 * these loose is deliberate — a v1 bundle's page config must be allowed in the
 * door so it can be migrated to v2; validating it against today's schema first
 * would reject exactly the old bundles version replay exists to accept.
 */
const jsonValue = z.unknown();
const id = z.string().min(1);

export const settingsRowSchema = z.object({ key: z.string().min(1), value: jsonValue });

export const roleRowSchema = z.object({
  id,
  slug: z.string().min(1),
  name: z.string(),
  description: z.string().nullable().optional(),
  isBuiltin: z.boolean(),
});

export const rolePermissionRowSchema = z.object({
  id,
  roleId: id,
  resourceKind: z.string(),
  resourceRef: z.string(),
  actions: jsonValue,
});

export const connectionRowSchema = z.object({
  id,
  name: z.string(),
  engine: z.string(),
  sourceKind: z.string(),
  readOnly: z.boolean(),
  ssl: jsonValue.nullable().optional(),
  settings: jsonValue,
  /** Ciphertext, present only in an `encrypted`-policy bundle. */
  introspectDsnEncrypted: z.string().nullable().optional(),
  dataDsnEncrypted: z.string().nullable().optional(),
});

export const snapshotRowSchema = z.object({
  id,
  connectionId: id,
  source: z.string(),
  importFormat: z.string().nullable().optional(),
  engineVersion: z.string().nullable().optional(),
  schema: jsonValue,
  stats: jsonValue.nullable().optional(),
  checksum: z.string(),
  isActive: z.boolean(),
});

export const overrideRowSchema = z.object({
  id,
  connectionId: id,
  op: z.string(),
  tableName: z.string(),
  columnName: z.string().nullable().optional(),
  value: jsonValue,
  origin: z.string(),
  status: z.string(),
  confidence: z.number().nullable().optional(),
});

export const pageRowSchema = z.object({
  id,
  connectionId: id.nullable(),
  slug: z.string(),
  type: z.string(),
  title: z.string(),
  icon: z.string().nullable().optional(),
  navGroup: z.string().nullable().optional(),
  navOrder: z.number(),
  config: jsonValue,
  origin: z.string(),
  generatedFromSnapshotId: id.nullable().optional(),
  isEnabled: z.boolean(),
});

export const viewRowSchema = z.object({
  id,
  pageId: id,
  kind: z.string(),
  name: z.string(),
  config: jsonValue,
  isDefault: z.boolean(),
});

/** Resource name → row schema. The import iterates this, so a resource without
 *  a schema cannot be imported by accident. */
export const RESOURCE_SCHEMAS = {
  settings: settingsRowSchema,
  roles: roleRowSchema,
  rolePermissions: rolePermissionRowSchema,
  connections: connectionRowSchema,
  snapshots: snapshotRowSchema,
  overrides: overrideRowSchema,
  pages: pageRowSchema,
  views: viewRowSchema,
} as const satisfies Record<BundleResource, z.ZodType>;

export type SettingsRow = z.infer<typeof settingsRowSchema>;
export type RoleRow = z.infer<typeof roleRowSchema>;
export type RolePermissionRow = z.infer<typeof rolePermissionRowSchema>;
export type ConnectionRow = z.infer<typeof connectionRowSchema>;
export type SnapshotRow = z.infer<typeof snapshotRowSchema>;
export type OverrideRow = z.infer<typeof overrideRowSchema>;
export type PageRow = z.infer<typeof pageRowSchema>;
export type ViewRow = z.infer<typeof viewRowSchema>;

/** The in-memory shape of a whole bundle — what export writes and import reads. */
export interface ConfigBundle {
  manifest: BundleManifest;
  settings: SettingsRow[];
  roles: RoleRow[];
  rolePermissions: RolePermissionRow[];
  connections: ConnectionRow[];
  snapshots: SnapshotRow[];
  overrides: OverrideRow[];
  pages: PageRow[];
  views: ViewRow[];
}
