/**
 * @adminium/widgets — Widget registry, WidgetFrame/WidgetHost, page templates,
 * dashboard grid (workplan/04-widget-registry.md).
 *
 * NOTE: the pure-Zod page-config leaf (data shapes, query descriptor, layout
 * schema) is NOT re-exported here — import it from
 * `@adminium/widgets/page-config` so `@adminium/engine/config` and the server
 * can consume it without pulling React/component code (01-architecture.md
 * §6.1; enforced by dep-cruiser + test/leaf-purity.test.ts).
 */
export const PACKAGE_NAME = '@adminium/widgets';

// Registry — types + shared config
export {
  WIDGET_FAMILIES,
  defineWidget,
  type WidgetCapabilities,
  type WidgetDefinition,
  type WidgetEvent,
  type WidgetFamily,
  type WidgetPlacement,
  type WidgetProps,
  type WidgetSizing,
  type WidgetSkeleton,
} from './registry/types.js';
export { widgetSharedConfigSchema, type WidgetSharedConfig } from './registry/shared-config.js';

// Registry — map + lookup + config validation
export {
  DuplicateWidgetIdError,
  WidgetNotFoundError,
  assertWidget,
  buildRegistry,
  getWidget,
  logConfigWarnings,
  validateConfigAgainst,
  validateInstanceConfig,
  widgetRegistry,
  widgetsByFamily,
  type ConfigWarning,
  type ParsedConfig,
} from './registry/index.js';
export {
  WIDGET_MISSING_ID,
  widgetMissingConfigSchema,
  widgetMissingDefinition,
} from './registry/widget-missing.js';
export { isEmptyByShape, isEmptyData } from './registry/data-empty.js';

// Page-template registry — the source of truth the LLM allow-lists derive from
export {
  DuplicatePageTemplateIdError,
  PAGE_DASHBOARD_TEMPLATE_ID,
  buildPageTemplateRegistry,
  getPageTemplate,
  pageTemplateDefinitions,
  pageTemplateRegistry,
  type PageTemplateDefinition,
} from './registry/page-templates.js';

// LLM allow-lists (06-llm-assist.md §4.4/§5) — closed vocabularies the
// enrichment prompt injects; derived from the registries above so they cannot
// drift from what the runtime can render.
export {
  LLM_ALLOWED_PAGE_TEMPLATES,
  LLM_ALLOWED_SEMANTICS,
  LLM_ALLOWED_TEMPLATES,
  LLM_ALLOWED_WIDGETS,
  type LlmSemanticTone,
} from './registry/llm-allowlist.js';

// Formatting + payload narrowing shared by widget components
export {
  computeDelta,
  formatMetricValue,
  formatOptionsOf,
  type DeltaInfo,
  type DeltaMode,
  type MetricFormat,
  type MetricFormatOptions,
} from './lib/format.js';
export {
  asCategorical,
  asMetricDelta,
  asSingleMetric,
  asTimeseries,
  timeseriesValues,
  type CategoricalData,
  type CategoricalItemData,
  type MetricDeltaData,
  type SingleMetricData,
  type TimeseriesData,
  type TsPointData,
} from './lib/shapes.js';

// Dashboard grid (M4: static read-only renderer; dnd editing is 04-T12/M7)
export { DashboardGrid, type DashboardGridProps } from './grid/DashboardGrid.js';
export {
  GRID_COLUMNS,
  GRID_GAP_PX,
  ROW_UNIT_PX,
  compactVertical,
  sortByPosition,
} from './grid/layout-math.js';

// Templates — page-dashboard (04 §10, 09 §7.2)
export { PageDashboard, type PageDashboardProps } from './templates/page-dashboard/PageDashboard.js';
export {
  useDashboardData,
  type DashboardDataAdapter,
  type DashboardDataStates,
  type WidgetQueryRequest,
} from './templates/page-dashboard/data-adapter.js';
export { demoDashboardLayout } from './templates/page-dashboard/demo-layout.js';

// Frame — universal widget chrome + states
export {
  WidgetFrame,
  type WidgetFrameEmptyContent,
  type WidgetFrameProps,
  type WidgetFrameState,
} from './frame/WidgetFrame.js';
export { SkeletonSilhouette, type SkeletonSilhouetteProps } from './frame/SkeletonSilhouette.js';
export { WidgetErrorBoundary, type WidgetErrorBoundaryProps } from './frame/WidgetErrorBoundary.js';
export { WidgetHost, type WidgetDataState, type WidgetHostProps } from './frame/WidgetHost.js';
export { ChartDirectionBridge, type ChartDirectionBridgeProps } from './frame/ChartDirectionBridge.js';

// Tables family — standalone components + column-spec vocabulary (M4-T03).
// `tablesWidgetDefinitions` is registry metadata; component exports here are
// for template/host composition (the registry still lazy-loads its own refs).
export * from './families/tables/index.js';

// Page templates — page-crud (09 §7.1): template component + CrudApi contract.
export * from './templates/page-crud/index.js';
