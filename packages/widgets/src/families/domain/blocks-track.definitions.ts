import { lazy } from 'react';

import {
  blockApprovalConfigSchema,
  blockApprovalDemoData,
  blockAttachmentsConfigSchema,
  blockAttachmentsDemoData,
  blockBarChartConfigSchema,
  blockBarChartDemoData,
  blockContactConfigSchema,
  blockContactDemoData,
  blockDeliveryStepperConfigSchema,
  blockDeliveryStepperDemoData,
  blockDiscountCodesConfigSchema,
  blockDiscountCodesDemoData,
  blockHighlightBoxConfigSchema,
  blockHighlightBoxDemoData,
  blockImagePlaceholderConfigSchema,
  blockImagePlaceholderDemoData,
  blockKpiRowConfigSchema,
  blockKpiRowDemoData,
  blockLateFeesConfigSchema,
  blockLateFeesDemoData,
  blockLineChartConfigSchema,
  blockLineChartDemoData,
  blockLineItemsConfigSchema,
  blockLineItemsDemoData,
  blockLoyaltyBannerConfigSchema,
  blockLoyaltyBannerDemoData,
  blockMultiCurrencyConfigSchema,
  blockMultiCurrencyDemoData,
  blockPaymentHistoryConfigSchema,
  blockPaymentHistoryDemoData,
  blockQrPayConfigSchema,
  blockQrPayDemoData,
  blockRecurringBannerConfigSchema,
  blockRecurringBannerDemoData,
  blockSignatureConfigSchema,
  blockSignatureDemoData,
  blockTaxBreakdownConfigSchema,
  blockTaxBreakdownDemoData,
  blockTermsCheckboxConfigSchema,
  blockTermsCheckboxDemoData,
  blockTotalsSummaryConfigSchema,
  blockTotalsSummaryDemoData,
  blockTwoColTableConfigSchema,
  blockTwoColTableDemoData,
  documentCanvasConfigSchema,
  documentCanvasDemoData,
} from './blocks-config.js';
import { defineWidget } from '../../registry/types.js';
import type { WidgetDefinition } from '../../registry/types.js';

/**
 * TRACK BUILDER — registry metadata for `document-canvas` + the 22 `block-*`
 * document-vocabulary widgets (annex §13), the slice that closes the annex's
 * §13 document half.
 *
 * METADATA ONLY. Every component loads through the `blocks-track-components`
 * barrel via `lazy(() => import(...))`, and the schemas + `demoData` come from
 * the PURE `blocks-config.ts` — so this module's transitive STATIC import graph
 * never reaches a `.tsx`, the family stays in one lazy chunk, and the registry
 * never eagerly pulls the document vocabulary into a sibling family's bundle
 * (04 §2.3). `qa/chunk-budget.test.ts` walks exactly this graph and fails on a
 * static component import, which is why the barrel indirection exists.
 *
 * The GREEN LOOP spreads `blocksTrackDefinitions` into the registry map. Widget
 * ids match the annex catalog verbatim (acceptance #1).
 *
 * SIZING — the annex gives the blocks no per-widget grid note (they are a
 * "shared library used by `document-canvas`", sized by the canvas's paper
 * column), so each is sized at the smallest cell where it stays legible
 * STANDALONE on the 12-col grid, in 40px half-units (04 §6.1). `document-canvas`
 * itself is the annex's "main canvas pane" → `placement: 'page'`.
 *
 * DATA CONTRACTS — the annex gives each block a bespoke "Data:" note rather than
 * a §3 shape name; each mapping is justified on its definition below and in
 * `block-types.ts`.
 *
 * `capabilities.editsData` marks the blocks that emit `mutate` intents (line-item
 * qty/rate edits, the terms toggle, an approval decision, canvas reorder/remove).
 * The host runs them through the CRUD API with undo + audit; blocks never write.
 */

// ── document-canvas ─────────────────────────────────────────────────────────

export const documentCanvasDefinition: WidgetDefinition = defineWidget({
  id: 'document-canvas',
  family: 'domain',
  component: lazy(() =>
    import('./blocks-track-components.js').then((m) => ({ default: m.DocumentCanvasWidget })),
  ),
  configSchema: documentCanvasConfigSchema,
  /**
   * The annex's "single doc object (strings, address lines, items[], rates,
   * flags, blockOrder[])" — the §3 `record` envelope, so the shared
   * `isEmptyByShape.record` predicate (`row == null`) routes a doc-less canvas
   * to the empty state.
   */
  dataContract: 'record',
  // annex "main canvas pane" — a full page body, not a grid cell.
  sizing: { minW: 6, minH: 16, defaultW: 8, defaultH: 24 },
  placement: 'page',
  skeleton: 'block',
  capabilities: { editsData: true },
  demoData: documentCanvasDemoData,
  descriptionKey: 'widgets.domain.documentCanvas.description',
});

// ── money blocks ────────────────────────────────────────────────────────────

export const blockLineItemsDefinition: WidgetDefinition = defineWidget({
  id: 'block-line-items',
  family: 'domain',
  component: lazy(() =>
    import('./blocks-track-components.js').then((m) => ({ default: m.BlockLineItemsWidget })),
  ),
  configSchema: blockLineItemsConfigSchema,
  // annex "items[{desc, qty, rate}]" → the canonical `record-list` envelope.
  dataContract: 'record-list',
  sizing: { minW: 4, minH: 4, defaultW: 8, defaultH: 8 },
  placement: 'grid',
  skeleton: 'table',
  capabilities: { editsData: true, exportCsv: true },
  demoData: blockLineItemsDemoData,
  descriptionKey: 'widgets.domain.blockLineItems.description',
});

export const blockTotalsSummaryDefinition: WidgetDefinition = defineWidget({
  id: 'block-totals-summary',
  family: 'domain',
  component: lazy(() =>
    import('./blocks-track-components.js').then((m) => ({ default: m.BlockTotalsSummaryWidget })),
  ),
  configSchema: blockTotalsSummaryConfigSchema,
  /**
   * annex "items[] + rates" — ONE object carrying both, so `record` (not
   * `record-list`): the block's payload is a doc fragment, not a row set, and
   * the totals are recomputed from it rather than stored.
   */
  dataContract: 'record',
  sizing: { minW: 3, minH: 4, defaultW: 4, defaultH: 5 },
  placement: 'grid',
  skeleton: 'card',
  demoData: blockTotalsSummaryDemoData,
  descriptionKey: 'widgets.domain.blockTotalsSummary.description',
});

export const blockTaxBreakdownDefinition: WidgetDefinition = defineWidget({
  id: 'block-tax-breakdown',
  family: 'domain',
  component: lazy(() =>
    import('./blocks-track-components.js').then((m) => ({ default: m.BlockTaxBreakdownWidget })),
  ),
  configSchema: blockTaxBreakdownConfigSchema,
  dataContract: 'record-list', // annex "taxLines[]"
  sizing: { minW: 3, minH: 3, defaultW: 4, defaultH: 4 },
  placement: 'grid',
  skeleton: 'list',
  demoData: blockTaxBreakdownDemoData,
  descriptionKey: 'widgets.domain.blockTaxBreakdown.description',
});

export const blockMultiCurrencyDefinition: WidgetDefinition = defineWidget({
  id: 'block-multi-currency',
  family: 'domain',
  component: lazy(() =>
    import('./blocks-track-components.js').then((m) => ({ default: m.BlockMultiCurrencyWidget })),
  ),
  configSchema: blockMultiCurrencyConfigSchema,
  dataContract: 'record', // annex "{amount, fx[]}"
  sizing: { minW: 3, minH: 3, defaultW: 4, defaultH: 5 },
  placement: 'grid',
  skeleton: 'list',
  demoData: blockMultiCurrencyDemoData,
  descriptionKey: 'widgets.domain.blockMultiCurrency.description',
});

export const blockPaymentHistoryDefinition: WidgetDefinition = defineWidget({
  id: 'block-payment-history',
  family: 'domain',
  component: lazy(() =>
    import('./blocks-track-components.js').then((m) => ({ default: m.BlockPaymentHistoryWidget })),
  ),
  configSchema: blockPaymentHistoryConfigSchema,
  dataContract: 'record-list', // annex "payHist[]"
  sizing: { minW: 4, minH: 4, defaultW: 6, defaultH: 6 },
  placement: 'grid',
  skeleton: 'list',
  demoData: blockPaymentHistoryDemoData,
  descriptionKey: 'widgets.domain.blockPaymentHistory.description',
});

export const blockDiscountCodesDefinition: WidgetDefinition = defineWidget({
  id: 'block-discount-codes',
  family: 'domain',
  component: lazy(() =>
    import('./blocks-track-components.js').then((m) => ({ default: m.BlockDiscountCodesWidget })),
  ),
  configSchema: blockDiscountCodesConfigSchema,
  dataContract: 'record-list', // annex "discCodes[]"
  sizing: { minW: 3, minH: 3, defaultW: 4, defaultH: 4 },
  placement: 'grid',
  skeleton: 'list',
  demoData: blockDiscountCodesDemoData,
  descriptionKey: 'widgets.domain.blockDiscountCodes.description',
});

export const blockLateFeesDefinition: WidgetDefinition = defineWidget({
  id: 'block-late-fees',
  family: 'domain',
  component: lazy(() =>
    import('./blocks-track-components.js').then((m) => ({ default: m.BlockLateFeesWidget })),
  ),
  configSchema: blockLateFeesConfigSchema,
  dataContract: 'record', // annex "{rate, days}"
  sizing: { minW: 3, minH: 2, defaultW: 6, defaultH: 2 },
  placement: 'grid',
  skeleton: 'card',
  demoData: blockLateFeesDemoData,
  descriptionKey: 'widgets.domain.blockLateFees.description',
});

export const blockQrPayDefinition: WidgetDefinition = defineWidget({
  id: 'block-qr-pay',
  family: 'domain',
  component: lazy(() =>
    import('./blocks-track-components.js').then((m) => ({ default: m.BlockQrPayWidget })),
  ),
  configSchema: blockQrPayConfigSchema,
  dataContract: 'record', // annex "{caption, total}"
  sizing: { minW: 3, minH: 4, defaultW: 4, defaultH: 4 },
  placement: 'grid',
  skeleton: 'card',
  demoData: blockQrPayDemoData,
  descriptionKey: 'widgets.domain.blockQrPay.description',
});

// ── report blocks ───────────────────────────────────────────────────────────

export const blockKpiRowDefinition: WidgetDefinition = defineWidget({
  id: 'block-kpi-row',
  family: 'domain',
  component: lazy(() =>
    import('./blocks-track-components.js').then((m) => ({ default: m.BlockKpiRowWidget })),
  ),
  configSchema: blockKpiRowConfigSchema,
  dataContract: 'record-list', // annex "kpis[]"
  sizing: { minW: 4, minH: 2, defaultW: 8, defaultH: 3 },
  placement: 'grid',
  skeleton: 'card',
  demoData: blockKpiRowDemoData,
  descriptionKey: 'widgets.domain.blockKpiRow.description',
});

/**
 * The annex groups `block-bar-chart` / `block-line-chart` as ONE entry with one
 * data note ("series[]"), so both take `categorical` — swapping bar↔line in a
 * doc must never re-bind the block.
 */
export const blockBarChartDefinition: WidgetDefinition = defineWidget({
  id: 'block-bar-chart',
  family: 'domain',
  component: lazy(() =>
    import('./blocks-track-components.js').then((m) => ({ default: m.BlockBarChartWidget })),
  ),
  configSchema: blockBarChartConfigSchema,
  dataContract: 'categorical',
  sizing: { minW: 3, minH: 3, defaultW: 4, defaultH: 4 },
  placement: 'grid',
  skeleton: 'chart',
  demoData: blockBarChartDemoData,
  descriptionKey: 'widgets.domain.blockBarChart.description',
});

export const blockLineChartDefinition: WidgetDefinition = defineWidget({
  id: 'block-line-chart',
  family: 'domain',
  component: lazy(() =>
    import('./blocks-track-components.js').then((m) => ({ default: m.BlockLineChartWidget })),
  ),
  configSchema: blockLineChartConfigSchema,
  dataContract: 'categorical',
  sizing: { minW: 3, minH: 3, defaultW: 4, defaultH: 4 },
  placement: 'grid',
  skeleton: 'chart',
  demoData: blockLineChartDemoData,
  descriptionKey: 'widgets.domain.blockLineChart.description',
});

export const blockTwoColTableDefinition: WidgetDefinition = defineWidget({
  id: 'block-two-col-table',
  family: 'domain',
  component: lazy(() =>
    import('./blocks-track-components.js').then((m) => ({ default: m.BlockTwoColTableWidget })),
  ),
  configSchema: blockTwoColTableConfigSchema,
  /**
   * annex "rows[][]" — carried in the `record-list` envelope so the shared
   * `total === 0` predicate routes an empty table to the empty state; the rows
   * themselves are string PAIRS rather than objects (`twoColRowsOf` accepts
   * either).
   */
  dataContract: 'record-list',
  sizing: { minW: 3, minH: 3, defaultW: 4, defaultH: 6 },
  placement: 'grid',
  skeleton: 'table',
  capabilities: { exportCsv: true },
  demoData: blockTwoColTableDemoData,
  descriptionKey: 'widgets.domain.blockTwoColTable.description',
});

export const blockAttachmentsDefinition: WidgetDefinition = defineWidget({
  id: 'block-attachments',
  family: 'domain',
  component: lazy(() =>
    import('./blocks-track-components.js').then((m) => ({ default: m.BlockAttachmentsWidget })),
  ),
  configSchema: blockAttachmentsConfigSchema,
  dataContract: 'record-list', // annex "files[]"
  sizing: { minW: 3, minH: 3, defaultW: 4, defaultH: 4 },
  placement: 'grid',
  skeleton: 'list',
  demoData: blockAttachmentsDemoData,
  descriptionKey: 'widgets.domain.blockAttachments.description',
});

export const blockImagePlaceholderDefinition: WidgetDefinition = defineWidget({
  id: 'block-image-placeholder',
  family: 'domain',
  component: lazy(() =>
    import('./blocks-track-components.js').then((m) => ({ default: m.BlockImagePlaceholderWidget })),
  ),
  configSchema: blockImagePlaceholderConfigSchema,
  dataContract: 'record', // annex "{text}"
  sizing: { minW: 3, minH: 3, defaultW: 4, defaultH: 5 },
  placement: 'grid',
  skeleton: 'block',
  demoData: blockImagePlaceholderDemoData,
  descriptionKey: 'widgets.domain.blockImagePlaceholder.description',
});

// ── status / approval blocks ────────────────────────────────────────────────

export const blockLoyaltyBannerDefinition: WidgetDefinition = defineWidget({
  id: 'block-loyalty-banner',
  family: 'domain',
  component: lazy(() =>
    import('./blocks-track-components.js').then((m) => ({ default: m.BlockLoyaltyBannerWidget })),
  ),
  configSchema: blockLoyaltyBannerConfigSchema,
  dataContract: 'record', // annex "{balance, earned, tier}"
  sizing: { minW: 3, minH: 2, defaultW: 6, defaultH: 2 },
  placement: 'grid',
  skeleton: 'card',
  demoData: blockLoyaltyBannerDemoData,
  descriptionKey: 'widgets.domain.blockLoyaltyBanner.description',
});

export const blockRecurringBannerDefinition: WidgetDefinition = defineWidget({
  id: 'block-recurring-banner',
  family: 'domain',
  component: lazy(() =>
    import('./blocks-track-components.js').then((m) => ({ default: m.BlockRecurringBannerWidget })),
  ),
  configSchema: blockRecurringBannerConfigSchema,
  dataContract: 'record', // annex "{freq, next, count}"
  sizing: { minW: 3, minH: 2, defaultW: 6, defaultH: 2 },
  placement: 'grid',
  skeleton: 'card',
  demoData: blockRecurringBannerDemoData,
  descriptionKey: 'widgets.domain.blockRecurringBanner.description',
});

export const blockDeliveryStepperDefinition: WidgetDefinition = defineWidget({
  id: 'block-delivery-stepper',
  family: 'domain',
  component: lazy(() =>
    import('./blocks-track-components.js').then((m) => ({ default: m.BlockDeliveryStepperWidget })),
  ),
  configSchema: blockDeliveryStepperConfigSchema,
  dataContract: 'record-list', // annex "steps[]"
  sizing: { minW: 4, minH: 2, defaultW: 8, defaultH: 2 },
  placement: 'grid',
  skeleton: 'card',
  demoData: blockDeliveryStepperDemoData,
  descriptionKey: 'widgets.domain.blockDeliveryStepper.description',
});

export const blockSignatureDefinition: WidgetDefinition = defineWidget({
  id: 'block-signature',
  family: 'domain',
  component: lazy(() =>
    import('./blocks-track-components.js').then((m) => ({ default: m.BlockSignatureWidget })),
  ),
  configSchema: blockSignatureConfigSchema,
  dataContract: 'record', // annex "{sigName, sigTitle}"
  sizing: { minW: 3, minH: 2, defaultW: 6, defaultH: 3 },
  placement: 'grid',
  skeleton: 'card',
  demoData: blockSignatureDemoData,
  descriptionKey: 'widgets.domain.blockSignature.description',
});

export const blockTermsCheckboxDefinition: WidgetDefinition = defineWidget({
  id: 'block-terms-checkbox',
  family: 'domain',
  component: lazy(() =>
    import('./blocks-track-components.js').then((m) => ({ default: m.BlockTermsCheckboxWidget })),
  ),
  configSchema: blockTermsCheckboxConfigSchema,
  /**
   * annex "{label, checked}" — a CONTROL whose payload is its own state, so the
   * §3 `form-state` shape: `isEmptyByShape['form-state']` never routes it to the
   * empty card, which is right (an unchecked box is data, not absence).
   */
  dataContract: 'form-state',
  sizing: { minW: 3, minH: 2, defaultW: 6, defaultH: 2 },
  placement: 'grid',
  skeleton: 'card',
  capabilities: { editsData: true },
  demoData: blockTermsCheckboxDemoData,
  descriptionKey: 'widgets.domain.blockTermsCheckbox.description',
});

export const blockApprovalDefinition: WidgetDefinition = defineWidget({
  id: 'block-approval',
  family: 'domain',
  component: lazy(() =>
    import('./blocks-track-components.js').then((m) => ({ default: m.BlockApprovalWidget })),
  ),
  configSchema: blockApprovalConfigSchema,
  dataContract: 'record', // annex "{name, title, status}"
  sizing: { minW: 3, minH: 2, defaultW: 4, defaultH: 3 },
  placement: 'grid',
  skeleton: 'card',
  capabilities: { editsData: true },
  demoData: blockApprovalDemoData,
  descriptionKey: 'widgets.domain.blockApproval.description',
});

// ── content blocks ──────────────────────────────────────────────────────────

export const blockContactDefinition: WidgetDefinition = defineWidget({
  id: 'block-contact',
  family: 'domain',
  component: lazy(() =>
    import('./blocks-track-components.js').then((m) => ({ default: m.BlockContactWidget })),
  ),
  configSchema: blockContactConfigSchema,
  dataContract: 'record', // annex "{name, email, phone}"
  sizing: { minW: 3, minH: 2, defaultW: 4, defaultH: 3 },
  placement: 'grid',
  skeleton: 'list',
  demoData: blockContactDemoData,
  descriptionKey: 'widgets.domain.blockContact.description',
});

export const blockHighlightBoxDefinition: WidgetDefinition = defineWidget({
  id: 'block-highlight-box',
  family: 'domain',
  component: lazy(() =>
    import('./blocks-track-components.js').then((m) => ({ default: m.BlockHighlightBoxWidget })),
  ),
  configSchema: blockHighlightBoxConfigSchema,
  dataContract: 'record', // annex "{label, value}"
  sizing: { minW: 3, minH: 2, defaultW: 4, defaultH: 3 },
  placement: 'grid',
  skeleton: 'card',
  demoData: blockHighlightBoxDemoData,
  descriptionKey: 'widgets.domain.blockHighlightBox.description',
});

/**
 * The TRACK BUILDER slice, in annex §13 order: the canvas, then its 22-block
 * shared library. Wired into `qa/delivered.ts`; the GREEN LOOP spreads it into
 * the registry map.
 */
export const blocksTrackDefinitions: readonly WidgetDefinition[] = [
  documentCanvasDefinition,
  blockTotalsSummaryDefinition,
  blockLineItemsDefinition,
  blockKpiRowDefinition,
  blockBarChartDefinition,
  blockLineChartDefinition,
  blockTwoColTableDefinition,
  blockTaxBreakdownDefinition,
  blockMultiCurrencyDefinition,
  blockPaymentHistoryDefinition,
  blockDiscountCodesDefinition,
  blockLoyaltyBannerDefinition,
  blockRecurringBannerDefinition,
  blockQrPayDefinition,
  blockDeliveryStepperDefinition,
  blockSignatureDefinition,
  blockTermsCheckboxDefinition,
  blockApprovalDefinition,
  blockAttachmentsDefinition,
  blockLateFeesDefinition,
  blockImagePlaceholderDefinition,
  blockContactDefinition,
  blockHighlightBoxDefinition,
];
