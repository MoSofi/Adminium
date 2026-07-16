/**
 * The live `widgetRegistry`'s id set, as a **pure, checked-in list**.
 *
 * WHY THIS EXISTS: `./index.ts` builds `widgetRegistry` from the per-family
 * `definitions.ts` modules — component code. The generator leaf
 * (`../generate/index.ts`) and everything downstream of it (the Engine, and
 * through it the server) may not import that (01-architecture.md §2.3; the
 * `engine-no-full-widgets` / `server-no-ui-widgets-charts` dependency-cruiser
 * rules). Yet 04 §8 H1/H4 require generation to know which ids are registered:
 * an unregistered id reaching a stored page renders `widget-missing`, and
 * `composeTemplate`'s whole PENDING-id discipline is only sound when the
 * membership test is actually supplied.
 *
 * So the id set is inverted into data: this list is the leaf-safe mirror the
 * generator defaults to, and `registered-ids.test.ts` fails the moment it drifts
 * from `[...widgetRegistry.keys()]` in either direction. Same "checked-in
 * expectation, gated by a parity test" discipline as
 * `../templates/crosscheck.ts`'s `PENDING_TEMPLATE_WIDGET_IDS` and
 * `../qa/delivered.ts` — register a widget, add it here, and the gate tells you
 * if you forget.
 *
 * Sorted; ids are globally unique (04 §2.1).
 */
export const REGISTERED_WIDGET_IDS: readonly string[] = [
  'activity-feed',
  'ai-chat-panel',
  'alert-banner',
  'attachment-list',
  'autosave-indicator',
  'avatar-stack',
  'breadcrumb',
  'bulk-action-toolbar',
  'calendar-month',
  'capacity-board',
  'card-gallery',
  'chart-anomaly',
  'chart-bar',
  'chart-boxplot',
  'chart-bullet',
  'chart-bump',
  'chart-candlestick',
  'chart-chord',
  'chart-choropleth-grid',
  'chart-cohort-matrix',
  'chart-correlation-matrix',
  'chart-donut',
  'chart-forecast',
  'chart-funnel',
  'chart-heat-month',
  'chart-heatmap-calendar',
  'chart-hexbin',
  'chart-line-area',
  'chart-marimekko',
  'chart-multiline',
  'chart-parallel-coordinates',
  'chart-pareto',
  'chart-radar',
  'chart-radial-bar',
  'chart-ranking-bars',
  'chart-ridgeline',
  'chart-sankey',
  'chart-scatter-bubble',
  'chart-slope',
  'chart-sparkline',
  'chart-stacked-bar-100',
  'chart-stream',
  'chart-sunburst',
  'chart-timeline-lanes',
  'chart-treemap',
  'chart-violin',
  'chart-waterfall',
  'chart-wordcloud',
  'chat-thread',
  'chip-input',
  'command-palette',
  'connection-status',
  'conversation-inbox',
  'data-grid',
  'day-agenda',
  'detail-key-value',
  'diagnostics-readout',
  'drawer-form',
  'empty-state',
  'file-browser',
  'filter-chip-bar',
  'gantt-chart',
  'global-search',
  'grouped-summary-table',
  'image-board',
  'kanban-board',
  'kanban-swimlane-grid',
  'kpi-stat-card',
  'link-list',
  'log-table',
  'master-list',
  'mini-table',
  'modal-wizard',
  'nav-card',
  'notification-feed',
  'option-cards',
  'org-chart',
  'otp-input',
  'pagination-footer',
  'password-strength-meter',
  'progress-bar',
  'progress-log-console',
  'realtime-feed',
  'schedule-matrix',
  'schema-tree',
  'segmented-control',
  'shortcuts-panel',
  'sidebar-nav',
  'state-hero',
  'status-banner-hero',
  'status-pill',
  'stepper',
  'tab-bar',
  'timeline-vertical',
  'toggle-matrix',
  'toggle-switch-list',
  'unread-badge',
  'upload-dropzone',
  'upload-progress-list',
  'usage-meter',
  'validation-issues-list',
  'widget-missing',
];

const REGISTERED = new Set(REGISTERED_WIDGET_IDS);

/** Registry-membership test — the default `ctx.isRegistered` for generation. */
export function isRegisteredWidgetId(widgetId: string): boolean {
  return REGISTERED.has(widgetId);
}
