// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Attachments panel (comp 666-702, Appendix A §E3; D8): what is attached
 * to every send — a library file (name + size · type, or *File missing*) or
 * a generated file (label + token, resolved per recipient) — each removable;
 * *Add generated file*; and the *Workspace documents* list the caller
 * supplies (39-T14 fills it from `GET /files`).
 */
import { FileCog, FileText, Minus } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconButton, Input, cn } from '@adminium/ui';

import { t } from '../../../../i18n/t.js';
import type { EmailAttachment, EmailAttachmentResolved } from '../../../api.js';
import { DashedButton, Divider, PanelLabel } from '../parts.js';

export interface AttachmentsPanelProps {
  attachments: readonly EmailAttachment[];
  resolved: readonly EmailAttachmentResolved[];
  onGeneratedChange: (id: string, patch: { label?: string; token?: string }) => void;
  onRemove: (id: string) => void;
  onAddGenerated: () => void;
  /** The workspace documents list (39-T14). */
  documents?: ReactNode;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentsPanel({ attachments, resolved, onGeneratedChange, onRemove, onAddGenerated, documents }: AttachmentsPanelProps) {
  const byId = new Map(resolved.map((entry) => [entry.id, entry]));
  return (
    <div data-testid="email-attachments-panel" className="flex flex-col gap-[13px]">
      {attachments.length === 0 ? (
        <span className="text-[11.5px] leading-[1.5] text-fg-subtle">
          {t('email:inspector.attachmentsEmpty', 'Nothing attached yet. Add a fixed file that goes out with every send, or a generated file resolved per recipient.')}
        </span>
      ) : (
        <div className="flex flex-col gap-2">
          <PanelLabel className="mb-0">{t('email:inspector.attachedToEverySend', 'Attached to every send')}</PanelLabel>
          {attachments.map((attachment) => {
            const file = attachment.kind === 'file' ? byId.get(attachment.id) : undefined;
            const missing = attachment.kind === 'file' && (file === undefined || file.missing);
            return (
              <div key={attachment.id} data-testid="email-attachment-row" className="flex items-start gap-[9px] rounded-[11px] border border-border bg-surface-2 p-2.5">
                <span
                  className={cn(
                    'flex size-[30px] shrink-0 items-center justify-center rounded-lg',
                    attachment.kind === 'generated' ? 'bg-accent-soft text-accent' : missing ? 'bg-danger-soft text-danger' : 'bg-surface-3 text-fg-muted',
                  )}
                >
                  {attachment.kind === 'generated' ? <FileCog className="size-[15px]" aria-hidden="true" /> : <FileText className="size-[15px]" aria-hidden="true" />}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  {attachment.kind === 'file' ? (
                    <>
                      <div className="truncate text-[12px] font-extrabold text-fg">
                        {missing ? t('email:canvas.fileMissing', 'File missing') : (file?.filename ?? attachment.fileId)}
                      </div>
                      <div className="text-[10.5px] text-fg-subtle">
                        {missing || file === undefined ? attachment.fileId : `${formatSize(file.sizeBytes)} · ${file.mime}`}
                      </div>
                    </>
                  ) : (
                    <>
                      <Input
                        aria-label={t('email:inspector.generatedLabel', 'Label')}
                        placeholder={t('email:inspector.generatedLabel', 'Label')}
                        value={attachment.label}
                        onChange={(event) => onGeneratedChange(attachment.id, { label: event.target.value })}
                        className="h-8 text-[12px] font-bold"
                      />
                      <Input
                        mono
                        aria-label={t('email:inspector.generatedToken', 'Token')}
                        placeholder="{{file_url}}"
                        value={attachment.token}
                        onChange={(event) => onGeneratedChange(attachment.id, { token: event.target.value })}
                        className="h-8 text-[11.5px] font-bold text-accent"
                      />
                      <span className="text-[10px] leading-[1.5] text-fg-subtle">{t('email:inspector.resolvedPerRecipient', 'Resolved per recipient at send time.')}</span>
                    </>
                  )}
                </div>
                <IconButton variant="bordered" size="sm" label={t('email:inspector.removeAttachment', 'Remove attachment')} onClick={() => onRemove(attachment.id)}>
                  <Minus className="size-[13px]" />
                </IconButton>
              </div>
            );
          })}
        </div>
      )}
      <DashedButton accent onClick={onAddGenerated} testId="email-add-generated">
        <FileCog className="size-3.5" aria-hidden="true" />
        {t('email:inspector.addGeneratedFile', 'Add generated file')}
      </DashedButton>
      {documents === undefined ? null : (
        <>
          <Divider />
          <PanelLabel className="mb-0">{t('email:inspector.workspaceDocuments', 'Workspace documents')}</PanelLabel>
          {documents}
        </>
      )}
    </div>
  );
}
