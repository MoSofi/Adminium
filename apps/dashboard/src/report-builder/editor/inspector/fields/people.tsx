// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The five field groups about people and paperwork (comp 389-397, 417): the
 * signature pair, the terms toggle + label, the attachment repeater, the
 * approver and their status, the QR caption, and the contact card.
 */
import { useId } from 'react';

import { cn } from '@adminium/ui';

import { t } from '../../../../i18n/t.js';
import { rowSeeds } from '../../blockText.js';
import { RowsEditor } from '../RowsEditor.js';
import { FIELD, OptionButton, PanelLabel, TextAreaField, TextField, Toggle } from '../parts.js';
import type { FieldsProps } from './types.js';

/** 389: *Signatory name* · *Title / role*. */
export function SignatureFields({ block, edits }: FieldsProps<'signature'>) {
  return (
    <div className="flex flex-col gap-4">
      <TextField
        label={t('reportBuilder:inspector.signatoryName', 'Signatory name')}
        value={block.sigName}
        onFocus={edits.beginEdit}
        onChange={(value) => edits.patchBlock(block.id, { sigName: value })}
      />
      <TextField
        label={t('reportBuilder:inspector.signatoryTitle', 'Title / role')}
        value={block.sigTitle}
        onFocus={edits.beginEdit}
        onChange={(value) => edits.patchBlock(block.id, { sigTitle: value })}
      />
    </div>
  );
}

/** 391: a *Pre-checked* toggle over its hint, then the checkbox label. */
export function TermsFields({ block, edits }: FieldsProps<'terms'>) {
  const labelId = useId();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div id={labelId} className="text-[12.5px] font-bold text-fg">
            {t('reportBuilder:inspector.prechecked', 'Pre-checked')}
          </div>
          <div className="mt-0.5 text-[11px] text-fg-subtle">{t('reportBuilder:inspector.precheckedHint', 'Show the box already ticked')}</div>
        </div>
        <Toggle
          on={block.termsChecked}
          labelledBy={labelId}
          testId="report-prechecked"
          onClick={() => edits.histPatchBlock(block.id, { termsChecked: !block.termsChecked })}
        />
      </div>
      <TextAreaField
        label={t('reportBuilder:inspector.checkboxLabel', 'Checkbox label')}
        rows={3}
        value={block.termsLabel}
        onFocus={edits.beginEdit}
        onChange={(value) => edits.patchBlock(block.id, { termsLabel: value })}
      />
    </div>
  );
}

/** 393: name · size (58 px mono) · remove; *Add file*. */
export function AttachmentsFields({ block, edits }: FieldsProps<'attachments'>) {
  return (
    <div className="flex flex-col gap-2">
      <PanelLabel className="mb-0">{t('reportBuilder:inspector.files', 'Files')}</PanelLabel>
      <RowsEditor
        rows={block.attachments}
        addLabel={t('reportBuilder:inspector.addFile', 'Add file')}
        removeLabel={(index) => t('reportBuilder:inspector.remove', 'Remove {noun} {n}', { noun: t('reportBuilder:inspector.files', 'Files'), n: index + 1 })}
        onAdd={() => edits.addArrayItem(block.id, 'attachments', rowSeeds.attachment())}
        onRemove={(index) => edits.removeArrayItem(block.id, 'attachments', index)}
        removeClassName="h-[34px]"
        renderRow={(row, index, remove) => (
          <div key={index} data-testid="report-file-row" className="flex items-center gap-1.5">
            <TextField
              ariaLabel={t('reportBuilder:inspector.fileName', 'File name {n}', { n: index + 1 })}
              value={row.name}
              onFocus={edits.beginEdit}
              onChange={(value) => edits.updateArrayItem(block.id, 'attachments', index, { name: value })}
              className="min-w-0 flex-1 py-2 text-[12.5px]"
            />
            <input
              type="text"
              aria-label={t('reportBuilder:inspector.fileSize', 'File size {n}', { n: index + 1 })}
              value={row.size}
              onFocus={edits.beginEdit}
              onChange={(event) => edits.updateArrayItem(block.id, 'attachments', index, { size: event.target.value })}
              className={cn(FIELD, 'w-[58px] shrink-0 px-2 py-2 font-mono text-[12.5px]')}
            />
            {remove}
          </div>
        )}
      />
    </div>
  );
}

/** 395: *Approver name* · *Role / title* · three status options in their tones. */
export function ApprovalFields({ block, edits }: FieldsProps<'approval'>) {
  const options = [
    { value: 'pending' as const, label: t('reportBuilder:block.approval.pending', 'Pending'), tone: 'warn' as const },
    { value: 'approved' as const, label: t('reportBuilder:block.approval.approved', 'Approved'), tone: 'pos' as const },
    { value: 'rejected' as const, label: t('reportBuilder:block.approval.rejected', 'Rejected'), tone: 'danger' as const },
  ];
  return (
    <div className="flex flex-col gap-4">
      <TextField
        label={t('reportBuilder:inspector.approverName', 'Approver name')}
        value={block.apprName}
        onFocus={edits.beginEdit}
        onChange={(value) => edits.patchBlock(block.id, { apprName: value })}
      />
      <TextField
        label={t('reportBuilder:inspector.approverTitle', 'Role / title')}
        value={block.apprTitle}
        onFocus={edits.beginEdit}
        onChange={(value) => edits.patchBlock(block.id, { apprTitle: value })}
      />
      <div>
        <PanelLabel className="mb-2">{t('reportBuilder:inspector.status', 'Status')}</PanelLabel>
        <div className="flex flex-wrap gap-1.5">
          {options.map((option) => (
            <OptionButton
              key={option.value}
              on={block.apprStatus === option.value}
              value={option.value}
              label={option.label}
              tone={option.tone}
              testId="report-approval-option"
              onClick={() => edits.histPatchBlock(block.id, { apprStatus: option.value })}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** 397: a 110 px glyph tile over the caption field. */
export function QrFields({ block, edits }: FieldsProps<'qr'>) {
  return (
    <TextField
      label={t('reportBuilder:inspector.caption', 'Caption')}
      value={block.qrCaption}
      onFocus={edits.beginEdit}
      onChange={(value) => edits.patchBlock(block.id, { qrCaption: value })}
    />
  );
}

/** 417: *Contact name* · *Email* (mono) · *Phone* (mono). */
export function ContactFields({ block, edits }: FieldsProps<'contact'>) {
  return (
    <div className="flex flex-col gap-4">
      <TextField
        label={t('reportBuilder:inspector.contactName', 'Contact name')}
        value={block.conName}
        onFocus={edits.beginEdit}
        onChange={(value) => edits.patchBlock(block.id, { conName: value })}
      />
      <TextField
        label={t('reportBuilder:inspector.email', 'Email')}
        value={block.conEmail}
        onFocus={edits.beginEdit}
        onChange={(value) => edits.patchBlock(block.id, { conEmail: value })}
        className="font-mono text-[12.5px]"
      />
      <TextField
        label={t('reportBuilder:inspector.phone', 'Phone')}
        value={block.conPhone}
        onFocus={edits.beginEdit}
        onChange={(value) => edits.patchBlock(block.id, { conPhone: value })}
        className="font-mono text-[12.5px]"
      />
    </div>
  );
}
