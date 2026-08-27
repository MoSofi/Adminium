// SPDX-License-Identifier: AGPL-3.0-only
/**
 * @adminium/engine/config — browser-safe subpath.
 *
 * The single validation authority for stored config documents: the envelope
 * schema, nav/widget schemas, and the config-migration runner. Also
 * re-exports the `@adminium/widgets/page-config` pure-Zod leaf so consumers
 * (dashboard, manifest, server routes) have one import surface
 * (07-meta-store.md §3.17). No node: imports anywhere in this directory —
 * enforced by test/browser-safe.test.ts and the dependency-cruiser gate.
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
// Assembled surface: the per-template leaf schemas (04-widget-registry.md §5.1, §6.1).
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
// `page-crud`'s config body is a `columns[]` of these (04 §6.1). Re-exported
// here so the two consumers that must validate one — the server's page-config
// PATCH and the dashboard's column editor — share the single definition
// rather than restating it; neither may import `@adminium/widgets` directly
// (dependency-cruiser `server-no-ui-widgets-charts`, `dashboard-no-full-engine`).
export {
  GRID_LOGICAL_TYPES,
  GRID_SEMANTICS,
  gridColumnSpecSchema,
  gridLogicalTypeSchema,
  gridToneSchema,
  type GridColumnSpec,
  type GridColumnSpecInput,
  type GridLogicalType,
  type GridTone,
} from '@adminium/widgets/page-config';
// `page-crud`'s stored `config.detail` block (30-record-pages.md D1/D3): the
// record-page contract every generated body already carries. Same sharing
// rationale as the column spec above — one schema on both sides of the
// boundary, absence tolerated.
export {
  crudDetailConfigSchema,
  crudDetailTabSchema,
  parseCrudDetailConfig,
  type CrudDetailConfig,
  type CrudDetailTabConfig,
} from '@adminium/widgets/page-config';
