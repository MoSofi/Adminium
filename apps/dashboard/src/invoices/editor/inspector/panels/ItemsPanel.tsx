// SPDX-License-Identifier: AGPL-3.0-only
/** The Line items panel (comp 835-840; 34 Appendix E §I6): the count + subtotal card, the accent *Add line item*, and the hand hint. */
import { Hand, Plus } from 'lucide-react';
import { cn } from '@adminium/ui';

import { t } from '../../../../i18n/t.js';
import { formatMoney } from '../../../model/money.js';
import { FOCUS, Hint } from '../parts.js';
import type { PanelProps } from '../panelProps.js';

export function ItemsPanel({ draft, edits, totals }: PanelProps) {
  const body = draft.body;
  return (
    <div className="flex flex-col gap-[14px]">
      <div className="rounded-xl border border-border bg-surface-2 p-[13px]">
        <div className="mb-[6px] flex justify-between text-[12px]">
          <span className="text-fg-muted">{t('invoices:inspector.items.count', 'Line items')}</span>
          <span data-testid="invoices-items-count" className="font-extrabold text-fg tabular-nums">
            {body.items.length}
          </span>
        </div>
        <div className="flex justify-between text-[12px]">
          <span className="text-fg-muted">{t('invoices:inspector.items.subtotal', 'Subtotal')}</span>
          <span data-testid="invoices-items-subtotal" className="font-mono font-extrabold text-fg tabular-nums">
            {formatMoney(totals.subtotal, body.currency, body.cents)}
          </span>
        </div>
      </div>
      <button type="button" data-testid="invoices-add-item" onClick={() => edits.addItem()} className={cn('flex items-center justify-center gap-[7px] rounded-[10px] border-0 bg-accent p-[10px] text-[12.5px] font-bold text-accent-fg transition-colors hover:bg-accent-hover', FOCUS)}>
        <Plus className="size-[15px]" aria-hidden="true" />
        {t('invoices:inspector.items.add', 'Add line item')}
      </button>
      <Hint icon={Hand}>{t('invoices:inspector.items.hint', 'Edit any cell directly on the invoice, or drag the handle to reorder.')}</Hint>
    </div>
  );
}
