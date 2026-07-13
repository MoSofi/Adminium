/**
 * @adminium/widgets/page-config — pure-Zod leaf subpath.
 *
 * Per-template config bodies for stored page documents: query descriptors and
 * the dashboard grid layout schema. This module imports ONLY zod — it must
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
