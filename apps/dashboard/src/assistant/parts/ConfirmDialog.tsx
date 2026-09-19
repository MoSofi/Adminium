// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The last step before anything is written.
 *
 * It names the document, says what will exist afterwards, and — the row that
 * makes it more than a speed bump — shows the AUDIT KEY this action will
 * write. A person confirming a save can see, before pressing it, exactly what
 * the trail will say happened.
 *
 * The key shown is the REAL one (`assistant.<page>.create`), not the comp's
 * `milo.email_template.create` mock: a confirm that named a different key
 * than the row it writes would be a promise nothing keeps.
 *
 * Esc closes THIS and not the modal behind it — the nested Radix dialog owns
 * the key while it is open, which is the order a person expects.
 */
import { Button, Modal, ModalBody, ModalFooter, ModalHeader } from '@adminium/ui';
import { Check, ScrollText } from 'lucide-react';

import { t } from '../../i18n/t.js';
import type { ConfirmCopy } from '../contexts.js';
import { assistantIcon } from '../icons.js';

export interface ConfirmDialogProps {
  copy: ConfirmCopy;
  open: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({ copy, open, busy, onCancel, onConfirm }: ConfirmDialogProps) {
  const Icon = assistantIcon(copy.icon);
  return (
    <Modal
      open={open}
      size="sm"
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <ModalHeader
        title={copy.title}
        closeLabel={t('assistant:close', 'Close')}
        icon={Icon === null ? <Check aria-hidden="true" /> : <Icon aria-hidden="true" />}
      />
      <ModalBody data-testid="assistant-confirm" className="flex flex-col gap-3">
        <p className="text-body-sm leading-[1.65] text-pretty text-fg-muted">{copy.body}</p>
        <div className="flex items-center gap-2 rounded-md bg-surface-2 px-3 py-2.5">
          <ScrollText className="size-[13px] shrink-0 text-fg-muted" aria-hidden="true" />
          <span className="font-mono text-[11px] text-fg-muted">{copy.auditKey}</span>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
          {t('assistant:confirm.cancel', 'Cancel')}
        </Button>
        <Button data-testid="assistant-confirm-go" type="button" onClick={onConfirm} loading={busy} iconLeft={<Check aria-hidden="true" />}>
          {copy.button}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

