/**
 * Checked-in extraction of the widget-registry ANNEX catalog
 * (`workplan/research/widget-registry.md` §1–§13) — the source of truth the
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
 * SCOPE (M7 Wave 3): this used to be `WAVE1_PENDING`, scoped to the four Wave-1
 * families (kpi/charts/tables/feeds) while Wave 2/3 families were merely
 * "known-pending, not failing". Waves 2 and 3 have now landed — calendar,
 * boards, media, communication, domain, system, chrome, forms all deliver into
 * the registry — so the gate covers all 13 families uniformly and every newly
 * delivered id is asserted. `geo` is the only family with nothing built; its
 * whole annex slice is pending, which keeps the same equation true for it.
 *
 * Delivered slice as of M7 Wave 3: kpi 2/10, charts 37/37, tables 11/17,
 * feeds 5/7, calendar 4/8, boards 2/4, geo 0/2, media 6/6, communication 3/5,
 * forms 12/20, chrome 8/8, system 9/9, domain 2/43 → 101 widgets.
 */
export const ANNEX_PENDING: Record<WidgetFamily, readonly string[]> = {
  // Remaining §1 KPI slice (built after the M4 kpi-stat-card / usage-meter slice).
  kpi: [
    'kpi-stat-tile-compact', 'metric-hero', 'stat-pair-card', 'gauge-ring', 'gauge-arc',
    'period-comparison', 'micro-kpi-subtitle', 'auto-insights',
  ],
  // Time/flow charts (04-T09) — multiline, stream, forecast, anomaly,
  // candlestick, bump, timeline-lanes — landed and wired into the registry, so
  // the charts family is fully delivered.
  charts: [],
  // Remaining §3 list widgets.
  tables: [
    'sparkline-table', 'top-movers-list', 'ranked-entity-list', 'accordion-list',
    'comparison-matrix', 'chip-cloud',
  ],
  // Remaining §4 feed widgets (load-older-paginator; toast-stack is the overlay
  // toast host, cross-listed as undo-toast in §12).
  feeds: ['load-older-paginator', 'toast-stack'],
  // Remaining §5 calendar slice (Track CAL delivered month/agenda/matrix/capacity).
  calendar: [
    'calendar-legend-filter', 'upcoming-events-list', 'date-range-picker', 'scheduled-jobs-list',
  ],
  // Remaining §6 board slice — `board-card` ships as a sub-component of
  // kanban-board (not separately registered) and inline-compose is a later wave.
  boards: ['board-card', 'inline-compose-card'],
  // §7 — the geo family is not built yet.
  geo: ['map-bubble', 'map-choropleth-grid'],
  // §8 fully delivered by Track MEDIA (the file-browser exit criterion).
  media: [],
  // Remaining §9 — typing-indicator and call-widget are a later wave.
  communication: ['typing-indicator', 'call-widget'],
  // Remaining §10 forms slice — the builder/importer-facing widgets.
  forms: [
    'rule-builder', 'flow-builder', 'connection-string-field', 'table-inclusion-checklist',
    'column-mapping-table', 'export-builder', 'question-builder', 'inline-editable-field',
  ],
  // §11 fully delivered by Track FCS.
  chrome: [],
  // §12 fully delivered by Track FCS.
  system: [],
  // Remaining §13 — Track DOMAIN delivered the two M7 exit-criteria widgets
  // (org-chart, gantt-chart); the document-canvas block vocabulary and the
  // ops/billing/API cards are a later wave.
  domain: [
    'document-canvas', 'block-totals-summary', 'block-line-items', 'block-kpi-row',
    'block-bar-chart', 'block-line-chart', 'block-two-col-table', 'block-tax-breakdown',
    'block-multi-currency', 'block-payment-history', 'block-discount-codes',
    'block-loyalty-banner', 'block-recurring-banner', 'block-qr-pay', 'block-delivery-stepper',
    'block-signature', 'block-terms-checkbox', 'block-approval', 'block-attachments',
    'block-late-fees', 'block-image-placeholder', 'block-contact', 'block-highlight-box',
    'starter-template-picker', 'slo-monitor-card', 'uptime-segment-bar',
    'experiment-variant-compare', 'credit-card-tile', 'plan-pricing-cards', 'api-keys-panel',
    'api-playground', 'code-snippet-block', 'webhook-endpoints-list', 'resource-api-card',
    'live-timer', 'sync-status-card', 'ip-allowlist-card', 'onboarding-checklist',
    'testimonial-card', 'trust-badges', 'policy-list',
  ],
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
