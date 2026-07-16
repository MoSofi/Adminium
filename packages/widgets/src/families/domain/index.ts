/**
 * `domain` family public surface (annex §13) — the two M7 exit-criteria widgets
 * (`org-chart`, `gantt-chart`) plus their registry metadata and pure geometry.
 * Component code is also reachable through each definition's `lazy()` ref, so
 * the registry still emits one chunk per family (04 §2.3); this barrel is for
 * direct template/story composition and tests. Registry metadata lives in
 * `domain-track.definitions.ts`.
 *
 * The remaining §13 ids (`document-canvas` and the 22 `block-*` widgets, the
 * ops/billing/API cards) are a later wave — this barrel grows with them.
 */
export {
  OrgChart,
  OrgChartWidget,
  orgChartConfigSchema,
  orgChartDemoData,
  type OrgChartConfig,
  type OrgChartProps,
} from './OrgChart.js';
export {
  GanttChart,
  GanttChartWidget,
  ganttChartConfigSchema,
  ganttChartDemoData,
  ganttRowsOf,
  type GanttChartConfig,
  type GanttChartProps,
} from './GanttChart.js';
export { GANTT_DEMO_TODAY_MS } from './domain-config.js';
export {
  DAY_MS,
  DOMAIN_DEMO_EPOCH,
  buildOrgTree,
  categoryTone,
  countNodes,
  dayOffset,
  dayToPercent,
  daysToPercent,
  groupSpan,
  layoutOrgTree,
  mulberry32,
  orgRootsOf,
  parseDateMs,
  toGanttModel,
  toneOf,
  weekTicks,
  type GanttFieldMap,
  type GanttModelOptions,
  type OrgConnector,
  type OrgFieldMap,
  type OrgLayout,
  type OrgLayoutNode,
  type OrgLayoutOptions,
} from './domain-lib.js';
export type {
  GanttData,
  GanttGroup,
  GanttModel,
  GanttTask,
  OrgNode,
  OrgNodeMeta,
  OrgTreeData,
} from './domain-types.js';
export {
  domainTrackDefinitions,
  ganttChartDefinition,
  orgChartDefinition,
} from './domain-track.definitions.js';
