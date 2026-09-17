// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Tax & totals panel (comp 843-853): the two rate fields with a `%`
 * suffix and the ladder card — Subtotal, Discount (only when there is one,
 * green with U+2212), Tax, and the bordered *Total* in accent mono (the comp
 * already says "Total" here, 851; the canvas ladder's "Total due" is).
 */
import { t } from '../../../../i18n/t.js';
import { formatMoney, parseDecimal } from '../../../model/money.js';
import { SuffixField } from '../parts.js';
import type { PanelProps } from '../panelProps.js';

export function TaxPanel({ draft, edits, totals }: PanelProps) {
  const body = draft.body;
  const money = (minor: number) => formatMoney(minor, body.currency, body.cents);
  return (
    <div className="flex flex-col gap-4">
      <SuffixField label={t('invoices:inspector.tax.taxRate', 'Tax rate')} suffix="%" value={body.taxRate} onFocus={edits.beginEdit} onChange={(value) => edits.set('taxRate', value)} testId="invoices-tax-rate" />
      <SuffixField label={t('invoices:inspector.tax.discount', 'Discount')} suffix="%" value={body.discountRate} onFocus={edits.beginEdit} onChange={(value) => edits.set('discountRate', value)} testId="invoices-discount-rate" />
      <div data-testid="invoices-tax-ladder" className="flex flex-col gap-[9px] rounded-xl border border-border bg-surface-2 p-[14px]">
        <div className="flex justify-between text-[12.5px]">
          <span className="text-fg-muted">{t('invoices:inspector.tax.subtotal', 'Subtotal')}</span>
          <span className="font-mono font-bold text-fg tabular-nums">{money(totals.subtotal)}</span>
        </div>
        {parseDecimal(body.discountRate) > 0 ? (
          <div className="flex justify-between text-[12.5px]">
            <span className="text-fg-muted">{t('invoices:inspector.tax.discountRow', 'Discount')}</span>
            <span data-testid="invoices-tax-discount" className="font-mono font-bold text-pos tabular-nums">
              {'−'}
              {money(totals.discount)}
            </span>
          </div>
        ) : null}
        <div className="flex justify-between text-[12.5px]">
          <span className="text-fg-muted">{t('invoices:inspector.tax.tax', 'Tax')}</span>
          <span className="font-mono font-bold text-fg tabular-nums">{money(totals.tax)}</span>
        </div>
        <div className="flex items-center justify-between border-t border-border pt-[9px]">
          <span className="text-[13px] font-extrabold text-fg">{t('invoices:inspector.tax.total', 'Total')}</span>
          <span data-testid="invoices-tax-total" className="font-mono text-[16px] font-extrabold text-accent tabular-nums">
            {money(totals.total)}
          </span>
        </div>
      </div>
    </div>
  );
}
