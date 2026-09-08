// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The tinted banner blocks (comp 508-517, 536-543, 571-579, 643-651; 34-
 * invoices-add-on.md Appendix F B10, B12, B15, B22): `approval` — a
 * surface-2 card with a status-tinted icon tile, name, title and badge
 * (`apprMeta`, 1685); `latefees` — the warn-soft box with the alarm clock
 * and the one-sentence policy; `recurring` — the accent-soft banner with the
 * frequency, the next date, the count and the total; `loyalty` — the
 * accent-soft banner with the balance, the level and the points earned.
 *
 * Every figure the banners print comes from the ONE totals derivation
 * (§C10) and `money.ts`; the level is `loyLevel`, not the comp's
 * field name (34 Appendix D.2).
 */
import { AlarmClock, Award, BadgeCheck, CircleX, Clock, Repeat, type LucideIcon } from 'lucide-react';
import { cn } from '@adminium/ui';

import { t } from '../../../../i18n/t.js';
import type { ApprovalStatus } from '../../../model/envelope.js';
import { formatMoney, parseDecimal } from '../../../model/money.js';
import { ACCENT_BG, ACCENT_SOFT_BG, ACCENT_TEXT, KICKER, POS_TEXT, Region } from '../inline.js';
import type { BlockProps } from './types.js';

/** The comp's `apprMeta` (1685): label, tone classes and glyph per status. */
function approvalMeta(status: ApprovalStatus): { label: string; tile: string; badge: string; Icon: LucideIcon } {
  switch (status) {
    case 'approved':
      return { label: t('invoices:canvas.approval.approved', 'Approved'), tile: 'bg-pos-soft text-pos', badge: 'bg-pos-soft text-pos', Icon: BadgeCheck };
    case 'rejected':
      return { label: t('invoices:canvas.approval.rejected', 'Rejected'), tile: 'bg-danger-soft text-danger', badge: 'bg-danger-soft text-danger', Icon: CircleX };
    case 'pending':
      return { label: t('invoices:canvas.approval.pending', 'Pending'), tile: 'bg-warn-soft text-warn', badge: 'bg-warn-soft text-warn', Icon: Clock };
  }
}

export function ApprovalBlock({ body, section, onSelect }: BlockProps) {
  const meta = approvalMeta(body.apprStatus);
  return (
    <Region section="approval" selected={section} onSelect={onSelect}>
      <div className={`${KICKER} mb-[9px]`}>{t('invoices:canvas.approval.title', 'Approval')}</div>
      <div data-testid="invoices-approval" data-status={body.apprStatus} className="flex items-center gap-3 rounded-[11px] border border-[#ececef] bg-[#fafafa] px-3.5 py-3">
        <div className={cn('flex size-[34px] shrink-0 items-center justify-center rounded-[9px]', meta.tile)}>
          <meta.Icon className="size-[18px]" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-bold">{body.apprName}</div>
          <div className="text-[11.5px] text-[#6b6b76]">{body.apprTitle}</div>
        </div>
        <span className={cn('inline-flex shrink-0 items-center gap-[5px] rounded-[20px] px-2.5 py-[3px] text-[11px] font-bold', meta.badge)}>
          <meta.Icon className="size-3" aria-hidden="true" />
          {meta.label}
        </span>
      </div>
    </Region>
  );
}

export function LatefeesBlock({ body, section, onSelect }: BlockProps) {
  return (
    <Region section="latefees" selected={section} onSelect={onSelect}>
      <div className="flex items-start gap-[11px] rounded-[11px] bg-warn-soft px-[15px] py-[13px]">
        <AlarmClock className="mt-px size-[17px] shrink-0 text-warn" aria-hidden="true" />
        <div className="min-w-0">
          <div className="text-[12.5px] font-extrabold text-warn">{t('invoices:canvas.latefees.title', 'Late payment fee')}</div>
          <div data-testid="invoices-latefees-sentence" className="mt-0.5 text-[12px] leading-[1.55] text-[#6b6b76]">
            {t('invoices:canvas.latefees.sentence', 'A late fee of {rate}% per month applies to balances unpaid more than {days} days past the due date.', {
              rate: String(parseDecimal(body.lateRate)),
              days: String(body.lateDays),
            })}
          </div>
        </div>
      </div>
    </Region>
  );
}

export function RecurringBlock({ body, totals, section, onSelect }: BlockProps) {
  return (
    <Region section="recurring" selected={section} onSelect={onSelect}>
      <div className={cn('flex items-center gap-3 rounded-[11px] px-[15px] py-[13px]', ACCENT_SOFT_BG)}>
        <div className={cn('flex size-[34px] shrink-0 items-center justify-center rounded-[9px] text-white', ACCENT_BG)}>
          <Repeat className="size-[17px]" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-extrabold text-[#191920]">{t('invoices:canvas.recurring.title', 'Recurring — {freq}', { freq: body.recurFreq })}</div>
          <div className="mt-0.5 text-[11.5px] text-[#6b6b76]">
            {t('invoices:canvas.recurring.next', 'Next on {next} · {count}', { next: body.recurNext, count: body.recurCount })}
          </div>
        </div>
        <span data-testid="invoices-recurring-amount" className={cn('font-mono text-[13px] font-extrabold', ACCENT_TEXT)}>
          {formatMoney(totals.total, body.currency, body.cents)}
        </span>
      </div>
    </Region>
  );
}

export function LoyaltyBlock({ body, section, onSelect }: BlockProps) {
  return (
    <Region section="loyalty" selected={section} onSelect={onSelect}>
      <div className={cn('flex items-center gap-[13px] rounded-[11px] px-[15px] py-[13px]', ACCENT_SOFT_BG)}>
        <div className={cn('flex size-9 shrink-0 items-center justify-center rounded-[10px] text-white', ACCENT_BG)}>
          <Award className="size-[19px]" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className={cn('text-[10.5px] font-bold uppercase tracking-[.05em]', ACCENT_TEXT)}>{t('invoices:canvas.loyalty.title', 'Loyalty balance')}</div>
          <div data-testid="invoices-loyalty-balance" className="font-mono text-[17px] font-extrabold text-[#191920]">
            {t('invoices:canvas.loyalty.balance', '{balance} pts · {level}', { balance: body.loyBalance.toLocaleString('en-US'), level: body.loyLevel })}
          </div>
        </div>
        {/* The comp's `var(--pos)` (648) reads 4.42:1 on the 10 % accent wash behind it — `POS_TEXT` is the same green, AA-dark. */}
        <span className={cn('font-mono text-[12.5px] font-extrabold', POS_TEXT)}>{`+${body.loyEarned.toLocaleString('en-US')}`}</span>
      </div>
    </Region>
  );
}
