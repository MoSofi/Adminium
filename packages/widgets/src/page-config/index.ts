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
export { DATA_SHAPES, dataShapeSchema, type DataShape } from './data-shapes.js';
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
  GRID_LOGICAL_TYPES,
  GRID_SEMANTICS,
  gridColumnSpecSchema,
  gridLogicalTypeSchema,
  gridToneSchema,
  type GridColumnSpec,
  type GridColumnSpecInput,
  type GridLogicalType,
  type GridRow,
  type GridSemantic,
  type GridTone,
} from './grid-column-spec.js';
