// SPDX-License-Identifier: AGPL-3.0-only
/**
 * @adminium/manifest — Micro-SaaS manifest spec v1.
 *
 * The frozen envelope schema + validator (browser-safe, pure Zod), and the
 * install planner (`requiredSchema` → create-or-map diff, `plan.ts`) that both
 * install paths run: add-ons since, apps since. The DDL that applies a plan
 * lives server-side in `apps/server/src/add-ons/install-ddl.ts`; nothing in
 * this package does I/O.
 */
export const PACKAGE_NAME = '@adminium/manifest';

export {
  MANIFEST_VERSION,
  MANIFEST_KINDS,
  MANIFEST_CATEGORIES,
  MANIFEST_CAPABILITIES,
  RESERVED_KEYS,
  COLUMN_TYPES,
  COLUMN_SEMANTICS,
  COLUMN_ROLES,
  FRONTEND_KINDS,
  FIRST_PARTY_PUBLISHER_ID,
  manifestSchema,
  appManifestSchema,
  addOnManifestSchema,
  manifestKindSchema,
  addOnIssues,
  isAddOnManifest,
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
  type AppManifest,
  type AddOnManifest,
  type ManifestKind,
  type AddOnBlock,
  type Capability,
  type Publisher,
  type I18nMessage,
  type RequiredTable,
  type RequiredColumn,
} from './schema.js';

export {
  validateManifest,
  parseManifest,
  type ValidateManifestResult,
  type ValidateManifestOptions,
  type ManifestIssue,
} from './validate.js';

export {
  planInstall,
  type InstallPlan,
  type PlannedTable,
  type PlannedColumn,
  type PlannedReference,
  type PlanProblem,
  type SchemaModelView,
  type ExistingColumnView,
  type TableAction,
} from './plan.js';
