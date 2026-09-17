// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The picture blocks (comp 522-531, 656-664; B11, B23): `qr` — *Pay by QR*,
 * the uploaded code as a 96 px tile or the comp's white placeholder tile
 * with the 74 px glyph, the caption and *Amount due · {total}*; `delivery` —
 * the stepper: a 2 px rail behind 22 px dots (done = accent + check, current
 * = accent ring, todo = grey ring) with their labels.
 *
 * The QR placeholder keeps the comp's literal white tile and near-black
 * glyph (528) on purpose: the sheet is always light (S6) and a QR needs
 * dark-on-light contrast (S5) — it is the one element the comp draws that
 * refuses the editor's theme, and here the whole sheet does.
 */
import { Check, QrCode } from 'lucide-react';
import { cn } from '@adminium/ui';

import { t } from '../../../../i18n/t.js';
import { formatMoney } from '../../../model/money.js';
import { ACCENT_BG, KICKER, Region } from '../inline.js';
import type { BlockProps } from './types.js';

export function QrBlock({ body, totals, section, onSelect }: BlockProps) {
  return (
    <Region section="qr" selected={section} onSelect={onSelect}>
      <div className={`${KICKER} mb-[9px]`}>{t('invoices:canvas.qr.title', 'Pay by QR')}</div>
      <div className="flex items-center gap-4">
        {body.qrImage === '' ? (
          <div data-testid="invoices-qr-placeholder" className="flex size-24 shrink-0 items-center justify-center rounded-xl border border-[#e2e2e8] bg-white">
            <QrCode className="size-[74px] text-[#111111]" aria-hidden="true" />
          </div>
        ) : (
          <img src={body.qrImage} alt="" data-testid="invoices-qr-image" className="size-24 shrink-0 rounded-xl border border-[#ececef] object-cover" />
        )}
        <div className="min-w-0">
          <div className="text-[13.5px] font-bold text-[#191920]">{body.qrCaption}</div>
          <div data-testid="invoices-qr-due" className="mt-1 font-mono text-[12px] text-[#6b6b76]">
            {t('invoices:canvas.qr.due', 'Amount due · {total}', { total: formatMoney(totals.total, body.currency, body.cents) })}
          </div>
        </div>
      </div>
    </Region>
  );
}

export function DeliveryBlock({ body, section, onSelect }: BlockProps) {
  return (
    <Region section="delivery" selected={section} onSelect={onSelect}>
      <div className={`${KICKER} mb-3.5`}>{t('invoices:canvas.delivery.title', 'Delivery timeline')}</div>
      <div className="relative flex justify-between">
        <div className="absolute inset-x-[22px] top-[11px] h-0.5 bg-[#ececef]" aria-hidden="true" />
        {body.delSteps.map((step, index) => {
          const done = step.status === 'done';
          const current = step.status === 'current';
          return (
            <div key={index} data-testid="invoices-delivery-step" data-status={step.status} className="relative z-[1] flex flex-1 flex-col items-center gap-2">
              <div
                className={cn(
                  'flex size-[22px] shrink-0 items-center justify-center rounded-full',
                  done ? cn(ACCENT_BG, 'text-white') : 'border-2 bg-white',
                  current && 'border-[var(--adm-invoice-accent)] text-[var(--adm-invoice-accent)]',
                  !done && !current && 'border-[#e2e2e8] text-[#6b6b76]',
                )}
              >
                {done ? <Check className="size-3" aria-hidden="true" /> : null}
              </div>
              <span className={cn('text-center text-[10.5px]', done || current ? 'font-bold text-[#191920]' : 'font-semibold text-[#6b6b76]')}>{step.label}</span>
            </div>
          );
        })}
      </div>
    </Region>
  );
}
