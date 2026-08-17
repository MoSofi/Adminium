// SPDX-License-Identifier: AGPL-3.0-only
/**
 * TRACK BUILDER — component barrel for `document-canvas` + the 22 `block-*`
 * widgets: the single lazy-import target for `blocks-track.definitions.ts`, so
 * the registry's metadata graph reaches the @adminium/ui-heavy component code
 * ONLY through a dynamic `import()` boundary (one lazy chunk, 04 §2.3).
 *
 * Mirrors the `media-track-components.ts` / `domain-track-components.ts`
 * convention. Nothing but components belongs here — schemas and `demoData` live
 * in the pure `blocks-config.ts`, which the definitions import statically.
 */
export { DocumentCanvasWidget } from './DocumentCanvas.js';
export {
  BlockDiscountCodesWidget,
  BlockLateFeesWidget,
  BlockLineItemsWidget,
  BlockMultiCurrencyWidget,
  BlockPaymentHistoryWidget,
  BlockQrPayWidget,
  BlockTaxBreakdownWidget,
  BlockTotalsSummaryWidget,
} from './BlockFinancial.js';
export {
  BlockAttachmentsWidget,
  BlockBarChartWidget,
  BlockImagePlaceholderWidget,
  BlockKpiRowWidget,
  BlockLineChartWidget,
  BlockTwoColTableWidget,
} from './BlockReport.js';
export {
  BlockApprovalWidget,
  BlockDeliveryStepperWidget,
  BlockLoyaltyBannerWidget,
  BlockRecurringBannerWidget,
  BlockSignatureWidget,
  BlockTermsCheckboxWidget,
} from './BlockStatus.js';
export { BlockContactWidget, BlockHighlightBoxWidget } from './BlockContent.js';
