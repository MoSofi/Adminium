// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The commerce & data families (comp 537, 541-542, 551-557): Box, Stats,
 * Product, TitledRows (multi-currency, tax breakdown), Recurring, Discount,
 * Payhistory, Loyalty, Delivery, and Contact from the legal group. Mono
 * figures are the comp's; the accent rides `--adm-email-accent`.
 */
import { Award, Check, Mail, Package, Phone, Repeat, UserRound } from 'lucide-react';
import { cn } from '@adminium/ui';

import { t } from '../../../../i18n/t.js';
import { KICKER, money, num, rows, str } from '../styles.js';
import type { BlockPreviewProps } from './types.js';

function Kicker({ text }: { text: string }) {
  return text === '' ? null : <div className={cn(KICKER, 'mb-2')}>{text}</div>;
}

export function BoxPreview({ block }: BlockPreviewProps) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[10px] border border-[#ececef] bg-[#fafafa] px-4 py-3.5 text-[#55555f]">
      <span className="text-[12.5px] font-semibold">{str(block.data['label'])}</span>
      <span className="font-mono text-[18px] font-extrabold">{str(block.data['value'])}</span>
    </div>
  );
}

export function StatsPreview({ block }: BlockPreviewProps) {
  const stats = rows<{ value?: unknown; label?: unknown }>(block.data['stats']);
  return (
    <div className="flex gap-[9px]">
      {stats.map((stat, index) => (
        <div key={index} className="min-w-0 flex-1 rounded-[10px] border border-[#ececef] bg-[#fafafa] px-2 py-3 text-center">
          <div className={cn('font-mono font-extrabold text-[#17171c]', stats.length > 3 ? 'text-[15px]' : 'text-[18px]')}>{str(stat.value)}</div>
          <div className="mt-[3px] text-[10.5px] text-[#6b6b76]">{str(stat.label)}</div>
        </div>
      ))}
    </div>
  );
}

export function ProductPreview({ block }: BlockPreviewProps) {
  const items = rows<{ name?: unknown; meta?: unknown; qty?: unknown; price?: unknown }>(block.data['items']);
  return (
    <div className="flex flex-col gap-[9px]">
      {items.map((item, index) => (
        <div key={index} className="flex items-center gap-[11px] rounded-[10px] border border-[#ececef] px-[11px] py-2.5">
          <div className="flex size-[34px] shrink-0 items-center justify-center rounded-lg bg-[#f1f1f4]">
            <Package className="size-4 opacity-50" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-bold text-[#17171c]">{str(item.name)}</div>
            <div className="text-[10.5px] text-[#6b6b76]">{str(item.meta)}</div>
          </div>
          <span className="font-mono text-[11.5px] text-[#6b6b76]">{str(item.qty)}</span>
          <span className="font-mono text-[12.5px] font-bold text-[#17171c]">{str(item.price)}</span>
        </div>
      ))}
    </div>
  );
}

function RowsTable({ entries }: { entries: { label: string; amount: string }[] }) {
  return (
    <div className="overflow-hidden rounded-[10px] border border-[#ececef]">
      {entries.map((entry, index) => (
        <div key={index} className="flex items-center justify-between border-b border-[#ececef] px-[13px] py-[9px] last:border-b-0">
          <span className="text-[12px] text-[#55555f]">{entry.label}</span>
          <span className="font-mono text-[12.5px] font-bold text-[#17171c]">{entry.amount}</span>
        </div>
      ))}
    </div>
  );
}

export function TitledRowsPreview({ block }: BlockPreviewProps) {
  const entries =
    block.block === 'email.multi-currency'
      ? rows<{ code?: unknown; sym?: unknown; rate?: unknown }>(block.data['fx']).map((fx) => ({
          label: str(fx.code),
          amount: `${str(fx.sym)}${money(num(block.data['amount'], 0) * num(fx.rate, 0))}`,
        }))
      : rows<{ label?: unknown; amount?: unknown }>(block.data['lines']).map((line) => ({ label: str(line.label), amount: str(line.amount) }));
  return (
    <>
      <Kicker text={str(block.data['kicker'])} />
      <RowsTable entries={entries} />
    </>
  );
}

export function RecurringPreview({ block }: BlockPreviewProps) {
  return (
    <div className="flex items-center gap-[11px] rounded-[10px] border border-[#ececef] bg-[#fafafa] px-[15px] py-[13px]">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--adm-email-accent)] text-white">
        <Repeat className="size-4" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-extrabold text-[#17171c]">
          {t('email:canvas.recurring', 'Recurring — {freq}', { freq: str(block.data['freq']) })}
        </div>
        <div className="mt-0.5 text-[11.5px] text-[#55555f]">
          {t('email:canvas.nextOn', 'Next on {next} · {note}', { next: str(block.data['next']), note: str(block.data['note']) })}
        </div>
      </div>
    </div>
  );
}

export function DiscountPreview({ block }: BlockPreviewProps) {
  const codes = rows<{ code?: unknown; label?: unknown; amount?: unknown }>(block.data['codes']);
  return (
    <>
      <Kicker text={str(block.data['kicker'])} />
      <div className="flex flex-col gap-[7px]">
        {codes.map((row, index) => (
          <div key={index} className="flex items-center gap-2.5 rounded-[9px] border border-[#ececef] px-[11px] py-2">
            <span className="shrink-0 rounded-md bg-[color-mix(in_srgb,var(--adm-email-accent)_12%,transparent)] px-2 py-[3px] font-mono text-[11px] font-extrabold text-[var(--adm-email-accent)]">
              {str(row.code)}
            </span>
            <span className="min-w-0 flex-1 text-[12px] text-[#55555f]">{str(row.label)}</span>
            <span className="font-mono text-[12.5px] font-bold text-[#0b7d59]">{str(row.amount)}</span>
          </div>
        ))}
      </div>
    </>
  );
}

export function PayHistoryPreview({ block }: BlockPreviewProps) {
  const items = rows<{ date?: unknown; method?: unknown; amount?: unknown; status?: unknown }>(block.data['items']);
  return (
    <>
      <Kicker text={str(block.data['kicker'])} />
      <div className="flex flex-col gap-[7px]">
        {items.map((item, index) => (
          <div key={index} className="flex items-center gap-[11px] rounded-[9px] border border-[#ececef] px-[11px] py-[9px]">
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-bold text-[#17171c]">{str(item.date)}</div>
              <div className="text-[10.5px] text-[#6b6b76]">{str(item.method)}</div>
            </div>
            <span className="font-mono text-[12.5px] font-bold text-[#17171c]">{str(item.amount)}</span>
            <span className="inline-flex shrink-0 items-center rounded-[20px] bg-[#e6f5ee] px-[9px] py-0.5 text-[10px] font-bold capitalize text-[#0b7d59]">
              {str(item.status) === '' ? 'paid' : str(item.status)}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

export function ContactPreview({ block }: BlockPreviewProps) {
  return (
    <>
      <Kicker text={str(block.data['kicker'])} />
      <div className="flex flex-col gap-[7px]">
        <div className="flex items-center gap-2.5">
          <UserRound className="size-3.5 text-[#6b6b76]" aria-hidden="true" />
          <span className="text-[12.5px] font-bold text-[#17171c]">{str(block.data['name'])}</span>
        </div>
        <div className="flex items-center gap-2.5">
          <Mail className="size-3.5 text-[#6b6b76]" aria-hidden="true" />
          <span className="font-mono text-[12.5px] text-[#55555f]">{str(block.data['email'])}</span>
        </div>
        <div className="flex items-center gap-2.5">
          <Phone className="size-3.5 text-[#6b6b76]" aria-hidden="true" />
          <span className="font-mono text-[12.5px] text-[#55555f]">{str(block.data['phone'])}</span>
        </div>
      </div>
    </>
  );
}

export function LoyaltyPreview({ block }: BlockPreviewProps) {
  return (
    <div className="flex items-center gap-[13px] rounded-[11px] bg-[color-mix(in_srgb,var(--adm-email-accent)_10%,transparent)] px-[15px] py-[13px]">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-[var(--adm-email-accent)] text-white">
        <Award className="size-[19px]" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10.5px] font-bold uppercase tracking-[.05em] text-[var(--adm-email-accent)]">
          {t('email:canvas.loyaltyBalance', 'Loyalty balance')}
        </div>
        <div className="font-mono text-[16px] font-extrabold text-[#17171c]">
          {t('email:canvas.loyaltyLine', '{balance} pts · {level}', {
            balance: num(block.data['balance'], 0).toLocaleString('en-US'),
            level: str(block.data['level']),
          })}
        </div>
      </div>
      {/* Darker than the pay badge's green: this figure sits on the accent tint, where `#0b7d59` is 4.3:1. */}
      <span className="font-mono text-[12.5px] font-extrabold text-[#0a6a4b]">+{num(block.data['earned'], 0).toLocaleString('en-US')}</span>
    </div>
  );
}

export function DeliveryPreview({ block }: BlockPreviewProps) {
  const steps = rows<{ label?: unknown; status?: unknown }>(block.data['steps']);
  return (
    <>
      <Kicker text={str(block.data['kicker'])} />
      <div className="relative flex justify-between">
        <div className="absolute inset-x-[22px] top-[11px] h-0.5 bg-[#ececef]" aria-hidden="true" />
        {steps.map((step, index) => {
          const done = step.status === 'done';
          const current = step.status === 'current';
          return (
            <div key={index} className="relative z-[1] flex flex-1 flex-col items-center gap-2">
              <div
                className={cn(
                  'flex size-[22px] shrink-0 items-center justify-center rounded-full',
                  done
                    ? 'bg-[var(--adm-email-accent)] text-white'
                    : current
                      ? 'border-2 border-[var(--adm-email-accent)] bg-white text-[var(--adm-email-accent)]'
                      : 'border-2 border-[#e2e2e8] bg-white text-[#6b6b76]',
                )}
              >
                {done ? <Check className="size-3" aria-hidden="true" /> : null}
              </div>
              <span className={cn('text-center text-[10.5px]', done || current ? 'font-bold text-[#17171c]' : 'font-semibold text-[#6b6b76]')}>
                {str(step.label)}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}
