/**
 * TRACK BUILDER stories (annex §13) — `document-canvas` + the 22 `block-*`
 * document-vocabulary widgets: the canvas's four WidgetFrame states through
 * WidgetHost (acceptance #4), a light/dark × LTR/RTL matrix (acceptance #9), and
 * a grouped gallery per block module so all 22 blocks are captured without 22
 * near-identical story files.
 *
 * REAL GEOMETRY MIRRORING — the RTL stories are not a bare `dir` attribute:
 *
 *   - The canvas MIRRORS. Its paper header, block rail and the hover reveal of
 *     the reorder controls (`end-1`) are logical-only, so `dir="rtl"` genuinely
 *     flips the whole document — the issued/due column moves to the inline start
 *     and the controls ride the opposite edge.
 *   - The REORDER AXIS does NOT mirror, and that contrast is the regression these
 *     stories exist to catch: up/down are BLOCK-axis controls, so a capture where
 *     the chevrons swapped meaning under RTL is a bug. Money rows behave the same
 *     way — the label/figure pair mirrors, but the mono figure stays
 *     `text-end`-aligned to the reading direction.
 *   - `block-qr-pay` is a forced-LIGHT island (a QR tile we render dark would not
 *     scan), so its dark captures must show the tile still on white while the
 *     surrounding block chrome goes dark.
 *
 * Every payload is the same seeded generator `demoData` uses, pinned to seed 7
 * and the fixed `BLOCK_DEMO_EPOCH`, so captures are byte-deterministic (no
 * wall-clock read anywhere in the family).
 *
 * Widgets resolve through a LOCAL registry override so the stories work before
 * the green loop merges the definitions into the global map.
 */
import type { ReactNode } from 'react';

import {
  blockApprovalDemoData,
  blockAttachmentsDemoData,
  blockBarChartDemoData,
  blockContactDemoData,
  blockDeliveryStepperDemoData,
  blockDiscountCodesDemoData,
  blockHighlightBoxDemoData,
  blockImagePlaceholderDemoData,
  blockKpiRowDemoData,
  blockLateFeesDemoData,
  blockLineChartDemoData,
  blockLineItemsDemoData,
  blockLoyaltyBannerDemoData,
  blockMultiCurrencyDemoData,
  blockPaymentHistoryDemoData,
  blockQrPayDemoData,
  blockRecurringBannerDemoData,
  blockSignatureDemoData,
  blockTaxBreakdownDemoData,
  blockTermsCheckboxDemoData,
  blockTotalsSummaryDemoData,
  blockTwoColTableDemoData,
  documentCanvasDemoData,
} from './blocks-config.js';
import { blocksTrackDefinitions } from './blocks-track.definitions.js';
import { WidgetHost } from '../../frame/WidgetHost.js';
import { buildRegistry } from '../../registry/index.js';

const registry = buildRegistry(blocksTrackDefinitions);

const meta = { title: 'Widgets/Domain/Document blocks' };
export default meta;

type Status = 'success' | 'loading' | 'error';

function host(
  widgetId: string,
  instanceId: string,
  config: Record<string, unknown>,
  data: unknown,
  status: Status = 'success',
  width = 'w-[26rem]',
) {
  return (
    <div className={width} key={instanceId}>
      <WidgetHost
        widgetId={widgetId}
        instanceId={instanceId}
        config={config}
        registry={registry}
        data={
          status === 'success'
            ? { status, data }
            : status === 'error'
              ? { status, error: new Error('TABLE_FORBIDDEN'), refetch: () => {} }
              : { status }
        }
      />
    </div>
  );
}

function Frame({ dark, dir, children }: { dark?: boolean; dir?: 'ltr' | 'rtl'; children: ReactNode }) {
  const content = (
    <div dir={dir} className="flex flex-wrap items-start gap-4 bg-bg p-4">
      {children}
    </div>
  );
  return dark ? <div data-theme="dark">{content}</div> : content;
}

const SEED = 7;
const docData = documentCanvasDemoData(SEED);

const canvasConfig = {
  title: 'Invoice builder',
  format: { locale: 'en-US', currency: 'USD' },
  brand: { accent: 'accent' as const, logo: 'NW' },
  billedToLabel: 'Billed to',
  issuedLabel: 'Issued',
  dueLabel: 'Due',
  blockListLabel: 'Document blocks',
  moveUpLabel: 'Move block up',
  moveDownLabel: 'Move block down',
  removeBlockLabel: 'Remove block',
};

/** Arabic copy + locale so the RTL captures exercise the real Intl path too. */
const canvasAr = {
  title: 'منشئ الفواتير',
  format: { locale: 'ar-EG', currency: 'USD' },
  brand: { accent: 'accent' as const, logo: 'NW' },
  billedToLabel: 'الفاتورة إلى',
  issuedLabel: 'تاريخ الإصدار',
  dueLabel: 'تاريخ الاستحقاق',
  blockListLabel: 'كتل المستند',
  moveUpLabel: 'تحريك الكتلة لأعلى',
  moveDownLabel: 'تحريك الكتلة لأسفل',
  removeBlockLabel: 'حذف الكتلة',
};

const en = { format: { locale: 'en-US', currency: 'USD' } };
const ar = { format: { locale: 'ar-EG', currency: 'USD' } };

// --- document-canvas ---------------------------------------------------------

export const DocumentCanvasStory = {
  name: 'document-canvas — invoice',
  render: () => host('document-canvas', 's-dc', canvasConfig, docData, 'success', 'w-[44rem]'),
};

export const DocumentCanvasSelected = {
  name: 'document-canvas — block selected (accent outline)',
  render: () =>
    host(
      'document-canvas',
      's-dc-sel',
      { ...canvasConfig, selectedBlockId: 'block-line-items-0' },
      docData,
      'success',
      'w-[44rem]',
    ),
};

export const DocumentCanvasReport = {
  name: 'document-canvas — report doc type',
  render: () =>
    host('document-canvas', 's-dc-report', { ...canvasConfig, docType: 'report' }, documentCanvasDemoData(11), 'success', 'w-[44rem]'),
};

/** An email doc renders in the always-light scope — email clients render light. */
export const DocumentCanvasEmail = {
  name: 'document-canvas — email (always-light island)',
  render: () =>
    host(
      'document-canvas',
      's-dc-email',
      { ...canvasConfig, docType: 'email' },
      { row: { docType: 'email', title: 'Receipt', blockOrder: ['block-highlight-box', 'block-contact'], blocks: { 'block-highlight-box': { row: { label: 'Amount charged', value: '$290.00' } }, 'block-contact': blockContactDemoData(SEED) } } },
      'success',
      'w-[44rem]',
    ),
};

export const DocumentCanvasReadOnly = {
  name: 'document-canvas — printed (no select, no reorder)',
  render: () =>
    host('document-canvas', 's-dc-ro', { ...canvasConfig, selectable: false, reorderable: false }, docData, 'success', 'w-[44rem]'),
};

// --- four WidgetFrame states (acceptance #4) ---------------------------------

export const DocumentCanvasStates = {
  name: 'document-canvas — four states',
  render: () => (
    <Frame>
      {host('document-canvas', 's-dc-loaded', canvasConfig, docData, 'success', 'w-[30rem]')}
      {host('document-canvas', 's-dc-skeleton', canvasConfig, undefined, 'loading', 'w-[30rem]')}
      {host('document-canvas', 's-dc-empty', { ...canvasConfig, emptyTitle: 'Nothing in this document', emptyBody: 'Add a block from the palette to start building the document.' }, { row: null }, 'success', 'w-[30rem]')}
      {host('document-canvas', 's-dc-error', canvasConfig, undefined, 'error', 'w-[30rem]')}
    </Frame>
  ),
};

/** The money core's four states — the blocks each carry their own empty copy. */
export const BlockStates = {
  name: 'blocks — four states (totals / line items)',
  render: () => (
    <Frame>
      {host('block-totals-summary', 's-bt-loaded', en, blockTotalsSummaryDemoData(SEED))}
      {host('block-totals-summary', 's-bt-skeleton', en, undefined, 'loading')}
      {host('block-totals-summary', 's-bt-empty', { ...en, emptyTitle: 'No totals yet', emptyBody: 'Totals appear once the document has line items.' }, { row: null })}
      {host('block-totals-summary', 's-bt-error', en, undefined, 'error')}
      {host('block-line-items', 's-bl-loaded', en, blockLineItemsDemoData(SEED))}
      {host('block-line-items', 's-bl-skeleton', en, undefined, 'loading')}
      {host('block-line-items', 's-bl-empty', { ...en, emptyTitle: 'No line items', emptyBody: 'Add a line item to bill for work on this document.' }, { rows: [], total: 0 })}
      {host('block-line-items', 's-bl-error', en, undefined, 'error')}
    </Frame>
  ),
};

// --- grouped block galleries -------------------------------------------------

/** Every block in one capture, so a spacing/type-scale drift shows up at a glance. */
function financialGallery(config: Record<string, unknown>, suffix: string) {
  return [
    host('block-line-items', `s-fin-li-${suffix}`, config, blockLineItemsDemoData(SEED)),
    host('block-totals-summary', `s-fin-ts-${suffix}`, config, blockTotalsSummaryDemoData(SEED)),
    host('block-tax-breakdown', `s-fin-tb-${suffix}`, config, blockTaxBreakdownDemoData(SEED)),
    host('block-multi-currency', `s-fin-mc-${suffix}`, config, blockMultiCurrencyDemoData(SEED)),
    host('block-payment-history', `s-fin-ph-${suffix}`, config, blockPaymentHistoryDemoData(SEED)),
    host('block-discount-codes', `s-fin-dc-${suffix}`, config, blockDiscountCodesDemoData(SEED)),
    host('block-late-fees', `s-fin-lf-${suffix}`, config, blockLateFeesDemoData(SEED)),
    host('block-qr-pay', `s-fin-qr-${suffix}`, config, blockQrPayDemoData(SEED)),
  ];
}

function reportGallery(config: Record<string, unknown>, suffix: string) {
  return [
    host('block-kpi-row', `s-rep-kpi-${suffix}`, config, blockKpiRowDemoData(SEED)),
    host('block-bar-chart', `s-rep-bar-${suffix}`, config, blockBarChartDemoData(SEED)),
    host('block-line-chart', `s-rep-line-${suffix}`, config, blockLineChartDemoData(SEED)),
    host('block-two-col-table', `s-rep-2c-${suffix}`, config, blockTwoColTableDemoData(SEED)),
    host('block-attachments', `s-rep-att-${suffix}`, config, blockAttachmentsDemoData(SEED)),
    host('block-image-placeholder', `s-rep-img-${suffix}`, config, blockImagePlaceholderDemoData(SEED)),
  ];
}

function statusGallery(config: Record<string, unknown>, suffix: string) {
  return [
    host('block-loyalty-banner', `s-st-loy-${suffix}`, config, blockLoyaltyBannerDemoData(SEED)),
    host('block-recurring-banner', `s-st-rec-${suffix}`, config, blockRecurringBannerDemoData(SEED)),
    host('block-delivery-stepper', `s-st-del-${suffix}`, config, blockDeliveryStepperDemoData(SEED)),
    host('block-signature', `s-st-sig-${suffix}`, config, blockSignatureDemoData(SEED)),
    host('block-terms-checkbox', `s-st-terms-${suffix}`, config, blockTermsCheckboxDemoData(SEED)),
    host('block-approval', `s-st-app-${suffix}`, config, blockApprovalDemoData(SEED)),
  ];
}

function contentGallery(config: Record<string, unknown>, suffix: string) {
  return [
    host('block-contact', `s-ct-con-${suffix}`, config, blockContactDemoData(SEED)),
    host('block-highlight-box', `s-ct-hl-${suffix}`, config, blockHighlightBoxDemoData(SEED)),
  ];
}

export const FinancialBlocks = {
  name: 'blocks — financial (8)',
  render: () => <Frame>{financialGallery(en, 'l')}</Frame>,
};

export const ReportBlocks = {
  name: 'blocks — report (6)',
  render: () => <Frame>{reportGallery(en, 'l')}</Frame>,
};

export const StatusBlocks = {
  name: 'blocks — status (6)',
  render: () => <Frame>{statusGallery(en, 'l')}</Frame>,
};

export const ContentBlocks = {
  name: 'blocks — content (2)',
  render: () => <Frame>{contentGallery(en, 'l')}</Frame>,
};

// --- light/dark × LTR/RTL matrix (acceptance #9) ------------------------------

export const CanvasLightLtr = {
  name: 'document-canvas — light · LTR',
  render: () => <Frame>{host('document-canvas', 's-dc-l-ltr', canvasConfig, docData, 'success', 'w-[40rem]')}</Frame>,
};

export const CanvasDarkLtr = {
  name: 'document-canvas — dark · LTR',
  render: () => <Frame dark>{host('document-canvas', 's-dc-d-ltr', canvasConfig, docData, 'success', 'w-[40rem]')}</Frame>,
};

/**
 * The document genuinely flips: the issued/due column and the reorder controls
 * ride the opposite edge. The up/down chevrons must NOT swap meaning — they are
 * block-axis controls, and a capture where they mirrored is the regression.
 */
export const CanvasLightRtl = {
  name: 'document-canvas — light · RTL (paper mirrors, reorder axis does not)',
  render: () => <Frame dir="rtl">{host('document-canvas', 's-dc-l-rtl', canvasAr, docData, 'success', 'w-[40rem]')}</Frame>,
};

export const CanvasDarkRtl = {
  name: 'document-canvas — dark · RTL (paper mirrors, reorder axis does not)',
  render: () => (
    <Frame dark dir="rtl">
      {host('document-canvas', 's-dc-d-rtl', canvasAr, docData, 'success', 'w-[40rem]')}
    </Frame>
  ),
};

/** Money rows mirror: label at the inline start, mono figure at the inline end. */
export const FinancialBlocksLightRtl = {
  name: 'blocks — financial · light · RTL (money rows mirror)',
  render: () => <Frame dir="rtl">{financialGallery(ar, 'l-rtl')}</Frame>,
};

/** The QR tile stays forced-light in dark mode — a dark QR would not scan. */
export const FinancialBlocksDarkRtl = {
  name: 'blocks — financial · dark · RTL (QR tile stays light)',
  render: () => (
    <Frame dark dir="rtl">
      {financialGallery(ar, 'd-rtl')}
    </Frame>
  ),
};

export const FinancialBlocksDarkLtr = {
  name: 'blocks — financial · dark · LTR',
  render: () => <Frame dark>{financialGallery(en, 'd-ltr')}</Frame>,
};

export const ReportBlocksDarkLtr = {
  name: 'blocks — report · dark · LTR',
  render: () => <Frame dark>{reportGallery(en, 'd-ltr')}</Frame>,
};

/** The mini charts mirror as a whole; the bars keep their reading order. */
export const ReportBlocksLightRtl = {
  name: 'blocks — report · light · RTL',
  render: () => <Frame dir="rtl">{reportGallery(ar, 'l-rtl')}</Frame>,
};

export const ReportBlocksDarkRtl = {
  name: 'blocks — report · dark · RTL',
  render: () => (
    <Frame dark dir="rtl">
      {reportGallery(ar, 'd-rtl')}
    </Frame>
  ),
};

export const StatusBlocksDarkLtr = {
  name: 'blocks — status · dark · LTR',
  render: () => <Frame dark>{statusGallery(en, 'd-ltr')}</Frame>,
};

/** The stepper's connector and the callout icons ride the inline axis: all mirror. */
export const StatusBlocksLightRtl = {
  name: 'blocks — status · light · RTL (stepper + callouts mirror)',
  render: () => <Frame dir="rtl">{statusGallery(ar, 'l-rtl')}</Frame>,
};

export const StatusBlocksDarkRtl = {
  name: 'blocks — status · dark · RTL',
  render: () => (
    <Frame dark dir="rtl">
      {statusGallery(ar, 'd-rtl')}
    </Frame>
  ),
};

export const ContentBlocksDarkLtr = {
  name: 'blocks — content · dark · LTR',
  render: () => <Frame dark>{contentGallery(en, 'd-ltr')}</Frame>,
};

export const ContentBlocksLightRtl = {
  name: 'blocks — content · light · RTL',
  render: () => <Frame dir="rtl">{contentGallery(ar, 'l-rtl')}</Frame>,
};

export const ContentBlocksDarkRtl = {
  name: 'blocks — content · dark · RTL',
  render: () => (
    <Frame dark dir="rtl">
      {contentGallery(ar, 'd-rtl')}
    </Frame>
  ),
};
