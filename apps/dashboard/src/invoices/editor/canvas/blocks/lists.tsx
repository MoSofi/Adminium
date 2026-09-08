// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The row-list blocks (comp 496-503, 558-566, 584-589, 594-599, 604-609;
 * 34-invoices-add-on.md Appendix F B9, B14, B16-B18): `attachments` —
 * surface-2 chips with the paperclip, the name and the mono size;
 * `multicurrency` — *Also payable in*, a bordered table of code · converted
 * amount and the *Converted from…* note; `discount` — code pill, label and
 * the amount off in the positive green; `taxbreak` — label · rate · amount;
 * `payhistory` — date, method, amount and the status badge.
 *
 * Every amount is `money.ts`': the multi-currency figure is the
 * ladder's total times the typed rate (comp 1698, `fxMinor`) printed with
 * the row's own symbol and two decimals; each tax component is computed on
 * the SAME base as the ladder — `totals.taxBase`, not the comp's undiscounted
 * subtotal (1709) — so a sheet with both blocks on prints one tax figure
 * (O25). The rows are read-only here; the inspector's row editors own them.
 */
import { Paperclip } from 'lucide-react';
import { cn } from '@adminium/ui';

import { t } from '../../../../i18n/t.js';
import { fxMinor, formatMoney, formatPercent, parseMinor, taxBreakdown } from '../../../model/money.js';
import { ACCENT_SOFT_BG, ACCENT_TEXT, KICKER, Region, STATUS_TONE, statusText } from '../inline.js';
import type { BlockProps } from './types.js';

const CHIP = 'flex items-center gap-2.5 rounded-[10px] border border-[#ececef] bg-[#fafafa] px-3 py-[9px]';
const TABLE = 'overflow-hidden rounded-[11px] border border-[#ececef]';
const TABLE_ROW = 'flex items-center border-b border-[#ececef] px-[13px] py-[9px] last:border-b-0';

export function AttachmentsBlock({ body, section, onSelect }: BlockProps) {
  return (
    <Region section="attachments" selected={section} onSelect={onSelect}>
      <div className={`${KICKER} mb-[9px]`}>{t('invoices:canvas.attachments', 'Attachments')}</div>
      <div className="flex flex-col gap-2">
        {body.attachments.map((file, index) => (
          <div key={index} data-testid="invoices-attachment" className={CHIP}>
            <Paperclip className="size-[15px] shrink-0 text-[#6b6b76]" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">{file.name}</span>
            <span className="font-mono text-[11px] text-[#6b6b76]">{file.size}</span>
          </div>
        ))}
      </div>
    </Region>
  );
}

/** The comp's row figure (1698): the symbol before the converted total, two decimals, `en-US` grouping. */
export function fxText(sym: string, totalMinor: number, rate: string): string {
  const figure = (fxMinor(totalMinor, rate) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sym}${figure}`;
}

export function MulticurrencyBlock({ body, totals, section, onSelect }: BlockProps) {
  return (
    <Region section="multicurrency" selected={section} onSelect={onSelect}>
      <div className={`${KICKER} mb-2`}>{t('invoices:canvas.multicurrency.title', 'Also payable in')}</div>
      <div className={TABLE}>
        {body.fx.map((row, index) => (
          <div key={index} data-testid="invoices-fx-row" className={cn(TABLE_ROW, 'justify-between')}>
            <span className="text-[12px] font-bold text-[#6b6b76]">{row.code}</span>
            <span className="font-mono text-[13px] font-bold">{fxText(row.sym, totals.total, row.rate)}</span>
          </div>
        ))}
      </div>
      <div className="mt-[7px] text-[10.5px] text-[#6b6b76]">
        {t('invoices:canvas.multicurrency.note', 'Converted from {total} at indicative rates.', { total: formatMoney(totals.total, body.currency, body.cents) })}
      </div>
    </Region>
  );
}

export function DiscountBlock({ body, section, onSelect }: BlockProps) {
  return (
    <Region section="discount" selected={section} onSelect={onSelect}>
      <div className={`${KICKER} mb-[9px]`}>{t('invoices:canvas.discount.title', 'Discount codes')}</div>
      <div className="flex flex-col gap-2">
        {body.discCodes.map((code, index) => (
          <div key={index} data-testid="invoices-discount-code" className={CHIP}>
            <span className={cn('rounded-md px-2 py-[3px] font-mono text-[11px] font-extrabold', ACCENT_SOFT_BG, ACCENT_TEXT)}>{code.code}</span>
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-[#6b6b76]">{code.label}</span>
            <span className="font-mono text-[13px] font-bold text-pos">{`−${formatMoney(parseMinor(code.amount), body.currency, body.cents)}`}</span>
          </div>
        ))}
      </div>
    </Region>
  );
}

export function TaxbreakBlock({ body, totals, section, onSelect }: BlockProps) {
  const rows = taxBreakdown(totals.taxBase, body.taxLines);
  return (
    <Region section="taxbreak" selected={section} onSelect={onSelect}>
      <div className={`${KICKER} mb-2`}>{t('invoices:canvas.taxbreak.title', 'Tax breakdown')}</div>
      <div className={TABLE}>
        {rows.map((row, index) => (
          <div key={index} data-testid="invoices-tax-line" className={TABLE_ROW}>
            <span className="flex-1 text-[12px] text-[#6b6b76]">{row.label}</span>
            <span className="me-3.5 font-mono text-[11.5px] text-[#6b6b76]">{formatPercent(row.rate)}</span>
            <span data-testid="invoices-tax-line-amount" className="font-mono text-[13px] font-bold">
              {formatMoney(row.amount, body.currency, body.cents)}
            </span>
          </div>
        ))}
      </div>
    </Region>
  );
}

export function PayhistoryBlock({ body, section, onSelect }: BlockProps) {
  return (
    <Region section="payhistory" selected={section} onSelect={onSelect}>
      <div className={`${KICKER} mb-[9px]`}>{t('invoices:canvas.payhistory.title', 'Payment history')}</div>
      <div className="flex flex-col gap-2">
        {body.payHist.map((payment, index) => (
          <div key={index} data-testid="invoices-payment" className={cn(CHIP, 'gap-3 py-2.5')}>
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-bold">{payment.date}</div>
              <div className="text-[11px] text-[#6b6b76]">{payment.method}</div>
            </div>
            <span className="font-mono text-[13px] font-bold">{payment.amount}</span>
            <span className={cn('inline-flex shrink-0 items-center rounded-[20px] px-[9px] py-0.5 text-[10px] font-bold', STATUS_TONE[payment.status])}>{statusText(payment.status)}</span>
          </div>
        ))}
      </div>
    </Region>
  );
}
