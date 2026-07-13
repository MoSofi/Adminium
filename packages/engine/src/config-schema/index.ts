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
  widgetConfigSchema,
  type ConfigKind,
  type NavConfig,
  type PageConfig,
  type PageEnvelope,
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
// Assembled surface: the per-template leaf schemas (04-widget-registry.md §5.1, §6.1).
export {
  DATA_SHAPES,
  aggregationSchema,
  bucketUnitSchema,
  dataShapeSchema,
  filterSchema,
  layoutItemSchema,
  pageLayoutSchema,
  queryDescriptorSchema,
  type Aggregation,
  type BucketUnit,
  type DataShape,
  type LayoutItem,
  type PageLayout,
  type QueryDescriptor,
  type QueryFilter,
} from '@adminium/widgets/page-config';
