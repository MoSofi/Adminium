/**
 * @adminium/manifest — Micro-SaaS manifest spec v1 (13-marketplace.md §2).
 *
 * Wave 1: the frozen envelope schema + validator (browser-safe, pure Zod).
 * The install planner (requiredSchema → create-or-map diff) and the
 * server-side installer land in later waves and consume a validated manifest.
 */
export const PACKAGE_NAME = '@adminium/manifest';

export {
  MANIFEST_VERSION,
  MANIFEST_CATEGORIES,
  MANIFEST_CAPABILITIES,
  COLUMN_TYPES,
  COLUMN_SEMANTICS,
  COLUMN_ROLES,
  FRONTEND_KINDS,
  FIRST_PARTY_PUBLISHER_ID,
  manifestSchema,
  identitySchema,
  compatibilitySchema,
  requiredSchemaSchema,
  requiredTableSchema,
  requiredColumnSchema,
  pageSchema,
  roleSchema,
  settingSchema,
  seedSchema,
  frontendSchema,
  capabilitySchema,
  categorySchema,
  publisherSchema,
  i18nMessageSchema,
  compareSemver,
  type Manifest,
  type Capability,
  type Publisher,
  type I18nMessage,
} from './schema.js';

export {
  validateManifest,
  parseManifest,
  type ValidateManifestResult,
  type ValidateManifestOptions,
  type ManifestIssue,
} from './validate.js';
