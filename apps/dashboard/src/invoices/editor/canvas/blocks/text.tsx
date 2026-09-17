// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The prose blocks (comp 458-495, 548-553, 614-638; B6–B8, B13, B19–B21):
 * `paynotes` — *Payment* lines beside a *Notes* textarea over a top border;
 * `signature` — the optional scanned signature, an underline, name and
 * title, and a *Date signed* underline; `terms` — a 20 px checkbox beside
 * the acceptance label; `poterms`, `legal` (with its scale glyph and top
 * border) and `refund` — a kicker over a textarea; `contact` — name, email
 * and phone rows.
 */
import { Check, Mail, Phone, Scale, UserRound } from 'lucide-react';
import { cn } from '@adminium/ui';

import { t } from '../../../../i18n/t.js';
import { InlineInput, InlineTextarea, KICKER, Region, lineLabel } from '../inline.js';
import type { BlockProps } from './types.js';

const PROSE = 'text-[12px] leading-[1.6] text-[#6b6b76]';

export function PaynotesBlock({ body, edits, section, onSelect }: BlockProps) {
  return (
    <div className="grid grid-cols-2 gap-[18px] border-t border-[#ececef] pt-[22px]">
      <Region section="payment" selected={section} onSelect={onSelect}>
        <div className={`${KICKER} mb-[7px]`}>{t('invoices:canvas.payment', 'Payment')}</div>
        {body.payment.map((line, index) => (
          <InlineInput
            key={index}
            label={lineLabel('payment', index)}
            value={line}
            onFocus={edits.beginEdit}
            onChange={(value) => edits.updateLine('payment', index, value)}
            className="mb-0.5 text-[12px] text-[#6b6b76]"
          />
        ))}
      </Region>
      <Region section="notes" selected={section} onSelect={onSelect}>
        <div className={`${KICKER} mb-[7px]`}>{t('invoices:canvas.notes', 'Notes')}</div>
        <InlineTextarea label={t('invoices:canvas.notes', 'Notes')} value={body.notes} onFocus={edits.beginEdit} onChange={(value) => edits.set('notes', value)} className={PROSE} />
      </Region>
    </div>
  );
}

export function SignatureBlock({ body, edits, section, onSelect }: BlockProps) {
  return (
    <Region section="signature" selected={section} onSelect={onSelect}>
      <div className={`${KICKER} mb-3.5`}>{t('invoices:canvas.signature', 'Signature')}</div>
      <div className="grid grid-cols-2 gap-6">
        <div>
          {body.sigImage === '' ? null : <img src={body.sigImage} alt="" data-testid="invoices-signature-image" className="mb-0.5 h-[38px] w-[170px] max-w-full object-contain object-[0_50%]" />}
          <div className="mb-[9px] h-[38px] border-b-[1.5px] border-[#e2e2e8]" />
          <InlineInput label={t('invoices:canvas.sigName', 'Signer name')} value={body.sigName} onFocus={edits.beginEdit} onChange={(value) => edits.set('sigName', value)} className="text-[13px] font-bold" />
          <InlineInput label={t('invoices:canvas.sigTitle', 'Signer title')} value={body.sigTitle} onFocus={edits.beginEdit} onChange={(value) => edits.set('sigTitle', value)} className="mt-0.5 text-[11.5px] text-[#6b6b76]" />
        </div>
        <div>
          <div className="mb-[9px] h-[38px] border-b-[1.5px] border-[#e2e2e8]" />
          <div className="text-[11.5px] text-[#6b6b76]">{t('invoices:canvas.dateSigned', 'Date signed')}</div>
        </div>
      </div>
    </Region>
  );
}

export function TermsBlock({ body, edits, section, onSelect }: BlockProps) {
  const checked = body.termsChecked;
  return (
    <Region section="terms" selected={section} onSelect={onSelect}>
      <div className="flex items-start gap-[11px]">
        <button
          type="button"
          role="checkbox"
          aria-checked={checked}
          aria-label={body.termsLabel.trim() === '' ? t('invoices:canvas.termsAccepted', 'Terms accepted') : body.termsLabel}
          data-testid="invoices-terms-check"
          onClick={(event) => {
            event.stopPropagation();
            edits.histSet('termsChecked', !checked);
          }}
          className={cn(
            'mt-px flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md border-[1.5px] text-white',
            checked ? 'border-[var(--adm-invoice-accent)] bg-[var(--adm-invoice-accent)]' : 'border-[#e2e2e8] bg-transparent',
          )}
        >
          {checked ? <Check className="size-[13px]" aria-hidden="true" /> : null}
        </button>
        <InlineInput
          label={t('invoices:canvas.termsLabel', 'Terms label')}
          value={body.termsLabel}
          onFocus={edits.beginEdit}
          onChange={(value) => edits.set('termsLabel', value)}
          className="pt-0.5 text-[12.5px] text-[#6b6b76]"
        />
      </div>
    </Region>
  );
}

export function PotermsBlock({ body, edits, section, onSelect }: BlockProps) {
  return (
    <Region section="poterms" selected={section} onSelect={onSelect}>
      <div className={`${KICKER} mb-[7px]`}>{t('invoices:canvas.poTerms', 'Purchase order terms')}</div>
      <InlineTextarea label={t('invoices:canvas.poTerms', 'Purchase order terms')} value={body.poTerms} onFocus={edits.beginEdit} onChange={(value) => edits.set('poTerms', value)} className={PROSE} />
    </Region>
  );
}

export function LegalBlock({ body, edits, section, onSelect }: BlockProps) {
  return (
    <Region section="legal" selected={section} onSelect={onSelect}>
      <div className="border-t border-[#ececef] pt-4">
        <div className="mb-1.5 flex items-center gap-[7px]">
          <Scale className="size-[13px] text-[#6b6b76]" aria-hidden="true" />
          <span className={KICKER}>{t('invoices:canvas.legal', 'Legal')}</span>
        </div>
        <InlineTextarea
          label={t('invoices:canvas.legal', 'Legal')}
          value={body.legalText}
          onFocus={edits.beginEdit}
          onChange={(value) => edits.set('legalText', value)}
          className="text-[10.5px] leading-[1.65] text-[#6b6b76]"
        />
      </div>
    </Region>
  );
}

export function RefundBlock({ body, edits, section, onSelect }: BlockProps) {
  return (
    <Region section="refund" selected={section} onSelect={onSelect}>
      <div className={`${KICKER} mb-[7px]`}>{t('invoices:canvas.refund', 'Refund policy')}</div>
      <InlineTextarea label={t('invoices:canvas.refund', 'Refund policy')} value={body.refText} onFocus={edits.beginEdit} onChange={(value) => edits.set('refText', value)} className={PROSE} />
    </Region>
  );
}

export function ContactBlock({ body, section, onSelect }: BlockProps) {
  return (
    <Region section="contact" selected={section} onSelect={onSelect}>
      <div className={`${KICKER} mb-[9px]`}>{t('invoices:canvas.contact', 'Questions? Contact us')}</div>
      <div className="flex flex-col gap-[7px]">
        <div className="flex items-center gap-2.5">
          <UserRound className="size-3.5 text-[#6b6b76]" aria-hidden="true" />
          <span className="text-[12.5px] font-bold">{body.conName}</span>
        </div>
        <div className="flex items-center gap-2.5">
          <Mail className="size-3.5 text-[#6b6b76]" aria-hidden="true" />
          <span className="font-mono text-[12.5px] text-[#6b6b76]">{body.conEmail}</span>
        </div>
        <div className="flex items-center gap-2.5">
          <Phone className="size-3.5 text-[#6b6b76]" aria-hidden="true" />
          <span className="font-mono text-[12.5px] text-[#6b6b76]">{body.conPhone}</span>
        </div>
      </div>
    </Region>
  );
}
