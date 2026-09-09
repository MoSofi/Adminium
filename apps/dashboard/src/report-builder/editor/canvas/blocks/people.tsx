// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The five blocks about people and paperwork (comp 323-326, 337): the
 * signature pair, the terms checkbox, the attachment list, the approval row
 * and the contact card.
 *
 * The signature name/title and the terms label are edited INLINE on the sheet
 * as well as in the inspector (the comp's own duplication, D25, kept). The
 * attachments block types a name and a size — it is not wired to the Files
 * library, which is another surface's decision (43 §5 item 6).
 */
import { cn } from '@adminium/ui';

import { t } from '../../../../i18n/t.js';
import type { ApprovalStatus } from '../../../model/envelope.js';
import { reportIcon } from '../../../icons.js';
import { DANGER_SOFT_BG, DANGER_TEXT, InlineInput, POS_SOFT_BG, POS_TEXT, SHEET_MUTED, SHEET_SUBTLE, WARN_SOFT_BG, WARN_TEXT } from '../inline.js';
import type { BlockBodyProps } from './types.js';

/** The comp's `apprMeta` (472): label, text colour, soft fill and glyph, per status. */
export function approvalMeta(status: ApprovalStatus): { label: string; text: string; soft: string; glyph: string } {
  switch (status) {
    case 'approved':
      return { label: t('reportBuilder:block.approval.approved', 'Approved'), text: POS_TEXT, soft: POS_SOFT_BG, glyph: 'badge-check' };
    case 'rejected':
      return { label: t('reportBuilder:block.approval.rejected', 'Rejected'), text: DANGER_TEXT, soft: DANGER_SOFT_BG, glyph: 'circle-x' };
    case 'pending':
      return { label: t('reportBuilder:block.approval.pending', 'Pending'), text: WARN_TEXT, soft: WARN_SOFT_BG, glyph: 'clock' };
  }
}

/** 323: two columns, each a 38 px rule; the left carries the name and role, the right *Date signed*. */
export function SignatureBlock({ block, edits }: BlockBodyProps<'signature'>) {
  return (
    <div data-testid="report-block-signature" className="grid grid-cols-2 gap-6 pt-1.5">
      <div>
        <div className="mb-[9px] h-[38px] border-b-[1.5px] border-[#e2e2e8]" />
        <InlineInput
          label={t('reportBuilder:inspector.signatoryName', 'Signatory name')}
          value={block.sigName}
          onFocus={edits.beginEdit}
          onChange={(value) => edits.patchBlock(block.id, { sigName: value })}
          className="text-[13px] font-bold"
        />
        <InlineInput
          label={t('reportBuilder:inspector.signatoryTitle', 'Title / role')}
          value={block.sigTitle}
          onFocus={edits.beginEdit}
          onChange={(value) => edits.patchBlock(block.id, { sigTitle: value })}
          className={cn('mt-0.5 text-[11.5px]', SHEET_MUTED)}
        />
      </div>
      <div>
        <div className="mb-[9px] h-[38px] border-b-[1.5px] border-[#e2e2e8]" />
        <div className={cn('text-[11.5px]', SHEET_MUTED)}>{t('reportBuilder:block.signature.dateSigned', 'Date signed')}</div>
      </div>
    </div>
  );
}

/** 324: a 20 px checkbox that toggles as a history step, and the label inline beside it. */
export function TermsBlock({ block, edits }: BlockBodyProps<'terms'>) {
  const CheckGlyph = reportIcon('check');
  return (
    <div data-testid="report-block-terms" className="flex items-start gap-[11px]">
      <button
        type="button"
        role="checkbox"
        aria-checked={block.termsChecked}
        aria-label={t('reportBuilder:inspector.prechecked', 'Pre-checked')}
        data-testid="report-terms-box"
        onClick={(event) => {
          event.stopPropagation();
          edits.histPatchBlock(block.id, { termsChecked: !block.termsChecked });
        }}
        className={cn(
          'mt-px flex size-5 shrink-0 items-center justify-center rounded-md border-[1.5px] text-white',
          block.termsChecked ? 'border-[color:var(--adm-report-accent)] bg-[var(--adm-report-accent)]' : 'border-[#e2e2e8] bg-transparent',
        )}
      >
        {block.termsChecked ? <CheckGlyph className="size-[13px]" aria-hidden="true" /> : null}
      </button>
      <InlineInput
        label={t('reportBuilder:inspector.checkboxLabel', 'Checkbox label')}
        value={block.termsLabel}
        onFocus={edits.beginEdit}
        onChange={(value) => edits.patchBlock(block.id, { termsLabel: value })}
        className={cn('pt-0.5 text-[12.5px]', SHEET_MUTED)}
      />
    </div>
  );
}

/** 325: surface-2 rows of paperclip · name · mono size. */
export function AttachmentsBlock({ block }: BlockBodyProps<'attachments'>) {
  const Glyph = reportIcon('paperclip');
  return (
    <div data-testid="report-block-attachments" className="flex flex-col gap-2">
      {block.attachments.map((file, index) => (
        <div key={index} className="flex items-center gap-2.5 rounded-[10px] border border-[#ececef] bg-[#fafafa] px-3 py-[9px]">
          <Glyph className={cn('size-[15px] shrink-0', SHEET_SUBTLE)} aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">{file.name}</span>
          <span className={cn('font-mono text-[11px]', SHEET_SUBTLE)}>{file.size}</span>
        </div>
      ))}
    </div>
  );
}

/** 326: a status-tinted tile, the approver's name and role, and a status pill. */
export function ApprovalBlock({ block }: BlockBodyProps<'approval'>) {
  const meta = approvalMeta(block.apprStatus);
  const Glyph = reportIcon(meta.glyph);
  return (
    <div data-testid="report-block-approval" className="flex items-center gap-3 rounded-[11px] border border-[#ececef] bg-[#fafafa] px-3.5 py-3">
      <div className={cn('flex size-[34px] shrink-0 items-center justify-center rounded-[9px]', meta.soft, meta.text)}>
        <Glyph className="size-[18px]" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-bold">{block.apprName}</div>
        <div className={cn('text-[11.5px]', SHEET_MUTED)}>{block.apprTitle}</div>
      </div>
      <span
        data-testid="report-approval-status"
        data-status={block.apprStatus}
        className={cn('inline-flex shrink-0 items-center gap-[5px] rounded-[20px] px-2.5 py-[3px] text-[11px] font-bold', meta.soft, meta.text)}
      >
        <Glyph className="size-3" aria-hidden="true" />
        {meta.label}
      </span>
    </div>
  );
}

/** 337: three icon rows — name, then the email and phone in mono. */
export function ContactBlock({ block }: BlockBodyProps<'contact'>) {
  const PersonGlyph = reportIcon('user-round');
  const MailGlyph = reportIcon('mail');
  const PhoneGlyph = reportIcon('phone');
  return (
    <div data-testid="report-block-contact" className="flex flex-col gap-[7px]">
      <div className="flex items-center gap-2.5">
        <PersonGlyph className={cn('size-3.5', SHEET_SUBTLE)} aria-hidden="true" />
        <span className="text-[12.5px] font-bold">{block.conName}</span>
      </div>
      <div className="flex items-center gap-2.5">
        <MailGlyph className={cn('size-3.5', SHEET_SUBTLE)} aria-hidden="true" />
        <span className={cn('font-mono text-[12.5px]', SHEET_MUTED)}>{block.conEmail}</span>
      </div>
      <div className="flex items-center gap-2.5">
        <PhoneGlyph className={cn('size-3.5', SHEET_SUBTLE)} aria-hidden="true" />
        <span className={cn('font-mono text-[12.5px]', SHEET_MUTED)}>{block.conPhone}</span>
      </div>
    </div>
  );
}
