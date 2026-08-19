// SPDX-License-Identifier: AGPL-3.0-only
import { IconButton, MonoText } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { ComponentType, ReactElement } from 'react';
import type { z } from 'zod';

import { BlockEmpty } from './BlockShell.js';
import {
  BlockDiscountCodesWidget,
  BlockLateFeesWidget,
  BlockLineItemsWidget,
  BlockMultiCurrencyWidget,
  BlockPaymentHistoryWidget,
  BlockQrPayWidget,
  BlockTaxBreakdownWidget,
  BlockTotalsSummaryWidget,
} from './BlockFinancial.js';
import { BlockContactWidget, BlockHighlightBoxWidget } from './BlockContent.js';
import {
  BlockAttachmentsWidget,
  BlockBarChartWidget,
  BlockImagePlaceholderWidget,
  BlockKpiRowWidget,
  BlockLineChartWidget,
  BlockTwoColTableWidget,
} from './BlockReport.js';
import {
  BlockApprovalWidget,
  BlockDeliveryStepperWidget,
  BlockLoyaltyBannerWidget,
  BlockRecurringBannerWidget,
  BlockSignatureWidget,
  BlockTermsCheckboxWidget,
} from './BlockStatus.js';
import {
  blockDataOf,
  blockOrderOf,
  docTypeOf,
  formatBlockDate,
  moveBlock,
} from './block-lib.js';
import {
  BLOCK_LABEL_KEY,
  humanizeBlockId,
  blockApprovalConfigSchema,
  blockAttachmentsConfigSchema,
  blockBarChartConfigSchema,
  blockContactConfigSchema,
  blockDeliveryStepperConfigSchema,
  blockDiscountCodesConfigSchema,
  blockHighlightBoxConfigSchema,
  blockImagePlaceholderConfigSchema,
  blockKpiRowConfigSchema,
  blockLateFeesConfigSchema,
  blockLineChartConfigSchema,
  blockLineItemsConfigSchema,
  blockLoyaltyBannerConfigSchema,
  blockMultiCurrencyConfigSchema,
  blockPaymentHistoryConfigSchema,
  blockQrPayConfigSchema,
  blockRecurringBannerConfigSchema,
  blockSignatureConfigSchema,
  blockTaxBreakdownConfigSchema,
  blockTermsCheckboxConfigSchema,
  blockTotalsSummaryConfigSchema,
  blockTwoColTableConfigSchema,
  documentCanvasConfigSchema,
  documentCanvasDemoData,
} from './blocks-config.js';
import type { DocumentCanvasConfig } from './blocks-config.js';
import { rowOf } from './block-lib.js';
import type { BlockId } from './block-lib.js';
import type { DocBlockInstance, DocRecord } from './block-types.js';
import type { WidgetEvent, WidgetProps } from '../../registry/types.js';

export { documentCanvasConfigSchema, documentCanvasDemoData };
export type { DocumentCanvasConfig };

/**
 * `document-canvas` (annex §13) — the WYSIWYG paper-styled document editor
 * (invoice/report/email) behind the Invoice Builder, Report Builder and Email
 * Templates comps: an ordered list of block instances on a paper surface, each
 * click-to-select with an accent outline, each reorderable and removable, with
 * live-recomputing totals and the doc's ~20 boolean show-flags applied.
 *
 * REORDER IS BUTTON-DRIVEN, NOT POINTER-DRAGGED. The annex describes the blocks
 * as "drag-reorderable", and the obvious reach is the dnd-kit layer the boards
 * family already uses — but the chunk-budget gate CONFINES that dependency to
 * `families/boards` so it never lands in a sibling family's chunk (04 §2.3), and
 * a document canvas is not worth breaking that boundary for. Move up/down
 * IconButtons are also strictly better here on the merits: they are keyboard-
 * reachable and screen-reader-announceable with no drag sensor, no live region
 * and no keyboard-coordinate emulation. The ordering itself is the pure
 * `moveBlock` index algebra, so a pointer layer the page-builder page owns can
 * drive the SAME `onReorder` callback without touching this component.
 *
 * RTL: the up/down controls are on the BLOCK axis, which never mirrors — `up` is
 * up in every locale. Everything horizontal (the paper header, the block rail)
 * is logical-only, so the canvas mirrors correctly under `dir="rtl"` while the
 * reorder semantics stay put.
 *
 * STATE: selection is local (a canvas is useless without it), but the block
 * ORDER is not — the page-builder page owns persistence, so reorder/remove emit
 * `mutate` intents and the order re-enters through `data`. The local order state
 * exists only to keep the interaction responsive; a host that persists will
 * re-render with the committed order.
 */

/**
 * What the canvas hands a nested block, before the block's OWN schema resolves
 * it into that block's config.
 *
 * ONLY `format` rides along. A block reads ~64 config fields the canvas schema
 * has never heard of (`descField`, `showAmountColumn`, `modules`, `maxRows`, …),
 * so its config has to come from ITS OWN schema's defaults — handing it the
 * canvas's config bag instead leaves every one of them `undefined`, which is a
 * blank description column, a `$0.00` total and a `viewBox="0 0 undefined
 * undefined"` QR tile. The rest of the canvas's bag is deliberately NOT
 * inherited either: `testId` would duplicate an id across 22 blocks,
 * `emptyTitle`/`emptyBody` are the canvas's own doc-level copy, and `binding`
 * names the DOCUMENT table — a line-item edit sent there would address the wrong
 * rows, so the blocks stay unbound (and correctly emit nothing) until the
 * page-builder host binds them itself.
 */
type BlockBaseConfig = Pick<DocumentCanvasConfig, 'format'>;

interface BlockRenderProps {
  base: BlockBaseConfig;
  data: unknown;
  instanceId: string;
  onEvent: (event: WidgetEvent) => void | Promise<unknown>;
}

/**
 * Pair one block component with its OWN config schema. Generic in `C`, so the
 * compiler checks that the schema on the right produces the config the component
 * on the left demands — the pairing that a `config={config as never}` cast is
 * exactly what silences.
 */
function blockRenderer<C>(
  Component: ComponentType<WidgetProps<C>>,
  schema: z.ZodType<C>,
): (props: BlockRenderProps) => ReactElement {
  return function Block({ base, data, instanceId, onEvent }: BlockRenderProps) {
    return <Component config={schema.parse(base)} data={data} instanceId={instanceId} onEvent={onEvent} />;
  };
}

/** Block registry id → the component that renders it (one lazy chunk, 04 §2.3). */
const BLOCK_COMPONENTS: Record<BlockId, (props: BlockRenderProps) => ReactElement> = {
  'block-totals-summary': blockRenderer(BlockTotalsSummaryWidget, blockTotalsSummaryConfigSchema),
  'block-line-items': blockRenderer(BlockLineItemsWidget, blockLineItemsConfigSchema),
  'block-kpi-row': blockRenderer(BlockKpiRowWidget, blockKpiRowConfigSchema),
  'block-bar-chart': blockRenderer(BlockBarChartWidget, blockBarChartConfigSchema),
  'block-line-chart': blockRenderer(BlockLineChartWidget, blockLineChartConfigSchema),
  'block-two-col-table': blockRenderer(BlockTwoColTableWidget, blockTwoColTableConfigSchema),
  'block-tax-breakdown': blockRenderer(BlockTaxBreakdownWidget, blockTaxBreakdownConfigSchema),
  'block-multi-currency': blockRenderer(BlockMultiCurrencyWidget, blockMultiCurrencyConfigSchema),
  'block-payment-history': blockRenderer(BlockPaymentHistoryWidget, blockPaymentHistoryConfigSchema),
  'block-discount-codes': blockRenderer(BlockDiscountCodesWidget, blockDiscountCodesConfigSchema),
  'block-loyalty-banner': blockRenderer(BlockLoyaltyBannerWidget, blockLoyaltyBannerConfigSchema),
  'block-recurring-banner': blockRenderer(BlockRecurringBannerWidget, blockRecurringBannerConfigSchema),
  'block-qr-pay': blockRenderer(BlockQrPayWidget, blockQrPayConfigSchema),
  'block-delivery-stepper': blockRenderer(BlockDeliveryStepperWidget, blockDeliveryStepperConfigSchema),
  'block-signature': blockRenderer(BlockSignatureWidget, blockSignatureConfigSchema),
  'block-terms-checkbox': blockRenderer(BlockTermsCheckboxWidget, blockTermsCheckboxConfigSchema),
  'block-approval': blockRenderer(BlockApprovalWidget, blockApprovalConfigSchema),
  'block-attachments': blockRenderer(BlockAttachmentsWidget, blockAttachmentsConfigSchema),
  'block-late-fees': blockRenderer(BlockLateFeesWidget, blockLateFeesConfigSchema),
  'block-image-placeholder': blockRenderer(BlockImagePlaceholderWidget, blockImagePlaceholderConfigSchema),
  'block-contact': blockRenderer(BlockContactWidget, blockContactConfigSchema),
  'block-highlight-box': blockRenderer(BlockHighlightBoxWidget, blockHighlightBoxConfigSchema),
};

/** Accent token → the outline a selected block wears. */
const ACCENT_RING: Record<NonNullable<DocumentCanvasConfig['brand']>['accent'], string> = {
  accent: 'ring-accent',
  info: 'ring-info',
  pos: 'ring-pos',
  warn: 'ring-warn',
  danger: 'ring-danger',
  neutral: 'ring-border-strong',
};

function DocHeader({ doc, config, locale }: { doc: DocRecord; config: DocumentCanvasConfig; locale: string | undefined }) {
  const t = useMaybeT();
  const logo = config.brand?.logo;
  return (
    <header data-part="doc-header" className="mb-6 border-b border-border pb-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          {logo !== undefined && logo !== '' && (
            <p data-part="doc-logo" className="mb-1 text-section font-bold text-accent">
              {logo}
            </p>
          )}
          <h2 className="text-title text-fg">{doc.title ?? ''}</h2>
          {doc.number !== undefined && (
            <MonoText className="text-body-sm text-fg-subtle">{doc.number}</MonoText>
          )}
        </div>
        <dl className="text-body-sm text-end">
          {doc.issuedAt !== undefined && (
            <div className="flex justify-between gap-4">
              <dt className="text-fg-subtle">{config.issuedLabel ?? t('ui:widgets.domain.documentCanvas.issuedLabel', 'Issued')}</dt>
              <dd>
                <MonoText className="text-fg">{formatBlockDate(doc.issuedAt, locale)}</MonoText>
              </dd>
            </div>
          )}
          {doc.dueAt !== undefined && (
            <div className="flex justify-between gap-4">
              <dt className="text-fg-subtle">{config.dueLabel ?? t('ui:widgets.domain.documentCanvas.dueLabel', 'Due')}</dt>
              <dd>
                <MonoText className="text-fg">{formatBlockDate(doc.dueAt, locale)}</MonoText>
              </dd>
            </div>
          )}
        </dl>
      </div>
      <div className="mt-4 flex flex-wrap gap-8">
        {[doc.fromLines, doc.toLines].map((lines, index) =>
          Array.isArray(lines) && lines.length > 0 ? (
            <address key={index === 0 ? 'from' : 'to'} data-part={index === 0 ? 'doc-from' : 'doc-to'} className="not-italic">
              {index === 1 && (
                <p className="mb-0.5 text-micro uppercase text-fg-subtle">{config.billedToLabel ?? t('ui:widgets.domain.documentCanvas.billedToLabel', 'Billed to')}</p>
              )}
              {lines.map((line) => (
                <p key={line} className="text-body-sm text-fg-muted">
                  {line}
                </p>
              ))}
            </address>
          ) : null,
        )}
      </div>
    </header>
  );
}

export function DocumentCanvasWidget({ config, data, instanceId, onEvent }: WidgetProps<DocumentCanvasConfig>) {
  const t = useMaybeT();
  const doc = rowOf<DocRecord>(data);
  const docType = docTypeOf(doc?.docType, config.docType);
  const resolved = blockOrderOf(doc, {
    docType,
    ...(config.enabledBlocks === undefined ? {} : { enabledBlocks: config.enabledBlocks }),
  });

  // Local order/selection keep the interaction responsive; the host owns
  // persistence and re-enters the committed order through `data`.
  const [order, setOrder] = useState<DocBlockInstance[] | null>(null);
  const [selected, setSelected] = useState<string | undefined>(config.selectedBlockId);
  const blocks = order ?? resolved;

  if (doc === null) {
    return (
      <BlockEmpty
        title={config.emptyTitle ?? t('ui:widgets.domain.documentCanvas.noDocumentTitle', 'No document yet')}
        body={config.emptyBody ?? t('ui:widgets.domain.documentCanvas.noDocumentBody', 'Pick a starter template or add a block to begin.')}
      />
    );
  }

  const locale = config.format?.locale;
  const ring = ACCENT_RING[config.brand?.accent ?? 'accent'];
  // The doc's money/date formatting is a property of the DOCUMENT, so it is the
  // one thing every block inherits; everything else resolves from the block's
  // own schema (see `BlockBaseConfig`).
  const blockBase: BlockBaseConfig = config.format === undefined ? {} : { format: config.format };

  const commit = (next: DocBlockInstance[], event: WidgetEvent): void => {
    setOrder(next);
    onEvent(event);
  };

  const reorder = (index: number, delta: number): void => {
    const next = moveBlock(blocks, index, delta);
    commit(next, {
      type: 'mutate',
      intent: 'update',
      table: 'document',
      recordId: instanceId,
      values: { blockOrder: next.map((instance) => instance.block) },
    });
  };

  const remove = (index: number): void => {
    const next = blocks.filter((_, at) => at !== index);
    commit(next, {
      type: 'mutate',
      intent: 'update',
      table: 'document',
      recordId: instanceId,
      values: { blockOrder: next.map((instance) => instance.block) },
    });
  };

  return (
    <article
      data-widget="document-canvas"
      data-testid={config.testId}
      data-doc-type={docType}
      /*
        The paper surface. An `email` doc renders in the `adm-always-light`
        scope: email clients we don't control render light, so previewing one on
        a dark theme would be lying about the artifact (@adminium/tokens
        exceptions.css — "Email previews and QR tiles are ALWAYS light").
      */
      className={`h-full overflow-auto rounded-lg border border-border bg-surface p-6 ${
        docType === 'email' ? 'adm-always-light' : ''
      }`}
    >
      <DocHeader doc={doc} config={config} locale={locale} />

      {blocks.length === 0 ? (
        <BlockEmpty
          title={config.emptyTitle ?? t('ui:widgets.domain.documentCanvas.emptyTitle', 'No blocks yet')}
          body={config.emptyBody ?? t('ui:widgets.domain.documentCanvas.emptyBody', 'Add a block from the palette to build this document.')}
        />
      ) : (
        <ol data-part="block-list" aria-label={config.blockListLabel ?? t('ui:widgets.domain.documentCanvas.blockListLabel', 'Document blocks')} className="space-y-4">
          {blocks.map((instance, index) => {
            const blockId = instance.block as BlockId;
            const Block = BLOCK_COMPONENTS[blockId];
            if (Block === undefined) return null; // unknown id: never resolve arbitrarily
            const isSelected = selected === instance.id;
            return (
              <li
                key={instance.id}
                data-part="block-instance"
                data-block={instance.block}
                data-selected={isSelected}
                className="group relative"
              >
                <div
                  className={`rounded-md p-2 transition-shadow ${
                    isSelected ? `ring-2 ${ring}` : 'ring-1 ring-transparent hover:ring-border'
                  }`}
                >
                  {config.selectable ? (
                    /*
                      Click-to-select, WITHOUT an interactive role on the wrapper.

                      This used to be `role="button" tabIndex={0} aria-pressed`
                      with a key handler, on the reasoning that a real <button>
                      would nest the blocks' own inputs inside a button. That
                      reasoning was right about <button> and wrong about the
                      remedy: `role="button"` nests them just the same, and it is
                      worse than invalid markup — a screen reader announces the
                      wrapper and may never expose the line-item table or the
                      signature field inside it. That was 20 of the baseline's 24
                      `nested-interactive` fingerprints.

                      So the wrapper is now inert and selection rides the
                      dedicated control below, which is a real <button> with no
                      interactive descendants. Mouse click-to-select still works
                      through onClick; text selection inside a block works again
                      (it did not while the wrapper swallowed Space).
                    */
                    <div onClick={() => setSelected(instance.id)} className="outline-none">
                      {/*
                        The keyboard and AT path for selection, as a REAL button
                        with no interactive descendants — the idiom
                        GroupedSummaryTable already uses. It renders for every
                        selectable block, not only labelled ones, because it is
                        now the only way to select without a mouse.

                        The name is the block's own visible heading, so a sighted
                        keyboard user sees what they are about to select and a
                        voice-control user can say it. `stopPropagation` keeps the
                        wrapper's onClick from double-firing.
                      */}
                      <h3 className="mb-2 text-micro uppercase text-fg-subtle">
                        <button
                          type="button"
                          data-part="block-select"
                          aria-pressed={isSelected}
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelected(instance.id);
                          }}
                          className="rounded-sm uppercase focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                        >
                          {instance.label ?? t(BLOCK_LABEL_KEY[blockId], humanizeBlockId(blockId))}
                        </button>
                      </h3>
                      <Block base={blockBase} data={blockDataOf(instance.block, doc)} instanceId={`${instanceId}-${instance.id}`} onEvent={onEvent} />
                    </div>
                  ) : (
                    <Block base={blockBase} data={blockDataOf(instance.block, doc)} instanceId={`${instanceId}-${instance.id}`} onEvent={onEvent} />
                  )}
                </div>

                {config.reorderable && (
                  /*
                    Controls sit on the inline-end edge and are revealed on
                    hover/focus — `opacity-0` keeps them focusable, and
                    `focus-within` brings them back into view when tabbed to, so
                    they are never keyboard-unreachable.
                  */
                  <div
                    data-part="block-controls"
                    className="absolute end-1 top-1 flex gap-0.5 opacity-0 transition-opacity duration-100 group-focus-within:opacity-100 group-hover:opacity-100"
                  >
                    <IconButton
                      size="sm"
                      data-part="block-move-up"
                      label={config.moveUpLabel ?? t('ui:widgets.domain.documentCanvas.moveUpLabel', 'Move block up')}
                      disabled={index === 0}
                      onClick={() => reorder(index, -1)}
                    >
                      <ChevronUp className="size-3.5" />
                    </IconButton>
                    <IconButton
                      size="sm"
                      data-part="block-move-down"
                      label={config.moveDownLabel ?? t('ui:widgets.domain.documentCanvas.moveDownLabel', 'Move block down')}
                      disabled={index === blocks.length - 1}
                      onClick={() => reorder(index, 1)}
                    >
                      <ChevronDown className="size-3.5" />
                    </IconButton>
                    <IconButton
                      size="sm"
                      data-part="block-remove"
                      label={config.removeBlockLabel ?? t('ui:widgets.domain.documentCanvas.removeBlockLabel', 'Remove block')}
                      onClick={() => remove(index)}
                      className="hover:text-danger"
                    >
                      <Trash2 className="size-3.5" />
                    </IconButton>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </article>
  );
}
