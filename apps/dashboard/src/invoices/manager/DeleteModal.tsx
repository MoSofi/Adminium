// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The comp's delete confirm (144-158) in the system's modal anatomy:
 * danger tile, *Delete {name}?*, one sentence, Cancel / Delete. It confirms a
 * HARD delete — this comp has no archive — so the sentence says what
 * the comp's says: it cannot be undone.
 *
 * Shared with the editor's header Delete (comp 359): same props, same copy.
 */
import { Trash2 } from 'lucide-react';
import { Button, Modal, ModalBody, ModalFooter, ModalHeader } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import type { InvoiceDocumentKind } from '../api.js';

export interface DeleteModalProps {
  kind: InvoiceDocumentKind;
  name: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeleteModal({ kind, name, busy, onCancel, onConfirm }: DeleteModalProps) {
  return (
    <Modal
      open
      size="sm"
      onOpenChange={(open) => {
        if (!open && !busy) onCancel();
      }}
    >
      <ModalHeader icon={<Trash2 />} tone="danger" title={t('invoices:delete.title', 'Delete {name}?', { name })} closeLabel={t('common.close', 'Close')} />
      <ModalBody>
        <p data-testid="invoices-delete-body" className="text-body-sm text-fg-muted">
          {kind === 'template'
            ? t('invoices:delete.body.template', 'This can’t be undone. The template will be permanently removed.')
            : t('invoices:delete.body.invoice', 'This can’t be undone. The invoice will be permanently removed.')}
        </p>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          {t('common.cancel', 'Cancel')}
        </Button>
        <Button variant="destructive" onClick={onConfirm} loading={busy} data-testid="invoices-delete-confirm">
          {t('invoices:delete.confirm', 'Delete')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
