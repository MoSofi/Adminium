// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The comp's delete confirm (153-168, Appendix A §M9) in the system's modal
 * anatomy: danger tile, *Delete {name}?*, one sentence, Cancel / Delete.
 *
 * Three flavours share it (D4): `archive` — the everyday Delete, whose
 * sentence says where the document goes; `forGood` — archived mode's second
 * step, with the comp's own "can't be undone" line; `reset` — the same slot
 * on a built-in key, which is re-seeded rather than removed.
 */
import { RotateCcw, Trash2 } from 'lucide-react';
import { Button, Modal, ModalBody, ModalFooter, ModalHeader } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import type { EmailDocumentKind } from '../api.js';

export type DeleteModalMode = 'archive' | 'forGood' | 'reset';

export interface DeleteModalProps {
  mode: DeleteModalMode;
  kind: EmailDocumentKind;
  name: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

function bodyFor(mode: DeleteModalMode, kind: EmailDocumentKind): string {
  switch (mode) {
    case 'archive':
      return t('email:delete.archiveBody', 'It moves to Archived, where you can restore it or delete it for good.');
    case 'forGood':
      return kind === 'template'
        ? t('email:delete.forGoodBody.template', 'This can’t be undone. The template will be permanently removed.')
        : t('email:delete.forGoodBody.campaign', 'This can’t be undone. The campaign will be permanently removed.');
    case 'reset':
      return t('email:delete.resetBody', 'Your edits to this language are replaced by the shipped copy.');
  }
}

export function DeleteModal({ mode, kind, name, busy, onCancel, onConfirm }: DeleteModalProps) {
  const title =
    mode === 'reset'
      ? t('email:delete.resetTitle', 'Reset {name} to built-in?', { name })
      : mode === 'forGood'
        ? t('email:delete.forGoodTitle', 'Delete {name} for good?', { name })
        : t('email:delete.title', 'Delete {name}?', { name });
  const confirmLabel =
    mode === 'reset'
      ? t('email:delete.reset', 'Reset')
      : mode === 'forGood'
        ? t('email:delete.forGood', 'Delete for good')
        : t('email:delete.confirm', 'Delete');

  return (
    <Modal
      open
      size="sm"
      onOpenChange={(open) => {
        if (!open && !busy) onCancel();
      }}
    >
      <ModalHeader
        icon={mode === 'reset' ? <RotateCcw /> : <Trash2 />}
        tone={mode === 'reset' ? 'accent' : 'danger'}
        title={title}
        closeLabel={t('common.close', 'Close')}
      />
      <ModalBody>
        <p data-testid="email-delete-body" className="text-body-sm text-fg-muted">
          {bodyFor(mode, kind)}
        </p>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          {t('common.cancel', 'Cancel')}
        </Button>
        <Button variant={mode === 'reset' ? 'primary' : 'destructive'} onClick={onConfirm} loading={busy} data-testid="email-delete-confirm">
          {confirmLabel}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
