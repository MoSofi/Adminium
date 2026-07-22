/**
 * Checked-in extraction of the widget-registry ANNEX catalog
 * (the internal widget-registry annex, §1–§13) — the source of truth the
 * registry-parity gate (04-widget-registry.md acceptance #1, 04-T17) diffs the
 * live registry against. 176 ids across the 13 families; ids are transcribed
 * verbatim from the annex `### \`id\`` headings (and the §13 document-block
 * bullet list), in annex order.
 *
 * This list is intentionally hand-checked-in (not derived at runtime from the
 * markdown) so that a *drift* between what the annex documents and what the
 * code registers surfaces as a failing test rather than silently tracking the
 * code. Update this file only when the annex itself changes.
 */
import type { WidgetFamily } from '../registry/types.js';

/** Every annex id, grouped by family, in annex document order. */
export const ANNEX_CATALOG: Record<WidgetFamily, readonly string[]> = {
  kpi: [
    'kpi-stat-card', 'kpi-stat-tile-compact', 'metric-hero', 'stat-pair-card', 'usage-meter',
    'gauge-ring', 'gauge-arc', 'period-comparison', 'micro-kpi-subtitle', 'auto-insights',
  ],
  charts: [
    'chart-line-area', 'chart-bar', 'chart-donut', 'chart-sparkline', 'chart-stacked-bar-100',
    'chart-funnel', 'chart-waterfall', 'chart-sankey', 'chart-radar', 'chart-bullet',
    'chart-treemap', 'chart-boxplot', 'chart-violin', 'chart-ridgeline', 'chart-hexbin',
    'chart-scatter-bubble', 'chart-candlestick', 'chart-wordcloud', 'chart-bump',
    'chart-parallel-coordinates', 'chart-stream', 'chart-chord', 'chart-slope',
    'chart-marimekko', 'chart-pareto', 'chart-radial-bar', 'chart-sunburst',
    'chart-heatmap-calendar', 'chart-heat-month', 'chart-cohort-matrix',
    'chart-correlation-matrix', 'chart-choropleth-grid', 'chart-forecast', 'chart-anomaly',
    'chart-multiline', 'chart-ranking-bars', 'chart-timeline-lanes',
  ],
  tables: [
    'data-grid', 'pagination-footer', 'bulk-action-toolbar', 'detail-key-value', 'mini-table',
    'grouped-summary-table', 'log-table', 'sparkline-table', 'top-movers-list', 'card-gallery',
    'master-list', 'ranked-entity-list', 'accordion-list', 'schema-tree', 'comparison-matrix',
    'toggle-matrix', 'chip-cloud',
  ],
  feeds: [
    'activity-feed', 'notification-feed', 'realtime-feed', 'timeline-vertical',
    'load-older-paginator', 'toast-stack', 'unread-badge',
  ],
  calendar: [
    'calendar-month', 'day-agenda', 'calendar-legend-filter', 'upcoming-events-list',
    'date-range-picker', 'schedule-matrix', 'capacity-board', 'scheduled-jobs-list',
  ],
  boards: ['kanban-board', 'kanban-swimlane-grid', 'board-card', 'inline-compose-card'],
  geo: ['map-bubble', 'map-choropleth-grid'],
  media: [
    'file-browser', 'upload-dropzone', 'upload-progress-list', 'attachment-list', 'image-board',
    'link-list',
  ],
  communication: ['conversation-inbox', 'chat-thread', 'typing-indicator', 'ai-chat-panel', 'call-widget'],
  forms: [
    'modal-wizard', 'drawer-form', 'stepper', 'progress-bar', 'otp-input', 'chip-input',
    'segmented-control', 'filter-chip-bar', 'toggle-switch-list', 'option-cards', 'rule-builder',
    'flow-builder', 'connection-string-field', 'table-inclusion-checklist',
    'column-mapping-table', 'validation-issues-list', 'export-builder', 'question-builder',
    'inline-editable-field', 'password-strength-meter',
  ],
  chrome: [
    'sidebar-nav', 'command-palette', 'global-search', 'breadcrumb', 'tab-bar', 'nav-card',
    'shortcuts-panel', 'avatar-stack',
  ],
  system: [
    'state-hero', 'empty-state', 'status-pill', 'alert-banner', 'status-banner-hero',
    'connection-status', 'autosave-indicator', 'progress-log-console', 'diagnostics-readout',
  ],
  domain: [
    'gantt-chart', 'org-chart', 'document-canvas', 'block-totals-summary', 'block-line-items',
    'block-kpi-row', 'block-bar-chart', 'block-line-chart', 'block-two-col-table',
    'block-tax-breakdown', 'block-multi-currency', 'block-payment-history',
    'block-discount-codes', 'block-loyalty-banner', 'block-recurring-banner', 'block-qr-pay',
    'block-delivery-stepper', 'block-signature', 'block-terms-checkbox', 'block-approval',
    'block-attachments', 'block-late-fees', 'block-image-placeholder', 'block-contact',
    'block-highlight-box', 'starter-template-picker', 'slo-monitor-card', 'uptime-segment-bar',
    'experiment-variant-compare', 'credit-card-tile', 'plan-pricing-cards', 'api-keys-panel',
    'api-playground', 'code-snippet-block', 'webhook-endpoints-list', 'resource-api-card',
    'live-timer', 'sync-status-card', 'ip-allowlist-card', 'onboarding-checklist',
    'testimonial-card', 'trust-badges', 'policy-list',
  ],
};

/** Flat set of every annex id (for O(1) drift lookups). */
export const ALL_ANNEX_IDS: ReadonlySet<string> = new Set(
  Object.values(ANNEX_CATALOG).flat(),
);

/**
 * Annex ids that are documented but **not yet delivered** in this tree, per
 * family. The parity gate asserts `annex(family) \ delivered(family)` equals
 * exactly this set for EVERY family — so:
 *   - a *new* undelivered id (a regressed / dropped widget) fails the gate, and
 *   - delivering a pending id without removing it here also fails the gate,
 * forcing each list to shrink to empty as its family completes.
 *
 * SCOPE (M7 Wave 4): this used to be `WAVE1_PENDING`, scoped to the four Wave-1
 * families (kpi/charts/tables/feeds) while Wave 2/3 families were merely
 * "known-pending, not failing". Every family now delivers into the registry, so
 * the gate covers all 13 uniformly and every newly delivered id is asserted.
 * Wave 4 opened the last family (`geo`), so no family is wholly pending any
 * more — each remaining list is a tail, and the equation shrinks to `[]` per
 * family as the tail lands.
 */
export const ANNEX_PENDING: Record<WidgetFamily, readonly string[]> = {
  // §1 fully delivered: the M4 kpi-stat-card / usage-meter slice plus the M7
  // Wave-4 tail (TRACK KPI-FEEDS) — compact tile, metric hero, stat pair, the
  // two SVG gauges, period comparison, micro-kpi subtitle, auto-insights.
  kpi: [],
  // Time/flow charts (04-T09) — multiline, stream, forecast, anomaly,
  // candlestick, bump, timeline-lanes — landed and wired into the registry, so
  // the charts family is fully delivered.
  charts: [],
  // §3 fully delivered — the M4 slice + Track F + the M7 Wave-4 TAIL
  // (sparkline-table, top-movers-list, ranked-entity-list, accordion-list,
  // comparison-matrix, chip-cloud).
  tables: [],
  // §4 fully delivered: the Track-F slice plus the M7 Wave-4 tail (TRACK
  // KPI-FEEDS) — load-older-paginator and toast-stack, the overlay toast host
  // (cross-listed as undo-toast in §12), which wraps @adminium/ui's
  // ToastStack + useToastQueue rather than reimplementing the queue.
  feeds: [],
  // §5 fully delivered: the Track-CAL month/agenda/matrix/capacity slice plus
  // the M7 Wave-4 TAIL — legend filter, upcoming feed, the range-picker control,
  // and the scheduled-jobs list. The legend/upcoming slots page-calendar.json
  // holds open (`fallback: 'omit'`) now fill, as does its date-range-picker
  // toolbar chrome (and page-scheduler.json's / page-log-viewer.json's).
  calendar: [],
  // §6 fully delivered by the M7 Wave-4 TAIL — `board-card` is now registered
  // under its own annex id (the same component the kanban columns render, no
  // longer only their private sub-component), and `inline-compose-card` fills
  // page-board.json's `compose` slot.
  boards: [],
  // §7 fully delivered by the M7 Wave-4 tail (TRACK COMM-GEO) — the Leaflet
  // bubble map, and the region-coded tilegram the annex cross-lists with
  // `chart-choropleth-grid` (one visual, two entry points; the geo id is what
  // the §7 rule emits when a table has region codes but no coordinates).
  geo: [],
  // §8 fully delivered by Track MEDIA (the file-browser exit criterion).
  media: [],
  // §9 fully delivered: the Track-COMM inbox/thread/AI-panel slice plus the M7
  // Wave-4 tail (TRACK COMM-GEO) — typing-indicator (also the thread's own
  // embedded typing row) and the niche call-widget.
  communication: [],
  // §10 fully delivered: the Track-FCS wizard/input slice plus the M7 Wave-4
  // TAIL (TRACK FORMS) — the rule/flow/question builder canvases, the export
  // builder, the import wizard's column mapper, the document-canvas inline
  // field, and the two widgets LIFTED out of the Studio connect wizard
  // (connection-string-field, table-inclusion-checklist), which now render the
  // widgets-side component instead of a divergent copy of it.
  forms: [],
  // §11 fully delivered by Track FCS.
  chrome: [],
  // §12 fully delivered by Track FCS.
  system: [],
  // §13 fully delivered — and with it the ANNEX ITSELF, 176/176. Three tracks
  // built this family: Track DOMAIN's two M7 exit-criteria widgets (org-chart,
  // gantt-chart); TRACK BUILDER's DOCUMENT half (`document-canvas` plus its
  // 22-block shared library, block-totals-summary … block-highlight-box); and
  // TRACK OPS's ops/billing/API/marketing tail — the eighteen cards
  // (starter-template-picker … policy-list) that were the last list standing in
  // this record and are now registered through `domain-ops-track.definitions.ts`.
  //
  // EVERY LIST HERE IS NOW EMPTY. That is the terminal state this record was
  // built to reach, not an accident: the parity gate is two-sided, so an empty
  // ANNEX_PENDING means `EXPECTED_IDS` is exactly `ANNEX_CATALOG`, and
  // registry-parity.test.ts now asserts the live registry equals the whole annex
  // in both directions. Adding an id back here would mean UN-shipping a widget.
  domain: [],
};

function expectedFor(family: WidgetFamily): readonly string[] {
  const pending = new Set(ANNEX_PENDING[family]);
  return ANNEX_CATALOG[family].filter((id) => !pending.has(id));
}

/**
 * Expected registered ids per family = annex minus known-pending. This is the
 * checked-in list the parity snapshot diffs the delivered registry against.
 */
export const EXPECTED_IDS: Record<WidgetFamily, readonly string[]> = Object.fromEntries(
  (Object.keys(ANNEX_CATALOG) as WidgetFamily[]).map((family) => [family, expectedFor(family)]),
) as Record<WidgetFamily, readonly string[]>;
