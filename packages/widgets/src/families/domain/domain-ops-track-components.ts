// SPDX-License-Identifier: AGPL-3.0-only
/**
 * TRACK OPS — component barrel for the eighteen §13 ops / billing / API /
 * marketing cards: the single lazy-import target for
 * `domain-ops-track.definitions.ts`, so the registry's metadata graph reaches
 * this @adminium/ui-heavy component code ONLY through a dynamic `import()`
 * boundary (one lazy chunk, 04 §2.3).
 *
 * Mirrors the `blocks-track-components.ts` / `media-track-components.ts`
 * convention. Nothing but components belongs here — schemas and `demoData` live
 * in the pure `domain-ops-config.ts`, which the definitions import statically.
 *
 * The seven single-widget modules are the ones TRACK OPS landed before the
 * grouped modules were adopted; the remaining eleven are factored into four
 * modules by shared concern (clock, API surface, access, getting-started) rather
 * than one file per id.
 */
export { SloMonitorCardWidget } from './SloMonitorCard.js';
export { UptimeSegmentBarWidget } from './UptimeSegmentBar.js';
export { ExperimentVariantCompareWidget } from './ExperimentVariantCompare.js';
export { CreditCardTileWidget } from './CreditCardTile.js';
export { PlanPricingCardsWidget } from './PlanPricingCards.js';
export { ApiKeysPanelWidget } from './ApiKeysPanel.js';
export { ApiPlaygroundWidget } from './ApiPlayground.js';
export { LiveTimerWidget, SyncStatusCardWidget } from './OpsMonitoring.js';
export {
  CodeSnippetBlockWidget,
  ResourceApiCardWidget,
  WebhookEndpointsListWidget,
} from './OpsApi.js';
export {
  IpAllowlistCardWidget,
  PolicyListWidget,
  TestimonialCardWidget,
  TrustBadgesWidget,
} from './OpsTrust.js';
export { OnboardingChecklistWidget, StarterTemplatePickerWidget } from './OpsOnboarding.js';
