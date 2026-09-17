// SPDX-License-Identifier: AGPL-3.0-only
/**
 * @adminium/engine/config — browser-safe subpath.
 *
 * The single validation authority for stored config documents: the envelope
 * schema, nav/widget schemas, and the config-migration runner. Also
 * re-exports the `@adminium/widgets/page-config` pure-Zod leaf so consumers
 * (dashboard, manifest, server routes) have one import surface. No node:
 * imports anywhere in this directory — enforced by
 * test/browser-safe.test.ts and the dependency-cruiser gate.
 */
export {
  CONFIG_KINDS,
  configIdPattern,
  configKindSchema,
  navConfigSchema,
  pageEnvelopeSchema,
  pagePaddingSchema,
  pageWidthSchema,
  widgetConfigSchema,
  type ConfigKind,
  type NavConfig,
  type PageConfig,
  type PageEnvelope,
  type PagePaddingConfig,
  type PageWidthConfig,
  type WidgetConfig,
} from './envelope.js';
export {
  CONFIG_VERSION,
  ConfigMigrationError,
  configMigrations,
  latestConfigVersion,
  runConfigMigrations,
  type ConfigDocument,
  type ConfigMigration,
} from './migrations.js';
export { TABLE_BOUND_TEMPLATES, isTableBoundTemplate } from './table-bound.js';
// Assembled surface: the per-template leaf schemas.
export {
  COMPILABLE_DATA_SHAPES,
  DATA_SHAPES,
  aggregationSchema,
  bucketUnitSchema,
  dataShapeSchema,
  filterSchema,
  isCompilableShape,
  layoutItemSchema,
  pageLayoutSchema,
  queryDescriptorSchema,
  type Aggregation,
  type BucketUnit,
  type CompilableDataShape,
  type DataShape,
  type LayoutItem,
  type PageLayout,
  type QueryDescriptor,
  type QueryFilter,
} from '@adminium/widgets/page-config';
// `page-crud`'s config body is a `columns[]` of these. Re-exported here so
// the two consumers that must validate one — the server's page-config PATCH
// and the dashboard's column editor — share the single definition rather than
// restating it; neither may import `@adminium/widgets` directly
// (dependency-cruiser `server-no-ui-widgets-charts`,
// `dashboard-no-full-engine`).
export {
  COLUMN_DISPLAY_KINDS,
  GRID_LOGICAL_TYPES,
  GRID_SEMANTICS,
  columnDisplaySchema,
  gridColumnSpecSchema,
  gridLogicalTypeSchema,
  gridToneSchema,
  type ColumnDisplay,
  type ColumnDisplayKind,
  type GridColumnSpec,
  type GridColumnSpecInput,
  type GridLogicalType,
  type GridTone,
} from '@adminium/widgets/page-config';
// `page-crud`'s stored `config.detail` block: the record-page contract every
// generated body already carries. Same sharing rationale as the column spec
// above — one schema on both sides of the boundary, absence tolerated.
export {
  crudAttachmentsConfigSchema,
  crudDetailConfigSchema,
  crudDetailTabSchema,
  parseCrudAttachmentsConfig,
  parseCrudDetailConfig,
  type CrudAttachmentsConfig,
  type CrudDetailConfig,
  type CrudDetailTabConfig,
} from '@adminium/widgets/page-config';
// NOT re-exported here: `formatRefList` / `parseRefList`.
//
// Every block above is read by something on the FIRST PAINT, so this module is
// in the dashboard's entry chunk — and Rollup does not drop a re-export's
// module just because nothing in the entry references it (the 2026-09-01
// chunk-budget record says so in as many words). Adding the pair here put
// `page-config/file-refs.js` in every user's cold boot for the sake of one
// LAZY binding, and the entry ratchet caught it at 13 bytes over.
//
// The one consumer imports `@adminium/widgets/page-config` directly instead.
// `page-crud`'s stored `config.labels` block — the per-page chrome overrides
// the Studio page editor writes ("Add invoice" in place of "New row"). Same
// sharing rationale again: the dashboard's crud binding parses one, absence is
// the norm rather than a gap.
export {
  CRUD_LABEL_MAX_LENGTH,
  crudLabelsConfigSchema,
  parseCrudLabels,
  type CrudLabelsConfig,
} from '@adminium/widgets/page-config';
// `page-crud`'s stored `config.derived` block, the exact decimal arithmetic it
// is defined over, and the evaluator that reads it. This re-export is the ONLY
// legal path by which the server sees this vocabulary: dependency-cruiser's
// `server-no-ui-widgets-charts` forbids `apps/server` importing
// `@adminium/widgets`, and the money law must have one implementation shared
// by the read path, the export jobs and the Studio live preview rather than
// three that drift.
export {
  DECIMAL_LITERAL_PATTERN,
  DECIMAL_ZERO,
  DERIVED_ALIAS_PATTERN,
  DERIVED_REFUSAL_CODES,
  FIELD_CMPS,
  FIELD_OPS,
  MAX_DERIVED_FIELDS,
  MAX_FIELD_CASES,
  MAX_FIELD_DEPTH,
  MAX_FIELD_NODES,
  MAX_FIELD_SCALE,
  MAX_MEASURES,
  MAX_MEASURE_TERMS,
  MAX_TERM_FACTORS,
  MAX_TEXT_OUTCOME_LENGTH,
  MEASURE_FNS,
  RESERVED_ROW_KEYS,
  WORKING_SCALE,
  addDecimal,
  collectFieldColumns,
  compareDecimal,
  crudDerivedConfigSchema,
  derivedFieldSchema,
  divDecimal,
  emptyPolicyOf,
  evaluateDerivedFields,
  fieldCmpSchema,
  fieldExprSchema,
  fieldOpSchema,
  formatDecimal,
  measureBodySchema,
  measureEmptySchema,
  measureFnSchema,
  measureSchema,
  measureTermSchema,
  measureTermSignSchema,
  mulDecimal,
  parseCrudDerived,
  parseDecimal,
  roundDecimal,
  subDecimal,
  type CrudDerivedConfig,
  type CrudDerivedConfigInput,
  type CrudDerivedNamespace,
  type Decimal,
  type DerivedField,
  type DerivedRefusal,
  type DerivedRefusalCode,
  type DerivedRowInput,
  type DerivedRowOutput,
  type DerivedValue,
  type FieldCase,
  type FieldCmp,
  type FieldExpr,
  type FieldOp,
  type Measure,
  type MeasureBody,
  type MeasureEmpty,
  type MeasureFn,
  type MeasureTerm,
  type MeasureTermSign,
  type ParsedCrudDerived,
} from '@adminium/widgets/page-config';
