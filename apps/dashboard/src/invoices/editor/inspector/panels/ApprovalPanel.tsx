// SPDX-License-Identifier: AGPL-3.0-only
/** The Approval panel (comp 909-915; `apprOptions` 1685): approver name, role, the three tinted statuses, *Remove section* (`approvalShow`). */
import { t } from '../../../../i18n/t.js';
import type { ApprovalStatus } from '../../../model/envelope.js';
import { OptionButton, PanelLabel, RemoveSectionButton, TextField, type OptionTone } from '../parts.js';
import type { PanelProps } from '../panelProps.js';

const APPROVAL: readonly { status: ApprovalStatus; tone: OptionTone }[] = [
  { status: 'pending', tone: 'warn' },
  { status: 'approved', tone: 'pos' },
  { status: 'rejected', tone: 'danger' },
];

export function approvalLabel(status: ApprovalStatus): string {
  switch (status) {
    case 'pending':
      return t('invoices:inspector.approval.status.pending', 'Pending');
    case 'approved':
      return t('invoices:inspector.approval.status.approved', 'Approved');
    case 'rejected':
      return t('invoices:inspector.approval.status.rejected', 'Rejected');
  }
}

export function ApprovalPanel({ draft, edits, onSelect }: PanelProps) {
  const body = draft.body;
  return (
    <div className="flex flex-col gap-[14px]">
      <TextField label={t('invoices:inspector.approval.name', 'Approver name')} value={body.apprName} onFocus={edits.beginEdit} onChange={(value) => edits.set('apprName', value)} className="font-bold" testId="invoices-appr-name" />
      <TextField label={t('invoices:inspector.approval.title', 'Role / title')} value={body.apprTitle} onFocus={edits.beginEdit} onChange={(value) => edits.set('apprTitle', value)} className="text-[12.5px]" testId="invoices-appr-title" />
      <div>
        <PanelLabel id="invoices-approval-status-label" className="mb-2">
          {t('invoices:inspector.approval.statusLabel', 'Status')}
        </PanelLabel>
        <div className="flex flex-wrap gap-[6px]" role="group" aria-labelledby="invoices-approval-status-label">
          {APPROVAL.map(({ status, tone }) => (
            <OptionButton key={status} on={body.apprStatus === status} tone={tone} label={approvalLabel(status)} value={status} onClick={() => edits.histSet('apprStatus', status)} />
          ))}
        </div>
      </div>
      <RemoveSectionButton flag="approvalShow" edits={edits} onSelect={onSelect} />
    </div>
  );
}
