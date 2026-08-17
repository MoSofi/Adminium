// SPDX-License-Identifier: AGPL-3.0-only
/**
 * @adminium/widgets — Widget registry, WidgetFrame/WidgetHost, page templates,
 * dashboard grid (04-widget-registry.md).
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

// Offline asset policy (11-electron.md §7): `map-*` → `map-choropleth-grid` when
// the host app reports a desktop/offline runtime. WidgetHost applies it on every
// mount; the host app supplies the env through `WidgetRuntimeProvider`.
export {
  DEFAULT_WIDGET_RUNTIME_ENV,
  MAP_WIDGET_PREFIX,
  OFFLINE_MAP_FALLBACK_ID,
  offlineAssetsRequired,
  resolveOfflineWidgetId,
  type WidgetRuntime,
  type WidgetRuntimeEnv,
} from './registry/offline.js';
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
  LLM_WIDGET_DATA_CONTRACTS,
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

// Dashboard grid (04 §6): static renderer + geometry (M4), edit mode 04-T12
export { DashboardGrid, type DashboardGridProps, type RenderItemContext } from './grid/DashboardGrid.js';
export {
  GRID_COLUMNS,
  GRID_GAP_PX,
  ROW_UNIT_PX,
  compactVertical,
  sortByPosition,
} from './grid/layout-math.js';
export {
  DEFAULT_MIN_SIZE,
  MAX_H,
  type MinSize,
} from './grid/layout-schema.js';
export {
  applyMove,
  applyResize,
  clampItem,
  commitDraft,
  findFirstFit,
  moveAndCompact,
  pointerDeltaToCells,
  resizeAndCompact,
  snapPxToCells,
  type CellStep,
  type LayoutDraft,
} from './grid/layout-edit.js';
export {
  GridDragHandle,
  GridResizeHandle,
  defaultGridAnnouncements,
  defaultGridEditLabels,
  snapToGridModifier,
  useGridItemEdit,
  type GridAnnouncements,
  type GridEditLabels,
  type GridEditLabelsInput,
  type GridItemEditControls,
} from './grid/grid-edit.js';

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
export {
  WidgetRuntimeProvider,
  useWidgetRuntimeEnv,
  useResolvedWidgetId,
  type WidgetRuntimeProviderProps,
} from './frame/WidgetRuntimeContext.js';
export { ChartDirectionBridge, type ChartDirectionBridgeProps } from './frame/ChartDirectionBridge.js';

// Tables family — standalone components + column-spec vocabulary (M4-T03).
// `tablesWidgetDefinitions` is registry metadata; component exports here are
// for template/host composition (the registry still lazy-loads its own refs).
export * from './families/tables/index.js';

// Domain family — the annex §13 props-only VIEWS the Studio/platform surfaces
// compose. Exported by NAME (not `export *`) because this is a deliberate
// cross-package contract, not the family's whole surface — same rule as the
// forms family below. `ApiKeysPanelView` backs the M10-T06 API Keys page and
// `CodeSnippetBlockView` its quick-start snippet: the *-Widget halves stay
// registry-only (they bind to generated-app tables; the platform page drives
// the view from `/api/v1/api-keys` instead).
export { ApiKeysPanelView, type ApiKeysPanelViewProps } from './families/domain/ApiKeysPanel.js';
export { CodeSnippetBlockView, type CodeSnippetBlockViewProps } from './families/domain/OpsApi.js';
export type { ApiKeyRecord } from './families/domain/domain-ops-types.js';

// Page templates — page-crud (09 §7.1): template component + CrudApi contract.
export * from './templates/page-crud/index.js';

// Page templates — planning archetypes (09 §7.5/§7.6): board, calendar, scheduler.
export * from './templates/page-board/index.js';
export * from './templates/page-calendar/index.js';
export * from './templates/page-scheduler/index.js';

// Page templates — the M7 people/queues archetypes (09 §7.3/§7.4/§7.7).
export * from './templates/page-directory/index.js';
export * from './templates/page-master-detail/index.js';
export * from './templates/page-queue-inbox/index.js';

// Page templates — page-log-viewer / page-files / page-chat (09 §7.8/§7.9).
export * from './templates/page-log-viewer/index.js';
export * from './templates/page-files/index.js';
export * from './templates/page-chat/index.js';

// Page templates — page-builder (09 §7.11): renderer + doc algebra. `isBlockId`
// rides along for the email-templates editor's block ⇄ doc mapping (the block
// vocabulary is already public via BLOCK_IDS on this template's index).
export * from './templates/page-builder/index.js';
export { isBlockId } from './families/domain/block-lib.js';

// Page templates — page-wizard (M7-T07, 09 §11.1): the stepped-flow shell the
// Import Wizard binding mounts, plus the family widgets its steps and the
// Data Exports page compose. Named exports, same cross-package-contract rule
// as the forms block below.
export * from './templates/page-wizard/index.js';

// Page templates — page-settings (M7 T6, comp: Notification Settings): the
// event × channel preference matrix with per-cell autosave.
export * from './templates/page-settings/index.js';
export {
  ColumnMappingTableWidget,
  ValidationIssuesListWidget,
  mappingRowsOf,
  issuesOf,
  type ColumnMappingTableConfig,
  type MappingRow,
  type ValidationIssue,
  type ValidationIssuesListConfig,
} from './families/forms/index.js';
export {
  columnMappingTableConfigSchema,
  validationIssuesListConfigSchema,
} from './families/forms/forms-config.js';
export { SKIP_TARGET } from './families/forms/forms-builders.js';
export { UploadDropzone, type UploadDropzoneProps } from './families/media/UploadDropzone.js';
export { ScheduledJobsList, type ScheduledJobsListProps } from './families/calendar/ScheduledJobsList.js';
export type { ScheduledJob } from './families/calendar/calendar-types.js';

// Forms family — the two §10 widgets the Studio connect wizard COMPOSES, plus
// the pure rules behind them. Exported by NAME (not `export *`) because this is
// a deliberate cross-package contract, not the family's whole surface: the
// wizard used to carry its own copy of the DSN field and the table checklist,
// and `@adminium/widgets` may never import `apps/*`, so the shared half lives
// here and the wizard consumes it. See `families/forms/forms-dsn.ts` and
// `families/forms/forms-tables.ts` for why the duplication had to end.
export {
  ConnectionStringField,
  TableInclusionChecklist,
  type ConnectionStringFieldProps,
  type TableInclusionChecklistProps,
} from './families/forms/index.js';
export {
  DSN_ENGINES,
  DSN_PROVIDER_CHIPS,
  dsnHost,
  dsnPlaceholder,
  dsnValidationCode,
  dsnWithEngine,
  engineForDsn,
  providerChipsFor,
  type DsnEngine,
  type DsnProviderChip,
  type DsnValidationCode,
} from './families/forms/forms-dsn.js';
export {
  HIGH_VOLUME_ROWS,
  defaultIncludedIds,
  inclusionCounts,
  isHighVolume,
  type InclusionTable,
} from './families/forms/forms-tables.js';
