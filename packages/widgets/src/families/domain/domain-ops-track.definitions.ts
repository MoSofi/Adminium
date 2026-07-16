import { lazy } from 'react';

import {
  apiKeysPanelConfigSchema,
  apiKeysPanelDemoData,
  apiPlaygroundConfigSchema,
  apiPlaygroundDemoData,
  codeSnippetBlockConfigSchema,
  codeSnippetBlockDemoData,
  creditCardTileConfigSchema,
  creditCardTileDemoData,
  experimentVariantCompareConfigSchema,
  experimentVariantCompareDemoData,
  ipAllowlistCardConfigSchema,
  ipAllowlistCardDemoData,
  liveTimerConfigSchema,
  liveTimerDemoData,
  onboardingChecklistConfigSchema,
  onboardingChecklistDemoData,
  planPricingCardsConfigSchema,
  planPricingCardsDemoData,
  policyListConfigSchema,
  policyListDemoData,
  resourceApiCardConfigSchema,
  resourceApiCardDemoData,
  sloMonitorCardConfigSchema,
  sloMonitorCardDemoData,
  starterTemplatePickerConfigSchema,
  starterTemplatePickerDemoData,
  syncStatusCardConfigSchema,
  syncStatusCardDemoData,
  testimonialCardConfigSchema,
  testimonialCardDemoData,
  trustBadgesConfigSchema,
  trustBadgesDemoData,
  uptimeSegmentBarConfigSchema,
  uptimeSegmentBarDemoData,
  webhookEndpointsListConfigSchema,
  webhookEndpointsListDemoData,
} from './domain-ops-config.js';
import { defineWidget } from '../../registry/types.js';
import type { WidgetDefinition } from '../../registry/types.js';

/**
 * TRACK OPS — registry metadata for the eighteen §13 ops / billing / API /
 * marketing cards: the slice that CLOSES the annex. With these registered,
 * `ANNEX_PENDING` reaches all-empty and the catalog is delivered 176/176.
 *
 * METADATA ONLY. Every component loads through the `domain-ops-track-components`
 * barrel via `lazy(() => import(...))`, and the schemas + `demoData` come from
 * the PURE `domain-ops-config.ts` — so this module's transitive STATIC import
 * graph never reaches a `.tsx`, the family stays in one lazy chunk, and the
 * registry never eagerly pulls eighteen @adminium/ui-heavy cards into a sibling
 * family's bundle (04 §2.3). `qa/chunk-budget.test.ts` walks exactly this graph
 * and fails on a static component import, which is why the barrel indirection
 * exists.
 *
 * SIZING — the annex's per-widget grid note, converted to 40px HALF-UNITS
 * (04 §6.1): `h = round(annexRows × 2)`. So "min 6×2" → `minW: 6, minH: 4`.
 * Widths are already 12-col units and carry over unchanged.
 *
 * CONTRACTS — `['<shape>', 'static']` is not hedging; it is load-bearing. Four of
 * these widgets are legitimately CONFIG-ONLY instances (a starter picker driven
 * by `defs`, a claims row driven by `badges`, a checklist driven by `tasks`, a
 * snippet driven by a static `code` string), and `isEmptyData` is an AND over the
 * accepted shapes (registry/data-empty.ts) with `static` never empty — so listing
 * `static` is what stops the frame from swallowing a perfectly good config-only
 * instance into an empty state. The widgets still render their own `OpsEmpty`
 * body when they genuinely have nothing, which is the case the frame cannot see.
 *
 * `capabilities.editsData` marks the ten that emit `mutate` intents (key roll/
 * revoke, a card set-default, a webhook/policy toggle, the stopwatch's entry, a
 * sync-now, a starter selection, a checklist tick). The host runs them through
 * the CRUD API with undo + audit; widgets never write (04 §2.1). The read-only
 * eight — including `plan-pricing-cards`, whose CTA only drill-throughs — carry
 * no capability.
 */

// ── monitoring / status ─────────────────────────────────────────────────────

export const sloMonitorCardDefinition: WidgetDefinition = defineWidget({
  id: 'slo-monitor-card',
  family: 'domain',
  component: lazy(() =>
    import('./domain-ops-track-components.js').then((m) => ({ default: m.SloMonitorCardWidget })),
  ),
  configSchema: sloMonitorCardConfigSchema,
  /**
   * annex "monitor record {name, endpoint, target, current, status, budget, p95}
   * + 30-day status array" — one row, so the §3 `record` envelope; the shared
   * `isEmptyByShape.record` predicate (`row == null`) routes a monitor-less card
   * to the empty state.
   */
  dataContract: 'record',
  // annex "min 6×2, default 12×2 rows"
  sizing: { minW: 6, minH: 4, defaultW: 12, defaultH: 4 },
  placement: 'grid',
  skeleton: 'card',
  demoData: sloMonitorCardDemoData,
  descriptionKey: 'widgets.domain.sloMonitorCard.description',
});

export const uptimeSegmentBarDefinition: WidgetDefinition = defineWidget({
  id: 'uptime-segment-bar',
  family: 'domain',
  component: lazy(() =>
    import('./domain-ops-track-components.js').then((m) => ({ default: m.UptimeSegmentBarWidget })),
  ),
  configSchema: uptimeSegmentBarConfigSchema,
  // annex "daily status enums per service" — a row per day → `record-list`.
  dataContract: 'record-list',
  // annex "min 6×1"; the default fills a dashboard row at the same height.
  sizing: { minW: 6, minH: 2, defaultW: 12, defaultH: 2 },
  placement: 'grid',
  skeleton: 'chart',
  demoData: uptimeSegmentBarDemoData,
  descriptionKey: 'widgets.domain.uptimeSegmentBar.description',
});

export const syncStatusCardDefinition: WidgetDefinition = defineWidget({
  id: 'sync-status-card',
  family: 'domain',
  component: lazy(() =>
    import('./domain-ops-track-components.js').then((m) => ({ default: m.SyncStatusCardWidget })),
  ),
  configSchema: syncStatusCardConfigSchema,
  // annex "connection metadata + sync progress" — one connection row.
  dataContract: 'record',
  // annex "min 4×2"
  sizing: { minW: 4, minH: 4, defaultW: 4, defaultH: 6 },
  placement: 'grid',
  skeleton: 'card',
  // "Sync now" emits a mutate intent; the host runs the sync.
  capabilities: { editsData: true },
  demoData: syncStatusCardDemoData,
  descriptionKey: 'widgets.domain.syncStatusCard.description',
});

export const liveTimerDefinition: WidgetDefinition = defineWidget({
  id: 'live-timer',
  family: 'domain',
  component: lazy(() =>
    import('./domain-ops-track-components.js').then((m) => ({ default: m.LiveTimerWidget })),
  ),
  configSchema: liveTimerConfigSchema,
  // annex "{taskName, project, running, elapsed}" — the running stopwatch row.
  dataContract: 'record',
  // annex "12×2 hero"
  sizing: { minW: 6, minH: 4, defaultW: 12, defaultH: 4 },
  placement: 'grid',
  skeleton: 'card',
  // annex "stop auto-creates a time entry" — an insert intent, host-executed.
  capabilities: { editsData: true },
  demoData: liveTimerDemoData,
  descriptionKey: 'widgets.domain.liveTimer.description',
});

// ── experiments ─────────────────────────────────────────────────────────────

export const experimentVariantCompareDefinition: WidgetDefinition = defineWidget({
  id: 'experiment-variant-compare',
  family: 'domain',
  component: lazy(() =>
    import('./domain-ops-track-components.js').then((m) => ({ default: m.ExperimentVariantCompareWidget })),
  ),
  configSchema: experimentVariantCompareConfigSchema,
  // annex "variants[{name, conv, users, control?}]" — one row per arm.
  dataContract: 'record-list',
  // annex "min 6×3"
  sizing: { minW: 6, minH: 6, defaultW: 12, defaultH: 6 },
  placement: 'grid',
  skeleton: 'chart',
  demoData: experimentVariantCompareDemoData,
  descriptionKey: 'widgets.domain.experimentVariantCompare.description',
});

// ── billing ─────────────────────────────────────────────────────────────────

export const creditCardTileDefinition: WidgetDefinition = defineWidget({
  id: 'credit-card-tile',
  family: 'domain',
  component: lazy(() =>
    import('./domain-ops-track-components.js').then((m) => ({ default: m.CreditCardTileWidget })),
  ),
  configSchema: creditCardTileConfigSchema,
  // annex "{brand, last4, holder, exp, isDefault}" — one stored method.
  dataContract: 'record',
  // annex "min 3×2"
  sizing: { minW: 3, minH: 4, defaultW: 4, defaultH: 4 },
  placement: 'grid',
  skeleton: 'card',
  // Set-default emits a mutate intent.
  capabilities: { editsData: true },
  demoData: creditCardTileDemoData,
  descriptionKey: 'widgets.domain.creditCardTile.description',
});

export const planPricingCardsDefinition: WidgetDefinition = defineWidget({
  id: 'plan-pricing-cards',
  family: 'domain',
  component: lazy(() =>
    import('./domain-ops-track-components.js').then((m) => ({ default: m.PlanPricingCardsWidget })),
  ),
  configSchema: planPricingCardsConfigSchema,
  /**
   * annex "plan defs + billing period state (+ current-plan flag from
   * subscription record)" — a row per tier. The billing period is component
   * state seeded by config, not bound data.
   */
  dataContract: 'record-list',
  // annex "full-width row"
  sizing: { minW: 6, minH: 8, defaultW: 12, defaultH: 8 },
  placement: 'grid',
  skeleton: 'block',
  demoData: planPricingCardsDemoData,
  descriptionKey: 'widgets.domain.planPricingCards.description',
});

// ── API surface ─────────────────────────────────────────────────────────────

export const apiKeysPanelDefinition: WidgetDefinition = defineWidget({
  id: 'api-keys-panel',
  family: 'domain',
  component: lazy(() =>
    import('./domain-ops-track-components.js').then((m) => ({ default: m.ApiKeysPanelWidget })),
  ),
  configSchema: apiKeysPanelConfigSchema,
  // annex "key records {name, env, prefix, tail, scopes[], lastUsed, kind}".
  dataContract: 'record-list',
  // annex "12×4"
  sizing: { minW: 6, minH: 8, defaultW: 12, defaultH: 8 },
  placement: 'grid',
  skeleton: 'list',
  // Roll / revoke emit mutate intents.
  capabilities: { editsData: true },
  demoData: apiKeysPanelDemoData,
  descriptionKey: 'widgets.domain.apiKeysPanel.description',
});

export const apiPlaygroundDefinition: WidgetDefinition = defineWidget({
  id: 'api-playground',
  family: 'domain',
  component: lazy(() =>
    import('./domain-ops-track-components.js').then((m) => ({ default: m.ApiPlaygroundWidget })),
  ),
  configSchema: apiPlaygroundConfigSchema,
  // annex "selected endpoint metadata + sample rows" — one endpoint record.
  dataContract: 'record',
  // annex "8×5"
  sizing: { minW: 6, minH: 10, defaultW: 8, defaultH: 10 },
  placement: 'grid',
  skeleton: 'block',
  /**
   * Send NEVER performs a request (a widget that could issue arbitrary
   * authenticated calls from a dashboard cell is a confused-deputy hole). A write
   * method's Send emits a `mutate` intent the host executes through the CRUD API
   * — which is exactly what `editsData` declares.
   */
  capabilities: { editsData: true },
  demoData: apiPlaygroundDemoData,
  descriptionKey: 'widgets.domain.apiPlayground.description',
});

export const codeSnippetBlockDefinition: WidgetDefinition = defineWidget({
  id: 'code-snippet-block',
  family: 'domain',
  component: lazy(() =>
    import('./domain-ops-track-components.js').then((m) => ({ default: m.CodeSnippetBlockWidget })),
  ),
  configSchema: codeSnippetBlockConfigSchema,
  /**
   * annex "template-generated code strings (or static string)" — the parenthesis
   * is the contract: a snippet bound to a row is `record`, a snippet supplied as
   * config is `static` and must never be frame-emptied.
   */
  dataContract: ['record', 'static'],
  // annex "min 4×2"
  sizing: { minW: 4, minH: 4, defaultW: 6, defaultH: 6 },
  placement: 'grid',
  skeleton: 'block',
  demoData: codeSnippetBlockDemoData,
  descriptionKey: 'widgets.domain.codeSnippetBlock.description',
});

export const webhookEndpointsListDefinition: WidgetDefinition = defineWidget({
  id: 'webhook-endpoints-list',
  family: 'domain',
  component: lazy(() =>
    import('./domain-ops-track-components.js').then((m) => ({ default: m.WebhookEndpointsListWidget })),
  ),
  configSchema: webhookEndpointsListConfigSchema,
  // annex "{event, url, lastFired, enabled}" — a row per registration.
  dataContract: 'record-list',
  // annex "min 6×2"
  sizing: { minW: 6, minH: 4, defaultW: 12, defaultH: 8 },
  placement: 'grid',
  skeleton: 'list',
  // The enable toggle emits a mutate intent.
  capabilities: { editsData: true },
  demoData: webhookEndpointsListDemoData,
  descriptionKey: 'widgets.domain.webhookEndpointsList.description',
});

export const resourceApiCardDefinition: WidgetDefinition = defineWidget({
  id: 'resource-api-card',
  family: 'domain',
  component: lazy(() =>
    import('./domain-ops-track-components.js').then((m) => ({ default: m.ResourceApiCardWidget })),
  ),
  configSchema: resourceApiCardConfigSchema,
  // annex "table metadata + request stats" — one table's card.
  dataContract: 'record',
  // annex "min 3×2"
  sizing: { minW: 3, minH: 4, defaultW: 4, defaultH: 6 },
  placement: 'grid',
  skeleton: 'card',
  demoData: resourceApiCardDemoData,
  descriptionKey: 'widgets.domain.resourceApiCard.description',
});

// ── access / trust ──────────────────────────────────────────────────────────

export const policyListDefinition: WidgetDefinition = defineWidget({
  id: 'policy-list',
  family: 'domain',
  component: lazy(() =>
    import('./domain-ops-track-components.js').then((m) => ({ default: m.PolicyListWidget })),
  ),
  configSchema: policyListConfigSchema,
  // annex "{name, cmd, role, enabled} per table" — a row per policy.
  dataContract: 'record-list',
  // annex "min 4×2"
  sizing: { minW: 4, minH: 4, defaultW: 8, defaultH: 8 },
  placement: 'grid',
  skeleton: 'list',
  // The enable toggle emits a mutate intent — disabling RLS must be audited.
  capabilities: { editsData: true },
  demoData: policyListDemoData,
  descriptionKey: 'widgets.domain.policyList.description',
});

export const ipAllowlistCardDefinition: WidgetDefinition = defineWidget({
  id: 'ip-allowlist-card',
  family: 'domain',
  component: lazy(() =>
    import('./domain-ops-track-components.js').then((m) => ({ default: m.IpAllowlistCardWidget })),
  ),
  configSchema: ipAllowlistCardConfigSchema,
  // annex "string array" — normalized to a `record-list` of {ip, label} rows.
  dataContract: 'record-list',
  // annex "min 3×2"
  sizing: { minW: 3, minH: 4, defaultW: 4, defaultH: 6 },
  placement: 'grid',
  skeleton: 'list',
  demoData: ipAllowlistCardDemoData,
  descriptionKey: 'widgets.domain.ipAllowlistCard.description',
});

export const testimonialCardDefinition: WidgetDefinition = defineWidget({
  id: 'testimonial-card',
  family: 'domain',
  component: lazy(() =>
    import('./domain-ops-track-components.js').then((m) => ({ default: m.TestimonialCardWidget })),
  ),
  configSchema: testimonialCardConfigSchema,
  // annex "{initials, quote, name, role, company}" — one quote.
  dataContract: 'record',
  // annex "marketing sections" — no grid note; sized at the smallest cell where
  // a pull-quote stays legible.
  sizing: { minW: 3, minH: 4, defaultW: 4, defaultH: 6 },
  placement: 'grid',
  skeleton: 'card',
  demoData: testimonialCardDemoData,
  descriptionKey: 'widgets.domain.testimonialCard.description',
});

export const trustBadgesDefinition: WidgetDefinition = defineWidget({
  id: 'trust-badges',
  family: 'domain',
  component: lazy(() =>
    import('./domain-ops-track-components.js').then((m) => ({ default: m.TrustBadgesWidget })),
  ),
  configSchema: trustBadgesConfigSchema,
  // annex "string list" — bound as a `record-list`, or supplied via `badges`
  // config, which a marketing page does rather than binding a table for five
  // strings; `static` keeps the frame from emptying that legitimate instance.
  dataContract: ['record-list', 'static'],
  // annex "marketing sections" — a single claims row.
  sizing: { minW: 3, minH: 2, defaultW: 12, defaultH: 2 },
  placement: 'grid',
  skeleton: 'card',
  demoData: trustBadgesDemoData,
  descriptionKey: 'widgets.domain.trustBadges.description',
});

// ── getting started ─────────────────────────────────────────────────────────

export const starterTemplatePickerDefinition: WidgetDefinition = defineWidget({
  id: 'starter-template-picker',
  family: 'domain',
  component: lazy(() =>
    import('./domain-ops-track-components.js').then((m) => ({ default: m.StarterTemplatePickerWidget })),
  ),
  configSchema: starterTemplatePickerConfigSchema,
  // annex "starterDefs[] merged over base doc" — bound rows, or `defs` config.
  dataContract: ['record-list', 'static'],
  // annex "modal grid" — an overlay, which is exactly how page-builder names it
  // (`chrome.overlays`), not a grid cell.
  sizing: { minW: 6, minH: 10, defaultW: 8, defaultH: 12 },
  placement: 'overlay',
  skeleton: 'block',
  // Selection seeds a full doc — an insert intent the host executes.
  capabilities: { editsData: true },
  demoData: starterTemplatePickerDemoData,
  descriptionKey: 'widgets.domain.starterTemplatePicker.description',
});

export const onboardingChecklistDefinition: WidgetDefinition = defineWidget({
  id: 'onboarding-checklist',
  family: 'domain',
  component: lazy(() =>
    import('./domain-ops-track-components.js').then((m) => ({ default: m.OnboardingChecklistWidget })),
  ),
  configSchema: onboardingChecklistConfigSchema,
  /**
   * annex "tasks {title, desc, icon, time, action, done}" — bound rows, or the
   * `tasks` config a host supplies for a checklist that is not table-backed.
   *
   * This is the REUSABLE WIDGET FORM of the reactive checklist in
   * apps/dashboard/src/onboarding — built from the data contract, sharing no code
   * with it, because packages must never import apps (01 §2.3).
   */
  dataContract: ['record-list', 'static'],
  // annex "8×5"
  sizing: { minW: 6, minH: 8, defaultW: 8, defaultH: 10 },
  placement: 'grid',
  skeleton: 'list',
  // Ticking a step emits a mutate intent.
  capabilities: { editsData: true },
  demoData: onboardingChecklistDemoData,
  descriptionKey: 'widgets.domain.onboardingChecklist.description',
});

/** The eighteen §13 ops ids — the slice that closes the annex catalog. */
export const domainOpsTrackDefinitions: readonly WidgetDefinition[] = [
  starterTemplatePickerDefinition,
  sloMonitorCardDefinition,
  uptimeSegmentBarDefinition,
  experimentVariantCompareDefinition,
  creditCardTileDefinition,
  planPricingCardsDefinition,
  apiKeysPanelDefinition,
  apiPlaygroundDefinition,
  codeSnippetBlockDefinition,
  webhookEndpointsListDefinition,
  resourceApiCardDefinition,
  liveTimerDefinition,
  syncStatusCardDefinition,
  ipAllowlistCardDefinition,
  onboardingChecklistDefinition,
  testimonialCardDefinition,
  trustBadgesDefinition,
  policyListDefinition,
];
