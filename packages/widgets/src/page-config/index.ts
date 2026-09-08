// SPDX-License-Identifier: AGPL-3.0-only
/**
 * @adminium/widgets/page-config — pure-Zod leaf subpath.
 *
 * Per-template config bodies for stored page documents: query descriptors,
 * the dashboard grid layout schema, and the page-crud column-spec vocabulary.
 * This module imports ONLY zod — it must
 * stay free of engine imports, widget component code, and node: builtins so
 * that `@adminium/engine/config` can consume it without creating a dependency
 * cycle (01-architecture.md §6.1, 07-meta-store.md §3.17). Enforced by the
 * dependency-cruiser gate and by test/leaf-purity.test.ts.
 */
export {
  COMPILABLE_DATA_SHAPES,
  DATA_SHAPES,
  dataShapeSchema,
  isCompilableShape,
  type CompilableDataShape,
  type DataShape,
} from './data-shapes.js';
export {
  aggregationSchema,
  bucketUnitSchema,
  filterSchema,
  queryDescriptorSchema,
  type Aggregation,
  type BucketUnit,
  type QueryDescriptor,
  type QueryFilter,
} from './query-descriptor.js';
export { layoutItemSchema, pageLayoutSchema, type LayoutItem, type PageLayout } from './layout.js';
export {
  crudAttachmentsConfigSchema,
  crudDetailConfigSchema,
  crudDetailTabSchema,
  parseCrudAttachmentsConfig,
  parseCrudDetailConfig,
  type CrudAttachmentsConfig,
  type CrudDetailConfig,
  type CrudDetailTabConfig,
} from './detail-config.js';
export {
  CRUD_LABEL_MAX_LENGTH,
  crudLabelsConfigSchema,
  parseCrudLabels,
  type CrudLabelsConfig,
} from './crud-labels.js';
// A `multiple` file column's stored value (38 D5). The renderer's half of the
// grammar `apps/server/src/files/refs.ts` owns; change the two together.
export { formatRefList, parseRefList } from './file-refs.js';
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
  type GridRow,
  type GridSemantic,
  type GridTone,
} from './grid-column-spec.js';
// Derived columns (36-derived-columns.md WS-A): the stored measure/field
// vocabulary, the exact decimal arithmetic every consumer shares, and the
// evaluator the server and the Studio preview both run.
export {
  DECIMAL_ZERO,
  WORKING_SCALE,
  addDecimal,
  compareDecimal,
  divDecimal,
  formatDecimal,
  mulDecimal,
  parseDecimal,
  roundDecimal,
  subDecimal,
  type Decimal,
} from './decimal.js';
export {
  DECIMAL_LITERAL_PATTERN,
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
  collectFieldColumns,
  crudDerivedConfigSchema,
  derivedFieldSchema,
  emptyPolicyOf,
  fieldCmpSchema,
  fieldExprSchema,
  fieldOpSchema,
  measureBodySchema,
  measureEmptySchema,
  measureFnSchema,
  measureSchema,
  measureTermSchema,
  measureTermSignSchema,
  parseCrudDerived,
  type CrudDerivedConfig,
  type CrudDerivedConfigInput,
  type CrudDerivedNamespace,
  type DerivedField,
  type DerivedRefusal,
  type DerivedRefusalCode,
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
} from './crud-derived.js';
export {
  evaluateDerivedFields,
  type DerivedRowInput,
  type DerivedRowOutput,
  type DerivedValue,
} from './derive-eval.js';
