/**
 * Manifest spec v1 (13-marketplace.md §2), frozen at `manifestVersion: 1` for
 * all of Adminium 1.x. Pure Zod v4 + types — no `node:` imports — so the
 * storefront and the Electron shell can validate a manifest in the browser
 * (01-architecture.md §3, the `@adminium/manifest` package row).
 *
 * This module is the envelope: every block's shape and the cross-block rules.
 * The install PLANNER (planInstall / requiredSchema → create-or-map diff) and
 * the server-side installer are later layers that consume a validated manifest.
 */

import { z } from 'zod';

/** Integer spec version, frozen at 1 for Adminium 1.x (§2, 01 §8). */
export const MANIFEST_VERSION = 1;

/** strict semver — `major.minor.patch` with optional pre-release/build. */
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const semver = z.string().regex(SEMVER, 'must be strict semver (major.minor.patch)');

/** An i18n message: a catalog key plus the English fallback rendered if absent. */
export const i18nMessageSchema = z
  .object({
    key: z.string().min(1).max(120),
    fallback: z.string().min(1).max(400),
  })
  .strict();
export type I18nMessage = z.infer<typeof i18nMessageSchema>;

// ── §2.3 identity ────────────────────────────────────────────────────────────

/** Closed v1 storefront facet set (§2.3). */
export const MANIFEST_CATEGORIES = [
  'commerce',
  'hospitality',
  'operations',
  'crm',
  'internal-tools',
] as const;
export const categorySchema = z.enum(MANIFEST_CATEGORIES);

/** The one publisher id v1 accepts unless `third-party-publishers` is on (§2.3/§9). */
export const FIRST_PARTY_PUBLISHER_ID = 'adminium';

export const publisherSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/, 'publisher id must be ^[a-z][a-z0-9-]{1,39}$'),
    name: z.string().min(1).max(80),
    url: z.url().max(200).optional(),
  })
  .strict();
export type Publisher = z.infer<typeof publisherSchema>;

export const identitySchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9-]{1,79}$/, 'key must be ^[a-z][a-z0-9-]{1,79}$'),
    name: z.string().min(1).max(80),
    version: semver,
    publisher: publisherSchema,
    // SPDX id — the FRONTEND's license (informational; core is AGPL-3.0).
    license: z.string().min(1).max(80),
    description: i18nMessageSchema,
    categories: z.array(categorySchema).min(1),
  })
  .strict();

// ── §2.11 capabilities ───────────────────────────────────────────────────────

export const MANIFEST_CAPABILITIES = [
  'hosted-only',
  'offline-required',
  'receipt-printer',
  'barcode-scanner',
  'payments',
  'file-storage',
  'email-delivery',
  'realtime',
] as const;
export const capabilitySchema = z.enum(MANIFEST_CAPABILITIES);
export type Capability = z.infer<typeof capabilitySchema>;

// ── §2.4 compatibility ───────────────────────────────────────────────────────

export const compatibilitySchema = z
  .object({
    minAdminiumVersion: semver,
    maxAdminiumVersion: semver.optional(), // exclusive upper bound
    requires: z.array(capabilitySchema).optional(),
  })
  .strict();

// ── §2.5 requiredSchema (create-or-map) ──────────────────────────────────────

/** Abstract column types the introspection engine emits (§2.5, research §15.2). */
export const COLUMN_TYPES = [
  'id',
  'text',
  'int',
  'bigint',
  'decimal',
  'money',
  'float',
  'bool',
  'enum',
  'json',
  'date',
  'timestamptz',
  'uuid',
  'fk',
  'blob',
] as const;

/** Optional semantic pre-seed so widgets auto-instantiate (§2.5). */
export const COLUMN_SEMANTICS = [
  'name',
  'money',
  'image',
  'email',
  'avatar',
  'geo-lat',
  'geo-lng',
] as const;

/** Structural role markers (§2.5). */
export const COLUMN_ROLES = ['pk', 'created_at', 'updated_at'] as const;

export const requiredColumnSchema = z
  .object({
    ref: z.string().regex(/^[a-z][a-z0-9_]*$/, 'column ref must be a snake_case identifier'),
    type: z.enum(COLUMN_TYPES),
    semantic: z.enum(COLUMN_SEMANTICS).optional(),
    role: z.enum(COLUMN_ROLES).optional(),
    nullable: z.boolean().optional(),
    // enum values when `type: 'enum'`; fk target ref when `type: 'fk'`.
    enum: z.array(z.string().min(1)).optional(),
    references: z.string().optional(),
  })
  .strict()
  .refine((c) => c.type !== 'enum' || (c.enum !== undefined && c.enum.length > 0), {
    message: 'an enum column must list its enum values',
    path: ['enum'],
  })
  .refine((c) => c.type !== 'fk' || c.references !== undefined, {
    message: 'a fk column must name its references target',
    path: ['references'],
  });

export const requiredTableSchema = z
  .object({
    ref: z.string().regex(/^[a-z][a-z0-9_]*$/, 'table ref must be a snake_case identifier'),
    columns: z.array(requiredColumnSchema).min(1),
  })
  .strict()
  .refine(
    (t) => new Set(t.columns.map((c) => c.ref)).size === t.columns.length,
    { message: 'duplicate column ref in table', path: ['columns'] },
  );

export const requiredSchemaSchema = z
  .object({
    tables: z.array(requiredTableSchema).min(1),
  })
  .strict()
  .refine((s) => new Set(s.tables.map((t) => t.ref)).size === s.tables.length, {
    message: 'duplicate table ref in requiredSchema',
    path: ['tables'],
  });

// ── §2.6 pages ───────────────────────────────────────────────────────────────

export const pageNavSchema = z
  .object({
    group: z.string().min(1).max(80),
    icon: z.string().min(1).max(60),
    order: z.number().int(),
  })
  .strict();

export const pageSchema = z
  .object({
    ref: z.string().regex(/^[a-z][a-z0-9-]*$/, 'page ref must be a kebab-case identifier'),
    template: z.string().min(1).max(80),
    title: i18nMessageSchema,
    nav: pageNavSchema,
    // page-local table ref → requiredSchema table ref (resolved at install).
    bindings: z.record(z.string(), z.string()).optional(),
    config: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

// ── §2.7 roles ───────────────────────────────────────────────────────────────

export const roleSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9-]*$/, 'role key must be a kebab-case identifier'),
    name: z.string().min(1).max(80),
    cloneFrom: z.string().optional(),
    // grant strings validated against the RBAC grammar at install time.
    permissions: z.array(z.string().min(1)).optional(),
  })
  .strict();

// ── §2.8 settings ────────────────────────────────────────────────────────────

const settingBase = {
  key: z.string().regex(/^[a-z][a-z0-9_]*$/, 'setting key must be snake_case'),
  required: z.boolean().optional(),
  secret: z.boolean().optional(),
  label: i18nMessageSchema.optional(),
};

export const settingSchema = z.discriminatedUnion('type', [
  z.object({ ...settingBase, type: z.literal('string'), default: z.string().optional() }).strict(),
  z
    .object({
      ...settingBase,
      type: z.literal('number'),
      default: z.number().optional(),
      min: z.number().optional(),
      max: z.number().optional(),
      unit: z.string().max(20).optional(),
    })
    .strict(),
  z.object({ ...settingBase, type: z.literal('boolean'), default: z.boolean().optional() }).strict(),
  z
    .object({
      ...settingBase,
      type: z.literal('enum'),
      enum: z.array(z.string().min(1)).min(1),
      default: z.string().optional(),
    })
    .strict(),
  z
    .object({
      ...settingBase,
      type: z.literal('file'),
      accept: z.array(z.string().min(1)).optional(),
    })
    .strict(),
  z.object({ ...settingBase, type: z.literal('json'), default: z.unknown().optional() }).strict(),
]);

// ── §2.9 seeds ───────────────────────────────────────────────────────────────

export const seedSchema = z
  .object({
    table: z.string().min(1),
    // inline rows, or a reference to a bundled seeds/<file> dataset (§2.9).
    rows: z.array(z.record(z.string(), z.unknown())).optional(),
    file: z.string().min(1).optional(),
  })
  .strict()
  .refine((s) => (s.rows === undefined) !== (s.file === undefined), {
    message: 'a seed provides exactly one of `rows` or `file`',
  });

// ── §2.10 widgets (optional custom bundles) ──────────────────────────────────

export const manifestWidgetSchema = z
  .object({
    id: z.string().min(1).max(80),
    entry: z.string().min(1),
  })
  .strict();

// ── §2.12 frontend ───────────────────────────────────────────────────────────

export const FRONTEND_KINDS = ['spa', 'electron', 'none'] as const;

export const frontendEnvVarSchema = z
  .object({
    required: z.boolean(),
    example: z.string().optional(),
  })
  .strict();

export const frontendSchema = z
  .object({
    kind: z.enum(FRONTEND_KINDS),
    entry: z.string().min(1).optional(),
    env: z.record(z.string(), frontendEnvVarSchema).optional(),
  })
  .strict();

// ── the manifest envelope ─────────────────────────────────────────────────────

export const manifestSchema = z
  .object({
    manifestVersion: z.literal(MANIFEST_VERSION),
    ...identitySchema.shape,
    compatibility: compatibilitySchema,
    requiredSchema: requiredSchemaSchema,
    pages: z.array(pageSchema).min(1),
    roles: z.array(roleSchema).optional(),
    settings: z.array(settingSchema).optional(),
    seeds: z.array(seedSchema).optional(),
    widgets: z.array(manifestWidgetSchema).optional(),
    capabilities: z.array(capabilitySchema).optional(),
    frontend: frontendSchema,
  })
  .strict()
  // §2.11: hosted-only and offline-required are mutually exclusive.
  .refine(
    (m) =>
      !(
        (m.capabilities?.includes('hosted-only') ?? false) &&
        (m.capabilities?.includes('offline-required') ?? false)
      ),
    { message: 'hosted-only and offline-required are mutually exclusive', path: ['capabilities'] },
  )
  // maxAdminiumVersion (exclusive) must be strictly above the min.
  .refine(
    (m) =>
      m.compatibility.maxAdminiumVersion === undefined ||
      compareSemver(m.compatibility.maxAdminiumVersion, m.compatibility.minAdminiumVersion) > 0,
    { message: 'maxAdminiumVersion must be greater than minAdminiumVersion', path: ['compatibility'] },
  );

export type Manifest = z.infer<typeof manifestSchema>;

/**
 * Numeric semver compare on the release triple (pre-release/build ignored —
 * enough for the compatibility-window and upgrade ordering checks). Returns
 * <0, 0, >0. Exported for the installer's upgrade rule (§4.3).
 */
export function compareSemver(a: string, b: string): number {
  const triple = (v: string): number[] =>
    v
      .split('+')[0]!
      .split('-')[0]!
      .split('.')
      .map((n) => Number.parseInt(n, 10));
  const [a1 = 0, a2 = 0, a3 = 0] = triple(a);
  const [b1 = 0, b2 = 0, b3 = 0] = triple(b);
  return a1 - b1 || a2 - b2 || a3 - b3;
}
