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
  defaultIssue,
  MAX_TEXT_LENGTH,
  MAX_TABLE_NAME,
  prefixFor,
  appReferenceIssues,
  columnRulesSchema,
  stampSetSchema,
  stampTriggerSchema,
  shapeDefinitionSchema,
  shapePartSchema,
  shapeDefinitionIssues,
  capacitySchema,
  navGroupSchema,
  publicAccessSchema,
  publicKeysSchema,
  sampleDataSchema,
  labelsSchema,
  type ColumnRules,
  type PublicAccess,
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
  type RequiredTableShape,
  type ShapeDefinition,
} from './schema.js';
export { roleLimitSchema, roleLimitsSchema, type RoleLimit } from './roles.js';

export {
  validateManifest,
  parseManifest,
  manifestWarnings,
  type ValidateManifestResult,
  type ValidateManifestOptions,
  type ManifestIssue,
} from './validate.js';

export { BOOKING_WEEKDAYS, bookingSchema, type BookingRule } from './booking.js';

export {
  OUTBOX_HELD,
  OUTBOX_SKIP_REASONS,
  OUTBOX_STATUSES,
  emailTemplateSchema,
  outboxProducerSchema,
  outboxSchema,
  type EmailTemplate,
  type Outbox,
  type OutboxProducer,
} from './outbox.js';

export { CUSTOMER_KEY, claimKind, claimSchema, publicKeySchema, type Claim, type PublicKey } from './public-access.js';

export {
  FORMULA_MAX_DEPTH,
  currencyScale,
  evaluateFormula,
  formulaColumns,
  formulaConditionSchema,
  formulaCycle,
  formulaExprSchema,
  formulaOrder,
  holds as formulaHolds,
  ratioText,
  toRatio,
  type FormulaCondition,
  type FormulaExpr,
} from './formula.js';

export {
  moveTarget,
  stateChildSchema,
  stateConditionSchema,
  stateMoveSchema,
  statesSchema,
  type StateChild,
  type StateCondition,
  type StateMove,
  type States,
} from './states.js';

export { addOnsSchema, namedAddOns, requiresAddOn, type AddOnNeeds } from './add-ons.js';

export { appDocumentSchema, slotMappingSchema, type AppDocument, type SlotMapping } from './documents.js';

export {
  shapeConformanceIssues,
  shapeKey,
  type ShapeColumn,
  type ShapeDefinitionView,
  type ShapeIssue,
  type ShapePart,
} from './shapes.js';

export { addOnSettingRefSchema, settingSourceSchema, type SettingSource } from './refs.js';

export { parseSemverRange, satisfiesSemverRange } from './semver.js';

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

export {
  IDENTIFIER_LIMIT,
  ROLE_SLUG_LIMIT,
  type PlanContext,
  type TableChoice,
  type TableClass,
  type TableOffer,
  type PlanEdit,
  type InstallTablePlan,
  type TableAction as ContextTableAction,
} from './plan-context.js';

export {
  SAMPLE_FORMAT,
  ROW_DIRECTIVES,
  byClockSchema,
  isoDurationMs,
  sampleBundleIssues,
  sampleBundleSchema,
  sampleDirective,
  sampleRowSchema,
  sampleValueSchema,
  type ByClock,
  type SampleBundle,
  type SampleIssue,
  type SampleValue,
} from './sample.js';
