// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The seven money-shaped blocks (comp 328, 330-334, 338): late fees,
 * multi-currency, recurring, discount codes, tax breakdown, payment history
 * and loyalty points.
 *
 * NONE OF THEM COMPUTES A TOTAL. Four of the seven look like the invoice
 * surface's blocks of the same name and differ in the fields themselves (trap
 * 3): the multi-currency block has its OWN base amount where the invoice's
 * converts the ladder total; the discount and tax amounts are free text where
 * the invoice computes them; the recurring banner prints no amount at all.
 * One multiply exists — `sym + amount × rate` — and it goes through
 * `model/numbers.ts` in integer minor units (D11).
 */
import { cn } from '@adminium/ui';

import { t } from '../../../../i18n/t.js';
import type { PaymentStatus, RecurFrequency } from '../../../model/envelope.js';
import { formatCount, formatFx, formatRatePercent, fxMinor } from '../../../model/numbers.js';
import { reportIcon } from '../../../icons.js';
import {
  DANGER_SOFT_BG,
  DANGER_TEXT,
  POS_SOFT_BG,
  POS_TEXT,
  SHEET_MUTED,
  SHEET_SUBTLE,
  WARN_SOFT_BG,
  WARN_TEXT,
} from '../inline.js';
import type { BlockBodyProps } from './types.js';

/** The comp's frequency options (659), stored as English keys and labelled here. */
export function frequencyLabel(freq: RecurFrequency): string {
  switch (freq) {
    case 'Weekly':
      return t('reportBuilder:block.recurring.freq.weekly', 'Weekly');
    case 'Monthly':
      return t('reportBuilder:block.recurring.freq.monthly', 'Monthly');
    case 'Quarterly':
      return t('reportBuilder:block.recurring.freq.quarterly', 'Quarterly');
    case 'Annually':
      return t('reportBuilder:block.recurring.freq.annually', 'Annually');
  }
}

/** The comp's payment badge (663): paid → pos, failed → danger, anything else → warn. */
export function paymentMeta(status: PaymentStatus): { label: string; text: string; soft: string } {
  switch (status) {
    case 'paid':
      return { label: t('reportBuilder:block.payhistory.paid', 'Paid'), text: POS_TEXT, soft: POS_SOFT_BG };
    case 'failed':
      return { label: t('reportBuilder:block.payhistory.failed', 'Failed'), text: DANGER_TEXT, soft: DANGER_SOFT_BG };
    case 'pending':
      return { label: t('reportBuilder:block.payhistory.pending', 'Pending'), text: WARN_TEXT, soft: WARN_SOFT_BG };
  }
}

/** 328: a warn-soft callout naming the rate and the grace period. */
export function LateFeesBlock({ block }: BlockBodyProps<'latefees'>) {
  const Glyph = reportIcon('alarm-clock');
  return (
    <div data-testid="report-block-latefees" className={cn('flex items-start gap-[11px] rounded-[11px] px-[15px] py-[13px]', WARN_SOFT_BG)}>
      <Glyph className={cn('mt-px size-[17px] shrink-0', WARN_TEXT)} aria-hidden="true" />
      <div className="min-w-0">
        <div className={cn('text-[12.5px] font-extrabold', WARN_TEXT)}>{t('reportBuilder:block.latefees.title', 'Late payment fee')}</div>
        <div className={cn('mt-0.5 text-[12px] leading-[1.55]', SHEET_MUTED)}>
          {t(
            'reportBuilder:block.latefees.sentence',
            'A late fee of {rate} per month applies to balances unpaid more than {days, plural, one {# day} other {# days}} past due.',
            { rate: formatRatePercent(block.lateRate), days: block.lateDays },
          )}
        </div>
      </div>
    </div>
  );
}

/** 330: bordered rows of code · `sym + amount × rate` in mono, two decimals (D11). */
export function MultiCurrencyBlock({ block, locale }: BlockBodyProps<'multicurrency'>) {
  const last = block.fx.length - 1;
  return (
    <div data-testid="report-block-multicurrency" className="overflow-hidden rounded-[11px] border border-[#ececef]">
      {block.fx.map((row, index) => (
        <div key={index} className={cn('flex items-center justify-between px-[13px] py-[9px]', index < last && 'border-b border-[#ececef]')}>
          <span className={cn('text-[12px] font-bold', SHEET_MUTED)}>{row.code}</span>
          <span className="font-mono text-[13px] font-bold">{formatFx(fxMinor(block.mcAmount, row.rate), row.sym, locale)}</span>
        </div>
      ))}
    </div>
  );
}

/** 331: an accent-soft banner — *Recurring — {freq}* over *Next on {next} ·
 * {count}*. No amount (trap 3). */
export function RecurringBlock({ block }: BlockBodyProps<'recurring'>) {
  const Glyph = reportIcon('repeat');
  return (
    <div data-testid="report-block-recurring" className="flex items-center gap-3 rounded-[11px] bg-[var(--adm-report-accent-soft)] px-[15px] py-[13px]">
      <div className="flex size-[34px] shrink-0 items-center justify-center rounded-[9px] bg-[var(--adm-report-accent)] text-white">
        <Glyph className="size-[17px]" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-extrabold">{t('reportBuilder:block.recurring.title', 'Recurring — {freq}', { freq: frequencyLabel(block.recurFreq) })}</div>
        <div className={cn('mt-0.5 text-[11.5px]', SHEET_MUTED)}>
          {t('reportBuilder:block.recurring.sub', 'Next on {next} · {count}', { next: block.recurNext, count: block.recurCount })}
        </div>
      </div>
    </div>
  );
}

/** 332: surface-2 rows of a mono code chip on accent-soft, a muted label, and a green amount. */
export function DiscountBlock({ block }: BlockBodyProps<'discount'>) {
  return (
    <div data-testid="report-block-discount" className="flex flex-col gap-2">
      {block.discCodes.map((row, index) => (
        <div key={index} className="flex items-center gap-2.5 rounded-[10px] border border-[#ececef] bg-[#fafafa] px-3 py-[9px]">
          <span className="rounded-md bg-[var(--adm-report-accent-soft)] px-2 py-[3px] font-mono text-[11px] font-extrabold text-[var(--adm-report-accent)]">{row.code}</span>
          <span className={cn('min-w-0 flex-1 truncate text-[12.5px]', SHEET_MUTED)}>{row.label}</span>
          <span className={cn('font-mono text-[13px] font-bold', POS_TEXT)}>{row.amount}</span>
        </div>
      ))}
    </div>
  );
}

/** 333: bordered rows of a muted label and a mono amount. */
export function TaxBreakBlock({ block }: BlockBodyProps<'taxbreak'>) {
  const last = block.taxLines.length - 1;
  return (
    <div data-testid="report-block-taxbreak" className="overflow-hidden rounded-[11px] border border-[#ececef]">
      {block.taxLines.map((row, index) => (
        <div key={index} className={cn('flex items-center justify-between px-[13px] py-[9px]', index < last && 'border-b border-[#ececef]')}>
          <span className={cn('flex-1 text-[12px]', SHEET_MUTED)}>{row.label}</span>
          <span className="font-mono text-[13px] font-bold">{row.amount}</span>
        </div>
      ))}
    </div>
  );
}

/** 334: surface-2 rows of date + method, a mono amount and a status pill. */
export function PayHistoryBlock({ block }: BlockBodyProps<'payhistory'>) {
  return (
    <div data-testid="report-block-payhistory" className="flex flex-col gap-2">
      {block.payHist.map((row, index) => {
        const meta = paymentMeta(row.status);
        return (
          <div key={index} className="flex items-center gap-3 rounded-[10px] border border-[#ececef] bg-[#fafafa] px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-bold">{row.date}</div>
              <div className={cn('text-[11px]', SHEET_SUBTLE)}>{row.method}</div>
            </div>
            <span className="font-mono text-[13px] font-bold">{row.amount}</span>
            <span
              data-testid="report-payment-status"
              data-status={row.status}
              className={cn('inline-flex shrink-0 items-center rounded-[20px] px-[9px] py-0.5 text-[10px] font-bold', meta.soft, meta.text)}
            >
              {meta.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** 338: an accent-soft banner — the balance and level in mono, the points earned in green. */
export function LoyaltyBlock({ block, locale }: BlockBodyProps<'loyalty'>) {
  const Glyph = reportIcon('award');
  return (
    <div data-testid="report-block-loyalty" className="flex items-center gap-[13px] rounded-[11px] bg-[var(--adm-report-accent-soft)] px-[15px] py-[13px]">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-[var(--adm-report-accent)] text-white">
        <Glyph className="size-[19px]" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10.5px] font-bold uppercase tracking-[.05em] text-[var(--adm-report-accent)]">
          {t('reportBuilder:block.loyalty.eyebrow', 'Loyalty balance')}
        </div>
        <div className="font-mono text-[17px] font-extrabold">
          {t('reportBuilder:block.loyalty.balance', '{balance} pts · {level}', { balance: formatCount(block.loyBalance, locale), level: block.loyLevel })}
        </div>
      </div>
      <span className={cn('font-mono text-[12.5px] font-extrabold', POS_TEXT)}>
        {t('reportBuilder:block.loyalty.earned', '+{earned}', { earned: formatCount(block.loyEarned, locale) })}
      </span>
    </div>
  );
}
